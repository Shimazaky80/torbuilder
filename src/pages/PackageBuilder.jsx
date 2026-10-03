import { useCallback, useEffect, useMemo, useState } from 'react';
import SearchableSelect from '../components/SearchableSelect';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Search, Plus, Trash2, Save, Printer, CalendarDays, Users, ImagePlus } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { usePageGuard } from '../context/NavigationGuardContext';

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n, code) => `${code === 'ZAR' ? 'R' : `${code} `}${round(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const flatBasis = (basis) => /per_trip|per_vehicle|per_room|flat/i.test(String(basis || ''));

export const PackageBuilder = () => {
  const { state } = useLocation();
  const { packageId: routePackageId } = useParams();
  const packageId = state?.packageId || routePackageId;
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [pkg, setPkg] = useState(null);
  const [companyId, setCompanyId] = useState(null);
  const [days, setDays] = useState([]);
  const [paxOptions, setPaxOptions] = useState([]);
  const [library, setLibrary] = useState([]);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [selectedRates, setSelectedRates] = useState({});
  const [selectedDay, setSelectedDay] = useState(0);
  const [saving, setSaving] = useState(false);
  const [markup, setMarkup] = useState(Number(state?.markup) || 0);
  const [documentMarkup, setDocumentMarkup] = useState(null);
  const [terms, setTerms] = useState('');
  const [validityPeriods, setValidityPeriods] = useState([]);
  const [lastSavedKey, setLastSavedKey] = useState(null);
  const stateKey = useMemo(() => JSON.stringify({ days, markup }), [days, markup]);
  const dirty = Boolean(pkg && lastSavedKey !== null && stateKey !== lastSavedKey);

  const load = useCallback(async () => {
    if (!packageId) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', user.id).single();
      setCompanyId(profile?.company_id || null);
      const [pkgRes, dayRes, optionRes, billingRes, periodRes] = await Promise.all([
        supabase.from('packages').select('*').eq('id', packageId).single(),
        supabase.from('package_days').select('*').eq('package_id', packageId).order('day_number'),
        supabase.from('package_pax_options').select('*').eq('package_id', packageId).order('adults'),
        supabase.from('company_billing_settings').select('*').eq('company_id', profile?.company_id).maybeSingle(),
        supabase.from('package_validity_periods').select('*').eq('package_id', packageId).order('valid_from')
      ]);
      if (pkgRes.error) throw pkgRes.error;
      if (dayRes.error) throw dayRes.error;
      if (optionRes.error) throw optionRes.error;
      if (billingRes.error) throw billingRes.error;
      if (periodRes.error) throw periodRes.error;
      const packageDays = dayRes.data || [];
      const dayIds = packageDays.map((day) => day.id);
      const dayItemsRes = dayIds.length
        ? await supabase.from('package_day_items').select('*').in('package_day_id', dayIds).order('sort_order')
        : { data: [], error: null };
      if (dayItemsRes.error) throw dayItemsRes.error;
      setPkg(pkgRes.data); setMarkup(Number(pkgRes.data.default_markup_percentage) || 0); setDocumentMarkup(null);
      const itemsByDay = new Map();
      (dayItemsRes.data || []).forEach((row) => itemsByDay.set(row.package_day_id, [...(itemsByDay.get(row.package_day_id) || []), row]));
      const loadedDays = packageDays.map((d) => ({ ...d, services: itemsByDay.get(d.id) || [] }));
      setDays(loadedDays);
      setPaxOptions(optionRes.data || []); setTerms(billingRes.data?.itinerary_terms || '');
      setValidityPeriods(periodRes.data || []);
      setLastSavedKey(JSON.stringify({ days: loadedDays, markup: Number(pkgRes.data.default_markup_percentage) || 0 }));
      const usedIds = [...new Set((dayItemsRes.data || []).map((service) => service.item_id).filter(Boolean))];
      if (usedIds.length) {
        const [itemsRes, ratesRes] = await Promise.all([
          supabase.from('library_items').select('id,name,category,currency,pricing_model,supplier_id,child_age_ranges').in('id', usedIds),
          supabase.from('item_rates').select('*').in('item_id', usedIds)
        ]);
        const supplierIds = [...new Set((itemsRes.data || []).map((i) => i.supplier_id).filter(Boolean))];
        const suppliersRes = supplierIds.length ? await supabase.from('suppliers').select('id,name').in('id', supplierIds) : { data: [] };
        const supplierNames = new Map((suppliersRes.data || []).map((s) => [s.id, s.name]));
        setLibrary((itemsRes.data || []).map((item) => ({ ...item, supplier_name: supplierNames.get(item.supplier_id) || '', item_rates: (ratesRes.data || []).filter((r) => r.item_id === item.id) })));
      }
    } catch (e) { showToast(`Could not load package: ${e.message}`, 'error'); }
  }, [packageId, showToast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const find = async () => {
      const term = search.trim();
      if (!companyId || term.length < 2) { setResults([]); return; }
      const safe = term.replace(/[,()]/g, ' ').trim();
      const { data, error } = await supabase.from('library_items').select('id,name,category,description,currency,pricing_model,supplier_id,is_active').eq('company_id', companyId).eq('is_active', true).or(`name.ilike.%${safe}%,description.ilike.%${safe}%`).order('name').limit(20);
      if (error) { showToast(`Library search failed: ${error.message}`, 'error'); return; }
      const ids = (data || []).map((x) => x.id);
      const [ratesRes, suppliersRes] = await Promise.all([
        ids.length ? supabase.from('item_rates').select('*').in('item_id', ids) : Promise.resolve({ data: [] }),
        [...new Set((data || []).map((x) => x.supplier_id).filter(Boolean))].length ? supabase.from('suppliers').select('id,name').in('id', [...new Set((data || []).map((x) => x.supplier_id).filter(Boolean))]) : Promise.resolve({ data: [] })
      ]);
      const suppliers = new Map((suppliersRes.data || []).map((x) => [x.id, x.name]));
      const merged = (data || []).map((item) => ({ ...item, supplier_name: suppliers.get(item.supplier_id) || '', item_rates: (ratesRes.data || []).filter((r) => r.item_id === item.id) }));
      setResults(merged); setLibrary((prev) => [...new Map([...prev, ...merged].map((x) => [x.id, x])).values()]);
    };
    const timer = setTimeout(find, 280);
    return () => clearTimeout(timer);
  }, [search, companyId, showToast]);

  const persistDays = async (nextDays) => {
    if (!companyId || !pkg) return;
    setSaving(true);
    try {
      const { error: delErr } = await supabase.from('package_days').delete().eq('package_id', pkg.id);
      if (delErr) throw delErr;
      for (let i = 0; i < nextDays.length; i += 1) {
        const day = nextDays[i];
        const { data: dayRow, error } = await supabase.from('package_days').insert({ package_id: pkg.id, company_id: companyId, day_number: i + 1, notes: day.notes || null }).select().single();
        if (error) throw error;
        const rows = (day.services || []).map((s, order) => ({
          package_day_id: dayRow.id, company_id: companyId, item_id: s.item_id || null, rate_id: s.rate_id || null,
          item_name: s.item_name, category: s.category || '', supplier_name: s.supplier_name || '', currency_code: s.currency_code || 'ZAR',
          rate_basis: s.rate_basis || 'per_person', unit_cost: Number(s.unit_cost) || 0, unit_price: Number(s.unit_price) || 0,
          markup_percentage: Number(markup) || 0, quantity: Number(s.quantity) || 1, is_included: s.is_included !== false,
          notes: s.notes || null, sort_order: order
        }));
        if (rows.length) { const { error: itemErr } = await supabase.from('package_day_items').insert(rows); if (itemErr) throw itemErr; }
      }
      setDays(nextDays.map((d, i) => ({ ...d, day_number: i + 1 })));
      setLastSavedKey(JSON.stringify({ days: nextDays.map((d, i) => ({ ...d, day_number: i + 1 })), markup }));
      showToast('Package itinerary saved', 'success');
      return true;
    } catch (e) { showToast(`Could not save package itinerary: ${e.message}`, 'error'); return false; }
    finally { setSaving(false); }
  };

  const { requestNavigate } = usePageGuard('package-builder', 'this package', dirty, () => persistDays(days));

  const addDay = () => { setDays((prev) => [...prev, { day_number: prev.length + 1, notes: '', services: [] }]); setSelectedDay(days.length); };
  const addService = (item, rateId) => {
    const rates = item.item_rates || [];
    if (!rates.length) { showToast('This library item has no loaded rates. Add a rate in Library Items first.', 'warning'); return; }
    const rate = rates.find((r) => r.id === rateId) || rates[0];
    const markupValue = Number(markup) || 0;
    const service = {
      item_id: item.id, rate_id: rate.id, item_name: item.name, category: item.category,
      supplier_name: item.supplier_name, currency_code: rate.currency || item.currency || 'ZAR',
      rate_basis: rate.rate_basis || item.pricing_model || 'per_person',
      unit_cost: Number(rate.unit_cost) || 0, unit_price: round((Number(rate.unit_cost) || 0) * (1 + markupValue / 100)),
      markup_percentage: markupValue, quantity: 1, is_included: true
    };
    setDays((prev) => {
      if (!prev.length) return [{ day_number: 1, notes: '', services: [service] }];
      return prev.map((d, i) => i === selectedDay ? { ...d, services: [...d.services, service] } : d);
    });
    setSelectedRates((prev) => ({ ...prev, [item.id]: rate.id }));
  };

  const changeService = (dayIndex, serviceIndex, field, value) => setDays((prev) => prev.map((day, di) => {
    if (di !== dayIndex) return day;
    return {
      ...day,
      services: day.services.map((service, si) => {
        if (si !== serviceIndex) return service;
        if (field === 'rate_id') {
          const item = library.find((x) => x.id === service.item_id);
          const rate = item?.item_rates?.find((r) => r.id === value);
          if (!rate) return service;
          return {
            ...service,
            rate_id: rate.id,
            currency_code: rate.currency || item.currency || 'ZAR',
            rate_basis: rate.rate_basis || service.rate_basis,
            unit_cost: Number(rate.unit_cost) || 0,
            unit_price: round((Number(rate.unit_cost) || 0) * (1 + (Number(service.markup_percentage) || 0) / 100))
          };
        }
        return { ...service, [field]: value };
      })
    };
  }));

  const saveMarkup = async (value) => {
    const n = Number(value) || 0; setMarkup(n);
    const { error } = await supabase.from('packages').update({ default_markup_percentage: n }).eq('id', pkg.id);
    if (error) { showToast(error.message, 'error'); setMarkup(Number(pkg.default_markup_percentage) || 0); return; }
    setPkg((prev) => ({ ...prev, default_markup_percentage: n }));
    setLastSavedKey((prev) => {
      try { const baseline = JSON.parse(prev); return JSON.stringify({ ...baseline, markup: n }); }
      catch { return JSON.stringify({ days: [], markup: n }); }
    });
  };

  const addPaxOption = async () => {
    const adults = Number(document.getElementById('package-pax-adults')?.value) || 0;
    const children = Number(document.getElementById('package-pax-children')?.value) || 0;
    if (adults < 1) { showToast('Passenger pattern must include at least one adult', 'warning'); return; }
    const { data, error } = await supabase.from('package_pax_options').insert({ package_id: pkg.id, adults, children }).select().single();
    if (error) showToast(error.message, 'error'); else setPaxOptions((prev) => [...prev, data].sort((a, b) => a.adults - b.adults || a.children - b.children));
  };
  const removePaxOption = async (id) => { const { error } = await supabase.from('package_pax_options').delete().eq('id', id); if (error) showToast(error.message, 'error'); else setPaxOptions((prev) => prev.filter((x) => x.id !== id)); };
  const markupFor = useCallback((service) => documentMarkup === null
    ? (Number(service.markup_percentage) || 0)
    : (Number(documentMarkup) || 0), [documentMarkup]);

  const breakdown = useMemo(() => paxOptions.map((option) => {
    const totalPax = option.adults + option.children;
    const currencies = [...new Set(days.flatMap((d) => d.services.filter((s) => s.is_included !== false).map((s) => s.currency_code || 'ZAR')))];
    const groups = currencies.map((code) => {
      const services = days.flatMap((d) => d.services).filter((s) => s.is_included !== false && (s.currency_code || 'ZAR') === code);
      const priceAvailable = services.every((s) => {
        const item = library.find((x) => x.id === s.item_id);
        return Boolean(s.item_id && s.rate_id && item?.item_rates?.some((rate) => rate.id === s.rate_id));
      });
      const perPaxCharge = (s) => {
        const item = library.find((x) => x.id === s.item_id);
        const rate = item?.item_rates?.find((r) => r.id === s.rate_id);
        if (!rate) return 0;
        const basis = rate?.rate_basis || s.rate_basis || item?.pricing_model;
        const qty = Number(s.quantity) || 1;
        let cost = Number(rate?.price_1_adult) || Number(rate?.unit_cost) || Number(rate?.unit_price) || Number(s.unit_cost) || 0;
        if (/accommodation/i.test(s.category || '') || basis === 'per_person_sharing') {
          const singleRate = Number(rate?.price_1_adult) || Number(rate?.single_room_rate) || Number(rate?.effective_single_rate) || 0;
          const sharingRate = Number(rate?.price_2_adults) || Number(rate?.double_twin_rate) || cost;
          const extraRate = Number(rate?.price_3_plus_adults) || sharingRate;
          cost = totalPax <= 1 ? singleRate || sharingRate : totalPax === 2 ? sharingRate : (2 * sharingRate + (totalPax - 2) * extraRate) / totalPax;
        } else if (basis === 'tiered' && Array.isArray(rate?.tiered_pricing)) {
          const tier = rate.tiered_pricing.find((t) => totalPax >= (Number(t.min_pax) || 0) && (!Number(t.max_pax) || totalPax <= Number(t.max_pax))) || rate.tiered_pricing[rate.tiered_pricing.length - 1];
          cost = (Number(tier?.rate) || 0) / Math.max(1, totalPax);
        } else if (flatBasis(basis)) {
          cost = (Number(rate?.unit_cost) || Number(rate?.unit_price) || Number(s.unit_cost) || 0) / Math.max(1, totalPax);
        }
        return round(cost * (1 + markupFor(s) / 100) * qty);
      };
      const share = round(services.reduce((sum, s) => sum + perPaxCharge(s), 0));
      const childFields = ['price_child_0_1', 'price_child_0_5', 'price_child_2_11', 'price_child_6_11'];
      let childAvailable = true;
      const child = round(services.reduce((sum, s) => {
        if (!/accommodation/i.test(s.category || '')) return sum + perPaxCharge(s);
        const item = library.find((x) => x.id === s.item_id);
        const rate = item?.item_rates?.find((r) => r.id === s.rate_id);
        const value = childFields.map((field) => Number(rate?.[field]) || 0).find((n) => n > 0);
        if (!value) { childAvailable = false; return sum; }
        return sum + round(value * (1 + markupFor(s) / 100)) * (Number(s.quantity) || 1);
      }, 0));
      const single = services.filter((s) => s.category?.toLowerCase().includes('accommodation')).reduce((sum, s) => {
        const item = library.find((x) => x.id === s.item_id); const rate = item?.item_rates?.find((r) => r.id === s.rate_id);
        const sharing = Number(rate?.price_2_adults) || Number(rate?.double_twin_rate) || Number(rate?.unit_cost) || 0;
        const singleRate = Number(rate?.price_1_adult) || Number(rate?.single_room_rate) || Number(rate?.effective_single_rate) || 0;
        const supplement = Number(rate?.single_supplement) || Math.max(0, singleRate - sharing);
        return sum + supplement * (1 + markupFor(s) / 100) * (Number(s.quantity) || 1);
      }, 0);
      return { code, share, child, childAvailable, priceAvailable, single: round(single), total: round(share * totalPax) };
    });
    return { ...option, groups };
  }), [paxOptions, days, library, markupFor]);

  const exportPackage = () => {
    if (!pkg) return;
    const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const dayHtml = days.map((d, i) => `<section><h3>Day ${i + 1}</h3>${d.notes ? `<p>${escape(d.notes)}</p>` : ''}<ul>${d.services.filter((s) => s.is_included !== false).map((s) => `<li>${escape(s.category || 'Service')}: ${escape(s.item_name)}${s.supplier_name ? ` — ${escape(s.supplier_name)}` : ''}</li>`).join('')}</ul></section>`).join('');
    const pricingHtml = breakdown.map((p) => `<section><h2>${p.adults} adult${p.adults === 1 ? '' : 's'}${p.children ? ` + ${p.children} child${p.children === 1 ? '' : 'ren'}` : ''}</h2>${p.groups.map((g) => `<p><b>${escape(g.code)}</b> · ${g.priceAvailable ? `Per person sharing inclusive of tax: ${money(g.share, g.code)}${p.children ? ` · Child under 12: ${g.childAvailable ? money(g.child, g.code) : 'Not available: add a loaded child rate'}` : ''} · Single supplement: ${money(g.single, g.code)}` : 'Pricing unavailable: select a current loaded library rate for every service.'}</p>`).join('')}</section>`).join('');
    const rangesHtml = validityPeriods.map((p) => `<li>${escape(p.valid_from)} – ${escape(p.valid_to)}</li>`).join('');
    const inclusions = [...new Map(days.flatMap((d) => d.services).filter((s) => s.is_included !== false).map((s) => [`${s.category}:${s.item_name}:${s.supplier_name}`.toLowerCase(), s])).values()];
    const inclusionsHtml = inclusions.length ? `<section><h2>Inclusions</h2><ul>${inclusions.map((s) => `<li>${escape(s.category || 'Service')}: ${escape(s.item_name)}${s.supplier_name ? ` — ${escape(s.supplier_name)}` : ''}</li>`).join('')}</ul></section>` : '';
    const galleryHtml = (pkg.gallery_image_urls || []).map((url) => `<img src="${escape(url)}">`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escape(pkg.name)}</title><style>body{font:15px Arial,sans-serif;color:#1e293b;max-width:850px;margin:40px auto;padding:0 24px}h1,h2,h3{color:#0d7478}header{border-bottom:2px solid #0d7478;padding-bottom:16px;margin-bottom:24px}section{margin:24px 0;padding-bottom:14px;border-bottom:1px solid #e2e8f0}.price{background:#f0fdfa;padding:12px;border-radius:8px}img{max-width:100%;max-height:280px;object-fit:cover;margin:4px}</style></head><body><header>${pkg.cover_image_url ? `<img src="${escape(pkg.cover_image_url)}">` : ''}<h1>${escape(pkg.name)}</h1><p>${escape(pkg.description)}</p>${rangesHtml ? `<b>Valid for</b><ul>${rangesHtml}</ul>` : ''}${galleryHtml ? `<div>${galleryHtml}</div>` : ''}</header>${dayHtml}${inclusionsHtml}<h2>Package prices</h2>${pricingHtml}${terms ? `<section><h2>Terms &amp; Conditions</h2><p>${escape(terms).replace(/\n/g, '<br>')}</p></section>` : ''}<script>window.print()</script></body></html>`;
    const win = window.open('', '_blank'); if (!win) { showToast('Allow pop-ups to print the package document', 'warning'); return; } win.document.write(html); win.document.close();
  };

  if (!packageId) return <div className="super-admin-page"><button className="secondary-btn" onClick={() => navigate('/packages')}><ArrowLeft size={16} /> Packages</button><p>Open a package from the Packages list.</p></div>;

  return <div className="super-admin-page package-builder-page">
    <header className="page-header"><div className="header-title"><BackpackIcon /><div><h1>{pkg?.name || state.packageName || 'Package Builder'}</h1><p>Build the reusable day-by-day package itinerary</p></div></div><div className="package-builder-actions"><button className="secondary-btn" onClick={() => requestNavigate('/packages')}><ArrowLeft size={16} /> Packages</button><button className="secondary-btn" onClick={exportPackage}><Printer size={16} /> Download client PDF</button><button className="primary-btn" disabled={saving} onClick={() => persistDays(days)}><Save size={16} /> {saving ? 'Saving…' : 'Save package'}</button></div></header>
    <div className="package-builder-grid">
      <aside className="package-library-sidebar"><h2>Library Items</h2><div className="packages-search"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search services…" /></div><div className="package-library-results">{results.map((item) => <article key={item.id} className="package-library-card"><strong>{item.name}</strong><span>{item.category} · {item.supplier_name}</span><SearchableSelect value={selectedRates[item.id] || item.item_rates[0]?.id || ''} onChange={(e) => setSelectedRates((prev) => ({ ...prev, [item.id]: e.target.value }))}>{item.item_rates.map((r) => <option key={r.id} value={r.id}>{r.option_name || r.season_name || 'Loaded rate'} · {r.currency} {Number(r.unit_cost || 0).toFixed(2)} cost</option>)}</SearchableSelect><button className="secondary-btn" onClick={() => addService(item, selectedRates[item.id])}>Add to Day {selectedDay + 1} <Plus size={14} /></button></article>)}</div>{search.length > 0 && search.trim().length < 2 && <small>Enter at least two characters.</small>}</aside>
      <main className="package-editor-main">
        <div className="package-editor-settings"><label>Default markup (%)<input type="number" min="0" step="0.01" value={markup} onChange={(e) => setMarkup(e.target.value)} onBlur={(e) => saveMarkup(e.target.value)} /></label><span><CalendarDays size={15} /> Dates are represented by validity periods; itinerary days stay date-free.</span></div>
        <div className="package-agency-pricing"><label htmlFor="package-document-markup">Client document markup (%)</label><input id="package-document-markup" type="number" min="0" step="0.01" value={documentMarkup ?? markup} onChange={(e) => setDocumentMarkup(e.target.value)} /><span>This markup changes prices in the downloadable client document only. It does not change the saved package.</span></div>
        <div className="package-active-day"><label htmlFor="package-active-day">Add selected services to</label><SearchableSelect id="package-active-day" value={selectedDay} onChange={(e) => setSelectedDay(Number(e.target.value))}>{days.map((_, i) => <option key={i} value={i}>Day {i + 1}</option>)}</SearchableSelect>{!days.length && <span>Add a day before adding services.</span>}</div>
        {days.map((day, di) => <section className="package-day-card" key={day.id || di}><header><h2>Day {di + 1}</h2><button title="Remove day" className="package-remove-period" onClick={() => setDays((prev) => prev.filter((_, i) => i !== di).map((d, i) => ({ ...d, day_number: i + 1 })))}><Trash2 size={15} /></button></header><textarea rows={2} placeholder="Day notes (optional)" value={day.notes || ''} onChange={(e) => setDays((prev) => prev.map((d, i) => i === di ? { ...d, notes: e.target.value } : d))} />{day.services.map((s, si) => { const item = library.find((x) => x.id === s.item_id); return <div className="package-service-row" key={`${s.item_id}-${si}`}><div className="package-service-name"><b>{s.item_name}</b><small>{s.category} · {s.supplier_name || 'Supplier not specified'}</small></div><SearchableSelect value={s.rate_id || ''} onChange={(e) => changeService(di, si, 'rate_id', e.target.value)}>{(item?.item_rates || [{ id: s.rate_id, option_name: 'Saved loaded rate', currency: s.currency_code, unit_cost: s.unit_cost }]).map((r) => <option key={r.id} value={r.id}>{r.option_name || r.season_name || 'Loaded rate'} · {r.currency} {Number(r.unit_cost || 0).toFixed(2)}</option>)}</SearchableSelect><span>{s.currency_code} {Number(s.unit_cost).toFixed(2)}</span><label>Markup<input type="number" min="0" step="0.01" value={s.markup_percentage} onChange={(e) => changeService(di, si, 'markup_percentage', e.target.value)} /></label><button title="Remove service" className="package-remove-period" onClick={() => setDays((prev) => prev.map((d, i) => i === di ? { ...d, services: d.services.filter((_, j) => j !== si) } : d))}><Trash2 size={15} /></button></div>; })}{!day.services.length && <p className="package-day-empty">Add services from the Library Items panel.</p>}</section>)}
        <button className="package-add-period" onClick={addDay}><Plus size={15} /> Add day</button>
        <div className="package-day-card package-pax-card"><h2><Users size={18} /> Passenger patterns</h2><p>Add the group sizes for which this package should display a price.</p><div className="package-pax-add"><label>Adults<input id="package-pax-adults" type="number" min="1" defaultValue="2" /></label><label>Children under 12<input id="package-pax-children" type="number" min="0" defaultValue="0" /></label><button className="secondary-btn" onClick={addPaxOption}><Plus size={15} /> Add pattern</button></div>{paxOptions.map((option) => { const price = breakdown.find((b) => b.id === option.id); return <article className="package-pax-option" key={option.id}><div><b>{option.adults} adult{option.adults === 1 ? '' : 's'}{option.children ? ` + ${option.children} child${option.children === 1 ? '' : 'ren'}` : ''}</b><div>{(price?.groups || []).map((g) => <span className="package-price-chip" key={g.code}>{g.code}: {money(g.share, g.code)} / adult{option.children ? ` · child ${g.childAvailable ? money(g.child, g.code) : "Unavailable: no loaded child rate"}` : ''} · single supplement ${money(g.single, g.code)}</span>)}</div></div><button className="package-remove-period" onClick={() => removePaxOption(option.id)}><Trash2 size={15} /></button></article>; })}{!paxOptions.length && <p className="package-day-empty">No passenger patterns yet.</p>}</div>
        <div className="package-day-card"><h2>Terms &amp; Conditions</h2><p>Imported from Settings → Itinerary presentation.</p><div className="package-terms-preview">{terms || 'No default terms are configured.'}</div></div>
      </main>
    </div>
  </div>;
};

const BackpackIcon = () => <div className="package-builder-icon"><ImagePlus size={20} /></div>;
