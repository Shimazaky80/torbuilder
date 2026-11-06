import { useCallback, useEffect, useState } from 'react';
import {
  Users as UsersIcon,
  Plus,
  X,
  Mail,
  Shield,
  ShieldOff,
  SlidersHorizontal,
  Ticket,
  Check,
  Copy,
  ExternalLink,
  Clock
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useSession } from '../hooks/useSession';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../hooks/useConfirm';
import ConfirmDialog from '../components/ConfirmDialog';
import { columnExists } from '../lib/schemaColumnProbe';
import {
  ACCESS_LEVELS,
  FLAGS,
  MODULES,
  assignableRoles,
  canSeeCosts,
  hasOverrides,
  levelLabel,
  resolveAccess
} from '../lib/rbac';

/* Who is in the company and what each of them may reach.
   The job description lives in the `roles` table and the exception lives on the
   person, so an Admin can move someone from Consultant to Operations without a
   deploy, and can still hand the senior consultant the cost price while the
   junior one is not shown it. Every change here goes through an RPC rather than
   an UPDATE on profiles: the guards — last Admin standing, cannot grant write
   you do not hold yourself, a platform account is not editable from a tenant —
   have to be enforced where nobody can talk past them. */

const MIGRATION = '20261257';

const nameOf = (member) => [member.first_name, member.last_name].filter(Boolean).join(' ')
  || member.email || '—';

/* The same resolver the signed-in session uses, run over somebody else's row,
   so the panel answers with what the database will actually enforce rather than
   with a guess made from the role name alone. */
const accessOf = (member, roleRows) => resolveAccess({
  roleKey: member.user_role,
  overrides: member.access_overrides || {},
  isPlatformAdmin: member.is_super_admin === true || member.user_role === 'super_admin',
  isActive: member.is_active !== false,
  roleRows
});

/* Compared against the role with no exceptions applied, because that is the
   only way to know which of a person's levels are theirs rather than their
   job's. */
const roleDefaults = (member, roleRows) => resolveAccess({
  roleKey: member.user_role,
  overrides: {},
  isPlatformAdmin: false,
  isActive: true,
  roleRows
});

const draftFromAccess = (access) => ({
  modules: MODULES.reduce((map, module) => ({ ...map, [module.id]: access.modules[module.id].level }), {}),
  flags: FLAGS.reduce((map, flag) => ({ ...map, [flag.id]: access.flags[flag.id].value }), {})
});

const toOverrides = (draft, base) => {
  const modules = {};
  MODULES.forEach(({ id }) => {
    if (draft.modules[id] !== base.modules[id].level) modules[id] = draft.modules[id];
  });
  const flags = {};
  FLAGS.forEach(({ id }) => {
    if (draft.flags[id] !== base.flags[id].value) flags[id] = draft.flags[id];
  });
  return { modules, flags };
};

const dateLabel = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

const Field = ({ label, hint, children }) => (
  <div>
    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
      {label}
    </label>
    {children}
    {hint && <small style={{ display: 'block', marginTop: '0.25rem', color: '#64748b' }}>{hint}</small>}
  </div>
);

const Stat = ({ label, value, tone = '#1e293b' }) => (
  <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.9rem 1.25rem', boxShadow: '0 2px 4px rgba(0,0,0,0.04)' }}>
    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
    <div style={{ fontSize: '1.4rem', fontWeight: 800, color: tone }}>{value}</div>
  </div>
);

