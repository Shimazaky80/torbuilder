import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Backpack, Baby, CalendarDays, Check, ChevronDown, Download, FileText,
  GripVertical, Plus, Save, Search, Trash2, X
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { usePageGuard } from '../context/NavigationGuardContext';
import { useCurrencies } from '../hooks/useCurrencies';
import {
  accommodationRoomPlan,
  calculatePackageTravellerBreakdown,
  largestTravellerPattern,
  normaliseChildAgeRange,
  PACKAGE_MAX_CHILD_AGE,
  packageChildAgeRange,
  packageItemCapacityError,
  packageRateForDates,
  packageSeasonResolution
} from '../lib/packagePricing';

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
  isAvailable: false, acceptsChildren: false, childAgeRange: null,
  assignedClientIds: []
};
const DEFAULT_CATEGORIES = [
  'Accommodation', 'Transfers', 'Activities / Tours', 'Flights / Charter',
  'Meals', 'Guide', 'Trains', 'Tickets', 'Extras', 'Car Rental'
];

/* Sidebar card presentation. The package picker deliberately mirrors the
   itinerary builder sidebar: one line of facts per item - name, category, the
   price exactly as it is loaded, supplier and the contract basis. Season names,
   validity dates and hover tooltips are deliberately absent, because the season
   that applies is worked out from the package validity dates (see
   packageRateForDates) and an operator should not have to choose it by hand.
   A season can still be overridden on the day row itself after the item lands. */
const SIDEBAR_FLAT_BASES = new Set(['per_vehicle', 'per_trip', 'per_room', 'flat']);

const basisOfRate = (rate, item) => rate?.rate_basis || item?.pricing_model || 'per_person';

const basisLabelOf = (basis) => ({
  per_person: 'per person',
  per_person_sharing: 'per person sharing',
  per_room: 'per room',
  per_vehicle: 'per vehicle',
  per_trip: 'per trip',
  per_unit: 'per unit',
  per_adult: 'per adult',
  per_child: 'per child',
  tiered: 'by pax count'
}[basis] || 'per person');

/* Raw contract figure, never divided by the traveller count. A flat room rate
   stores BOTH unit_price (the shared room total) and price_1_adult (the per
   adult sharing figure), and Library Items reads the room total from unit_price
   first - so this must too, or the sidebar and the contract matrix disagree. */
