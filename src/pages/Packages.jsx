import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Backpack, Search, Plus, Edit3, ListTree, Trash2, X, ImagePlus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useCurrencies } from '../hooks/useCurrencies';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../hooks/useConfirm';
import ConfirmDialog from '../components/ConfirmDialog';
import { packageBandLabel } from '../lib/packagePricing';

const emptyDraft = () => ({ name: '', description: '', currency: 'ZAR', cover: null, clearCover: false });
const dateLabel = (iso) => iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
const flatBasis = (basis) => /per_trip|per_vehicle|per_room|flat/i.test(String(basis || ''));
const estimatePackage = (pkg) => {
  const days = pkg.package_days || [];
  const allItems = days.flatMap((day) => day.package_day_items || []);
  /* This is a "from" figure, so it cannot resolve a band's own itinerary: band-only lines
     are left out rather than charged to every band, which would overstate the price. */
  const services = allItems.filter((item) => item.is_included !== false && !item.tier_key);
  const currencies = [...new Set(allItems.map((item) => item.currency_code || 'ZAR'))];
  const passengerOptions = pkg.package_pax_options || [];
  if (!services.length || !passengerOptions.length) return [];
  return currencies.map((currency) => {
    const estimates = passengerOptions.map((option) => {
      /* A band is quoted at its ceiling, so that is the party size it is priced for. */
      const pax = Math.max(1, Number(option.max_pax) || Number(option.pax) || Number(option.adults || 0) + Number(option.children || 0));
      const total = services.filter((item) => (item.currency_code || 'ZAR') === currency).reduce((sum, item) => {
        const quantity = Number(item.quantity) || 1;
        const unitPrice = Number(item.unit_price) || 0;
        if (String(item.rate_basis || '').toLowerCase() === 'per_vehicle') {
          const capacity = Math.max(1, Number(item.vehicle_capacity) || 0);
          const vehicleCount = capacity >= pax ? 1 : Math.ceil(pax / capacity);
          return sum + unitPrice * quantity * vehicleCount / pax;
        }
        return sum + (flatBasis(item.rate_basis) ? unitPrice * quantity / pax : unitPrice * quantity);
      }, 0);
      return total;
    });
    return { currency, amount: Math.min(...estimates) };
  });
};

