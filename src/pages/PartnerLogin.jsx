import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Building2, LockKeyhole, Mail } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';

export const PartnerLogin = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user?.id) {
        const { data: partner } = await supabase
          .from('partner_portal_users')
          .select('user_id')
          .eq('user_id', session.user.id)
          .eq('is_active', true)
          .maybeSingle();
        if (partner?.user_id) {
          navigate('/partner', { replace: true });
        }
      }
    });
  }, [navigate]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      // Verify partner portal user record
      const { data: partner, error: partnerErr } = await supabase
        .from('partner_portal_users')
        .select('user_id')
        .eq('user_id', data.user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (partnerErr || !partner?.user_id) {
        showToast('Your account is authenticated, but no active partner access was found.', 'error');
        await supabase.auth.signOut();
        return;
      }

      showToast('Welcome to the Partner Portal!', 'success');
      navigate('/partner', { replace: true });
    } catch (err) {
      const msg = err.message || '';
      if (/invalid login credentials/i.test(msg)) {
        showToast('Invalid login credentials. Ensure you are using a registered partner email & password (or accept an invitation link first).', 'error');
      } else {
        showToast(msg || 'Could not sign into Partner Portal', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-left" style={{ maxWidth: '480px' }}>
        <div style={{ marginBottom: '2rem' }}>
          <Building2 size={28} color="#0d7478" />
          <h1 style={{ margin: '0.6rem 0 0.35rem', color: '#0d7478' }}>Partner Portal Login</h1>
          <p style={{ color: '#53666b', lineHeight: 1.55, margin: 0 }}>
            Sign in with your partner credentials to view tariffs, build quotations, and request bookings.
          </p>
        </div>
        <form onSubmit={handleLogin} className="auth-form">
          <label className="form-group">
            <span>Partner Email Address</span>
            <div className="input-with-icon">
              <Mail size={18} />
              <input
                type="email"
                autoComplete="email"
                placeholder="your.email@agency.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </label>
          <label className="form-group">
            <span>Password</span>
            <div className="input-with-icon">
              <LockKeyhole size={18} />
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </label>
          <button className="primary-btn" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in to Partner Portal'}
          </button>
        </form>
        <div style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.88rem', color: '#64748b' }}>
          Need tour operator login? <Link to="/login" style={{ color: '#0d7478', fontWeight: 600 }}>Tour Operator Login</Link>
        </div>
      </section>
    </main>
  );
};
