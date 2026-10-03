import { useState, useEffect, useCallback, useRef } from 'react';
import SearchableSelect from '../components/SearchableSelect';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { useListRowLimit } from '../hooks/useListRowLimit';
import { useCountries } from '../hooks/useCountries';
import ConfirmDialog from '../components/ConfirmDialog';
import { useConfirm } from '../hooks/useConfirm';
import {
  Users,
  Search,
  Plus,
  Edit3,
  Trash2,
  X,
  Mail,
  Phone,
  MapPin,
  User,
  Building2,
  Percent,
  Globe,
  ChevronDown,
  Check,
  Upload
} from 'lucide-react';

const CountrySelect = ({ value, onChange, countries, placeholder }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = open && query
    ? countries.filter(c =>
        c.toLowerCase().startsWith(query.toLowerCase()) ||
        c.toLowerCase().includes(query.toLowerCase())
      )
    : countries;

  const selectCountry = (name) => {
    onChange(name);
    setOpen(false);
    setQuery('');
  };

  return (
    <div style={{ position: 'relative' }} ref={rootRef}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          border: '1px solid #e2e8f0',
          borderRadius: '10px',
          background: '#f8fafc',
          cursor: 'text'
        }}
      >
        <input
          type="text"
          className="pricing-select"
          style={{ border: 'none', background: 'transparent', boxShadow: 'none', paddingRight: '2.2rem' }}
          placeholder={placeholder}
          value={open ? query : value}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { setOpen(true); setQuery(''); }}
          onClick={() => { if (!open) { setOpen(true); setQuery(''); } }}
        />
        <ChevronDown
          size={18}
          color="#64748b"
          style={{ position: 'absolute', right: '0.85rem', cursor: 'pointer', transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none' }}
          onClick={() => setOpen(o => !o)}
        />
      </div>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            maxHeight: '220px',
            overflowY: 'auto',
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
            zIndex: 30
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: '0.75rem 1rem', color: '#94a3b8', fontSize: '0.85rem' }}>
              No countries match "{query}"
            </div>
          ) : filtered.slice(0, 50).map(name => (
            <div
              key={name}
              onClick={() => selectCountry(name)}
              style={{
                padding: '0.55rem 1rem',
                cursor: 'pointer',
                fontSize: '0.85rem',
                color: value === name ? '#0d7478' : '#334155',
                fontWeight: value === name ? 700 : 400,
                background: value === name ? '#f0fdfa' : '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = value === name ? '#f0fdfa' : '#fff'; }}
            >
              <span>{name}</span>
              {value === name && <Check size={15} color="#0d7478" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const Clients = () => {
  const [clients, setClients] = useState([]);
  const [confirmDialog, confirm] = useConfirm();
  const countries = useCountries();
  const [salesTotals, setSalesTotals] = useState({});
  const [loading, setLoading] = useState(true);
  const [fetchingClients, setFetchingClients] = useState(false);
  const [totalClients, setTotalClients] = useState(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All'); // All | Direct | Travel Agency
  const searchTimeoutRef = useRef(null);
  const { limit: pageSize } = useListRowLimit();

  const [showInlineForm, setShowInlineForm] = useState(false);
  const [editingClient, setEditingClient] = useState(null);

  const { showToast } = useToast();

  const [form, setForm] = useState({
    name: '',
    email: '',
    clientType: 'Direct',
    country: '',
    markupPercentage: '',
    depositPercentage: '',
      isCredit: false,
      address: '',
      notes: '',
      contact_cell: '',
      contact_tel: '',
      contact_website: '',
      logo_data_url: ''
    });

  const fetchClients = useCallback(async ({ offset = 0, append = false } = {}) => {
    setFetchingClients(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setFetchingClients(false);
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('*, company_id')
        .eq('id', user.id)
        .single();

      if (!profile?.company_id) {
        setClients([]);
        setTotalClients(0);
        setFetchingClients(false);
        return;
      }

      const esc = (t) => t.replace(/[\\%_]/g, (m) => '\\' + m);
      const term = (search || '').replace(/[,()]/g, ' ').trim();
      let clientQuery = supabase
        .from('clients')
        .select('*', { count: 'exact' })
        .eq('company_id', profile.company_id);

      if (term) {
        const t = esc(term);
        clientQuery = clientQuery.or(`name.ilike.%${t}%,email.ilike.%${t}%,contact_tel.ilike.%${t}%,contact_cell.ilike.%${t}%,contact_website.ilike.%${t}%`);
      }

      const { data, count, error } = await clientQuery
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (error) throw error;
      setClients((prev) => {
        if (!append) return data || [];
        const merged = new Map([...prev.map(c => [c.id, c]), ...(data || []).map(c => [c.id, c])]);
        return Array.from(merged.values());
      });
      setTotalClients(count ?? (data || []).length);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
      setFetchingClients(false);
    }
  }, [search, showToast, pageSize]);

  const fetchSalesTotals = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_client_sales_totals');

      if (error) throw error;

      const totals = {};
      (data || []).forEach(row => {
        totals[row.client_id] = row.total_sold;
      });
      setSalesTotals(totals);
    } catch (err) {
      console.error('Failed to load client sales totals:', err.message);
    }
  }, []);

useEffect(() => {
  fetchSalesTotals();
}, [fetchSalesTotals]);

  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => fetchClients(), 350);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [search, fetchClients]);

  const switchToNewProfile = () => {
    setEditingClient(null);
    setForm({
      name: '',
      email: '',
      contact_cell: '',
      contact_tel: '',
      contact_website: '',
      clientType: 'Direct',
      country: '',
      markupPercentage: '',
      depositPercentage: '',
      address: '',
      notes: '',
      logo_data_url: ''
    });
  };

  const handleOpenAddForm = () => {
    switchToNewProfile();
    setShowInlineForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenEditForm = (client) => {
    setEditingClient(client);
    setForm({
      name: client.name || '',
      email: client.email || '',
      contact_cell: client.contact_cell || '',
      contact_tel: client.contact_tel || '',
      contact_website: client.contact_website || '',
      clientType: client.client_type || 'Direct',
      country: client.country || '',
      markupPercentage: client.markup_percentage != null ? String(client.markup_percentage) : '',
      depositPercentage: client.deposit_percentage != null ? String(client.deposit_percentage) : '',
      isCredit: !!client.is_credit,
      address: client.address || '',
      notes: client.notes || '',
      logo_data_url: client.logo_data_url || ''
    });
    setShowInlineForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const closeForm = () => {
    setShowInlineForm(false);
    setEditingClient(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const name = form.name.trim();
    if (!name) {
      showToast('Client name is required', 'warning');
      return;
    }

    const email = form.email.trim();
    if (!email) {
      showToast('Email is required', 'warning');
      return;
    }

    const markup = form.markupPercentage === '' ? 0 : parseFloat(form.markupPercentage);
    if (Number.isNaN(markup) || markup < 0) {
      showToast('Markup percentage must be a valid number', 'warning');
      return;
    }

    const deposit = form.depositPercentage === '' ? null : parseFloat(form.depositPercentage);
    if (deposit !== null && (Number.isNaN(deposit) || deposit < 0 || deposit > 100)) {
      showToast('Deposit percentage must be between 0 and 100', 'warning');
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
        name,
        email,
        client_type: form.clientType,
      country: form.country,
      markup_percentage: markup,
      deposit_percentage: deposit,
      address: form.address.trim(),
      contact_cell: (form.contact_cell || '').trim(),
      contact_tel: (form.contact_tel || '').trim(),
      contact_website: (form.contact_website || '').trim(),
      notes: form.notes.trim(),
      logo_data_url: form.logo_data_url || ''
    };

      if (editingClient) {
        const { error } = await supabase
          .from('clients')
          .update(payload)
          .eq('id', editingClient.id);

        if (error) throw error;
        showToast(`Client "${name}" updated successfully!`, 'success');
      } else {
        const { error } = await supabase
          .from('clients')
          .insert([payload]);

        if (error) throw error;
        showToast(`Client "${name}" added successfully!`, 'success');
      }

      closeForm();
      fetchClients();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleLogoFile = (file) => {
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/bmp'];
    if (!allowed.includes(file.type)) {
      showToast('Please choose a JPEG, PNG or BMP logo file', 'warning');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX = 600;
        let width = img.width;
        let height = img.height;
        if (width <= 0 || height <= 0) {
          showToast('Could not read that logo image', 'error');
          return;
        }
        const scale = Math.min(1, MAX / Math.max(width, height));
        if (scale < 1) {
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        setForm((prev) => ({ ...prev, logo_data_url: canvas.toDataURL('image/png') }));
        showToast('Logo added — remember to save your changes', 'success');
      };
      img.onerror = () => showToast('Could not read that logo image', 'error');
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const clearLogo = () => setForm((prev) => ({ ...prev, logo_data_url: '' }));

  const handleDelete = async (client) => {
    const ok = await confirm({
      title: 'Delete client?',
      message: `"${client.name}" will be permanently removed.`,
      detail: 'Saved invoices and itineraries keep a snapshot of their bill-to details.',
      confirmLabel: 'Delete client',
      destructive: true
    });
    if (!ok) return;
    try {
      const { error } = await supabase
        .from('clients')
        .delete()
        .eq('id', client.id);

      if (error) throw error;
      setClients(prev => prev.filter(c => c.id !== client.id));
      setTotalClients(prev => (prev == null ? prev : Math.max(0, prev - 1)));
      showToast('Client deleted', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const filteredClients = clients.filter(c => {
    const matchesType = typeFilter === 'All' || c.client_type === typeFilter;
    return matchesType;
  });

  const directCount = clients.filter(c => c.client_type === 'Direct').length;
  const agencyCount = clients.filter(c => c.client_type === 'Travel Agency').length;

  const filterTabs = [
    { id: 'All', label: 'All' },
    { id: 'Direct', label: 'Direct' },
    { id: 'Travel Agency', label: 'Agencies' }
  ];

  return (
    <div className="super-admin-page" style={{ paddingBottom: '4rem' }}>
      <header className="page-header" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
        <div className="header-title">
          <Users className="header-icon" />
          <div>
            <h1>Clients</h1>
            <p>Manage direct clients and travel agencies</p>
          </div>
        </div>
        <button
          className="primary-btn"
          style={{ width: 'auto', padding: '0.625rem 1.25rem', background: '#0d7478', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          onClick={handleOpenAddForm}
        >
          <Plus size={18} /> Add Client
        </button>
      </header>

      {/* Stats summary */}
      {clients.length > 0 && (
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.9rem 1.25rem', boxShadow: '0 2px 4px rgba(0,0,0,0.04)' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Clients</span>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#1e293b' }}>{totalClients ?? clients.length}</div>
          </div>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.9rem 1.25rem', boxShadow: '0 2px 4px rgba(0,0,0,0.04)' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Direct Clients</span>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0d7478' }}>{directCount}</div>
          </div>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.9rem 1.25rem', boxShadow: '0 2px 4px rgba(0,0,0,0.04)' }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Travel Agencies</span>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0d7478' }}>{agencyCount}</div>
          </div>
        </div>
      )}

      {/* EXPANSIVE INLINE CLIENT FORM */}
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
              <Users size={22} color="#0d7478" /> {editingClient ? 'Edit Client' : 'Add New Client'}
            </h2>
            <button
              onClick={closeForm}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
              title="Close form"
            >
              <X size={24} />
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Two-column fields */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                {/* Left column */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                      Name *
                    </label>
                    <input
                      type="text"
                      className="pricing-select"
                      placeholder="Client or company name"
                      required
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                      Cell #
                    </label>
                    <input
                      type="tel"
                      className="pricing-select"
                      placeholder="+27 82 555 0100"
                      value={form.contact_cell}
                      onChange={(e) => setForm({ ...form, contact_cell: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                      Tel # / Landline
                    </label>
                    <input
                      type="tel"
                      className="pricing-select"
                      placeholder="+27 21 555 0100"
                      value={form.contact_tel}
                      onChange={(e) => setForm({ ...form, contact_tel: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                      Website (optional)
                    </label>
                    <input
                      type="text"
                      className="pricing-select"
                      placeholder="https://www.example.com"
                      value={form.contact_website}
                      onChange={(e) => setForm({ ...form, contact_website: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                      Client Type
                    </label>
                    <SearchableSelect
                      className="pricing-select"
                      value={form.clientType}
                      onChange={(e) => setForm({ ...form, clientType: e.target.value })}
                    >
                      <option value="Travel Agency">Travel Agency</option>
                      <option value="Direct">Direct</option>
                    </SearchableSelect>
                  </div>
                </div>

                {/* Right column */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                      Email *
                    </label>
                    <input
                      type="email"
                      className="pricing-select"
                      placeholder="email@example.com"
                      required
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                      Country
                    </label>
                    <CountrySelect
                      value={form.country}
                      onChange={(val) => setForm({ ...form, country: val })}
                      countries={countries}
                      placeholder="e.g., USA, UK, France"
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                      Markup Percentage (%) *
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="pricing-select"
                      placeholder="e.g., 15"
                      required
                      value={form.markupPercentage}
                      onChange={(e) => setForm({ ...form, markupPercentage: e.target.value })}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                      Deposit Percentage (%)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      className="pricing-select"
                      placeholder="Leave blank for company default"
                      value={form.depositPercentage}
                      onChange={(e) => setForm({ ...form, depositPercentage: e.target.value })}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', paddingTop: '0.9rem' }}>
                    <input
                      id="client-is-credit"
                      type="checkbox"
                      checked={!!form.isCredit}
                      onChange={(e) => setForm({ ...form, isCredit: e.target.checked })}
                    />
                    <label htmlFor="client-is-credit" style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', cursor: 'pointer' }}>
                      Credit / On-account
                    </label>
                  </div>
                </div>
              </div>

              {/* Address — full width */}
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                  Address
                </label>
                <input
                  type="text"
                  className="pricing-select"
                  placeholder="Full Address"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
              </div>

              {/* Client logo — full width */}
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                  Client Logo
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <label className="secondary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                    <Upload size={16} /> {form.logo_data_url ? 'Replace logo' : 'Upload logo'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/bmp"
                      style={{ display: 'none' }}
                      onChange={(e) => { handleLogoFile(e.target.files?.[0]); e.target.value = ''; }}
                    />
                  </label>
                  {form.logo_data_url ? (
                    <>
                      <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.35rem', background: '#fff' }}>
                        <img src={form.logo_data_url} alt="Client logo preview" style={{ display: 'block', maxWidth: '140px', maxHeight: '70px', objectFit: 'contain' }} />
                      </div>
                      <button type="button" className="action-btn delete" style={{ border: '1px solid #fecaca', borderRadius: '8px' }} onClick={clearLogo} title="Remove logo">
                        <X size={16} />
                      </button>
                    </>
                  ) : (
                    <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                      Optional — shown on exported documents and invoices for this client.
                    </span>
                  )}
                </div>
              </div>

              {/* Notes — full width, expandable */}
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
                  Notes
                </label>
                <textarea
                  className="pricing-select"
                  rows={4}
                  placeholder="Additional notes about this client"
                  value={form.notes}
                  style={{ resize: 'vertical', minHeight: '80px', fontFamily: 'inherit' }}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="secondary-btn"
                  style={{ flex: '0 0 auto', padding: '0.625rem 1.5rem' }}
                  onClick={closeForm}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-btn" style={{ background: '#0d7478', width: 'auto', padding: '0.625rem 1.5rem' }}>
                  {editingClient ? 'Save Changes' : 'Add Client'}
                </button>
              </div>

            </div>
          </form>
        </div>
      )}

      {/* Table Actions Header */}
      <div className="admin-table-container">
        <div className="table-header-actions">
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flex: 1 }}>
            <div className="search-box" style={{ flex: 1, width: 'auto', maxWidth: '520px' }}>
              <Search size={18} />
              <input
                type="text"
                placeholder="Search clients by name or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Type Filter Tabs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            {filterTabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setTypeFilter(tab.id)}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  border: '1px solid ' + (typeFilter === tab.id ? '#0d7478' : '#e2e8f0'),
                  background: typeFilter === tab.id ? '#0d7478' : '#fff',
                  color: typeFilter === tab.id ? '#fff' : '#475569',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Clients Table */}
        <table className="admin-table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Type</th>
              <th>Contact</th>
              <th>Country</th>
              <th>Markup</th>
              <th>Sold (12 mo)</th>
              <th>Address / Notes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading || fetchingClients ? (
              <tr><td colSpan="7" className="text-center" style={{ padding: '3rem' }}>Loading clients...</td></tr>
            ) : clients.length === 0 && search.trim() === '' ? (
              <tr>
                <td colSpan="7" className="text-center" style={{ padding: '3rem', color: '#64748b' }}>
                  <Users size={48} style={{ marginBottom: '1rem', opacity: 0.4 }} />
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.4rem' }}>No clients yet</h3>
                  <p style={{ marginBottom: '1.25rem', maxWidth: '380px', margin: '0 auto 1.25rem' }}>
                    Create your first client to start building tailored itineraries.
                  </p>
                  <button
                    className="primary-btn"
                    style={{ width: 'auto', padding: '0.625rem 1.5rem', background: '#0d7478' }}
                    onClick={handleOpenAddForm}
                  >
                    <Plus size={18} /> Create your first client
                  </button>
                </td>
              </tr>
            ) : filteredClients.length === 0 ? (
              <tr>
                <td colSpan="7" className="text-center" style={{ padding: '3rem', color: '#64748b' }}>
                  <Search size={48} style={{ marginBottom: '1rem', opacity: 0.4 }} />
                  <h3>No clients match your search</h3>
                  <p>Try adjusting the search or filter.</p>
                </td>
              </tr>
            ) : filteredClients.map((client) => (
              <tr key={client.id}>
                <td>
                  <div className="company-cell">
                    {client.logo_data_url ? (
                      <img src={client.logo_data_url} alt="" style={{ width: '30px', height: '30px', objectFit: 'contain', borderRadius: '6px', border: '1px solid #e2e8f0', background: '#fff' }} />
                    ) : null}
                    <div>
                      <span className="company-name">{client.name}</span>
                      <span className="company-id" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <User size={12} /> Client
                      </span>
                    </div>
                  </div>
                </td>
                <td>
                  {client.client_type === 'Travel Agency' ? (
                    <span className="status-badge" style={{ background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Building2 size={12} /> Travel Agency
                    </span>
                  ) : (
                    <span className="status-badge" style={{ background: '#f0fdfa', color: '#0f766e', border: '1px solid #99f6e4', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                      <User size={12} /> Direct
                    </span>
                  )}
                </td>
                <td>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.85rem', color: '#64748b' }}>
                    {client.email && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <Mail size={12} /> {client.email}
                      </div>
                    )}
                    {client.contact_tel && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <Phone size={12} /> Tel: {client.contact_tel}
                      </div>
                    )}
                    {client.contact_cell && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <Phone size={12} /> Cell: {client.contact_cell}
                      </div>
                    )}
                    {client.contact_website && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <Globe size={12} /> {client.contact_website}
                      </div>
                    )}
                    {!client.email && !client.contact_tel && !client.contact_cell && <span>No contact info</span>}
                  </div>
                </td>
                <td>
                  {client.country ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem', color: '#475569' }}>
                      <Globe size={14} color="#863bff" /> {client.country}
                    </span>
                  ) : <span style={{ color: '#94a3b8' }}>—</span>}
                </td>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem', fontWeight: 700, color: '#b45309' }}>
                    <Percent size={12} /> {(parseFloat(client.markup_percentage) || 0)}
                    {client.markup_percentage != null && form.markupPercentage !== '' ? '%' : '%'}
                  </span>
                </td>
                <td>
                  {salesTotals[client.id] != null && Number(salesTotals[client.id]) > 0 ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem', fontWeight: 700, color: '#0d7478' }}>
                      {Number(salesTotals[client.id]).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  ) : (
                    <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>—</span>
                  )}
                </td>
                <td style={{ maxWidth: '260px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8rem', color: '#64748b' }}>
                    {client.address ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <MapPin size={12} color="#863bff" /> {client.address}
                      </span>
                    ) : <span style={{ color: '#94a3b8' }}>No address</span>}
                    {client.notes && (
                      <span style={{ color: '#94a3b8', fontStyle: 'italic', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {client.notes}
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  <div className="action-buttons">
                    <button
                      className="action-btn"
                      onClick={() => handleOpenEditForm(client)}
                      title="Edit Client"
                    >
                      <Edit3 size={16} />
                    </button>
                    <button
                      className="action-btn delete"
                      onClick={() => handleDelete(client)}
                      title="Delete Client"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {clients.length > 0 && totalClients != null && totalClients > clients.length && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem' }}>
            <button
              className="secondary-btn"
              style={{ padding: '0.6rem 1.5rem' }}
              onClick={() => fetchClients({ offset: clients.length, append: true })}
              disabled={fetchingClients}
            >
              {fetchingClients ? 'Loading...' : `Load more (${clients.length} of ${totalClients} clients)`}
            </button>
          </div>
        )}
      </div>

      {confirmDialog && <ConfirmDialog {...confirmDialog} />}
    </div>
  );
};