export const Packages = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [dialogProps, confirm] = useConfirm();
  const [rows, setRows] = useState([]);
  const [companyId, setCompanyId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState(false);
  const [editingPkg, setEditingPkg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const { currencies } = useCurrencies();
  const lastLoadError = useRef('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile, error: profileErr } = await supabase.from('profiles').select('company_id').eq('id', user.id).single();
      if (profileErr) throw profileErr;
      setCompanyId(profile?.company_id || null);
      if (!profile?.company_id) { setRows([]); return; }
      const { data: packages, error } = await supabase.from('packages').select('*').eq('company_id', profile.company_id).order('created_at', { ascending: false });
      if (error) throw error;
      const packageIds = (packages || []).map((pkg) => pkg.id);
      if (!packageIds.length) { setRows([]); return; }

      // Fetch related rows separately instead of relying on PostgREST's cached
      // foreign-key relationships. This still works immediately after schema
      // changes, before the API relationship cache has refreshed.
      const [periodsRes, paxRes, daysRes] = await Promise.all([
        supabase.from('package_validity_periods').select('*').in('package_id', packageIds).order('valid_from'),
        supabase.from('package_pax_options').select('*').in('package_id', packageIds).order('pax'),
        supabase.from('package_days').select('*').in('package_id', packageIds).order('day_number')
      ]);
      if (periodsRes.error) throw periodsRes.error;
      if (paxRes.error) throw paxRes.error;
      if (daysRes.error) throw daysRes.error;
      const dayIds = (daysRes.data || []).map((day) => day.id);
      const itemsRes = dayIds.length
        ? await supabase.from('package_day_items').select('package_day_id, unit_price, quantity, currency_code, rate_basis, vehicle_capacity, is_included').in('package_day_id', dayIds)
        : { data: [], error: null };
      if (itemsRes.error) throw itemsRes.error;

      const periodsByPackage = new Map();
      (periodsRes.data || []).forEach((row) => periodsByPackage.set(row.package_id, [...(periodsByPackage.get(row.package_id) || []), row]));
      const paxByPackage = new Map();
      (paxRes.data || []).forEach((row) => paxByPackage.set(row.package_id, [...(paxByPackage.get(row.package_id) || []), row]));
      const itemsByDay = new Map();
      (itemsRes.data || []).forEach((row) => itemsByDay.set(row.package_day_id, [...(itemsByDay.get(row.package_day_id) || []), row]));
      const daysByPackage = new Map();
      (daysRes.data || []).forEach((row) => daysByPackage.set(row.package_id, [...(daysByPackage.get(row.package_id) || []), {
        ...row,
        package_day_items: itemsByDay.get(row.id) || []
      }]));
      setRows((packages || []).map((pkg) => ({
        ...pkg,
        package_validity_periods: periodsByPackage.get(pkg.id) || [],
        package_pax_options: paxByPackage.get(pkg.id) || [],
        package_days: daysByPackage.get(pkg.id) || []
      })));
      lastLoadError.current = '';
    } catch (e) {
      const message = String(e?.message || e);
      const packageTableMissing = e?.code === '42P01'
        || (/public\.packages/i.test(message) && /(does not exist|not found|schema cache)/i.test(message));
      const userMessage = packageTableMissing
        ? 'Packages database setup is missing. Apply supabase/migrations/20261111_reusable_packages.sql in Supabase, then refresh this page.'
        : `Could not load packages: ${message}`;
      if (lastLoadError.current !== userMessage) showToast(userMessage, 'error');
      lastLoadError.current = userMessage;
    } finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((p) => `${p.name} ${p.description}`.toLowerCase().includes(q));
  }, [rows, query]);

  const uploadImage = async (file, packageId) => {
    if (!file) return null;
    const safe = file.name.toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
    const path = `${companyId}/${packageId}/${Date.now()}-cover-${safe}`;
    const { error } = await supabase.storage.from('contracts').upload(path, file, { upsert: true, cacheControl: '3600' });
    if (error) throw error;
    return supabase.storage.from('contracts').getPublicUrl(path).data.publicUrl;
  };

  /* A package already carrying priced services cannot be moved to another currency. Doing
     so would leave every saved line in the old currency while the package claimed the new
     one, which is the exact state the one-currency rule exists to prevent. */
  const currenciesAlreadyUsed = (pkg) => [...new Set((pkg?.package_days || [])
    .flatMap((day) => day.package_day_items || [])
    .filter((item) => item.is_included !== false && item.currency_code)
    .map((item) => String(item.currency_code).toUpperCase()))];

  /* Currencies the company has switched on, with the draft's own choice kept in the list so a
   package saved under a currency that has since been deactivated still shows it selected
   rather than silently reading as something else. */
const currencyOptions = useMemo(() => {
  const known = currencies.map((currency) => ({
    code: String(currency.code || '').toUpperCase(),
    name: currency.name || currency.code || ''
  })).filter((currency) => currency.code);
  const chosen = String(draft.currency || '').toUpperCase();
  return known.some((currency) => currency.code === chosen)
    ? known
    : [...known, { code: chosen || 'ZAR', name: 'No longer active' }];
}, [currencies, draft.currency]);

