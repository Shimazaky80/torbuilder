import { X, User, Mail, Phone, MapPin, Building2, Percent, CheckCircle, XCircle } from 'lucide-react';
import { guideMemberName, guideUpliftPercent } from '../lib/guideRoster';

export default function GuideDetailModal({ guide, isOpen, onClose }) {
  if (!isOpen || !guide) return null;

  const name = guideMemberName(guide) || 'Unnamed Guide';
  const uplift = guideUpliftPercent(guide);
  const isRetired = guide.is_active === false;

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-content" style={{ maxWidth: '620px', width: '92%', borderRadius: '14px', padding: 0, overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ background: isRetired ? '#475569' : '#0d7478', color: '#fff', padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <div style={{ width: '46px', height: '46px', borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <User size={24} color="#fff" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>{name}</h2>
                <span style={{ fontSize: '0.75rem', background: isRetired ? '#fee2e2' : '#dcfce7', color: isRetired ? '#991b1b' : '#166534', padding: '0.15rem 0.55rem', borderRadius: '999px', fontWeight: 700 }}>
                  {isRetired ? 'Retired / Inactive' : 'Active Guide'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.25rem', fontSize: '0.8rem', opacity: 0.9 }}>
                {guide.destination_area && <span>📍 {guide.destination_area}</span>}
                {guide.city && <span>({guide.city})</span>}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', padding: '0.35rem', borderRadius: '6px' }}
            title="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.2rem', maxHeight: '75vh', overflowY: 'auto' }}>
          {/* Key Facts */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.75rem' }}>
            <div style={{ background: '#f8fafc', padding: '0.75rem 0.9rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Day Rate Uplift</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, color: uplift > 0 ? '#b45309' : '#0d7478', marginTop: '0.2rem' }}>
                {uplift > 0 ? `+${uplift}%` : 'Standard Rate'}
              </div>
            </div>
            <div style={{ background: '#f8fafc', padding: '0.75rem 0.9rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Operating Area</div>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0d7478', marginTop: '0.2rem' }}>
                {guide.destination_area || 'All destinations'}
              </div>
            </div>
            {guide.tax_number && (
              <div style={{ background: '#f8fafc', padding: '0.75rem 0.9rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Tax / ID Number</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#334155', marginTop: '0.2rem' }}>
                  {guide.tax_number}
                </div>
              </div>
            )}
          </div>

          {/* Contact Details */}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1rem' }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.88rem', fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Contact Information
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.6rem', fontSize: '0.85rem' }}>
              {guide.email ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#334155' }}>
                  <Mail size={15} color="#0d7478" />
                  <a href={`mailto:${guide.email}`} style={{ color: '#0d7478', textDecoration: 'none', fontWeight: 500 }}>{guide.email}</a>
                </div>
              ) : <div style={{ color: '#94a3b8' }}>No email recorded</div>}

              {guide.phone ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#334155' }}>
                  <Phone size={15} color="#0d7478" />
                  <span>Phone: {guide.phone}</span>
                </div>
              ) : null}

              {guide.city ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#334155' }}>
                  <MapPin size={15} color="#0d7478" />
                  <span>Base City: {guide.city}</span>
                </div>
              ) : null}
            </div>
          </div>

          {/* Supplier / Payment Association */}
          {guide.supplier_id && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1rem', background: '#f8fafc' }}>
              <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.88rem', fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Paid Through Supplier
              </h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#334155', fontSize: '0.88rem' }}>
                <Building2 size={16} color="#0d7478" />
                <span>Supplier ID: <strong>{guide.supplier_id}</strong></span>
              </div>
            </div>
          )}

          {/* Notes */}
          {guide.notes && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1rem', background: '#fafafa' }}>
              <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.88rem', fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Notes &amp; Qualifications
              </h3>
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#475569', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {guide.notes}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ borderTop: '1px solid #e2e8f0', padding: '0.9rem 1.5rem', display: 'flex', justifyContent: 'flex-end', background: '#f8fafc' }}>
          <button
            type="button"
            className="secondary-btn"
            onClick={onClose}
            style={{ padding: '0.45rem 1.25rem', fontSize: '0.85rem' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
