import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Backpack, CalendarDays, Check, ChevronDown, Download, FileText,
  GripVertical, Plus, Save, Search, Trash2, X
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { usePageGuard } from '../context/NavigationGuardContext';
import { useCurrencies } from '../hooks/useCurrencies';
import { calculatePackageTravellerBreakdown, packageItemCapacityError } from '../lib/packagePricing';

const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
const money = (value, code) => `${code} ${round(value).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nameOf = (client) => client?.name || 'Unnamed client';
const currencyMatches = (rate, code) => !code || String(rate?.currency || '').toUpperCase() === String(code).toUpperCase();
const destinationsOf = (item) => [...new Set([
  item?.destination_region, item?.destination_area, item?.location
].map((destination) => String(destination || '').trim()).filter(Boolean))];
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

const initialForm = {
  description: '', inclusions: '', exclusions: '', terms: '',
  isAvailable: false, assignedClientIds: []
};
const DEFAULT_CATEGORIES = [
  'Accommodation', 'Transfers', 'Activities / Tours', 'Flights / Charter',
  'Meals', 'Guide', 'Trains', 'Tickets', 'Extras', 'Car Rental'
];

export const PackageBuilder = () => {
  const { state } = useLocation();
  const { packageId } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { currencies } = useCurrencies();
  const [companyId, setCompanyId] = useState(null);
  const [pkg, setPkg] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [days, setDays] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [paxOptions, setPaxOptions] = useState([]);
  const [clients, setClients] = useState([]);
  const [library, setLibrary] = useState([]);
  const [destinationCatalog, setDestinationCatalog] = useState([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [destinationFilter, setDestinationFilter] = useState('');
  const [currencyFilter, setCurrencyFilter] = useState('');
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [currencySearch, setCurrencySearch] = useState('');
  const [results, setResults] = useState([]);
  const [selectedRates, setSelectedRates] = useState({});
  const [selectedDay, setSelectedDay] = useState(0);
  const [tab, setTab] = useState('itinerary');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState('');
  const [exportDialog, setExportDialog] = useState(false);
  const [exportOptions, setExportOptions] = useState({ cover: true, inclusions: true, terms: true });
  const [exportFormat, setExportFormat] = useState('pdf');
  const [clientSelectOpen, setClientSelectOpen] = useState(false);
  const [clientQuery, setClientQuery] = useState('');

  const snapshot = useMemo(() => JSON.stringify({ form, days, periods, paxOptions }), [form, days, periods, paxOptions]);
  const dirty = Boolean(pkg && lastSaved && snapshot !== lastSaved);

  const load = useCallback(async () => {
    if (!packageId) return;
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error('Sign in to edit packages.');
      const { data: profile, error: profileError } = await supabase.from('profiles').select('company_id').eq('id', user.id).single();
      if (profileError) throw profileError;
      if (!profile?.company_id) throw new Error('Your account is not linked to a company.');
      setCompanyId(profile.company_id);

      const [pkgRes, dayRes, periodRes, paxRes, billingRes] = await Promise.all([
        supabase.from('packages').select('*').eq('id', packageId).eq('company_id', profile.company_id).single(),
        supabase.from('package_days').select('*').eq('package_id', packageId).order('day_number'),
        supabase.from('package_validity_periods').select('*').eq('package_id', packageId).order('valid_from'),
        supabase.from('package_pax_options').select('*').eq('package_id', packageId).order('adults'),
        supabase.from('company_billing_settings').select('itinerary_terms').eq('company_id', profile.company_id).maybeSingle()
      ]);
      for (const result of [pkgRes, dayRes, periodRes, paxRes, billingRes]) {
        if (result.error) throw result.error;
      }
      const dayIds = (dayRes.data || []).map((day) => day.id);
      const itemRes = dayIds.length
        ? await supabase.from('package_day_items').select('*').in('package_day_id', dayIds).order('sort_order')
        : { data: [], error: null };
      if (itemRes.error) throw itemRes.error;
      const itemsByDay = new Map();
      (itemRes.data || []).forEach((item) => {
        itemsByDay.set(item.package_day_id, [...(itemsByDay.get(item.package_day_id) || []), item]);
      });
      const loadedDays = (dayRes.data || []).map((day) => ({
        ...day,
        services: itemsByDay.get(day.id) || []
      }));
      let loadedClients = [];
      let assignedClientIds = [];
      const [clientsRes, assignmentsRes] = await Promise.all([
        supabase.from('clients').select('id, name').eq('company_id', profile.company_id).order('name'),
        supabase.from('package_client_assignments').select('client_id').eq('company_id', profile.company_id).eq('package_id', packageId)
      ]);
      if (clientsRes.error || assignmentsRes.error) {
        const error = clientsRes.error || assignmentsRes.error;
        showToast(`Package loaded, but client assignment data could not be loaded: ${error.message}`, 'error');
      } else {
        loadedClients = clientsRes.data || [];
        assignedClientIds = (assignmentsRes.data || []).map((assignment) => assignment.client_id);
      }
      const packageForm = {
        description: pkgRes.data.description || '',
        inclusions: pkgRes.data.inclusions || '',
        exclusions: pkgRes.data.exclusions || '',
        terms: pkgRes.data.terms_and_conditions || billingRes.data?.itinerary_terms || '',
        isAvailable: Boolean(pkgRes.data.is_available_in_library),
        assignedClientIds
      };
      setPkg(pkgRes.data);
      setForm(packageForm);
      setDays(loadedDays);
      setPeriods((periodRes.data || []).map(({ valid_from, valid_to }) => ({ valid_from, valid_to })));
      setPaxOptions(paxRes.data || []);
      setClients(loadedClients);
      setSelectedDay(0);
      setLastSaved(JSON.stringify({
        form: packageForm,
        days: loadedDays,
        periods: (periodRes.data || []).map(({ valid_from, valid_to }) => ({ valid_from, valid_to })),
        paxOptions: paxRes.data || []
      }));

      const usedIds = [...new Set((itemRes.data || []).map((item) => item.item_id).filter(Boolean))];
      if (usedIds.length) {
        const [itemsRes, ratesRes] = await Promise.all([
          supabase.from('library_items').select('id, name, category, currency, pricing_model, supplier_id, max_occupancy, destination_region, destination_area, location, max_adults, max_children, child_age_ranges, is_active').in('id', usedIds),
          supabase.from('item_rates').select('*').in('item_id', usedIds)
        ]);
        if (itemsRes.error) throw itemsRes.error;
        if (ratesRes.error) throw ratesRes.error;
        const supplierIds = [...new Set((itemsRes.data || []).map((item) => item.supplier_id).filter(Boolean))];
        const suppliersRes = supplierIds.length
          ? await supabase.from('suppliers').select('id, name').in('id', supplierIds)
          : { data: [], error: null };
        if (suppliersRes.error) throw suppliersRes.error;
        const supplierNames = new Map((suppliersRes.data || []).map((supplier) => [supplier.id, supplier.name]));
        setLibrary((itemsRes.data || []).map((item) => ({
          ...item,
          supplier_name: supplierNames.get(item.supplier_id) || '',
          item_rates: (ratesRes.data || []).filter((rate) => rate.item_id === item.id)
        })));
      } else {
        setLibrary([]);
      }
    } catch (error) {
      showToast(`Could not load package: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [packageId, showToast]);

  useEffect(() => {
    const timer = setTimeout(() => { load(); }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    let active = true;
    const loadDestinations = async () => {
      if (!companyId) return;
      const { data, error } = await supabase.from('library_items')
        .select('destination_region, destination_area, location')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .limit(1000);
      if (error) {
        showToast(`Could not load package destination filters: ${error.message}`, 'error');
        return;
      }
      if (active) setDestinationCatalog((data || []).flatMap(destinationsOf));
    };
    loadDestinations();
    return () => { active = false; };
  }, [companyId, showToast]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      const term = search.trim();
      if (!companyId || (term.length > 0 && term.length < 2 && !categoryFilter && !currencyFilter)) {
        if (active) setResults([]);
        return;
      }
      try {
        const safe = term.replace(/[,()]/g, ' ').replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
        let query = supabase.from('library_items')
          .select('id, name, category, description, currency, pricing_model, supplier_id, max_occupancy, destination_region, destination_area, location, max_adults, max_children, child_age_ranges, is_active')
          .eq('company_id', companyId).eq('is_active', true)
          .order('name').limit(50);
        if (categoryFilter) query = query.eq('category', categoryFilter);
        if (term.length >= 2) query = query.or(`name.ilike.%${safe}%,description.ilike.%${safe}%,destination_region.ilike.%${safe}%,destination_area.ilike.%${safe}%,location.ilike.%${safe}%`);
        const { data, error } = await query;
        if (error) throw error;
        const ids = (data || []).map((item) => item.id);
        const suppliers = [...new Set((data || []).map((item) => item.supplier_id).filter(Boolean))];
        const [ratesRes, suppliersRes] = await Promise.all([
          ids.length ? supabase.from('item_rates').select('*').in('item_id', ids) : { data: [], error: null },
          suppliers.length ? supabase.from('suppliers').select('id, name').in('id', suppliers) : { data: [], error: null }
        ]);
        if (ratesRes.error) throw ratesRes.error;
        if (suppliersRes.error) throw suppliersRes.error;
        const supplierNames = new Map((suppliersRes.data || []).map((supplier) => [supplier.id, supplier.name]));
        const merged = (data || []).map((item) => ({
          ...item,
          supplier_name: supplierNames.get(item.supplier_id) || '',
          item_rates: (ratesRes.data || []).filter((rate) => rate.item_id === item.id)
        }));
        if (!active) return;
        setResults(merged);
        setLibrary((previous) => [...new Map([...previous, ...merged].map((item) => [item.id, item])).values()]);
      } catch (error) {
        if (active) showToast(`Library search failed: ${error.message}`, 'error');
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [search, categoryFilter, currencyFilter, companyId, showToast]);

  const categoryOptions = useMemo(() => [...new Set([
    ...DEFAULT_CATEGORIES,
    ...results.map((item) => item.category).filter(Boolean)
  ])].sort(), [results]);

  const destinationOptions = useMemo(() => [...new Set([
    ...destinationCatalog,
    ...results.flatMap(destinationsOf)
  ])].sort((a, b) => a.localeCompare(b)), [destinationCatalog, results]);

  const currencyOptions = useMemo(() => {
    const options = new Map(currencies.map((currency) => [currency.code, currency]));
    results.flatMap((item) => item.item_rates || []).forEach((rate) => {
      const code = String(rate.currency || '').toUpperCase();
      if (code && !options.has(code)) {
        options.set(code, { code, name: code, symbol: code });
      }
    });
    return [...options.values()].filter((currency) => !currencySearch
      || `${currency.code} ${currency.name} ${currency.symbol}`.toLowerCase().includes(currencySearch.trim().toLowerCase()));
  }, [currencies, results, currencySearch]);

  const visibleResults = useMemo(() => results.filter((item) => {
    if (destinationFilter && !destinationsOf(item).includes(destinationFilter)) return false;
    if (currencyFilter && !(item.item_rates || []).some((rate) => currencyMatches(rate, currencyFilter))) return false;
    return true;
  }), [results, destinationFilter, currencyFilter]);

  const selectedClients = useMemo(() => clients.filter((client) => form.assignedClientIds.includes(client.id)), [clients, form.assignedClientIds]);
  const visibleClients = useMemo(() => {
    const term = clientQuery.trim().toLowerCase();
    return clients.filter((client) => !term || nameOf(client).toLowerCase().includes(term));
  }, [clients, clientQuery]);

  const persist = useCallback(async (nextDays = days, nextPeriods = periods, nextPax = paxOptions, nextForm = form) => {
    if (!companyId || !pkg) return false;
    const validPeriods = nextPeriods.filter((period) => period.valid_from && period.valid_to);
    if (nextPeriods.some((period) => Boolean(period.valid_from) !== Boolean(period.valid_to))) {
      showToast('Complete both dates for each validity period, or remove the incomplete row.', 'warning');
      return false;
    }
    if (validPeriods.some((period) => period.valid_to < period.valid_from)) {
      showToast('Each validity end date must be on or after its start date.', 'warning');
      return false;
    }
    setSaving(true);
    try {
      const { error: packageError } = await supabase.from('packages').update({
        description: nextForm.description,
        inclusions: nextForm.inclusions,
        exclusions: nextForm.exclusions,
        terms_and_conditions: nextForm.terms,
        is_available_in_library: nextForm.isAvailable,
        default_markup_percentage: 0
      }).eq('id', pkg.id).eq('company_id', companyId);
      if (packageError) throw packageError;

      const { error: assignmentDeleteError } = await supabase.from('package_client_assignments')
        .delete().eq('package_id', pkg.id).eq('company_id', companyId);
      if (assignmentDeleteError) throw assignmentDeleteError;
      if (nextForm.assignedClientIds.length) {
        const { error: assignmentError } = await supabase.from('package_client_assignments').insert(
          nextForm.assignedClientIds.map((clientId) => ({
            package_id: pkg.id, client_id: clientId, company_id: companyId
          }))
        );
        if (assignmentError) throw assignmentError;
      }

      const { error: dayDeleteError } = await supabase.from('package_days').delete().eq('package_id', pkg.id);
      if (dayDeleteError) throw dayDeleteError;
      for (let dayIndex = 0; dayIndex < nextDays.length; dayIndex += 1) {
        const day = nextDays[dayIndex];
        const { data: dayRow, error: dayInsertError } = await supabase.from('package_days').insert({
          package_id: pkg.id, company_id: companyId, day_number: dayIndex + 1, notes: day.notes || null
        }).select().single();
        if (dayInsertError) throw dayInsertError;
        const rows = (day.services || []).map((service, sortOrder) => ({
          package_day_id: dayRow.id,
          company_id: companyId,
          item_id: service.item_id || null,
          rate_id: service.rate_id || null,
          item_name: service.item_name,
          category: service.category || '',
          supplier_name: service.supplier_name || '',
          currency_code: service.currency_code || 'ZAR',
          rate_basis: service.rate_basis || 'per_person',
          unit_cost: Number(service.unit_cost) || 0,
          unit_price: Number(service.unit_cost) || 0,
          markup_percentage: 0,
          quantity: Math.max(1, Number(service.quantity) || 1),
          is_included: service.is_included !== false,
          notes: service.notes || null,
          sort_order: sortOrder,
          vehicle_capacity: Number(service.vehicle_capacity) || null,
          rate_snapshot: service.rate_snapshot || {}
        }));
        if (rows.length) {
          const { error: itemError } = await supabase.from('package_day_items').insert(rows);
          if (itemError) throw itemError;
        }
      }

      const { error: periodDeleteError } = await supabase.from('package_validity_periods').delete().eq('package_id', pkg.id);
      if (periodDeleteError) throw periodDeleteError;
      if (validPeriods.length) {
        const { error: periodError } = await supabase.from('package_validity_periods').insert(
          validPeriods.map((period) => ({ package_id: pkg.id, ...period }))
        );
        if (periodError) throw periodError;
      }

      const { error: paxDeleteError } = await supabase.from('package_pax_options').delete().eq('package_id', pkg.id);
      if (paxDeleteError) throw paxDeleteError;
      if (nextPax.length) {
        const { error: paxError } = await supabase.from('package_pax_options').insert(
          nextPax.map(({ adults, children }) => ({ package_id: pkg.id, adults, children }))
        );
        if (paxError) throw paxError;
      }

      const savedDays = nextDays.map((day, index) => ({ ...day, day_number: index + 1 }));
      const savedPeriods = validPeriods.map(({ valid_from, valid_to }) => ({ valid_from, valid_to }));
      setDays(savedDays);
      setPeriods(savedPeriods);
      setPaxOptions(nextPax);
      setLastSaved(JSON.stringify({ form: nextForm, days: savedDays, periods: savedPeriods, paxOptions: nextPax }));
      showToast('Package saved', 'success');
      return true;
    } catch (error) {
      showToast(`Could not save package: ${error.message}`, 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }, [companyId, pkg, days, periods, paxOptions, form, showToast]);

  const { requestNavigate } = usePageGuard('package-builder', 'this package', dirty, () => persist());

  const addService = (item, rateId, dayIndex = selectedDay) => {
    const rate = item.item_rates?.find((entry) => entry.id === rateId && currencyMatches(entry, currencyFilter))
      || item.item_rates?.find((entry) => currencyMatches(entry, currencyFilter))
      || item.item_rates?.[0];
    if (!rate) {
      showToast(currencyFilter
        ? `This library item has no contract rate in ${currencyFilter}. Choose another currency or add the rate in Library Items.`
        : 'This library item has no loaded contract rates. Add a rate in Library Items first.', 'warning');
      return;
    }
    const capacityError = packageItemCapacityError(item, rate, paxOptions);
    if (capacityError) {
      showToast(capacityError, 'warning');
      return;
    }
    const unitCost = Number(rate.unit_cost) || Number(rate.price_1_adult) || Number(rate.unit_price) || 0;
    const service = {
      item_id: item.id,
      rate_id: rate.id,
      item_name: item.name,
      category: item.category || '',
      supplier_name: item.supplier_name || '',
      currency_code: rate.currency || item.currency || 'ZAR',
      rate_basis: rate.rate_basis || item.pricing_model || 'per_person',
      unit_cost: unitCost,
      unit_price: unitCost,
      markup_percentage: 0,
      quantity: 1,
      is_included: true,
      vehicle_capacity: Number(item.max_occupancy) || Number(rate.max_occupancy) || 0,
      rate_snapshot: rate
    };
    setDays((previous) => {
      if (!previous.length) return [{ day_number: 1, notes: '', services: [service] }];
      return previous.map((day, index) => index === dayIndex
        ? { ...day, services: [...day.services, service] }
        : day);
    });
    setSelectedRates((previous) => ({ ...previous, [item.id]: rate.id }));
  };

  const updateService = (dayIndex, serviceIndex, field, value) => {
    setDays((previous) => previous.map((day, index) => index !== dayIndex ? day : {
      ...day,
      services: day.services.map((service, indexInDay) => {
        if (indexInDay !== serviceIndex) return service;
        if (field !== 'rate_id') return { ...service, [field]: value };
        const item = library.find((entry) => entry.id === service.item_id);
        const rate = item?.item_rates?.find((entry) => entry.id === value);
        if (!rate) return service;
        const unitCost = Number(rate.unit_cost) || Number(rate.price_1_adult) || Number(rate.unit_price) || 0;
        return {
          ...service,
          rate_id: rate.id,
          rate_basis: rate.rate_basis || item.pricing_model || service.rate_basis,
          currency_code: rate.currency || item.currency || service.currency_code,
          unit_cost: unitCost,
          unit_price: unitCost,
          vehicle_capacity: Number(item.max_occupancy) || Number(rate.max_occupancy) || service.vehicle_capacity || 0,
          rate_snapshot: rate
        };
      })
    }));
  };

  const removeService = (dayIndex, serviceIndex) => setDays((previous) => previous.map((day, index) => index !== dayIndex ? day : {
    ...day,
    services: day.services.filter((_, itemIndex) => itemIndex !== serviceIndex)
  }));

  const moveService = (fromDay, fromIndex, toDay) => setDays((previous) => {
    if (!previous[fromDay] || !previous[toDay]) return previous;
    const service = previous[fromDay].services[fromIndex];
    if (!service) return previous;
    const next = previous.map((day) => ({ ...day, services: [...day.services] }));
    next[fromDay].services.splice(fromIndex, 1);
    next[toDay].services.push(service);
    return next;
  });

  const addDay = () => {
    setDays((previous) => {
      const next = [...previous, { day_number: previous.length + 1, notes: '', services: [] }];
      setSelectedDay(next.length - 1);
      return next;
    });
  };

  const breakdown = useMemo(() => paxOptions.map((pattern) => ({
    ...pattern,
    currencies: calculatePackageTravellerBreakdown({ days, pattern, library })
  })), [paxOptions, days, library]);

  const buildExportHtml = (options) => {
    const cover = options.cover && pkg.cover_image_url
      ? `<img class="cover" src="${escapeHtml(pkg.cover_image_url)}" alt="">`
      : '';
    const dayMarkup = days.map((day, index) => {
      const services = day.services.filter((service) => service.is_included !== false)
        .map((service) => `<li>${escapeHtml(service.item_name)}${service.supplier_name ? ` — ${escapeHtml(service.supplier_name)}` : ''}</li>`).join('');
      return `<section><h2>Day ${index + 1}</h2>${day.notes ? `<p>${escapeHtml(day.notes)}</p>` : ''}<ul>${services}</ul></section>`;
    }).join('');
    const pricingMarkup = breakdown.map((pattern) => `<section><h2>${pattern.adults} adult${pattern.adults === 1 ? '' : 's'}${pattern.children ? ` + ${pattern.children} child${pattern.children === 1 ? '' : 'ren'}` : ''}</h2>${pattern.currencies.map((row) => `<p><b>${escapeHtml(row.currency)}</b> — Unit share per person: ${money(row.unitPerPerson, row.currency)} · Total per person sharing: ${money(row.totalPerPersonSharing, row.currency)} · Single supplement: ${money(row.singleSupplement, row.currency)} · Single total: ${money(row.totalSinglePerPerson, row.currency)} · Child sharing: ${money(row.childPerPerson, row.currency)}</p><ul>${row.accommodationRows.map((item) => `<li>${escapeHtml(item.name)} — sharing: ${money(item.sharingPerAdult, row.currency)} · single supplement: ${money(item.singleSupplement, row.currency)} · child: ${money(item.childPerTraveller, row.currency)} · ${item.roomCount} room(s), max ${item.capacity} per room</li>`).join('')}</ul>`).join('') || '<p>No priced items.</p>'}</section>`).join('');
    const validity = periods.map((period) => `<li>${escapeHtml(period.valid_from)} – ${escapeHtml(period.valid_to)}</li>`).join('');
    const inclusionMarkup = options.inclusions
      ? `${form.inclusions ? `<h3>Inclusions</h3><p>${escapeHtml(form.inclusions).replace(/\n/g, '<br>')}</p>` : ''}${form.exclusions ? `<h3>Exclusions</h3><p>${escapeHtml(form.exclusions).replace(/\n/g, '<br>')}</p>` : ''}`
      : '';
    const termsMarkup = options.terms && form.terms
      ? `<section><h2>Terms &amp; Conditions</h2><p>${escapeHtml(form.terms).replace(/\n/g, '<br>')}</p></section>`
      : '';
    const clientNames = selectedClients.map(nameOf).join(', ');
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(pkg.name)}</title><style>body{font:15px Arial,sans-serif;color:#1e293b;max-width:850px;margin:36px auto;padding:0 24px}h1,h2,h3{color:#0d7478}header{border-bottom:2px solid #0d7478;padding-bottom:16px;margin-bottom:24px}section{margin:22px 0;padding-bottom:12px;border-bottom:1px solid #e2e8f0}.cover{max-width:100%;max-height:280px;object-fit:cover}li{margin:6px 0}@media print{body{margin:0 auto}}</style></head><body><header>${cover}<h1>${escapeHtml(pkg.name)}</h1><p>${escapeHtml(form.description)}</p>${validity ? `<h3>Valid dates</h3><ul>${validity}</ul>` : ''}${clientNames ? `<p>Quoted for: ${escapeHtml(clientNames)}</p>` : ''}</header>${dayMarkup}${inclusionMarkup ? `<section>${inclusionMarkup}</section>` : ''}<h2>Traveller pattern pricing</h2>${pricingMarkup}${termsMarkup}</body></html>`;
  };

  const exportDocument = () => {
    const html = buildExportHtml(exportOptions);
    if (exportFormat === 'pdf') {
      const win = window.open('', '_blank');
      if (!win) {
        showToast('Allow pop-ups to print or save the package as a PDF.', 'warning');
        return;
      }
      win.document.write(html.replace('</body>', '<script>window.onload=()=>window.print();</script></body>'));
      win.document.close();
    } else {
      const blob = new Blob([html], { type: 'application/msword;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${pkg.name.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '') || 'package'}.doc`;
      anchor.click();
      URL.revokeObjectURL(url);
    }
    setExportDialog(false);
  };

  const updateForm = (field, value) => setForm((previous) => ({ ...previous, [field]: value }));
  const addPeriod = () => setPeriods((previous) => [...previous, { valid_from: '', valid_to: '' }]);
  const changePeriod = (index, field, value) => setPeriods((previous) => previous.map((period, rowIndex) =>
    rowIndex === index ? { ...period, [field]: value } : period));
  const addPaxPattern = () => {
    const adults = Number(document.getElementById('package-adults')?.value) || 0;
    const children = Number(document.getElementById('package-children')?.value) || 0;
    if (adults < 1) {
      showToast('A traveller pattern must include at least one adult.', 'warning');
      return;
    }
    if (paxOptions.some((option) => option.adults === adults && option.children === children)) {
      showToast('That traveller pattern already exists.', 'warning');
      return;
    }
    const candidate = { adults, children };
    const oversizedService = days.flatMap((day) => day.services).find((service) => {
      const savedItem = library.find((entry) => entry.id === service.item_id);
      const item = {
        ...(savedItem || {}),
        category: savedItem?.category || service.category,
        max_occupancy: savedItem?.max_occupancy || service.vehicle_capacity,
        name: savedItem?.name || service.item_name
      };
      const rate = savedItem?.item_rates?.find((entry) => entry.id === service.rate_id) || service.rate_snapshot;
      return Boolean(packageItemCapacityError(item, rate, [candidate]));
    });
    if (oversizedService) {
      const savedItem = library.find((entry) => entry.id === oversizedService.item_id);
      const item = {
        ...(savedItem || {}),
        category: savedItem?.category || oversizedService.category,
        max_occupancy: savedItem?.max_occupancy || oversizedService.vehicle_capacity,
        name: savedItem?.name || oversizedService.item_name
      };
      const rate = savedItem?.item_rates?.find((entry) => entry.id === oversizedService.rate_id) || oversizedService.rate_snapshot;
      showToast(packageItemCapacityError(item, rate, [candidate]), 'warning');
      return;
    }
    setPaxOptions((previous) => [...previous, candidate].sort((a, b) => a.adults - b.adults || a.children - b.children));
  };

  if (!packageId) return <div className="super-admin-page"><button className="secondary-btn" onClick={() => navigate('/packages')}><ArrowLeft size={16} /> Packages</button><p>Open a package from the Packages list.</p></div>;

  const tabs = [
    ['itinerary', 'Itinerary'],
    ['validity', 'Valid dates'],
    ['travellers', 'Travellers & pricing'],
    ['inclusions', 'Inclusions & exclusions'],
    ['terms', 'Terms & conditions'],
    ['client', 'Client quote']
  ];

  return <div className="super-admin-page package-builder-page">
    <header className="page-header">
      <div className="header-title"><Backpack /><div><h1>{pkg?.name || state?.packageName || 'Package Builder'}</h1><p>Build and quote a reusable package using contract prices</p></div></div>
      <div className="package-builder-actions">
        <button className="secondary-btn" onClick={() => requestNavigate('/packages')}><ArrowLeft size={16} /> Packages</button>
        <button className="secondary-btn" onClick={() => setExportDialog(true)} disabled={!pkg}><Download size={16} /> Export</button>
        <button className="primary-btn" disabled={saving || loading || !pkg} onClick={() => persist()}><Save size={16} /> {saving ? 'Saving…' : 'Save package'}</button>
      </div>
    </header>
    {loading ? <div className="admin-table-container">Loading package…</div> : !pkg ? <div className="admin-table-container">Package not found.</div> : <>
      <nav className="package-builder-tabs" aria-label="Package editor sections">
        {tabs.map(([id, label]) => <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </nav>
      {tab === 'itinerary' && <div className="package-builder-grid">
        <aside className="package-library-sidebar">
          <h2>Library Items</h2>
          <div className="packages-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search contracted services…" /></div>
          <div className="package-filter-section">
            <strong>Currency availability</strong>
            <div className="menu-popover currency-popover">
              <button type="button" className="currency-trigger" onClick={() => { setCurrencyOpen((open) => !open); setCurrencySearch(''); }}>
                <span className="currency-trigger-code">{currencyFilter || 'ALL'}</span>
                <span className="currency-trigger-name">{currencyFilter ? 'Rates in this currency' : 'All currencies'}</span>
                <ChevronDown size={14} className={`currency-chevron ${currencyOpen ? 'open' : ''}`} />
              </button>
              {currencyOpen && <>
                <div className="menu-overlay" onClick={() => setCurrencyOpen(false)} />
                <div className="menu-panel currency-panel">
                  <div className="sidebar-search" style={{ margin: 0 }}><Search size={14} /><input autoFocus placeholder="Search currency…" value={currencySearch} onChange={(event) => setCurrencySearch(event.target.value)} /></div>
                  <div className="currency-list">
                    <button type="button" className={`menu-item ${currencyFilter === '' ? 'active' : ''}`} onClick={() => { setCurrencyFilter(''); setCurrencyOpen(false); }}>
                      <span className="currency-opt-code">ALL</span><span className="currency-opt-name">All currencies</span>{currencyFilter === '' && <Check size={14} />}
                    </button>
                    {currencyOptions.map((currency) => <button key={currency.code} type="button" className={`menu-item ${currency.code === currencyFilter ? 'active' : ''}`} onClick={() => { setCurrencyFilter(currency.code); setCurrencyOpen(false); }}>
                      <span className="currency-opt-sym">{currency.symbol}</span><span className="currency-opt-code">{currency.code}</span><span className="currency-opt-name">{currency.name}</span>{currency.code === currencyFilter && <Check size={14} />}
                    </button>)}
                    {!currencyOptions.length && <div className="currency-empty">No currency matches “{currencySearch}”</div>}
                  </div>
                </div>
              </>}
            </div>
          </div>
          <div className="package-filter-section">
            <strong>Item type</strong>
            <div className="category-filters">{categoryOptions.map((category) => <button key={category} type="button" className={`category-chip ${categoryFilter === category ? 'active' : ''}`} onClick={() => setCategoryFilter((current) => current === category ? '' : category)}>{category}</button>)}</div>
          </div>
          <label className="package-filter-section package-destination-filter"><strong>Destination / island</strong><select value={destinationFilter} onChange={(event) => setDestinationFilter(event.target.value)}><option value="">All destinations</option>{destinationOptions.map((destination) => <option key={destination} value={destination}>{destination}</option>)}</select></label>
          {(categoryFilter || destinationFilter || currencyFilter || search) && <button type="button" className="clear-filters-btn" onClick={() => { setCategoryFilter(''); setDestinationFilter(''); setCurrencyFilter(''); setSearch(''); }}>Clear filters</button>}
          <p className="package-help">Rates are copied at their contract amount. No package markup is applied.</p>
          <div className="package-library-results">
            {visibleResults.map((item) => {
              const eligibleRates = (item.item_rates || []).filter((entry) => currencyMatches(entry, currencyFilter));
              const rate = eligibleRates.find((entry) => entry.id === selectedRates[item.id]) || eligibleRates[0];
              return <article key={item.id} className="package-library-card" draggable onDragStart={(event) => event.dataTransfer.setData('application/json', JSON.stringify({ type: 'library', itemId: item.id, rateId: rate?.id }))}>
                <strong>{item.name}</strong><span>{item.category || 'Service'}{item.supplier_name ? ` · ${item.supplier_name}` : ''}</span>
                {eligibleRates.length ? <select aria-label={`Contract rate for ${item.name}`} value={rate?.id || ''} onChange={(event) => setSelectedRates((previous) => ({ ...previous, [item.id]: event.target.value }))}>
                  {eligibleRates.map((option) => <option key={option.id} value={option.id}>{option.option_name || option.season_name || 'Contract rate'} · {option.currency || item.currency || 'ZAR'} {Number(option.unit_cost || option.price_1_adult || option.unit_price || 0).toFixed(2)}</option>)}
                </select> : <span>No contract rates</span>}
                <button type="button" className="secondary-btn" onClick={() => addService(item, rate?.id)} disabled={!rate}>Add to Day {selectedDay + 1} <Plus size={14} /></button>
              </article>;
            })}
            {search.trim().length > 0 && search.trim().length < 2 && <p>Enter at least 2 characters to search.</p>}
            {(search.trim().length >= 2 || categoryFilter || currencyFilter) && !visibleResults.length && <p>No matching active library items with rates in this currency.</p>}
          </div>
        </aside>
        <main className="package-itinerary-canvas">
          <div className="package-canvas-header"><div><h2>Day-by-day itinerary</h2><p>Drag library items onto a day, or use the Add button.</p></div><button className="secondary-btn" onClick={addDay}><Plus size={15} /> Add day</button></div>
          {days.map((day, dayIndex) => <section key={day.id || `day-${dayIndex}`} className={`package-canvas-day ${selectedDay === dayIndex ? 'selected' : ''}`} onClick={() => setSelectedDay(dayIndex)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              try {
                const payload = JSON.parse(event.dataTransfer.getData('application/json'));
                if (payload.type === 'library') {
                  const item = library.find((entry) => entry.id === payload.itemId) || results.find((entry) => entry.id === payload.itemId);
                  if (item) addService(item, payload.rateId, dayIndex);
                } else if (payload.type === 'service') moveService(payload.fromDay, payload.fromIndex, dayIndex);
              } catch (error) {
                showToast(`Could not add the dragged item: ${error.message}`, 'error');
              }
            }}>
            <header><h3><CalendarDays size={17} /> Day {dayIndex + 1}</h3><span>{day.services.length} item{day.services.length === 1 ? '' : 's'}</span></header>
            <textarea aria-label={`Day ${dayIndex + 1} notes`} value={day.notes || ''} onChange={(event) => setDays((previous) => previous.map((row, index) => index === dayIndex ? { ...row, notes: event.target.value } : row))} placeholder="Optional day overview or notes" rows={2} />
            {day.services.map((service, serviceIndex) => {
              const item = library.find((entry) => entry.id === service.item_id);
              const capacity = Number(item?.max_occupancy || service.vehicle_capacity) || 0;
              const maxPatternPax = paxOptions.reduce((max, pattern) => Math.max(max, Number(pattern.adults) + Number(pattern.children)), 0);
              const isStay = /accommodation/i.test(String(service.category || item?.category || ''));
              const capacitySummary = capacity
                ? isStay
                  ? `Max ${capacity} per room${maxPatternPax ? ` · ${Math.ceil(maxPatternPax / capacity)} room(s) needed for largest pattern` : ''}`
                  : `Capacity: ${capacity} traveller${capacity === 1 ? '' : 's'}`
                : '';
              return <article key={`${service.id || service.item_id}-${serviceIndex}`} className="package-canvas-service" draggable onDragStart={(event) => event.dataTransfer.setData('application/json', JSON.stringify({ type: 'service', fromDay: dayIndex, fromIndex: serviceIndex }))}>
                <GripVertical size={16} className="package-grip" />
                <div className="package-service-main"><strong>{service.item_name}</strong><small>{service.category || 'Service'}{service.supplier_name ? ` · ${service.supplier_name}` : ''}</small>
                  {item?.item_rates?.length > 1 && <select aria-label={`Rate for ${service.item_name}`} value={service.rate_id || ''} onChange={(event) => updateService(dayIndex, serviceIndex, 'rate_id', event.target.value)}>
                    {item.item_rates.map((rate) => <option key={rate.id} value={rate.id}>{rate.option_name || rate.season_name || 'Contract rate'} · {rate.currency} {Number(rate.unit_cost || rate.price_1_adult || rate.unit_price || 0).toFixed(2)}</option>)}
                  </select>}
                </div>
                <div className="package-service-price"><span>{service.currency_code} {Number(service.unit_cost || 0).toFixed(2)}</span><small>{service.rate_basis || 'per_person'} · no markup</small>{capacitySummary && <small>{capacitySummary}</small>}</div>
                <label className="package-included-toggle"><input type="checkbox" checked={service.is_included !== false} onChange={(event) => updateService(dayIndex, serviceIndex, 'is_included', event.target.checked)} /> Included</label>
                <label className="package-quantity">Qty <input type="number" min="1" step="1" value={service.quantity || 1} onChange={(event) => updateService(dayIndex, serviceIndex, 'quantity', Number(event.target.value) || 1)} /></label>
                <button type="button" className="package-icon-button" aria-label={`Remove ${service.item_name}`} onClick={() => removeService(dayIndex, serviceIndex)}><Trash2 size={16} /></button>
              </article>;
            })}
            {!day.services.length && <p className="package-drop-hint">Drop a library item here, or select this day and add from the sidebar.</p>}
            {days.length > 1 && <button type="button" className="package-remove-day" onClick={() => { setDays((previous) => previous.filter((_, index) => index !== dayIndex)); setSelectedDay(0); }}><Trash2 size={14} /> Remove day</button>}
          </section>)}
          {!days.length && <div className="package-canvas-empty">Add a day to start building this package.</div>}
        </main>
      </div>}
      {tab === 'validity' && <section className="package-tab-panel">
        <h2><CalendarDays size={19} /> Valid from / to dates</h2><p>Leave the list empty if the package has no restricted validity period.</p>
        {periods.map((period, index) => <div className="package-period" key={`period-${index}`}>
          <input type="date" aria-label="Valid from" value={period.valid_from || ''} onChange={(event) => changePeriod(index, 'valid_from', event.target.value)} />
          <span>to</span><input type="date" aria-label="Valid to" value={period.valid_to || ''} onChange={(event) => changePeriod(index, 'valid_to', event.target.value)} />
          <button type="button" className="package-icon-button" aria-label="Remove validity period" onClick={() => setPeriods((previous) => previous.filter((_, rowIndex) => rowIndex !== index))}><X size={16} /></button>
        </div>)}
        <button className="secondary-btn" onClick={addPeriod}><Plus size={15} /> Add validity period</button>
      </section>}
      {tab === 'travellers' && <section className="package-tab-panel">
        <h2>Traveller patterns &amp; contract price breakdown</h2><p>Shared unit charges are totalled and divided by the party size; accommodation is priced separately for adult sharing, single supplement, and children sharing with adults. A child without a contracted child rate is priced at the single rate.</p>
        <div className="package-pax-add"><label>Adults<input id="package-adults" type="number" min="1" defaultValue="2" /></label><label>Children<input id="package-children" type="number" min="0" defaultValue="0" /></label><button className="secondary-btn" onClick={addPaxPattern}><Plus size={15} /> Add pattern</button></div>
        {!paxOptions.length && <p>Add a traveller pattern to see the package price breakdown.</p>}
        <div className="package-breakdown-list">{breakdown.map((pattern, index) => <article key={`${pattern.id || 'new'}-${pattern.adults}-${pattern.children}-${index}`}>
          <header><strong>{pattern.adults} adult{pattern.adults === 1 ? '' : 's'}{pattern.children ? ` + ${pattern.children} child${pattern.children === 1 ? '' : 'ren'}` : ''}</strong><button type="button" className="package-icon-button" aria-label="Remove traveller pattern" onClick={() => setPaxOptions((previous) => previous.filter((_, rowIndex) => rowIndex !== index))}><Trash2 size={15} /></button></header>
          {pattern.currencies.length ? pattern.currencies.map((row) => <div className="package-currency-breakdown" key={row.currency}>
            <h3>{row.currency}</h3>
            <div className="package-breakdown-table-wrap"><table className="package-breakdown-table"><thead><tr><th>Package item</th><th>Unit contribution / person</th><th>Accommodation sharing / adult</th><th>Single supplement</th><th>Child sharing with adults</th></tr></thead>
              <tbody>
                {row.unitRows.map((item, itemIndex) => <tr key={`unit-${itemIndex}`}><td>{item.name}</td><td>{money(item.perPerson, row.currency)}</td><td>—</td><td>—</td><td>—</td></tr>)}
                {row.accommodationRows.map((item, itemIndex) => <tr key={`stay-${itemIndex}`}><td>{item.name}<small>{item.roomCount} room(s), max {item.capacity} per room</small></td><td>—</td><td>{money(item.sharingPerAdult, row.currency)}</td><td>{money(item.singleSupplement, row.currency)}</td><td>{money(item.childPerTraveller, row.currency)}</td></tr>)}
                <tr className="package-breakdown-total"><th>Total per person</th><td>{money(row.unitPerPerson, row.currency)}</td><td>{money(row.accommodationRows.reduce((sum, item) => sum + item.sharingPerAdult, 0), row.currency)}</td><td>{money(row.singleSupplement, row.currency)}</td><td>{money(row.accommodationRows.reduce((sum, item) => sum + item.childPerTraveller, 0), row.currency)}</td></tr>
              </tbody>
            </table></div>
            <div className="package-price-grid">
              <div><span>Total per adult sharing</span><strong>{money(row.totalPerPersonSharing, row.currency)}</strong></div>
              <div><span>Single supplement</span><strong>{money(row.singleSupplement, row.currency)}</strong><small>Added to an adult sharing price</small></div>
              <div><span>Total single adult price</span><strong>{money(row.totalSinglePerPerson, row.currency)}</strong></div>
              {pattern.children > 0 && <div><span>Child sharing with adults</span><strong>{money(row.childPerPerson, row.currency)}</strong><small>Includes allocated unit costs and child/single accommodation rate</small></div>}
            </div>
          </div>) : <p>No included services to price.</p>}
        </article>)}</div>
      </section>}
      {tab === 'inclusions' && <section className="package-tab-panel"><h2>Inclusions &amp; exclusions</h2><label className="package-field"><span>Inclusions</span><textarea rows={7} value={form.inclusions} onChange={(event) => updateForm('inclusions', event.target.value)} placeholder="Describe what is included in the package" /></label><label className="package-field"><span>Exclusions</span><textarea rows={7} value={form.exclusions} onChange={(event) => updateForm('exclusions', event.target.value)} placeholder="Describe what is not included" /></label></section>}
      {tab === 'terms' && <section className="package-tab-panel"><h2>Terms &amp; conditions</h2><label className="package-field"><span>Package terms and conditions</span><textarea rows={14} value={form.terms} onChange={(event) => updateForm('terms', event.target.value)} placeholder="Add package-specific terms and conditions" /></label></section>}
      {tab === 'client' && <section className="package-tab-panel"><h2>Assign / quote to clients</h2><p>Client assignment is optional and may include more than one client. This does not add markup to contract rates.</p>
        <div className="package-client-multiselect">
          <button type="button" className="package-client-select-trigger" aria-expanded={clientSelectOpen} onClick={() => setClientSelectOpen((open) => !open)}>
            <span>{selectedClients.length ? selectedClients.map(nameOf).join(', ') : 'Search and select client(s)'}</span><ChevronDown size={16} />
          </button>
          {clientSelectOpen && <div className="package-client-select-menu">
            <div className="packages-search"><Search size={15} /><input autoFocus value={clientQuery} onChange={(event) => setClientQuery(event.target.value)} placeholder="Search clients…" /></div>
            <div className="package-client-select-options">{visibleClients.map((client) => <label key={client.id}>
              <input type="checkbox" checked={form.assignedClientIds.includes(client.id)} onChange={(event) => updateForm('assignedClientIds', event.target.checked ? [...form.assignedClientIds, client.id] : form.assignedClientIds.filter((id) => id !== client.id))} />
              <span>{nameOf(client)}</span>
            </label>)}{!visibleClients.length && <p>No clients match your search.</p>}</div>
            <button type="button" className="package-client-select-done" onClick={() => { setClientSelectOpen(false); setClientQuery(''); }}>Done</button>
          </div>}
        </div>
        {!!selectedClients.length && <div className="package-client-selected">{selectedClients.map((client) => <button key={client.id} type="button" onClick={() => updateForm('assignedClientIds', form.assignedClientIds.filter((id) => id !== client.id))}>{nameOf(client)} <X size={13} /></button>)}</div>}
        {!clients.length && <p>No clients are set up for this company.</p>}
        <label className="package-field"><span>Package overview</span><textarea rows={4} value={form.description} onChange={(event) => updateForm('description', event.target.value)} placeholder="Optional package overview" /></label><label className="package-publish-toggle"><input type="checkbox" checked={form.isAvailable} onChange={(event) => updateForm('isAvailable', event.target.checked)} /><span><strong>Available in the itinerary Library Items picker</strong><small>When enabled, this package can be selected and quoted on client itineraries.</small></span></label></section>}
    </>}
    {exportDialog && <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setExportDialog(false); }}><section className="modal-content package-export-modal">
      <div className="modal-header"><div><h2>Export package</h2><p>Choose the format and optional content for the document.</p></div><button className="close-btn" onClick={() => setExportDialog(false)}><X size={20} /></button></div>
      <div className="package-export-options"><label><input type="radio" name="package-export-format" value="pdf" checked={exportFormat === 'pdf'} onChange={() => setExportFormat('pdf')} /> PDF (print / save as PDF)</label><label><input type="radio" name="package-export-format" value="word" checked={exportFormat === 'word'} onChange={() => setExportFormat('word')} /> Word document</label></div>
      <div className="package-export-options">{[['cover', 'Cover image'], ['inclusions', 'Inclusions and exclusions'], ['terms', 'Terms and conditions']].map(([key, label]) => <label key={key}><input type="checkbox" checked={exportOptions[key]} onChange={(event) => setExportOptions((previous) => ({ ...previous, [key]: event.target.checked }))} /> {label}</label>)}</div>
      <div className="package-modal-actions"><button className="secondary-btn" onClick={() => setExportDialog(false)}>Cancel</button><button className="primary-btn" onClick={exportDocument}><FileText size={16} /> Export</button></div>
    </section></div>}
  </div>;
};
