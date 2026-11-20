import { X, User, Building2, Mail, Phone, Globe, MapPin, Percent, DollarSign, Calendar, FileText, CheckCircle } from 'lucide-react';

export default function ClientDetailModal({ client, isOpen, onClose }) {
  if (!isOpen || !client) return null;

  const isAgency = client.client_type === 'Travel Agency';

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-content" style={{ maxWidth: '640px', width: '92%', borderRadius: '14px', padding: 0, overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ background: '#0d7478', color: '#fff', padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            {client.logo_data_url ? (
              <img src={client.logo_data_url} alt="" style={{ width: '44px', height: '44px', objectFit: 'contain', borderRadius: '8px', background: '#fff', padding: '2px' }} />
            ) : (
              <div style={{ width: '44px', height: '44px', borderRadius: '8px', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {isAgency ? <Building2 size={24} color="#fff" /> : <User size={24} color="#fff" />}
              </div>
            )}
            <div>
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>{client.name}</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.2rem' }}>
                <span style={{ fontSize: '0.78rem', background: 'rgba(255,255,255,0.25)', padding: '0.15rem 0.55rem', borderRadius: '999px', fontWeight: 600 }}>
                  {client.client_type || 'Direct Client'}
                </span>
                {client.country && (
                  <span style={{ fontSize: '0.8rem', opacity: 0.9 }}>
                    📍 {client.country}
                  </span>
                )}
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
          {/* Key Facts Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
            <div style={{ background: '#f8fafc', padding: '0.75rem 0.9rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Markup Percentage</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#b45309', marginTop: '0.2rem' }}>
                {parseFloat(client.markup_percentage) || 0}%
              </div>
            </div>
            <div style={{ background: '#f8fafc', padding: '0.75rem 0.9rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Client Category</div>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0d7478', marginTop: '0.2rem' }}>
                {client.client_type || 'Direct'}
              </div>
            </div>
            {client.created_at && (
              <div style={{ background: '#f8fafc', padding: '0.75rem 0.9rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Client Since</div>
                <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#334155', marginTop: '0.2rem' }}>
                  {new Date(client.created_at).toLocaleDateString()}
                </div>
              </div>
            )}
          </div>

          {/* Contact Information */}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1rem' }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.88rem', fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Contact Information
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.6rem', fontSize: '0.85rem' }}>
              {client.email ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#334155' }}>
                  <Mail size={15} color="#0d7478" />
                  <a href={`mailto:${client.email}`} style={{ color: '#0d7478', textDecoration: 'none', fontWeight: 500 }}>{client.email}</a>
                </div>
              ) : <div style={{ color: '#94a3b8' }}>No email recorded</div>}

              {client.contact_tel ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#334155' }}>
                  <Phone size={15} color="#0d7478" />
                  <span>Tel: {client.contact_tel}</span>
                </div>
              ) : null}

              {client.contact_cell ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#334155' }}>
                  <Phone size={15} color="#0d7478" />
                  <span>Cell: {client.contact_cell}</span>
                </div>
              ) : null}

              {client.contact_website ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#334155' }}>
                  <Globe size={15} color="#0d7478" />
                  <a href={client.contact_website.startsWith('http') ? client.contact_website : `https://${client.contact_website}`} target="_blank" rel="noopener noreferrer" style={{ color: '#0d7478', textDecoration: 'none' }}>
                    {client.contact_website}
                  </a>
                </div>
              ) : null}
            </div>
          </div>

          {/* Address */}
          {(client.address || client.country) && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1rem' }}>
              <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.88rem', fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Address &amp; Location
              </h3>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', color: '#334155', fontSize: '0.85rem' }}>
                <MapPin size={16} color="#0d7478" style={{ marginTop: '0.15rem', flexShrink: 0 }} />
                <div>
                  {client.address && <div>{client.address}</div>}
                  {client.country && <div style={{ fontWeight: 600, color: '#0d7478', marginTop: '0.2rem' }}>{client.country}</div>}
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          {client.notes && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1rem', background: '#fafafa' }}>
              <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.88rem', fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Notes / Special Instructions
              </h3>
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#475569', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {client.notes}
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
