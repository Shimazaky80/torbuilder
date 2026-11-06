import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { columnExists } from '../lib/schemaColumnProbe';
import { SessionContext } from '../hooks/useSession';
import {
  platformScope,
  readStoredPlatformScope,
  setPlatformScope
} from '../lib/tenantScope';
import {
  builtInRole,
  can as holdsAccess,
  canSeeCosts as holdsCosts,
  resolveAccess
} from '../lib/rbac';

/* One place in the app knows who is signed in, what job they hold and what that
   job reaches. Before this, every page re-read profiles for its company_id and
   the only role check in the product was whether the Platform Admin menu item
   was drawn — so an account could be walked into any page by typing its address.
   Pages that need the answer take it from here instead of guessing from the URL.
   See src/lib/rbac.js for what an access level means. */

const signOutNow = async () => {
  await supabase.auth.signOut();
  window.location.assign('/login');
};

const screenShell = (title, body, name) => (
  <div style={{ display: 'flex', minHeight: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '24px', textAlign: 'center' }}>
    <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#1e293b', margin: 0 }}>{title}</h1>
    <p style={{ maxWidth: '34rem', color: '#475569', margin: 0 }}>
      {name ? `${name}, ` : ''}{body}
    </p>
    <button
      type="button"
      className="secondary-btn"
      style={{ width: 'auto', padding: '0.6rem 1.2rem', marginTop: '0.5rem' }}
      onClick={signOutNow}
    >
      Sign out
    </button>
  </div>
);

const disabledScreen = (name) => screenShell(
  'Your access has been disabled',
  'an administrator has closed this account. Nothing you saved is lost — ask them to reinstate it when you are back.',
  name
);

/* A signed-in account with no profiles row is not a person with a job that
   reads; it is a signup whose company step never ran. It gets this screen
   rather than the app, because the alternative is a fallback that hands out
   the widest access in the product to whoever registers next. */
const unprovisionedScreen = (value) => screenShell(
  'This account is not attached to a company',
  `nothing has been invited or registered under ${value.email}, so it opens no page. If you were given an invitation code, sign out and use it on the sign-in page; otherwise ask an administrator of the company you work with to invite you.`,
  value.name
);

export const SessionProvider = ({ children }) => {
  const [state, setState] = useState({
    loading: true,
    user: null,
    profile: null,
    roleRows: [],
    provisioned: true,
    companies: [],
    viewingCompany: null,
    access: resolveAccess({ roleKey: 'consultant' })
  });

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      /* Signed out is not the same as unprovisioned: this person belongs on the
         sign-in page, which ProtectedRoute sends them to. */
      setPlatformScope(null);
      setState((prev) => ({ ...prev, loading: false, user: null, profile: null, provisioned: true, companies: [], viewingCompany: null }));
      return;
    }

    /* A profile row written before 20261257 has no is_active and no
       access_overrides. Reading either without asking whether it exists rejects
       the whole select, which would leave the signed-in person looking at a
       blank app rather than their own work. */
    const [activeColumn, overridesColumn] = await Promise.all([
      columnExists('profiles', 'is_active'),
      columnExists('profiles', 'access_overrides')
    ]);
    const fields = ['id', 'first_name', 'last_name', 'user_role', 'is_super_admin', 'company_id'];
    if (activeColumn) fields.push('is_active');
    if (overridesColumn) fields.push('access_overrides');

    const { data: profile } = await supabase
      .from('profiles')
      .select(fields.join(','))
      .eq('id', user.id)
      .maybeSingle();

    /* The catalogue is nice to have. A database that has not run the migration
       yet, or a company whose read of it fails, falls back to the roles the app
       already knows — the structure is the same, so nothing is over-granted. */
    const { data: roleRows } = await supabase
      .from('roles')
      .select('key, name, description, access, flags, is_builtin, company_id, sort_order')
      .order('sort_order');

    const isPlatformAdmin = profile?.is_super_admin === true || profile?.user_role === 'super_admin';

    /* The platform console is the one account that reads more than its own
       company, so it is the only one allowed to hold a tenant scope. Anyone
       else signing in clears it, which is what stops a stale choice from
       pointing a company Admin at someone else's rows. */
    let companies = [];
    let viewingCompany = null;
    if (isPlatformAdmin) {
      const stored = readStoredPlatformScope();
      const { data } = await supabase
        .from('companies')
        .select('id, name, status')
        .order('name');
      companies = data || [];
      /* A remembered tenant that no longer exists is dropped rather than
         silently scoping every page to nothing. */
      viewingCompany = companies.some((c) => c.id === stored) ? stored : (companies[0]?.id || null);
    }
    setPlatformScope(isPlatformAdmin ? viewingCompany : null);

    /* The platform flag is only ever read from a profile row. Without one there
       is no job, no company and no flag, so the account holds nothing — see
       unprovisionedScreen. */
    const access = profile
      ? resolveAccess({
        roleKey: profile.user_role,
        overrides: profile.access_overrides || {},
        isPlatformAdmin,
        isActive: profile.is_active !== false,
        roleRows: roleRows || []
      })
      : resolveAccess({ isActive: false });

    setState({
      loading: false,
      user,
      profile: profile || null,
      roleRows: roleRows || [],
      provisioned: !!profile,
      companies,
      viewingCompany,
      access
    });
  }, []);

  useEffect(() => {
    const boot = async () => { await load(); };
    boot();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      /* Deferred for the same reason ProtectedRoute defers: Supabase holds an
         internal lock through the auth callback and a query made there waits
         forever. */
      setTimeout(() => load(), 0);
    });
    return () => subscription.unsubscribe();
  }, [load]);

  const setViewingCompany = useCallback((companyId) => {
    if (!state.access.isPlatformAdmin) return;
    setPlatformScope(companyId);
    setState((prev) => ({ ...prev, viewingCompany: platformScope() }));
  }, [state.access.isPlatformAdmin]);

  const value = useMemo(() => {
    const { access, profile, user } = state;
    const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');
    const name = fullName
      || user?.user_metadata?.full_name
      || user?.user_metadata?.name
      || user?.email?.split('@')[0]
      || '';
    return {
      loading: state.loading,
      user,
      userId: user?.id || null,
      profile,
      /* For a company account this is its own row. For the platform it is the
         tenant picked in the sidebar, which is the only way a company-less
         account can reach any of the tenant pages with data in them. */
      companyId: access.isPlatformAdmin
        ? (state.viewingCompany || profile?.company_id || null)
        : (profile?.company_id || null),
      companies: state.companies,
      viewingCompany: state.viewingCompany,
      setViewingCompany,
      name,
      email: user?.email || '',
      roleKey: access.roleKey,
      roleName: access.role?.name || builtInRole(access.roleKey)?.name || 'Consultant',
      roleDescription: access.role?.description || '',
      roleRows: state.roleRows,
      access,
      isPlatformAdmin: access.isPlatformAdmin,
      isActive: access.isActive,
      provisioned: state.provisioned,
      can: (moduleId, level = 'read') => holdsAccess(access, moduleId, level),
      canSeeCosts: holdsCosts(access),
      refresh: load
    };
  }, [state, load, setViewingCompany]);

  if (state.loading) {
    return <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>Loading...</div>;
  }
  if (state.user && !state.provisioned) {
    return unprovisionedScreen(value);
  }
  if (!state.access.isActive) {
    return disabledScreen(value.name);
  }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};
