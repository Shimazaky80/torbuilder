import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import {
  Settings as SettingsIcon,
  Plus,
  Edit3,
  Trash2,
  X,
  Check,
  Percent,
  Star,
  Power,
  ShieldCheck,
  Search
} from 'lucide-react';

const APPLIES_TO_OPTIONS = [
  'all',
  'services',
  'accommodation',
  'transportation',
  'meals & dining',
  'activities & excursions',
  'entrance fees & tickets',
  'guiding services',
  'optional add-ons'
];

const COUNTRY_OPTIONS = [
  'South Africa',
  'Botswana',
  'Namibia',
  'Zimbabwe',
  'Mozambique',
  'Zambia',
  'Lesotho',
  'Eswatini',
  'Malawi',
  'Angola',
  'Kenya',
  'Tanzania',
  'Uganda',
  'Rwanda',
  'Ethiopia',
  'Ghana',
  'Nigeria',
  'Egypt',
  'Morocco',
  'Mauritius',
  'Seychelles',
  'Madagascar',
  'United Kingdom',
  'Ireland',
  'United States',
  'Canada',
  'Mexico',
  'Argentina',
  'Brazil',
  'Chile',
  'Colombia',
  'Peru',
  'Australia',
  'New Zealand',
  'India',
  'China',
  'Japan',
  'South Korea',
  'Singapore',
  'Thailand',
  'Indonesia',
  'Malaysia',
  'Vietnam',
  'Philippines',
  'UAE',
  'Saudi Arabia',
  'Qatar',
  'Germany',
  'France',
  'Spain',
  'Italy',
  'Netherlands',
  'Belgium',
  'Switzerland',
  'Austria',
  'Portugal',
  'Greece',
  'Sweden',
  'Norway',
  'Denmark',
  'Finland',
  'Poland',
  'Czech Republic',
  'Turkey',
  'Israel',
  'Other'
];

