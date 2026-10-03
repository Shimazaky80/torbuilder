import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Backpack, Search, Plus, Edit3, Trash2, X, ImagePlus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../hooks/useConfirm';
import ConfirmDialog from '../components/ConfirmDialog';

const emptyDraft = () => ({ name: '', description: '', markup: '0', periods: [{ from: '', to: '' }], cover: null, gallery: [] });
const dateLabel = (iso) => iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
const flatBasis = (basis) => /per_trip|per_vehicle|per_room|flat/i.test(String(basis || ''));
const estimatePackage = (pkg) => {
  const days = pkg.package_days || [];
  const services = days.flatMap((day) => day.package_day_items || []).filter((item) => item.is_included !== false);
  const currencies = [...new Set(services.map((item) => item.currency_code || 'ZAR'))];
  const passengerOptions = pkg.package_pax_options || [];
  if (!services.length || !passengerOptions.length) return [];
  return currencies.map((currency) => {
    const estimates = passengerOptions.map((option) => {
      const pax = Math.max(1, Number(option.adults || 0) + Number(option.children || 0));
      const total = services.filter((item) => (item.currency_code || 'ZAR') === currency).reduce((sum, item) => {
        const quantity = Number(item.quantity) || 1;
        const unitPrice = Number(item.unit_price) || 0;
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
        supabase.from('package_pax_options').select('*').in('package_id', packageIds).order('adults'),
        supabase.from('package_days').select('*').in('package_id', packageIds).order('day_number')
      ]);
      if (periodsRes.error) throw periodsRes.error;
      if (paxRes.error) throw paxRes.error;
      if (daysRes.error) throw daysRes.error;
      const dayIds = (daysRes.data || []).map((day) => day.id);
      const itemsRes = dayIds.length
        ? await supabase.from('package_day_items').select('package_day_id, unit_price, quantity, currency_code, rate_basis, is_included').in('package_day_id', dayIds)
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

  const changePeriod = (index, field, value) => setDraft((d) => ({ ...d, periods: d.periods.map((p, i) => i === index ? { ...p, [field]: value } : p) }));

  const uploadImage = async (file, packageId, suffix) => {
    if (!file) return null;
    const safe = file.name.toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
    const path = `${companyId}/${packageId}/${Date.now()}-${suffix}-${safe}`;
    const { error } = await supabase.storage.from('contracts').upload(path, file, { upsert: true, cacheControl: '3600' });
    if (error) throw error;
    return supabase.storage.from('contracts').getPublicUrl(path).data.publicUrl;
  };

  const openEdit = async (pkg) => {
    const { data: periods, error } = await supabase.from('package_validity_periods').select('*').eq('package_id', pkg.id).order('valid_from');
    if (error) { showToast(`Could not load validity dates: ${error.message}`, 'error'); return; }
    setEditingPkg(pkg);
    setDraft({ name: pkg.name || '', description: pkg.description || '', markup: String(pkg.default_markup_percentage || 0), periods: (periods || []).map((p) => ({ from: p.valid_from, to: p.valid_to })), cover: null, gallery: [] });
    setModal(true);
  };

  const create = async (event) => {
    event.preventDefault();
    if (!companyId) { showToast('Company not found', 'error'); return; }
    if (!draft.name.trim()) { showToast('Enter a package name', 'warning'); return; }
    const periods = draft.periods.filter((p) => p.from && p.to);
    if (periods.length === 0 || periods.length !== draft.periods.length) { showToast('Add at least one complete validity date range', 'warning'); return; }
    if (periods.some((p) => p.to < p.from)) { showToast('Each validity end date must be on or after its start date', 'warning'); return; }
    setSaving(true);
    try {
      if (editingPkg) {
        let coverUrl = editingPkg.cover_image_url || null;
        if (draft.cover) coverUrl = await uploadImage(draft.cover, editingPkg.id, 'cover');
        let galleryUrls = editingPkg.gallery_image_urls || [];
        if (draft.gallery.length) galleryUrls = await Promise.all(draft.gallery.map((f, i) => uploadImage(f, editingPkg.id, `gallery-${i + 1}`)));
        const { error: updateErr } = await supabase.from('packages').update({ name: draft.name.trim(), description: draft.description, default_markup_percentage: Number(draft.markup) || 0, cover_image_url: coverUrl, gallery_image_urls: galleryUrls }).eq('id', editingPkg.id);
        if (updateErr) throw updateErr;
        const { error: deletePeriodsError } = await supabase.from('package_validity_periods').delete().eq('package_id', editingPkg.id);
        if (deletePeriodsError) throw deletePeriodsError;
        const periodRows = periods.map(({ from, to }) => ({ package_id: editingPkg.id, valid_from: from, valid_to: to }));
        if (periodRows.length) { const { error: insertPeriodsError } = await supabase.from('package_validity_periods').insert(periodRows); if (insertPeriodsError) throw insertPeriodsError; }
        setModal(false); setEditingPkg(null); setDraft(emptyDraft()); await load(); showToast('Package details updated', 'success'); return;
      }
      const { data: pkg, error } = await supabase.from('packages').insert({
        company_id: companyId, name: draft.name.trim(), description: draft.description,
        default_markup_percentage: Number(draft.markup) || 0
      }).select().single();
      if (error) throw error;
      const completePeriods = periods.map(({ from, to }) => ({ package_id: pkg.id, valid_from: from, valid_to: to }));
      if (completePeriods.length) {
        const { error: periodError } = await supabase.from('package_validity_periods').insert(completePeriods);
        if (periodError) throw periodError;
      }
      const coverUrl = await uploadImage(draft.cover, pkg.id, 'cover');
      const galleryUrls = await Promise.all(draft.gallery.map((f, i) => uploadImage(f, pkg.id, `gallery-${i + 1}`)));
      if (coverUrl || galleryUrls.length) {
        const { error: imageError } = await supabase.from('packages').update({ cover_image_url: coverUrl, gallery_image_urls: galleryUrls }).eq('id', pkg.id);
        if (imageError) throw imageError;
      }
      setModal(false); setEditingPkg(null); setDraft(emptyDraft());
      navigate(`/packages/builder/${pkg.id}`, { state: { packageId: pkg.id, packageName: pkg.name, markup: Number(draft.markup) || 0 } });
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
        <thead><tr><th>Package</th><th>Validity</th><th>Passenger options</th><th>Duration</th><th>Services</th><th>Est. cost</th><th>Currencies</th><th>Default markup</th><th>Actions</th></tr></thead>
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
        return <tr key={pkg.id}>
          <td><button type="button" className="package-list-name" onClick={() => navigate(`/packages/view/${pkg.id}`)}>{pkg.name}</button></td>
          <td>{periods.length ? periods.map((p) => `${dateLabel(p.valid_from)} – ${dateLabel(p.valid_to)}`).join('; ') : <span className="package-list-muted">Not set</span>}</td>
          <td>{pax.length ? pax.map((x) => `${x.adults}A${x.children ? ` + ${x.children}C` : ''}`).join(', ') : <span className="package-list-muted">Not set</span>}</td>
          <td>{pkg.package_days?.length || 0} days</td>
          <td>{packageServices.length}</td>
          <td>{estimatedCosts.length ? <span title="Cheapest estimated per-person price across the saved passenger options">{estimatedCosts.map(({ currency, amount }) => `${currency} ${amount.toFixed(2)}`).join(' · ')} <small className="package-list-muted">pp from</small></span> : <span className="package-list-muted">Not available</span>}</td>
          <td>{currencies.size ? [...currencies].join(', ') : <span className="package-list-muted">—</span>}</td>
          <td><strong>{Number(pkg.default_markup_percentage) || 0}%</strong></td>
          <td><div className="action-buttons">
            <button className="action-btn" title="Edit package details" onClick={() => openEdit(pkg)}><Edit3 size={16} /></button>
            <button className="action-btn delete" title="Delete package" onClick={() => remove(pkg)}><Trash2 size={16} /></button>
          </div></td>
        </tr>;
      })}
        </tbody>
      </table>
    </div>

    {modal && <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) setModal(false); }}><form className="modal-content package-create-modal" onSubmit={create}>
      <div className="modal-header"><div><h2>{editingPkg ? 'Edit Package' : 'Create Package'}</h2><p>{editingPkg ? 'Update package details and validity periods.' : 'Set the package details, then build its day-by-day itinerary.'}</p></div><button type="button" className="close-btn" onClick={() => { setModal(false); setEditingPkg(null); }} disabled={saving}><X size={20} /></button></div>
      <div className="package-form-scroll">
        <label className="package-field"><span>Package name *</span><input required maxLength={160} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Cape Winelands Escape" /></label>
        <label className="package-field"><span>Description</span><textarea rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Describe the experience for your team and clients" /></label>
        <div className="package-upload-grid">
          <label className="package-upload"><ImagePlus size={19} /><span>Cover image (optional)</span><input type="file" accept="image/*" onChange={(e) => setDraft({ ...draft, cover: e.target.files?.[0] || null })} />{draft.cover && <small>{draft.cover.name}</small>}</label>
          <label className="package-upload"><ImagePlus size={19} /><span>Gallery images (optional)</span><input type="file" accept="image/*" multiple onChange={(e) => setDraft({ ...draft, gallery: [...(e.target.files || [])] })} />{draft.gallery.length > 0 && <small>{draft.gallery.length} image(s) selected</small>}</label>
        </div>
        <div className="package-field"><span>Validity date ranges</span>{draft.periods.map((period, i) => <div className="package-period" key={i}><input aria-label="Valid from" type="date" value={period.from} onChange={(e) => changePeriod(i, 'from', e.target.value)} /><span>to</span><input aria-label="Valid to" type="date" value={period.to} onChange={(e) => changePeriod(i, 'to', e.target.value)} />{draft.periods.length > 1 && <button type="button" className="package-remove-period" onClick={() => setDraft((d) => ({ ...d, periods: d.periods.filter((_, j) => j !== i) }))}><X size={15} /></button>}</div>)}<button type="button" className="package-add-period" onClick={() => setDraft((d) => ({ ...d, periods: [...d.periods, { from: '', to: '' }] }))}><Plus size={14} /> Add validity period</button></div>
        <label className="package-field"><span>Default markup for direct clients (%)</span><input type="number" min="0" step="0.01" value={draft.markup} onChange={(e) => setDraft({ ...draft, markup: e.target.value })} /></label>
      </div>
      <div className="package-modal-actions"><button type="button" className="secondary-btn" onClick={() => { setModal(false); setEditingPkg(null); }} disabled={saving}>Cancel</button><button type="submit" className="primary-btn" disabled={saving}>{saving ? 'Saving…' : editingPkg ? 'Save package details' : 'Create and build itinerary'}</button></div>
    </form></div>}
    <ConfirmDialog {...dialogProps} />
  </div>;
};
