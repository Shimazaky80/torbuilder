import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Backpack, Baby, CalendarDays, Car, Check, ChevronDown, Download, FileText, MapPin,
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
  packageBandCapacityError,
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
import { singleSupplementLadderSummary } from '../lib/singleSupplement';
import {
  crewChargeOf,
  crewShareOn,
  guideChargeTotal,
  guideLabel,
  isGuideItem,
  isOverlandGuide,
  refreshCrewShare
} from '../lib/guidePricing';
import GuideServiceTypeModal from '../components/GuideServiceTypeModal';
import GuideDetailsModal from '../components/GuideDetailsModal';
import AccommodationChargeModal from '../components/AccommodationChargeModal';
import CarRentalDropModal from '../components/CarRentalDropModal';
import CarSpecGrid from '../components/CarSpecGrid';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  buildRentalDetails,
  carRentalBuyTotal,
  carRentalGroupChoices,
  carRentalGroups,
  carRentalHireTotal,
  isCarRentalItem,
  isRentalFeeLine,
  rentalCollectionDayIndex,
  rentalDayCount,
  rentalDayDetails,
  rentalDayPlacement,
  rentalDayShares,
  rentalFeeDetails,
  rentalFeeLineLabel,
  rentalLineBuyTotal,
  rentalPackageRate,
  rentalPrintsSpecGrid,
  rentalSummaryLabel,
  rentalVehicleLabel
} from '../lib/carRentalPricing';
import { carSpecGridHtml } from '../lib/carSpecIcons';
import { fetchCarRentalRates } from '../lib/carRentalRates';
import { crewShareColumn, rentalDetailsColumn } from '../lib/rentalSnapshotColumn';
import LanguageText from '../components/LanguageText';
import {
  SOURCE_LANGUAGE,
  formatMoney,
  languageChoices,
  labelFor,
  localizedText,
  textI18nPayload,
  translationsOf
} from '../lib/i18n';
import { textI18nColumn } from '../lib/i18n/textI18nColumn';
import { useTenantLanguages } from '../lib/i18n/useTenantLanguages';
import { accommodationHasChoices, nightBandLabel, rateOptionLabel } from '../lib/accommodationOptions';
import { starRatingOf, withStarGrade } from '../lib/starGrading';
import { supplierColumns } from '../lib/supplierStarColumn';
import { fetchRoomTypesForItems } from '../lib/roomTypeTable';
import { LIBRARY_ITEM_PACKAGE_FIELDS, LIBRARY_ITEM_PACKAGE_FIELDS_FALLBACK } from '../lib/libraryItemFields';
import { itemDestinationLabel } from '../lib/libraryItemDetail';
import { destinationClause, destinationsOf, fetchDestinationCatalog, matchesDestinations } from '../lib/destinationFilter';
import MultiSelectFilter from '../components/MultiSelectFilter';

/* The guide & driver meal flags and the flight's guide ticket are the newest
   library columns. PostgREST rejects a named select whole when one column in it
   does not exist yet, so the query is built with them and rebuilt without: a
   workspace that has not applied the migration still opens its packages, and
   the guide dialog simply offers every meal again.

   The caller supplies a builder rather than a finished query because supabase
   needs the projection before any filter can be chained onto it. */
const selectLibraryItems = async (buildQuery) => {
  const withCrewFlags = await buildQuery(LIBRARY_ITEM_PACKAGE_FIELDS);
  return withCrewFlags.error ? buildQuery(LIBRARY_ITEM_PACKAGE_FIELDS_FALLBACK) : withCrewFlags;
};


const uuid = packageKey;