/* Searchable combobox for the Country field (instead of the native <select>). */
function SearchableCountryInput({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? COUNTRY_OPTIONS.filter((c) => c.toLowerCase().includes(q))
      : COUNTRY_OPTIONS;
    if (value && !COUNTRY_OPTIONS.includes(value) && (q ? value.toLowerCase().includes(q) : true)) {
      return [value, ...matches.filter((c) => c !== value)];
    }
    return matches;
  }, [query, value]);

  useEffect(() => {
    const onDoc = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) {
        if (query.trim()) onChange(query.trim());
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [query, onChange]);

  const commit = (val) => {
    onChange(val);
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <Search size={15} style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }} />
        <input
          className="sidebar-select"
          style={{ width: '100%', padding: '0.6rem 0.75rem 0.6rem 2rem', fontSize: '0.9rem' }}
          value={open ? query : value}
          placeholder="Type to search country…"
          onFocus={() => { setQuery(''); setOpen(true); }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const pick = filtered.find((c) => c.toLowerCase() === query.trim().toLowerCase()) || filtered[0];
              if (pick) commit(pick);
            }
            if (e.key === 'Escape') setOpen(false);
          }}
        />
      </div>
      {open && (
        <div style={{ position: 'absolute', zIndex: 30, top: '100%', left: 0, right: 0, marginTop: '0.25rem', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', boxShadow: '0 10px 25px rgba(0,0,0,0.12)', maxHeight: '220px', overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '0.6rem 0.75rem', color: '#94a3b8', fontSize: '0.85rem' }}>No matches — press Enter to use &quot;{query.trim()}&quot;</div>
          ) : filtered.map((c) => (
            <button
              type="button"
              key={c}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commit(c)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.5rem 0.75rem', border: 'none', background: c === value ? '#ecfdf5' : '#fff', color: '#1a202c', fontSize: '0.9rem', cursor: 'pointer', fontWeight: c === value ? 700 : 400 }}
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const emptyForm = () => ({
  name: 'Value Added Tax (VAT)',
  code: 'VAT',
  rate: '15',
  appliesTo: 'all',
  country: 'South Africa',
  isDefault: false,
  isActive: true
});

export const Settings = () => {
  const { showToast } = useToast();
  const [companyId, setCompanyId] = useState(null);
  const [taxRates, setTaxRates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm());

  const fetchCompanyId = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: profile } = await supabase
      .from('profiles')
      .select('company_id')
      .eq('id', user.id)
      .single();
    return profile?.company_id || null;
  }, []);

  const fetchTaxRates = useCallback(async (cid) => {
    if (!cid) return;
    const { data, error } = await supabase
      .from('tax_rates')
      .select('*')
      .eq('company_id', cid)
      .order('created_at', { ascending: true });
    if (error) throw error;
    setTaxRates(data || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cid = await fetchCompanyId();
        if (cancelled) return;
        setCompanyId(cid);
        await fetchTaxRates(cid);
      } catch (err) {
        if (!cancelled) showToast(err.message || 'Failed to load taxes', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchCompanyId, fetchTaxRates, showToast]);

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm());
    setModalOpen(true);
  };

  const openEdit = (t) => {
    setEditingId(t.id);
    setForm({
      name: t.name || '',
      code: t.code || 'VAT',
      rate: String(t.rate ?? 15),
      appliesTo: t.applies_to || 'all',
      country: t.country || 'South Africa',
      isDefault: !!t.is_default,
      isActive: !!t.is_active
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!companyId) {
      showToast('No active company found', 'error');
      return;
    }
    const name = form.name.trim();
    const rate = Number(form.rate);
    if (!name) {
      showToast('Tax name is required', 'warning');
      return;
    }
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      showToast('Tax rate must be between 0 and 100%', 'warning');
      return;
    }
    setSaving(true);
    try {
      const base = {
        company_id: companyId,
        name,
        code: form.code.trim() || 'VAT',
        rate,
        applies_to: form.appliesTo || 'all',
        country: form.country || 'South Africa',
        is_active: form.isActive
      };

      if (form.isDefault) {
        await supabase
          .from('tax_rates')
          .update({ is_default: false })
          .eq('company_id', companyId);
      }

      if (editingId) {
        const { error } = await supabase
          .from('tax_rates')
          .update({ ...base, is_default: form.isDefault })
          .eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('tax_rates')
          .insert([{ ...base, is_default: form.isDefault }]);
        if (error) throw error;
      }
      await fetchTaxRates(companyId);
      setModalOpen(false);
      showToast('Tax saved', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to save tax', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (t) => {
    if (t.is_default) return;
    setSaving(true);
    try {
      const { error: err1 } = await supabase
        .from('tax_rates')
        .update({ is_default: false })
        .eq('company_id', companyId);
      if (err1) throw err1;
      const { error: err2 } = await supabase
        .from('tax_rates')
        .update({ is_default: true })
        .eq('id', t.id);
      if (err2) throw err2;
      await fetchTaxRates(companyId);
      showToast(`"${t.name}" is now the default`, 'success');
    } catch (err) {
      showToast(err.message || 'Failed to set default tax', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (t) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('tax_rates')
        .update({ is_active: !t.is_active })
        .eq('id', t.id);
      if (error) throw error;
      await fetchTaxRates(companyId);
    } catch (err) {
      showToast(err.message || 'Failed to toggle tax', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (t) => {
    if (!window.confirm(`Delete "${t.name}"? Saved itineraries keep their original rate.`)) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('tax_rates')
        .delete()
        .eq('id', t.id);
      if (error) throw error;
      const remaining = taxRates.filter((x) => x.id !== t.id);
      if (t.is_default && remaining.length > 0) {
        await supabase
          .from('tax_rates')
          .update({ is_default: true })
          .eq('id', remaining[0].id);
      }
      await fetchTaxRates(companyId);
      showToast('Tax deleted', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to delete tax', 'error');
    } finally {
      setSaving(false);
    }
  };

  const fieldStyle = { width: '100%', padding: '0.6rem 0.75rem', fontSize: '0.9rem' };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.5rem', margin: 0 }}>
            <SettingsIcon size={22} color="#0d7478" /> Settings
          </h1>
          <p style={{ color: '#64748b', margin: '0.35rem 0 0', fontSize: '0.9rem' }}>
            Tenant configuration — tax rules, defaults and company settings.
          </p>
        </div>
      </div>

      <div className="admin-card" style={{ marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Percent size={18} color="#0d7478" /> Taxes
            </h2>
            <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.85rem' }}>
              Tax applied on top of each service&apos;s sell price (markup already included in sell).
              The default is 15% VAT — set your region&apos;s own tax types here.
            </p>
          </div>
          <button type="button" className="primary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }} onClick={openAdd}>
            <Plus size={16} /> Add Tax
          </button>
        </div>

        {loading ? (
          <div style={{ padding: '2rem 0', textAlign: 'center', color: '#94a3b8' }}>Loading taxes...</div>
        ) : taxRates.length === 0 ? (
          <div style={{ padding: '2rem 0', textAlign: 'center', color: '#94a3b8' }}>
            No tax types configured yet. Add one to start applying tax to service pricing.
          </div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Code</th>
                <th>Rate</th>
                <th>Country</th>
                <th>Applies To</th>
                <th>Default</th>
                <th>Active</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {taxRates.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 700 }}>{t.name}</td>
                  <td>{t.code}</td>
                  <td style={{ fontWeight: 700, color: '#0d7478' }}>{Number(t.rate)}%</td>
                  <td>{t.country || 'South Africa'}</td>
                  <td style={{ textTransform: 'capitalize' }}>{t.applies_to || 'all'}</td>
                  <td>
                    {t.is_default ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: '#ecfdf5', color: '#047857', padding: '0.25rem 0.6rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700 }}>
                        <Star size={12} /> Default
                      </span>
                    ) : (
                      <button type="button" className="secondary-btn" style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }} disabled={saving} onClick={() => handleSetDefault(t)}>
                        Set default
                      </button>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`icon-btn ${t.is_active ? '' : 'danger'}`}
                      title={t.is_active ? 'Deactivate' : 'Activate'}
                      disabled={saving}
                      onClick={() => handleToggleActive(t)}
                    >
                      <Power size={15} />
                    </button>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '0.4rem' }}>
                      <button type="button" className="icon-btn outline" title="Edit" onClick={() => openEdit(t)}>
                        <Edit3 size={15} />
                      </button>
                      <button type="button" className="icon-btn danger" title="Delete" disabled={saving} onClick={() => handleDelete(t)}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '1rem', display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
          <ShieldCheck size={13} /> Saved itineraries keep the tax rate that applied at quote time — changing these rates only affects new services.
        </p>
      </div>

      {/* Add / edit tax modal */}
      {modalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '520px' }}>
            <div className="modal-header">
              <h2>{editingId ? 'Edit Tax' : 'Add Tax'}</h2>
              <button className="close-btn" onClick={() => setModalOpen(false)}><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div className="sidebar-field" style={{ marginTop: '0.5rem' }}>
                  <label>Name *</label>
                  <input className="sidebar-select" style={fieldStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Value Added Tax (VAT)" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="sidebar-field">
                    <label>Code</label>
                    <input className="sidebar-select" style={fieldStyle} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. VAT" />
                  </div>
                  <div className="sidebar-field">
                    <label>Rate (%) *</label>
                    <input className="sidebar-select" style={fieldStyle} type="number" min="0" max="100" step="0.01" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
                  </div>
                </div>
                <div className="sidebar-field">
                  <label>Country</label>
                  <SearchableCountryInput value={form.country} onChange={(val) => setForm({ ...form, country: val })} />
                </div>
                <div className="sidebar-field">
                  <label>Applies To</label>
                  <select className="sidebar-select" style={fieldStyle} value={form.appliesTo} onChange={(e) => setForm({ ...form, appliesTo: e.target.value })}>
                    {APPLIES_TO_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt === 'all' ? 'All services' : opt.replace(/^\w/, (c) => c.toUpperCase())}</option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
                    Set as default tax
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                    Active
                  </label>
                </div>
                <div className="form-actions">
                  <button type="button" className="secondary-btn" onClick={() => setModalOpen(false)}>Cancel</button>
                  <button type="submit" className="primary-btn" style={{ flex: 1, display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }} disabled={saving}>
                    <Check size={16} /> {saving ? 'Saving...' : 'Save Tax'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;