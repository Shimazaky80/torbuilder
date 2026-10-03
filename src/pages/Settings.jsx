import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import SearchableSelect from '../components/SearchableSelect';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { useCurrencies } from '../hooks/useCurrencies';
import ConfirmDialog from '../components/ConfirmDialog';
import { useConfirm } from '../hooks/useConfirm';
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
  LayoutTemplate,
  Rows3,
  Eye,
  AlertTriangle
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

/* Searchable combobox for the Country field (instead of the native <SearchableSelect>). */
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
  revenueAgency: '',
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
    list_row_limit: 2,
    logo_data_url: '',
    logo_size: 'md',
    show_supplier_in_description: true,
    pricing_breakdown_mode: 'daily',
    pricing_breakdown_accommodation: 'one',
    price_protection_percent: 0,
    show_meal_plan_on_accommodation: true,
    logo_position: 'left',
    billing_address_position: 'left',
    client_logo_size: 'md',
    client_logo_position: 'left',
    client_billing_address_position: 'left',
    itinerary_pricing_position: 'above',
    itinerary_terms: '',
    itinerary_terms_position: 'under_day_by_day',
    itinerary_inclusions: '',
    itinerary_inclusions_position: 'under_day_by_day',
    itinerary_include_default_inclusions: true,
    itinerary_exclusions: '',
    itinerary_exclusions_position: 'under_day_by_day',
    contact_email: '',
    contact_tel: '',
    contact_cell: '',
    contact_website: ''
  });
  const [bankAccounts, setBankAccounts] = useState([]);
  const [bankModalOpen, setBankModalOpen] = useState(false);
  const [confirmDialog, confirm] = useConfirm();
  const [bankConfirm, setBankConfirm] = useState(null);
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
        list_row_limit: Number.isFinite(Number(data.list_row_limit)) && Number(data.list_row_limit) > 0 ? Number(data.list_row_limit) : 2,
        logo_data_url: data.logo_data_url || '',
        logo_size: ['sm', 'md', 'lg'].includes(data.logo_size) ? data.logo_size : 'md',
        show_supplier_in_description: data.show_supplier_in_description !== false,
        pricing_breakdown_mode: ['daily', 'per_person'].includes(data.pricing_breakdown_mode) ? data.pricing_breakdown_mode : 'daily',
        pricing_breakdown_accommodation: ['one', 'rooms'].includes(data.pricing_breakdown_accommodation) ? data.pricing_breakdown_accommodation : 'one',
        price_protection_percent: Math.min(100, Math.max(0, Number(data.price_protection_percent) || 0)),
        show_meal_plan_on_accommodation: data.show_meal_plan_on_accommodation !== false,
        logo_position: ['left', 'center', 'right'].includes(data.logo_position) ? data.logo_position : 'left',
        billing_address_position: ['left', 'center', 'right'].includes(data.billing_address_position) ? data.billing_address_position : 'left',
        client_logo_size: ['sm', 'md', 'lg'].includes(data.client_logo_size) ? data.client_logo_size : 'md',
        client_logo_position: ['left', 'center', 'right'].includes(data.client_logo_position) ? data.client_logo_position : 'left',
        client_billing_address_position: ['left', 'center', 'right'].includes(data.client_billing_address_position) ? data.client_billing_address_position : 'left',
        itinerary_pricing_position: ['above', 'below'].includes(data.itinerary_pricing_position) ? data.itinerary_pricing_position : 'above',
        itinerary_terms: data.itinerary_terms || '',
        itinerary_terms_position: ['under_day_by_day', 'before_pricing', 'after_pricing'].includes(data.itinerary_terms_position) ? data.itinerary_terms_position : 'under_day_by_day',
        itinerary_inclusions: data.itinerary_inclusions || '',
        itinerary_inclusions_position: ['under_day_by_day', 'before_pricing', 'after_pricing'].includes(data.itinerary_inclusions_position) ? data.itinerary_inclusions_position : 'under_day_by_day',
        itinerary_include_default_inclusions: data.itinerary_include_default_inclusions !== false,
        itinerary_exclusions: data.itinerary_exclusions || '',
        itinerary_exclusions_position: ['under_day_by_day', 'before_pricing', 'after_pricing'].includes(data.itinerary_exclusions_position) ? data.itinerary_exclusions_position : 'under_day_by_day',
        contact_email: data.contact_email || '',
        contact_tel: data.contact_tel || '',
        contact_cell: data.contact_cell || '',
        contact_website: data.contact_website || ''
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
      revenueAgency: t.revenue_agency || '',
      isDefault: !!t.is_default,
      isActive: !!t.is_active
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    let cid = companyId;
    if (!cid) {
      cid = await fetchCompanyId();
      if (cid && cid !== companyId) setCompanyId(cid);
    }
    if (!cid) {
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
        company_id: cid,
        name,
        code: form.code.trim() || 'VAT',
        rate,
        applies_to: form.appliesTo || 'all',
        country: form.country || 'South Africa',
        revenue_agency: (form.revenueAgency || '').trim() || null,
        is_active: form.isActive
      };

      if (form.isDefault) {
        await supabase
          .from('tax_rates')
          .update({ is_default: false })
          .eq('company_id', cid);
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
      await fetchTaxRates(cid);
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
    const ok = await confirm({
      title: 'Delete tax rate?',
      message: `"${t.name}" will be removed and any itinerary using it will be set to 0%.`,
      detail: 'Saved invoices and itineraries keep their original rate.',
      confirmLabel: 'Delete tax rate',
      destructive: true
    });
    if (!ok) return;
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
    /* If the mount effect hasn't resolved companyId yet (or the tenant's
       profile row is missing a company_id), resolve it lazily so saving a
       billing profile never fails with "No active company found". */
    let cid = companyId;
    if (!cid) {
      cid = await fetchCompanyId();
      if (cid && cid !== companyId) setCompanyId(cid);
    }
    if (!cid) {
      showToast('No active company found', 'error');
      return false;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('company_billing_settings')
        .upsert({ company_id: cid, ...payload }, { onConflict: 'company_id' });
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
      const ok = await saveBillingFields({
        legal_name: billing.legal_name.trim(),
        operating_country: billing.operating_country || 'South Africa',
        tax_number: billing.tax_number.trim(),
        billing_address: billing.billing_address.trim(),
        logo_data_url: billing.logo_data_url || '',
        logo_size: ['sm', 'md', 'lg'].includes(billing.logo_size) ? billing.logo_size : 'md',
        contact_email: billing.contact_email.trim(),
        contact_tel: billing.contact_tel.trim(),
        contact_cell: billing.contact_cell.trim(),
        contact_website: billing.contact_website.trim()
      });
    if (ok) showToast('Company profile saved', 'success');
  };

  /* Invoice-only defaults: numbering prefix and the default deposit %. */
  const handleSaveInvoiceDefaults = async () => {
    const pct = Number(billing.default_deposit_percentage);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      showToast('Default deposit % must be between 0 and 100', 'warning');
      return;
    }
    const ok = await saveBillingFields({
      invoice_prefix: (billing.invoice_prefix.trim() || 'INV').toUpperCase(),
      default_deposit_percentage: pct
    });
    if (ok) showToast('Invoice defaults saved', 'success');
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

  const handleSaveListSettings = async () => {
    const n = Math.floor(Number(billing.list_row_limit));
    const ok = await saveBillingFields({
      list_row_limit: Number.isFinite(n) && n > 0 ? n : 2
    });
    if (ok) {
      setBilling({ ...billing, list_row_limit: Number.isFinite(n) && n > 0 ? n : 2 });
      showToast('List rows preference saved', 'success');
    }
  };

  /* Pricing Protection: the uplift added to a stale season price when no season
   covers the itinerary's travel dates. Validated on blur and on the button,
   because an out-of-range value here silently changes every quote. */
const handleSavePriceProtection = async () => {
    const pct = Number(billing.price_protection_percent);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      showToast('Pricing Protection must be between 0 and 100', 'warning');
      return;
    }
    const ok = await saveBillingFields({ price_protection_percent: pct });
    if (ok) {
      setBilling({ ...billing, price_protection_percent: pct });
      showToast('Pricing Protection saved', 'success');
    }
  };

  const handleSavePresentationSettings = async () => {
    const ok = await saveBillingFields({
      show_supplier_in_description: billing.show_supplier_in_description !== false,
      pricing_breakdown_mode: ['daily', 'per_person'].includes(billing.pricing_breakdown_mode) ? billing.pricing_breakdown_mode : 'daily',
      pricing_breakdown_accommodation: ['one', 'rooms'].includes(billing.pricing_breakdown_accommodation) ? billing.pricing_breakdown_accommodation : 'one',
      show_meal_plan_on_accommodation: billing.show_meal_plan_on_accommodation !== false,
      logo_position: ['left', 'center', 'right'].includes(billing.logo_position) ? billing.logo_position : 'left',
      billing_address_position: ['left', 'center', 'right'].includes(billing.billing_address_position) ? billing.billing_address_position : 'left',
      client_logo_size: ['sm', 'md', 'lg'].includes(billing.client_logo_size) ? billing.client_logo_size : 'md',
      client_logo_position: ['left', 'center', 'right'].includes(billing.client_logo_position) ? billing.client_logo_position : 'left',
      client_billing_address_position: ['left', 'center', 'right'].includes(billing.client_billing_address_position) ? billing.client_billing_address_position : 'left'
    });
    if (ok) showToast('Presentation preferences saved', 'success');
  };

  const handleSaveItinerarySettings = async () => {
    const ok = await saveBillingFields({
      itinerary_pricing_position: ['above', 'below'].includes(billing.itinerary_pricing_position) ? billing.itinerary_pricing_position : 'above',
      itinerary_terms: billing.itinerary_terms || '',
      itinerary_terms_position: ['under_day_by_day', 'before_pricing', 'after_pricing'].includes(billing.itinerary_terms_position) ? billing.itinerary_terms_position : 'under_day_by_day',
      itinerary_inclusions: billing.itinerary_inclusions || '',
      itinerary_inclusions_position: ['under_day_by_day', 'before_pricing', 'after_pricing'].includes(billing.itinerary_inclusions_position) ? billing.itinerary_inclusions_position : 'under_day_by_day',
      itinerary_include_default_inclusions: billing.itinerary_include_default_inclusions === true,
      itinerary_exclusions: billing.itinerary_exclusions || '',
      itinerary_exclusions_position: ['under_day_by_day', 'before_pricing', 'after_pricing'].includes(billing.itinerary_exclusions_position) ? billing.itinerary_exclusions_position : 'under_day_by_day'
    });
    if (ok) showToast('Itinerary presentation saved', 'success');
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
    let cid = companyId;
    if (!cid) {
      cid = await fetchCompanyId();
      if (cid && cid !== companyId) setCompanyId(cid);
    }
    if (!cid) {
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
        company_id: cid,
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
          .eq('company_id', cid);
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
      await fetchBankAccounts(cid);
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
      showToast(b.is_active ? 'Bank account deactivated' : 'Bank account activated', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to update bank account', 'error');
    } finally {
      setSaving(false);
    }
  };

  /* Deactivating removes the account from invoices and blocks invoicing for its
     currency until another account is active, so it is confirmed first. */
  const requestToggleBankActive = (b) => {
    if (!b.is_active) {
      handleToggleBankActive(b);
      return;
    }
    const activeOthers = bankAccounts.filter((x) => x.id !== b.id && x.is_active
      && (x.currency_code || '').toUpperCase() === (b.currency_code || '').toUpperCase());
    setBankConfirm({
      account: b,
      /* activeOthers.length > 0 means another active account covers this
         currency, so invoicing continues; otherwise it is blocked. */
      message: activeOthers.length
        ? `It will no longer appear on invoices. Invoices in ${b.currency_code} will use "${activeOthers[0].label || activeOthers[0].currency_code}".`
        : `This is the last active ${b.currency_code} account, so invoices in ${b.currency_code} can no longer be generated. Itineraries can still be built in any currency.`
    });
  };

  const handleDeleteBank = async (b) => {
    const name = b.bank_name || b.label || b.currency_code;
    const others = bankAccounts.filter((x) => x.id !== b.id && x.is_active
      && (x.currency_code || '').toUpperCase() === (b.currency_code || '').toUpperCase());
    const ok = await confirm({
      title: 'Delete bank account?',
      message: `"${name}" (${b.currency_code}) will be permanently removed.`,
      detail: others.length
        ? `Invoices in ${b.currency_code} will use "${others[0].label || others[0].currency_code}".`
        : `This is the last ${b.currency_code} account, so invoices in ${b.currency_code} can no longer be generated.`,
      confirmLabel: 'Delete bank account',
      destructive: true
    });
    if (!ok) return;
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

      {/* Company profile - applies to every document */}
      <div className="admin-card" style={{ marginTop: '1.5rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FileText size={18} color="#0d7478" /> Company Profile
          </h2>
          <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.85rem' }}>
            These details identify your company on every travel document you produce &mdash; quotations, provisional bookings, invoices, receipts and credit notes.
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
              Determines the tax wording printed on your documents. Tax percentages and rates are configured in the Tax settings below.
            </p>
          </div>
        </div>

        {/* Contact details on printed documents */}
        <div className="sidebar-field" style={{ marginTop: '1rem' }}>
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.86rem', marginBottom: '0.45rem' }}>
            Contact details on printed documents
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.6rem' }}>
            <input className="sidebar-select" style={fieldStyle} type="email" value={billing.contact_email} onChange={(e) => setBilling({ ...billing, contact_email: e.target.value })} placeholder="Email" />
            <input className="sidebar-select" style={fieldStyle} value={billing.contact_tel} onChange={(e) => setBilling({ ...billing, contact_tel: e.target.value })} placeholder="Telephone" />
            <input className="sidebar-select" style={fieldStyle} value={billing.contact_cell} onChange={(e) => setBilling({ ...billing, contact_cell: e.target.value })} placeholder="Cell / Mobile" />
            <input className="sidebar-select" style={fieldStyle} type="url" value={billing.contact_website} onChange={(e) => setBilling({ ...billing, contact_website: e.target.value })} placeholder="Website" />
          </div>
          <p style={{ margin: '0.35rem 0 0', color: '#94a3b8', fontSize: '0.76rem', lineHeight: 1.45 }}>
            These appear on your printed documents (invoices, receipts, credit notes, itineraries) in the supplier / Bill-from header, so clients always have a way to reach you without scrolling to a footer.
          </p>
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
            <SearchableSelect className="sidebar-select" style={{ ...fieldStyle, width: '180px' }} value={billing.logo_size} onChange={(e) => setBilling({ ...billing, logo_size: e.target.value })} title="Display size on documents">
              <option value="sm">Small (110px)</option>
              <option value="md">Medium (160px)</option>
              <option value="lg">Large (220px)</option>
            </SearchableSelect>
            <input id="company-logo-input" type="file" accept=".jpg,.jpeg,.png,.bmp,image/jpeg,image/png,image/bmp" style={{ display: 'none' }} onChange={(e) => { handleLogoFile(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          <p style={{ margin: '0.6rem 0 0', color: '#94a3b8', fontSize: '0.74rem', lineHeight: 1.4 }}>
            Recommended: export your logo at 300–500px wide (landscape usually works best on a document header). The size above controls how wide it prints — Medium (160px) is the typical industry standard.
          </p>
        </div>
        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="primary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }} disabled={saving} onClick={handleSaveBillingProfile}>
            <Check size={16} /> {saving ? 'Saving...' : 'Save Company Profile'}
          </button>
        </div>
      </div>

      {/* Invoice-only defaults */}
      <div className="admin-card" style={{ marginTop: '1.5rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FileText size={18} color="#0d7478" /> Invoice Defaults
          </h2>
          <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.85rem' }}>
            Used on invoices only. The deposit % is the tenant default; a client can override it on their own record.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          <div className="sidebar-field">
            <label>Invoice Prefix</label>
            <input className="sidebar-select" style={fieldStyle} value={billing.invoice_prefix} onChange={(e) => setBilling({ ...billing, invoice_prefix: e.target.value })} placeholder="INV" />
          </div>
          <div className="sidebar-field">
            <label>Default Deposit (%)</label>
            <input className="sidebar-select" style={fieldStyle} type="number" min="0" max="100" step="0.01" value={billing.default_deposit_percentage} onChange={(e) => setBilling({ ...billing, default_deposit_percentage: e.target.value })} />
          </div>
        </div>
        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="primary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }} disabled={saving} onClick={handleSaveInvoiceDefaults}>
            <Check size={16} /> {saving ? 'Saving...' : 'Save Invoice Defaults'}
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
            <SearchableSelect className="sidebar-select" style={fieldStyle} value={billing.input_rounding_mode} onChange={(e) => setBilling({ ...billing, input_rounding_mode: e.target.value })}>
              <option value="none">No rounding</option>
              <option value="up">Round up</option>
              <option value="down">Round down</option>
            </SearchableSelect>
            <p style={{ margin: '0.25rem 0 0', color: '#94a3b8', fontSize: '0.74rem', lineHeight: 1.4 }}>
              Snaps typed money values to whole numbers when you leave the field.
            </p>
          </div>
          <div className="sidebar-field">
            <label>Round output amounts</label>
            <SearchableSelect className="sidebar-select" style={fieldStyle} value={billing.output_rounding_mode} onChange={(e) => setBilling({ ...billing, output_rounding_mode: e.target.value })}>
              <option value="none">No rounding</option>
              <option value="up">Round up</option>
              <option value="down">Round down</option>
            </SearchableSelect>
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

      {/* List view preferences */}
      <div className="admin-card" style={{ marginTop: '1.5rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Rows3 size={18} color="#0d7478" /> List View Preferences
          </h2>
          <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.85rem' }}>
                            How many rows each list module (Clients, Suppliers, Library Items, Itineraries, Finance) displays by default. Settings and Dashboard always show everything.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          <div className="sidebar-field">
            <label>Rows to display per list</label>
            <input
              type="number"
              min="1"
              className="sidebar-select"
              style={fieldStyle}
              value={billing.list_row_limit}
              onChange={(e) => setBilling({ ...billing, list_row_limit: e.target.value })}
            />
            {Number(billing.list_row_limit) > 2 && (
              <p style={{ margin: '0.35rem 0 0', color: '#b45309', fontSize: '0.78rem', lineHeight: 1.4 }}>
                Showing more than 2 rows can slow down page load times on slower networks.
              </p>
            )}
          </div>
        </div>
        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="primary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }} disabled={saving} onClick={handleSaveListSettings}>
            <Check size={16} /> {saving ? 'Saving...' : 'Save List Preferences'}
          </button>
        </div>
      </div>

      {/* Presentation preferences */}
      <div className="admin-card" style={{ marginTop: '1.5rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Eye size={18} color="#0d7478" /> Presentation
          </h2>
          <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.85rem' }}>
            How pricing is presented on exported documents and invoices. More presentation options will live under this section.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          <div className="sidebar-field">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', fontWeight: 600, color: '#334155', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={billing.show_supplier_in_description}
                onChange={(e) => setBilling({ ...billing, show_supplier_in_description: e.target.checked })}
                style={{ width: '16px', height: '16px', accentColor: '#0d7478', cursor: 'pointer' }}
              />
              Show supplier under the service description
            </label>
            <p style={{ margin: '0.25rem 0 0', color: '#94a3b8', fontSize: '0.74rem', lineHeight: 1.4 }}>
              When on, each service line also shows its supplier beneath the description. When off, only the service description appears — accommodation always shows its supplier so clients can see who quotes the room.
            </p>
          </div>
          <div className="sidebar-field">
            <label>Price breakdown</label>
            <SearchableSelect className="sidebar-select" style={fieldStyle} value={billing.pricing_breakdown_mode} onChange={(e) => setBilling({ ...billing, pricing_breakdown_mode: e.target.value })}>
              <option value="daily">Service per day (detailed)</option>
              <option value="per_person">Total per person (summary)</option>
            </SearchableSelect>
            <p style={{ margin: '0.25rem 0 0', color: '#94a3b8', fontSize: '0.74rem', lineHeight: 1.4 }}>
              Daily shows every service across the days. Per person shows the price per person sharing, adds a single supplement when a traveller occupies a single room, and a per-child figure when children travel.
            </p>
          </div>
          <div className="sidebar-field">
            <label>Pricing Protection (%)</label>
            <input
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={billing.price_protection_percent}
              onChange={(e) => setBilling({ ...billing, price_protection_percent: e.target.value })}
              onBlur={() => handleSavePriceProtection()}
              style={{ ...fieldStyle, padding: '0.45rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: '6px', width: '100%' }}
            />
            <p style={{ margin: '0.25rem 0 0', color: '#94a3b8', fontSize: '0.74rem', lineHeight: 1.4 }}>
              Uplift applied when no season in a library item's pricing matrix covers the itinerary's travel dates. The closest earlier season covering the same period of the year is used and this percentage is added to it, so a quote is never built on a price the supplier has already superseded. A season dated ahead of the trip is a future season, not an outdated one, so it is never used as protection. Set 0 to keep the older season price without an uplift. An item with no price at all cannot be added either way.
            </p>
            <button
              type="button"
              onClick={handleSavePriceProtection}
              disabled={saving}
              style={{ marginTop: '0.5rem', padding: '0.4rem 0.85rem', borderRadius: '6px', border: 'none', background: '#0d7478', color: '#fff', cursor: saving ? 'default' : 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
            >
              Save protection
            </button>
          </div>
          <div className="sidebar-field">
            <label>Accommodation lines</label>
            <SearchableSelect className="sidebar-select" style={fieldStyle} value={billing.pricing_breakdown_accommodation} onChange={(e) => setBilling({ ...billing, pricing_breakdown_accommodation: e.target.value })}>
              <option value="one">One line for all travellers</option>
              <option value="rooms">One line per room (occupancy split)</option>
            </SearchableSelect>
            <p style={{ margin: '0.25rem 0 0', color: '#94a3b8', fontSize: '0.74rem', lineHeight: 1.4 }}>
              Applies to the daily breakdown. One line shows the whole accommodation with the total per person. Room split puts each occupied room on its own line — e.g. one line for 2 travellers, one for 1 traveller, one for 2A, 1C — with the number of adults and children in the Qty column. All other services stay on their own lines as usual.
            </p>
          </div>
          <div className="sidebar-field">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', fontWeight: 600, color: '#334155', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={billing.show_meal_plan_on_accommodation}
                onChange={(e) => setBilling({ ...billing, show_meal_plan_on_accommodation: e.target.checked })}
                style={{ width: '16px', height: '16px', accentColor: '#0d7478', cursor: 'pointer' }}
              />
              Show meal plan on accommodation
            </label>
            <p style={{ margin: '0.25rem 0 0', color: '#94a3b8', fontSize: '0.74rem', lineHeight: 1.4 }}>
              When on, accommodation lines show the meal plan as its industry abbreviation (e.g. Standard Room - B&amp;B) on the same line as the service. The client itinerary document always includes the accommodation meal plan regardless of this toggle.
            </p>
          </div>
          <div className="sidebar-field">
            <label>Logo position</label>
            <SearchableSelect className="sidebar-select" style={fieldStyle} value={billing.logo_position} onChange={(e) => setBilling({ ...billing, logo_position: e.target.value })}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </SearchableSelect>
            <p style={{ margin: '0.25rem 0 0', color: '#94a3b8', fontSize: '0.74rem', lineHeight: 1.4 }}>
              Horizontal position of the company logo on exported documents.
            </p>
          </div>
          <div className="sidebar-field">
            <label>Billing address position</label>
            <SearchableSelect className="sidebar-select" style={fieldStyle} value={billing.billing_address_position} onChange={(e) => setBilling({ ...billing, billing_address_position: e.target.value })}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </SearchableSelect>
            <p style={{ margin: '0.25rem 0 0', color: '#94a3b8', fontSize: '0.74rem', lineHeight: 1.4 }}>
              Horizontal position of the billing address on exported documents.
            </p>
          </div>
          <div className="sidebar-field">
            <label>Client logo size</label>
            <SearchableSelect className="sidebar-select" style={fieldStyle} value={billing.client_logo_size} onChange={(e) => setBilling({ ...billing, client_logo_size: e.target.value })}>
              <option value="sm">Small</option>
              <option value="md">Medium</option>
              <option value="lg">Large</option>
            </SearchableSelect>
            <p style={{ margin: '0.25rem 0 0', color: '#94a3b8', fontSize: '0.74rem', lineHeight: 1.4 }}>
              Display size of the client&apos;s logo (set per client) on exported documents and invoices.
            </p>
          </div>
          <div className="sidebar-field">
            <label>Client logo position</label>
            <SearchableSelect className="sidebar-select" style={fieldStyle} value={billing.client_logo_position} onChange={(e) => setBilling({ ...billing, client_logo_position: e.target.value })}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </SearchableSelect>
            <p style={{ margin: '0.25rem 0 0', color: '#94a3b8', fontSize: '0.74rem', lineHeight: 1.4 }}>
              Horizontal position of the client logo inside the Bill To block.
            </p>
          </div>
          <div className="sidebar-field">
            <label>Client billing address position</label>
            <SearchableSelect className="sidebar-select" style={fieldStyle} value={billing.client_billing_address_position} onChange={(e) => setBilling({ ...billing, client_billing_address_position: e.target.value })}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </SearchableSelect>
            <p style={{ margin: '0.25rem 0 0', color: '#94a3b8', fontSize: '0.74rem', lineHeight: 1.4 }}>
              Horizontal position of the client&apos;s Bill To block on exported documents and invoices.
            </p>
          </div>
        </div>
        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="primary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }} disabled={saving} onClick={handleSavePresentationSettings}>
            <Check size={16} /> {saving ? 'Saving...' : 'Save Presentation Preferences'}
          </button>
        </div>
      </div>

      {/* Itinerary presentation */}
      <div className="admin-card" style={{ marginTop: '1.5rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FileText size={18} color="#0d7478" /> Itinerary Presentation
          </h2>
          <p style={{ margin: '0.35rem 0 0', color: '#64748b', fontSize: '0.85rem' }}>
            Layout of the client itinerary document, sent with quotations and provisional bookings.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          <div className="sidebar-field">
            <label>Pricing breakdown position</label>
            <SearchableSelect className="sidebar-select" style={fieldStyle} value={billing.itinerary_pricing_position} onChange={(e) => setBilling({ ...billing, itinerary_pricing_position: e.target.value })}>
              <option value="above">Above the day-by-day routing</option>
              <option value="below">Below the day-by-day routing</option>
            </SearchableSelect>
            <p style={{ margin: '0.25rem 0 0', color: '#94a3b8', fontSize: '0.74rem', lineHeight: 1.4 }}>
              Where the pricing breakdown sits. The day-by-day routing always appears on the itinerary.
            </p>
          </div>
        </div>

        <div className="sidebar-field" style={{ marginTop: '1rem' }}>
          <label>Terms &amp; Conditions</label>
          <textarea
            className="sidebar-select"
            style={{ ...fieldStyle, minHeight: '96px', resize: 'vertical' }}
            value={billing.itinerary_terms}
            onChange={(e) => setBilling({ ...billing, itinerary_terms: e.target.value })}
            placeholder="Booking terms, cancellation policy, payment terms..."
          />
          <p style={{ margin: '0.25rem 0 0', color: '#94a3b8', fontSize: '0.74rem', lineHeight: 1.4 }}>
            Default text used on every itinerary. Itineraries that set their own terms keep theirs.
          </p>
        </div>
        <div className="sidebar-field" style={{ marginTop: '1rem' }}>
          <label>Terms position</label>
          <SearchableSelect className="sidebar-select" style={fieldStyle} value={billing.itinerary_terms_position} onChange={(e) => setBilling({ ...billing, itinerary_terms_position: e.target.value })}>
            <option value="under_day_by_day">Under the day-by-day routing</option>
            <option value="before_pricing">Before the pricing breakdown</option>
            <option value="after_pricing">After the pricing breakdown</option>
          </SearchableSelect>
        </div>

        <div className="sidebar-field" style={{ marginTop: '1rem' }}>
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.86rem', marginBottom: '0.45rem' }}>
            Inclusions
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.55rem' }}>
            <input
              type="checkbox"
              id="include-default-inclusions"
              checked={billing.itinerary_include_default_inclusions === true}
              onChange={(e) => setBilling({ ...billing, itinerary_include_default_inclusions: e.target.checked })}
              style={{ width: '16px', height: '16px', accentColor: '#0d7478', cursor: 'pointer' }}
            />
            <label htmlFor="include-default-inclusions" style={{ fontSize: '0.85rem', color: '#334155', cursor: 'pointer' }}>
              Include the default inclusions text below on the itinerary
            </label>
          </div>
          <textarea
            className="sidebar-select"
            style={{ ...fieldStyle, minHeight: '96px', resize: 'vertical' }}
            value={billing.itinerary_inclusions}
            onChange={(e) => setBilling({ ...billing, itinerary_inclusions: e.target.value })}
            placeholder="General inclusions applied to every itinerary..."
          />
          <p style={{ margin: '0.25rem 0 0', color: '#94a3b8', fontSize: '0.74rem', lineHeight: 1.4 }}>
            The itinerary always lists each day&rsquo;s services automatically. Tick the box to also print the default text above that list; untick it to show the generated list on its own.
          </p>
        </div>
        <div className="sidebar-field" style={{ marginTop: '1rem' }}>
          <label>Inclusions position</label>
          <SearchableSelect className="sidebar-select" style={fieldStyle} value={billing.itinerary_inclusions_position} onChange={(e) => setBilling({ ...billing, itinerary_inclusions_position: e.target.value })}>
            <option value="under_day_by_day">Under the day-by-day routing</option>
            <option value="before_pricing">Before the pricing breakdown</option>
            <option value="after_pricing">After the pricing breakdown</option>
          </SearchableSelect>
        </div>

        <div className="sidebar-field" style={{ marginTop: '1rem' }}>
          <label>Exclusions</label>
          <textarea
            className="sidebar-select"
            style={{ ...fieldStyle, minHeight: '96px', resize: 'vertical' }}
            value={billing.itinerary_exclusions}
            onChange={(e) => setBilling({ ...billing, itinerary_exclusions: e.target.value })}
            placeholder="What is not included..."
          />
        </div>
        <div className="sidebar-field" style={{ marginTop: '1rem' }}>
          <label>Exclusions position</label>
          <SearchableSelect className="sidebar-select" style={fieldStyle} value={billing.itinerary_exclusions_position} onChange={(e) => setBilling({ ...billing, itinerary_exclusions_position: e.target.value })}>
            <option value="under_day_by_day">Under the day-by-day routing</option>
            <option value="before_pricing">Before the pricing breakdown</option>
            <option value="after_pricing">After the pricing breakdown</option>
          </SearchableSelect>
          <p style={{ margin: '0.25rem 0 0', color: '#94a3b8', fontSize: '0.74rem', lineHeight: 1.4 }}>
            Blocks keep a fixed order (Terms &amp; Conditions, Inclusions, Exclusions). Blocks sharing the same position appear in that order. Where no position fits, a block falls back to under the day-by-day routing.
          </p>
        </div>
        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="primary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }} disabled={saving} onClick={handleSaveItinerarySettings}>
            <Check size={16} /> {saving ? 'Saving...' : 'Save Itinerary Presentation'}
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
              Add one account per currency. An invoice uses the active account matching its currency. Deactivated accounts are hidden from invoices, and a currency with no active account cannot be invoiced.
            </p>
          </div>
          <button type="button" className="primary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }} onClick={openAddBank}>
            <Plus size={16} /> Add Bank Account
          </button>
        </div>

        {bankAccounts.length > 0 && !bankAccounts.some((b) => b.is_active) && (
          <div style={{ marginBottom: '1rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px', padding: '0.8rem 1rem', display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
            <AlertTriangle size={16} color="#b91c1c" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <strong style={{ color: '#b91c1c', fontSize: '0.87rem' }}>No active bank account</strong>
              <p style={{ margin: '0.2rem 0 0', color: '#7f1d1d', fontSize: '0.82rem', lineHeight: 1.5 }}>
                All bank accounts are deactivated, so invoices cannot be generated until you activate one. Itineraries can still be built in any currency.
              </p>
            </div>
          </div>
        )}

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
                <tr key={b.id} style={b.is_active ? undefined : { opacity: 0.6, background: '#f8fafc' }}>
                  <td style={{ fontWeight: 700 }}>{b.label || '—'}</td>
                  <td style={{ fontWeight: 700, color: b.is_active ? '#0d7478' : '#94a3b8' }}>{b.currency_code}</td>
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
                    {b.is_active ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: '#ecfdf5', color: '#047857', padding: '0.25rem 0.6rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700 }}>
                        Active
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: '#f1f5f9', color: '#64748b', padding: '0.25rem 0.6rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700 }}>
                        Inactive &mdash; hidden from invoices
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
                      <button type="button" className="icon-btn outline" title="Edit" onClick={() => openEditBank(b)}>
                        <Edit3 size={15} />
                      </button>
                      <button
                        type="button"
                        title={b.is_active ? 'Deactivate — this account will no longer be used on invoices' : 'Activate — invoices can use this account again'}
                        disabled={saving}
                        onClick={() => requestToggleBankActive(b)}
                        style={{
                          width: '30px', height: '30px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          borderRadius: '8px', cursor: 'pointer',
                          border: `1px solid ${b.is_active ? '#fca5a5' : '#86efac'}`,
                          background: b.is_active ? '#fef2f2' : '#f0fdf4',
                          color: b.is_active ? '#b91c1c' : '#15803d'
                        }}
                      >
                        <Power size={15} />
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
              For South African tenants this tax is currency-bound to ZAR — services in any other currency are always 0 / No Tax.
              Tenants outside South Africa define their own tax type and percentage, applied to every service regardless of currency. The default is 15% VAT — set your region&apos;s own tax types here.
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
                <th>Revenue Service</th>
                <th>Applies To</th>
                <th>Default</th>
                <th>Active</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {taxRates.map((t) => (
                <tr key={t.id} style={t.is_active ? undefined : { opacity: 0.6, background: '#f8fafc' }}>
                  <td style={{ fontWeight: 700 }}>{t.name}</td>
                  <td>{t.code}</td>
                  <td style={{ fontWeight: 700, color: t.is_active ? '#0d7478' : '#94a3b8' }}>{Number(t.rate)}%</td>
                  <td>{t.country || 'South Africa'}</td>
                  <td>{t.revenue_agency || (t.country === 'South Africa' ? 'SARS' : '—')}</td>
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
                    {t.is_active ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: '#ecfdf5', color: '#047857', padding: '0.25rem 0.6rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700 }}>
                        Active
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: '#f1f5f9', color: '#64748b', padding: '0.25rem 0.6rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700 }}>
                        Inactive &mdash; 0% applied
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
                      <button type="button" className="icon-btn outline" title="Edit" onClick={() => openEdit(t)}>
                        <Edit3 size={15} />
                      </button>
                      <button
                        type="button"
                        title={t.is_active ? 'Deactivate — tax will not be applied' : 'Activate — tax will be applied'}
                        disabled={saving}
                        onClick={() => handleToggleActive(t)}
                        style={{
                          width: '30px', height: '30px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          borderRadius: '8px', cursor: 'pointer',
                          border: `1px solid ${t.is_active ? '#fca5a5' : '#86efac'}`,
                          background: t.is_active ? '#fef2f2' : '#f0fdf4',
                          color: t.is_active ? '#b91c1c' : '#15803d'
                        }}
                      >
                        <Power size={15} />
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
                  <label>Revenue Service Agency</label>
                  <input className="sidebar-select" style={fieldStyle} value={form.revenueAgency} onChange={(e) => setForm({ ...form, revenueAgency: e.target.value })} placeholder="e.g. SARS, HMRC, IRS, Tax Authority" />
                  <small style={{ display: 'block', marginTop: '0.3rem', color: '#94a3b8', fontSize: '0.75rem' }}>
                    Used on non-ZAR documents for the heading &ldquo;Net Tax to [Agency]&rdquo;. ZAR documents always show SARS.
                  </small>
                </div>
                <div className="sidebar-field">
                  <label>Applies To</label>
                  <SearchableSelect className="sidebar-select" style={fieldStyle} value={form.appliesTo} onChange={(e) => setForm({ ...form, appliesTo: e.target.value })}>
                    {APPLIES_TO_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt === 'all' ? 'All services' : opt.replace(/^\w/, (c) => c.toUpperCase())}</option>
                    ))}
                  </SearchableSelect>
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
                    <SearchableSelect className="sidebar-select" style={fieldStyle} value={bankForm.currency_code} onChange={(e) => setBankForm({ ...bankForm, currency_code: e.target.value })}>
                      {(currencies.length ? currencies : [{ code: 'ZAR', name: 'South African Rand' }]).map((c) => (
                        <option key={c.code} value={c.code}>{c.code}{c.name ? ` — ${c.name}` : ''}</option>
                      ))}
                    </SearchableSelect>
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

      {confirmDialog && <ConfirmDialog {...confirmDialog} />}

      {/* Deactivate bank account confirmation */}
      {bankConfirm && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h2>Deactivate bank account?</h2>
              <button className="close-btn" onClick={() => setBankConfirm(null)}><X size={20} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              <p style={{ margin: 0, color: '#334155', fontSize: '0.9rem', lineHeight: 1.55 }}>
                <strong>{bankConfirm.account.label || bankConfirm.account.currency_code}</strong>
                {' '}({bankConfirm.account.currency_code})
              </p>
              <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '0.75rem 0.9rem' }}>
                <AlertTriangle size={16} color="#b91c1c" style={{ flexShrink: 0, marginTop: '2px' }} />
                <p style={{ margin: 0, color: '#7f1d1d', fontSize: '0.84rem', lineHeight: 1.5 }}>
                  {bankConfirm.message}
                </p>
              </div>
              <div className="form-actions" style={{ marginTop: 0 }}>
                <button type="button" className="secondary-btn" onClick={() => setBankConfirm(null)}>Cancel</button>
                <button
                  type="button"
                  className="primary-btn"
                  style={{ flex: 1, background: '#b91c1c', borderColor: '#b91c1c', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}
                  disabled={saving}
                  onClick={async () => {
                    const acc = bankConfirm.account;
                    setBankConfirm(null);
                    await handleToggleBankActive(acc);
                  }}
                >
                  <Power size={15} /> {saving ? 'Deactivating...' : 'Deactivate'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
