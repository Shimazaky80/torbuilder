import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Lock, ArrowLeft, KeyRound } from 'lucide-react';
import fullLogo from '../assets/full_logo.png';
import { useToast } from '../context/ToastContext';

export const ResetPassword = () => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const { showToast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setReady(!!session);
    });
  }, []);

  const handleReset = async (e) => {
    e.preventDefault();
    if (password.length < 6) {
      showToast('Password must be at least 6 characters.', 'warning');
      return;
    }
    if (password !== confirmPassword) {
      showToast('Passwords do not match.', 'warning');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      await supabase.auth.signOut();
      showToast('You can now log in with your new password.', 'success', 'Password updated.');
      navigate('/login');
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

        <div className="auth-divider" />

        {ready ? (
          <form onSubmit={handleReset} className="auth-form">
            <div className="form-group">
              <label>New Password</label>
              <div className="input-with-icon"><Lock size={18} /><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
            </div>
            <div className="form-group">
              <label>Confirm New Password</label>
              <div className="input-with-icon"><Lock size={18} /><input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required /></div>
            </div>
            <button type="submit" className="primary-btn" disabled={loading}>{loading ? 'Resetting...' : 'Reset Password'}</button>
            <Link to="/login" style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none', color: '#0d7478', margin: '0 auto' }}><KeyRound size={16} /> Back to Login</Link>
          </form>
        ) : (
          <div className="auth-form" style={{ textAlign: 'center' }}>
            <p style={{ marginBottom: '1.5rem', color: '#64748b' }}>
              This reset link is invalid or has expired.
            </p>
            <Link to="/login" style={{ display: 'flex', alignItems: 'center', gap: '8px', textDecoration: 'none', color: '#0d7478', margin: '0 auto' }}><ArrowLeft size={16} /> Back to Login</Link>
          </div>
        )}
      </div>

      <div className="login-right">
        <div className="marketing-content">
          <h1>Plan tours with ease</h1>
          <p>Create custom itineraries, manage services, and delight your clients.</p>
        </div>
      </div>
    </div>
  );
};