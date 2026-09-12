import { useLocation, useNavigate } from 'react-router-dom';
import { Map, ArrowLeft, Check } from 'lucide-react';

export const ItineraryBuilder = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const data = location.state || null;

  return (
    <div className="super-admin-page" style={{ paddingBottom: '4rem' }}>
      <header className="page-header" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
        <div className="header-title">
          <Map className="header-icon" />
          <div>
            <h1>Itinerary Builder</h1>
            <p>Build the tour day plan for this itinerary</p>
          </div>
        </div>
        <button
          className="secondary-btn"
          style={{ flex: '0 0 auto', padding: '0.625rem 1.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
          onClick={() => navigate('/itineraries')}
        >
          <ArrowLeft size={18} /> Back to Client &amp; Tour
        </button>
      </header>

      {data ? (
        <div style={{
          background: '#fff',
          borderRadius: '16px',
          padding: '2rem',
          border: '1px solid #cbd5e1',
          boxShadow: '0 10px 25px -5px rgba(0,0,0,0.05)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: '#0f766e' }}>
            <Check size={18} />
            <span style={{ fontWeight: 700 }}>Itinerary created — ready to build</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div>
              <h2 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#1e293b', marginBottom: '0.25rem', display: 'inline-flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                {data.itineraryName}
                {data.referenceNumber && (
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0d7478', fontFamily: 'monospace', background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: '8px', padding: '0.2rem 0.6rem' }}>
                    {data.referenceNumber}
                  </span>
                )}
              </h2>
              <p style={{ color: '#64748b', fontSize: '0.9rem', margin: 0 }}>
                Client &amp; Tour details captured successfully.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1rem 1.25rem' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>Client</div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: '#1e293b' }}>{data.client?.name || '—'}</div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{data.client?.client_type === 'Travel Agency' ? 'Travel Agency' : 'Direct'}</div>
              </div>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1rem 1.25rem' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>Travel Dates</div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: '#1e293b' }}>{data.travelStart} → {data.travelEnd}</div>
              </div>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1rem 1.25rem' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>Travellers</div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: '#1e293b' }}>
                  {data.travellers?.length || 0} <span style={{ color: '#64748b', fontWeight: 500, fontSize: '0.85rem' }}>({data.numAdults} adults / {data.numChildren} children)</span>
                </div>
              </div>
            </div>

            {data.agencyRef && (
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '0.9rem 1.25rem', fontSize: '0.85rem', color: '#1e40af' }}>
                <strong>Agency Reference:</strong> {data.agencyRef}
              </div>
            )}

            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1.25rem' }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#334155', marginBottom: '0.75rem' }}>Traveller List</h3>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Name</th>
                    <th>Surname</th>
                    <th>Age</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.travellers || []).map((t, i) => (
                    <tr key={i}>
                      <td style={{ color: '#94a3b8', fontWeight: 700 }}>{i + 1}</td>
                      <td>{t.name}</td>
                      <td>{t.surname}</td>
                      <td>{t.age || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{
            marginTop: '2rem',
            background: '#f0fdfa',
            border: '1px dashed #5eead4',
            borderRadius: '12px',
            padding: '1.25rem',
            color: '#0f766e',
            fontSize: '0.9rem'
          }}>
            <strong>Next up:</strong> the itinerary builder (Section 2) — day planning, adding library items, and pricing will be built here.
          </div>
        </div>
      ) : (
        <div style={{
          background: '#fff',
          borderRadius: '16px',
          padding: '3rem',
          border: '1px solid #cbd5e1',
          boxShadow: '0 10px 25px -5px rgba(0,0,0,0.05)',
          textAlign: 'center',
          color: '#64748b'
        }}>
          <Map size={48} style={{ marginBottom: '1rem', opacity: 0.4 }} />
          <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.4rem' }}>No itinerary data</h3>
          <p>Complete the Client &amp; Tour form first, then click "Create Itinerary".</p>
        </div>
      )}
    </div>
  );
}

export default ItineraryBuilder;