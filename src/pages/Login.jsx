import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Mail, Lock, Building2, User, Phone, Check, ArrowLeft, Ticket } from 'lucide-react';
import fullLogo from '../assets/full_logo.png';
import { useToast } from '../context/ToastContext';

export const Login = () => {
  const [view, setView] = useState('login');
  const [regStep, setRegStep] = useState('choice');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [fullName, setFullName] = useState('');
  const [companyPhone, setCompanyPhone] = useState('');
  const [invitationCode, setInvitationCode] = useState('');
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate('/dashboard');
    });
  }, [navigate]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      showToast('Welcome back!', 'success');
      navigate('/dashboard');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterWithInvitation = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      // 1. Verify invitation code
      const { data: invitation, error: invError } = await supabase
        .from('invitations')
        .select('*')
        .eq('code', invitationCode)
        .eq('status', 'pending')
        .single();

      if (invError || !invitation) {
        throw new Error('Invalid or expired invitation code.');
      }

      // 2. Sign up user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } }
      });
      if (authError) throw authError;

      // 3. Register company
      const { data: rpcData, error: rpcError } = await supabase.rpc('register_new_company', {
        company_name: companyName,
        company_phone: companyPhone,
        user_full_name: fullName
      });
      if (rpcError) throw rpcError;

      // 4. Update invitation status
      await supabase.rpc('redeem_invitation', { inv_code: invitationCode });

      showToast('Registration successful!', 'success');
      setView('login');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterCompany = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } }
      });
      if (authError) throw authError;

      const { data: rpcData, error: rpcError } = await supabase.rpc('register_new_company', {
        company_name: companyName,
        company_phone: companyPhone,
        user_full_name: fullName
      });
      if (rpcError) throw rpcError;

      showToast('Account created!', 'success');
      setView('login');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-left">
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <img src={fullLogo} alt="torbuilder" style={{ height: '80px', width: 'auto', marginBottom: '1rem' }} />
          <p style={{ color: '#64748b' }}>Your all-in-one tour planning solution</p>
        </div>

        <div className="view-switcher">
          <button className={`switch-btn ${view === 'login' ? 'active' : ''}`} onClick={() => { setView('login'); setRegStep('choice'); }}>Login</button>
          <button className={`switch-btn ${view === 'register' ? 'active' : ''}`} onClick={() => setView('register')}>Register</button>
          <div className={`switch-indicator ${view}`} />
        </div>

        <div className="auth-divider" />

        {view === 'login' ? (
          <form onSubmit={handleLogin} className="auth-form">
            <div className="form-group">
              <label>Email Address</label>
              <div className="input-with-icon"><Mail size={18} /><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
            </div>
            <div className="form-group">
              <label>Password</label>
              <div className="input-with-icon"><Lock size={18} /><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
            </div>
            <button type="submit" className="primary-btn" disabled={loading}>{loading ? '...' : 'Sign In'}</button>
          </form>
        ) : (
          regStep === 'choice' ? (
            <div className="auth-form" style={{ textAlign: 'center' }}>
              <p style={{ marginBottom: '1.5rem' }}>Are you a new Tour Operator, or have you been invited to join a team?</p>
              <button className="primary-btn" style={{ marginBottom: '1rem' }} onClick={() => setRegStep('company')}>Register a New Company</button>
              <button className="primary-btn" onClick={() => setRegStep('invitation')}>I Have an Invitation</button>
            </div>
          ) : regStep === 'invitation' ? (
            <form onSubmit={handleRegisterWithInvitation} className="auth-form">
              <div className="form-group">
                <label>Invitation Code</label>
                <div className="input-with-icon"><Ticket size={18} /><input type="text" placeholder="Enter your 8-digit code" value={invitationCode} onChange={(e) => setInvitationCode(e.target.value.toUpperCase())} required /></div>
              </div>
              <div className="form-group"><label>Company Name</label><div className="input-with-icon"><Building2 size={18} /><input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} required /></div></div>
              <div className="form-group"><label>Full Name</label><div className="input-with-icon"><User size={18} /><input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required /></div></div>
              <div className="form-group"><label>Email Address</label><div className="input-with-icon"><Mail size={18} /><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div></div>
              <div className="form-group"><label>Password</label><div className="input-with-icon"><Lock size={18} /><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div></div>
              <button type="submit" className="primary-btn" disabled={loading}>{loading ? '...' : 'Register & Join'}</button>
              <button type="button" onClick={() => setRegStep('choice')} style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', background: 'none', color: '#64748b', cursor: 'pointer', margin: '0 auto' }}><ArrowLeft size={16} /> Back</button>
            </form>
          ) : (
            <form onSubmit={handleRegisterCompany} className="auth-form">
              <div className="form-group"><label>Company Name</label><div className="input-with-icon"><Building2 size={18} /><input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} required /></div></div>
              <div className="form-group"><label>Full Name</label><div className="input-with-icon"><User size={18} /><input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required /></div></div>
              <div className="form-group"><label>Email Address</label><div className="input-with-icon"><Mail size={18} /><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div></div>
              <div className="form-group"><label>Password</label><div className="input-with-icon"><Lock size={18} /><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div></div>
              <button type="submit" className="primary-btn" disabled={loading}>{loading ? '...' : 'Register Company'}</button>
              <button type="button" onClick={() => setRegStep('choice')} style={{ display: 'flex', alignItems: 'center', gap: '8px', border: 'none', background: 'none', color: '#64748b', cursor: 'pointer', margin: '0 auto' }}><ArrowLeft size={16} /> Back</button>
            </form>
          )
        )}
      </div>

      <div className="login-right">
        <div className="marketing-content">
          <h1>Plan tours with ease</h1>
          <p>Create custom itineraries, manage services, and delight your clients.</p>
          <ul className="marketing-features">
            <li><div className="check-round"><Check size={18} /></div> Drag & Drop Builder</li>
            <li><div className="check-round"><Check size={18} /></div> Dynamic Pricing</li>
            <li><div className="check-round"><Check size={18} /></div> Custom Packages</li>
          </ul>
        </div>
      </div>
    </div>
  );
};
