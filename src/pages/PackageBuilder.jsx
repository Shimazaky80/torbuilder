import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Backpack, Baby, CalendarDays, ChevronDown, Download, FileText,
  GripVertical, Plus, Save, Search, Trash2, X
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { usePageGuard } from '../context/NavigationGuardContext';
import {
  accommodationRoomPlan,
  calculatePackageTravellerBreakdown,
  largestTravellerPattern,
  normaliseChildAgeRange,
  PACKAGE_MAX_CHILD_AGE,
packageBandCapacityError,
  packageBandLabel,
  packageBandPax,
  packageBandSuggestions,
  packageChildAgeRange,
  applyPackageMarkup,
  packageCurrencyFor,
  packageKey,
  packageMarkupPercent,
  packageItemCapacitySetupError,
  packageVehicleCapacity,
packageAutoBandKey,
packageIsTransport,
packageTransportSummary,
packageRateForDates,
  packageSeasonResolution,
  packageTierDays
} from '../lib/packagePricing';

const uuid = packageKey;

const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
const money = (value, code) => `${code} ${round(value).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nameOf = (client) => client?.name || 'Unnamed client';
/* Bands read smallest party first. Every band is the operator's: the vehicles only ever
   suggest party sizes, so there is nothing for a rebuild to take back off them. */
const byBandMin = (a, b) => packageBandPax(a) - packageBandPax(b);const currencyMatches = (rate, code) => !code || String(rate?.currency || '').toUpperCase() === String(code).toUpperCase();
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
  const [results, setResults] = useState([]);
const [selectedDay, setSelectedDay] = useState(0);
const [tab, setTab] = useState('itinerary');
/* Which band the Itinerary tab is being edited as. Empty string means the shared base
   itinerary that every band uses. */
const [bandScope, setBandScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /* Pricing Protection, read from the same tenant setting the itinerary builder uses,
     so a package and an itinerary price the same superseded season the same way. */
  const [protectionPercent, setProtectionPercent] = useState(0);
  const [lastSaved, setLastSaved] = useState('');
  const [exportDialog, setExportDialog] = useState(false);
  /* bandPrice is which figure leads the band section. 'party' shows what the whole party pays,
   which is the number that has to recover the vehicle; 'perPerson' shows the per-adult
   share, which is how a client is normally quoted. Either way the party total stays on the
   card, because a per-person price on its own is what made a small party look under-quoted. */
  const [exportOptions, setExportOptions] = useState({ cover: true, inclusions: true, terms: true, explainPricing: false, bandPrices: true, bandPrice: 'party', bandSelection: 'all', showVehicleOptions: false, partyCard: 'both', audience: 'client' });
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
        supabase.from('clients').select('id, name, markup_percentage').eq('company_id', profile.company_id).order('name'),
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
      if (!companyId || (term.length > 0 && term.length < 2 && !categoryFilter)) {
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
  }, [search, categoryFilter, companyId, showToast]);

  const categoryOptions = useMemo(() => [...new Set([
    ...DEFAULT_CATEGORIES,
    ...results.map((item) => item.category).filter(Boolean)
  ])].sort(), [results]);

  const destinationOptions = useMemo(() => [...new Set([
    ...destinationCatalog,
    ...results.flatMap(destinationsOf)
  ])].sort((a, b) => a.localeCompare(b)), [destinationCatalog, results]);

/* The currency chosen when the package was created, so the sidebar can filter the library
   before a single service has been added. Falling back to the first included service covers
   packages created before the currency was chosen. */
const packageCurrency = packageCurrencyFor(days, pkg?.currency_code);

  /* A package is priced in one currency, so the sidebar filters the library down to the
     rates that can actually go into this package rather than offering a currency picker
     that produced three competing totals. The currency is set by the first service added
     and reported next to the search box. */
  const visibleResults = useMemo(() => results.filter((item) => {
    if (destinationFilter && !destinationsOf(item).includes(destinationFilter)) return false;
    /* An item with no rate in the package's currency cannot be priced into this package at
       all, so it is hidden rather than listed as unavailable: with one currency per package
       it is clutter, not information. Before the first service is added there is no currency
       yet, and everything stays visible so the first pick can set it. */
    if (packageCurrency && !(item.item_rates || []).some((entry) => currencyMatches(entry, packageCurrency))) return false;
    return true;
  }), [results, destinationFilter, packageCurrency]);

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

  /* A band is one exact party size and always belongs to the operator: the vehicles in the
     itinerary only ever SUGGEST party sizes, so nothing here is derived and nothing can be
     taken away when a vehicle is added or removed.

     A suggestion the operator accepts gets the stable key for its party size, so accepting
     the same suggestion again after deleting it reattaches to the same key rather than
     orphaning any band services that pointed at it. */
  const bandSuggestions = useMemo(
    () => packageBandSuggestions(days, library, paxOptions),
    [days, library, paxOptions]
  );
  const mergedBands = useMemo(() => [...paxOptions].sort(byBandMin), [paxOptions]);

  const acceptBandSuggestion = (pax) => {
    /* Only the transport this band would actually be given counts here. Asking the whole
       package instead would reject the band because some other band owns a smaller bus. */
    const capacityError = packageBandCapacityError(days, library, { pax });
    if (capacityError) {
      showToast(capacityError, 'warning');
      return;
    }
    setPaxOptions((previous) => [...previous, {
      pax,
      min_pax: pax,
      max_pax: pax,
      item_key: packageAutoBandKey(pax),
      is_auto_generated: false
    }].sort(byBandMin));
  };

  /* Rooms are worked out from the party size rather than entered by hand. The widest band
     is the largest party the package has to sleep, so that band sizes the accommodation. */
  const autoPattern = useMemo(() => largestTravellerPattern(mergedBands), [mergedBands]);
  const autoRoomsFor = useCallback(
    (service) => (isStay(service) ? accommodationRoomPlan(service, itemForService(service), autoPattern).roomCount : null),
    [isStay, itemForService, autoPattern]
  );
  const roomPlanFor = useCallback(
    (service) => accommodationRoomPlan(service, itemForService(service), autoPattern),
    [itemForService, autoPattern]
  );

const persist = useCallback(async (nextDays = days, nextPeriods = periods, nextPax = mergedBands, nextForm = form) => {
   if (!companyId || !pkg) return false;
   const validPeriods = nextPeriods.filter((period) => period.valid_from && period.valid_to);
   /* Resolved from the client records rather than the component state so a save always
      stamps the same figure the pricing cards are showing, even when triggered by an
      autosave that has not re-rendered yet. */
   const assignedMarkup = packageMarkupPercent(clients.filter((client) => nextForm.assignedClientIds.includes(client.id)));
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
default_markup_percentage: assignedMarkup,
  /* Kept in step with the currency chosen at creation. It is not editable here: the modal
     owns it, and only while the package has no priced services. */
  currency_code: packageCurrency
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
          unit_price: applyPackageMarkup(Number(service.unit_cost) || 0, assignedMarkup),
          markup_percentage: assignedMarkup,
          is_included: service.is_included !== false,
          notes: service.notes || null,
          sort_order: sortOrder,
          quantity: autoRoomsFor(service) ?? Math.max(1, Number(service.quantity) || 1),
          vehicle_capacity: Number(service.vehicle_capacity) || null,
          /* Stable identity for the line. A band item points at the base item it replaces
             by this key, and both sides have to survive the delete-and-reinsert that
             persist() does to the whole package on every save. */
          item_key: service.item_key || uuid(),
          tier_key: service.tier_key || null,
          replaces_item_key: service.replaces_item_key || null,
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
          /* pax is the party's exact headcount: a vehicle is paid for in full by the travellers in it,
             so the band total comes back to the contracted cost exactly.
             adults/children are kept
             as a mirror so anything still reading the old columns sees the same party.

             item_key is generated on the client and written through unchanged: persist()
             recreates every row id on each save, so band membership is linked by this key
             and would dangle if it were a foreign key. */
          nextPax.map((band) => ({
            package_id: pkg.id,
            item_key: band.item_key || uuid(),
            pax: packageBandPax(band),
            adults: packageBandPax(band),
            children: 0,
            /* A band is one exact party size, so both columns carry the same number. They
               are still written because the columns are not null and are read by the
               Packages list when it needs a party size. */
            min_pax: packageBandPax(band),
            max_pax: packageBandPax(band),
            is_auto_generated: false
          }))
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
  }, [companyId, pkg, days, periods, mergedBands, form, library, autoRoomsFor, protectionPercent, clients, packageCurrency, showToast]);

  const { requestNavigate } = usePageGuard('package-builder', 'this package', dirty, () => persist());

  /* The season an item should be added with: the one that actually runs for the
     package validity dates, so a drop never lands on an off-contract price. The
     season is never chosen by hand from the sidebar - the sidebar shows the
     resulting figure only. A different season can still be picked on the day
     row once the item has landed. */
  const rateForDates = (item) => {
    const eligible = (item.item_rates || []).filter((entry) => currencyMatches(entry, packageCurrency));
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
  const addService = (item, rateId, dayIndex = selectedDay, scope = {}) => {
    const rate = rateId
      ? (item.item_rates || []).find((entry) => entry.id === rateId) || rateForDates(item)
      : rateForDates(item);
    if (!rate) {
      showToast((item.item_rates || []).length
        ? `This library item has no contract rate in ${packageCurrency}, which is what this package is priced in. Add the rate in Library Items, or pick an item priced in ${packageCurrency}.`
        : 'This library item has no loaded contract rates. Add a rate in Library Items first.', 'warning');
      return;
    }
    /* New lines are stamped with the partner markup in force at the moment they are
       added, so the saved sell price always matches the cards on screen. */
    const assignedMarkup = packageMarkupPercent(selectedClients);
    if (String(rate.currency || item.currency || packageCurrency).toUpperCase() !== String(packageCurrency).toUpperCase()) {
      showToast(`This package is priced in ${packageCurrency}. ${item.name} only has a ${rate.currency} rate, which would make the package total meaningless.`, 'warning');
      return;
    }
    /* Whether this item is fit to be in a package at all. Whether it is big enough is not
       asked here: a package is loaded one vehicle at a time, so every vehicle set is
       incomplete until the last one is in, and a check against the bands would block the
       first small vehicle of the set. "Does the party fit" is answered per band by
       packageBandCapacityError, which is shown against the band that cannot be served. */
    const capacityError = packageItemCapacitySetupError(item, rate);
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
      item_key: uuid(),
      item_id: item.id,      rate_id: rate.id,
      item_name: item.name,
      category: item.category || '',
      supplier_name: item.supplier_name || '',
      currency_code: rate.currency || item.currency || 'ZAR',
      rate_basis: rate.rate_basis || item.pricing_model || 'per_person',
      unit_cost: unitCost,
      unit_price: applyPackageMarkup(unitCost, assignedMarkup),
      markup_percentage: assignedMarkup,
      quantity: isStayItem
        ? accommodationRoomPlan({ ...item, rate_id: rate.id }, item, autoPattern).roomCount
        : 1,
      is_included: true,
      vehicle_capacity: Number(item.max_occupancy) || Number(rate.max_occupancy) || 0,
      /* A band scope on the itinerary tab makes this line belong to that band alone, which
         is how a band gets an extra excursion without every other band paying for it. */
      tier_key: scope.tier_key || null,
      replaces_item_key: scope.replaces_item_key || null,
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

  /* -------------------------------------------------------------------------
     EDITING ONE BAND'S ITINERARY
     -------------------------------------------------------------------------
     A band sometimes needs a different itinerary: another excursion, a different lodge,
     or it simply does not pay for the saloon. Those are exceptions to the shared base
     itinerary, and they are edited by picking a band at the top of the Itinerary tab and
     working as if that band were the package. Adding a service then adds it for that band
     only, and removing a shared service records that this band does not have it - the
     other bands are untouched, which is the whole reason this stops being a copy-paste.

     Two vehicles on the same day need none of this: they are priced as alternatives, so
     the band picks the smallest one that seats it. */
  const scopedServicesFor = (day) => (bandScope
    ? packageTierDays([day], { item_key: bandScope, pax: packageBandPax(mergedBands.find((band) => band.item_key === bandScope) || {}) }, library)[0]?.services || []
    : (day?.services || []).filter((service) => service?.is_included !== false));

  const rawIndexOf = (dayIndex, service) => (days[dayIndex]?.services || []).findIndex((entry) => (
    service?.item_key && entry.item_key ? entry.item_key === service.item_key : entry === service
  ));

  /* Writing to a band: a service the band does not have is recorded as an exclusion of the
     shared item rather than by deleting the shared item, so the other bands keep it. */
  const removeServiceForBand = (dayIndex, service, bandKey) => {
    if (service?.tier_key) {
      removeService(dayIndex, rawIndexOf(dayIndex, service));
      return;
    }
    setDays((previous) => previous.map((day, index) => index !== dayIndex ? day : {
      ...day,
      services: [...day.services, {
        ...service,
        item_key: uuid(),
        tier_key: bandKey,
        replaces_item_key: service.item_key || null,
        is_included: false,
        notes: `Not included in the ${packageBandLabel(mergedBands.find((band) => band.item_key === bandKey) || {})} band`
      }]
    }));
  };

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

  /* The strip shows each day as a card so a long package reads left to right instead
     of as one tall stack. The strip card carries the same three facts as the
     itinerary builder's day card: which day it is, a label, and the count and value. */
  const dayTotal = (day) => (day?.services || [])
    .filter((service) => service.is_included !== false)
    .reduce((total, service) => total + Number(service.unit_price || service.unit_cost || 0) * Number(service.quantity || 1), 0);

  const dayValueCurrency = (day) => (day?.services || []).find((service) => service.is_included !== false)?.currency_code || 'ZAR';

  const dayDayLabel = (day) => {
    const firstLine = String(day?.notes || '').split('\n').find((line) => line.trim());
    if (firstLine) return firstLine.trim().slice(0, 28);
    const places = (day?.services || []).map((service) => service.category).filter(Boolean);
    return [...new Set(places)].slice(0, 2).join(', ') || 'No items yet';
  };

  /* One price per traveller pattern, in the package's single currency. The child age
     range is passed in because a child is priced once, against the accommodation, and
     that same figure feeds the child card here and the Children tab. */
const childRange = packageChildAgeRange(form.childAgeRange);
  /* A package assigned to a partner is priced at that client's default markup, the same
     figure the itinerary builder applies. With several partners attached the highest
     markup is used so the package is never under-quoted to one of them, and the note
     on the client tab says which figure is in play. */
  const markupPercent = useMemo(
    () => packageMarkupPercent(selectedClients),
    [selectedClients]
  );
  /* Each band is priced off ITS OWN services and off its own party size, which is what lets one
     package sell 3 pax in a saloon and 10 pax in a microbus without being copied.
     packageTierDays is what keeps the other vehicle out of the band's price. */
  const breakdown = useMemo(() => mergedBands.map((band) => ({
    ...band,
    capacityError: packageBandCapacityError(days, library, band),
    pricing: calculatePackageTravellerBreakdown({
      days: packageTierDays(days, band, library),
      pattern: band,
      library,
      childRange,
      markupPercent
    })
  })), [mergedBands, days, library, childRange, markupPercent]);

  /* The bands no vehicle in the itinerary can take. Loading a vehicle set is deliberately
     not blocked as it goes, because every set is incomplete until the last vehicle is in,
     so this is the one place that says "this package cannot be quoted yet" instead of
     leaving it to be noticed on a card further down the tab. */
  const unservableBands = useMemo(
    () => breakdown.filter((band) => band.capacityError).map((band) => ({ label: packageBandLabel(band), error: band.capacityError })),
    [breakdown]
  );

  const setChildRange = (range) => setForm((previous) => ({ ...previous, childAgeRange: range }));
  const changeChildRange = (field, value) => setChildRange(normaliseChildAgeRange({
    ...(form.childAgeRange || { ageFrom: 0, ageTo: PACKAGE_MAX_CHILD_AGE }),
    [field]: value
  }));

  /* The child price does not move with the party size, so it is priced off the biggest
     band and shown once on the Children tab. It is priced off that band's own services:
     the child of a 3 pax booking is not sitting in the microbus. */
  const childBreakdown = useMemo(() => {
    const biggest = mergedBands.length
      ? mergedBands.reduce((top, band) => (packageBandPax(band) > packageBandPax(top) ? band : top), mergedBands[0])
      : null;
    return calculatePackageTravellerBreakdown({
      days: packageTierDays(days, biggest, library),
      library,
      childRange,
      markupPercent,
      pattern: largestTravellerPattern(biggest ? [biggest] : [])
    });
  }, [days, library, childRange, markupPercent, mergedBands]);

  /* With a markup in play the card shows what the partner pays, so the explanation line
     has to say what the contract figure was, otherwise the two numbers silently
     disagree and the operator cannot tell which one the guest was quoted. */
  const markupNote = (row, contractLine) => (row.markupPercent
    ? `${contractLine} · net, plus ${row.markupPercent}% partner markup`
    : contractLine);

  const buildExportHtml = (options) => {
    const cover = options.cover && pkg.cover_image_url
      ? `<img class="cover" src="${escapeHtml(pkg.cover_image_url)}" alt="">`
      : '';
    /* The vehicles on a day are alternatives, not separate inclusions: the party takes ONE of
       them, sized to its own band. Printed one per line, a 19 pax package reads as though
       the client is receiving four vehicles. So they collapse into a single line that names
       what they actually get, and the ladder is only spelled out when asked for. */
    const dayMarkup = days.map((day, index) => {
      const included = day.services.filter((service) => service.is_included !== false);
      const vehicles = included.filter((service) => packageIsTransport(service, library));
      const others = included.filter((service) => !packageIsTransport(service, library));
      const vehicleLines = vehicles.length ? (options.showVehicleOptions
        ? vehicles.map((service) => `<li>${escapeHtml(service.item_name)}${service.supplier_name ? ` — ${escapeHtml(service.supplier_name)}` : ''}</li>`).join('')
        : `<li>${escapeHtml(packageTransportSummary(vehicles, library))}</li>`) : '';
      const otherLines = others
        .map((service) => `<li>${escapeHtml(service.item_name)}${service.supplier_name ? ` — ${escapeHtml(service.supplier_name)}` : ''}</li>`).join('');
      const services = `${vehicleLines}${otherLines}`;
      return `<section><h2>Day ${index + 1}</h2>${day.notes ? `<p>${escapeHtml(day.notes)}</p>` : ''}${services ? `<ul>${services}</ul>` : ''}</section>`;
    }).join('');
    /* A working sheet shows every vehicle, because the operator needs to see the ladder they
       are pricing. A client document does not: the client gets one vehicle sized to their
       band, so the ladder is replaced by that single line above. */
    /* Deliberately no note about how the vehicles are sized. A client document says what they get
       and what it costs; explaining the internal vehicle ladder invites them to compare it
       against a smaller vehicle and question the price, which is not this document's job. */
    const vehicleNote = '';
/* The exported document carries the same three coloured cards as the Traveller &
       pricing tab, so a buyer reads the same labels and colours they saw on screen. The
       pricing explanation is the only addition, and the accommodation breakdown is
       deliberately left out: it is a working sheet, not something a client should read.

       A package is not a quotation. "Client version" means the partner-facing document
       with that partner's default markup applied; "internal version" is the STO sheet at
       contract cost, which is what an operator needs to see what they actually pay. */
    const partnerView = options.audience === 'client' && markupPercent > 0;
    /* Which cards are printed, and in what order.
       'lead' prints both with the chosen figure first, which is right for a working sheet.
       'only' prints the chosen figure on its own, which is what a client quote wants: two
       prices for the same holiday on one page invites the reader to pick the smaller one.
       The party total can be left out but the per-adult price cannot - a client is quoted per
       person, so dropping it would leave the document with no price they can actually act on. */
    const leadCards = (row, { explain, bandPrice }) => {
      const sell = partnerView ? row.sell : row;
      const note = (line) => (explain ? `<small>${partnerView ? `${line} · net, plus ${row.markupPercent}% partner markup` : line}</small>` : '');
      const party = `<div class="price-card price-card-party lead"><span>Whole party of ${row.pax}</span><strong>${money(sell.partyTotal, row.currency)}</strong>${note(`${row.pax} travellers at ${money(row.adultSharingTotal, row.currency)} each`)}</div>`;
      const perPerson = `<div class="price-card lead"><span>Per adult sharing</span><strong>${money(sell.adultSharingTotal, row.currency)}</strong>${note(`Unit share ${money(row.unitPerPerson, row.currency)} + sharing ${money(row.accommodationSharing, row.currency)}`)}</div>`;
      const both = bandPrice === 'perPerson' ? perPerson + party : party + perPerson;
      if (options.partyCard === 'hide' || options.partyCard === 'only') return perPerson;
      return options.partyCard === 'only' ? party : both;
    };
    const bandSizes = breakdown.map((band) => packageBandPax(band));
    /* The per-party-size explanation is only true of a document that quotes more than one
       size. On a single-band quote it is noise, and on a client document naming the sizes
       sold is an invitation to pick the cheapest one. */
    const bandNote = options.bandSelection === 'all' && bandSizes.length
      ? `<p class="pattern-note">Each band is priced for exactly that party size. A vehicle is paid for in full by the travellers in it, so each band carries the whole vehicle charge divided by its own party size. The party sizes this package sells are: ${bandSizes.join(', ')}.</p>`
      : '';
    /* Which bands the document quotes. "all" is the operator's reconciliation sheet; a
       single named band is how a client is actually quoted one price for their party. The
       lead figure inside each band is still chosen separately below. */
    const bandsToShow = options.bandSelection === 'all'
      ? breakdown
      : breakdown.filter((band) => packageBandPax(band) === Number(options.bandSelection))
        .concat(breakdown.length && !breakdown.some((band) => packageBandPax(band) === Number(options.bandSelection)) ? [breakdown[0]] : []);
    const bandPricesMarkup = !options.bandPrices ? '' : bandsToShow.map((band) => `<section><h2>Traveller band pricing</h2><p class="pattern-pax">${packageBandLabel(band)}</p><div class="price-cards">${leadCards(band.pricing, { explain: options.explainPricing, bandPrice: options.bandPrice })}${band.pricing.hasAccommodation ? `<div class="price-card"><span>Single supplement</span><strong>${money(partnerView ? band.pricing.sell.singleSupplementTotal : band.pricing.singleSupplementTotal, band.pricing.currency)}</strong>${options.explainPricing ? `<small>${partnerView ? `Added to the sharing price · net, plus ${band.pricing.markupPercent}% partner markup` : 'Added to the sharing price'}</small>` : ''}</div>` : ''}${band.pricing.hasAccommodation ? `<div class="price-card price-card-child${childRange ? '' : ' pending'}"><span>Child price</span><strong>${money(partnerView ? band.pricing.sell.childTotal : band.pricing.childTotal, band.pricing.currency)}</strong>${options.explainPricing ? `<small>${childRange ? (partnerView ? `Unit share + accommodation · net, plus ${band.pricing.markupPercent}% partner markup` : 'Unit share + accommodation') : 'No child age range set'}</small>` : ''}</div>` : ''}</div></section>`).join('');
    const markupNoteLine = partnerView
      ? `<p class="pattern-note">Client version: prices include the ${markupPercent}% markup assigned to this partner. The internal version shows these prices at contract cost.</p>`
      : (options.audience === 'client' && markupPercent === 0
        ? '<p class="pattern-note">Client version requested, but no partner markup is assigned to this package, so these prices are the contract cost.</p>'
        : '<p class="pattern-note">Internal version: prices are at contract cost (STO) with no partner markup applied.</p>');
    /* The child card already carries the child price, so the document has no separate
       child section. It does need to say so when the card is not a real price, because a
       reader would otherwise take the greyed figure as the amount a child is charged. */
    const childNote = !form.acceptsChildren
      ? '<p class="pattern-note">Children are not accepted on this package, so no child price applies. The child figure above is shown for reference only.</p>'
      : (!childRange ? '<p class="pattern-note">No child age range has been set on this package, so the child price above is not final.</p>' : '');
    const validity = periods.map((period) => `<li>${escapeHtml(period.valid_from)} – ${escapeHtml(period.valid_to)}</li>`).join('');
    const inclusionMarkup = options.inclusions
      ? `${form.inclusions ? `<h3>Inclusions</h3><p>${escapeHtml(form.inclusions).replace(/\n/g, '<br>')}</p>` : ''}${form.exclusions ? `<h3>Exclusions</h3><p>${escapeHtml(form.exclusions).replace(/\n/g, '<br>')}</p>` : ''}`
      : '';
    const termsMarkup = options.terms && form.terms
      ? `<section><h2>Terms &amp; Conditions</h2><p>${escapeHtml(form.terms).replace(/\n/g, '<br>')}</p></section>`
      : '';
    const clientNames = selectedClients.map(nameOf).join(', ');
    /* The three price cards reuse the tab's colours exactly: teal for the two adult
       prices, amber for the child, and grey when no child range is set. */
    const priceCardCss = `.price-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:12px 0 4px}.price-card{display:flex;flex-direction:column;gap:4px;padding:12px;border-radius:8px;background:#f0fdfa}.price-card span,.price-card small{color:#64748b;font-size:11px;line-height:1.35}.price-card strong{color:#0f766e;font-size:17px}.price-card.lead{box-shadow:0 0 0 2px #0d7478 inset}.price-card-party{background:#f0fdf4;border:1px solid #bbf7d0}.price-card-party span,.price-card-party small{color:#166534}.price-card-party strong{color:#15803d}.price-card-child{background:#fff7ed;border:1px solid #fed7aa}.price-card-child span,.price-card-child small{color:#9a5b13}.price-card-child strong{color:#b45309}.price-card-child.pending{background:#f8fafc;border:1px dashed #cbd5e1}.price-card-child.pending span,.price-card-child.pending small,.price-card-child.pending strong{color:#94a3b8}.pattern-pax{margin:0 0 2px;font-weight:bold;color:#1a202c}.pattern-note{margin:8px 0 0;padding:8px 10px;border-left:3px solid #94a3b8;background:#f8fafc;color:#475569;font-size:12px;line-height:1.45}@media print{.price-cards{break-inside:avoid}}`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(pkg.name)}</title><style>body{font:15px Arial,sans-serif;color:#1e293b;max-width:850px;margin:36px auto;padding:0 24px}h1,h2,h3{color:#0d7478}header{border-bottom:2px solid #0d7478;padding-bottom:16px;margin-bottom:24px}section{margin:22px 0;padding-bottom:12px;border-bottom:1px solid #e2e8f0}.cover{max-width:100%;max-height:280px;object-fit:cover}li{margin:6px 0}${priceCardCss}@media print{body{margin:0 auto}}</style></head><body><header>${cover}<h1>${escapeHtml(pkg.name)}</h1><p>${escapeHtml(form.description)}</p>${validity ? `<h3>Valid dates</h3><ul>${validity}</ul>` : ''}${clientNames ? `<h3>For partner: ${escapeHtml(clientNames)}</h3>` : ''}</header>${dayMarkup}${vehicleNote}${inclusionMarkup ? `<section>${inclusionMarkup}</section>` : ''}${bandPricesMarkup}${bandNote}${markupNoteLine}${childNote}${termsMarkup}</body></html>`;
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
  /* Changing a band changes the party size it is quoted for. The size is checked against the
     vehicles first, so a band is never left holding a party that nothing can carry, and
     against the other bands second, because two bands at the same party size would leave
     that price down to whichever happened to be listed first. */
  const changeBand = (itemKey, rawValue) => {
    const pax = Number(rawValue);
    if (!itemKey || !Number.isFinite(pax) || pax < 1) return;
    const target = paxOptions.find((band) => band.item_key === itemKey);
    if (!target || packageBandPax(target) === pax) return;
    const clash = paxOptions.find((band) => band.item_key !== itemKey && packageBandPax(band) === pax);
    if (clash) {
      showToast(`${packageBandLabel(clash)} is already a band. Two bands cannot both price the same party size.`, 'warning');
      return;
    }
    const capacityError = packageBandCapacityError(days, library, { pax });
    if (capacityError) {
      showToast(capacityError, 'warning');
      return;
    }
    setPaxOptions((previous) => previous
      .map((band) => (band.item_key === itemKey
        ? { ...band, pax, min_pax: pax, max_pax: pax }
        : band))
      .sort(byBandMin));
  };

  const addPaxPattern = () => {
    const pax = Number(document.getElementById('package-pax')?.value) || 0;
    if (pax < 1) {
      showToast('A traveller band needs at least one traveller.', 'warning');
      return;
    }
    if (mergedBands.some((band) => packageBandPax(band) === pax)) {
      showToast(`${pax} pax is already a band. Edit it instead of adding it twice.`, 'warning');
      return;
    }
    const candidate = { pax, min_pax: pax, max_pax: pax, item_key: uuid(), is_auto_generated: false };
    /* Only the transport this band would actually be given counts here. Asking the whole
       package instead would reject the band because some other band owns a smaller bus. */
    const capacityError = packageBandCapacityError(days, library, candidate);
    if (capacityError) {
      showToast(capacityError, 'warning');
      return;
    }
    setPaxOptions((previous) => [...previous, candidate].sort(byBandMin));
  };

  if (!packageId) return <div className="super-admin-page"><button className="secondary-btn" onClick={() => navigate('/packages')}><ArrowLeft size={16} /> Packages</button><p>Open a package from the Packages list.</p></div>;

  const tabs = [
    ['itinerary', 'Itinerary'],
    ['validity', 'Valid dates'],
    ['travellers', 'Travellers & pricing'],
    ['children', 'Children & ages'],
    ['inclusions', 'Inclusions & exclusions'],
    ['terms', 'Terms & conditions'],
    ['client', 'Client partner']
  ];

  return <div className="super-admin-page package-builder-page">
    <header className="page-header">
      <div className="header-title"><Backpack /><div><h1>{pkg?.name || state?.packageName || 'Package Builder'}</h1><p>Build and price a reusable package using contract rates</p></div></div>
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
          <p className="package-sidebar-currency">Prices in <strong>{packageCurrency}</strong> — this package is priced in one currency.</p>
          <div className="package-filter-section">
            <strong>Item type</strong>
            <div className="category-filters">{categoryOptions.map((category) => <button key={category} type="button" className={`category-chip ${categoryFilter === category ? 'active' : ''}`} onClick={() => setCategoryFilter((current) => current === category ? '' : category)}>{category}</button>)}</div>
          </div>
          <label className="package-filter-section package-destination-filter"><strong>Destination / island</strong><select value={destinationFilter} onChange={(event) => setDestinationFilter(event.target.value)}><option value="">All destinations</option>{destinationOptions.map((destination) => <option key={destination} value={destination}>{destination}</option>)}</select></label>
          {(categoryFilter || destinationFilter || search) && <button type="button" className="clear-filters-btn" onClick={() => { setCategoryFilter(''); setDestinationFilter(''); setSearch(''); }}>Clear filters</button>}
          <p className="package-help">{markupPercent > 0 ? `Contract rates are copied, then the assigned partner markup of ${markupPercent}% is applied to every price.` : 'Rates are copied at their contract amount. Assign a partner on the Client partner tab to apply that client markup.'}</p>
          <div className="package-library-results">
            {visibleResults.map((item) => {
              const eligibleRates = (item.item_rates || []).filter((entry) => currencyMatches(entry, packageCurrency));
              const rate = rateForDates(item);
              const coverage = seasonFor(item, rate);
              const basis = basisOfRate(rate, item);
              /* The same capacity the band engine reads, so the number on the card is the
                 number that decides which band this vehicle opens up. */
              const vehicleCapacity = packageVehicleCapacity(item, rate);
              const addToDay = () => addService(item, rate?.id, selectedDay, bandScope ? { tier_key: bandScope } : {});
              return <article key={item.id} className={`package-library-card ${!rate ? 'unavailable' : ''}`} draggable={!!rate} onDragStart={(event) => event.dataTransfer.setData('application/json', JSON.stringify({ type: 'library', itemId: item.id, rateId: rate?.id }))} onDoubleClick={addToDay}>
                <div className="package-library-top">
                  <span className="package-library-name">{item.name}</span>
                  <GripVertical size={16} className="package-library-grip" />
                </div>
                <div className="package-library-meta">
                  <span className="item-cat-tag">{item.category || 'General'}</span>
                  {vehicleCapacity > 0 && <span className="item-capacity-tag" title={`Seats ${vehicleCapacity} travellers, so a band is offered up to ${vehicleCapacity} pax`}>Max: {vehicleCapacity}</span>}
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
            {(search.trim().length >= 2 || categoryFilter) && !visibleResults.length && <p>No matching active library items with rates in this currency.</p>}
          </div>
        </aside>
        <main className="package-itinerary-canvas">
          <div className="package-canvas-header"><div><h2>Day-by-day itinerary</h2><p>Pick a day from the strip, then build it on the canvas below.</p></div><div className="package-canvas-actions">
            <label className="package-band-scope">Editing as
              <select value={bandScope} onChange={(event) => setBandScope(event.target.value)} aria-label="Which traveller band the itinerary is being edited for">
                <option value="">All bands (shared itinerary)</option>
                {mergedBands.map((band) => <option key={band.item_key} value={band.item_key}>{packageBandLabel(band)} only</option>)}
              </select>
            </label>
            <button className="secondary-btn" onClick={addDay}><Plus size={15} /> Add day</button>
          </div></div>
          {bandScope && <p className="package-band-scope-note">Anything you add here is priced in the {packageBandLabel(mergedBands.find((band) => band.item_key === bandScope) || {})} band only. The other bands keep the shared itinerary. Switch back to &ldquo;All bands&rdquo; to edit what every band pays for.</p>}
          <div className="day-strip-wrap" style={{ flexShrink: 0 }}>
            <div className="day-strip">
              {days.map((day, dayIndex) => {
                const dayValue = dayTotal(day);
                return <button type="button" key={day.id || `day-${dayIndex}`} className={`day-strip-card ${selectedDay === dayIndex ? 'active' : ''}`} onClick={() => setSelectedDay(dayIndex)}>
                  <div className="day-strip-card-title">Day {dayIndex + 1}</div>
                  <div className="day-strip-card-date">{dayDayLabel(day)}</div>
                  <div className="day-strip-card-summary"><span>{day.services.length} item{day.services.length === 1 ? '' : 's'}</span><span>{money(dayValue, dayValueCurrency(day))}</span></div>
                </button>;
              })}
              <button type="button" className="day-add-chip" onClick={addDay}><Plus size={15} /> Add Day</button>
            </div>
          </div>
          {days[selectedDay] && <section key={days[selectedDay].id || `day-${selectedDay}`} className="package-canvas-day selected"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              try {
                const payload = JSON.parse(event.dataTransfer.getData('application/json'));
                if (payload.type === 'library') {
                  const item = library.find((entry) => entry.id === payload.itemId) || results.find((entry) => entry.id === payload.itemId);
                  if (item) addService(item, payload.rateId, selectedDay, bandScope ? { tier_key: bandScope } : {});
                } else if (payload.type === 'service') moveService(payload.fromDay, payload.fromIndex, selectedDay);
              } catch (error) {
                showToast(`Could not add the dragged item: ${error.message}`, 'error');
              }
            }}>
            <header><h3><CalendarDays size={17} /> Day {selectedDay + 1}</h3><span>{days[selectedDay].services.length} item{days[selectedDay].services.length === 1 ? '' : 's'}</span></header>
            <textarea aria-label={`Day ${selectedDay + 1} notes`} value={days[selectedDay].notes || ''} onChange={(event) => setDays((previous) => previous.map((row, index) => index === selectedDay ? { ...row, notes: event.target.value } : row))} placeholder="Optional day overview or notes" rows={2} />
            {scopedServicesFor(days[selectedDay]).map((service) => {
              const rawIndex = rawIndexOf(selectedDay, service);
              const item = itemForService(service);
              const coverage = seasonFor(item, rateForService(service));
              const roomPlan = isStay(service) ? roomPlanFor(service) : null;
              const capacity = Number(item?.max_occupancy || service.vehicle_capacity) || 0;
              const capacitySummary = capacity
                ? isStay(service)
                  ? `Max ${capacity} per room`
                  : `Capacity: ${capacity} traveller${capacity === 1 ? '' : 's'}`
                : '';
              const bandOnly = service.tier_key && service.tier_key === bandScope;
              return <article key={service.item_key || `${service.id || service.item_id}-${rawIndex}`} className={`package-canvas-service ${bandOnly ? 'band-only' : ''}`} draggable onDragStart={(event) => event.dataTransfer.setData('application/json', JSON.stringify({ type: 'service', fromDay: selectedDay, fromIndex: rawIndex }))}>
                <GripVertical size={16} className="package-grip" />
                <div className="package-service-main"><strong>{service.item_name}</strong><small>{service.category || 'Service'}{service.supplier_name ? ` · ${service.supplier_name}` : ''}</small>
                  {bandOnly
                    ? <small className="package-band-flag">this band only</small>
                    : (service.tier_key && <small className="package-band-flag other">{packageBandLabel(mergedBands.find((band) => band.item_key === service.tier_key) || {})} only</small>)}
                  {!bandOnly && !service.tier_key && <small className="package-band-flag shared">all bands</small>}
                  {item?.item_rates?.length > 1 && <select aria-label={`Rate for ${service.item_name}`} value={service.rate_id || ''} onChange={(event) => updateService(selectedDay, rawIndex, 'rate_id', event.target.value)}>
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
                <label className="package-included-toggle"><input type="checkbox" checked={service.is_included !== false} onChange={(event) => updateService(selectedDay, rawIndex, 'is_included', event.target.checked)} /> Included</label>
                {roomPlan
                  ? <span className="package-quantity auto" title={`Rooms are worked out from ${autoPattern.pax} pax at ${roomPlan.capacity} per room`}>Rooms {roomPlan.roomCount}</span>
                  : <label className="package-quantity">Qty <input type="number" min="1" step="1" value={service.quantity || 1} onChange={(event) => updateService(selectedDay, rawIndex, 'quantity', Number(event.target.value) || 1)} /></label>}
                <button type="button" className="package-icon-button" aria-label={bandScope ? `Remove ${service.item_name} from the ${packageBandLabel(mergedBands.find((band) => band.item_key === bandScope) || {})} band` : `Remove ${service.item_name}`} onClick={() => (bandScope ? removeServiceForBand(selectedDay, service, bandScope) : removeService(selectedDay, rawIndex))}><Trash2 size={16} /></button>
              </article>;
            })}
            {!scopedServicesFor(days[selectedDay]).length && <p className="package-drop-hint">Drop a library item here, or add from the sidebar.</p>}
            {days.length > 1 && <button type="button" className="package-remove-day" onClick={() => {
              const remaining = days.filter((_, index) => index !== selectedDay);
              setDays(remaining);
              setSelectedDay((current) => Math.min(current, Math.max(0, remaining.length - 1)));
            }}><Trash2 size={14} /> Remove day</button>}
          </section>}
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
        <h2>Traveller bands &amp; contract price breakdown</h2>
        <p>A band is one exact party size this package sells. A vehicle is paid for in full by the people in it, so a band of 3 in a 4-seat vehicle carries the whole vehicle charge divided by 3, and the three travellers together pay the vehicle price exactly. That is why a band is a single number rather than a range of sizes: the price of a party depends on how many people are actually travelling.</p>
        <p>Each band is given the smallest vehicle in the itinerary that seats it, so add every vehicle size you intend to sell to, on each day that carries the party. The vehicles suggest the party sizes they were contracted for, but a suggestion never becomes a band on its own &mdash; accept the ones you want to sell, and add any others by hand.</p>
        <p>Within a band, every non-accommodation service is shared unit cost divided by pax, and the accommodation is priced per adult sharing plus its single supplement. A child is priced once from the same unit share, plus the accommodation prices set on the Children &amp; ages tab.</p>
        {bandSuggestions.length > 0 && <div className="package-band-suggestions" role="status">
          <strong>Your vehicles seat {bandSuggestions.join(', ')} traveller{bandSuggestions.length === 1 ? '' : 's'}</strong>
          <p>These are suggestions from the vehicle capacities in the itinerary, not bands. Add the party sizes you actually sell.</p>
          <div className="package-band-suggestion-list">{bandSuggestions.map((pax) => <button key={`suggestion-${pax}`} type="button" className="secondary-btn" onClick={() => acceptBandSuggestion(pax)}><Plus size={15} /> {pax} pax band</button>)}</div>
        </div>}
        <div className="package-pax-add"><label>Add a band of<input key={`pax-${paxOptions.length}`} id="package-pax" type="number" min="1" defaultValue="2" />pax</label><button className="secondary-btn" onClick={addPaxPattern}><Plus size={15} /> Add band</button></div>
        {!mergedBands.length && <p>Add a vehicle to the itinerary, or add a band by hand, to see the package price breakdown.</p>}
        {unservableBands.length > 0 && <div className="package-band-blocked" role="status">
          <strong>{unservableBands.length} band{unservableBands.length === 1 ? '' : 's'} cannot be quoted yet</strong>
          <p>You can keep adding vehicles. A package is only quotable once every band has something that seats it, on every day that carries the party.</p>
          <ul>{unservableBands.map((band) => <li key={band.label}><b>{band.label}</b>{band.error}</li>)}</ul>
        </div>}
        <div className="package-breakdown-list">{breakdown.map((pattern, index) => {
          const bandPax = packageBandPax(pattern);
          return <article key={`${pattern.item_key || 'new'}-${bandPax}-${index}`}>
          <header>
            <strong>{packageBandLabel(pattern)}</strong>
            <em className="package-band-manual">set by hand</em>
            <label className="package-band-inputs">party of<input type="number" min="1" aria-label={`Party size for band ${packageBandLabel(pattern)}`} value={bandPax} onChange={(event) => changeBand(pattern.item_key, event.target.value)} />pax</label>
            <button type="button" className="package-icon-button" aria-label={`Remove the ${packageBandLabel(pattern)} band`} onClick={() => setPaxOptions((previous) => previous.filter((band) => band.item_key !== pattern.item_key))}><Trash2 size={15} /></button>
          </header>
          {pattern.capacityError && <p className="package-season-warning">{pattern.capacityError}</p>}
          {pattern.pricing.unitRows.length || pattern.pricing.accommodationRows.length ? (() => {
            const row = pattern.pricing;
            return <div className="package-currency-breakdown">
            <h3>{row.currency}</h3>
            <div className="package-breakdown-table-wrap"><table className="package-breakdown-table"><thead><tr><th>Package item</th><th>Total unit contribution / pax</th>{row.hasAccommodation && <th>Total accommodation sharing per pax (adult / child)</th>}{row.hasAccommodation && <th>Total single supplement</th>}</tr></thead>
              <tbody>
                {/* Every column is filled for every row. A unit service carries no room
                    cost, so those cells are a real 0.00 rather than a dash. The two
                    accommodation columns are dropped entirely when the band has no rooms,
                    because a column headed "single supplement" on a package that never
                    sleeps anyone is a figure with nothing behind it. */}
                {row.unitRows.map((item, itemIndex) => <tr key={`unit-${itemIndex}`}><td>{item.name}</td><td>{money(item.perPerson, row.currency)}</td>{row.hasAccommodation && <td>{money(item.sharingPerAdult, row.currency)}</td>}{row.hasAccommodation && <td>{money(item.singleSupplement, row.currency)}</td>}</tr>)}
                {row.accommodationRows.map((item, itemIndex) => <tr key={`stay-${itemIndex}`}><td>{item.name}<small>{item.roomCount} room(s) allocated, max {item.capacity} per room</small></td><td>{money(0, row.currency)}</td><td><span>Adult {money(item.sharingPerAdult, row.currency)}</span><br /><span>Child {money(item.childAccommodation, row.currency)}{item.childAllowed ? '' : ' (single supp.)'}</span></td><td>{money(item.singleSupplement, row.currency)}</td></tr>)}
                <tr className="package-breakdown-total"><th>Total</th><td>{money(row.unitPerPerson, row.currency)}</td>{row.hasAccommodation && <td><span>Adult {money(row.accommodationSharing, row.currency)}</span><br /><span>Child {money(row.childAccommodation, row.currency)}</span></td>}{row.hasAccommodation && <td>{money(row.singleSupplement, row.currency)}</td>}</tr>
              </tbody>
            </table></div>
            <div className="package-price-grid">
              <div className="package-price-party"><span>Whole party of {row.pax}</span><strong>{money(row.markupPercent ? row.sell.partyTotal : row.partyTotal, row.currency)}</strong><small>{markupNote(row, `${row.pax} travellers at ${money(row.adultSharingTotal, row.currency)} each`)}</small></div>
  <div><span>Total per adult sharing</span><strong>{money(row.markupPercent ? row.sell.adultSharingTotal : row.adultSharingTotal, row.currency)}</strong><small>{markupNote(row, `Unit share ${money(row.unitPerPerson, row.currency)} + sharing ${money(row.accommodationSharing, row.currency)}`)}</small></div>
              {/* A single supplement is a room charge. With no accommodation in the band
                  there is no room and nothing to supplement, so the card is left out
                  entirely rather than shown as a zero - a zero here reads as a real price,
                  and the card total would otherwise duplicate the sharing figure above. */}
              {row.hasAccommodation && <div><span>Single supplement</span><strong>{money(row.markupPercent ? row.sell.singleSupplementTotal : row.singleSupplementTotal, row.currency)}</strong><small>{markupNote(row, `Added to the adult sharing price of ${money(row.adultSharingTotal, row.currency)}`)}</small></div>}
              {/* The child price is only a distinct figure when there is accommodation to
                  price. On a package with no rooms a child pays exactly the adult unit
                  share, so the card would be a duplicate of it. */}
              {row.hasAccommodation
                ? <div className={`package-price-child ${!childRange ? 'pending' : ''}`}><span>Child price</span><strong>{money(row.markupPercent ? row.sell.childTotal : row.childTotal, row.currency)}</strong>
                  {!childRange
                    ? <small>Set the child age range on the Children &amp; ages tab</small>
                    : <small>{markupNote(row, `Unit share ${money(row.unitPerPerson, row.currency)} + accommodation ${money(row.childAccommodation, row.currency)}`)}</small>}
                  {!!childRange && !!row.childNotAllowed.length && <small>Charged the single supplement at: {row.childNotAllowed.join(', ')}</small>}
                </div>
                : null}
            </div>
            {!row.hasAccommodation && <p className="package-price-note">This band has no accommodation, so there is no single supplement or child price. The price above is the whole party total for the services in the itinerary.</p>}
            {!!row.foreignCurrencyItems.length && <p className="package-season-warning">{row.foreignCurrencyItems.map((entry) => `${escapeHtml(entry.name)} (${entry.currency} ${entry.unitPrice.toFixed(2)})`).join(', ')} {row.foreignCurrencyItems.length === 1 ? 'is' : 'are'} priced in another currency and {row.foreignCurrencyItems.length === 1 ? 'is not' : 'are not'} included in these totals. This package is priced in {row.currency} only.</p>}
            </div>;
          })() : <p>No included services to price.</p>}
          </article>;
        })}</div>
      </section>}
      {tab === 'children' && <section className="package-tab-panel">
        <h2><Baby size={19} /> Children on this package</h2>
        <p>A child is only priced differently because of the accommodation. Everything else in the package is shared unit cost divided by pax, and a child pays exactly that same unit share. The one figure that can differ is the room, and that comes from the property's own child price for the age range set below.</p>
        {markupPercent > 0 && <p className="package-help">The figures on this tab are contract costs. The child price on the Traveller &amp; pricing tab and in a client export carries the {markupPercent}% partner markup.</p>}
        <label className="package-publish-toggle"><input type="checkbox" checked={form.acceptsChildren} onChange={(event) => updateForm('acceptsChildren', event.target.checked)} /><span><strong>A child may travel on this package</strong><small>When off, the package is for adults only and no child price is published.</small></span></label>
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
          <p>This tab covers the accommodation only, because the accommodation is the only part of a package that can price a child differently. Each property is listed with its supplier: where the property contracts a child rate for this age range that rate is used, and where it does not accept a child its single supplement is used instead. The unit share an adult pays is added on the Travellers &amp; pricing tab.</p>
<div className="package-currency-breakdown">
            {!childRange ? <p className="package-child-off">Set the child age range above to price a child.</p> : <>
            <div className="package-breakdown-table-wrap"><table className="package-breakdown-table"><thead><tr><th>Accommodation</th><th>Supplier</th><th>Contracted child band</th><th>Child price basis</th><th>Child accommodation price</th></tr></thead>
              <tbody>
                {childBreakdown.accommodationRows.map((item, itemIndex) => <tr key={`child-stay-${itemIndex}`}>
                  <td>{item.name}</td>
                  <td>{item.supplierName || 'No supplier recorded'}</td>
                  <td>{item.childBandName || 'No child band on this property'}</td>
                  <td>{item.childBasis || (item.childAllowed ? 'Property child rate' : 'Single supplement')}</td>
                  <td>{!item.childAllowed && <small>Charged the single supplement of {money(item.singleSupplement, childBreakdown.currency)}</small>}
                    {money(item.childAccommodation, childBreakdown.currency)}</td>
                </tr>)}
                {!childBreakdown.accommodationRows.length && <tr><td colSpan={5}>No accommodation in this package, so the child price is the per-pax unit share.</td></tr>}
                {!!childBreakdown.accommodationRows.length && childBreakdown.childAccommodation === 0 && <tr><td colSpan={5} className="package-child-note">Every accommodation in this package charges R0.00 for a child. Nothing here is being published as a free child; check the single supplement on each property above.</td></tr>}
                <tr className="package-breakdown-total"><th colSpan={4}>Total child accommodation, added to the unit share</th><td>{money(childBreakdown.childAccommodation, childBreakdown.currency)}</td></tr>
              </tbody>
            </table></div>
            <p className="package-child-note">Added to the unit share of {money(childBreakdown.unitPerPerson, childBreakdown.currency)} on the Travellers &amp; pricing tab, giving a child price of {money(childBreakdown.childTotal, childBreakdown.currency)}.</p>
            {!!childBreakdown.accommodationRows.length && !!childBreakdown.childNotAllowed.length && <p className="package-child-note">{childBreakdown.childNotAllowed.join(', ')} does not accept a child for {childRange.ageFrom}–{childRange.ageTo} yrs, so each is charged the single supplement of {money(childBreakdown.childSupplement, childBreakdown.currency)} instead of a child rate.</p>}
            </>}
          </div>
        </>}
      </section>}
      {tab === 'inclusions' && <section className="package-tab-panel"><h2>Inclusions &amp; exclusions</h2><label className="package-field"><span>Inclusions</span><textarea rows={7} value={form.inclusions} onChange={(event) => updateForm('inclusions', event.target.value)} placeholder="Describe what is included in the package" /></label><label className="package-field"><span>Exclusions</span><textarea rows={7} value={form.exclusions} onChange={(event) => updateForm('exclusions', event.target.value)} placeholder="Describe what is not included" /></label></section>}
      {tab === 'terms' && <section className="package-tab-panel"><h2>Terms &amp; conditions</h2><label className="package-field"><span>Package terms and conditions</span><textarea rows={14} value={form.terms} onChange={(event) => updateForm('terms', event.target.value)} placeholder="Add package-specific terms and conditions" /></label></section>}
      {tab === 'client' && <section className="package-tab-panel"><h2>Assign partners to this package</h2><p>Client assignment is optional and may include more than one client. {markupPercent > 0 ? `Prices are shown and exported with the ${markupPercent}% default markup of the assigned partner${selectedClients.length > 1 ? 's' : ''}.` : 'No partner is assigned, so prices stay at contract cost.'}</p>
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
            {/* This is the operator's own list, so every vehicle stays on it. It is the
                CLIENT document above that collapses the ladder to one line, because here the
                operator needs to see and edit every size they are pricing. */}
            {days.length ? days.map((day, dayIndex) => <section key={day.id || `preview-${dayIndex}`}>
              <strong>Day {dayIndex + 1}</strong>
              {(day.services || []).map((service, serviceIndex) => <div className="package-preview-item" key={`${service.id || service.item_id}-${serviceIndex}`}>
                <span>{service.item_name}<small>{service.category || 'Service'}{service.supplier_name ? ` · ${service.supplier_name}` : ''}{service.is_included === false ? ' · optional' : ''}{packageIsTransport(service, library) && !service.tier_key ? ' · vehicle ladder, party picks one' : ''}</small></span>
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
      <div className="modal-header"><div><h2>Export package</h2><p>Who it's for, the format, and what goes in.</p></div><button className="close-btn" onClick={() => setExportDialog(false)}><X size={20} /></button></div>
      {/* Two columns rather than one long stack. Every group here is a short list of
          radio buttons or checkboxes, so the old layout spent a whole screen on about
          fifteen controls and pushed Export below the fold on a laptop. */}
      <div className="package-export-grid">
        <div className="package-export-options"><span className="package-export-subhead">For</span><label><input type="radio" name="package-export-audience" value="client" checked={exportOptions.audience === 'client'} onChange={() => setExportOptions((previous) => ({ ...previous, audience: 'client' }))} /> Client {markupPercent > 0 ? `(+${markupPercent}%)` : '(no markup)'}</label><label><input type="radio" name="package-export-audience" value="internal" checked={exportOptions.audience === 'internal'} onChange={() => setExportOptions((previous) => ({ ...previous, audience: 'internal' }))} /> Internal (STO)</label></div>
        <div className="package-export-options"><span className="package-export-subhead">Format</span><label><input type="radio" name="package-export-format" value="pdf" checked={exportFormat === 'pdf'} onChange={() => setExportFormat('pdf')} /> PDF</label><label><input type="radio" name="package-export-format" value="word" checked={exportFormat === 'word'} onChange={() => setExportFormat('word')} /> Word</label></div>
        <div className="package-export-options"><span className="package-export-subhead">Include</span>{[['cover', 'Cover image'], ['inclusions', 'Inclusions'], ['terms', 'Terms'], ['bandPrices', 'Band prices'], ['explainPricing', 'Explain pricing'], ['showVehicleOptions', 'Every vehicle size']].map(([key, label]) => <label key={key}><input type="checkbox" checked={!!exportOptions[key]} onChange={(event) => setExportOptions((previous) => ({ ...previous, [key]: event.target.checked }))} /> {label}</label>)}</div>
        {exportOptions.bandPrices && <div className="package-export-options"><span className="package-export-subhead">Cards</span><label><input type="radio" name="package-export-party-card" value="both" checked={!exportOptions.partyCard || exportOptions.partyCard === 'both'} onChange={() => setExportOptions((previous) => ({ ...previous, partyCard: 'both' }))} /> Whole party + per adult</label><label><input type="radio" name="package-export-party-card" value="hide" checked={exportOptions.partyCard === 'hide'} onChange={() => setExportOptions((previous) => ({ ...previous, partyCard: 'hide' }))} /> Per adult only</label><label><input type="radio" name="package-export-party-card" value="only" checked={exportOptions.partyCard === 'only'} onChange={() => setExportOptions((previous) => ({ ...previous, partyCard: 'only' }))} /> Whole party only</label><span className="package-export-subhead">Lead</span><label><input type="radio" name="package-export-band-price" value="party" checked={exportOptions.bandPrice === 'party'} onChange={() => setExportOptions((previous) => ({ ...previous, bandPrice: 'party' }))} /> Party total</label><label><input type="radio" name="package-export-band-price" value="perPerson" checked={exportOptions.bandPrice === 'perPerson'} onChange={() => setExportOptions((previous) => ({ ...previous, bandPrice: 'perPerson' }))} /> Per adult</label></div>}
        {exportOptions.bandPrices && <div className="package-export-options"><span className="package-export-subhead">Bands shown</span><label><input type="radio" name="package-export-bands" value="all" checked={exportOptions.bandSelection === 'all'} onChange={() => setExportOptions((previous) => ({ ...previous, bandSelection: 'all' }))} /> Every band</label>{breakdown.map((band) => <label key={`export-band-${band.item_key || band.pax}`}><input type="radio" name="package-export-bands" value={String(packageBandPax(band))} checked={exportOptions.bandSelection !== 'all' && Number(exportOptions.bandSelection) === packageBandPax(band)} onChange={() => setExportOptions((previous) => ({ ...previous, bandSelection: String(packageBandPax(band)) }))} /> {packageBandLabel(band)} only</label>)}</div>}
      </div>
      <div className="package-modal-actions"><button className="secondary-btn" onClick={() => setExportDialog(false)}>Cancel</button><button className="primary-btn" onClick={exportDocument}><FileText size={16} /> Export</button></div>
    </section></div>}
  </div>;
};