export const Dashboard = () => {
  return (
    <div className="dashboard-container">
      <header className="module-header" style={{ marginBottom: '2.5rem' }}>
        <h2 style={{ fontSize: '2.5rem', fontWeight: '800', color: '#1e293b', marginBottom: '0.5rem' }}>Dashboard</h2>
        <p style={{ color: '#64748b', fontSize: '1.1rem' }}>Welcome to your multi-tenant torbuilder control panel.</p>
      </header>
      
      <div className="stats-grid">
        <StatCard title="Active Itineraries" value="12" icon="📅" />
        <StatCard title="Total Clients" value="48" icon="👥" />
        <StatCard title="Monthly Revenue" value="$45,200" icon="💰" />
        <StatCard title="Pending Approvals" value="3" icon="⏳" />
      </div>

      <div style={{ marginTop: '3rem', padding: '2rem', background: '#f8fafc', borderRadius: '1rem', border: '1px dashed #cbd5e1', textAlign: 'center' }}>
        <p style={{ color: '#64748b' }}>Quick Actions and Recent Activity will appear here.</p>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, icon }) => (
  <div style={{ 
    padding: '1.25rem 1.5rem', 
    backgroundColor: 'white', 
    borderRadius: '1rem', 
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
    border: '1px solid #e2e8f0',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    transition: 'transform 0.2s',
    cursor: 'pointer'
  }}>
    <span style={{ fontSize: '1.5rem' }}>{icon}</span>
    <span style={{ color: '#64748b', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</span>
    <span style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0d7478' }}>{value}</span>
  </div>
);
