import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { useCurrencies } from '../hooks/useCurrencies';
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
  Search,
  Landmark,
  FileText,
  Image as ImageIcon,
  Upload,
  LayoutTemplate
} from 'lucide-react';

const emptyBank = () => ({
  label: '',
  currency_code: 'ZAR',
  bank_name: '',
  account_holder_name: '',
  account_number: '',
  branch_code: '',
  swift_code: '',
  is_default: false,
  is_active: true
});

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
  const { currencies } = useCurrencies();
  const [companyId, setCompanyId] = useState(null);
  const [taxRates, setTaxRates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm());

  const [billing, setBilling] = useState({
    legal_name: '',
    operating_country: 'South Africa',
    tax_number: '',
    billing_address: '',
    default_deposit_percentage: '30',
    invoice_prefix: 'INV',
    allow_decimal_amounts: true,
    input_rounding_mode: 'none',
    output_rounding_mode: 'none',
    logo_data_url: '',
    logo_size: 'md'
  });
  const [bankAccounts, setBankAccounts] = useState([]);
  const [bankModalOpen, setBankModalOpen] = useState(false);
  const [editingBankId, setEditingBankId] = useState(null);
  const [bankForm, setBankForm] = useState(emptyBank());

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

  const fetchBilling = useCallback(async (cid) => {
    if (!cid) return;
    const { data, error } = await supabase
      .from('company_billing_settings')
      .select('*')
      .eq('company_id', cid)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      setBilling({
        legal_name: data.legal_name || '',
        operating_country: data.operating_country || 'South Africa',
        tax_number: data.tax_number || '',
        billing_address: data.billing_address || '',
        default_deposit_percentage: String(data.default_deposit_percentage ?? 30),
        invoice_prefix: data.invoice_prefix || 'INV',
        allow_decimal_amounts: data.allow_decimal_amounts !== false,
        input_rounding_mode: ['none', 'up', 'down'].includes(data.input_rounding_mode) ? data.input_rounding_mode : 'none',
        output_rounding_mode: ['none', 'up', 'down'].includes(data.output_rounding_mode) ? data.output_rounding_mode : 'none',
        logo_data_url: data.logo_data_url || '',
        logo_size: ['sm', 'md', 'lg'].includes(data.logo_size) ? data.logo_size : 'md'
      });
    }
  }, []);

  const fetchBankAccounts = useCallback(async (cid) => {
    if (!cid) return;
    const { data, error } = await supabase
      .from('company_bank_accounts')
      .select('*')
      .eq('company_id', cid)
      .order('created_at', { ascending: true });
    if (error) throw error;
    setBankAccounts(data || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cid = await fetchCompanyId();
        if (cancelled) return;
        setCompanyId(cid);
        await Promise.all([fetchTaxRates(cid), fetchBilling(cid), fetchBankAccounts(cid)]);
      } catch (err) {
        if (!cancelled) showToast(err.message || 'Failed to load settings', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchCompanyId, fetchTaxRates, fetchBilling, fetchBankAccounts, showToast]);

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

  const saveBillingFields = async (payload) => {
    if (!companyId) {
      showToast('No active company found', 'error');
      return false;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('company_billing_settings')
        .upsert({ company_id: companyId, ...payload }, { onConflict: 'company_id' });
      if (error) throw error;
      return true;
    } catch (err) {
      showToast(err.message || 'Failed to save billing settings', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBillingProfile = async () => {
    const pct = Number(billing.default_deposit_percentage);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      showToast('Default deposit % must be between 0 and 100', 'warning');
      return;
    }
    const ok = await saveBillingFields({
      legal_name: billing.legal_name.trim(),
      tax_number: billing.tax_number.trim(),
      billing_address: billing.billing_address.trim(),
      operating_country: billing.operating_country || 'South Africa',
      default_deposit_percentage: pct,
      invoice_prefix: (billing.invoice_prefix.trim() || 'INV').toUpperCase(),
      logo_data_url: billing.logo_data_url || '',
      logo_size: ['sm', 'md', 'lg'].includes(billing.logo_size) ? billing.logo_size : 'md'
    });
    if (ok) showToast('Billing profile saved', 'success');
  };

  /* Company logo: JPEG / PNG / BMP accepted; resized to at most 512px wide,
     stored as transparent PNG so it renders identically on every document. */
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
        const MAX = 512;
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
        setBilling((prev) => ({ ...prev, logo_data_url: canvas.toDataURL('image/png') }));
        showToast('Logo added — remember to save your changes', 'success');
      };
      img.onerror = () => showToast('Could not read that logo image', 'error');
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const clearLogo = () => setBilling((prev) => ({ ...prev, logo_data_url: '' }));

  const handleSaveAmountSettings = async () => {
    const ok = await saveBillingFields({
      allow_decimal_amounts: billing.allow_decimal_amounts === true,
      input_rounding_mode: ['none', 'up', 'down'].includes(billing.input_rounding_mode) ? billing.input_rounding_mode : 'none',
      output_rounding_mode: ['none', 'up', 'down'].includes(billing.output_rounding_mode) ? billing.output_rounding_mode : 'none'
    });
    if (ok) showToast('Amount preferences saved', 'success');
  };

  const openAddBank = () => {
    setEditingBankId(null);
    setBankForm(emptyBank());
    setBankModalOpen(true);
  };

  const openEditBank = (b) => {
    setEditingBankId(b.id);
    setBankForm({
      label: b.label || '',
      currency_code: b.currency_code || 'ZAR',
      bank_name: b.bank_name || '',
      account_holder_name: b.account_holder_name || '',
      account_number: b.account_number || '',
      branch_code: b.branch_code || '',
      swift_code: b.swift_code || '',
      is_default: !!b.is_default,
      is_active: !!b.is_active
    });
    setBankModalOpen(true);
  };

  const handleBankSubmit = async (e) => {
    e.preventDefault();
    if (!companyId) {
      showToast('No active company found', 'error');
      return;
    }
    if (!bankForm.bank_name.trim()) {
      showToast('Bank name is required', 'warning');
      return;
    }
    setSaving(true);
    try {
      const base = {
        company_id: companyId,
        label: bankForm.label.trim(),
        currency_code: bankForm.currency_code || 'ZAR',
        bank_name: bankForm.bank_name.trim(),
        account_holder_name: bankForm.account_holder_name.trim(),
        account_number: bankForm.account_number.trim(),
        branch_code: bankForm.branch_code.trim(),
        swift_code: bankForm.swift_code.trim(),
        is_active: bankForm.is_active
      };
      if (bankForm.is_default) {
        await supabase
          .from('company_bank_accounts')
          .update({ is_default: false })
          .eq('company_id', companyId);
      }
      if (editingBankId) {
        const { error } = await supabase
          .from('company_bank_accounts')
          .update({ ...base, is_default: bankForm.is_default })
          .eq('id', editingBankId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('company_bank_accounts')
          .insert([{ ...base, is_default: bankForm.is_default }]);
        if (error) throw error;
      }
      await fetchBankAccounts(companyId);
      setBankModalOpen(false);
      showToast('Bank account saved', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to save bank account', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefaultBank = async (b) => {
    if (b.is_default) return;
    setSaving(true);
    try {
      const { error: err1 } = await supabase
        .from('company_bank_accounts')
        .update({ is_default: false })
        .eq('company_id', companyId);
      if (err1) throw err1;
      const { error: err2 } = await supabase
        .from('company_bank_accounts')
        .update({ is_default: true })
        .eq('id', b.id);
      if (err2) throw err2;
      await fetchBankAccounts(companyId);
      showToast('Default bank account updated', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to set default bank account', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleBankActive = async (b) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('company_bank_accounts')
        .update({ is_active: !b.is_active })
        .eq('id', b.id);
      if (error) throw error;
      await fetchBankAccounts(companyId);
    } catch (err) {
      showToast(err.message || 'Failed to update bank account', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteBank = async (b) => {
    if (!window.confirm(`Delete bank account "${b.bank_name || b.label || b.currency_code}"?`)) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('company_bank_accounts')
        .delete()
        .eq('id', b.id);
      if (error) throw error;
      await fetchBankAccounts(companyId);
      showToast('Bank account deleted', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to delete bank account', 'error');
    } finally {
      setSaving(false);
    }
  };

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

      {/* Billing & invoicing profile */}
      <div className="admin-card" style={{ marginTop: '1.5rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FileText size={18} color="#0d7478" /> Billing &amp; Invoicing
          </h2>
          <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.85rem' }}>
            These details appear on every invoice. The deposit % is the tenant default; a client can override it on their record.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          <div className="sidebar-field">
            <label>Legal / Trading Name</label>
            <input className="sidebar-select" style={fieldStyle} value={billing.legal_name} onChange={(e) => setBilling({ ...billing, legal_name: e.target.value })} placeholder="e.g. TorBuilder Tours (Pty) Ltd" />
          </div>
          <div className="sidebar-field">
            <label>VAT / Tax Number</label>
            <input className="sidebar-select" style={fieldStyle} value={billing.tax_number} onChange={(e) => setBilling({ ...billing, tax_number: e.target.value })} placeholder="e.g. 4123456789" />
          </div>
          <div className="sidebar-field">
            <label>Operating Country *</label>
            <SearchableCountryInput value={billing.operating_country} onChange={(value) => setBilling({ ...billing, operating_country: value })} />
            <p style={{ margin: '0.25rem 0 0', color: '#64748b', fontSize: '0.74rem', lineHeight: 1.4 }}>
              South African VAT is applied only when both this country and the supplier country are South Africa.
            </p>
          </div>
          <div className="sidebar-field">
            <label>Invoice Prefix</label>
            <input className="sidebar-select" style={fieldStyle} value={billing.invoice_prefix} onChange={(e) => setBilling({ ...billing, invoice_prefix: e.target.value })} placeholder="INV" />
          </div>
          <div className="sidebar-field">
            <label>Default Deposit (%)</label>
            <input className="sidebar-select" style={fieldStyle} type="number" min="0" max="100" step="0.01" value={billing.default_deposit_percentage} onChange={(e) => setBilling({ ...billing, default_deposit_percentage: e.target.value })} />
          </div>
        </div>
        <div className="sidebar-field" style={{ marginTop: '1rem' }}>
          <label>Billing Address</label>
          <textarea className="sidebar-select" style={{ ...fieldStyle, minHeight: '70px', resize: 'vertical' }} value={billing.billing_address} onChange={(e) => setBilling({ ...billing, billing_address: e.target.value })} placeholder="Street, City, Postal code, Country" />
        </div>
        <div style={{ marginTop: '1rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1rem 1.1rem' }}>
          <div style={{ marginBottom: '0.7rem' }}>
            <strong style={{ fontSize: '0.88rem', color: '#1a202c', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <ImageIcon size={15} color="#0d7478" /> Company Logo
            </strong>
            <p style={{ margin: '0.3rem 0 0', color: '#64748b', fontSize: '0.8rem' }}>
              Appears on your printed Company documents (invoices, receipts, credit notes, itineraries). JPEG, PNG or BMP — auto-resized to 512px and stored as PNG.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            {billing.logo_data_url ? (
              <>
                <img src={billing.logo_data_url} alt="Company logo preview" style={{ maxHeight: '64px', maxWidth: '200px', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#fff', padding: '4px' }} />
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button type="button" className="secondary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }} onClick={() => document.getElementById('company-logo-input')?.click()}>
                    <Upload size={14} /> Change
                  </button>
                  <button type="button" className="secondary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: '#b91c1c' }} onClick={clearLogo}>
                    <Trash2 size={14} /> Remove
                  </button>
                </div>
              </>
            ) : (
              <button type="button" className="secondary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }} onClick={() => document.getElementById('company-logo-input')?.click()}>
                <Upload size={14} /> Upload Logo
              </button>
            )}
            <select className="sidebar-select" style={{ ...fieldStyle, width: '180px' }} value={billing.logo_size} onChange={(e) => setBilling({ ...billing, logo_size: e.target.value })} title="Display size on documents">
              <option value="sm">Small (110px)</option>
              <option value="md">Medium (160px)</option>
              <option value="lg">Large (220px)</option>
            </select>
            <input id="company-logo-input" type="file" accept=".jpg,.jpeg,.png,.bmp,image/jpeg,image/png,image/bmp" style={{ display: 'none' }} onChange={(e) => { handleLogoFile(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          <p style={{ margin: '0.6rem 0 0', color: '#94a3b8', fontSize: '0.74rem', lineHeight: 1.4 }}>
            Recommended: export your logo at 300–500px wide (landscape usually works best on a document header). The size above controls how wide it prints — Medium (160px) is the typical industry standard.
          </p>
        </div>
        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="primary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }} disabled={saving} onClick={handleSaveBillingProfile}>
            <Check size={16} /> {saving ? 'Saving...' : 'Save Billing Profile'}
          </button>
        </div>
      </div>

      {/* Money entry preferences */}
      <div className="admin-card" style={{ marginTop: '1.5rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Percent size={18} color="#0d7478" /> Money Entry Preferences
          </h2>
          <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.85rem' }}>
            Applies to money / rate fields only — never to counts such as pax, capacity or occupancy.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          <div className="sidebar-field">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', fontWeight: 600, color: '#334155', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={billing.allow_decimal_amounts}
                onChange={(e) => setBilling({ ...billing, allow_decimal_amounts: e.target.checked })}
                style={{ width: '16px', height: '16px', accentColor: '#0d7478', cursor: 'pointer' }}
              />
              Allow decimal amounts
            </label>
            <p style={{ margin: '0.25rem 0 0', color: '#94a3b8', fontSize: '0.74rem', lineHeight: 1.4 }}>
              {billing.allow_decimal_amounts
                ? 'Money fields accept cents (e.g. 1249.50).'
                : 'Money fields accept whole numbers only (e.g. 1250).'}
            </p>
          </div>
          <div className="sidebar-field">
            <label>Round input amounts</label>
            <select className="sidebar-select" style={fieldStyle} value={billing.input_rounding_mode} onChange={(e) => setBilling({ ...billing, input_rounding_mode: e.target.value })}>
              <option value="none">No rounding</option>
              <option value="up">Round up</option>
              <option value="down">Round down</option>
            </select>
            <p style={{ margin: '0.25rem 0 0', color: '#94a3b8', fontSize: '0.74rem', lineHeight: 1.4 }}>
              Snaps typed money values to whole numbers when you leave the field.
            </p>
          </div>
          <div className="sidebar-field">
            <label>Round output amounts</label>
            <select className="sidebar-select" style={fieldStyle} value={billing.output_rounding_mode} onChange={(e) => setBilling({ ...billing, output_rounding_mode: e.target.value })}>
              <option value="none">No rounding</option>
              <option value="up">Round up</option>
              <option value="down">Round down</option>
            </select>
            <p style={{ margin: '0.25rem 0 0', color: '#94a3b8', fontSize: '0.74rem', lineHeight: 1.4 }}>
              Rounds calculated amounts (sell price, line totals) to whole numbers.
            </p>
          </div>
        </div>
        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="primary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }} disabled={saving} onClick={handleSaveAmountSettings}>
            <Check size={16} /> {saving ? 'Saving...' : 'Save Amount Preferences'}
          </button>
        </div>
      </div>

      {/* Document templates (coming soon) */}
      <div className="admin-card" style={{ marginTop: '1.5rem', opacity: 0.85 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <LayoutTemplate size={18} color="#0d7478" /> Document Templates
            </h2>
            <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.85rem' }}>
              Pick a ready-made layout for how your output documents (itineraries, vouchers, invoices, travel documents) are presented. The layout engine ships in a future release — this is just the placeholder setting page.
            </p>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: '#ecfeff', color: '#0d7478', padding: '0.3rem 0.7rem', borderRadius: '999px', fontSize: '0.78rem', fontWeight: 700 }}>
            Coming soon
          </span>
        </div>
        <div style={{ marginTop: '1rem', border: '1px dashed #cbd5e1', borderRadius: '12px', padding: '1.2rem 1.4rem', color: '#64748b', fontSize: '0.85rem', background: '#f8fafc' }}>
          No templates available yet. When this feature ships you will be able to choose (and preview) a branded template here, and it will apply to every company document without re-configuring anything else.
        </div>
      </div>

      {/* Bank accounts */}
      <div className="admin-card" style={{ marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Landmark size={18} color="#0d7478" /> Bank Accounts
            </h2>
            <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.85rem' }}>
              Add one account per currency. An invoice uses the account matching its currency.
            </p>
          </div>
          <button type="button" className="primary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }} onClick={openAddBank}>
            <Plus size={16} /> Add Bank Account
          </button>
        </div>

        {bankAccounts.length === 0 ? (
          <div style={{ padding: '2rem 0', textAlign: 'center', color: '#94a3b8' }}>
            No bank accounts yet. Add one so invoices can show payment details.
          </div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Currency</th>
                <th>Bank</th>
                <th>Account Holder</th>
                <th>Account Number</th>
                <th>Branch / SWIFT</th>
                <th>Default</th>
                <th>Active</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {bankAccounts.map((b) => (
                <tr key={b.id}>
                  <td style={{ fontWeight: 700 }}>{b.label || '—'}</td>
                  <td style={{ fontWeight: 700, color: '#0d7478' }}>{b.currency_code}</td>
                  <td>{b.bank_name}</td>
                  <td>{b.account_holder_name || '—'}</td>
                  <td>{b.account_number || '—'}</td>
                  <td>{[b.branch_code, b.swift_code].filter(Boolean).join(' / ') || '—'}</td>
                  <td>
                    {b.is_default ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: '#ecfdf5', color: '#047857', padding: '0.25rem 0.6rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700 }}>
                        <Star size={12} /> Default
                      </span>
                    ) : (
                      <button type="button" className="secondary-btn" style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }} disabled={saving} onClick={() => handleSetDefaultBank(b)}>
                        Set default
                      </button>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`icon-btn ${b.is_active ? '' : 'danger'}`}
                      title={b.is_active ? 'Deactivate' : 'Activate'}
                      disabled={saving}
                      onClick={() => handleToggleBankActive(b)}
                    >
                      <Power size={15} />
                    </button>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '0.4rem' }}>
                      <button type="button" className="icon-btn outline" title="Edit" onClick={() => openEditBank(b)}>
                        <Edit3 size={15} />
                      </button>
                      <button type="button" className="icon-btn danger" title="Delete" disabled={saving} onClick={() => handleDeleteBank(b)}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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

      {/* Add / edit bank account modal */}
      {bankModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '560px' }}>
            <div className="modal-header">
              <h2>{editingBankId ? 'Edit Bank Account' : 'Add Bank Account'}</h2>
              <button className="close-btn" onClick={() => setBankModalOpen(false)}><X size={20} /></button>
            </div>
            <form onSubmit={handleBankSubmit}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem', marginTop: '0.5rem' }}>
                  <div className="sidebar-field">
                    <label>Label</label>
                    <input className="sidebar-select" style={fieldStyle} value={bankForm.label} onChange={(e) => setBankForm({ ...bankForm, label: e.target.value })} placeholder="e.g. Main ZAR account" />
                  </div>
                  <div className="sidebar-field">
                    <label>Currency</label>
                    <select className="sidebar-select" style={fieldStyle} value={bankForm.currency_code} onChange={(e) => setBankForm({ ...bankForm, currency_code: e.target.value })}>
                      {(currencies.length ? currencies : [{ code: 'ZAR', name: 'South African Rand' }]).map((c) => (
                        <option key={c.code} value={c.code}>{c.code}{c.name ? ` — ${c.name}` : ''}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="sidebar-field">
                  <label>Bank Name *</label>
                  <input className="sidebar-select" style={fieldStyle} value={bankForm.bank_name} onChange={(e) => setBankForm({ ...bankForm, bank_name: e.target.value })} placeholder="e.g. Standard Bank" />
                </div>
                <div className="sidebar-field">
                  <label>Account Holder Name</label>
                  <input className="sidebar-select" style={fieldStyle} value={bankForm.account_holder_name} onChange={(e) => setBankForm({ ...bankForm, account_holder_name: e.target.value })} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="sidebar-field">
                    <label>Account Number</label>
                    <input className="sidebar-select" style={fieldStyle} value={bankForm.account_number} onChange={(e) => setBankForm({ ...bankForm, account_number: e.target.value })} />
                  </div>
                  <div className="sidebar-field">
                    <label>Branch Code</label>
                    <input className="sidebar-select" style={fieldStyle} value={bankForm.branch_code} onChange={(e) => setBankForm({ ...bankForm, branch_code: e.target.value })} />
                  </div>
                </div>
                <div className="sidebar-field">
                  <label>SWIFT / BIC (for international payments)</label>
                  <input className="sidebar-select" style={fieldStyle} value={bankForm.swift_code} onChange={(e) => setBankForm({ ...bankForm, swift_code: e.target.value })} />
                </div>
                <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={bankForm.is_default} onChange={(e) => setBankForm({ ...bankForm, is_default: e.target.checked })} />
                    Set as default bank account
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={bankForm.is_active} onChange={(e) => setBankForm({ ...bankForm, is_active: e.target.checked })} />
                    Active
                  </label>
                </div>
                <div className="form-actions">
                  <button type="button" className="secondary-btn" onClick={() => setBankModalOpen(false)}>Cancel</button>
                  <button type="submit" className="primary-btn" style={{ flex: 1, display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }} disabled={saving}>
                    <Check size={16} /> {saving ? 'Saving...' : 'Save Bank Account'}
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