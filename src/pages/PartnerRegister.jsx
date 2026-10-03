import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, LockKeyhole, Mail, UserRound } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';

export const PartnerRegister = () => {
  const [params] = useSearchParams();
  const inviteCode = params.get('invite') || '';
  const [invitation, setInvitation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('register');
  const { showToast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    let live = true;
    const load = async () => {
      if (!inviteCode) {
        setInvitation(null);
        setLoading(false);
        return;
      }
      const { data, error } = await supabase.rpc('get_partner_invitation_info', { p_invite_code: inviteCode });
      const info = Array.isArray(data) ? data[0] : data;
      if (live) {
        setInvitation(error ? null : info || null);
        if (info?.email) setEmail(info.email);
        setLoading(false);
      }
    };
    load();
    return () => { live = false; };
  }, [inviteCode]);

  const acceptForCurrentUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { error } = await supabase.rpc('accept_partner_invitation', { p_invite_code: inviteCode });
    if (error) throw error;
    showToast('Partner portal access is ready', 'success');
    navigate('/partner', { replace: true });
    return true;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!invitation || !inviteCode) return;
    setBusy(true);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await acceptForCurrentUser();
        return;
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name.trim() },
          emailRedirectTo: `${window.location.origin}/partner-register?invite=${encodeURIComponent(inviteCode)}`
        }
      });
      if (error) throw error;
      if (data.session) {
        await acceptForCurrentUser();
      } else {
        const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
        if (!signInErr && signInData?.session) {
          await acceptForCurrentUser();
        } else {
          showToast('Account registered. Please enter your password and click "Sign in and accept" to activate partner access.', 'info');
          setMode('login');
        }
      }
    } catch (error) {
      const msg = error.message || '';
      if (/already registered as a tenant user/i.test(msg)) {
        showToast('This email is already registered as a Tour Operator tenant account. Please use a separate partner email address for agency access.', 'error');
      } else {
        showToast(msg || 'Could not activate partner access', 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="login-page"><div className="login-left">Checking invitation...</div></div>;
  if (!invitation) return <div className="login-page"><div className="login-left"><h1>Invitation unavailable</h1><p>This invitation has expired, been used, or the link is incomplete.</p><Link to="/partner/login">Go to Partner Login</Link></div></div>;

  return (
    <main className="login-page">
      <section className="login-left" style={{ maxWidth: '500px' }}>
        <div style={{ marginBottom: '2rem' }}>
          <Building2 size={25} color="#0d7478" />
          <h1 style={{ margin: '0.6rem 0 0.35rem' }}>{mode === 'register' ? 'Join partner portal' : 'Accept partner invitation'}</h1>
          <p style={{ color: '#53666b', lineHeight: 1.55, margin: 0 }}>
            <strong>{invitation.tenant_name || 'Tour Operator'}</strong> has invited <strong>{invitation.email}</strong> as {invitation.role === 'partner_admin' ? 'partner admin' : 'team member'} for <strong>{invitation.partner_name}</strong>.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="auth-form">
          {mode === 'register' && <label className="form-group"><span>Your name</span><div className="input-with-icon"><UserRound size={18} /><input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required /></div></label>}
          <label className="form-group"><span>Email</span><div className="input-with-icon"><Mail size={18} /><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required readOnly /></div></label>
          <label className="form-group"><span>Password</span><div className="input-with-icon"><LockKeyhole size={18} /><input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></div></label>
          <button className="primary-btn" disabled={busy}>{busy ? 'Please wait...' : mode === 'register' ? 'Create partner account' : 'Sign in and accept'}</button>
        </form>
        <button type="button" className="secondary-btn" style={{ marginTop: '1rem' }} onClick={() => setMode((current) => current === 'register' ? 'login' : 'register')}>
          {mode === 'register' ? 'Already have an account? Sign in' : 'New to the portal? Create an account'}
        </button>
      </section>
    </main>
  );
};
