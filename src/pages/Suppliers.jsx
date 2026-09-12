import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { useCurrencies } from '../hooks/useCurrencies';
import { 
  Building2, 
  Search, 
  Plus, 
  Edit3, 
  Trash2, 
  X, 
  Mail, 
  Phone, 
  Globe, 
  MapPin, 
  User, 
  Package,
  CheckCircle2,
  XCircle,
  Filter,
  CreditCard,
  ChevronDown
} from 'lucide-react';

export const Suppliers = () => {
  const [suppliers, setSuppliers] = useState([]);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  
  const [showInlineForm, setShowInlineForm] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);

  const { showToast } = useToast();
  const navigate = useNavigate();
  const { currencies } = useCurrencies();

  // Unique sorted country list derived from the full currencies table
  const countryOptions = currencies.length > 0
    ? [...new Set(currencies.map(c => c.country).filter(Boolean))].sort()
    : ['South Africa', 'Tanzania', 'Kenya', 'Namibia', 'Botswana', 'United States', 'United Kingdom'];

  // Comprehensive Form State matching the design & screenshot
  const [form, setForm] = useState({
    name: '',
    category: 'Accommodation',
    contactPerson: '',
    email: '',
    phone: '',
    website: '',
    address: '',
    country: 'South Africa',
    provinceState: '',
    city: '',
    bankName: '',
    accountHolderName: '',
    bankAccountNumber: '',
    branchCode: '',
    swiftCode: '',
    is_active: true
  });

  const categories = [
    'All',
    'Accommodation',
    'Transportation',
    'Meals & Dining',
    'Activities & Excursions',
    'Entrance Fees & Tickets',
    'Guiding Services',
    'Optional Add-Ons'
  ];

  useEffect(() => {
    fetchSuppliers();
  }, []);

  const fetchSuppliers = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('*, company_id')
        .eq('id', user.id)
        .single();

      setUserProfile(profile);

      if (!profile?.company_id) {
        setSuppliers([]);
        return;
      }

      const { data, error } = await supabase
        .from('suppliers')
        .select('*')
        .eq('company_id', profile.company_id)
        .order('name', { ascending: true });

      if (error) throw error;
      setSuppliers(data || []);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAddForm = () => {
    setEditingSupplier(null);
    setForm({
      name: '',
      category: 'Accommodation',
      contactPerson: '',
      email: '',
      phone: '',
      website: '',
      address: '',
      country: 'South Africa',
      provinceState: '',
      city: '',
      bankName: '',
      accountHolderName: '',
      bankAccountNumber: '',
      branchCode: '',
      swiftCode: '',
      is_active: true
    });
    setShowInlineForm(true);
  };

  const handleOpenEditForm = (supplier) => {
    setEditingSupplier(supplier);
    setForm({
      name: supplier.name || '',
      category: supplier.category || 'Accommodation',
      contactPerson: supplier.contact_person || '',
      email: supplier.email || '',
      phone: supplier.phone || '',
      website: supplier.website || '',
      address: supplier.address || supplier.physical_address || '',
      country: supplier.country || 'South Africa',
      provinceState: supplier.province_state || '',
      city: supplier.city || supplier.city_location || '',
      bankName: supplier.bank_name || '',
      accountHolderName: supplier.account_holder_name || '',
      bankAccountNumber: supplier.bank_account_number || '',
      branchCode: supplier.branch_code || '',
      swiftCode: supplier.swift_code || '',
      is_active: supplier.is_active ?? true
    });
    setShowInlineForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      showToast('Supplier Name is required', 'warning');
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('id', user.id)
        .single();

      if (!profile?.company_id) {
        showToast('No active company found for your user profile', 'error');
        return;
      }

      const payload = {
        company_id: profile.company_id,
        name: form.name,
        category: form.category,
        contact_person: form.contactPerson,
        email: form.email,
        phone: form.phone,
        website: form.website,
        address: form.address,
        physical_address: form.address,
        country: form.country,
        province_state: form.provinceState,
        city: form.city,
        city_location: form.city || form.provinceState,
        bank_name: form.bankName,
        account_holder_name: form.accountHolderName,
        bank_account_number: form.bankAccountNumber,
        branch_code: form.branchCode,
        swift_code: form.swiftCode,
        is_active: form.is_active
      };

      if (editingSupplier) {
        const { error } = await supabase
          .from('suppliers')
          .update(payload)
          .eq('id', editingSupplier.id);

        if (error) throw error;
        showToast(`Supplier "${form.name}" updated successfully!`, 'success');
      } else {
        const { error } = await supabase
          .from('suppliers')
          .insert([payload]);

        if (error) throw error;
        showToast(`Supplier "${form.name}" added successfully!`, 'success');
      }

      setShowInlineForm(false);
      setEditingSupplier(null);
      fetchSuppliers();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleDelete = async (supplierId) => {
    if (!window.confirm('Are you sure you want to delete this supplier? All associated library items will also be removed.')) return;
    try {
      const { error } = await supabase
        .from('suppliers')
        .delete()
        .eq('id', supplierId);

      if (error) throw error;
      setSuppliers(prev => prev.filter(s => s.id !== supplierId));
      showToast('Supplier deleted', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const filteredSuppliers = suppliers.filter(s => {
    const matchesSearch = 
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.city && s.city.toLowerCase().includes(search.toLowerCase())) ||
      (s.city_location && s.city_location.toLowerCase().includes(search.toLowerCase())) ||
      (s.contact_person && s.contact_person.toLowerCase().includes(search.toLowerCase()));
    
    const matchesCategory = categoryFilter === 'All' || s.category === categoryFilter;

    return matchesSearch && matchesCategory;
  });

  return (
    <div className="super-admin-page" style={{ paddingBottom: '4rem' }}>
      <header className="page-header" style={{ marginBottom: '1.5rem' }}>
        <div className="header-title">
          <Building2 className="header-icon" />
          <div>
            <h1>Suppliers Directory</h1>
            <p>Manage accredited partners, service providers, location and banking records</p>
          </div>
        </div>
      </header>

      {/* EXPANSIVE INLINE SUPPLIER FORM BLOCK (No Modals!) */}
      {showInlineForm && (
        <div style={{
          background: '#fff',
          borderRadius: '16px',
          padding: '2rem',
          border: '1px solid #cbd5e1',
          boxShadow: '0 10px 25px -5px rgba(0,0,0,0.05)',
          marginBottom: '2.5rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Building2 size={22} color="#0d7478" /> {editingSupplier ? `Edit Supplier: ${editingSupplier.name}` : 'Add New Supplier'}
            </h2>
            <button 
              onClick={() => { setShowInlineForm(false); setEditingSupplier(null); }} 
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
            >
              <X size={24} />
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
              
              {/* Basic Information */}
              <div style={{ background: '#f8fafc', padding: '1.25rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#334155', marginBottom: '1rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.35rem' }}>
                  Basic Information
                </h4>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                        Supplier Name *
                      </label>
                      <input 
                        type="text" 
                        className="pricing-select"
                        placeholder="e.g., Safari Lodge Group"
                        required
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                        Primary Category
                      </label>
                      <select 
                        className="pricing-select"
                        value={form.category}
                        onChange={(e) => setForm({ ...form, category: e.target.value })}
                      >
                        {categories.filter(c => c !== 'All').map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                      Contact Person
                    </label>
                    <input 
                      type="text" 
                      className="pricing-select"
                      placeholder="e.g., John Doe"
                      value={form.contactPerson}
                      onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                        Email
                      </label>
                      <input 
                        type="email" 
                        className="pricing-select"
                        placeholder="supplier@example.com"
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                        Phone
                      </label>
                      <input 
                        type="text" 
                        className="pricing-select"
                        placeholder="+27 123 456 789"
                        value={form.phone}
                        onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      />
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                      Website
                    </label>
                    <input 
                      type="text" 
                      className="pricing-select"
                      placeholder="https://www.example.com"
                      value={form.website}
                      onChange={(e) => setForm({ ...form, website: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              {/* Location */}
              <div style={{ background: '#f8fafc', padding: '1.25rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#334155', marginBottom: '1rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.35rem' }}>
                  Location
                </h4>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                      Address
                    </label>
                    <input 
                      type="text" 
                      className="pricing-select"
                      placeholder="123 Main Street"
                      value={form.address}
                      onChange={(e) => setForm({ ...form, address: e.target.value })}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                        Country
                      </label>
                      <select 
                        className="pricing-select"
                        value={form.country}
                        onChange={(e) => setForm({ ...form, country: e.target.value })}
                      >
                        {countryOptions.map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                        Province/State
                      </label>
                      <input 
                        type="text" 
                        className="pricing-select"
                        placeholder="Western Cape"
                        value={form.provinceState}
                        onChange={(e) => setForm({ ...form, provinceState: e.target.value })}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                        City
                      </label>
                      <input 
                        type="text" 
                        className="pricing-select"
                        placeholder="Cape Town"
                        value={form.city}
                        onChange={(e) => setForm({ ...form, city: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Banking Details */}
              <div style={{ background: '#f8fafc', padding: '1.25rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#334155', marginBottom: '1rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.35rem' }}>
                  Banking Details
                </h4>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                        Bank Name
                      </label>
                      <input 
                        type="text" 
                        className="pricing-select"
                        placeholder="Standard Bank"
                        value={form.bankName}
                        onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                        Account Holder Name
                      </label>
                      <input 
                        type="text" 
                        className="pricing-select"
                        placeholder="Full name"
                        value={form.accountHolderName}
                        onChange={(e) => setForm({ ...form, accountHolderName: e.target.value })}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                        Bank Account Number
                      </label>
                      <input 
                        type="text" 
                        className="pricing-select"
                        placeholder="123456789"
                        value={form.bankAccountNumber}
                        onChange={(e) => setForm({ ...form, bankAccountNumber: e.target.value })}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                        Bank/Branch Code
                      </label>
                      <input 
                        type="text" 
                        className="pricing-select"
                        placeholder="051001"
                        value={form.branchCode}
                        onChange={(e) => setForm({ ...form, branchCode: e.target.value })}
                      />
                    </div>
                  </div>

                  <div style={{ maxWidth: '450px' }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                      SWIFT/BIC/IBAN Code
                    </label>
                    <input 
                      type="text" 
                      className="pricing-select"
                      placeholder="SBZA ZA JJ"
                      value={form.swiftCode}
                      onChange={(e) => setForm({ ...form, swiftCode: e.target.value })}
                    />
                  </div>
                </div>
              </div>

            </div>

            {/* Form Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.75rem' }}>
              <button 
                type="button" 
                className="secondary-btn" 
                style={{ flex: '0 0 auto', padding: '0.625rem 1.5rem' }}
                onClick={() => { setShowInlineForm(false); setEditingSupplier(null); }}
              >
                Cancel
              </button>
              <button type="submit" className="primary-btn" style={{ background: '#0d7478', width: 'auto', padding: '0.625rem 1.5rem' }}>
                {editingSupplier ? 'Save Changes' : 'Create Supplier'}
              </button>
            </div>

          </form>

        </div>
      )}

      {/* Table Actions Header */}
      <div className="admin-table-container">
        <div className="table-header-actions">
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flex: 1 }}>
            <div className="search-box">
              <Search size={18} />
              <input 
                type="text" 
                placeholder="Search by supplier name, location, contact..." 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            
            {/* Category Filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Filter size={16} color="#64748b" />
              <select 
                className="pricing-select"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                style={{ height: '42px', margin: 0 }}
              >
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="action-buttons">
            <button 
              className="primary-btn" 
              style={{ width: 'auto', padding: '0.625rem 1.25rem', background: '#0d7478' }} 
              onClick={handleOpenAddForm}
            >
              <Plus size={18} /> Add New Supplier
            </button>
          </div>
        </div>

        {/* Suppliers Table */}
        <table className="admin-table">
          <thead>
            <tr>
              <th>Supplier Name</th>
              <th>Category</th>
              <th>Location</th>
              <th>Contact Details</th>
              <th>Banking Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="6" className="text-center" style={{ padding: '3rem' }}>Loading suppliers...</td></tr>
            ) : filteredSuppliers.length === 0 ? (
              <tr>
                <td colSpan="6" className="text-center" style={{ padding: '3rem', color: '#64748b' }}>
                  <Building2 size={48} style={{ marginBottom: '1rem', opacity: 0.4 }} />
                  <h3>No Suppliers Found</h3>
                  <p>Click "Add New Supplier" above to create supplier records.</p>
                </td>
              </tr>
            ) : filteredSuppliers.map((supplier) => (
              <tr key={supplier.id}>
                <td>
                  <div className="company-cell">
                    <span className="company-name">{supplier.name}</span>
                    {supplier.contact_person && (
                      <span className="company-id" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <User size={12} /> {supplier.contact_person}
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  <span className="status-badge active" style={{ background: '#f1f5f9', color: '#334155', border: '1px solid #e2e8f0' }}>
                    {supplier.category || 'General'}
                  </span>
                </td>
                <td>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', color: '#475569', fontSize: '0.85rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <MapPin size={14} color="#863bff" />
                      <span>{supplier.city || supplier.city_location || 'N/A'}, {supplier.country || 'South Africa'}</span>
                    </div>
                    {supplier.address && <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{supplier.address}</span>}
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.85rem', color: '#64748b' }}>
                    {supplier.email && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <Mail size={12} /> {supplier.email}
                      </div>
                    )}
                    {supplier.phone && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <Phone size={12} /> {supplier.phone}
                      </div>
                    )}
                    {!supplier.email && !supplier.phone && <span>No contact info</span>}
                  </div>
                </td>
                <td>
                  {supplier.bank_name ? (
                    <span className="status-badge approved" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                      <CreditCard size={12} /> {supplier.bank_name}
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Pending Bank Details</span>
                  )}
                </td>
                <td>
                  <div className="action-buttons">
                    <button 
                      className="action-btn" 
                      onClick={() => navigate('/library-items', { state: { supplierId: supplier.id } })}
                      title="View & Add Library Items"
                      style={{ color: '#863bff', borderColor: '#e9d8fd' }}
                    >
                      <Package size={16} /> Library Items
                    </button>
                    <button 
                      className="action-btn" 
                      onClick={() => handleOpenEditForm(supplier)} 
                      title="Edit Supplier Details"
                    >
                      <Edit3 size={16} />
                    </button>
                    <button 
                      className="action-btn delete" 
                      onClick={() => handleDelete(supplier.id)} 
                      title="Delete Supplier"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