export const Users = () => {
  const { userId, roleRows, isPlatformAdmin, can, companyId, refresh } = useSession();
  const { showToast } = useToast();
  const [confirmDialog, confirm] = useConfirm();

  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rosterMissing, setRosterMissing] = useState(false);
  const [invitations, setInvitations] = useState([]);
  const [roleOptions, setRoleOptions] = useState([]);

  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', roleKey: 'consultant' });
  const [issued, setIssued] = useState(null);
  const [saving, setSaving] = useState(false);

  const [accessFor, setAccessFor] = useState(null);
  const [draft, setDraft] = useState(null);

  const mayWrite = can('users', 'write');

  /* Nothing is set before the first reply, so a refresh after a change updates
     the rows in place instead of flashing the whole table back to loading. */
  const load = useCallback(async () => {
    /* `companyId` is the session's scope, which for the platform is the tenant
       picked in the sidebar and for everyone else their own company. Naming your
       own company is a no-op in the function; naming a neighbour only works for
       the platform. */
    const { data, error } = await supabase.rpc('get_company_team', { p_company: companyId });
    if (error) {
      /* PostgREST answers 404 with PGRST202 when the function is not in its
         schema cache — which is exactly the state a workspace is in before
         migration 20261257 has been applied. Everything else is a real failure
         and says so. */
      if (String(error.code || '').startsWith('PGRST202') || /Could not find the function/i.test(error.message || '')) {
        setRosterMissing(true);
        setMembers([]);
      } else {
        setRosterMissing(false);
        showToast(error.message || 'The team list could not be read.', 'error');
      }
    } else {
      setRosterMissing(false);
      setMembers(Array.isArray(data) ? data : []);
      /* The select is built from the rows the roster shows, so a company that
         has added its own job to `roles` sees it here without a deploy. */
      setRoleOptions(assignableRoles(roleRows, { callerIsPlatform: isPlatformAdmin }));
    }

    if (companyId) {
      const known = await columnExists('invitations', 'expires_at');
      const fields = known
        ? 'id, email, role, status, code, created_at, expires_at'
        : 'id, email, status, code, created_at';
      const { data: invs } = await supabase
        .from('invitations')
        .select(fields)
        .eq('company_id', companyId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      setInvitations(Array.isArray(invs) ? invs : []);
    } else {
      setInvitations([]);
    }
    setLoading(false);
  }, [companyId, isPlatformAdmin, roleRows, showToast]);

  useEffect(() => {
    const run = async () => { await load(); };
    run();
  }, [load]);

  const applyResult = (result, fallback) => {
    if (result?.success === false) {
      showToast(result.error || fallback, 'error');
      return false;
    }
    return true;
  };

  const changeRole = async (member, roleKey) => {
    const ok = await applyResult(
      await supabase.rpc('admin_set_user_role', { p_user_id: member.user_id, p_role_key: roleKey }),
      'The role could not be changed.'
    );
    if (!ok) return;
    showToast(`${nameOf(member)} is now a ${roleOptions.find((r) => r.key === roleKey)?.name || roleKey}.`);
    await Promise.all([load(), refresh()]);
  };

  const toggleActive = async (member) => {
    const disabling = member.is_active !== false;
    const ok = await applyResult(
      await supabase.rpc('admin_set_user_active', { p_user_id: member.user_id, p_is_active: !disabling }),
      'That account could not be updated.'
    );
    if (!ok) return;
    showToast(disabling ? `${nameOf(member)} can no longer sign in.` : `${nameOf(member)} is active again.`);
    await Promise.all([load(), refresh()]);
  };

  const openAccess = (member) => {
    setAccessFor(member);
    setDraft(draftFromAccess(accessOf(member, roleRows)));
  };

  const saveAccess = async () => {
    if (!accessFor || !draft) return;
    const overrides = toOverrides(draft, roleDefaults(accessFor, roleRows));
    setSaving(true);
    const ok = await applyResult(
      await supabase.rpc('admin_set_user_access', { p_user_id: accessFor.user_id, p_overrides: overrides }),
      'The access exceptions could not be saved.'
    );
    setSaving(false);
    if (!ok) return;
    const count = Object.keys(overrides.modules).length + Object.keys(overrides.flags).length;
    showToast(count ? `${nameOf(accessFor)} has ${count} access exception${count === 1 ? '' : 's'}.` : `${nameOf(accessFor)} is back to their role exactly.`);
    setAccessFor(null);
    setDraft(null);
    await Promise.all([load(), refresh()]);
  };

  const clearExceptions = async () => {
    if (!accessFor) return;
    setSaving(true);
    const ok = await applyResult(
      await supabase.rpc('admin_set_user_access', { p_user_id: accessFor.user_id, p_overrides: { modules: {}, flags: {} } }),
      'The access exceptions could not be cleared.'
    );
    setSaving(false);
    if (!ok) return;
    showToast(`${nameOf(accessFor)} now holds exactly what the ${roleOptions.find((r) => r.key === accessFor.user_role)?.name || accessFor.user_role} role gives.`);
    setAccessFor(null);
    setDraft(null);
    await Promise.all([load(), refresh()]);
  };

  const createInvitation = async (event) => {
    event.preventDefault();
    setSaving(true);
    const { data, error } = await supabase.rpc('admin_create_invitation', {
      p_email: inviteForm.email.trim(),
      p_role_key: inviteForm.roleKey,
      p_company: companyId
    });
    setSaving(false);
    if (error) {
      showToast(error.message || 'The invitation could not be created.', 'error');
      return;
    }
    if (!applyResult(data, 'The invitation could not be created.')) return;
    setIssued({ email: data.email, code: data.code, roleKey: data.role });
    setInviteForm({ email: '', roleKey: 'consultant' });
    await load();
  };

  const revokeInvitation = async (inv) => {
    const go = await confirm({
      title: 'Withdraw this invitation?',
      message: `${inv.email} will not be able to join with this code.`,
      detail: 'Nothing else changes. The person can be invited again later.',
      confirmLabel: 'Withdraw',
      destructive: true
    });
    if (!go) return;
    const ok = await applyResult(
      await supabase.rpc('admin_revoke_invitation', { p_invitation_id: inv.id }),
      'The invitation could not be withdrawn.'
    );
    if (!ok) return;
    showToast('That invitation is withdrawn.');
    await load();
  };

  const joinUrl = `${window.location.origin}/login`;

  const copyInvite = async (inv) => {
    const text = `You are invited to join your team on torbuilder. Sign up at ${joinUrl}?code=${inv.code} — or enter that code by hand — with this email address. The invitation carries your job, and it expires in 14 days.`;
    try {
      await navigator.clipboard.writeText(text);
      showToast(`Invitation for ${inv.email} copied to the clipboard.`);
    } catch {
      showToast('Copy failed — select the code and copy it by hand.', 'error');
    }
  };

  const activeCount = members.filter((m) => m.is_active !== false).length;
  const adminCount = members.filter((m) => m.user_role === 'admin' && m.is_active !== false).length;
  const baseAccess = accessFor ? roleDefaults(accessFor, roleRows) : null;

  return (
    <div className="super-admin-page" style={{ paddingBottom: '4rem' }}>
      <header className="page-header" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
        <div className="header-title">
          <UsersIcon className="header-icon" />
          <div>
            <h1>Users</h1>
            <p>The team, the job each of them holds, and what that job lets them reach</p>
          </div>
        </div>
        {mayWrite && !rosterMissing && (
          <button
            className="primary-btn"
            style={{ width: 'auto', padding: '0.625rem 1.25rem', background: '#0d7478', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            onClick={() => { setShowInvite(true); setIssued(null); }}
          >
            <Plus size={18} /> Invite a user
          </button>
        )}
      </header>

      <div style={{ background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: '12px', padding: '0.9rem 1.1rem', marginBottom: '1.5rem', fontSize: '0.85rem', color: '#134e4a', maxWidth: '70rem' }}>
        <strong>An Admin holds everything.</strong> Every other account sees only the modules its job needs — <em>none</em>, <em>view</em> or <em>full</em> — and the cost price is a separate decision, because a consultant who quotes well does not necessarily need to see what the lodge charges. Anything a person should reach beyond their job is an exception on their own row, and it counts both ways: it can widen access or narrow it. The last active Admin in a company cannot be demoted or disabled, so a company cannot lock itself out.
      </div>

      {!rosterMissing && members.length > 0 && (
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          <Stat label="In the team" value={members.length} />
          <Stat label="Active" value={activeCount} tone="#0d7478" />
          <Stat label="Admins" value={adminCount} tone={adminCount === 1 ? '#b45309' : '#1e293b'} />
          <Stat label="Waiting invitations" value={invitations.length} />
        </div>
      )}

      {adminCount === 1 && !rosterMissing && members.length > 0 && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '12px', padding: '0.75rem 1rem', marginBottom: '1.5rem', fontSize: '0.85rem', color: '#92400e', maxWidth: '70rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
          <Shield size={16} style={{ marginTop: '0.15rem' }} />
          <span>One Admin holds this company. Give a second person the Admin role when you are ready — until then, this account cannot be demoted or disabled, and nobody else can change anyone&apos;s access.</span>
        </div>
      )}

      {showInvite && (
        <div style={{ background: '#fff', borderRadius: '16px', padding: '2rem', border: '1px solid #cbd5e1', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.05)', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Ticket size={22} color="#0d7478" /> Invite a team member
            </h2>
            <button onClick={() => setShowInvite(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }} title="Close">
              <X size={24} />
            </button>
          </div>

          {issued ? (
            <div>
              <p style={{ marginTop: 0, fontSize: '0.9rem', color: '#134e4a', background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: '12px', padding: '0.85rem 1rem' }}>
                <Check size={16} style={{ verticalAlign: -2, marginRight: '0.35rem' }} />
                The invitation for <strong>{issued.email}</strong> is waiting. Send them the code below; they sign up with it and land in this company as a <strong>{roleOptions.find((r) => r.key === issued.roleKey)?.name || issued.roleKey}</strong>. It expires in 14 days.
              </p>
              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '1rem' }}>
                <code style={{ fontSize: '1.05rem', fontWeight: 700, letterSpacing: '0.08em', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.5rem 0.9rem' }}>{issued.code}</code>
                <button className="secondary-btn" style={{ width: 'auto', padding: '0.5rem 1rem' }} onClick={() => copyInvite({ email: issued.email, code: issued.code })}>
                  <Copy size={15} /> Copy the message
                </button>
                <a href={`${joinUrl}?code=${issued.code}`} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', color: '#0d7478', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                  <ExternalLink size={14} /> {joinUrl}?code={issued.code}
                </a>
              </div>
              <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.6rem' }}>
                <button className="secondary-btn" style={{ width: 'auto', padding: '0.55rem 1.1rem' }} onClick={() => { setIssued(null); }}>Invite another</button>
                <button className="secondary-btn" style={{ width: 'auto', padding: '0.55rem 1.1rem' }} onClick={() => { setShowInvite(false); setIssued(null); }}>Done</button>
              </div>
            </div>
          ) : (
            <form onSubmit={createInvitation} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', maxWidth: '44rem' }}>
              <Field label="Email address" hint="They must sign up with exactly this address — the code only admits the person it names.">
                <input type="email" className="pricing-select" placeholder="name@company.com" required value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} />
              </Field>
              <Field label="Job" hint="The invitation carries the role, so nothing has to be set after they arrive.">
                <select className="pricing-select" value={inviteForm.roleKey} onChange={(e) => setInviteForm({ ...inviteForm, roleKey: e.target.value })}>
                  {roleOptions.filter((r) => r.key !== 'super_admin' || isPlatformAdmin).map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
                </select>
              </Field>
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '0.6rem' }}>
                <button type="submit" className="primary-btn" style={{ width: 'auto', padding: '0.6rem 1.4rem', background: '#0d7478' }} disabled={saving}>
                  {saving ? 'Creating…' : 'Create invitation'}
                </button>
                <button type="button" className="secondary-btn" style={{ width: 'auto', padding: '0.6rem 1.2rem' }} onClick={() => setShowInvite(false)}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}

      <table className="admin-table">
        <thead>
          <tr>
            <th>Person</th>
            <th>Job</th>
            <th>What they reach</th>
            <th>Cost price</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rosterMissing ? (
            <tr>
              <td colSpan="6" className="text-center" style={{ padding: '3rem', color: '#64748b' }}>
                <UsersIcon size={48} style={{ marginBottom: '1rem', opacity: 0.4 }} />
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.4rem' }}>User administration is not on this database yet</h3>
                <p style={{ maxWidth: '480px', margin: '0 auto', fontSize: '0.85rem' }}>
                  Applying migration <code>{MIGRATION}</code> creates the role catalogue, the access functions and this roster. Everyone keeps the access they have today until then.
                </p>
              </td>
            </tr>
          ) : loading ? (
            <tr><td colSpan="6" className="text-center" style={{ padding: '3rem' }}>Loading the team…</td></tr>
          ) : members.length === 0 ? (
            <tr>
              <td colSpan="6" className="text-center" style={{ padding: '3rem', color: '#64748b' }}>
                <UsersIcon size={48} style={{ marginBottom: '1rem', opacity: 0.4 }} />
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.4rem' }}>Only this account is in the company</h3>
                <p style={{ maxWidth: '440px', margin: '0 auto', fontSize: '0.85rem' }}>
                  Nobody else has accepted an invitation yet, so the team list is empty.
                </p>
              </td>
            </tr>
          ) : members.map((member) => {
            const access = accessOf(member, roleRows);
            const platform = member.is_super_admin === true || member.user_role === 'super_admin';
            const isSelf = member.user_id === userId;
            const disabled = member.is_active === false;
            /* Nobody edits their own platform row and a company never edits one
               at all, so the flag can only be undone by a different platform
               account. Everything else on the row stays open to the platform. */
            const locked = platform && !(isPlatformAdmin && !isSelf);
            const held = MODULES.filter((module) => access.modules[module.id].level !== 'none');
            const exceptions = hasOverrides(member.access_overrides);
            return (
              <tr key={member.user_id} style={disabled ? { opacity: 0.6 } : undefined}>
                <td>
                  <div className="company-cell">
                    <div>
                      <span className="company-name">{nameOf(member)}{isSelf && <span style={{ fontWeight: 500, color: '#64748b' }}> · you</span>}</span>
                      <span className="company-id" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                        {member.email ? <><Mail size={12} /> {member.email}</> : 'No email on the auth account'}
                      </span>
                    </div>
                  </div>
                </td>
                <td style={{ maxWidth: '230px' }}>
                  {locked ? (
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#7c3aed' }}>Platform Admin</span>
                  ) : mayWrite && !isSelf ? (
                    <select
                      className="pricing-select"
                      value={member.user_role}
                      onChange={(e) => changeRole(member, e.target.value)}
                      style={{ maxWidth: '200px' }}
                    >
                      {roleOptions.filter((r) => isPlatformAdmin || r.key !== 'super_admin').map((r) => (
                        <option key={r.key} value={r.key}>{r.name}</option>
                      ))}
                    </select>
                  ) : (
                    <div>
                      <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1e293b' }}>{member.role_name || access.role?.name || member.user_role}</span>
                      {isSelf && <small style={{ display: 'block', color: '#94a3b8', fontSize: '0.75rem' }}>Another Admin changes your own role.</small>}
                      {!mayWrite && !isSelf && <small style={{ display: 'block', color: '#94a3b8', fontSize: '0.75rem' }}>View only for your job.</small>}
                    </div>
                  )}
                </td>
                <td style={{ maxWidth: '280px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.82rem', color: '#475569' }}>
                    <span>{platform ? 'Everything, in every company' : `${held.length} of ${MODULES.length} modules`}</span>
                    {!platform && (
                      <small style={{ color: '#94a3b8' }}>
                        {held.slice(0, 5).map((module) => module.label).join(', ')}
                        {held.length > 5 ? ` +${held.length - 5} more` : ''}
                        {held.length === 0 ? 'nothing yet' : ''}
                      </small>
                    )}
                    {exceptions && (
                      <span style={{ alignSelf: 'flex-start', fontSize: '0.7rem', fontWeight: 700, color: '#b45309', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '999px', padding: '0.1rem 0.5rem' }}>
                        has exceptions
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  {platform || canSeeCosts(access)
                    ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: '#0d7478', fontSize: '0.85rem', fontWeight: 600 }}><Check size={15} /> Shown</span>
                    : <span style={{ color: '#64748b', fontSize: '0.85rem' }}>hidden</span>}
                </td>
                <td>
                  {locked ? (
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Platform</span>
                  ) : disabled ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', fontWeight: 700, color: '#991b1b', textTransform: 'uppercase', letterSpacing: '0.04em' }}><ShieldOff size={13} /> Disabled</span>
                  ) : (
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#047857', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Active</span>
                  )}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    {mayWrite && !locked && (
                      <button className="secondary-btn" style={{ width: 'auto', padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => openAccess(member)}>
                        <SlidersHorizontal size={14} /> Access
                      </button>
                    )}
                    {mayWrite && !locked && !isSelf && (
                      <button
                        className="secondary-btn"
                        style={{ width: 'auto', padding: '0.4rem 0.8rem', fontSize: '0.8rem', color: disabled ? '#0d7478' : '#991b1b' }}
                        onClick={() => toggleActive(member)}
                      >
                        {disabled ? <><Shield size={14} /> Reinstate</> : <><ShieldOff size={14} /> Disable</>}
                      </button>
                    )}
                    {!member.joined_at ? null : (
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8', alignSelf: 'center' }}>joined {dateLabel(member.joined_at)}</span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {!rosterMissing && invitations.length > 0 && (
        <section style={{ marginTop: '2.5rem' }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1e293b', margin: '0 0 0.75rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <Clock size={18} color="#0d7478" /> Waiting to be accepted
          </h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Job they would arrive as</th>
                <th>Code</th>
                <th>Sent</th>
                <th>Expires</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => (
                <tr key={inv.id}>
                  <td><span className="company-name">{inv.email}</span></td>
                  <td>{roleOptions.find((r) => r.key === inv.role)?.name || (inv.role ? inv.role : 'not recorded on this database yet')}</td>
                  <td><code style={{ fontSize: '0.8rem', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '0.15rem 0.45rem' }}>{inv.code}</code></td>
                  <td style={{ fontSize: '0.82rem', color: '#64748b' }}>{dateLabel(inv.created_at)}</td>
                  <td style={{ fontSize: '0.82rem', color: '#64748b' }}>{inv.expires_at ? dateLabel(inv.expires_at) : 'never'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button className="secondary-btn" style={{ width: 'auto', padding: '0.4rem 0.8rem', fontSize: '0.8rem' }} onClick={() => copyInvite(inv)}>
                        <Copy size={14} /> Copy
                      </button>
                      {mayWrite && (
                        <button className="secondary-btn" style={{ width: 'auto', padding: '0.4rem 0.8rem', fontSize: '0.8rem', color: '#991b1b' }} onClick={() => revokeInvitation(inv)}>
                          Withdraw
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {accessFor && draft && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setAccessFor(null); setDraft(null); } }}>
          <div className="modal-content" style={{ maxWidth: '760px', width: '94%', maxHeight: '88vh' }}>
            <div className="modal-header">
              <h2>Access for {nameOf(accessFor)}</h2>
              <button className="close-btn" onClick={() => { setAccessFor(null); setDraft(null); }}><X size={20} /></button>
            </div>
            <p style={{ color: '#64748b', fontSize: '0.87rem', marginTop: 0 }}>
              Defaults come from the <strong>{baseAccess.role?.name || accessFor.user_role}</strong> job description. Changing a line here puts an exception on this person alone — it can grant more than the job does, or take it away.
            </p>

            <div style={{ overflowY: 'auto', maxHeight: '46vh', border: '1px solid #e2e8f0', borderRadius: '10px', marginBottom: '1rem' }}>
              {MODULES.map((module, index) => {
                const level = draft.modules[module.id];
                const fromRole = baseAccess.modules[module.id].level;
                const isException = level !== fromRole;
                return (
                  <div
                    key={module.id}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', padding: '0.65rem 0.9rem', borderBottom: index < MODULES.length - 1 ? '1px solid #f1f5f9' : 'none', background: isException ? '#fffbeb' : 'transparent' }}
                  >
                    <div>
                      <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#1e293b' }}>
                        {module.label}
                        {isException && <span style={{ marginLeft: '0.4rem', fontSize: '0.7rem', fontWeight: 700, color: '#b45309' }}>exception</span>}
                      </div>
                      <div style={{ fontSize: '0.77rem', color: '#64748b' }}>{module.summary} · by role: {levelLabel(fromRole)}</div>
                    </div>
                    <select
                      className="pricing-select"
                      style={{ width: '140px' }}
                      value={level}
                      onChange={(e) => setDraft({ ...draft, modules: { ...draft.modules, [module.id]: e.target.value } })}
                    >
                      {ACCESS_LEVELS.map((l) => <option key={l} value={l}>{levelLabel(l)}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>

            {FLAGS.map((flag) => (
              <label key={flag.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', fontSize: '0.85rem', color: '#334155', marginBottom: '1rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  style={{ marginTop: '0.2rem' }}
                  checked={draft.flags[flag.id] === true}
                  onChange={(e) => setDraft({ ...draft, flags: { ...draft.flags, [flag.id]: e.target.checked } })}
                />
                <span>
                  <strong>{flag.label}</strong> — {flag.summary}
                </span>
              </label>
            ))}

            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
              <button className="primary-btn" style={{ width: 'auto', padding: '0.6rem 1.4rem', background: '#0d7478' }} onClick={saveAccess} disabled={saving}>
                {saving ? 'Saving…' : 'Save access'}
              </button>
              {hasOverrides(accessFor.access_overrides) && (
                <button className="secondary-btn" style={{ width: 'auto', padding: '0.6rem 1.2rem' }} onClick={clearExceptions} disabled={saving}>
                  Clear all exceptions
                </button>
              )}
              <button className="secondary-btn" style={{ width: 'auto', padding: '0.6rem 1.2rem' }} onClick={() => { setAccessFor(null); setDraft(null); }} disabled={saving}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog && <ConfirmDialog {...confirmDialog} />}
    </div>
  );
};

export default Users;