const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
const money = (value, code) => `${code} ${round(value).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nameOf = (client) => client?.name || 'Unnamed client';
/* A package line names its property with the hotel's star grading, the same way
   the itinerary and vouchers do. The grade rides on the service while the package
   is open and is read back from the library item after a reload. */
const packageServiceStar = (service, library) => {
  if (!service) return null;
  if (service.supplier_star_rating !== undefined && service.supplier_star_rating !== null) {
    return starRatingOf(service.supplier_star_rating);
  }
  const item = (library || []).find((entry) => String(entry.id) === String(service.item_id));
  return starRatingOf(item?.supplier_star_rating);
};
const packageServiceSupplier = (service, library) => {
  const name = String(service?.supplier_name || '').trim();
  if (!name) return '';
  const star = /accommodation/i.test(String(service?.category || ''))
    ? packageServiceStar(service, library)
    : null;
  return withStarGrade(name, star);
};
/* Bands read smallest party first. Every band is the operator's: the vehicles only ever
   suggest party sizes, so there is nothing for a rebuild to take back off them. */
const byBandMin = (a, b) => packageBandPax(a) - packageBandPax(b);
const currencyMatches = (rate, code) => !code || String(rate?.currency || '').toUpperCase() === String(code).toUpperCase();
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

const initialForm = {
  description: '', inclusions: '', exclusions: '', terms: '', textI18n: null,
  isAvailable: false, acceptsChildren: false, childAgeRange: null,
  assignedClientIds: []
};

/* The package form styles its own textareas from `.package-field textarea`. The
   language editor keeps them inside a strip, so the box is handed the padding and
   the row-driven height the form already gave it - a translated package must not
   look different from an English one. */
const packageProseStyle = { minHeight: 'auto', padding: '.65rem .7rem' };
const DEFAULT_CATEGORIES = [
  'Accommodation', 'Transfers', 'Activities / Tours', 'Flights / Charter',
  'Meals', 'Guide', 'Trains', 'Tickets', 'Extras', 'Car Rental', 'Transport'
];

/* Sidebar card presentation. The package picker deliberately mirrors the
   itinerary builder sidebar: one line of facts per item - name, category, the
   price exactly as it is loaded, supplier and the contract basis. Season names,
   validity dates and hover tooltips are deliberately absent, because the season
   that applies is worked out from the package validity dates (see
   packageRateForDates) and an operator should not have to choose it by hand.
   A season can still be overridden on the day row itself after the item lands. */
const SIDEBAR_FLAT_BASES = new Set(['per_vehicle', 'per_trip', 'per_room', 'per_unit', 'flat']);

/* The window a season row actually spans. An out-of-season price always names
   the dates it covers, so nobody has to guess which year they are being charged. */
const seasonWindowLabel = (rate) => {
  const from = String(rate?.valid_from || '').slice(0, 10);
  const to = String(rate?.valid_to || '').slice(0, 10);
  if (!from && !to) return 'undated';
  return `${from || 'open'} to ${to || 'open'}`;
};

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
  /* Several islands can be on the list at once — a package normally covers more
     than one stop, and re-picking a single-value dropdown for each leg is how an
     operator loses the first one. */
  const [destinationFilters, setDestinationFilters] = useState([]);
  const [results, setResults] = useState([]);
const [selectedDay, setSelectedDay] = useState(0);
const [tab, setTab] = useState('itinerary');
  /* Days ticked in the strip so they can be deleted together, and the second
     click that lets them go: a day carries every line worked on it. */
  const [markedDayIndexes, setMarkedDayIndexes] = useState([]);
  const [bulkDeleteArmed, setBulkDeleteArmed] = useState(false);
/* Which band the Itinerary tab is being edited as. Empty string means the shared base
   itinerary that every band uses. */
const [bandScope, setBandScope] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  /* Newer season columns are written on the same insert as the season itself, where an
     unknown column rejects the whole payload. They stay off until the database proves it
     has them, so an unmigrated package still saves. */
  const [dbFeatures, setDbFeatures] = useState({ singleRooms: false, roomTypes: false });
  /* Pricing Protection, read from the same tenant setting the itinerary builder uses,
     so a package and an itinerary price the same superseded season the same way. */
  const [protectionPercent, setProtectionPercent] = useState(0);
  /* An item whose seasons do not cover the package validity dates is not added on a
     silent uplift. The add parks here, the operator sees which season is standing in
     and for how long, and the percentage that line is then protected at is typed into
     the same dialog. Settings keeps its own figure; this one applies to the line. */
  const [seasonPrompt, setSeasonPrompt] = useState(null);
  const [lastSaved, setLastSaved] = useState('');
  const [exportDialog, setExportDialog] = useState(false);
  /* The export audience is one of three, never a fallback from one into another: the
     document for an assigned partner at their markup, a one-off markup for anyone who is
     not a partner, or the internal (STO) master at contract cost. The Presentation pricing
     summary is now the document's only pricing section, so it is on by default. */
  const [exportOptions, setExportOptions] = useState({ cover: true, inclusions: true, terms: true, explainPricing: false, showVehicleOptions: false, audience: 'partner', markup: '', includePricingSummary: true });
  const [exportFormat, setExportFormat] = useState('pdf');
  /* The language the exported document is written in. English is the default and
     the only choice an English-only tenant gets, so the export dialog shows no
     language group at all until a second language is switched on. */
  const [exportLang, setExportLang] = useState(SOURCE_LANGUAGE);
  /* The company's own itinerary wording, kept as a row so a package that inherits
     it can also inherit its translations. */
  const [companyTerms, setCompanyTerms] = useState(null);
  /* The grid lives above the tabs so the working Pricing & seasons grid and the client-facing
     Presentation pricing read one and the same set of columns and bands. The presentation never
     edits it. The columns seed from the vehicle_columns chosen on the Packages list when the
     package was created; a package without any falls back to the first six vehicle sizes. */
  const grid = usePricingGrid(vehicleTypes, (pkg?.vehicle_columns || []).map(String));
  const [activeSeason, setActiveSeason] = useState(0);
  const [clientSelectOpen, setClientSelectOpen] = useState(false);
  const [clientQuery, setClientQuery] = useState('');
  /* The export flow assigns from its own picker rather than sending the operator to the
     Client tab first: choosing "Assign to partner" with nobody assigned opens this search,
     limited to travel agents, right on top of the export modal. */
  const [assignPickerOpen, setAssignPickerOpen] = useState(false);
  const [agentQuery, setAgentQuery] = useState('');
  const [packagePreviewOpen, setPackagePreviewOpen] = useState(false);

  /* Guide service detour: the pending add held while the operator picks which
     service types the guide accompanies, and the guide & driver detail (lunch /
     dinner / overnight lines) for an overland guide on one day. */
  const [guideModal, setGuideModal] = useState(null);
  const [guideDetailsModal, setGuideDetailsModal] = useState(null);

  /* Accommodation charge detour: the pending add held while the operator picks
     the charge type (and season) a multi-price property is booked on. */
  const [accomChargeModal, setAccomChargeModal] = useState(null);

  /* Car hire detour: the pending add held while the operator says where and when
     the car goes out and comes back, and which vehicle group fills it. The hire
     copy on the line is what every later read prices and prints from. */
  const [carRentalModal, setCarRentalModal] = useState(null);
  const [rentalColumnReady, setRentalColumnReady] = useState(false);
  /* A crew figure folded onto a line is carried in its own column. Until that
     migration is applied PostgREST is asked for no such column, so every other
     column still saves; the fold itself only lives for the session. */
  const [crewColumnReady, setCrewColumnReady] = useState(false);

  /* Which languages this operator writes content in. The prose editors show the
     tenant's own list, narrowed by the text_i18n column actually existing on
     both prose tables: until the migration is applied, a package or a day sends
     no translation key and no language box appears that cannot be stored. */
  const tenantLanguages = useTenantLanguages();
  const [textColumnsReady, setTextColumnsReady] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([textI18nColumn('packages'), textI18nColumn('package_days')])
      .then(([packageReady, dayReady]) => { if (active) setTextColumnsReady(packageReady && dayReady); });
    return () => { active = false; };
  }, []);
  const contentLanguages = textColumnsReady ? tenantLanguages : [SOURCE_LANGUAGE];
  const canStoreTranslations = contentLanguages.length > 1;

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

      /* Whether this database can store the per-season single-room override. A
         probe against the optional column fails when it is absent; the save
         then keeps writing the party-size heuristic instead. */
      try {
        const { error } = await supabase.from('package_validity_periods').select('single_rooms').limit(1);
        setDbFeatures({ singleRooms: !error });
      } catch {
        // Probe unavailable; keep the override off.
      }
      /* Whether package lines can record the room type they were sold as. Until
         the lodging migration is applied the columns are absent, and inserting
         them would fail the whole save. */
      try {
        const { error } = await supabase.from('package_day_items').select('room_type_id').limit(1);
        setDbFeatures((current) => ({ ...current, roomTypes: !error }));
      } catch {
        // Probe unavailable; keep room types off.
      }
      /* Whether a package line can carry the hire copy. Until that migration is
         applied, the drop still prices - the answer simply lives in the line's
         own snapshot rather than in a column of its own. */
      setRentalColumnReady(await rentalDetailsColumn('package_day_items'));
      setCrewColumnReady(await crewShareColumn('package_day_items'));
      /* A package with no terms of its own borrows the company's, so the company
         row is read with its translations too - but only once the column exists,
         because naming a column the workspace has not migrated yet would fail the
         whole load, not just the wording. */
      const billingHasText = await textI18nColumn('company_billing_settings');

      const [pkgRes, dayRes, periodRes, paxRes, billingRes, vehicleTypesRes] = await Promise.all([
        supabase.from('packages').select('*').eq('id', packageId).eq('company_id', profile.company_id).single(),
        supabase.from('package_days').select('*').eq('package_id', packageId).order('day_number'),
        supabase.from('package_validity_periods').select('*').eq('package_id', packageId).order('valid_from'),
        supabase.from('package_pax_options').select('*').eq('package_id', packageId).order('pax'),
        supabase.from('company_billing_settings').select(`itinerary_terms, price_protection_percent${billingHasText ? ', text_i18n' : ''}`).eq('company_id', profile.company_id).maybeSingle(),
        supabase.from('company_vehicle_types').select('*').eq('company_id', profile.company_id).order('max_capacity')
      ]);
      for (const result of [pkgRes, dayRes, periodRes, paxRes, billingRes, vehicleTypesRes]) {
        if (result.error) throw result.error;
      }
      setCompanyTerms(billingRes.data || null);
      const dayIds = (dayRes.data || []).map((day) => day.id);
      const itemRes = dayIds.length
        ? await supabase.from('package_day_items').select('*').in('package_day_id', dayIds).order('sort_order')
        : { data: [], error: null };
      if (itemRes.error) throw itemRes.error;
      const itemsByDay = new Map();
      (itemRes.data || []).forEach((item) => {
        /* The hire copy is read back under the name the builder uses for it, so a
           saved rent-a-car line still names its car, band and 24-hour blocks after
           a reload. */
        itemsByDay.set(item.package_day_id, [
          ...(itemsByDay.get(item.package_day_id) || []),
          { ...item, rental: item.rental_details || null }
        ]);
      });
      const loadedDays = (dayRes.data || []).map((day) => ({
        ...day,
        services: itemsByDay.get(day.id) || []
      }));
      let loadedClients = [];
      let assignedClientIds = [];
      const [clientsRes, assignmentsRes] = await Promise.all([
        supabase.from('clients').select('id, name, markup_percentage, client_type').eq('company_id', profile.company_id).order('name'),
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
        textI18n: translationsOf(pkgRes.data),
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
      setPeriods((periodRes.data || []).map(({ valid_from, valid_to, name, accommodation_per_person, single_supplement, single_rooms }) => ({ valid_from, valid_to, name, accommodation_per_person, single_supplement, single_rooms })));
      setPaxOptions(paxRes.data || []);
      setVehicleTypes((vehicleTypesRes.data || []).filter(Boolean));
      setClients(loadedClients);
      setSelectedDay(0);
      setLastSaved(JSON.stringify({
        form: packageForm,
        days: loadedDays,
        periods: (periodRes.data || []).map(({ valid_from, valid_to, name, accommodation_per_person, single_supplement, single_rooms }) => ({ valid_from, valid_to, name, accommodation_per_person, single_supplement, single_rooms })),
        paxOptions: paxRes.data || []
      }));

      const usedIds = [...new Set((itemRes.data || []).map((item) => item.item_id).filter(Boolean))];
      if (usedIds.length) {
        const [itemsRes, ratesRes] = await Promise.all([
          selectLibraryItems((fields) => supabase.from('library_items').select(fields).in('id', usedIds)),
          supabase.from('item_rates').select('*').in('item_id', usedIds)
        ]);
        if (itemsRes.error) throw itemsRes.error;
        if (ratesRes.error) throw ratesRes.error;
        const supplierIds = [...new Set((itemsRes.data || []).map((item) => item.supplier_id).filter(Boolean))];
        const suppliersRes = supplierIds.length
          ? await supabase.from('suppliers').select(await supplierColumns('id, name')).in('id', supplierIds)
          : { data: [], error: null };
        if (suppliersRes.error) throw suppliersRes.error;
        const supplierNames = new Map((suppliersRes.data || []).map((supplier) => [supplier.id, supplier.name]));
        const supplierStars = new Map((suppliersRes.data || []).map((supplier) => [supplier.id, supplier.star_rating]));
        const roomsByItem = await fetchRoomTypesForItems(usedIds);
        const carRatesByItem = await fetchCarRentalRates(usedIds);
        setLibrary((itemsRes.data || []).map((item) => ({
          ...item,
          supplier_name: supplierNames.get(item.supplier_id) || '',
          supplier_star_rating: supplierStars.get(item.supplier_id) || null,
          room_types: roomsByItem.get(item.id) || [],
          car_rental_rates: carRatesByItem[item.id] || [],
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
      const { destinations, error } = await fetchDestinationCatalog(companyId);
      if (error) {
        showToast(`Could not load package destination filters: ${error.message}`, 'error');
        return;
      }
      if (active) setDestinationCatalog(destinations);
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
        const destinations = destinationClause(destinationFilters);
        const { data, error } = await selectLibraryItems((fields) => {
          let query = supabase.from('library_items').select(fields)
            .eq('company_id', companyId).eq('is_active', true);
          if (categoryFilter) query = query.eq('category', categoryFilter);
          if (term.length >= 2) query = query.or(`name.ilike.%${safe}%,description.ilike.%${safe}%,destination_region.ilike.%${safe}%,destination_area.ilike.%${safe}%,location.ilike.%${safe}%`);
          /* Filtered on the server, because the search only ever brings back a
             page of items — narrowing that page locally would hide islands that
             are contracted but happened to fall past the limit. */
          if (destinations) query = query.or(destinations);
          return query.order('name').limit(50);
        });
        if (error) throw error;
        const ids = (data || []).map((item) => item.id);
        const suppliers = [...new Set((data || []).map((item) => item.supplier_id).filter(Boolean))];
        const [ratesRes, suppliersRes] = await Promise.all([
          ids.length ? supabase.from('item_rates').select('*').in('item_id', ids) : { data: [], error: null },
          suppliers.length ? supabase.from('suppliers').select(await supplierColumns('id, name')).in('id', suppliers) : { data: [], error: null }
        ]);
        if (ratesRes.error) throw ratesRes.error;
        if (suppliersRes.error) throw suppliersRes.error;
        const supplierNames = new Map((suppliersRes.data || []).map((supplier) => [supplier.id, supplier.name]));
        const supplierStars = new Map((suppliersRes.data || []).map((supplier) => [supplier.id, supplier.star_rating]));
        const roomsByItem = await fetchRoomTypesForItems(ids);
        const carRatesByItem = await fetchCarRentalRates(ids);
        const merged = (data || []).map((item) => ({
          ...item,
          supplier_name: supplierNames.get(item.supplier_id) || '',
          supplier_star_rating: supplierStars.get(item.supplier_id) || null,
          room_types: roomsByItem.get(item.id) || [],
          car_rental_rates: carRatesByItem[item.id] || [],
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
  }, [search, categoryFilter, destinationFilters, companyId, showToast]);

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
    if (!matchesDestinations(item, destinationFilters)) return false;
    /* An item with no rate in the package's currency cannot be priced into this package at
       all, so it is hidden rather than listed as unavailable: with one currency per package
       it is clutter, not information. Before the first service is added there is no currency
       yet, and everything stays visible so the first pick can set it. */
    if (packageCurrency && !isCarRentalItem(item) && !(item.item_rates || []).some((entry) => currencyMatches(entry, packageCurrency))) return false;
    return true;
  }), [results, destinationFilters, packageCurrency]);

  const selectedClients = useMemo(() => clients.filter((client) => form.assignedClientIds.includes(client.id)), [clients, form.assignedClientIds]);
  const visibleClients = useMemo(() => {
    const term = clientQuery.trim().toLowerCase();
    return clients.filter((client) => !term || nameOf(client).toLowerCase().includes(term));
  }, [clients, clientQuery]);
  /* A package is only ever assigned to a travel agent, so the export picker lists those and
     leaves direct clients out. */
  const visibleAgents = useMemo(() => {
    const term = agentQuery.trim().toLowerCase();
    return clients
      .filter((client) => client.client_type === 'Travel Agency')
      .filter((client) => !term || nameOf(client).toLowerCase().includes(term));
  }, [clients, agentQuery]);

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

  /* Maximum capacity guard (mirrors the itinerary builder): a band wider than the largest
     vehicle priced for it cannot be served. The same message the pricing maths produces is
     raised as an alert, pointing at the two ways out - a bigger vehicle size in the package's
     drop down, or the vehicle capacity set when the package was created. The alert is a toast
     and nothing else: it never blocks a save and it never sits on the band, because a package
     is saved as it stands and the operator is told what to look at. Re-raising is keyed on the
     message set, so typing notes or a clean load does not nag.

     The bands checked here are the package's own saved party sizes. The minimum of two
     travellers is a rule for the working grid, so a band that was saved with fewer (a legacy
     row, or a party of one) keeps its own size and is judged on its own merits. */
  const bandCapacityAlertsRef = useRef('');
  useEffect(() => {
    if (!days.length || !mergedBands.length) {
      bandCapacityAlertsRef.current = '';
      return;
    }
    const messages = mergedBands
      .map((band) => packageBandCapacityError(days, library, band))
      .filter(Boolean);
    const key = messages.join('|');
    if (key && key !== bandCapacityAlertsRef.current) {
      messages.slice(0, 3).forEach((message) => showToast(
        `${message} Pick a bigger vehicle size that seats the whole band, either from the vehicle drop down in the package or by choosing a larger vehicle when the package was created.`,
        'warning'
      ));
    }
    bandCapacityAlertsRef.current = key;
  }, [days, library, mergedBands, showToast]);

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
       message is collected so the operator is told exactly what was protected. A hire
       is not in that question at all: it has no season, and its tariff window was
       tested against the pick-up date when the line was recorded. */
    const seasonProblem = nextDays.flatMap((day) => day.services || [])
      .filter((service) => !service.rental)
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
        ...textI18nPayload(canStoreTranslations, nextForm.textI18n),
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
          package_id: pkg.id, company_id: companyId, day_number: dayIndex + 1, notes: day.notes || null,
          /* The day's own prose travels with it in every language the operator has
             written it in; an English-only tenant sends no key at all. */
          ...textI18nPayload(canStoreTranslations, day.text_i18n)
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
          ...(dbFeatures.roomTypes ? {
            room_type_id: service.room_type_id || null,
            room_type: service.room_type || null
          } : {}),
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
          guide_charge_type: service.guide_charge_type || null,
          /* The hire's own answer, so a saved package keeps the car, the band and
             the 24-hour blocks it was quoted on. Only written once the column exists. */
          ...(rentalColumnReady && service.rental ? { rental_details: service.rental } : {}),
          /* The crew place this line buys and the party shares, so a reloaded
             package re-shares the same sum over its bands. */
          ...(crewColumnReady && service.crew_share ? { crew_share: service.crew_share } : {})
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
            single_supplement: period.single_supplement ?? 0,
            ...(dbFeatures.singleRooms ? { single_rooms: period.single_rooms ?? null } : {})
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
      /* The season keeps the figure the row holds: the column is NOT NULL with a default of
         zero, so a blank field is stored as zero rather than null. Zero reads as "no override"
         everywhere (the figure is derived from the accommodation instead), which is what the
         operator meant by clearing the field. */
      const savedPeriods = validPeriods.map(({ valid_from, valid_to, name, accommodation_per_person, single_supplement, single_rooms }) => ({
        valid_from,
        valid_to,
        name,
        accommodation_per_person,
        single_supplement: single_supplement ?? 0,
        single_rooms: dbFeatures.singleRooms ? (single_rooms ?? null) : null
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
  }, [companyId, pkg, days, periods, mergedBands, form, library, autoRoomsFor, protectionPercent, packageCurrency, grid.usedCodes, dbFeatures.singleRooms, dbFeatures.roomTypes, rentalColumnReady, crewColumnReady, canStoreTranslations, showToast]);

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

  /* The percentage a package line is priced at. A line that was dropped with its
     own answer in the add dialog - or one saved unprotected at zero - keeps that
     figure; only a line with no percentage of its own follows today's Settings.
     This is the same rule the itinerary builder prices its lines by. An item joins
     the package on a season that spans the package validity dates; when none does,
     the add is confirmed first, and the percentage agreed in that dialog is the one
     the line is priced at. */
  const effectiveProtectionPercent = (scope = {}) => {
    if (typeof scope.agreedProtectionPercent === 'number') return Math.max(0, scope.agreedProtectionPercent);
    const stored = scope.service?.price_protection_percent;
    if (stored !== undefined && stored !== null) return Math.max(0, Number(stored) || 0);
    return protectionPercent;
  };
  const seasonFor = (item, rate, scope = {}) => packageSeasonResolution({
    item, rate, periods, currencyCode: rate?.currency || item?.currency || '', protectionPercent: effectiveProtectionPercent(scope)
  });
  /* The row a line is stored with: whichever season the resolver actually priced
     from. A protected line carries its uplifted snapshot; a stale one carries the
     old row whole, so reading the line back names the season it was charged from
     instead of the first row the currency happened to return. */
  const seasonStoredRate = (season, fallbackRate) => (season.status === 'protected' || season.status === 'stale') && season.rate
    ? season.rate
    : fallbackRate;
  /* A season standing in for one that does not cover the package is said out
     loud, whether it arrived with the protection uplift or with none. */
  const seasonToastKind = (season) => (season.status === 'protected' || season.status === 'stale' ? 'warning' : 'info');
  /* A hire is not priced from a contract rate row. It is priced from the vehicle
     group's rental-length band, multiplied by the whole 24-hour blocks between the
     two ends of the hire. So it never reaches the rate and season guards below, and
     its money is held on the line as a snapshot the same way a protected line holds
     its uplifted row. The car and the hire desk's paperwork fee are two lines: a
     client reading the quote asks what the agreement cost, and a day that quietly
     carries it answers nothing. */
  const rentalService = (item, rentalCopy, currency, scope = {}, name = '') => {
    const amount = rentalLineBuyTotal(rentalCopy);
    return {
      item_key: uuid(),
      item_id: item.id,
      /* No rate id: the package line's rate_id carries a foreign key to item_rates,
         and a hire's band lives in car_rental_rates. The copy on the line is the
         contract the price came from. */
      rate_id: null,
      item_name: name || item.name,
      category: item.category || '',
      supplier_name: item.supplier_name || '',
      supplier_star_rating: starRatingOf(item.supplier_star_rating),
      currency_code: currency,
      rate_basis: 'per_trip',
      unit_cost: amount,
      unit_price: amount,
      quantity: 1,
      is_included: true,
      vehicle_capacity: rentalCopy.passengers || 0,
      rental: rentalCopy,
      tier_key: scope.tier_key || null,
      replaces_item_key: scope.replaces_item_key || null,
      rate_snapshot: rentalPackageRate(rentalCopy, currency, amount),
      price_protection_percent: 0,
      protected_season_name: '',
      guide_service_types: null,
      guide_only: false,
      guide_for_item_key: null,
      guide_charge_type: null
    };
  };
  const addRentalService = (item, details, dayIndex, scope = {}) => {
    const currency = details.currency || item.currency || packageCurrency;
    if (String(currency).toUpperCase() !== String(packageCurrency).toUpperCase()) {
      showToast(`This package is priced in ${packageCurrency}. ${item.name} only has a ${currency} hire tariff, which would make the package total meaningless.`, 'warning');
      return;
    }
    const feeDetails = rentalFeeDetails(details);
    /* One line per 24-hour cycle, on the day it bills — the same rule the
       itinerary lays a hire with, so a package and an itinerary built from one
       contract read the same way day by day. A package day carries no date, so
       the season's own start counts which day the car left the yard; a package
       with no days yet gets everything on its first day. */
    const { lines, carried, reason } = rentalDayPlacement({
      details,
      startDayIndex: rentalCollectionDayIndex({
        details,
        days,
        travelStart: periods[0]?.valid_from || '',
        fallbackDayIndex: dayIndex
      }),
      itineraryDays: days.length || 1
    });
    if (!lines.length) {
      showToast(reason, 'warning');
      return;
    }
    const perDay = new Map();
    const push = (index, rentalCopy, name = '') => {
      perDay.set(index, [...(perDay.get(index) || []), rentalService(item, rentalCopy, currency, scope, name)]);
    };
    lines.forEach((line) => push(line.dayIndex, rentalDayDetails(details, line.share)));
    /* The paperwork is the hire desk's charge for the agreement, not a day of it,
       so it sits beside the cycle the car is collected on. */
    if (feeDetails) push(lines[0].dayIndex, feeDetails, rentalFeeLineLabel(feeDetails));
    const feeWords = feeDetails
      ? `, with the ${currency} ${Number(details.contractFee).toFixed(2)} rental contract fee on a line of its own`
      : '';
    const overrun = carried > 0
      ? ` The hire has more 24-hour cycles than the package has days, so its last day bills the ${carried} extra${carried === 1 ? '' : ' cycle'}. The desk charges for every cycle either way — add days if you want each cycle on one of its own.`
      : '';
    showToast(`${item.name} — ${rentalSummaryLabel(details)}: ${lines.length} day${lines.length === 1 ? '' : 's'} at ${currency} ${Number(details.dailyRate || 0).toFixed(2)} per day${feeWords}.${overrun}`, 'success');
    setDays((previous) => {
      if (!previous.length) {
        return [{ day_number: 1, notes: '', text_i18n: null, services: [...(perDay.get(0) || [])] }];
      }
      return previous.map((day, index) => (
        perDay.has(index) ? { ...day, services: [...day.services, ...perDay.get(index)] } : day
      ));
    });
  };
  /* The hire copy a line is re-priced from after "update from library": the same
     group, the same 24-hour blocks and the pick-up date that chose the tariff, read
     off the line rather than guessed at. */
  const rentalRefresh = (item, rental) => {
    const days = rentalDayCount(rental.pickupAt, rental.returnAt) || Number(rental.rentalDays) || 0;
    const wanted = [rental.vehicleGroup, rental.vehicleModel, rental.contractType].join('|');
    const choice = carRentalGroupChoices(item, { days, pickupAt: rental.pickupAt, pax: 0 })
      .find((entry) => entry.group.key === wanted);
    if (!choice) return { error: `${item.name} no longer has the ${rentalVehicleLabel(rental)} group, so this hire cannot be refreshed. Re-record the hire instead.` };
    if (choice.unusable) return { error: choice.validity || choice.error || `${rentalVehicleLabel(rental)} no longer prices ${days} rental days, so this hire cannot be refreshed.` };
    const fee = Number(item.rental_contract_fee);
    const details = buildRentalDetails({
      item,
      group: choice.group,
      season: choice.season,
      band: choice.band,
      days,
      pickupAt: rental.pickupAt,
      returnAt: rental.returnAt,
      pickupLocation: rental.pickupLocation,
      returnLocation: rental.returnLocation,
      sameReturn: rental.sameReturn !== false,
      contractFee: Number.isFinite(fee) && fee > 0 ? fee : 0
    });
    /* A line carrying one day of a hire spread across the trip keeps that day's
       block after a refresh: the new tariff is read off the new ladder by the same
       ordinal, so re-locking a rate cannot turn a day back into the whole
       contract. */
    if (isRentalFeeLine(rental)) return { details: rentalFeeDetails(details) };
    const shareOfDay = rental.dayShare
      ? (rentalDayShares(details)[Number(rental.dayShare.ordinal) - 1] || null)
      : null;
    return { details: rentalDayDetails(details, shareOfDay) };
  };
  const addService = (item, rateId, dayIndex = selectedDay, scope = {}) => {
    /* The hire is asked for before anything else, because none of the rate, currency
       or season guards below have anything to say about a car. */
    if (isCarRentalItem(item)) {
      if (scope.rentalDetails) {
        addRentalService(item, scope.rentalDetails, dayIndex, scope);
        return;
      }
      setCarRentalModal({ item, dayIndex, scope });
      return;
    }
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
    const season = seasonFor(item, rate, scope);
    if (!season.canAdd) {
      showToast(season.message, 'warning');
      return;
    }
    /* No season covers the package dates, so this line would be charged from a
       substitute. Ask before it lands, with the percentage to protect it at in the
       same dialog, and re-enter the add with that answer. */
    if (season.status === 'protected' || season.status === 'stale') {
      setSeasonPrompt({
        item,
        rateId: rate.id,
        dayIndex,
        scope,
        season,
        protectionPercent: season.protectionPercent || protectionPercent || 0,
        onAccept: (pct) => addService(item, rate.id, dayIndex, { ...scope, agreedProtectionPercent: pct })
      });
      return;
    }
    /* The stored rate is the season the resolver priced from, so every later read
       of this line uses that figure rather than re-deriving another row. */
    const storedRate = seasonStoredRate(season, rate);
    const unitCost = Number(storedRate.unit_cost) || Number(storedRate.price_1_adult) || Number(storedRate.unit_price) || 0;
    const isStayItem = /accommodation/i.test(String(item.category || ''));
    /* The room this line is sold as. A property with several room types prices
       and sleeps differently per room, so the room chosen in the charge dialog
       rides on the line: its name prints on the document and its capacity sizes
       the room count. */
    const roomTypeId = scope.roomTypeId || storedRate.room_type_id || null;
    const roomTypeName = scope.roomType || storedRate.room_type || '';
    const roomMaxOccupancy = isStayItem
      ? (Number(scope.roomMaxOccupancy) || Number(storedRate.room_max_occupancy) || 0)
      : 0;
    /* A guide line prices the flat per-trip sum of the chosen service types. The
       guide's own contract figure (unit_cost / price_1_adult) is 0, so the line
       is built from the selected survey rates and stored so it survives a reload. */
    const guideTypes = isGuideItem(item) ? (scope.guideServiceTypes || []) : [];
    const guideTotal = guideTypes.length ? guideChargeTotal(storedRate, guideTypes) : null;
    /* A crew figure on this item's own rate row — the guide's seat on a flight, the
       guide's place on a tour — is bought with the clients' ticket and shared by the
       party. A package states no crew roster, so one place is bought and each band
       splits its own party over it; the fare itself lives on the line, never in
       unit_cost, which stays the price of one client's place. */
    const crewCharge = guideTotal === null && !isStayItem
      ? crewChargeOf(item, storedRate, {
        perCharter: String(rate.rate_basis || item.pricing_model || '').toLowerCase() === 'per_vehicle'
      })
      : null;
    const service = {
      item_key: uuid(),
      item_id: item.id,      rate_id: rate.id,
      item_name: item.name,
      category: item.category || '',
      supplier_name: item.supplier_name || '',
      supplier_star_rating: starRatingOf(item.supplier_star_rating),
      currency_code: rate.currency || item.currency || 'ZAR',
      rate_basis: guideTotal !== null ? 'per_trip' : (rate.rate_basis || item.pricing_model || 'per_person'),
      unit_cost: guideTotal !== null ? guideTotal : unitCost,
      unit_price: guideTotal !== null ? guideTotal : unitCost,
      quantity: isStayItem
        ? accommodationRoomPlan({ ...item, rate_id: rate.id, rate_snapshot: storedRate, room_max_occupancy: roomMaxOccupancy || null }, item, autoPattern).roomCount
        : 1,
      is_included: true,
      vehicle_capacity: roomMaxOccupancy || Number(item.max_occupancy) || Number(rate.max_occupancy) || 0,
      room_type_id: roomTypeId,
      room_type: roomTypeName,
      /* A band scope on the itinerary tab makes this line belong to that band alone, which
         is how a band gets an extra excursion without every other band paying for it. */
      tier_key: scope.tier_key || null,
      replaces_item_key: scope.replaces_item_key || null,
      rate_snapshot: storedRate,
      crew_share: crewCharge ? { ...crewCharge, divisor: null } : null,
      price_protection_percent: season.protectionPercent || 0,
      protected_season_name: season.status === 'protected' ? season.seasonName : '',
      guide_service_types: guideTotal !== null ? guideTypes : null,
      guide_only: false,
      guide_for_item_key: null,
      guide_charge_type: null
    };
    if (season.message) showToast(season.message, seasonToastKind(season));
    setDays((previous) => {
      if (!previous.length) return [{ day_number: 1, notes: '', text_i18n: null, services: [service] }];
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
    /* The driver's copy of a meal is the same item at another price, so the
       guide's line is what the picker holds. Lunch and dinner are looked for
       separately, so a guide fed both ways comes back with both restored. */
    const guideMeals = details.filter((service) => (
      /meal/i.test(String(service.category || ''))
      && (service.guide_charge_type || 'guide') !== 'driver'
    ));
    const mealOccasion = (service) => String(
      (library.find((entry) => entry.id === service.item_id) || {}).meal_type
      || service.item_name
      || ''
    ).toLowerCase();
    const pickMeal = (occasion) => (guideMeals.find((service) => mealOccasion(service).includes(occasion)) || {}).item_id || '';
    const overnights = details.filter((service) => {
      const cat = String(service.category || '');
      return /accommodation/i.test(cat);
    });
    const chargeTypes = overnights.map((service) => service.guide_charge_type || 'guide');
    return {
      lunchItemId: pickMeal('lunch'),
      dinnerItemId: pickMeal('dinner'),
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
    addService(pending.item, choice.rateId, pending.dayIndex, {
      ...pending.scope,
      accommodationChargeChosen: true,
      roomTypeId: choice.roomTypeId || null,
      roomType: choice.roomType || '',
      roomMaxOccupancy: choice.roomMaxOccupancy || 0
    });
  };

  /* The hire dialog's answer. A new drop builds its lines from the copy; an edit
     keeps each line's identity - and any band that points at it - and re-prices the
     day it was opened on. Only that day: a hire is on every day it covers so the
     consultant can answer for each one, and re-recording one of them must not
     rewrite the days nobody looked at. */
  const confirmCarRental = (details) => {
    const pending = carRentalModal;
    if (!pending) return;
    setCarRentalModal(null);
    if (pending.via === 'edit') {
      const current = days[pending.dayIndex]?.services?.[pending.serviceIndex];
      if (!current?.rental) return;
      const currency = details.currency || current.currency_code || packageCurrency;
      const feeDetails = rentalFeeDetails(details);
      const priced = (service, rentalCopy, name = '') => ({
        ...service,
        item_name: name || service.item_name,
        currency_code: currency,
        unit_cost: rentalLineBuyTotal(rentalCopy),
        unit_price: rentalLineBuyTotal(rentalCopy),
        vehicle_capacity: details.passengers || 0,
        rental: rentalCopy,
        rate_snapshot: rentalPackageRate(rentalCopy, currency, rentalLineBuyTotal(rentalCopy))
      });
      /* The lines on this day that tell the same hire: the same two stamps, the same
         vehicle and the same contract, because package days have no group column to
         answer with. */
      const sameHire = (service) => Boolean(service?.rental)
        && service.rental.pickupAt === current.rental.pickupAt
        && service.rental.returnAt === current.rental.returnAt
        && service.rental.vehicleGroup === current.rental.vehicleGroup
        && service.rental.contractType === current.rental.contractType;
      const here = (days[pending.dayIndex]?.services || []).filter(sameHire);
      const elsewhere = days.reduce((count, day, index) => (
        index === pending.dayIndex ? count : count + (day.services || []).filter(sameHire).length
      ), 0);
      const blocks = here.filter((service) => !isRentalFeeLine(service.rental));
      const feeLines = here.filter((service) => isRentalFeeLine(service.rental));
      const shares = rentalDayShares(details);
      const patches = new Map();
      const gone = [];
      let dayCarTotal = 0;
      /* Each line keeps its own day of the new contract. A line past the end of a
         shortened hire is the hire leaving this day, so it comes off. */
      blocks.forEach((service) => {
        const ordinal = Number(service.rental?.dayShare?.ordinal) || 0;
        if (!ordinal) {
          dayCarTotal = carRentalHireTotal(details);
          patches.set(service.item_key, priced(service, details));
          return;
        }
        const share = shares[ordinal - 1];
        if (!share) { gone.push(service.item_key); return; }
        dayCarTotal += share.buyTotal;
        patches.set(service.item_key, priced(service, rentalDayDetails(details, share)));
      });
      /* The paperwork belongs to the day the hire starts, so it is answered here only
         when this is that day. */
      const startsHere = blocks.some((service) => (
        !gone.includes(service.item_key)
        && (Number(service.rental?.dayShare?.ordinal) || 0) <= 1
      ));
      const feeHere = Boolean(feeDetails) && startsHere;
      if (feeDetails) {
        feeLines.forEach((service) => patches.set(
          service.item_key,
          priced(service, feeDetails, rentalFeeLineLabel(feeDetails))
        ));
      } else {
        feeLines.forEach((service) => gone.push(service.item_key));
      }
      setDays((previous) => previous.map((day, index) => {
        if (index !== pending.dayIndex) return day;
        const services = (day.services || [])
          .filter((service) => !gone.includes(service.item_key))
          .map((service) => patches.get(service.item_key) || service);
        if (feeHere && !feeLines.length) {
          services.push(rentalService(pending.item, feeDetails, currency, {}, rentalFeeLineLabel(feeDetails)));
        }
        return { ...day, services };
      }));
      const droppedWords = gone.length
        ? ` This day is past the end of the re-recorded hire, so its ${gone.length} line${gone.length === 1 ? '' : 's'} came off.`
        : '';
      const siblings = elsewhere
        ? ` The hire's ${elsewhere} other line${elsewhere === 1 ? '' : 's'} on the other days keep the figures they were given — re-record each day you want changed.`
        : '';
      /* What is said back is what this day was given: a day holding the car tells
         its own block, a day holding only the paperwork tells the fee. */
      const pricedWords = [
        dayCarTotal ? `this day's car at ${currency} ${dayCarTotal.toFixed(2)}` : '',
        feeDetails && (feeLines.length || feeHere)
          ? `its contract fee at ${currency} ${Number(details.contractFee).toFixed(2)}`
          : ''
      ].filter(Boolean).join(' and ');
      showToast(
        `${rentalSummaryLabel(details)} — ${pricedWords ? `re-priced: ${pricedWords}` : 'this day no longer carries the hire'}.${droppedWords}${siblings}`,
        gone.length ? 'warning' : 'success'
      );
      return;
    }
    addService(pending.item, null, pending.dayIndex, { ...pending.scope, rentalDetails: details });
  };

  const openCarRentalEdit = (dayIndex, serviceIndex) => {
    const service = days[dayIndex]?.services?.[serviceIndex];
    if (!service) return;
    const item = library.find((entry) => entry.id === service.item_id)
      || results.find((entry) => entry.id === service.item_id);
    if (!item) {
      showToast(`${service.item_name} is no longer in the library, so there is nothing to re-record the hire against.`, 'warning');
      return;
    }
    setCarRentalModal({ item, dayIndex, serviceIndex, via: 'edit', details: service.rental || null });
  };

  const cancelCarRental = () => setCarRentalModal(null);

  const applyGuideDetails = (dayIndex, guideKey, plan) => {
    const day = days[dayIndex];
    if (!day) return;
    const guideService = (day.services || []).find((service) => service.item_key === guideKey);
    /* Re-applying replaces the existing detail lines so reopening the dialog never
       stacks a second lunch on top of the first. Every answer is an ARRAY of
       lines — a meal the driver is flagged on writes a guide line and a driver
       line, an overnight one per charged party — and each carries who it charges
       (guide_charge_type) so the dialog reopens with the same choice. */
    const linesOf = (value) => (Array.isArray(value) ? value : value ? [value] : []);
    const lines = [
      ...linesOf(plan.lunch),
      ...linesOf(plan.dinner),
      ...linesOf(plan.overnight)
    ]
      .filter(Boolean)
      .map((detail) => {
        const item = detail.item;
        return {
          item_key: uuid(),
          item_id: item.id,
          rate_id: (item.item_rates || [])[0]?.id || null,
          /* Two parties eating the same meal are two prices, so the driver's copy
             says whose it is instead of reading as a duplicate line. */
          item_name: detail.who === 'driver' ? `${item.name} (driver)` : item.name,
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
             checkbox governs the meal lines, whoever eats them. */
          guide_only: detail.forced === true ? true : plan.guideOnly,
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
      if (season.message) showToast(season.message, seasonToastKind(season));
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
        const storedRate = seasonStoredRate(season, rate);
        const guideTypes = Array.isArray(service.guide_service_types) ? service.guide_service_types : [];
        const guideTotal = guideTypes.length ? guideChargeTotal(storedRate, guideTypes) : null;
        const unitCost = guideTotal !== null
          ? guideTotal
          : (Number(storedRate.unit_cost) || Number(storedRate.price_1_adult) || Number(storedRate.unit_price) || 0);
        /* The crew place this line already buys re-prices off the new season, the
           same way the clients' fare does; a fold is never added to a line that
           was quoted without one. */
        const crew = refreshCrewShare(crewShareOn(service), storedRate, {
          perCharter: String(rate.rate_basis || item.pricing_model || '').toLowerCase() === 'per_vehicle'
        });
        return {
          ...service,
          rate_id: rate.id,
          rate_basis: guideTotal !== null ? 'per_trip' : (rate.rate_basis || item.pricing_model || service.rate_basis),
          currency_code: rate.currency || item.currency || service.currency_code,
          unit_cost: unitCost,
          unit_price: unitCost,
          quantity: isStay(service)
            ? accommodationRoomPlan({ ...item, rate_id: rate.id, rate_snapshot: storedRate }, item, autoPattern).roomCount
            : service.quantity,
          vehicle_capacity: Number(rate.room_max_occupancy) || Number(item.max_occupancy) || Number(rate.max_occupancy) || service.vehicle_capacity || 0,
          ...(isStay(service) ? { room_type_id: rate.room_type_id || null, room_type: rate.room_type || '' } : {}),
          ...(crew ? { crew_share: crew } : {}),
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
        /* A hire refreshes from its own tariff: the same group, the same 24-hour
           blocks and the same pick-up date, read against the contract as it stands
           today. There is no item_rates row for a car, so the rate path below would
           have nothing to find. */
        if (service.rental || isCarRentalItem(item)) {
          if (!service.rental) {
            showToast(`${service.item_name} carries no hire copy, so there is nothing to refresh. Record the hire on the line instead.`, 'warning');
            return service;
          }
          const refreshed = rentalRefresh(item, service.rental);
          if (refreshed.error) {
            showToast(refreshed.error, 'warning');
            return service;
          }
          const hireTotal = rentalLineBuyTotal(refreshed.details);
          const currency = refreshed.details.currency || service.currency_code || packageCurrency;
          showToast(`${service.item_name} refreshed: ${rentalSummaryLabel(refreshed.details)} at ${currency} ${hireTotal.toFixed(2)}.`, 'success');
          return {
            ...service,
            currency_code: currency,
            unit_cost: hireTotal,
            unit_price: hireTotal,
            vehicle_capacity: refreshed.details.passengers || service.vehicle_capacity,
            rental: refreshed.details,
            rate_snapshot: rentalPackageRate(refreshed.details, currency)
          };
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
        const storedRate = seasonStoredRate(season, liveRate);
        const guideTypes = Array.isArray(service.guide_service_types) ? service.guide_service_types : [];
        const guideTotal = guideTypes.length ? guideChargeTotal(storedRate, guideTypes) : null;
        const unitCost = guideTotal !== null
          ? guideTotal
          : (Number(storedRate.unit_cost) || Number(storedRate.price_1_adult) || Number(storedRate.unit_price) || 0);
        const crew = refreshCrewShare(crewShareOn(service), storedRate, {
          perCharter: String(liveRate.rate_basis || item.pricing_model || '').toLowerCase() === 'per_vehicle'
        });
        if (season.message) showToast(season.message, seasonToastKind(season));
        return {
          ...service,
          rate_id: liveRate.id,
          rate_basis: guideTotal !== null ? 'per_trip' : (liveRate.rate_basis || item.pricing_model || service.rate_basis),
          currency_code: liveRate.currency || item.currency || service.currency_code,
          unit_cost: unitCost,
          unit_price: unitCost,
          quantity: isStay(service)
            ? accommodationRoomPlan({ ...item, rate_id: liveRate.id, rate_snapshot: storedRate }, item, autoPattern).roomCount
            : service.quantity,
          vehicle_capacity: Number(liveRate.room_max_occupancy) || Number(item.max_occupancy) || Number(liveRate.max_occupancy) || service.vehicle_capacity || 0,
          ...(isStay(service) ? { room_type_id: liveRate.room_type_id || null, room_type: liveRate.room_type || '' } : {}),
          ...(crew ? { crew_share: crew } : {}),
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
      const next = [...previous, { day_number: previous.length + 1, notes: '', text_i18n: null, services: [] }];
      setSelectedDay(next.length - 1);
      return next;
    });
  };

  const toggleDayMark = (dayIndex) => {
    setMarkedDayIndexes((prev) => (
      prev.includes(dayIndex) ? prev.filter((entry) => entry !== dayIndex) : [...prev, dayIndex]
    ));
    setBulkDeleteArmed(false);
  };

  const clearDayMarks = () => {
    setMarkedDayIndexes([]);
    setBulkDeleteArmed(false);
  };

  /* A package is often built by copying a longer one and taking the extra days
     out. One "Remove day" click per day is the whole job repeated, so the strip
     ticks the days and this lets them go together. */
  const deleteMarkedDays = () => {
    if (!bulkDeleteArmed) {
      setBulkDeleteArmed(true);
      return;
    }
    if (markedDayIndexes.length >= days.length) {
      showToast('A package needs at least one day', 'warning');
      setBulkDeleteArmed(false);
      return;
    }
    const doomed = days.filter((_, index) => markedDayIndexes.includes(index));
    const lines = doomed.reduce((count, day) => count + (day.services || []).length, 0);
    const next = days
      .filter((_, index) => !markedDayIndexes.includes(index))
      .map((day, index) => ({ ...day, day_number: index + 1 }));
    setDays(next);
    setSelectedDay((current) => Math.max(0, Math.min(current, next.length - 1)));
    clearDayMarks();
    showToast(`${doomed.length} day${doomed.length === 1 ? '' : 's'} deleted${lines ? `, with ${lines} service line${lines === 1 ? '' : 's'} on them` : ''}.`, 'success');
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
  /* Assignment decided in the export picker is written straight away for the same reason the
     child toggle is: the operator has chosen the partner and expects the package to hold it,
     not to depend on a later "Save package". The rest of the form is saved as it stands. */
  const assignClient = (clientId) => {
    const assignedClientIds = form.assignedClientIds.includes(clientId)
      ? form.assignedClientIds.filter((id) => id !== clientId)
      : [...form.assignedClientIds, clientId];
    const nextForm = { ...form, assignedClientIds };
    setForm(nextForm);
    persist(days, periods, mergedBands, nextForm);
  };
  /* Choosing "Assign to partner" with nobody assigned opens the travel-agent picker instead
     of silently exporting the contract cost. The audience still switches to 'partner' so the
     radio reads correctly once an agent is chosen. */
  const choosePartnerAudience = () => {
    setExportOptions((previous) => ({ ...previous, audience: 'partner' }));
    if (!selectedClients.length) setAssignPickerOpen(true);
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
  const accommodationPerPerson = activePeriod?.accommodation_per_person != null && activePeriod.accommodation_per_person !== 0
    ? Number(activePeriod.accommodation_per_person)
    : derivedAccommodation.total;
  /* The season's single supplement is derived from the accommodation's own contract the
     same way the per-person figure is, so the tab always shows a real number rather than a
     dash. It is a room charge, so only the accommodation lines contribute; every other line
     in the package is shared unit cost and carries no supplement. The season override, when
     set, still wins (D18). */
  const derivedSingleSupplement = useMemo(
    () => singleSupplementForSeason({
      days,
      library,
      from: activePeriod?.valid_from || null,
      to: activePeriod?.valid_to || null
    }),
    [days, library, activePeriod]
  );
  const hasSupplementOverride = activePeriod?.single_supplement != null && activePeriod.single_supplement !== 0;
  const singleSupplementForDisplay = hasSupplementOverride
    ? Number(activePeriod.single_supplement)
    : derivedSingleSupplement.total;

  const buildExportHtml = (options) => {
    /* The reader's language. Words come from the document dictionary, operator
       prose from the row's own translations, and a figure keeps the "ZAR 1 234.56"
       style this document already printed - only a translated language swaps in
       its own digit grouping, so an English export is byte-identical to the one
       it produced before any of this existed. */
    const lang = exportLang;
    const L = labelFor(lang);
    /* Escaped after the label is composed, and once. Anything dropped into a
       label arrives raw, so a currency code or a partner name carrying `&`
       prints a single `&amp;` rather than two. */
    const TL = (key, vars) => escapeHtml(L(key, vars));
    const amount = (value, code) => formatMoney(value, lang, { locale: 'en-ZA', min: 2, max: 2, prefix: `${code} ` });
    const prose = (field, value, block) => localizedText({ [field]: value, text_i18n: block }, field, lang);
    /* A package with no terms of its own borrows the company's itinerary wording,
       and it borrows that wording's translations with it: the company's block
       arrives under the package's own column name so one lookup answers both. */
    const companyTermsBlock = (() => {
      const block = translationsOf(companyTerms);
      const next = {};
      Object.entries(block || {}).forEach(([code, fields]) => {
        const text = fields && typeof fields === 'object' ? fields.itinerary_terms : '';
        if (typeof text === 'string' && text.trim()) next[code] = { terms_and_conditions: text };
      });
      return next;
    })();
    const termsFromCompany = !String(pkg?.terms_and_conditions || '').trim();
    const termsText = prose('terms_and_conditions', form.terms, termsFromCompany ? companyTermsBlock : form.textI18n);
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
        ? vehicles.map((service) => { const supplier = packageServiceSupplier(service, library); return `<li>${escapeHtml(service.item_name)}${supplier ? ` — ${escapeHtml(supplier)}` : ''}</li>`; }).join('')
        : `<li>${escapeHtml(packageTransportSummary(vehicles, library))}</li>`) : '';
      const otherLines = others
        .map((service) => {
          const supplier = packageServiceSupplier(service, library);
          const room = /accommodation/i.test(String(service.category || '')) && service.room_type
            ? ` (${escapeHtml(service.room_type)})`
            : '';
          return `<li>${escapeHtml(service.item_name)}${room}${supplier ? ` — ${escapeHtml(supplier)}` : ''}</li>`;
        }).join('');
      const services = `${vehicleLines}${otherLines}`;
      /* A hire's vehicle keeps its spec grid in the client document, printed once
         on the day the car is collected — the same rule the itinerary's day-by-day
         follows, so the two documents describe one car the same way. The icons and
         the single letters carry no language, so a translated package needs no
         translated grid. */
      const hireSpecs = included
        .filter((service) => rentalPrintsSpecGrid(service.rental))
        .map((service) => `<div class="car-specs">${carSpecGridHtml(service.rental)}</div>`)
        .join('');
      const dayNotes = localizedText(day, 'notes', lang);
      return `<section><h2>${L('doc.day', { n: index + 1, count: index + 1 })}</h2>${dayNotes ? `<p>${escapeHtml(dayNotes)}</p>` : ''}${services ? `<ul>${services}</ul>` : ''}${hireSpecs}</section>`;
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
      const childText = `<strong>${amount(price(childPrice), packageCurrency)}</strong><span class="sum-flat-from">${TL('doc.childFlat')}</span>`;
      /* One table per season, stacked. The vehicle pool and the party sizes never move with
         the season, so from table to table only the season line, the accommodation-based
         price and the single supplement change. */
      const seasons = periods.length ? periods : [null];
      const roomCapacity = accommodationRoomCapacity({ days, library });
      const tables = seasons.map((period, seasonIndex) => {
        const accommodation = period?.accommodation_per_person != null && period.accommodation_per_person !== 0
          ? Number(period.accommodation_per_person)
          : (accommodationPerPersonForSeason({ days, library, from: period?.valid_from || null, to: period?.valid_to || null }).total ?? 0);
        /* Derived from the accommodation's own contract when the season carries no override,
           so the reader always sees a supplement rather than a zero that reads as no charge.
           The contract ladders still price the party's singles in order, and the season's
           manual single-room count (if any) replaces the party-size heuristic. */
        const seasonSupplement = singleSupplementForSeason({ days, library, from: period?.valid_from || null, to: period?.valid_to || null });
        const single = (period?.single_supplement != null && period.single_supplement !== 0)
          ? Number(period.single_supplement)
          : (seasonSupplement.total ?? 0);
        const seasonLine = period
          ? `${period?.name ? `${escapeHtml(period.name)} · ` : ''}${TL('doc.seasonN', { n: seasonIndex + 1 })}${period?.valid_from && period?.valid_to ? ` · ${escapeHtml(period.valid_from)} \u2192 ${escapeHtml(period.valid_to)}` : ''}`
          : TL('doc.noSeason');
        const columns = presentationPricingColumns({ codes, bands: grid.bands, pools: pool.pools, perPersonFixed: pool.perPersonFixed, accommodation, singleSupplement: single, singleSupplementTiers: seasonSupplement.tiers, singleRoomsOverride: period?.single_rooms ?? null, roomCapacity });
        /* The flat supplement row can only carry one figure; when the contract is a
           ladder it names what the ladder actually charges in single-room order. */
        const ladder = singleSupplementLadderSummary(seasonSupplement.tiers, single);
        const ladderBits = [];
        if (seasonSupplement.tiers.length) {
          if (ladder.waived > 0) ladderBits.push(L('doc.ladderWaived', { n: ladder.waived, count: ladder.waived }));
          if (ladder.nextSupplement != null) {
            ladderBits.push(ladder.waived > 0
              ? L('doc.ladderFrom', { n: ladder.waived + 1, price: amount(ladder.nextSupplement, packageCurrency) })
              : L('doc.ladderFirst', { price: amount(ladder.nextSupplement, packageCurrency) }));
          } else {
            ladderBits.push(L('doc.ladderBeyond', { price: amount(ladder.beyond, packageCurrency) }));
          }
        }
        const supplementNote = ladderBits.length ? ` · ${TL('doc.contractLadder', { bits: ladderBits.join(' · ') })}` : '';
        const travellerCells = columns.map(({ pax }) => `<td class="sum-cell sum-trav"><span class="sum-pax">${TL('doc.paxCell', { n: pax })}</span></td>`).join('');
        const priceCells = columns.map(({ each }) => `<td class="sum-cell"><span class="sum-price">${amount(price(each), packageCurrency)}</span></td>`).join('');
        return `<table class="price-summary"><tbody>
          <tr><td class="lab">${TL('doc.travelSeasons')}</td><td class="sum-date" colspan="${columns.length}">${seasonLine}</td></tr>
          <tr><td class="lab">${TL('doc.travellersRow')}</td>${travellerCells}</tr>
          <tr><td class="lab">${TL('doc.pricePerPersonSharing')}</td>${priceCells}</tr>
          <tr><td class="lab">${TL('doc.singleSupplement')}</td><td class="sum-flat sum-flat-amber" colspan="${columns.length}"><strong>${amount(price(single), packageCurrency)}</strong><span class="sum-flat-from">${TL('doc.singleFlat')}${supplementNote}</span></td></tr>
          <tr><td class="lab">${TL('doc.childPrice')}</td><td class="sum-flat sum-flat-child" colspan="${columns.length}">${childText}</td></tr>
        </tbody></table>`;
      }).join('');
      return `<section class="pricing-summary-section"><h2>${TL('doc.pricingSummary')}</h2>
        <p class="pattern-note">${TL('doc.perPersonSharingNote')}</p>${tables}</section>`;
    })();
    const markupNoteLine = exportMarkup > 0
      ? `<p class="pattern-note">${TL(options.audience === 'partner' ? 'doc.markupNotePartner' : 'doc.markupNoteMarkedUp', { pct: exportMarkup })}</p>`
      : `<p class="pattern-note">${TL('doc.markupNoteInternal')}</p>`;
    /* The child price now always carries a figure, so the note only says which range it was
       priced for: the declared one, or 0-18 while none has been set. */
    const childNote = !form.acceptsChildren
      ? `<p class="pattern-note">${TL('doc.childNoteNotAccepted')}</p>`
      : (!childRange ? `<p class="pattern-note">${TL('doc.childNoteNoRange')}</p>` : '');
    const inclusionsText = prose('inclusions', form.inclusions, form.textI18n);
    const exclusionsText = prose('exclusions', form.exclusions, form.textI18n);
    const inclusionMarkup = options.inclusions
      ? `${inclusionsText ? `<h3>${TL('doc.inclusionsTitle')}</h3><p>${escapeHtml(inclusionsText).replace(/\n/g, '<br>')}</p>` : ''}${exclusionsText ? `<h3>${TL('doc.exclusionsTitle')}</h3><p>${escapeHtml(exclusionsText).replace(/\n/g, '<br>')}</p>` : ''}`
      : '';
    const termsMarkup = options.terms && termsText
      ? `<section><h2>${TL('doc.termsTitle')}</h2><p>${escapeHtml(termsText).replace(/\n/g, '<br>')}</p></section>`
      : '';
    const clientNames = selectedClients.map(nameOf).join(', ');
    const descriptionText = prose('description', form.description, form.textI18n);
    /* The three price cards reuse the tab's colours exactly: teal for the two adult
       prices, amber for the child, and grey when no child range is set. */
    const priceCardCss = `.price-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:12px 0 4px}.price-card{display:flex;flex-direction:column;gap:4px;padding:12px;border-radius:8px;background:#f0fdfa}.price-card span,.price-card small{color:#64748b;font-size:11px;line-height:1.35}.price-card strong{color:#0f766e;font-size:17px}.price-card.lead{box-shadow:0 0 0 2px #0d7478 inset}.price-card-party{background:#f0fdf4;border:1px solid #bbf7d0}.price-card-party span,.price-card-party small{color:#166534}.price-card-party strong{color:#15803d}.price-card-child{background:#fff7ed;border:1px solid #fed7aa}.price-card-child span,.price-card-child small{color:#9a5b13}.price-card-child strong{color:#b45309}.price-card-child.pending{background:#f8fafc;border:1px dashed #cbd5e1}.price-card-child.pending span,.price-card-child.pending small,.price-card-child.pending strong{color:#94a3b8}.pattern-pax{margin:0 0 2px;font-weight:bold;color:#1a202c}.pattern-note{margin:8px 0 0;padding:8px 10px;border-left:3px solid #94a3b8;background:#f8fafc;color:#475569;font-size:12px;line-height:1.45}.price-matrix-card{margin:12px 0;padding:12px 14px;border:1px solid #e2e8f0;border-radius:9px;background:#f8fafc}.price-matrix-card h2{margin:0 0 9px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#0d7478}.price-matrix-scroll{overflow-x:auto}.price-matrix{width:100%;border-collapse:collapse}.price-matrix th,.price-matrix td{padding:9px 12px;text-align:center;border:1px solid #e2e8f0;font-size:14px;white-space:nowrap}.price-matrix th{background:#f0fdfa;color:#0f766e;font-weight:700}.price-matrix td{color:#1e293b;font-weight:700}.price-matrix td.pending{color:#94a3b8;font-weight:400}@media print{.price-cards,.price-matrix-card{break-inside:avoid}}`;
    const summaryCss = `.pricing-summary-section{break-inside:avoid}.price-summary{width:100%;border-collapse:collapse;margin:10px 0;table-layout:fixed;break-inside:avoid}.price-summary .lab{width:168px;background:#f8fafc;text-align:left;font-size:12.5px;font-weight:600;color:#334155}.price-summary th,.price-summary td{border:1px solid #e2e8f0;padding:10px 12px;vertical-align:top}.price-summary .sum-cell{text-align:center}.price-summary .sum-trav{background:#f0fdfa}.price-summary .sum-pax{display:block;font-size:15px;font-weight:700;color:#0f766e;font-variant-numeric:tabular-nums}.price-summary .sum-price{display:block;font-size:15px;font-weight:700;color:#0f172a;font-variant-numeric:tabular-nums}.price-summary .sum-date{background:#fffbeb;text-align:left;font-size:15px;font-weight:700;color:#78350f;font-variant-numeric:tabular-nums}.price-summary .sum-flat{text-align:left;font-size:15px;font-weight:700;font-variant-numeric:tabular-nums}.price-summary .sum-flat-amber{background:#fefce8;color:#854d0e}.price-summary .sum-flat-child{background:#fdf2f8;color:#9d174d}.price-summary .sum-flat-from{display:block;margin-top:3px;font-size:11px;font-weight:500;color:#94a3b8}`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(pkg.name)}</title><style>body{font:15px Arial,sans-serif;color:#1e293b;max-width:850px;margin:36px auto;padding:0 24px}h1,h2,h3{color:#0d7478}header{border-bottom:2px solid #0d7478;padding-bottom:16px;margin-bottom:24px}section{margin:22px 0;padding-bottom:12px;border-bottom:1px solid #e2e8f0}.cover{max-width:100%;max-height:280px;object-fit:cover}li{margin:6px 0}.car-specs{margin:8px 0 0}${priceCardCss}${summaryCss}@media print{body{margin:0 auto}}</style></head><body><header>${cover}<h1>${escapeHtml(pkg.name)}</h1><p>${escapeHtml(descriptionText)}</p>${clientNames ? `<h3>${TL('doc.forPartner', { names: clientNames })}</h3>` : ''}</header>${dayMarkup}${vehicleNote}${inclusionMarkup ? `<section>${inclusionMarkup}</section>` : ''}${summaryMarkup}${markupNoteLine}${childNote}${termsMarkup}</body></html>`;
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
  const addPeriod = () => setPeriods((previous) => [...previous, { valid_from: '', valid_to: '', name: '', accommodation_per_person: null, single_supplement: 0, single_rooms: null }]);
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
          <MultiSelectFilter
            className="package-filter-section"
            label="Destination"
            options={destinationOptions}
            value={destinationFilters}
            onChange={setDestinationFilters}
            placeholder="All destinations"
            searchPlaceholder="Search destinations…"
            emptyText="No contracted item has a destination recorded yet."
          />
          {(categoryFilter || destinationFilters.length || search) && <button type="button" className="clear-filters-btn" onClick={() => { setCategoryFilter(''); setDestinationFilters([]); setSearch(''); }}>Clear filters</button>}
          <p className="package-help">{markupPercent > 0 ? `Contract rates are copied, then the assigned partner markup of ${markupPercent}% is applied to every price.` : 'Rates are copied at their contract amount. Assign a partner on the Client partner tab to apply that client markup.'}</p>
          <div className="package-library-results">
            {visibleResults.map((item) => {
              /* A hire has no item_rates row, so the rate-shaped gates on this card
                 would lock it out of the package for good. Its tariff is the vehicle
                 groups it holds and the rental-length bands inside them, and its
                 "capacity" is the biggest of them. The card cannot quote a price - the
                 money depends on how many 24-hour blocks the car is out for - so it
                 says "from" over the whole ladder and the drop dialog asks the rest. */
              const isHire = isCarRentalItem(item);
              const hireGroups = isHire ? carRentalGroups(item) : [];
              /* The cheapest day on the whole contract, across every season and every
                 band: the card cannot know which tariff the operator's pick-up date
                 will answer from, so it says "from" over all of them. */
              const hireFrom = hireGroups.reduce((cheapest, group) => (
                group.seasons.reduce((bySeason, season) => (
                  season.bands.reduce((low, band) => (
                    band.price > 0 && (low === null || band.price < low) ? band.price : low
                  ), bySeason)
                ), cheapest)
              ), null);
              const hireCapacity = hireGroups.reduce((widest, group) => Math.max(widest, group.passengers || 0), 0);
              const eligibleRates = (item.item_rates || []).filter((entry) => currencyMatches(entry, packageCurrency));
              const rate = rateForDates(item);
              const coverage = isHire
                ? { status: 'ok', ok: true, canAdd: true, message: '', protectionPercent: 0, seasonName: '', rate: null }
                : seasonFor(item, rate);
              /* The card shows the row the add will actually price from. With no
                 covering season the resolver stands a prior year in - uplifted when
                 a protection percentage is set, unchanged when it is not - and in
                 both cases that row, not the first one the currency returns, is
                 the figure the operator is looking at. */
              const shownRate = (coverage.status === 'protected' || coverage.status === 'stale') && coverage.rate
                ? coverage.rate
                : rate;
              const basis = basisOfRate(shownRate, item);
              /* The same capacity the band engine reads, so the number on the card is the
                 number that decides which band this vehicle opens up. */
              const vehicleCapacity = isHire ? hireCapacity : packageVehicleCapacity(item, shownRate);
              const destination = itemDestinationLabel(item);
              const canDrop = isHire ? hireGroups.length > 0 : Boolean(shownRate);
              const addToDay = () => addService(item, shownRate?.id, selectedDay, bandScope ? { tier_key: bandScope } : {});
              return <article key={item.id} className={`package-library-card ${!canDrop ? 'unavailable' : ''}`} draggable={canDrop} onDragStart={(event) => event.dataTransfer.setData('application/json', JSON.stringify({ type: 'library', itemId: item.id, rateId: shownRate?.id }))} onDoubleClick={canDrop ? addToDay : undefined}>
                <div className="package-library-top">
                  <span className="package-library-name">{item.name}</span>
                  <GripVertical size={16} className="package-library-grip" />
                </div>
                <div className="package-library-meta">
                  <span className="item-cat-tag">{item.category || 'General'}</span>
                  {vehicleCapacity > 0 && <span className="item-capacity-tag" title={`Seats ${vehicleCapacity} travellers, so a band is offered up to ${vehicleCapacity} pax`}>Max: {vehicleCapacity}</span>}
                  {isHire
                    ? (hireFrom === null
                      ? <span className="item-price-tag missing">No hire tariff priced</span>
                      : <span className="item-price-tag">from {money(hireFrom, item.currency || packageCurrency)} <span style={{ color: '#94a3b8', fontWeight: 500 }}>per 24h{hireGroups.length > 1 ? ` · ${hireGroups.length} groups` : ''}</span></span>)
                    : shownRate
                    ? <span className="item-price-tag">{money(contractPriceOf(shownRate), shownRate.currency || item.currency || 'ZAR')} <span style={{ color: '#94a3b8', fontWeight: 500 }}>{basisLabelOf(basis)}</span></span>
                    : <span className="item-price-tag missing">No rate{eligibleRates.length ? ' in this currency' : ''}</span>}
                </div>
                {/* Where the item actually is: a guide, vehicle or property in the wrong
                    town is not a cheaper alternative, and the destination filter above can
                    only ever list items that recorded one — so an item without one says so
                    here instead of simply never appearing. */}
                <div
                  className={`library-item-destination ${destination ? '' : 'missing'}`}
                  title={destination
                    ? `Located in ${destination}`
                    : 'No destination recorded on this library item — set it in Library Items so it can be found by destination.'}
                >
                  <MapPin size={12} />
                  <span>{destination || 'No destination set'}</span>
                </div>
                <div className="package-library-supplier">
                  {/accommodation/i.test(String(item.category || ''))
                    ? withStarGrade(item.supplier_name || '', item.supplier_star_rating)
                    : (item.supplier_name || '')}
                  {SIDEBAR_FLAT_BASES.has(String(basis)) && <span className="basis-tag">{basisLabelOf(basis)}</span>}
                  {shownRate && /accommodation/i.test(String(item.category || '')) && (() => {
                    const opt = rateOptionLabel(shownRate, item);
                    const season = shownRate.season_name || shownRate.option_name || '';
                    const from = shownRate.valid_from ? String(shownRate.valid_from).slice(0, 10).replaceAll('-', '/') : '';
                    const to = shownRate.valid_to ? String(shownRate.valid_to).slice(0, 10).replaceAll('-', '/') : '';
                    const label = [shownRate.room_type, season, opt, nightBandLabel(shownRate), (from && to) ? `${from}-${to}` : ''].filter(Boolean).join(' · ');
                    return label ? <span className="basis-tag" style={{ color: '#5b21b6', background: '#f5f3ff', borderColor: '#ddd6fe' }}>{label}</span> : null;
                  })()}
                  {(coverage.status !== 'ok' && coverage.status !== 'open') && <span className="basis-tag package-library-flag warn" title={coverage.message}>
                    {coverage.status === 'protected'
                      ? `⚠ ${coverage.seasonName || 'Prior'} ${seasonWindowLabel(shownRate)} +${coverage.protectionPercent}%`
                      : coverage.status === 'stale'
                        ? `⚠ ${coverage.seasonName || 'Old'} ${seasonWindowLabel(shownRate)} · no protection`
                        : coverage.status === 'blocked' ? 'No matching season' : 'Season mismatch'}
                  </span>}
                </div>
                <button type="button" className="secondary-btn package-library-add" onClick={addToDay} disabled={!canDrop}>Add to day {selectedDay + 1}</button>
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
                const marked = markedDayIndexes.includes(dayIndex);
                return (
                  <div key={day.id || `day-${dayIndex}`} className={`day-strip-cell${marked ? ' marked' : ''}`}>
                    {days.length > 1 && (
                      <input
                        type="checkbox"
                        className="day-strip-mark"
                        checked={marked}
                        onChange={() => toggleDayMark(dayIndex)}
                        title={`Tick Day ${dayIndex + 1} to delete it together with the other ticked days`}
                        aria-label={`Tick Day ${dayIndex + 1} for bulk delete`}
                      />
                    )}
                    <button type="button" className={`day-strip-card ${selectedDay === dayIndex ? 'active' : ''}`} onClick={() => setSelectedDay(dayIndex)}>
                      <div className="day-strip-card-title">Day {dayIndex + 1}</div>
                      <div className="day-strip-card-date">{dayDayLabel(day)}</div>
                      <div className="day-strip-card-summary"><span>{day.services.length} item{day.services.length === 1 ? '' : 's'}</span><span>{money(dayValue, dayValueCurrency(day))}</span></div>
                    </button>
                  </div>
                );
              })}
              <button type="button" className="day-add-chip" onClick={addDay}><Plus size={15} /> Add Day</button>
            </div>
            {markedDayIndexes.length > 0 && (() => {
              const doomed = days.filter((_, index) => markedDayIndexes.includes(index));
              const lines = doomed.reduce((count, day) => count + (day.services || []).length, 0);
              return (
                <div className="day-bulk-bar">
                  <span className="day-bulk-count">
                    {doomed.length} day{doomed.length === 1 ? '' : 's'} ticked
                    {lines ? ` · ${lines} service line${lines === 1 ? '' : 's'} on them` : ''}
                  </span>
                  <button
                    type="button"
                    className={`secondary-btn danger${bulkDeleteArmed ? ' armed' : ''}`}
                    onClick={deleteMarkedDays}
                    title="Deleting a day takes every service line worked on it"
                  >
                    <Trash2 size={15} />
                    {bulkDeleteArmed
                      ? `Click again to delete ${doomed.length} day${doomed.length === 1 ? '' : 's'}`
                      : `Delete ${doomed.length} day${doomed.length === 1 ? '' : 's'}`}
                  </button>
                  <button type="button" className="secondary-btn" onClick={clearDayMarks}>Clear</button>
                </div>
              );
            })()}
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
            <LanguageText
              field="notes"
              ariaLabel={`Day ${selectedDay + 1} notes`}
              languages={contentLanguages}
              value={days[selectedDay].notes || ''}
              onChange={(value) => setDays((previous) => previous.map((row, index) => index === selectedDay ? { ...row, notes: value } : row))}
              translations={days[selectedDay].text_i18n}
              onTranslationsChange={(next) => setDays((previous) => previous.map((row, index) => index === selectedDay ? { ...row, text_i18n: next } : row))}
              placeholder="Optional day overview or notes"
              rows={2}
              inputClassName=""
              style={{ minHeight: 'auto', padding: '.6rem', fontSize: '.8rem' }}
            />
            {scopedServicesFor(days[selectedDay]).map((service) => {
              const rawIndex = rawIndexOf(selectedDay, service);
              const item = itemForService(service);
              const crew = crewShareOn(service);
              const coverage = seasonFor(item, rateForService(service), { service });
              const roomPlan = isStay(service) ? roomPlanFor(service) : null;
              const capacity = isStay(service)
                ? (Number(service.vehicle_capacity) || Number(item?.max_occupancy) || 0)
                : (Number(item?.max_occupancy || service.vehicle_capacity) || 0);
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
                <div className="package-service-main"><strong>{service.item_name}</strong><small>{service.category || 'Service'}{packageServiceSupplier(service, library) ? ` · ${packageServiceSupplier(service, library)}` : ''}{isStay(service) && service.room_type ? ` · ${service.room_type}` : ''}</small>
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
                    const label = [rate.room_type, season, opt, nightBandLabel(rate), (from && to) ? `${from}-${to}` : ''].filter(Boolean).join(' · ');
                    return <option key={rate.id} value={rate.id}>{label} · {rate.currency} {Number(rate.unit_cost || rate.price_1_adult || rate.unit_price || 0).toFixed(2)}</option>;
                  })}
                  </select>}
                  {Number(service.price_protection_percent) > 0 ? (() => {
                    const stampWindow = seasonWindowLabel(service.rate_snapshot);
                    const stampSeason = service.protected_season_name || service.rate_snapshot?.season_name || 'prior season';
                    const stampDates = stampWindow === 'undated' ? '' : ` (${stampWindow})`;
                    return <small className="package-season-warning protected" title={`Pricing Protection applied: +${service.price_protection_percent}% added to the "${stampSeason}" season${stampDates} because no season covers this package's validity dates.`}>
                      ⚑ Protected +{service.price_protection_percent}% · {stampSeason}{stampDates}
                    </small>;
                  })()
                    : !coverage.ok && <small className="package-season-warning" title={coverage.message}>{coverage.message}</small>}
                  {Number(service.price_protection_percent) > 0 && <small className="package-protected-flag">{service.currency_code} {Number(service.unit_cost || 0).toFixed(2)} includes the protection uplift</small>}
                  {Array.isArray(service.guide_service_types) && service.guide_service_types.length > 0 && (
                    <small className="package-band-flag shared guide-service-types">Guide · {guideLabel(service.guide_service_types)}</small>
                  )}
                  {service.guide_only === true && <small className="package-band-flag guide-only">guide &amp; driver only</small>}
                  {/* The hire answers in full on the line: the car the contract names,
                      the whole 24-hour blocks it is out for, where it goes out and comes
                      back, and the six specs the documents print. Its contract fee is a
                      line of its own, because a client asks what the paperwork cost. */}
                  {service.rental && (
                    <div className="package-rental-copy">
                      <small>{rentalVehicleLabel(service.rental)} · {service.rental.seasonName || ''} band</small>
                      {isRentalFeeLine(service.rental) ? (
                        <small>
                          {`${service.currency_code} ${Number(service.rental.contractFee).toFixed(2)} contract fee — the hire desk's charge for drawing up this agreement, billed once rather than per day`}
                        </small>
                      ) : (
                        <small>
                          {service.currency_code} {Number(service.rental.rentalDays || 0)} × 24h at {service.currency_code} {Number(service.rental.dailyRate || 0).toFixed(2)}
                          {Number(service.rental.contractFee) > 0 ? ` + ${service.currency_code} ${Number(service.rental.contractFee).toFixed(2)} contract fee on its own line` : ' — no contract fee on this contract'}
                          {` = ${service.currency_code} ${carRentalBuyTotal(service.rental).toFixed(2)} for the whole hire`}
                          {/* A hire that arrived from an itinerary spread over its days
                              crosses over one block at a time, so the line says which day
                              of the contract it is rather than looking like it forgot the
                              rest of the hire. */}
                          {service.rental.dayShare && (
                            ` — this line is day ${service.rental.dayShare.ordinal} of ${service.rental.dayShare.dayCount}, ${service.currency_code} ${rentalLineBuyTotal(service.rental).toFixed(2)}`
                          )}
                        </small>
                      )}
                      <small>
                        Out of {service.rental.pickupLocation || 'the hire desk'} {String(service.rental.pickupAt || '').replace('T', ' ')}
                        {' → back at '}{service.rental.returnLocation || 'the hire desk'} {String(service.rental.returnAt || '').replace('T', ' ')}
                      </small>
                      <small>Tariff {service.rental.validityFrom || 'open'} – {service.rental.validityTo || 'open'}</small>
                      <CarSpecGrid spec={service.rental} />
                    </div>
                  )}
                </div>
                <div className="package-service-price"><span>{service.currency_code} {Number(service.unit_cost || 0).toFixed(2)}</span><small>{service.rate_basis || 'per_person'} · no markup</small>
                  {crew && <small className="package-crew-flag" title={`${crew.label} at ${service.currency_code} ${Number(crew.fare).toFixed(2)}${crew.heads > 1 ? ` × ${crew.heads}` : ''} = ${service.currency_code} ${Number(crew.total).toFixed(2)}, bought on this line and split across whichever party the band sells to. It is not a head and never a line of its own.`}>
                    + {service.currency_code} {Number(crew.total).toFixed(2)} {crew.label.toLowerCase()}, shared by the band
                  </small>}
                  {capacitySummary && <small>{capacitySummary}</small>}
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
                <button type="button" className="package-icon-button" aria-label={`Update ${service.item_name} from the library (re-locks today's rate)`} onClick={() => refreshServiceFromLibrary(selectedDay, rawIndex)} title={service.rental ? 'Update from library: re-price this hire from today\u2019s tariff' : 'Update from library: re-locks this line to the library\u2019s current rate'} disabled={!library.find((entry) => entry.id === service.item_id)}><RefreshCw size={16} /></button>
                {service.rental && (
                  <button type="button" className="package-icon-button" aria-label={`Change the hire on ${service.item_name}`} title="Change the hire — where and when the car goes out and comes back" onClick={() => openCarRentalEdit(selectedDay, rawIndex)}><Car size={16} /></button>
                )}
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
              /* The ticks answer days by position, and every day after the one
                 that went has moved up a place. */
              clearDayMarks();
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
        derivedSingleSupplement={derivedSingleSupplement}
        singleSupplementOverride={hasSupplementOverride}
        singleSupplement={singleSupplementForDisplay}
        singleRoomsAvailable={dbFeatures.singleRooms}
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
      {tab === 'inclusions' && <section className="package-tab-panel"><h2>Inclusions &amp; exclusions</h2><label className="package-field"><span>Inclusions</span><LanguageText field="inclusions" languages={contentLanguages} value={form.inclusions} onChange={(value) => updateForm('inclusions', value)} translations={form.textI18n} onTranslationsChange={(next) => updateForm('textI18n', next)} placeholder="Describe what is included in the package" rows={7} inputClassName="" style={packageProseStyle} /></label><label className="package-field"><span>Exclusions</span><LanguageText field="exclusions" languages={contentLanguages} value={form.exclusions} onChange={(value) => updateForm('exclusions', value)} translations={form.textI18n} onTranslationsChange={(next) => updateForm('textI18n', next)} placeholder="Describe what is not included" rows={7} inputClassName="" style={packageProseStyle} /></label></section>}
      {tab === 'terms' && <section className="package-tab-panel"><h2>Terms &amp; conditions</h2><label className="package-field"><span>Package terms and conditions</span><LanguageText field="terms_and_conditions" languages={contentLanguages} value={form.terms} onChange={(value) => updateForm('terms', value)} translations={form.textI18n} onTranslationsChange={(next) => updateForm('textI18n', next)} placeholder="Add package-specific terms and conditions" rows={14} inputClassName="" style={packageProseStyle} /></label></section>}
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
        <label className="package-field"><span>Package overview</span><LanguageText field="description" languages={contentLanguages} value={form.description} onChange={(value) => updateForm('description', value)} translations={form.textI18n} onTranslationsChange={(next) => updateForm('textI18n', next)} placeholder="Optional package overview" rows={4} inputClassName="" style={packageProseStyle} /></label>
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
                <span>{service.item_name}<small>{service.category || 'Service'}{packageServiceSupplier(service, library) ? ` · ${packageServiceSupplier(service, library)}` : ''}{service.is_included === false ? ' · optional' : ''}{packageIsTransport(service, library) && !service.tier_key ? ' · vehicle ladder, party picks one' : ''}</small></span>
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
        <div className="package-export-options"><span className="package-export-subhead">For</span><label><input type="radio" name="package-export-audience" value="partner" checked={exportOptions.audience === 'partner'} onChange={choosePartnerAudience} /> Assign to partner{selectedClients.length ? ` (${selectedClients.map(nameOf).join(', ')})` : ' — none assigned'}</label><button type="button" className="package-export-assign" onClick={() => setAssignPickerOpen(true)}>{selectedClients.length ? 'Change partner' : 'Assign a travel agent'}</button><label><input type="radio" name="package-export-audience" value="markup" checked={exportOptions.audience === 'markup'} onChange={() => setExportOptions((previous) => ({ ...previous, audience: 'markup' }))} /> Markup for a non-partner</label>{exportOptions.audience === 'markup' ? <label className="package-export-markup">Markup <input type="number" min="0" step="0.5" value={exportOptions.markup} onChange={(event) => setExportOptions((previous) => ({ ...previous, markup: event.target.value }))} /> %</label> : null}<label><input type="radio" name="package-export-audience" value="internal" checked={exportOptions.audience === 'internal'} onChange={() => setExportOptions((previous) => ({ ...previous, audience: 'internal' }))} /> Internal (STO)</label></div>
        <div className="package-export-options"><span className="package-export-subhead">Format</span><label><input type="radio" name="package-export-format" value="pdf" checked={exportFormat === 'pdf'} onChange={() => setExportFormat('pdf')} /> PDF</label><label><input type="radio" name="package-export-format" value="word" checked={exportFormat === 'word'} onChange={() => setExportFormat('word')} /> Word</label></div>
        {/* An English-only tenant has nothing to choose, so the group only appears
            once a second content language is switched on in Settings. */}
        {contentLanguages.length > 1 && <div className="package-export-options"><span className="package-export-subhead">Language</span><select className="pricing-select" aria-label="Document language" value={exportLang} onChange={(event) => setExportLang(event.target.value)}>{languageChoices(contentLanguages).map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select></div>}
        <div className="package-export-options"><span className="package-export-subhead">Include</span>{[['cover', 'Cover image'], ['inclusions', 'Inclusions'], ['terms', 'Terms'], ['includePricingSummary', 'Presentation pricing'], ['explainPricing', 'Explain pricing'], ['showVehicleOptions', 'Every vehicle size']].map(([key, label]) => <label key={key}><input type="checkbox" checked={!!exportOptions[key]} onChange={(event) => setExportOptions((previous) => ({ ...previous, [key]: event.target.checked }))} /> {label}</label>)}</div>
      </div>
      <div className="package-modal-actions"><button className="secondary-btn" onClick={() => setExportDialog(false)}>Cancel</button><button className="primary-btn" onClick={exportDocument}><FileText size={16} /> Export</button></div>
    </section></div>}
    {assignPickerOpen && <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setAssignPickerOpen(false); }}><section className="modal-content package-export-modal">
      <div className="modal-header"><div><h2>Assign to partner</h2><p>Only travel agents are listed. The choice is saved to the package straight away.</p></div><button className="close-btn" onClick={() => setAssignPickerOpen(false)}><X size={20} /></button></div>
      <label className="packages-search"><Search size={15} /><input autoFocus value={agentQuery} onChange={(event) => setAgentQuery(event.target.value)} placeholder="Search travel agents\u2026" /></label>
      <div className="package-client-select-options">
        {visibleAgents.map((client) => (
          <label key={client.id}>
            <input type="checkbox" checked={form.assignedClientIds.includes(client.id)} onChange={() => assignClient(client.id)} />
            <span>{nameOf(client)}{Number(client.markup_percentage) > 0 ? ` \u00b7 +${client.markup_percentage}%` : ''}</span>
          </label>
        ))}
        {!visibleAgents.length && <p className="package-export-empty">{clients.some((client) => client.client_type === 'Travel Agency') ? 'No travel agents match your search.' : 'No travel agents are set up yet. Add one on the Clients page with type "Travel Agency".'}</p>}
      </div>
      <div className="package-modal-actions"><button className="primary-btn" onClick={() => setAssignPickerOpen(false)}><Check size={16} /> Done</button></div>
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
    {/* The hire, asked the same way as on an itinerary. A package is sold for its
        validity dates rather than one trip, so the dialog opens on the season being
        worked on - the operator moves the two ends of the hire from there, and the
        rental-length band follows the 24-hour blocks between them. */}
    {carRentalModal && <CarRentalDropModal
      item={carRentalModal.item}
      currency={carRentalModal.item.currency || packageCurrency}
      defaultPickupDate={periods[activeSeason]?.valid_from || periods[0]?.valid_from || ''}
      pax={autoPattern.pax || 0}
      details={carRentalModal.details || null}
      onConfirm={confirmCarRental}
      onCancel={cancelCarRental}
    />}
    {/* No season covers the package validity dates, so this line is not a quote from
        the contract - it is a stand-in. The dialog says which season stands in and
        over which dates, and takes the percentage the line is then protected at. It
        starts on the Settings figure and only prices this line; Settings is untouched. */}
    {seasonPrompt && (() => {
      const promptPct = Math.max(0, Number(seasonPrompt.protectionPercent) || 0);
      return (
        <ConfirmDialog
          title={seasonPrompt.season.status === 'stale'
            ? 'Charge this package from an old season?'
            : 'No season covers this package'}
          message={seasonPrompt.season.message}
          detail={promptPct > 0
            ? `Pricing Protection adds ${promptPct}% to that season's figures, so the line is charged a protected price rather than the old contract amount. Leave it at 0 to charge the figure exactly as the supplier last quoted it.`
            : 'With no percentage the line is charged that season\'s contract figure exactly as it stands, and the package is priced on out-of-date money until the current season is loaded.'}
          confirmLabel={promptPct > 0 ? `Apply ${promptPct}% and add` : 'Add anyway'}
          cancelLabel="Don't add"
          onConfirm={() => {
            const apply = seasonPrompt.onAccept;
            setSeasonPrompt(null);
            apply?.(promptPct);
          }}
          onCancel={() => setSeasonPrompt(null)}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem', color: '#334155' }}>
            <span className="form-label" style={{ margin: 0 }}>Pricing Protection %</span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.5"
              className="input"
              style={{ maxWidth: '140px' }}
              value={seasonPrompt.protectionPercent}
              onChange={(event) => setSeasonPrompt((prompt) => (prompt
                ? { ...prompt, protectionPercent: event.target.value }
                : prompt))}
            />
            <small style={{ color: '#64748b', fontWeight: 400 }}>
              Settings has {protectionPercent || 0}%. This applies to the lines added from this dialog.
            </small>
          </label>
        </ConfirmDialog>
      );
    })()}
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
