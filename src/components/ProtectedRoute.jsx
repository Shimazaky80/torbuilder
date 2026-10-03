import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export const ProtectedRoute = ({ children, accountType = 'tenant' }) => {
  const [session, setSession] = useState(null);
  const [accountTypeForSession, setAccountTypeForSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [verificationFailed, setVerificationFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let latestCheck = 0;

    const verifyAuth = async (currentSession) => {
      const checkId = ++latestCheck;
      if (!currentSession?.user?.id) {
        if (!cancelled && checkId === latestCheck) {
          setSession(null);
          setAccountTypeForSession(null);
          setVerificationFailed(false);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      try {
        const userId = currentSession.user.id;
        // Tenant authentication is independent of company/profile provisioning.
        // Platform owners need to enter the app before they can onboard tenants.
        if (accountType === 'tenant') {
          if (!cancelled && checkId === latestCheck) {
            setSession(currentSession);
            setAccountTypeForSession('tenant');
            setVerificationFailed(false);
            setLoading(false);
          }
          return;
        }

        let resolvedType = null;
        if (accountType === 'partner') {
          const { data: partner, error } = await supabase
            .from('partner_portal_users')
            .select('user_id')
            .eq('user_id', userId)
            .eq('is_active', true)
            .maybeSingle();
          if (error) throw error;
          if (partner?.user_id) resolvedType = 'partner';
        }

        if (!cancelled && checkId === latestCheck) {
          setSession(currentSession);
          setAccountTypeForSession(resolvedType);
          setVerificationFailed(false);
          setLoading(false);
        }
      } catch (error) {
        // Avoid redirecting between login pages based on an incomplete role lookup.
        console.error('Unable to verify account access:', error);
        if (!cancelled && checkId === latestCheck) {
          setSession(currentSession);
          setAccountTypeForSession(null);
          setVerificationFailed(true);
          setLoading(false);
        }
      }
    };

    supabase.auth.getSession().then(({ data: { session: currentSession } }) => verifyAuth(currentSession));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      // Supabase auth callbacks run while its internal lock is held. Defer database
      // queries until after the callback returns to avoid deadlocks and stale checks.
      setTimeout(() => verifyAuth(currentSession), 0);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>Loading...</div>;
  }

  if (!session) {
    return <Navigate to={accountType === 'partner' ? '/partner/login' : '/login'} replace />;
  }

  if (verificationFailed) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '24px', textAlign: 'center' }}>
        <p>We couldn’t verify your account access. Check your connection and try again.</p>
        <button type="button" onClick={() => window.location.reload()}>Try again</button>
      </div>
    );
  }

  if (accountTypeForSession === accountType) return children;

  return <Navigate to={accountType === 'partner' ? '/partner/login' : '/login'} replace />;
};
