import { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';

const ConfirmDialog = ({
  title,
  message,
  detail,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
  children
}) => {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onCancel?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, busy]);

  const border = destructive ? '#fecaca' : '#e2e8f0';
  const text = destructive ? '#7f1d1d' : '#334155';
  const detailText = destructive ? '#991b1b' : '#475569';

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel?.();
      }}
    >
      <div className="modal-content" style={{ maxWidth: '480px' }}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="close-btn" onClick={onCancel} disabled={busy}>
            <X size={20} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          {message ? (
            <div
              style={{
                display: 'flex',
                gap: '0.6rem',
                alignItems: 'flex-start',
                background: destructive ? '#fef2f2' : '#f8fafc',
                border: `1px solid ${border}`,
                borderRadius: '10px',
                padding: '0.75rem 0.9rem'
              }}
            >
              {destructive && (
                <AlertTriangle size={16} color="#b91c1c" style={{ flexShrink: 0, marginTop: '2px' }} />
              )}
              <div style={{ margin: 0, color: text, fontSize: '0.88rem', lineHeight: 1.55 }}>
                {message}
                {detail ? (
                  <div style={{ marginTop: '0.4rem', color: detailText, fontWeight: 600 }}>{detail}</div>
                ) : null}
              </div>
            </div>
          ) : null}
          {children}
          <div className="form-actions" style={{ marginTop: 0 }}>
            <button type="button" className="secondary-btn" onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </button>
            <button
              type="button"
              className="primary-btn"
              style={{
                flex: 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.35rem',
                ...(destructive ? { background: '#b91c1c', borderColor: '#b91c1c' } : {})
              }}
              onClick={onConfirm}
              disabled={busy}
            >
              {busy ? 'Working...' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