const lockedCurrencies = editingPkg ? currenciesAlreadyUsed(editingPkg) : [];

  const openEdit = (pkg) => {
    setEditingPkg(pkg);
    setDraft({
      name: pkg.name || '',
      description: pkg.description || '',
      currency: String(pkg.currency_code || 'ZAR').toUpperCase(),
      cover: null,
      clearCover: false
    });
    setModal(true);
  };

  const create = async (event) => {
    event.preventDefault();
    if (!companyId) { showToast('Company not found', 'error'); return; }
    if (!draft.name.trim()) { showToast('Enter a package name', 'warning'); return; }
    const currency = String(draft.currency || 'ZAR').trim().toUpperCase();
    if (lockedCurrencies.length && !lockedCurrencies.includes(currency)) {
      showToast(`This package already has ${lockedCurrencies.join(', ')} priced on it, so it cannot be changed to ${currency}. Remove those services first, or create a new package.`, 'warning');
      return;
    }
    setSaving(true);
    try {
      if (editingPkg) {
        const coverUrl = draft.cover
          ? await uploadImage(draft.cover, editingPkg.id)
          : draft.clearCover ? null : editingPkg.cover_image_url || null;
        const { error: updateErr } = await supabase.from('packages').update({
          name: draft.name.trim(),
          description: draft.description.trim(),
          currency_code: currency,
          cover_image_url: coverUrl,
          default_markup_percentage: 0
        }).eq('id', editingPkg.id).eq('company_id', companyId);
        if (updateErr) throw updateErr;
        setModal(false); setEditingPkg(null); setDraft(emptyDraft()); await load(); showToast('Package details updated', 'success'); return;
      }
      const { data: pkg, error } = await supabase.from('packages').insert({
        company_id: companyId, name: draft.name.trim(), description: draft.description,
        currency_code: currency,
        default_markup_percentage: 0
      }).select().single();
      if (error) throw error;
      const coverUrl = await uploadImage(draft.cover, pkg.id);
      if (coverUrl) {
        const { error: imageError } = await supabase.from('packages').update({ cover_image_url: coverUrl }).eq('id', pkg.id).eq('company_id', companyId);
        if (imageError) throw imageError;
      }
      setModal(false); setEditingPkg(null); setDraft(emptyDraft());
      navigate(`/packages/builder/${pkg.id}`, { state: { packageId: pkg.id, packageName: pkg.name } });
    } catch (e) { showToast(`Could not create package: ${e.message}`, 'error'); }
    finally { setSaving(false); }
  };

  const remove = async (pkg) => {
    const ok = await confirm({ title: 'Delete package?', message: `“${pkg.name}” and its days, validity periods, and passenger options will be deleted.`, confirmLabel: 'Delete package', destructive: true });
    if (!ok) return;
    const { error } = await supabase.from('packages').delete().eq('id', pkg.id);
    if (error) showToast(`Could not delete package: ${error.message}`, 'error');
    else { setRows((prev) => prev.filter((p) => p.id !== pkg.id)); showToast('Package deleted', 'success'); }
  };

  return <div className="super-admin-page">
    <header className="page-header packages-page-header">
      <div className="header-title"><Backpack className="header-icon" /><div><h1>Packages</h1><p>Create and manage reusable tour packages</p></div></div>
      <button className="primary-btn" onClick={() => { setEditingPkg(null); setDraft(emptyDraft()); setModal(true); }}><Plus size={17} /> Create Package</button>
    </header>
    <div className="admin-table-container packages-table-container">
      <div className="table-header-actions">
        <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Reusable packages</h2>
        <div className="packages-toolbar">
          <div className="packages-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search packages..." /></div>
          <span>{filtered.length} package{filtered.length === 1 ? '' : 's'}</span>
        </div>
      </div>
      <table className="admin-table">
        <thead><tr><th>Package</th><th>Validity</th><th>Passenger options</th><th>Duration</th><th>Services</th><th>Est. cost</th><th>Currencies</th><th>Library</th><th>Actions</th></tr></thead>
        <tbody>
          {loading ? <tr><td colSpan="9" className="text-center" style={{ padding: '3rem' }}>Loading packages...</td></tr>
            : filtered.length === 0 ? <tr><td colSpan="9" className="text-center" style={{ padding: '3rem', color: '#64748b' }}>
              <Backpack size={42} style={{ marginBottom: '.6rem', opacity: 0.4 }} />
              <h3 style={{ margin: '0 0 .35rem', color: '#1e293b' }}>{query ? 'No packages match your search' : 'No packages yet'}</h3>
              <p style={{ margin: 0 }}>{query ? 'Try a different search term.' : 'Create a package to start building a reusable tour.'}</p>
            </td></tr> : filtered.map((pkg) => {
        const periods = [...(pkg.package_validity_periods || [])].sort((a, b) => a.valid_from.localeCompare(b.valid_from));
        const currencies = new Set((pkg.package_days || []).flatMap((d) => d.package_day_items || []).filter((i) => i.is_included !== false).map((i) => i.currency_code || 'ZAR'));
        const pax = pkg.package_pax_options || [];
        const packageServices = (pkg.package_days || []).flatMap((day) => day.package_day_items || []);
        const estimatedCosts = estimatePackage(pkg);
        /* A band is one exact party size, so the label comes straight from the pricing engine rather
           than being rebuilt here. */
        const bandLabels = pax.map((x) => packageBandLabel({
          pax: Number(x.pax) || Number(x.max_pax) || Number(x.adults || 0) + Number(x.children || 0)
        })).sort();
        return <tr key={pkg.id}>
          <td><button type="button" className="package-list-name" onClick={() => navigate(`/packages/view/${pkg.id}`)}>{pkg.name}</button></td>
          <td>{periods.length ? periods.map((p) => `${dateLabel(p.valid_from)} – ${dateLabel(p.valid_to)}`).join('; ') : <span className="package-list-muted">Not set</span>}</td>
          <td>{bandLabels.length ? bandLabels.join(', ') : <span className="package-list-muted">Not set</span>}</td>
          <td>{pkg.package_days?.length || 0} days</td>
          <td>{packageServices.length}</td>
          <td>{estimatedCosts.length ? <span title="Cheapest estimated per-person price across the saved passenger options">{estimatedCosts.map(({ currency, amount }) => `${currency} ${amount.toFixed(2)}`).join(' · ')} <small className="package-list-muted">pp from</small></span> : <span className="package-list-muted">Not available</span>}</td>
          <td>{currencies.size ? [...currencies].join(', ') : <span className="package-list-muted">—</span>}</td>
          <td>{pkg.is_available_in_library ? 'Available' : 'Private'}</td>
          <td><div className="action-buttons">
            {/* Two different edits, kept apart: this opens the builder to change
                what is inside the package, the pencil next to it only renames the
                package and swaps its cover. */}
            <button className="action-btn" title="Edit package contents (days, items, pricing)" onClick={() => navigate(`/packages/builder/${pkg.id}`, { state: { packageId: pkg.id, packageName: pkg.name } })}><ListTree size={16} /></button>
            <button className="action-btn" title="Edit package name, overview or cover image" onClick={() => openEdit(pkg)}><Edit3 size={16} /></button>
            <button className="action-btn delete" title="Delete package" onClick={() => remove(pkg)}><Trash2 size={16} /></button>
          </div></td>
        </tr>;
      })}
        </tbody>
      </table>
    </div>

    {modal && <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) setModal(false); }}><form className="modal-content package-create-modal" onSubmit={create}>
      <div className="modal-header"><div><h2>{editingPkg ? 'Edit Package' : 'Create Package'}</h2><p>{editingPkg ? 'Update the package name, overview, or cover image.' : 'Add the basic details, then build the package.'}</p></div><button type="button" className="close-btn" onClick={() => { setModal(false); setEditingPkg(null); }} disabled={saving}><X size={20} /></button></div>
      <div className="package-form-scroll">
        <label className="package-field"><span>Package name *</span><input required maxLength={160} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Cape Winelands Escape" /></label>
        <label className="package-field package-currency-field"><span>Package currency *</span>
          <select required value={draft.currency} disabled={lockedCurrencies.length > 0} title={lockedCurrencies.length ? 'This package already has priced services in this currency, so it cannot change.' : 'The package is priced in this currency. The builder only offers library items priced in it.'} onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })}>
            {currencyOptions.map((currency) => <option key={currency.code} value={currency.code}>{currency.code} - {currency.name}</option>)}
          </select>
          <small className="package-currency-help">{lockedCurrencies.length
            ? `Locked to ${lockedCurrencies.join(', ')}: the package already has services priced in it.`
            : 'A package is priced in one currency. The builder only offers library items priced in this one.'}</small>
        </label>
        <label className="package-field"><span>Overview description (optional)</span><textarea rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="A short overview of this package" /></label>
        <label className="package-upload"><ImagePlus size={19} /><span>Cover image (optional)</span><input type="file" accept="image/*" onChange={(e) => setDraft({ ...draft, cover: e.target.files?.[0] || null, clearCover: false })} />{draft.cover && <small>{draft.cover.name}</small>}</label>
        {!draft.cover && editingPkg?.cover_image_url && !draft.clearCover && <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <img src={editingPkg.cover_image_url} alt="Current package cover" style={{ maxWidth: '8rem', maxHeight: '5rem', objectFit: 'cover', borderRadius: '8px' }} />
          <button type="button" className="secondary-btn" onClick={() => setDraft({ ...draft, clearCover: true })}>Remove cover image</button>
        </div>}
      </div>
      <div className="package-modal-actions"><button type="button" className="secondary-btn" onClick={() => { setModal(false); setEditingPkg(null); }} disabled={saving}>Cancel</button><button type="submit" className="primary-btn" disabled={saving}>{saving ? 'Saving…' : editingPkg ? 'Save package details' : 'Create package'}</button></div>
    </form></div>}
    <ConfirmDialog {...dialogProps} />
  </div>;
};
