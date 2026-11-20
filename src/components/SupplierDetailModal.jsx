import { X, Building2, Star, Mail, Phone, Globe, MapPin, Tag, FileText, CreditCard } from 'lucide-react';
import { starRatingOf } from '../lib/starGrading';

export default function SupplierDetailModal({ supplier, isOpen, onClose }) {
  if (!isOpen || !supplier) return null;

  const starCount = starRatingOf(supplier);
  const categories = Array.isArray(supplier.categories)
    ? supplier.categories
    : (typeof supplier.categories === 'string' ? supplier.categories.split(',').map((s) => s.trim()).filter(Boolean) : []);

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-content" style={{ maxWidth: '660px', width: '92%', borderRadius: '14px', padding: 0, overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ background: '#0d7478', color: '#fff', padding: '1.25rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            {supplier.logo_url ? (
              <img src={supplier.logo_url} alt="" style={{ width: '46px', height: '46px', objectFit: 'contain', borderRadius: '8px', background: '#fff', padding: '2px' }} />
            ) : (
              <div style={{ width: '46px', height: '46px', borderRadius: '8px', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Building2 size={24} color="#fff" />
              </div>
            )}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>{supplier.name}</h2>
                {starCount > 0 && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', background: 'rgba(255,255,255,0.25)', padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700 }}>
                    <Star size={12} fill="#fbbf24" color="#fbbf24" /> {starCount} Star
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.25rem', fontSize: '0.8rem', opacity: 0.9 }}>
                {supplier.city && <span>📍 {supplier.city}</span>}
                {supplier.country && <span>{supplier.country}</span>}
                {supplier.is_active === false && (
                  <span style={{ background: '#fee2e2', color: '#b91c1c', padding: '0.1rem 0.45rem', borderRadius: '4px', fontWeight: 700, fontSize: '0.72rem' }}>
                    Inactive
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
          {/* Categories */}
          {categories.length > 0 && (
            <div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.35rem' }}>Service Categories</div>
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                {categories.map((cat, idx) => (
                  <span key={idx} style={{ background: '#f0fdfa', border: '1px solid #99f6e4', color: '#0f766e', fontSize: '0.75rem', fontWeight: 600, padding: '0.2rem 0.6rem', borderRadius: '999px' }}>
                    {cat}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Contact Details */}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1rem' }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.88rem', fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Contact Details
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.6rem', fontSize: '0.85rem' }}>
              {supplier.contact_person && (
                <div style={{ color: '#334155' }}>
                  <span style={{ color: '#64748b', fontSize: '0.75rem', display: 'block' }}>Contact Person</span>
                  <strong>{supplier.contact_person}</strong>
                </div>
              )}
              {supplier.email && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#334155' }}>
                  <Mail size={15} color="#0d7478" />
                  <a href={`mailto:${supplier.email}`} style={{ color: '#0d7478', textDecoration: 'none', fontWeight: 500 }}>{supplier.email}</a>
                </div>
              )}
              {supplier.phone && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#334155' }}>
                  <Phone size={15} color="#0d7478" />
                  <span>Tel: {supplier.phone}</span>
                </div>
              )}
              {supplier.contact_cell && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#334155' }}>
                  <Phone size={15} color="#0d7478" />
                  <span>Cell: {supplier.contact_cell}</span>
                </div>
              )}
              {supplier.website && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#334155' }}>
                  <Globe size={15} color="#0d7478" />
                  <a href={supplier.website.startsWith('http') ? supplier.website : `https://${supplier.website}`} target="_blank" rel="noopener noreferrer" style={{ color: '#0d7478', textDecoration: 'none' }}>
                    {supplier.website}
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Location & Address */}
          {(supplier.address || supplier.city || supplier.country) && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1rem' }}>
              <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.88rem', fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Address &amp; Location
              </h3>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', color: '#334155', fontSize: '0.85rem' }}>
                <MapPin size={16} color="#0d7478" style={{ marginTop: '0.15rem', flexShrink: 0 }} />
                <div>
                  {supplier.address && <div>{supplier.address}</div>}
                  {(supplier.city || supplier.country) && (
                    <div style={{ color: '#64748b', marginTop: '0.2rem' }}>
                      {[supplier.city, supplier.country].filter(Boolean).join(', ')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Business & Payment Details */}
          {(supplier.vat_number || supplier.tax_number || supplier.payment_terms || supplier.bank_name) && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1rem', background: '#f8fafc' }}>
              <h3 style={{ margin: '0 0 0.6rem', fontSize: '0.88rem', fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Billing &amp; Banking Details
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.6rem', fontSize: '0.82rem' }}>
                {(supplier.vat_number || supplier.tax_number) && (
                  <div>
                    <span style={{ color: '#64748b' }}>VAT / Tax ID:</span> <strong>{supplier.vat_number || supplier.tax_number}</strong>
                  </div>
                )}
                {supplier.payment_terms && (
                  <div>
                    <span style={{ color: '#64748b' }}>Payment Terms:</span> <strong>{supplier.payment_terms}</strong>
                  </div>
                )}
                {supplier.bank_name && (
                  <div>
                    <span style={{ color: '#64748b' }}>Bank:</span> <strong>{supplier.bank_name}</strong>
                  </div>
                )}
                {supplier.account_number && (
                  <div>
                    <span style={{ color: '#64748b' }}>Account:</span> <strong>{supplier.account_number}</strong>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notes */}
          {supplier.notes && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1rem', background: '#fafafa' }}>
              <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.88rem', fontWeight: 700, color: '#1e293b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Notes / Special Terms
              </h3>
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#475569', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {supplier.notes}
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
