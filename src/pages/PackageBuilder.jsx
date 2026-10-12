import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Backpack, Baby, CalendarDays, ChevronDown, Download, FileText,
  GripVertical, Plus, RefreshCw, Save, Search, Trash2, UtensilsCrossed, X
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { PricingSeasonsTab } from '../components/PricingSeasonsTab';
import { PricingSummaryTab } from '../components/PricingSummaryTab';
import { usePricingGrid } from '../lib/usePricingGrid';
import { useToast } from '../context/ToastContext';
import { usePageGuard } from '../context/NavigationGuardContext';
import {
  accommodationPerPersonForSeason,
  accommodationRoomCapacity,
  accommodationRoomPlan,
  calculatePackageTravellerBreakdown,
  largestTravellerPattern,
  normaliseChildAgeRange,
  PACKAGE_MAX_CHILD_AGE,
  packageBandLabel,
  packageBandPax,
  packageChildAgeRange,
  packageCurrencyFor,
  packageKey,
  packageMarkupPercent,
  packageExportMarkup,
  packageItemCapacitySetupError,
  packageVehicleCapacity,
packageIsTransport,
packageTransportSummary,
packageRateForDates,
  packageSeasonResolution,
  packageTierDays,
  applyPackageMarkup,
  presentationPricingColumns,
  singleSupplementForSeason,
  vehicleColumnPools,
  vehicleVectorPrice
} from '../lib/packagePricing';
import {
  guideChargeTotal,
  guideLabel,
  isGuideItem,
  isOverlandGuide
} from '../lib/guidePricing';
import GuideServiceTypeModal from '../components/GuideServiceTypeModal';
import GuideDetailsModal from '../components/GuideDetailsModal';
import AccommodationChargeModal from '../components/AccommodationChargeModal';
import { accommodationHasChoices, rateOptionLabel } from '../lib/accommodationOptions';

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
  const [vehicleTypes, setVehicleTypes] = useState([]);
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
  /* The export audience is one of three, never a fallback from one into another: the
     document for an assigned partner at their markup, a one-off markup for anyone who is
     not a partner, or the internal (STO) master at contract cost. The Presentation pricing
     summary is now the document's only pricing section, so it is on by default. */
  const [exportOptions, setExportOptions] = useState({ cover: true, inclusions: true, terms: true, explainPricing: false, showVehicleOptions: false, audience: 'partner', markup: '', includePricingSummary: true });
  const [exportFormat, setExportFormat] = useState('pdf');
  /* The grid lives above the tabs so the working Pricing & seasons grid and the client-facing
     Presentation pricing read one and the same set of columns and bands. The presentation never
     edits it. The columns seed from the vehicle_columns chosen on the Packages list when the
     package was created; a package without any falls back to the first six vehicle sizes. */
  const grid = usePricingGrid(vehicleTypes, (pkg?.vehicle_columns || []).map(String));
  const [activeSeason, setActiveSeason] = useState(0);
  const [clientSelectOpen, setClientSelectOpen] = useState(false);
  const [clientQuery, setClientQuery] = useState('');
  const [packagePreviewOpen, setPackagePreviewOpen] = useState(false);

  /* Guide service detour: the pending add held while the operator picks which
     service types the guide accompanies, and the guide & driver detail (lunch /
     dinner / overnight lines) for an overland guide on one day. */
  const [guideModal, setGuideModal] = useState(null);
  const [guideDetailsModal, setGuideDetailsModal] = useState(null);

  /* Accommodation charge detour: the pending add held while the operator picks
     the charge type (and season) a multi-price property is booked on. */
  const [accomChargeModal, setAccomChargeModal] = useState(null);

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

      const [pkgRes, dayRes, periodRes, paxRes, billingRes, vehicleTypesRes] = await Promise.all([
        supabase.from('packages').select('*').eq('id', packageId).eq('company_id', profile.company_id).single(),
        supabase.from('package_days').select('*').eq('package_id', packageId).order('day_number'),
        supabase.from('package_validity_periods').select('*').eq('package_id', packageId).order('valid_from'),
        supabase.from('package_pax_options').select('*').eq('package_id', packageId).order('pax'),
        supabase.from('company_billing_settings').select('itinerary_terms, price_protection_percent').eq('company_id', profile.company_id).maybeSingle(),
        supabase.from('company_vehicle_types').select('*').eq('company_id', profile.company_id).order('max_capacity')
      ]);
      for (const result of [pkgRes, dayRes, periodRes, paxRes, billingRes, vehicleTypesRes]) {
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
      setPeriods((periodRes.data || []).map(({ valid_from, valid_to, name, accommodation_per_person, single_supplement }) => ({ valid_from, valid_to, name, accommodation_per_person, single_supplement })));
      setPaxOptions(paxRes.data || []);
      setVehicleTypes((vehicleTypesRes.data || []).filter(Boolean));
      setClients(loadedClients);
      setSelectedDay(0);
      setLastSaved(JSON.stringify({
        form: packageForm,
        days: loadedDays,
        periods: (periodRes.data || []).map(({ valid_from, valid_to, name, accommodation_per_person, single_supplement }) => ({ valid_from, valid_to, name, accommodation_per_person, single_supplement })),
        paxOptions: paxRes.data || []
      }));

      const usedIds = [...new Set((itemRes.data || []).map((item) => item.item_id).filter(Boolean))];
      if (usedIds.length) {
        const [itemsRes, ratesRes] = await Promise.all([
          supabase.from('library_items').select('id, name, category, currency, pricing_model, supplier_id, max_occupancy, destination_region, destination_area, location, max_adults, max_children, child_age_ranges, is_active, meal_type, menu_type, guide_meals, guide_accommodation, guide_driver_room_offered').in('id', usedIds),
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
          .select('id, name, category, description, currency, pricing_model, supplier_id, max_occupancy, destination_region, destination_area, location, max_adults, max_children, child_age_ranges, is_active, meal_type, menu_type, guide_meals, guide_accommodation, guide_driver_room_offered')
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
  const mergedBands = useMemo(() => [...paxOptions].sort(byBandMin), [paxOptions]);

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
  /* Kept in step with the currency chosen at creation. It is not editable here: the modal
     owns it, and only while the package has no priced services. */
  currency_code: packageCurrency,
  /* The columns the package is priced in. Seeded from the Packages-list choice at load,
     then stored back here so the working grid and the exported presentation stay in step. */
  vehicle_columns: grid.usedCodes
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
          /* Raw contract cost, matching the rate-change path below. Markup lives on the
             totals at export time and is never stored on the line, so reassigning a
             client or selling the package elsewhere re-prices it instead of finding the
             old margin already baked into the row. */
          unit_price: Number(service.unit_cost) || 0,
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
          protected_season_name: service.protected_season_name || '',
          /* Guide service detour: which service types the guide line was priced
             from (null for ordinary lines) and whether the line prices the guide
             & driver only (their lunch / dinner / overnight details). */
          guide_service_types: Array.isArray(service.guide_service_types) ? service.guide_service_types : null,
          guide_only: service.guide_only === true,
          guide_for_item_key: service.guide_for_item_key || null,
          guide_charge_type: service.guide_charge_type || null
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
          validPeriods.map((period) => ({
            package_id: pkg.id,
            valid_from: period.valid_from,
            valid_to: period.valid_to,
            name: period.name || null,
            accommodation_per_person: period.accommodation_per_person ?? null,
            single_supplement: period.single_supplement ?? 0
          }))
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
      const savedPeriods = validPeriods.map(({ valid_from, valid_to, name, accommodation_per_person, single_supplement }) => ({
        valid_from,
        valid_to,
        name,
        accommodation_per_person,
        single_supplement
      }));
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
  }, [companyId, pkg, days, periods, mergedBands, form, library, autoRoomsFor, protectionPercent, packageCurrency, grid.usedCodes, showToast]);

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
    if (String(rate.currency || item.currency || packageCurrency).toUpperCase() !== String(packageCurrency).toUpperCase()) {
      showToast(`This package is priced in ${packageCurrency}. ${item.name} only has a ${rate.currency} rate, which would make the package total meaningless.`, 'warning');
      return;
    }
    /* A guide is charged per the service it accompanies, so the service type has
       to be chosen before the line can be priced. The add is parked until the
       operator answers, then re-entered with the choice in scope. */
    if (isGuideItem(item) && !(scope.guideServiceTypes || []).length) {
      setGuideModal({ item, rateId, dayIndex, scope, rate });
      return;
    }
    /* An accommodation contracted at several charge types (or several seasons)
       asks which one this booking uses before it is priced. */
    if (/accommodation/i.test(String(item.category || '')) && accommodationHasChoices(item) && !scope.accommodationChargeChosen) {
      setAccomChargeModal({ item, rateId, dayIndex, scope, rate });
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
    /* A guide line prices the flat per-trip sum of the chosen service types. The
       guide's own contract figure (unit_cost / price_1_adult) is 0, so the line
       is built from the selected survey rates and stored so it survives a reload. */
    const guideTypes = isGuideItem(item) ? (scope.guideServiceTypes || []) : [];
    const guideTotal = guideTypes.length ? guideChargeTotal(storedRate, guideTypes) : null;
    const service = {
      item_key: uuid(),
      item_id: item.id,      rate_id: rate.id,
      item_name: item.name,
      category: item.category || '',
      supplier_name: item.supplier_name || '',
      currency_code: rate.currency || item.currency || 'ZAR',
      rate_basis: guideTotal !== null ? 'per_trip' : (rate.rate_basis || item.pricing_model || 'per_person'),
      unit_cost: guideTotal !== null ? guideTotal : unitCost,
      unit_price: guideTotal !== null ? guideTotal : unitCost,
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
      protected_season_name: season.status === 'protected' ? season.seasonName : '',
      guide_service_types: guideTotal !== null ? guideTypes : null,
      guide_only: false,
      guide_for_item_key: null,
      guide_charge_type: null
    };
    if (season.message) showToast(season.message, season.status === 'protected' ? 'warning' : 'info');
    setDays((previous) => {
      if (!previous.length) return [{ day_number: 1, notes: '', services: [service] }];
      return previous.map((day, index) => index === dayIndex
        ? { ...day, services: [...day.services, service] }
        : day);
    });
    /* Overland comes with the guide lived in: everything the guide is fed and bedded
       on this day is asked for right away so the detour is not something the operator
       has to remember. */
    if (isOverlandGuide(guideTypes)) {
      setGuideDetailsModal({ dayIndex, guideKey: service.item_key, defaultValues: guideDetailsDefaultsFor(dayIndex, service.item_key) });
    }
  };

  const guideDetailsDefaultsFor = (dayIndex, guideKey) => {
    const day = days[dayIndex];
    const details = (day?.services || []).filter((service) => service.guide_for_item_key === guideKey);
    const byKind = (category) => details.find((service) => {
      const cat = String(service.category || '');
      return category === 'meal'
        ? /meal/i.test(cat)
        : /accommodation/i.test(cat);
    });
    const meal = byKind('meal');
    const overnights = details.filter((service) => {
      const cat = String(service.category || '');
      return /accommodation/i.test(cat);
    });
    const lunch = meal ? details.find((service) => /lunch/i.test(service.item_name || '')) : null;
    const dinner = meal ? details.find((service) => /dinner/i.test(service.item_name || '')) : null;
    const chargeTypes = overnights.map((service) => service.guide_charge_type || 'guide');
    return {
      lunchItemId: lunch?.item_id || (meal ? '' : ''),
      dinnerItemId: dinner?.item_id || '',
      overnightItemId: overnights[0]?.item_id || '',
      riderCharge: chargeTypes.includes('driver') && chargeTypes.includes('guide')
        ? 'both'
        : chargeTypes[0] || 'guide',
      showBothHint: overnights.length > 1,
      guideOnly: details.some((service) => service.guide_only === true)
    };
  };

  const confirmGuideTypes = (types) => {
    const pending = guideModal;
    if (!pending) return;
    setGuideModal(null);
    addService(pending.item, pending.rateId, pending.dayIndex, { ...pending.scope, guideServiceTypes: types });
  };

  const confirmAccommodationCharge = (choice) => {
    const pending = accomChargeModal;
    if (!pending) return;
    setAccomChargeModal(null);
    addService(pending.item, choice.rateId, pending.dayIndex, { ...pending.scope, accommodationChargeChosen: true });
  };

  const applyGuideDetails = (dayIndex, guideKey, plan) => {
    const day = days[dayIndex];
    if (!day) return;
    const guideService = (day.services || []).find((service) => service.item_key === guideKey);
    /* Re-applying replaces the existing detail lines so reopening the dialog never
       stacks a second lunch on top of the first. plan.overnight is an ARRAY of
       lines — one per charged party when the operator bills guide AND driver —
       and each line carries who it charges (guide_charge_type) so the dialog
       reopens with the same choice. */
    const lines = [plan.lunch, plan.dinner, ...(Array.isArray(plan.overnight) ? plan.overnight : plan.overnight ? [plan.overnight] : [])]
      .filter(Boolean)
      .map((detail) => {
        const item = detail.item;
        return {
          item_key: uuid(),
          item_id: item.id,
          rate_id: (item.item_rates || [])[0]?.id || null,
          item_name: item.name,
          category: item.category || '',
          supplier_name: item.supplier_name || item.supplier?.name || '',
          currency_code: packageCurrency,
          rate_basis: 'per_trip',
          unit_cost: Number(detail.unitCost) || 0,
          unit_price: Number(detail.unitCost) || 0,
          quantity: 1,
          is_included: true,
          vehicle_capacity: Number(item.max_occupancy || item.maxOccupancy) || 0,
          tier_key: guideService?.tier_key || null,
          replaces_item_key: null,
          rate_snapshot: (item.item_rates || [])[0] || {},
          price_protection_percent: 0,
          protected_season_name: '',
          guide_service_types: null,
          /* The overnight is always charged to the guide & driver alone; the
             checkbox governs only the meal lines. */
          guide_only: detail.who ? true : plan.guideOnly,
          guide_for_item_key: guideKey,
          guide_charge_type: detail.who || null
        };
      });
    setDays((previous) => previous.map((row, index) => index !== dayIndex ? row : {
      ...row,
      services: [
        ...(row.services || []).filter((service) => service.guide_for_item_key !== guideKey),
        ...lines
      ]
    }));
    if (lines.length) {
      showToast(plan.guideOnly
        ? `Guide details added — only the guide & driver are charged at these.`
        : 'Guide details added.', 'success');
    }
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
        const guideTypes = Array.isArray(service.guide_service_types) ? service.guide_service_types : [];
        const guideTotal = guideTypes.length ? guideChargeTotal(storedRate, guideTypes) : null;
        const unitCost = guideTotal !== null
          ? guideTotal
          : (Number(storedRate.unit_cost) || Number(storedRate.price_1_adult) || Number(storedRate.unit_price) || 0);
        return {
          ...service,
          rate_id: rate.id,
          rate_basis: guideTotal !== null ? 'per_trip' : (rate.rate_basis || item.pricing_model || service.rate_basis),
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
    /* Removing a guide line takes its guide & driver detail lines (lunch / dinner /
       overnight) with it, so the day never keeps orphaned meals and beds. */
    services: (() => {
      const target = day.services[serviceIndex];
      const removedKey = target?.item_key;
      return day.services.filter((service, itemIndex) => (
        itemIndex !== serviceIndex
        && (!removedKey || !service.guide_for_item_key || service.guide_for_item_key !== removedKey)
      ));
    })()
  }));

  /* "Update from library" (D18): copy the item's CURRENT contract rate over the line's
     locked snapshot, so a supplier change the operator has accepted moves the package.
     Exactly the same protection rules apply as when the line was added, so a refreshed
     line that no longer covers the package dates is uplifted - or declined outright if
     nothing usable is left. */
  const refreshServiceFromLibrary = (dayIndex, serviceIndex) => {
    setDays((previous) => previous.map((day, index) => index !== dayIndex ? day : {
      ...day,
      services: day.services.map((service, indexInDay) => {
        if (indexInDay !== serviceIndex) return service;
        const item = library.find((entry) => entry.id === service.item_id);
        if (!item) {
          showToast(`${service.item_name} is no longer in the library, so there is nothing to refresh from.`, 'warning');
          return service;
        }
        const liveRate = (item.item_rates || []).find((entry) => entry.id === service.rate_id) || rateForDates(item);
        if (!liveRate) {
          showToast(`${service.item_name} has no library rate in ${packageCurrency} to refresh from.`, 'warning');
          return service;
        }
        if (String(liveRate.currency || item.currency || packageCurrency).toUpperCase() !== String(packageCurrency).toUpperCase()) {
          showToast(`${service.item_name} is only priced in ${liveRate.currency}, so it cannot be refreshed.`, 'warning');
          return service;
        }
        const capacityError = packageItemCapacitySetupError(item, liveRate);
        if (capacityError) {
          showToast(capacityError, 'warning');
          return service;
        }
        const season = seasonFor(item, liveRate);
        if (!season.canAdd) {
          showToast(season.message, 'warning');
          return service;
        }
        const storedRate = season.status === 'protected' ? season.rate : liveRate;
        const guideTypes = Array.isArray(service.guide_service_types) ? service.guide_service_types : [];
        const guideTotal = guideTypes.length ? guideChargeTotal(storedRate, guideTypes) : null;
        const unitCost = guideTotal !== null
          ? guideTotal
          : (Number(storedRate.unit_cost) || Number(storedRate.price_1_adult) || Number(storedRate.unit_price) || 0);
        if (season.message) showToast(season.message, season.status === 'protected' ? 'warning' : 'info');
        return {
          ...service,
          rate_id: liveRate.id,
          rate_basis: guideTotal !== null ? 'per_trip' : (liveRate.rate_basis || item.pricing_model || service.rate_basis),
          currency_code: liveRate.currency || item.currency || service.currency_code,
          unit_cost: unitCost,
          unit_price: unitCost,
          rate_snapshot: storedRate,
          price_protection_percent: season.protectionPercent || 0,
          protected_season_name: season.status === 'protected' ? season.seasonName : ''
        };
      })
    }));
  };

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
  const setChildRange = (range) => setForm((previous) => ({ ...previous, childAgeRange: range }));
  const changeChildRange = (field, value) => setChildRange(normaliseChildAgeRange({
    ...(form.childAgeRange || { ageFrom: 0, ageTo: PACKAGE_MAX_CHILD_AGE }),
    [field]: value
  }));
  /* The child toggle is written the moment it is flipped rather than held for "Save package",
     because a refresh before saving used to put it straight back. The rest of the form is
     saved exactly as it stands so flipping the toggle never carries a stale copy with it. */
  const toggleAcceptsChildren = (checked) => {
    const nextForm = { ...form, acceptsChildren: checked };
    setForm(nextForm);
    persist(days, periods, mergedBands, nextForm);
  };

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
      vehicleTypes,
      markupPercent,
      pattern: largestTravellerPattern(biggest ? [biggest] : [])
    });
  }, [days, library, childRange, markupPercent, mergedBands, vehicleTypes]);

  /* The buyer wants to know what adding a child costs before anyone has declared a range,
     so the Presentation tab and the export quote the child price off the full 0-18 range
     when the package has none set. This is a separate figure from childBreakdown so the
     Children tab keeps saying "set a range" rather than showing a price nobody confirmed. */
  const childBreakdownSummary = useMemo(() => {
    const biggest = mergedBands.length
      ? mergedBands.reduce((top, band) => (packageBandPax(band) > packageBandPax(top) ? band : top), mergedBands[0])
      : null;
    return calculatePackageTravellerBreakdown({
      days: packageTierDays(days, biggest, library),
      library,
      childRange: childRange || { ageFrom: 0, ageTo: PACKAGE_MAX_CHILD_AGE },
      vehicleTypes,
      markupPercent,
      pattern: largestTravellerPattern(biggest ? [biggest] : [])
    });
  }, [days, library, childRange, markupPercent, mergedBands, vehicleTypes]);

  /* Accommodation is the one line already in the package, so a season that names dates
     which fall inside an accommodation's own contract window picks its price up without
     the operator having to copy it. The per-season override, when set, stays locked
     (D18): it wins until cleared. */
  const activePeriod = periods[activeSeason] || null;
  const derivedAccommodation = useMemo(
    () => accommodationPerPersonForSeason({
      days,
      library,
      from: activePeriod?.valid_from || null,
      to: activePeriod?.valid_to || null
    }),
    [days, library, activePeriod]
  );
  const accommodationPerPerson = activePeriod?.accommodation_per_person != null
    ? Number(activePeriod.accommodation_per_person)
    : derivedAccommodation.total;

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
    /* Three audiences, never a fallback from one into another: the partner document at the
       assigned partner's markup; a one-off markup for anyone who is not a partner; or the
       internal (STO) master at contract cost. The document's pricing section is the
       Presentation pricing summary below - the old per-band cards and boxes are gone, so
       there is nothing to price twice and nothing for two sections to disagree about. */
    const exportMarkup = packageExportMarkup({
      audience: options.audience,
      hasPartner: selectedClients.length > 0,
      assignedMarkup: markupPercent, typedMarkup: options.markup
    });
    const partnerView = exportMarkup > 0;
    /* The Presentation pricing table mirrors the Presentation pricing tab exactly: one table,
       every column, five rows — travel season, travellers, price per person sharing, single
       supplement and child price. Columns are never labelled with a vehicle in a client document. */
    const summaryMarkup = !options.includePricingSummary || !grid.usedCodes.length ? '' : (() => {
      const codes = grid.usedCodes;
      const pool = vehicleColumnPools({ days, library, vehicleTypes });
      const price = (value) => (partnerView ? applyPackageMarkup(value, exportMarkup) : value);
      const childPrice = Number(childBreakdownSummary?.childTotal) || 0;
      const childText = `<strong>${money(price(childPrice), packageCurrency)}</strong><span class="sum-flat-from">unit share + the accommodation child rate</span>`;
      /* One table per season, stacked. The vehicle pool and the party sizes never move with
         the season, so from table to table only the season line, the accommodation-based
         price and the single supplement change. */
      const seasons = periods.length ? periods : [null];
      const roomCapacity = accommodationRoomCapacity({ days, library });
      const tables = seasons.map((period, seasonIndex) => {
        const accommodation = period?.accommodation_per_person != null
          ? Number(period.accommodation_per_person)
          : (accommodationPerPersonForSeason({ days, library, from: period?.valid_from || null, to: period?.valid_to || null }).total ?? 0);
        /* Derived from the accommodation's own contract when the season carries no override,
           so the reader always sees a supplement rather than a zero that reads as no charge. */
        const single = period?.single_supplement != null
          ? Number(period.single_supplement)
          : (singleSupplementForSeason({ days, library, from: period?.valid_from || null, to: period?.valid_to || null }).total ?? 0);
        const seasonLine = period
          ? `${period?.name ? `${escapeHtml(period.name)} · ` : ''}Season ${seasonIndex + 1}${period?.valid_from && period?.valid_to ? ` · ${escapeHtml(period.valid_from)} \u2192 ${escapeHtml(period.valid_to)}` : ''}`
          : 'No season set';
        const columns = presentationPricingColumns({ codes, bands: grid.bands, pools: pool.pools, perPersonFixed: pool.perPersonFixed, accommodation, singleSupplement: single, roomCapacity });
        const travellerCells = columns.map(({ pax }) => `<td class="sum-cell sum-trav"><span class="sum-pax">${pax} pax</span></td>`).join('');
        const priceCells = columns.map(({ each }) => `<td class="sum-cell"><span class="sum-price">${money(price(each), packageCurrency)}</span></td>`).join('');
        return `<table class="price-summary"><tbody>
          <tr><td class="lab">Travel seasons</td><td class="sum-date" colspan="${columns.length}">${seasonLine}</td></tr>
          <tr><td class="lab">Travellers</td>${travellerCells}</tr>
          <tr><td class="lab">Price per person sharing</td>${priceCells}</tr>
          <tr><td class="lab">Single supplement</td><td class="sum-flat sum-flat-amber" colspan="${columns.length}"><strong>${money(price(single), packageCurrency)}</strong><span class="sum-flat-from">per person, when you want your own room</span></td></tr>
          <tr><td class="lab">Child price</td><td class="sum-flat sum-flat-child" colspan="${columns.length}">${childText}</td></tr>
        </tbody></table>`;
      }).join('');
      return `<section class="pricing-summary-section"><h2>Pricing summary</h2>
        <p class="pattern-note">Per person, sharing price:</p>${tables}</section>`;
    })();
    const markupNoteLine = exportMarkup > 0
      ? `<p class="pattern-note">${options.audience === 'partner' ? 'Partner version' : 'Marked-up version'}: prices include the ${exportMarkup}% markup applied to this quote. The internal version shows these prices at contract cost.</p>`
      : '<p class="pattern-note">Internal version: prices are at contract cost (STO) with no partner markup applied.</p>';
    /* The child price now always carries a figure, so the note only says which range it was
       priced for: the declared one, or 0-18 while none has been set. */
    const childNote = !form.acceptsChildren
      ? '<p class="pattern-note">Children are not accepted on this package, so no child price applies to a booking. The child figure above is shown so a buyer can see what adding one would cost.</p>'
      : (!childRange ? '<p class="pattern-note">No child age range has been set on this package, so the child price above is priced for a child aged 0 to 18.</p>' : '');
    const inclusionMarkup = options.inclusions
      ? `${form.inclusions ? `<h3>Inclusions</h3><p>${escapeHtml(form.inclusions).replace(/\n/g, '<br>')}</p>` : ''}${form.exclusions ? `<h3>Exclusions</h3><p>${escapeHtml(form.exclusions).replace(/\n/g, '<br>')}</p>` : ''}`
      : '';
    const termsMarkup = options.terms && form.terms
      ? `<section><h2>Terms &amp; Conditions</h2><p>${escapeHtml(form.terms).replace(/\n/g, '<br>')}</p></section>`
      : '';
    const clientNames = selectedClients.map(nameOf).join(', ');
    /* The three price cards reuse the tab's colours exactly: teal for the two adult
       prices, amber for the child, and grey when no child range is set. */
    const priceCardCss = `.price-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:12px 0 4px}.price-card{display:flex;flex-direction:column;gap:4px;padding:12px;border-radius:8px;background:#f0fdfa}.price-card span,.price-card small{color:#64748b;font-size:11px;line-height:1.35}.price-card strong{color:#0f766e;font-size:17px}.price-card.lead{box-shadow:0 0 0 2px #0d7478 inset}.price-card-party{background:#f0fdf4;border:1px solid #bbf7d0}.price-card-party span,.price-card-party small{color:#166534}.price-card-party strong{color:#15803d}.price-card-child{background:#fff7ed;border:1px solid #fed7aa}.price-card-child span,.price-card-child small{color:#9a5b13}.price-card-child strong{color:#b45309}.price-card-child.pending{background:#f8fafc;border:1px dashed #cbd5e1}.price-card-child.pending span,.price-card-child.pending small,.price-card-child.pending strong{color:#94a3b8}.pattern-pax{margin:0 0 2px;font-weight:bold;color:#1a202c}.pattern-note{margin:8px 0 0;padding:8px 10px;border-left:3px solid #94a3b8;background:#f8fafc;color:#475569;font-size:12px;line-height:1.45}.price-matrix-card{margin:12px 0;padding:12px 14px;border:1px solid #e2e8f0;border-radius:9px;background:#f8fafc}.price-matrix-card h2{margin:0 0 9px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#0d7478}.price-matrix-scroll{overflow-x:auto}.price-matrix{width:100%;border-collapse:collapse}.price-matrix th,.price-matrix td{padding:9px 12px;text-align:center;border:1px solid #e2e8f0;font-size:14px;white-space:nowrap}.price-matrix th{background:#f0fdfa;color:#0f766e;font-weight:700}.price-matrix td{color:#1e293b;font-weight:700}.price-matrix td.pending{color:#94a3b8;font-weight:400}@media print{.price-cards,.price-matrix-card{break-inside:avoid}}`;
    const summaryCss = `.pricing-summary-section{break-inside:avoid}.price-summary{width:100%;border-collapse:collapse;margin:10px 0;table-layout:fixed;break-inside:avoid}.price-summary .lab{width:168px;background:#f8fafc;text-align:left;font-size:12.5px;font-weight:600;color:#334155}.price-summary th,.price-summary td{border:1px solid #e2e8f0;padding:10px 12px;vertical-align:top}.price-summary .sum-cell{text-align:center}.price-summary .sum-trav{background:#f0fdfa}.price-summary .sum-pax{display:block;font-size:15px;font-weight:700;color:#0f766e;font-variant-numeric:tabular-nums}.price-summary .sum-price{display:block;font-size:15px;font-weight:700;color:#0f172a;font-variant-numeric:tabular-nums}.price-summary .sum-date{background:#fffbeb;text-align:left;font-size:15px;font-weight:700;color:#78350f;font-variant-numeric:tabular-nums}.price-summary .sum-flat{text-align:left;font-size:15px;font-weight:700;font-variant-numeric:tabular-nums}.price-summary .sum-flat-amber{background:#fefce8;color:#854d0e}.price-summary .sum-flat-child{background:#fdf2f8;color:#9d174d}.price-summary .sum-flat-from{display:block;margin-top:3px;font-size:11px;font-weight:500;color:#94a3b8}`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(pkg.name)}</title><style>body{font:15px Arial,sans-serif;color:#1e293b;max-width:850px;margin:36px auto;padding:0 24px}h1,h2,h3{color:#0d7478}header{border-bottom:2px solid #0d7478;padding-bottom:16px;margin-bottom:24px}section{margin:22px 0;padding-bottom:12px;border-bottom:1px solid #e2e8f0}.cover{max-width:100%;max-height:280px;object-fit:cover}li{margin:6px 0}${priceCardCss}${summaryCss}@media print{body{margin:0 auto}}</style></head><body><header>${cover}<h1>${escapeHtml(pkg.name)}</h1><p>${escapeHtml(form.description)}</p>${clientNames ? `<h3>For partner: ${escapeHtml(clientNames)}</h3>` : ''}</header>${dayMarkup}${vehicleNote}${inclusionMarkup ? `<section>${inclusionMarkup}</section>` : ''}${summaryMarkup}${markupNoteLine}${childNote}${termsMarkup}</body></html>`;
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
  const addPeriod = () => setPeriods((previous) => [...previous, { valid_from: '', valid_to: '', name: '', accommodation_per_person: null, single_supplement: 0 }]);
  const changePeriod = (index, field, value) => setPeriods((previous) => previous.map((period, rowIndex) =>
    rowIndex === index ? { ...period, [field]: value } : period));
  const removePeriod = (index) => setPeriods((previous) => previous.filter((_, rowIndex) => rowIndex !== index));
  if (!packageId) return <div className="super-admin-page"><button className="secondary-btn" onClick={() => navigate('/packages')}><ArrowLeft size={16} /> Packages</button><p>Open a package from the Packages list.</p></div>;

  const tabs = [
    ['itinerary', 'Itinerary'],
    ['pricing', 'Pricing & seasons'],
    ['summary', 'Presentation pricing'],
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
        <button className="secondary-btn" onClick={() => { setExportOptions((previous) => (previous.audience === 'partner' && !selectedClients.length ? { ...previous, audience: 'markup' } : previous)); setExportDialog(true); }} disabled={!pkg}><Download size={16} /> Export</button>
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
                  {rate && /accommodation/i.test(String(item.category || '')) && (() => {
                    const opt = rateOptionLabel(rate, item);
                    const season = rate.season_name || rate.option_name || '';
                    const from = rate.valid_from ? String(rate.valid_from).slice(0, 10).replaceAll('-', '/') : '';
                    const to = rate.valid_to ? String(rate.valid_to).slice(0, 10).replaceAll('-', '/') : '';
                    const label = [season, opt, (from && to) ? `${from}-${to}` : ''].filter(Boolean).join(' · ');
                    return label ? <span className="basis-tag" style={{ color: '#5b21b6', background: '#f5f3ff', borderColor: '#ddd6fe' }}>{label}</span> : null;
                  })()}
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
              /* The sheet shows one row per service with the vehicle prices in it. On the
                 working canvas every vehicle stays visible, so a per-vehicle line carries
                 its own price pills rather than a single figure. */
              const pillRate = service.rate_snapshot && Object.keys(service.rate_snapshot).length
                ? service.rate_snapshot
                : (item?.item_rates || []).find((rate) => rate.id === service.rate_id);
              const vectorPills = !isStay(service)
                && String(pillRate?.rate_basis || service.rate_basis || item?.pricing_model || '').toLowerCase() === 'per_vehicle'
                && pillRate?.prices_by_vehicle && Object.keys(pillRate.prices_by_vehicle).length;
              const serviceCurrency = service.currency_code || packageCurrency;
              return <article key={service.item_key || `${service.id || service.item_id}-${rawIndex}`} className={`package-canvas-service ${bandOnly ? 'band-only' : ''}`} draggable onDragStart={(event) => event.dataTransfer.setData('application/json', JSON.stringify({ type: 'service', fromDay: selectedDay, fromIndex: rawIndex }))}>
                <GripVertical size={16} className="package-grip" />
                <div className="package-service-main"><strong>{service.item_name}</strong><small>{service.category || 'Service'}{service.supplier_name ? ` · ${service.supplier_name}` : ''}</small>
                  {bandOnly
                    ? <small className="package-band-flag">this band only</small>
                    : (service.tier_key && <small className="package-band-flag other">{packageBandLabel(mergedBands.find((band) => band.item_key === service.tier_key) || {})} only</small>)}
                  {!bandOnly && !service.tier_key && <small className="package-band-flag shared">all bands</small>}
                  {item?.item_rates?.length > 1 && <select aria-label={`Rate for ${service.item_name}`} value={service.rate_id || ''} onChange={(event) => updateService(selectedDay, rawIndex, 'rate_id', event.target.value)}>
                    {item.item_rates.map((rate) => {
                    const opt = rateOptionLabel(rate, item);
                    const season = rate.season_name || rate.option_name || 'Contract rate';
                    const from = rate.valid_from ? String(rate.valid_from).slice(0, 10).replaceAll('-', '/') : '';
                    const to = rate.valid_to ? String(rate.valid_to).slice(0, 10).replaceAll('-', '/') : '';
                    const label = [season, opt, (from && to) ? `${from}-${to}` : ''].filter(Boolean).join(' · ');
                    return <option key={rate.id} value={rate.id}>{label} · {rate.currency} {Number(rate.unit_cost || rate.price_1_adult || rate.unit_price || 0).toFixed(2)}</option>;
                  })}
                  </select>}
                  {Number(service.price_protection_percent) > 0
                    ? <small className="package-season-warning protected" title={service.rate_snapshot?.protection_note || 'Pricing Protection applied'}>{service.protected_season_name ? `Pricing Protection applied — ${service.protected_season_name} season +${service.price_protection_percent}%` : `Pricing Protection applied +${service.price_protection_percent}%`}</small>
                    : !coverage.ok && <small className="package-season-warning" title={coverage.message}>{coverage.message}</small>}
                  {Number(service.price_protection_percent) > 0 && <small className="package-protected-flag">{service.currency_code} {Number(service.unit_cost || 0).toFixed(2)} includes the protection uplift</small>}
                  {Array.isArray(service.guide_service_types) && service.guide_service_types.length > 0 && (
                    <small className="package-band-flag shared guide-service-types">Guide · {guideLabel(service.guide_service_types)}</small>
                  )}
                  {service.guide_only === true && <small className="package-band-flag guide-only">guide &amp; driver only</small>}
                </div>
                <div className="package-service-price"><span>{service.currency_code} {Number(service.unit_cost || 0).toFixed(2)}</span><small>{service.rate_basis || 'per_person'} · no markup</small>{capacitySummary && <small>{capacitySummary}</small>}
                  {roomPlan && <small title={`Rooms are worked out from ${autoPattern.pax} pax at ${roomPlan.capacity} per room`}>
                    {roomPlan.roomCount} room{roomPlan.roomCount === 1 ? '' : 's'} auto · {round(roomPlan.sharingPerAdult).toFixed(2)}/adult sharing · +{round(roomPlan.singleSupplement).toFixed(2)} single supp.
                  </small>}
                  {vectorPills && !!grid.usedCodes.length && <small className="package-vehicle-pills">
                    {grid.usedCodes.map((code) => {
                      const cell = vehicleVectorPrice(pillRate.prices_by_vehicle, code);
                      const type = vehicleTypes.find((entry) => entry?.code === code);
                      return <span key={code} className={`package-vehicle-pill ${cell === null ? 'none' : ''}`}>{type?.name || code}: {cell === null ? 'not priced' : `${serviceCurrency} ${round(cell).toFixed(2)}`}</span>;
                    })}
                  </small>}
                </div>
                <label className="package-included-toggle"><input type="checkbox" checked={service.is_included !== false} onChange={(event) => updateService(selectedDay, rawIndex, 'is_included', event.target.checked)} /> Included</label>
                {roomPlan
                  ? <span className="package-quantity auto" title={`Rooms are worked out from ${autoPattern.pax} pax at ${roomPlan.capacity} per room`}>Rooms {roomPlan.roomCount}</span>
                  : <label className="package-quantity">Qty <input type="number" min="1" step="1" value={service.quantity || 1} onChange={(event) => updateService(selectedDay, rawIndex, 'quantity', Number(event.target.value) || 1)} /></label>}
                <button type="button" className="package-icon-button" aria-label={`Update ${service.item_name} from the library (re-locks today's rate)`} onClick={() => refreshServiceFromLibrary(selectedDay, rawIndex)} title="Update from library: re-locks this line to the library's current rate" disabled={!library.find((entry) => entry.id === service.item_id)}><RefreshCw size={16} /></button>
                {isOverlandGuide(service.guide_service_types) && (
                  <button type="button" className="package-icon-button" aria-label={`Guide & driver details for ${service.item_name} on day ${selectedDay + 1}`} title="Guide & driver details — meals and overnight for this day" onClick={() => setGuideDetailsModal({ dayIndex: selectedDay, guideKey: service.item_key, defaultValues: guideDetailsDefaultsFor(selectedDay, service.item_key) })}><UtensilsCrossed size={16} /></button>
                )}
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
      {tab === 'pricing' && <PricingSeasonsTab
        vehicleTypes={vehicleTypes}
        periods={periods}
        onAddPeriod={addPeriod}
        onChangePeriod={changePeriod}
        onRemovePeriod={removePeriod}
        days={days}
        library={library}
        childRange={childRange}
        acceptsChildren={form.acceptsChildren}
        currency={packageCurrency}
        childBreakdown={childBreakdown}
        onRefreshService={refreshServiceFromLibrary}
        slots={grid.slots}
        usedCodes={grid.usedCodes}
        bands={grid.bands}
        changeSlot={grid.changeSlot}
        changeBand={grid.changeBand}
        activeSeason={activeSeason}
        setActiveSeason={setActiveSeason}
        accommodationPerPerson={accommodationPerPerson}
        derivedAccommodation={derivedAccommodation}
      />}
      {tab === 'summary' && <PricingSummaryTab
        vehicleTypes={vehicleTypes}
        periods={periods}
        days={days}
        library={library}
        activeSeason={activeSeason}
        slots={grid.slots}
        bands={grid.bands}
        currency={packageCurrency}
        childBreakdown={childBreakdownSummary}
        accommodationPerPerson={accommodationPerPerson}
      />}
      {tab === 'children' && <section className="package-tab-panel">
        <h2><Baby size={19} /> Children on this package</h2>
        <p>A child is only priced differently because of the accommodation. Everything else in the package is shared unit cost divided by pax, and a child pays exactly that same unit share. The one figure that can differ is the room, and that comes from the property's own child price for the age range set below.</p>
        {markupPercent > 0 && <p className="package-help">The figures on this tab are contract costs. The child price on the Pricing &amp; seasons tab and in a client export carries the {markupPercent}% partner markup.</p>}
        <label className="package-publish-toggle"><input type="checkbox" checked={form.acceptsChildren} onChange={(event) => toggleAcceptsChildren(event.target.checked)} /><span><strong>A child may travel on this package</strong><small>When off, the package is for adults only and no child price is published.</small></span></label>
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
          <p>This tab covers the accommodation only, because the accommodation is the only part of a package that can price a child differently. Each property is listed with its supplier: where the property contracts a child rate for this age range that rate is used, and where it does not accept a child its single supplement is used instead. The unit share an adult pays is added on the Pricing &amp; seasons tab.</p>
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
                {!!childBreakdown.accommodationRows.length && childBreakdown.childAccommodation === 0 && <tr><td colSpan={5} className="package-child-note">Every accommodation in this package publishes its child rate as R0.00 — a child is allowed at all of them and stays free. A property with no child rate at all would quote the single supplement instead.</td></tr>}
                <tr className="package-breakdown-total"><th colSpan={4}>Total child accommodation, added to the unit share</th><td>{money(childBreakdown.childAccommodation, childBreakdown.currency)}</td></tr>
              </tbody>
            </table></div>
            <p className="package-child-note">Added to the unit share of {money(childBreakdown.unitPerPerson, childBreakdown.currency)} on the Pricing &amp; seasons tab, giving a child price of {money(childBreakdown.childTotal, childBreakdown.currency)}.</p>
            {!!childBreakdown.accommodationRows.length && !!childBreakdown.childNotAllowed.length && <p className="package-child-note">{childBreakdown.childNotAllowed.join(', ')} does not accept a child for {childRange.ageFrom}—{childRange.ageTo} yrs, so each is charged the single supplement of {money(childBreakdown.childSupplement, childBreakdown.currency)} instead of a child rate.</p>}
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
                <span className="package-preview-price">{service.currency_code} {Number(service.unit_cost || 0).toFixed(2)} A- {service.quantity || 1}</span>
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
        <div className="package-export-options"><span className="package-export-subhead">For</span><label><input type="radio" name="package-export-audience" value="partner" checked={exportOptions.audience === 'partner'} disabled={!selectedClients.length} onChange={() => setExportOptions((previous) => ({ ...previous, audience: 'partner' }))} /> Assign to partner{selectedClients.length ? ` (${selectedClients.map(nameOf).join(', ')})` : ' — none assigned'}</label><label><input type="radio" name="package-export-audience" value="markup" checked={exportOptions.audience === 'markup'} onChange={() => setExportOptions((previous) => ({ ...previous, audience: 'markup' }))} /> Markup for a non-partner</label>{exportOptions.audience === 'markup' ? <label className="package-export-markup">Markup <input type="number" min="0" step="0.5" value={exportOptions.markup} onChange={(event) => setExportOptions((previous) => ({ ...previous, markup: event.target.value }))} /> %</label> : null}<label><input type="radio" name="package-export-audience" value="internal" checked={exportOptions.audience === 'internal'} onChange={() => setExportOptions((previous) => ({ ...previous, audience: 'internal' }))} /> Internal (STO)</label></div>
        <div className="package-export-options"><span className="package-export-subhead">Format</span><label><input type="radio" name="package-export-format" value="pdf" checked={exportFormat === 'pdf'} onChange={() => setExportFormat('pdf')} /> PDF</label><label><input type="radio" name="package-export-format" value="word" checked={exportFormat === 'word'} onChange={() => setExportFormat('word')} /> Word</label></div>
        <div className="package-export-options"><span className="package-export-subhead">Include</span>{[['cover', 'Cover image'], ['inclusions', 'Inclusions'], ['terms', 'Terms'], ['includePricingSummary', 'Presentation pricing'], ['explainPricing', 'Explain pricing'], ['showVehicleOptions', 'Every vehicle size']].map(([key, label]) => <label key={key}><input type="checkbox" checked={!!exportOptions[key]} onChange={(event) => setExportOptions((previous) => ({ ...previous, [key]: event.target.checked }))} /> {label}</label>)}</div>
      </div>
      <div className="package-modal-actions"><button className="secondary-btn" onClick={() => setExportDialog(false)}>Cancel</button><button className="primary-btn" onClick={exportDocument}><FileText size={16} /> Export</button></div>
    </section></div>}
    {guideModal && <GuideServiceTypeModal
      item={guideModal.item}
      rate={guideModal.rate}
      currency={packageCurrency}
      onConfirm={confirmGuideTypes}
      onCancel={() => setGuideModal(null)}
    />}
    {accomChargeModal && <AccommodationChargeModal
      item={accomChargeModal.item}
      currency={accomChargeModal.item.currency_code || packageCurrency}
      travelStart={periods[0]?.valid_from || ''}
      travelEnd={periods[0]?.valid_to || ''}
      defaultRateId={accomChargeModal.rate?.id || ''}
      onConfirm={confirmAccommodationCharge}
      onCancel={() => setAccomChargeModal(null)}
    />}
    {guideDetailsModal && (function renderGuideDetails() {
      const day = days[guideDetailsModal.dayIndex];
      const guideLine = (day?.services || []).find((service) => service.item_key === guideDetailsModal.guideKey);
      return <GuideDetailsModal
        guideName={guideLine?.item_name || 'Guide & driver'}
        dayLabel={`Day ${guideDetailsModal.dayIndex + 1}`}
        currency={packageCurrency}
        libraryItems={library}
        travelStart={periods[0]?.valid_from || ''}
        travelEnd={periods[0]?.valid_to || ''}
        currentAccommodationIds={(day?.services || [])
          .filter((service) => /accommodation/i.test(service.category || '') && service.is_included !== false)
          .map((service) => service.item_id)}
        defaultValues={guideDetailsModal.defaultValues || {}}
        onConfirm={(plan) => {
          const modal = guideDetailsModal;
          setGuideDetailsModal(null);
          applyGuideDetails(modal.dayIndex, modal.guideKey, plan);
        }}
        onCancel={() => setGuideDetailsModal(null)}
      />;
    })()}
  </div>;
};
