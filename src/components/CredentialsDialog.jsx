import { useContext, useState } from 'react';
import { X, KeyRound, Mail, Info } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { SessionContext } from '../hooks/useSession';
import { useToast } from '../context/ToastContext';
import { changeUserEmail, resetUserPassword } from '../lib/adminCredentials';

/* One dialog covers both ways credentials get changed: a person editing their
   own login (password and/or email through Supabase Auth) and an Admin editing
   somebody else's (one field at a time through the Edge Function). */
const MIN_PASSWORD_LENGTH = 8;
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const CredentialsDialog = ({ open, mode = 'self', user = null, onClose, onSaved }) => {
  const { showToast } = useToast();
  /* Read the context directly: the dialog can also be opened away from the
     SessionProvider, where useSession() would throw. */
  const session = useContext(SessionContext);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [email, setEmail] = useState(mode === 'email' ? (user?.email || '') : '');
  const [saving, setSaving] = useState(false);

  /* Callers give the dialog a key that changes when it opens or switches
     target, so a fresh form is mounted instead of resetting state in an effect. */
  if (!open) return null;

  const isSelf = mode === 'self';
  const withPassword = isSelf || mode === 'password';
  const withEmail = isSelf || mode === 'email';
  const target = user?.email || 'this user';
  const passwordOnly = !isSelf && mode === 'password';

  const title = isSelf
    ? 'Change your account credentials'
    : passwordOnly
      ? `Reset password for ${target}`
      : `Change email for ${target}`;
  const intro = isSelf
    ? 'Update the details you use to sign in. Leave a field blank to keep that detail unchanged.'
    : passwordOnly
      ? `Choose a new password for ${target}. They can sign in with it immediately; you do not need their current password.`
      : `Replace the sign-in email address for ${target}. They will use the new address at their next login.`;
  const saveLabel = isSelf ? 'Save changes' : passwordOnly ? 'Update password' : 'Update email address';
  const passwordHelp = isSelf
    ? `Choose a new sign-in password of at least ${MIN_PASSWORD_LENGTH} characters. Leave it blank to keep your current password.`
    : `Enter the new sign-in password for ${target} (at least ${MIN_PASSWORD_LENGTH} characters). Share it with them securely.`;
  const emailHelp = isSelf
    ? 'Enter the new address you want to sign in with. A confirmation link may be required before it takes effect.'
    : `Enter the new address ${target} should use to sign in. The change takes effect immediately.`;

  const validate = () => {
    if (withPassword && password) {
      if (password.length < MIN_PASSWORD_LENGTH) {
        showToast(`Use at least ${MIN_PASSWORD_LENGTH} characters for the new password.`, 'warning');
        return false;
      }
      if (password !== confirmPassword) {
        showToast('The passwords do not match.', 'warning');
        return false;
      }
    }
    if (withEmail && email.trim() && !validEmail(email)) {
      showToast('Enter a valid email address.', 'warning');
      return false;
    }
    if (isSelf && !password && !email.trim()) {
      showToast('Enter a new password, a new email address, or both.', 'warning');
      return false;
    }
    if (!isSelf && withPassword && !password) {
      showToast('Enter a new password.', 'warning');
      return false;
    }
    if (!isSelf && withEmail && !email.trim()) {
      showToast('Enter a new email address.', 'warning');
      return false;
    }
    return true;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (saving || !validate()) return;
    setSaving(true);
    try {
      const changed = [];
      if (isSelf) {
        if (password) {
          const { error } = await supabase.auth.updateUser({ password });
          if (error) throw error;
          changed.push('password');
        }
        if (email.trim()) {
          const { error } = await supabase.auth.updateUser({ email: email.trim() });
          if (error) throw error;
          changed.push('email address');
          showToast('Check your inbox — a confirmation link may be required before the new email takes effect.', 'info', 'Email update started');
        }
      } else if (mode === 'password') {
        await resetUserPassword(user?.user_id, password);
        changed.push('password');
      } else if (mode === 'email') {
        await changeUserEmail(user?.user_id, email.trim());
        changed.push('email address');
      }
      showToast(`${isSelf ? 'Your' : `${target}’s`} ${changed.join(' and ')} ${changed.length === 1 ? 'was' : 'were'} updated.`, 'success', 'Credentials updated');
      if (isSelf && session?.refresh) await session.refresh();
      if (onSaved) await onSaved();
      onClose?.();
    } catch (error) {
      showToast(error?.message || 'The credentials could not be updated.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const fieldLabelStyle = {
    display: 'block',
    fontSize: '0.8125rem',
    fontWeight: 600,
    color: '#334155',
    marginBottom: '0.375rem',
    lineHeight: 1.3,
  };
  const inputWrapStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.625rem',
    padding: '0 0.75rem',
    height: '2.75rem',
    background: '#fff',
    border: '1px solid #cbd5e1',
    borderRadius: '0.5rem',
    color: '#64748b',
  };
  const inputStyle = {
    border: 'none',
    background: 'transparent',
    width: '100%',
    outline: 'none',
    fontSize: '0.9375rem',
    color: '#0f172a',
    lineHeight: 1.4,
  };
  const helpStyle = {
    display: 'block',
    marginTop: '0.375rem',
    fontSize: '0.75rem',
    color: '#64748b',
    lineHeight: 1.45,
  };
  const sectionTitleStyle = {
    fontSize: '0.6875rem',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: '#64748b',
    margin: 0,
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose?.(); }}
    >
      <form
        className="modal-content"
        style={{ maxWidth: '520px', padding: '1.75rem' }}
        onSubmit={handleSubmit}
        aria-labelledby="credentials-dialog-title"
      >
        <div className="modal-header" style={{ marginBottom: '1rem', alignItems: 'flex-start' }}>
          <div style={{ paddingRight: '1rem' }}>
            <h2 id="credentials-dialog-title" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0f172a', margin: 0, lineHeight: 1.3 }}>
              {title}
            </h2>
            <p
              id="credentials-intro"
              style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', color: '#475569', fontSize: '0.8125rem', lineHeight: 1.5, margin: '0.5rem 0 0' }}
            >
              <Info size={15} style={{ flexShrink: 0, marginTop: '0.125rem', color: '#0d7478' }} />
              <span>{intro}</span>
            </p>
          </div>
          <button type="button" className="close-btn" onClick={onClose} disabled={saving} aria-label="Close" style={{ marginTop: '-0.125rem' }}>
            <X size={20} />
          </button>
        </div>

        {!isSelf && (
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '0.625rem 0.75rem', fontSize: '0.8125rem', color: '#475569', marginBottom: '1.25rem' }}>
            Current sign-in email: <strong style={{ color: '#0f172a', fontWeight: 600 }}>{target}</strong>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {withPassword && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {isSelf && withEmail && <p style={sectionTitleStyle}>Password</p>}
              <div>
                <label htmlFor="credentials-new-password" style={fieldLabelStyle}>
                  New password{isSelf ? <span style={{ fontWeight: 500, color: '#64748b' }}> (optional)</span> : ''}
                </label>
                <div className="credential-input" style={inputWrapStyle}>
                  <KeyRound size={17} aria-hidden="true" />
                  <input
                    id="credentials-new-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                    minLength={MIN_PASSWORD_LENGTH}
                    required={!isSelf}
                    autoFocus={withPassword}
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      if (!event.target.value) setConfirmPassword('');
                    }}
                    disabled={saving}
                    aria-describedby="new-password-help"
                    style={inputStyle}
                  />
                </div>
                <small id="new-password-help" style={helpStyle}>{passwordHelp}</small>
              </div>
              {password && (
                <div>
                  <label htmlFor="credentials-confirm-password" style={fieldLabelStyle}>
                    Confirm new password
                  </label>
                  <div className="credential-input" style={inputWrapStyle}>
                    <KeyRound size={17} aria-hidden="true" />
                    <input
                      id="credentials-confirm-password"
                      type="password"
                      autoComplete="new-password"
                      placeholder="Re-enter the new password"
                      required
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      disabled={saving}
                      style={inputStyle}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {isSelf && withPassword && withEmail && (
            <div style={{ height: 1, background: '#e2e8f0' }} aria-hidden="true" />
          )}

          {withEmail && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {isSelf && withPassword && <p style={sectionTitleStyle}>Sign-in email</p>}
              <div>
                <label htmlFor="credentials-new-email" style={fieldLabelStyle}>
                  New email address{isSelf ? <span style={{ fontWeight: 500, color: '#64748b' }}> (optional)</span> : ''}
                </label>
                <div className="credential-input" style={inputWrapStyle}>
                  <Mail size={17} aria-hidden="true" />
                  <input
                    id="credentials-new-email"
                    type="email"
                    autoComplete="email"
                    placeholder="name@company.com"
                    required={!isSelf}
                    autoFocus={!withPassword && withEmail}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={saving}
                    aria-describedby="new-email-help"
                    style={inputStyle}
                  />
                </div>
                <small id="new-email-help" style={helpStyle}>{emailHelp}</small>
              </div>
            </div>
          )}
        </div>

        <div className="form-actions" style={{ marginTop: '1.5rem', gap: '0.75rem' }}>
          <button type="button" className="secondary-btn" onClick={onClose} disabled={saving} style={{ flex: '0 0 auto', minWidth: '6.5rem' }}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary-btn"
            style={{ flex: 1, background: '#0d7478', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0.75rem 1rem', fontSize: '0.9375rem' }}
            disabled={saving}
          >
            {saving ? 'Saving…' : saveLabel}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CredentialsDialog;