const contractPriceOf = (rate) => {
  const figure = (value) => parseFloat(value) || 0;
  if (!rate) return 0;
  if (SIDEBAR_FLAT_BASES.has(String(rate.rate_basis || ''))) {
    return figure(rate.unit_price) || figure(rate.price_1_adult) || figure(rate.price_2_adults);
  }
  return figure(rate.price_1_adult) || figure(rate.price_2_adults) || figure(rate.unit_price);
};


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
  const [selectedDay, setSelectedDay] = useState(0);
  const [tab, setTab] = useState('itinerary');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /* Pricing Protection, read from the same tenant setting the itinerary builder uses,
     so a package and an itinerary price the same superseded season the same way. */
  const [protectionPercent, setProtectionPercent] = useState(0);
  const [lastSaved, setLastSaved] = useState('');
  const [exportDialog, setExportDialog] = useState(false);
  const [exportOptions, setExportOptions] = useState({ cover: true, inclusions: true, terms: true });
  const [exportFormat, setExportFormat] = useState('pdf');
  const [clientSelectOpen, setClientSelectOpen] = useState(false);
  const [clientQuery, setClientQuery] = useState('');
  const [packagePreviewOpen, setPackagePreviewOpen] = useState(false);

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
        supabase.from('package_pax_options').select('*').eq('package_id', packageId).order('pax'),
        supabase.from('company_billing_settings').select('itinerary_terms, price_protection_percent').eq('company_id', profile.company_id).maybeSingle()
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
        acceptsChildren: Boolean(pkgRes.data.accepts_children),
        /* A package carries one child age range. Older packages saved several bands
           per supplier; only the first is kept so the price stays one number. */
        childAgeRange: packageChildAgeRange(Array.isArray(pkgRes.data.child_age_ranges) ? pkgRes.data.child_age_ranges[0] : null),
        assignedClientIds
      };
      setPkg(pkgRes.data);
      setForm(packageForm);
      setProtectionPercent(Math.max(0, Number(billingRes.data?.price_protection_percent) || 0));
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

  /* Every season, capacity and room decision below answers from these two
     lookups, so a service can never be priced from one contract row and then
     validated against a different one. */
  const itemForService = useCallback(
    (service) => library.find((entry) => entry.id === service?.item_id) || null,
    [library]
  );
  const rateForService = useCallback((service) => {
    const item = itemForService(service);
    return item?.item_rates?.find((rate) => rate.id === service?.rate_id) || service?.rate_snapshot || {};
  }, [itemForService]);
  const isStay = useCallback(
    (service) => /accommodation/i.test(String(service?.category || itemForService(service)?.category || '')),
    [itemForService]
  );

  /* Rooms are worked out from the party size rather than entered by hand. The
     biggest configured traveller pattern is the party the package is sized for. */
  const autoPattern = useMemo(() => largestTravellerPattern(paxOptions), [paxOptions]);
  const autoRoomsFor = useCallback(
    (service) => (isStay(service) ? accommodationRoomPlan(service, itemForService(service), autoPattern).roomCount : null),
    [isStay, itemForService, autoPattern]
  );
  const roomPlanFor = useCallback(
    (service) => accommodationRoomPlan(service, itemForService(service), autoPattern),
    [itemForService, autoPattern]
  );

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
    /* An item whose season does not span the package dates is not refused outright: the
       same Pricing Protection the itinerary builder applies takes over, and only a
       genuine dead end (no usable season on the item at all) stops the save. The
       message is collected so the operator is told exactly what was protected. */
    const seasonProblem = nextDays.flatMap((day) => day.services || [])
      .map((service) => {
        const item = library.find((entry) => entry.id === service.item_id) || null;
        const rate = item?.item_rates?.find((entry) => entry.id === service.rate_id) || service.rate_snapshot;
        return packageSeasonResolution({ item, rate, periods: validPeriods, currencyCode: service.currency_code, protectionPercent });
      })
      .find((season) => !season.canAdd);
    if (seasonProblem) {
      setTab('itinerary');
      showToast(seasonProblem.message, 'warning');
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
        accepts_children: nextForm.acceptsChildren,
        /* One child age range, capped at 18 because some properties still treat an
           18 year old as a child. It is stored as a single-element array so the
           existing package read paths keep working unchanged. */
        child_age_ranges: nextForm.acceptsChildren && nextForm.childAgeRange
          ? [normaliseChildAgeRange(nextForm.childAgeRange)]
          : [],
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
          is_included: service.is_included !== false,
          notes: service.notes || null,
          sort_order: sortOrder,
          quantity: autoRoomsFor(service) ?? Math.max(1, Number(service.quantity) || 1),
          vehicle_capacity: Number(service.vehicle_capacity) || null,
          rate_snapshot: service.rate_snapshot || {},
          /* Kept on the line so a protected price stays explainable after the save,
             exactly as it is on the itinerary. */
          price_protection_percent: Number(service.price_protection_percent) || 0,
          protected_season_name: service.protected_season_name || ''
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
          /* pax is the single party size. adults/children are kept as a mirror so
             anything still reading the old columns sees the same party. */
          nextPax.map(({ pax }) => ({ package_id: pkg.id, pax, adults: pax, children: 0 }))
        );
        if (paxError) throw paxError;
      }

      /* Accommodation is stored with the room count the party size works out to, so
         the saved package and the on-screen rows can never disagree. */
      const savedDays = nextDays.map((day, index) => ({
        ...day,
        day_number: index + 1,
        services: (day.services || []).map((service) => {
          const rooms = autoRoomsFor(service);
          return rooms ? { ...service, quantity: rooms } : service;
        })
      }));
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
  }, [companyId, pkg, days, periods, paxOptions, form, library, autoRoomsFor, protectionPercent, showToast]);

  const { requestNavigate } = usePageGuard('package-builder', 'this package', dirty, () => persist());

  /* The season an item should be added with: the one that actually runs for the
     package validity dates, so a drop never lands on an off-contract price. The
     season is never chosen by hand from the sidebar - the sidebar shows the
     resulting figure only. A different season can still be picked on the day
     row once the item has landed. */
  const rateForDates = (item) => {
    const eligible = (item.item_rates || []).filter((entry) => currencyMatches(entry, currencyFilter));
    const covering = packageRateForDates(item, periods);
    return (covering && eligible.find((entry) => entry.id === covering.id))
      || eligible[0];
  };

  /* An item joins the package on a season that spans the package validity dates. When
     no season does, the same Pricing Protection the itinerary builder applies stands
     in: the closest prior season is uplifted and the line is stored with the
     protection on it, so the operator is told rather than silently quoted an
     out-of-date rate. Only a genuine dead end (no usable season at all) is refused. */
  const seasonFor = (item, rate) => packageSeasonResolution({
    item, rate, periods, currencyCode: rate?.currency || item?.currency || '', protectionPercent
  });
  const addService = (item, rateId, dayIndex = selectedDay) => {
    const rate = rateId
      ? (item.item_rates || []).find((entry) => entry.id === rateId) || rateForDates(item)
      : rateForDates(item);
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
    const season = seasonFor(item, rate);
    if (!season.canAdd) {
      showToast(season.message, 'warning');
      return;
    }
    /* The stored rate is the protected one, so every later read of this line prices
       from the uplifted figure rather than re-deriving the un-uplifted season. */
    const storedRate = season.status === 'protected' ? season.rate : rate;
    const unitCost = Number(storedRate.unit_cost) || Number(storedRate.price_1_adult) || Number(storedRate.unit_price) || 0;
    const isStayItem = /accommodation/i.test(String(item.category || ''));
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
      quantity: isStayItem
        ? accommodationRoomPlan({ ...item, rate_id: rate.id }, item, autoPattern).roomCount
        : 1,
      is_included: true,
      vehicle_capacity: Number(item.max_occupancy) || Number(rate.max_occupancy) || 0,
      rate_snapshot: storedRate,
      price_protection_percent: season.protectionPercent || 0,
      protected_season_name: season.status === 'protected' ? season.seasonName : ''
    };
    if (season.message) showToast(season.message, season.status === 'protected' ? 'warning' : 'info');
    setDays((previous) => {
      if (!previous.length) return [{ day_number: 1, notes: '', services: [service] }];
      return previous.map((day, index) => index === dayIndex
        ? { ...day, services: [...day.services, service] }
        : day);
    });
  };

  const updateService = (dayIndex, serviceIndex, field, value) => {
    if (field === 'rate_id') {
      /* Switching seasons is held to the same rule as adding the item, and gets the
         same Pricing Protection rather than being refused outright. */
      const service = days[dayIndex]?.services?.[serviceIndex];
      const item = itemForService(service);
      const season = seasonFor(item, item?.item_rates?.find((entry) => entry.id === value));
      if (!season.canAdd) {
        showToast(season.message, 'warning');
        return;
      }
      if (season.message) showToast(season.message, season.status === 'protected' ? 'warning' : 'info');
    }
    setDays((previous) => previous.map((day, index) => index !== dayIndex ? day : {
      ...day,
      services: day.services.map((service, indexInDay) => {
        if (indexInDay !== serviceIndex) return service;
        if (field !== 'rate_id') return { ...service, [field]: value };
        const item = library.find((entry) => entry.id === service.item_id);
        const rate = item?.item_rates?.find((entry) => entry.id === value);
        if (!rate) return service;
        const season = seasonFor(item, rate);
        const storedRate = season.status === 'protected' ? season.rate : rate;
        const unitCost = Number(storedRate.unit_cost) || Number(storedRate.price_1_adult) || Number(storedRate.unit_price) || 0;
        return {
          ...service,
          rate_id: rate.id,
          rate_basis: rate.rate_basis || item.pricing_model || service.rate_basis,
          currency_code: rate.currency || item.currency || service.currency_code,
          unit_cost: unitCost,
          unit_price: unitCost,
          quantity: isStay(service)
            ? accommodationRoomPlan({ ...item, rate_id: rate.id }, item, autoPattern).roomCount
            : service.quantity,
          vehicle_capacity: Number(item.max_occupancy) || Number(rate.max_occupancy) || service.vehicle_capacity || 0,
          rate_snapshot: storedRate,
          price_protection_percent: season.protectionPercent || 0,
          protected_season_name: season.status === 'protected' ? season.seasonName : ''
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

  /* One price per traveller pattern and currency. The child age range is passed in
     because a child is priced once, against the accommodation, and that same figure
     feeds the child card in this breakdown and the Children tab. */
  const childRange = packageChildAgeRange(form.childAgeRange);
  const breakdown = useMemo(() => paxOptions.map((pattern) => ({
    ...pattern,
    currencies: calculatePackageTravellerBreakdown({ days, pattern, library, childRange })
  })), [paxOptions, days, library, childRange]);

  const setChildRange = (range) => setForm((previous) => ({ ...previous, childAgeRange: range }));
  const changeChildRange = (field, value) => setChildRange(normaliseChildAgeRange({
    ...(form.childAgeRange || { ageFrom: 0, ageTo: PACKAGE_MAX_CHILD_AGE }),
    [field]: value
  }));

  /* The child price does not move with the party size, so it is priced off the
     biggest pattern and shown once on the Children tab. */
  const childBreakdown = useMemo(() => calculatePackageTravellerBreakdown({
    days,
    library,
    childRange,
    pattern: largestTravellerPattern(paxOptions)
  }), [days, library, childRange, paxOptions]);

  const buildExportHtml = (options) => {
    const cover = options.cover && pkg.cover_image_url
      ? `<img class="cover" src="${escapeHtml(pkg.cover_image_url)}" alt="">`
      : '';
    const dayMarkup = days.map((day, index) => {
      const services = day.services.filter((service) => service.is_included !== false)
        .map((service) => `<li>${escapeHtml(service.item_name)}${service.supplier_name ? ` — ${escapeHtml(service.supplier_name)}` : ''}</li>`).join('');
      return `<section><h2>Day ${index + 1}</h2>${day.notes ? `<p>${escapeHtml(day.notes)}</p>` : ''}<ul>${services}</ul></section>`;
    }).join('');
    const pricingMarkup = breakdown.map((pattern) => `<section><h2>${pattern.pax} pax</h2>${pattern.currencies.map((row) => `<p><b>${escapeHtml(row.currency)}</b> — Total per adult sharing: ${money(row.adultSharingTotal, row.currency)} · Single supplement (adult own room): ${money(row.singleSupplementTotal, row.currency)} · Child sharing with adult: ${money(row.childTotal, row.currency)}</p><ul>${row.accommodationRows.map((item) => `<li>${escapeHtml(item.name)} — adult sharing: ${money(item.sharingPerAdult, row.currency)} · single supplement: ${money(item.singleSupplement, row.currency)} · child: ${money(item.childAccommodation, row.currency)}${item.childAllowed ? '' : ' (single supplement)'} · ${item.roomCount} room(s), max ${item.capacity} per room</li>`).join('')}</ul>`).join('') || '<p>No priced items.</p>'}</section>`).join('');
    const validity = periods.map((period) => `<li>${escapeHtml(period.valid_from)} – ${escapeHtml(period.valid_to)}</li>`).join('');
    const inclusionMarkup = options.inclusions
      ? `${form.inclusions ? `<h3>Inclusions</h3><p>${escapeHtml(form.inclusions).replace(/\n/g, '<br>')}</p>` : ''}${form.exclusions ? `<h3>Exclusions</h3><p>${escapeHtml(form.exclusions).replace(/\n/g, '<br>')}</p>` : ''}`
      : '';
    const termsMarkup = options.terms && form.terms
      ? `<section><h2>Terms &amp; Conditions</h2><p>${escapeHtml(form.terms).replace(/\n/g, '<br>')}</p></section>`
      : '';
    const childMarkup = form.acceptsChildren && childRange
      ? `<section><h2>Child price</h2><p>Quoted per child for ages ${childRange.ageFrom}–${childRange.ageTo}. A child pays the same per-pax unit share as an adult, plus each accommodation below.</p>${childBreakdown.map((row) => `<p><b>${escapeHtml(row.currency)}</b> — child sharing with adult: ${money(row.childTotal, row.currency)}</p><ul>${row.accommodationRows.map((item) => `<li>${escapeHtml(item.name)} — ${item.childAllowed ? `child band ${escapeHtml(item.childBandName)}: ${money(item.childAccommodation, row.currency)}` : `does not accept a child for this age range: ${money(item.childAccommodation, row.currency)} single supplement`}</li>`).join('') || '<li>No accommodation in this package.</li>'}</ul>`).join('') || '<p>No priced items.</p>'}</section>`
      : `<section><h2>Child price</h2><p>${form.acceptsChildren ? 'Set a child age range to price a child.' : 'Children are not accepted on this package.'}</p></section>`;
    const clientNames = selectedClients.map(nameOf).join(', ');
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(pkg.name)}</title><style>body{font:15px Arial,sans-serif;color:#1e293b;max-width:850px;margin:36px auto;padding:0 24px}h1,h2,h3{color:#0d7478}header{border-bottom:2px solid #0d7478;padding-bottom:16px;margin-bottom:24px}section{margin:22px 0;padding-bottom:12px;border-bottom:1px solid #e2e8f0}.cover{max-width:100%;max-height:280px;object-fit:cover}li{margin:6px 0}@media print{body{margin:0 auto}}</style></head><body><header>${cover}<h1>${escapeHtml(pkg.name)}</h1><p>${escapeHtml(form.description)}</p>${validity ? `<h3>Valid dates</h3><ul>${validity}</ul>` : ''}${clientNames ? `<p>Quoted for: ${escapeHtml(clientNames)}</p>` : ''}</header>${dayMarkup}${inclusionMarkup ? `<section>${inclusionMarkup}</section>` : ''}<h2>Traveller pattern pricing</h2>${pricingMarkup}${childMarkup}${termsMarkup}</body></html>`;
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
  /* A traveller pattern is a party size, nothing more. A child is priced once against
     the accommodation in the Children tab, so it is not counted here as well. */
  const addPaxPattern = () => {
    const pax = Number(document.getElementById('package-pax')?.value) || 0;
    if (pax < 1) {
      showToast('A traveller pattern needs at least one traveller.', 'warning');
      return;
    }
    if (paxOptions.some((option) => (Number(option.pax) || 0) === pax)) {
      showToast('That traveller pattern already exists.', 'warning');
      return;
    }
    const candidate = { pax };
    const oversized = days.flatMap((day) => day.services)
      .map((service) => {
        const saved = itemForService(service);
        const item = {
          ...(saved || {}),
          category: saved?.category || service.category,
          max_occupancy: saved?.max_occupancy || service.vehicle_capacity,
          name: saved?.name || service.item_name
        };
        return { error: packageItemCapacityError(item, rateForService(service), [candidate]) };
      })
      .find((entry) => entry.error);
    if (oversized) {
      showToast(oversized.error, 'warning');
      return;
    }
    setPaxOptions((previous) => [...previous, candidate].sort((a, b) => (Number(a.pax) || 0) - (Number(b.pax) || 0)));
  };

  if (!packageId) return <div className="super-admin-page"><button className="secondary-btn" onClick={() => navigate('/packages')}><ArrowLeft size={16} /> Packages</button><p>Open a package from the Packages list.</p></div>;

  const tabs = [
    ['itinerary', 'Itinerary'],
    ['validity', 'Valid dates'],
    ['travellers', 'Travellers & pricing'],
    ['children', 'Children & ages'],
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
              const rate = rateForDates(item);
              const coverage = seasonFor(item, rate);
              const basis = basisOfRate(rate, item);
              const addToDay = () => addService(item, rate?.id);
              return <article key={item.id} className={`package-library-card ${!rate ? 'unavailable' : ''}`} draggable={!!rate} onDragStart={(event) => event.dataTransfer.setData('application/json', JSON.stringify({ type: 'library', itemId: item.id, rateId: rate?.id }))} onDoubleClick={addToDay}>
                <div className="package-library-top">
                  <span className="package-library-name">{item.name}</span>
                  <GripVertical size={16} className="package-library-grip" />
                </div>
                <div className="package-library-meta">
                  <span className="item-cat-tag">{item.category || 'General'}</span>
                  {rate
                    ? <span className="item-price-tag">{money(contractPriceOf(rate), rate.currency || item.currency || 'ZAR')} <span style={{ color: '#94a3b8', fontWeight: 500 }}>{basisLabelOf(basis)}</span></span>
                    : <span className="item-price-tag missing">No rate{eligibleRates.length ? ' in this currency' : ''}</span>}
                </div>
                <div className="package-library-supplier">
                  {item.supplier_name || ''}
                  {SIDEBAR_FLAT_BASES.has(String(basis)) && <span className="basis-tag">{basisLabelOf(basis)}</span>}
                  {(coverage.status !== 'ok' && coverage.status !== 'open') && <span className="basis-tag package-library-flag warn" title={coverage.message}>
                    {coverage.status === 'protected' ? `Protection ${coverage.protectionPercent}%` : coverage.status === 'blocked' ? 'No matching season' : 'Season mismatch'}
                  </span>}
                </div>
                <button type="button" className="secondary-btn package-library-add" onClick={addToDay} disabled={!rate}>Add to day {selectedDay + 1}</button>
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
              const item = itemForService(service);
              const coverage = seasonFor(item, rateForService(service));
              const roomPlan = isStay(service) ? roomPlanFor(service) : null;
              const capacity = Number(item?.max_occupancy || service.vehicle_capacity) || 0;
              const capacitySummary = capacity
                ? isStay(service)
                  ? `Max ${capacity} per room`
                  : `Capacity: ${capacity} traveller${capacity === 1 ? '' : 's'}`
                : '';
              return <article key={`${service.id || service.item_id}-${serviceIndex}`} className="package-canvas-service" draggable onDragStart={(event) => event.dataTransfer.setData('application/json', JSON.stringify({ type: 'service', fromDay: dayIndex, fromIndex: serviceIndex }))}>
                <GripVertical size={16} className="package-grip" />
                <div className="package-service-main"><strong>{service.item_name}</strong><small>{service.category || 'Service'}{service.supplier_name ? ` · ${service.supplier_name}` : ''}</small>
                  {item?.item_rates?.length > 1 && <select aria-label={`Rate for ${service.item_name}`} value={service.rate_id || ''} onChange={(event) => updateService(dayIndex, serviceIndex, 'rate_id', event.target.value)}>
                    {item.item_rates.map((rate) => <option key={rate.id} value={rate.id}>{rate.season_name || rate.option_name || 'Contract rate'} · {rate.currency} {Number(rate.unit_cost || rate.price_1_adult || rate.unit_price || 0).toFixed(2)}</option>)}
                  </select>}
                  {Number(service.price_protection_percent) > 0
                    ? <small className="package-season-warning protected" title={service.rate_snapshot?.protection_note || 'Pricing Protection applied'}>{service.protected_season_name ? `Pricing Protection applied — ${service.protected_season_name} season +${service.price_protection_percent}%` : `Pricing Protection applied +${service.price_protection_percent}%`}</small>
                    : !coverage.ok && <small className="package-season-warning" title={coverage.message}>{coverage.message}</small>}
                  {Number(service.price_protection_percent) > 0 && <small className="package-protected-flag">{service.currency_code} {Number(service.unit_cost || 0).toFixed(2)} includes the protection uplift</small>}
                </div>
                <div className="package-service-price"><span>{service.currency_code} {Number(service.unit_cost || 0).toFixed(2)}</span><small>{service.rate_basis || 'per_person'} · no markup</small>{capacitySummary && <small>{capacitySummary}</small>}
                  {roomPlan && <small title={`Rooms are worked out from ${autoPattern.pax} pax at ${roomPlan.capacity} per room`}>
                    {roomPlan.roomCount} room{roomPlan.roomCount === 1 ? '' : 's'} auto · {round(roomPlan.sharingPerAdult).toFixed(2)}/adult sharing · +{round(roomPlan.singleSupplement).toFixed(2)} single supp.
                  </small>}
                </div>
                <label className="package-included-toggle"><input type="checkbox" checked={service.is_included !== false} onChange={(event) => updateService(dayIndex, serviceIndex, 'is_included', event.target.checked)} /> Included</label>
                {roomPlan
                  ? <span className="package-quantity auto" title={`Rooms are worked out from ${autoPattern.pax} pax at ${roomPlan.capacity} per room — no need to add rooms by hand`}>Rooms {roomPlan.roomCount}</span>
                  : <label className="package-quantity">Qty <input type="number" min="1" step="1" value={service.quantity || 1} onChange={(event) => updateService(dayIndex, serviceIndex, 'quantity', Number(event.target.value) || 1)} /></label>}
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
        <h2>Traveller patterns &amp; contract price breakdown</h2><p>Each pattern is a party size. Every non-accommodation service is shared unit cost divided by pax, and the accommodation is priced per adult sharing plus its single supplement. A child is priced once from the same unit share — see the Children &amp; ages tab.</p>
        /* The field is uncontrolled and kept its last value, so it sat on 2 next to an
           8-pax pattern and invited the same party to be added twice. Remounting it
           on the pattern count clears it after every successful add. */
        <div className="package-pax-add"><label>Pax<input key={`pax-${paxOptions.length}`} id="package-pax" type="number" min="1" defaultValue="2" /></label><button className="secondary-btn" onClick={addPaxPattern}><Plus size={15} /> Add pattern</button></div>
        {!paxOptions.length && <p>Add a traveller pattern to see the package price breakdown.</p>}
        <div className="package-breakdown-list">{breakdown.map((pattern, index) => <article key={`${pattern.id || 'new'}-${pattern.pax}-${index}`}>
          <header><strong>{pattern.pax} pax</strong><button type="button" className="package-icon-button" aria-label="Remove traveller pattern" onClick={() => setPaxOptions((previous) => previous.filter((_, rowIndex) => rowIndex !== index))}><Trash2 size={15} /></button></header>
          {pattern.currencies.length ? pattern.currencies.map((row) => <div className="package-currency-breakdown" key={row.currency}>
            <h3>{row.currency}</h3>
            <div className="package-breakdown-table-wrap"><table className="package-breakdown-table"><thead><tr><th>Package item</th><th>Total unit contribution / pax</th><th>Total accommodation sharing per pax (adult / child)</th><th>Total single supplement</th></tr></thead>
              <tbody>
                {/* Every column is filled for every row. A unit service carries no room
                    cost, so those cells are a real 0.00 rather than a dash. */}
                {row.unitRows.map((item, itemIndex) => <tr key={`unit-${itemIndex}`}><td>{item.name}</td><td>{money(item.perPerson, row.currency)}</td><td>{money(item.sharingPerAdult, row.currency)}</td><td>{money(item.singleSupplement, row.currency)}</td></tr>)}
                {row.accommodationRows.map((item, itemIndex) => <tr key={`stay-${itemIndex}`}><td>{item.name}<small>{item.roomCount} room(s) allocated, max {item.capacity} per room</small></td><td>{money(0, row.currency)}</td><td><span>Adult {money(item.sharingPerAdult, row.currency)}</span><br /><span>Child {money(item.childAccommodation, row.currency)}{item.childAllowed ? '' : ' (single supp.)'}</span></td><td>{money(item.singleSupplement, row.currency)}</td></tr>)}
                <tr className="package-breakdown-total"><th>Total</th><td>{money(row.unitPerPerson, row.currency)}</td><td><span>Adult {money(row.accommodationSharing, row.currency)}</span><br /><span>Child {money(row.childAccommodation, row.currency)}</span></td><td>{money(row.singleSupplement, row.currency)}</td></tr>
              </tbody>
            </table></div>
            <div className="package-price-grid">
              <div><span>Total per adult sharing</span><strong>{money(row.adultSharingTotal, row.currency)}</strong><small>Unit share {money(row.unitPerPerson, row.currency)} + sharing {money(row.accommodationSharing, row.currency)}</small></div>
              <div><span>Total single supplement for adults in own room</span><strong>{money(row.singleSupplementTotal, row.currency)}</strong><small>Added to the adult sharing price</small></div>
              <div><span>Child sharing with adult price</span><strong>{money(row.childTotal, row.currency)}</strong><small>Unit share {money(row.unitPerPerson, row.currency)} + accommodation {money(row.childAccommodation, row.currency)}</small>
                {!childRange && <small>Set the child age range on the Children &amp; ages tab</small>}
                {!!childRange && !!row.childNotAllowed.length && <small>Not accepted, priced at single supplement: {row.childNotAllowed.join(', ')}</small>}
              </div>
            </div>
          </div>) : <p>No included services to price.</p>}
        </article>)}</div>
      </section>}
      {tab === 'children' && <section className="package-tab-panel">
        <h2><Baby size={19} /> Children on this package</h2>
        <p>A child is only priced differently because of the accommodation. Everything else in the package is shared unit cost divided by pax, and a child pays exactly that same unit share. The one figure that can differ is the room, and that comes from the property's own child price for the age range set below.</p>
        <label className="package-publish-toggle"><input type="checkbox" checked={form.acceptsChildren} onChange={(event) => updateForm('acceptsChildren', event.target.checked)} /><span><strong>A child may travel on this package</strong><small>When off, the package is quoted for adults only and no child price is published.</small></span></label>
        {!form.acceptsChildren ? <p className="package-child-off">Children are not accepted on this package.</p> : <>
          <div className="package-child-toolbar">
            <h3>Child age range</h3>
          </div>
          <p>One range only, up to {PACKAGE_MAX_CHILD_AGE} years old, because a package publishes one child price. Where a property contracts its own age bands, the band that covers this range decides the price, and the most expensive band is used so a wide range is never under-quoted.</p>
          <div className="package-child-bands">
            <div className="package-child-band">
              <label>From (yrs)<input type="number" min="0" max={PACKAGE_MAX_CHILD_AGE} value={childRange?.ageFrom ?? 0} onChange={(event) => changeChildRange('ageFrom', Number(event.target.value) || 0)} /></label>
              <label>To (yrs)<input type="number" min="0" max={PACKAGE_MAX_CHILD_AGE} value={childRange?.ageTo ?? PACKAGE_MAX_CHILD_AGE} onChange={(event) => changeChildRange('ageTo', event.target.value === '' ? PACKAGE_MAX_CHILD_AGE : Number(event.target.value))} /></label>
            </div>
          </div>
          <h3 className="package-child-price-title">What each accommodation charges for that range</h3>
          <p>The child price is the same unit share an adult pays, plus each accommodation below: the property's own child rate where it has one for this range, or its single supplement where it does not accept a child.</p>
{childBreakdown.length ? childBreakdown.map((row) => <div className="package-currency-breakdown" key={`child-${row.currency}`}>
            <h3>{row.currency}</h3>
            {!childRange ? <p className="package-child-off">Set the child age range above to price a child.</p> : <>
            <div className="package-breakdown-table-wrap"><table className="package-breakdown-table"><thead><tr><th>Accommodation</th><th>Contracted child band</th><th>Charges a child</th><th>Child accommodation price</th></tr></thead>
              <tbody>
                {row.accommodationRows.map((item, itemIndex) => <tr key={`child-stay-${itemIndex}`}>
                  <td>{item.name}</td>
                  <td>{item.childBandName || 'No child band on this property'}</td>
                  <td>{item.childAllowed ? 'Yes' : 'No'}</td>
                  <td>{money(item.childAccommodation, row.currency)}{item.childAllowed ? '' : ' (single supplement)'}</td>
                </tr>)}
                {!row.accommodationRows.length && <tr><td colSpan={4}>No accommodation in this package, so the child price is the per-pax unit share.</td></tr>}
              </tbody>
            </table></div>
            <div className="package-price-grid">
              <div><span>Child sharing with adult price</span><strong>{money(row.childTotal, row.currency)}</strong><small>Unit share {money(row.unitPerPerson, row.currency)} + accommodation {money(row.childAccommodation, row.currency)}</small></div>
            </div>
            {!!row.accommodationRows.length && !!row.childNotAllowed.length && <p className="package-child-note">{row.childNotAllowed.join(', ')} does not accept a child for {childRange.ageFrom}–{childRange.ageTo} yrs, so its single supplement is included in the child price above.</p>}
            </>}
          </div>) : <p>No included services to price.</p>}
        </>}
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
        <label className="package-field"><span>Package overview</span><textarea rows={4} value={form.description} onChange={(event) => updateForm('description', event.target.value)} placeholder="Optional package overview" /></label>
        <label className="package-publish-toggle"><input type="checkbox" checked={form.isAvailable} onChange={(event) => updateForm('isAvailable', event.target.checked)} /><span><strong>Available in the itinerary Library Items picker</strong><small>When enabled, this package can be selected and quoted on client itineraries.</small></span></label>
        {form.isAvailable && <div className="package-library-preview">
          <p className="package-preview-help">This is how the package appears in the picker — one line. Expand it to review every item that makes it up and remove anything that should not travel with the package.</p>
          <button type="button" className="package-preview-line" aria-expanded={packagePreviewOpen} onClick={() => setPackagePreviewOpen((open) => !open)}>
            <span className="package-preview-name">{pkg?.name || 'This package'}</span>
            <span className="package-preview-meta">{days.length} day{days.length === 1 ? '' : 's'} · {days.reduce((sum, day) => sum + day.services.length, 0)} item{days.reduce((sum, day) => sum + day.services.length, 0) === 1 ? '' : 's'}{form.acceptsChildren ? ' · child rates included' : ''}</span>
            <ChevronDown size={15} className={`package-preview-chevron ${packagePreviewOpen ? 'open' : ''}`} />
          </button>
          {packagePreviewOpen && <div className="package-preview-items">
            {days.length ? days.map((day, dayIndex) => <section key={day.id || `preview-${dayIndex}`}>
              <strong>Day {dayIndex + 1}</strong>
              {(day.services || []).map((service, serviceIndex) => <div className="package-preview-item" key={`${service.id || service.item_id}-${serviceIndex}`}>
                <span>{service.item_name}<small>{service.category || 'Service'}{service.supplier_name ? ` · ${service.supplier_name}` : ''}{service.is_included === false ? ' · optional' : ''}</small></span>
                <span className="package-preview-price">{service.currency_code} {Number(service.unit_cost || 0).toFixed(2)} × {service.quantity || 1}</span>
                <button type="button" className="package-icon-button" aria-label={`Remove ${service.item_name} from the package`} onClick={() => removeService(dayIndex, serviceIndex)}><Trash2 size={14} /></button>
              </div>)}
              {!day.services.length && <p>No items on this day.</p>}
            </section>) : <p>No days saved in this package yet.</p>}
          </div>}
        </div>}
      </section>}
    </>}
    {exportDialog && <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setExportDialog(false); }}><section className="modal-content package-export-modal">
      <div className="modal-header"><div><h2>Export package</h2><p>Choose the format and optional content for the document.</p></div><button className="close-btn" onClick={() => setExportDialog(false)}><X size={20} /></button></div>
      <div className="package-export-options"><label><input type="radio" name="package-export-format" value="pdf" checked={exportFormat === 'pdf'} onChange={() => setExportFormat('pdf')} /> PDF (print / save as PDF)</label><label><input type="radio" name="package-export-format" value="word" checked={exportFormat === 'word'} onChange={() => setExportFormat('word')} /> Word document</label></div>
      <div className="package-export-options">{[['cover', 'Cover image'], ['inclusions', 'Inclusions and exclusions'], ['terms', 'Terms and conditions']].map(([key, label]) => <label key={key}><input type="checkbox" checked={exportOptions[key]} onChange={(event) => setExportOptions((previous) => ({ ...previous, [key]: event.target.checked }))} /> {label}</label>)}</div>
      <div className="package-modal-actions"><button className="secondary-btn" onClick={() => setExportDialog(false)}>Cancel</button><button className="primary-btn" onClick={exportDocument}><FileText size={16} /> Export</button></div>
    </section></div>}
  </div>;
};
