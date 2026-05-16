import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { 
  Building2, 
  Users, 
  ShieldCheck, 
  Search, 
  Check, 
  X, 
  AlertCircle, 
  Mail, 
  Plus, 
  Trash2, 
  Key, 
  DollarSign, 
  TrendingUp, 
  Activity,
  CreditCard,
  ExternalLink,
  Copy,
  Clock
} from 'lucide-react';
import { useToast } from '../context/ToastContext';

export const SuperAdmin = () => {
  const [activeTab, setActiveTab] = useState('companies');
  const [companies, setCompanies] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const { showToast } = useToast();

  // Form states
  const [inviteEmail, setInviteEmail] = useState('');
  const [registerForm, setRegisterForm] = useState({
    name: '',
    adminName: '',
    adminEmail: '',
    password: '',
    pricing: 'Basic'
  });

  useEffect(() => {
    fetchData();

    // Set up Realtime subscription
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'companies' },
        () => {
          fetchData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeTab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch stats
      const { data: statsData } = await supabase.rpc('get_platform_stats');
      setStats(statsData);

      if (activeTab === 'companies') {
        // Fetch companies with profile details
        const { data: companiesData, error } = await supabase
          .from('companies')
          .select(`
            *,
            profiles:profiles(first_name, last_name, id)
          `)
          .order('created_at', { ascending: false });

        if (error) throw error;
        setCompanies(companiesData);
      } else if (activeTab === 'invitations') {
        const { data: invData, error } = await supabase
          .from('invitations')
          .select('*')
          .order('created_at', { ascending: false });
        if (error) throw error;
        setInvitations(invData);
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (companyId, newStatus) => {
    try {
      const { error } = await supabase
        .from('companies')
        .update({ status: newStatus })
        .eq('id', companyId);

      if (error) throw error;
      setCompanies(prev => prev.map(c => c.id === companyId ? { ...c, status: newStatus } : c));
      showToast(`Company ${newStatus} successfully`, 'success');
      
      // Refresh stats as pending approvals might change
      const { data: statsData } = await supabase.rpc('get_platform_stats');
      setStats(statsData);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleUpdatePricing = async (companyId, pricing) => {
    try {
      const { error } = await supabase
        .from('companies')
        .update({ pricing_plan: pricing })
        .eq('id', companyId);

      if (error) throw error;
      setCompanies(prev => prev.map(c => c.id === companyId ? { ...c, pricing_plan: pricing } : c));
      showToast('Pricing updated', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleUpdatePayment = async (companyId, status) => {
    try {
      const { error } = await supabase
        .from('companies')
        .update({ payment_status: status })
        .eq('id', companyId);

      if (error) throw error;
      setCompanies(prev => prev.map(c => c.id === companyId ? { ...c, payment_status: status } : c));
      showToast('Payment status updated', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleDeleteCompany = async (companyId) => {
    if (!window.confirm('Are you sure? This will delete all company data and users.')) return;
    try {
      const { error } = await supabase.rpc('admin_delete_company', { target_company_id: companyId });
      if (error) throw error;
      setCompanies(prev => prev.filter(c => c.id !== companyId));
      showToast('Company deleted', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    try {
      const code = Math.random().toString(36).substring(2, 10).toUpperCase();
      const { error } = await supabase
        .from('invitations')
        .insert([{ email: inviteEmail, code, status: 'pending' }]);

      if (error) throw error;

      showToast(`Invitation created! Code: ${code}`, 'success');
      // For now we manually copy to clipboard
      navigator.clipboard.writeText(code);
      showToast('Code copied to clipboard', 'info');
      
      setShowInviteModal(false);
      setInviteEmail('');
      if (activeTab === 'invitations') fetchData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    try {
      // In a real app, you'd use a more complex auth flow here.
      // For now we'll simulate it as we need service role to create users with passwords from frontend.
      showToast(`Manual registration for ${registerForm.name} requires backend API.`, 'warning');
      setShowRegisterModal(false);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const filteredCompanies = companies.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.id.includes(search)
  );

  return (
    <div className="super-admin-page">
      <header className="page-header">
        <div className="header-title">
          <ShieldCheck className="header-icon" />
          <div>
            <h1>Super Admin Command Centre</h1>
            <p>Platform-wide management and vital statistics</p>
          </div>
        </div>
      </header>

      {/* Stats Vitals Section */}
      <div className="admin-stats-grid">
        <div className="stat-card">
          <Building2 size={24} />
          <div className="stat-info">
            <span className="stat-value">{stats?.total_companies || 0}</span>
            <span className="stat-label">Total Companies</span>
          </div>
        </div>
        <div className="stat-card">
          <Users size={24} />
          <div className="stat-info">
            <span className="stat-value">{stats?.total_users || 0}</span>
            <span className="stat-label">Total Users</span>
          </div>
        </div>
        <div className="stat-card">
          <TrendingUp size={24} />
          <div className="stat-info">
            <span className="stat-value">${stats?.total_revenue_est || 0}</span>
            <span className="stat-label">Est. Monthly Revenue</span>
          </div>
        </div>
        <div className="stat-card">
          <Activity size={24} />
          <div className="stat-info">
            <span className="stat-value">{stats?.pending_approvals || 0}</span>
            <span className="stat-label">Pending Approvals</span>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="admin-tabs">
        <button 
          className={`tab-btn ${activeTab === 'companies' ? 'active' : ''}`}
          onClick={() => setActiveTab('companies')}
        >
          <Building2 size={18} /> Companies
        </button>
        <button 
          className={`tab-btn ${activeTab === 'invitations' ? 'active' : ''}`}
          onClick={() => setActiveTab('invitations')}
        >
          <Mail size={18} /> Invitations
        </button>
        <button 
          className={`tab-btn ${activeTab === 'vitals' ? 'active' : ''}`}
          onClick={() => setActiveTab('vitals')}
        >
          <Activity size={18} /> Platform Vitals
        </button>
      </div>

      <div className="admin-table-container">
        <div className="table-header-actions">
          <div className="search-box">
            <Search size={18} />
            <input 
              type="text" 
              placeholder="Search..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="action-buttons">
            <button className="primary-btn" style={{ width: 'auto', padding: '0.625rem 1.25rem' }} onClick={() => setShowInviteModal(true)}>
              <Plus size={18} /> New Invitation
            </button>
            <button className="secondary-btn" onClick={() => setShowRegisterModal(true)}>
              <Plus size={18} /> Direct Register
            </button>
          </div>
        </div>

        {activeTab === 'companies' && (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Admin Details</th>
                <th>Status</th>
                <th>Pricing Plan</th>
                <th>Payment Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="6" className="text-center" style={{ padding: '3rem' }}>Loading data...</td></tr>
              ) : filteredCompanies.length === 0 ? (
                <tr><td colSpan="6" className="text-center" style={{ padding: '3rem' }}>No companies found.</td></tr>
              ) : filteredCompanies.map((company) => (
                <tr key={company.id}>
                  <td>
                    <div className="company-cell">
                      <span className="company-name">{company.name}</span>
                      <span className="company-id">{company.id}</span>
                    </div>
                  </td>
                  <td>
                    <div className="admin-info">
                      <span className="admin-name">
                        {company.profiles?.[0]?.first_name} {company.profiles?.[0]?.last_name}
                      </span>
                      <span className="admin-email">Contact: {company.telephone || 'N/A'}</span>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <span className={`status-badge ${company.status}`}>
                        {company.status}
                      </span>
                      {company.status === 'pending' && (
                        <div className="action-buttons">
                          <button className="action-btn approve" onClick={() => handleUpdateStatus(company.id, 'approved')} title="Approve">
                            <Check size={14} /> Approve
                          </button>
                          <button className="action-btn reject" onClick={() => handleUpdateStatus(company.id, 'rejected')} title="Reject">
                            <X size={14} /> Reject
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                  <td>
                    <select 
                      className="pricing-select"
                      value={company.pricing_plan || 'Basic'}
                      onChange={(e) => handleUpdatePricing(company.id, e.target.value)}
                    >
                      <option value="Basic">Basic (Free)</option>
                      <option value="Standard">Standard ($49/mo)</option>
                      <option value="Premium">Premium ($99/mo)</option>
                    </select>
                  </td>
                  <td>
                    <span className={`status-badge ${company.payment_status}`}>
                      {company.payment_status === 'paid' ? 'Paid' : company.payment_status === 'non-payment' ? 'Non-Payment' : 'Active'}
                    </span>
                    <div style={{ marginTop: '0.5rem' }}>
                      {company.payment_status === 'non-payment' ? (
                        <button className="action-btn" onClick={() => handleUpdatePayment(company.id, 'paid')} title="Re-activate">
                          <Check size={14} /> Re-activate
                        </button>
                      ) : (
                        <button className="action-btn" onClick={() => handleUpdatePayment(company.id, 'non-payment')} title="Discontinue">
                          <X size={14} /> Stop
                        </button>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="action-buttons">
                      <button className="action-btn" title="Reset Admin Password">
                        <Key size={18} />
                      </button>
                      <button className="action-btn delete" onClick={() => handleDeleteCompany(company.id)} title="Delete Company">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {activeTab === 'invitations' && (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Invitation Code</th>
                <th>Status</th>
                <th>Created At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="5" className="text-center" style={{ padding: '3rem' }}>Loading...</td></tr>
              ) : invitations.length === 0 ? (
                <tr>
                  <td colSpan="5" className="text-center" style={{ padding: '3rem', color: '#64748b' }}>
                    <Mail size={48} style={{ marginBottom: '1rem', opacity: 0.5 }} />
                    <h3>No Active Invitations</h3>
                    <p>Create invitations to bring new companies onto the platform.</p>
                  </td>
                </tr>
              ) : invitations.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.email}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <code style={{ background: '#f1f5f9', padding: '0.25rem 0.5rem', borderRadius: '4px', fontWeight: 'bold' }}>{inv.code}</code>
                      <button 
                        className="action-btn" 
                        onClick={() => {
                          navigator.clipboard.writeText(inv.code);
                          showToast('Code copied', 'info');
                        }}
                        title="Copy Code"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                  </td>
                  <td>
                    <span className={`status-badge ${inv.status}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td>{new Date(inv.created_at).toLocaleDateString()}</td>
                  <td>
                    <div className="action-buttons">
                      <button 
                        className="action-btn" 
                        onClick={() => {
                          const subject = encodeURIComponent('Your Invitation to torbuilder');
                          const body = encodeURIComponent(`Hello,\n\nYou have been invited to join torbuilder.\n\nYour registration code is: ${inv.code}\n\nPlease register at: ${window.location.origin}/login\n\nBest regards,\ntorbuilder Team`);
                          window.location.href = `mailto:${inv.email}?subject=${subject}&body=${body}`;
                        }}
                        title="Send via Email Client"
                      >
                        <Mail size={16} />
                      </button>
                      <button className="action-btn delete" onClick={async () => {
                        const { error } = await supabase.from('invitations').delete().eq('id', inv.id);
                        if (!error) fetchData();
                      }}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {activeTab === 'vitals' && (
          <div style={{ padding: '3rem' }}>
            <div className="admin-stats-grid">
              <div className="stat-card">
                <CreditCard size={24} />
                <div className="stat-info">
                  <span className="stat-value">98.5%</span>
                  <span className="stat-label">Payment Success Rate</span>
                </div>
              </div>
              <div className="stat-card">
                <Users size={24} />
                <div className="stat-info">
                  <span className="stat-value">12</span>
                  <span className="stat-label">New Users (Last 7 Days)</span>
                </div>
              </div>
              <div className="stat-card">
                <Clock size={24} />
                <div className="stat-info">
                  <span className="stat-value">1.2s</span>
                  <span className="stat-label">Avg. Response Time</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Invitation Modal */}
      {showInviteModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Invite Company</h2>
              <button className="close-btn" onClick={() => setShowInviteModal(false)}>
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleInvite} className="auth-form">
              <div className="form-group">
                <label>Company Admin Email</label>
                <div className="input-with-icon">
                  <Mail size={18} color="#94a3b8" />
                  <input 
                    type="email" 
                    placeholder="email@company.com" 
                    required 
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </div>
              </div>
              <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.5rem' }}>
                Note: A unique registration code will be generated and copied to your clipboard.
              </p>
              <div className="form-actions">
                <button type="button" className="secondary-btn" onClick={() => setShowInviteModal(false)}>Cancel</button>
                <button type="submit" className="primary-btn">Generate & Copy Code</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Registration Modal */}
      {showRegisterModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h2>Direct Registration</h2>
              <button className="close-btn" onClick={() => setShowRegisterModal(false)}>
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleRegister} className="auth-form">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label>Company Name</label>
                  <input className="pricing-select" type="text" required value={registerForm.name} onChange={(e) => setRegisterForm({...registerForm, name: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Pricing Plan</label>
                  <select className="pricing-select" value={registerForm.pricing} onChange={(e) => setRegisterForm({...registerForm, pricing: e.target.value})}>
                    <option value="Basic">Basic</option>
                    <option value="Standard">Standard</option>
                    <option value="Premium">Premium</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Admin Full Name</label>
                  <input className="pricing-select" type="text" required value={registerForm.adminName} onChange={(e) => setRegisterForm({...registerForm, adminName: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Admin Email</label>
                  <input className="pricing-select" type="email" required value={registerForm.adminEmail} onChange={(e) => setRegisterForm({...registerForm, adminEmail: e.target.value})} />
                </div>
              </div>
              <div className="form-group">
                <label>Temporary Password</label>
                <input className="pricing-select" type="password" required value={registerForm.password} onChange={(e) => setRegisterForm({...registerForm, password: e.target.value})} />
              </div>
              <div className="form-actions">
                <button type="button" className="secondary-btn" onClick={() => setShowRegisterModal(false)}>Cancel</button>
                <button type="submit" className="primary-btn">Register Company</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
