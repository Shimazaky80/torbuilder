import { useContext, useState } from 'react';
import { X, KeyRound, Mail } from 'lucide-react';
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

  return (
    <div
      className="modal-overlay"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose?.(); }}
    >
      <form className="modal-content" style={{ maxWidth: '480px' }} onSubmit={handleSubmit}>
        <div className="modal-header">
          <h2>{isSelf ? 'Account credentials' : mode === 'password' ? 'Reset password' : 'Change email address'}</h2>
          <button type="button" className="close-btn" onClick={onClose} disabled={saving} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <p style={{ color: '#64748b', fontSize: '0.87rem', marginTop: 0, marginBottom: '1.25rem' }}>
          {isSelf
            ? 'Change your password and/or your sign-in email. Leave a field blank to keep it as it is.'
            : `Set a new sign-in detail for ${target}. The change takes effect immediately.`}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {withPassword && (
            <>
              <label className="form-group" style={{ margin: 0 }}>
                <span>New password{isSelf ? ' (optional)' : ''}</span>
                <div className="input-with-icon">
                  <KeyRound size={18} />
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={saving}
                  />
                </div>
              </label>
              {password && (
                <label className="form-group" style={{ margin: 0 }}>
                  <span>Confirm new password</span>
                  <div className="input-with-icon">
                    <KeyRound size={18} />
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      disabled={saving}
                    />
                  </div>
                </label>
              )}
              <small style={{ color: '#64748b' }}>Use at least {MIN_PASSWORD_LENGTH} characters.</small>
            </>
          )}

          {withEmail && (
            <label className="form-group" style={{ margin: 0 }}>
              <span>New email address{isSelf ? ' (optional)' : ''}</span>
              <div className="input-with-icon">
                <Mail size={18} />
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={saving}
                />
              </div>
              {isSelf && <small style={{ color: '#64748b' }}>A confirmation link may be required before a new email takes effect.</small>}
            </label>
          )}
        </div>

        <div className="form-actions">
          <button type="button" className="secondary-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary-btn"
            style={{ flex: 1, background: '#0d7478', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save credentials'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CredentialsDialog;
