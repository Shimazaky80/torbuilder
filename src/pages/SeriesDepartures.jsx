import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarRange,
  CalendarPlus,
  Plus,
  Edit3,
  Trash2,
  X,
  Search,
  AlertTriangle
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useSession } from '../hooks/useSession';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../hooks/useConfirm';
import { useCurrencies } from '../hooks/useCurrencies';
import ConfirmDialog from '../components/ConfirmDialog';
import SearchableSelect from '../components/SearchableSelect';
import {
  WEEKDAYS,
  DEPARTURE_STATUSES,
  departureCode,
  departureStatusLabel,
  generateDepartureDates,
  isoWeekday,
  releaseDateFor,
  returnDateFor,
  seatRollup,
  templateDuration,
  toISODate
} from '../lib/seriesDepartures';
import { TOUR_TYPES, VEHICLE_TYPES, mergeVocabulary, vocabularyReadFilter } from '../lib/companyVocabulary';
import { contractTypeForTourType, normalizeRateType } from '../lib/rateTypes';
import { deriveSeriesPricesFromPackage } from '../lib/packageSeriesPricing';
import { columnExists } from '../lib/schemaColumnProbe';
import { LIBRARY_ITEM_PACKAGE_FIELDS, LIBRARY_ITEM_PACKAGE_FIELDS_FALLBACK } from '../lib/libraryItemFields';
import { fetchRoomTypesForItems } from '../lib/roomTypeTable';
import { fetchCarRentalRates } from '../lib/carRentalRates';

/* A series is a fixed tour running on published dates, sold one seat at a time
   out of an allocation held from the supplier. It is deliberately not the quote
   engine: the itinerary, the contracted rates and the seasons stay on the
   Package, and what is added here is the schedule, the seat cap, the guarantee
   minimum and the release period.

   Sold seats are never typed in. They are summed from the booking ledger, so
   this page can show a departure's position without being able to invent it. */

const MIGRATION = '20261259';

/* Dates are days, not instants. Reading one through the local constructor moves
   it for anyone west of UTC, so every label here is formatted back at UTC. */
const dateLabel = (iso) => {
  const text = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  return new Date(`${text}T00:00:00Z`).toLocaleDateString('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC'
  });
};

const dayShort = (iso) => WEEKDAYS.find((day) => day.value === isoWeekday(iso))?.short || '';

const money = (amount, currency) => `${currency || 'ZAR'} ${(Number(amount) || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* The new columns win when present; a row written before the migration falls
   back to the single seat price, which was the sharing figure. Zero is kept as
   a visible 0 so a missing package figure is never a blank the desk can miss. */
const priceField = (value, fallback) => {
  const figure = Number(value);
  if (value !== null && value !== undefined && Number.isFinite(figure)) return String(Math.max(0, figure));
  const old = Number(fallback);
  return Number.isFinite(old) ? String(Math.max(0, old)) : '';
};

const priceFieldsOf = (row = {}) => ({
  sharingPrice: priceField(row.sharing_price, row.price_per_seat),
  singleSupplementPrice: priceField(row.single_supplement_price, 0),
  childPrice: priceField(row.child_price, 0)
});

/* One compact cell for all three figures. Zero across the board still reads as
   "No price set" rather than three misleading zero prices. */
const PriceGroup = ({ row, currency }) => {
  const values = [
    ['Sharing', Number(row.sharing_price ?? row.price_per_seat) || 0],
    ['Single supplement', Number(row.single_supplement_price) || 0],
    ['Child', Number(row.child_price) || 0]
  ];
  if (!values.some(([, value]) => value > 0)) return <span style={{ color: '#b45309' }}>No price set</span>;
  return <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
    {values.map(([label, value]) => <div key={label} style={{ fontSize: '0.78rem', color: '#475569' }}>
      {label}: <strong style={{ color: value > 0 ? '#1e293b' : '#94a3b8' }}>{money(value, currency)}</strong>
    </div>)}
  </div>;
};

/* The pricing engine needs the same library projection the package builder uses.
   A workspace without the newest optional columns falls back to the long-standing
   fields rather than losing the whole series page. */
const selectLibraryItems = async (buildQuery) => {
  const withAllFields = await buildQuery(LIBRARY_ITEM_PACKAGE_FIELDS);
  return withAllFields.error ? buildQuery(LIBRARY_ITEM_PACKAGE_FIELDS_FALLBACK) : withAllFields;
};

const operatesLabel = (days) => {
  const chosen = WEEKDAYS.filter((day) => (Array.isArray(days) ? days : []).map(Number).includes(day.value));
  return chosen.map((day) => day.short).join(', ');
};

const STATUS_TONE = {
  open: { background: '#f0fdfa', color: '#0f766e', border: '1px solid #99f6e4' },
  guaranteed: { background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' },
  waitlist: { background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' },
  closed: { background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1' },
  cancelled: { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' },
  completed: { background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }
};

const StatusBadge = ({ status }) => (
  <span className="status-badge" style={STATUS_TONE[status] || STATUS_TONE.open}>
    {departureStatusLabel(status)}
  </span>
);

/* A template is draft, active or archived — a departure is open, guaranteed and
   so on. They are different words on purpose: a draft series has no seats to
   waitlist, and an archived one was never closed by an operator. */
const TEMPLATE_STATUS = {
  draft: { label: 'Draft', tone: STATUS_TONE.waitlist },
  active: { label: 'On sale', tone: STATUS_TONE.guaranteed },
  archived: { label: 'Archived', tone: STATUS_TONE.closed }
};

const TemplateStatusBadge = ({ status }) => {
  const entry = TEMPLATE_STATUS[status] || TEMPLATE_STATUS.draft;
  return <span className="status-badge" style={entry.tone}>{entry.label}</span>;
};

const Field = ({ label, hint, children }) => (
  <div>
    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.25rem' }}>
      {label}
    </label>
    {children}
    {hint && <small style={{ display: 'block', marginTop: '0.25rem', color: '#64748b' }}>{hint}</small>}
  </div>
);

const SectionTitle = ({ children }) => (
  <h3 style={{ fontSize: '0.75rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '1.5rem 0 0.75rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.35rem' }}>
    {children}
  </h3>
);

const Stat = ({ label, value, tone = '#1e293b' }) => (
  <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.9rem 1.25rem', boxShadow: '0 2px 4px rgba(0,0,0,0.04)' }}>
    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
    <div style={{ fontSize: '1.4rem', fontWeight: 800, color: tone }}>{value}</div>
  </div>
);

const emptyForm = {
  name: '',
  code: '',
  packageId: '',
  operatesOn: [],
  validFrom: '',
  validTo: '',
  minPax: '1',
  maxPax: '20',
  guaranteeMin: '0',
  seats: '',
  releaseDays: '30',
  sharingPrice: '',
  singleSupplementPrice: '',
  childPrice: '',
  currency: 'ZAR',
  status: 'draft',
  notes: ''
};

const formOf = (template) => ({
  name: template.name || '',
  code: template.code || '',
  packageId: template.package_id || '',
  operatesOn: (Array.isArray(template.operates_on) ? template.operates_on : []).map(Number),
  validFrom: String(template.valid_from || '').slice(0, 10),
  validTo: String(template.valid_to || '').slice(0, 10),
  minPax: String(template.min_pax ?? 1),
  maxPax: String(template.max_pax ?? 20),
  guaranteeMin: String(template.guarantee_min ?? 0),
  seats: Number(template.seats_per_departure) > 0 ? String(template.seats_per_departure) : '',
  releaseDays: String(template.release_days ?? 30),
  ...priceFieldsOf(template),
  currency: String(template.currency_code || 'ZAR').toUpperCase(),
  status: template.status || 'draft',
  notes: template.notes || ''
});

const wholeNumber = (value) => {
  const parsed = Number(String(value ?? '').trim());
  return Number.isFinite(parsed) ? Math.round(parsed) : NaN;
};

export const SeriesDepartures = () => {
  const navigate = useNavigate();
  const { companyId, can } = useSession();
  const { showToast } = useToast();
  const [confirmDialog, confirm] = useConfirm();
  const { currencies } = useCurrencies();

  const [tab, setTab] = useState('templates');
  const [templates, setTemplates] = useState([]);
  const [departures, setDepartures] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [seriesChart, setSeriesChart] = useState([]);
  const [seriesChartMissing, setSeriesChartMissing] = useState(false);
  const [packages, setPackages] = useState([]);
  const [tourTypes, setTourTypes] = useState([]);
  const [vehicleTypes, setVehicleTypes] = useState([]);
  const [seriesPricesReady, setSeriesPricesReady] = useState(false);
  const [derivedPrices, setDerivedPrices] = useState(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');

  const [search, setSearch] = useState('');
  const [calendarTemplate, setCalendarTemplate] = useState('all');
  const [calendarStatus, setCalendarStatus] = useState('all');
  const [selected, setSelected] = useState([]);
  const [bulkStatus, setBulkStatus] = useState('guaranteed');

  const mayWrite = can('series', 'write');
  /* Read once when the page opens. A release day that has passed is worth
     colouring, and re-reading the clock on every render would make that answer
     move under the operator for no reason. */
  const [today] = useState(() => toISODate(Date.now()));

  /* A series may only run a package the company has declared a tour (as opposed
     to a transfer or another non-tour product). Older workspaces have no
     tour_type column, so their long-standing rate_type still decides. */
  const seriesPackages = useMemo(() => packages.filter((pkg) => (
    contractTypeForTourType(tourTypes, pkg.tour_type) === 'series'
    || (!pkg.tour_type && normalizeRateType(pkg.rate_type) === 'series')
  )), [packages, tourTypes]);

  const priceRequestRef = useRef(0);

  /* Read the package's own season, pax band and contract rates and hand them to
     the shared derivation helper. The three answers are suggestions, never
     written back to the package; saving a template snapshots them. */
  const deriveForPackage = useCallback(async (packageId, apply = false) => {
    if (!packageId || !seriesPricesReady) {
      setDerivedPrices(null);
      setPriceLoading(false);
      return;
    }
    const requestId = ++priceRequestRef.current;
    setPriceLoading(true);
    try {
      const [pkgRes, daysRes, periodsRes, bandsRes] = await Promise.all([
        supabase.from('packages').select('*').eq('id', packageId).maybeSingle(),
        supabase.from('package_days').select('*').eq('package_id', packageId).order('day_number'),
        supabase.from('package_validity_periods').select('*').eq('package_id', packageId).order('valid_from'),
        supabase.from('package_pax_options').select('*').eq('package_id', packageId)
      ]);
      const firstError = [pkgRes, daysRes, periodsRes, bandsRes].find((res) => res.error);
      if (firstError?.error) throw firstError.error;
      if (!pkgRes.data) throw new Error('Package not found');

      /* A package stores its lines on package_day_items, not on library_items.
         Load them first, then the library rows and rates those lines refer to,
         exactly as the builder does before it prices a band. */
      const dayIds = (daysRes.data || []).map((day) => day.id);
      const itemRes = dayIds.length
        ? await supabase.from('package_day_items').select('*').in('package_day_id', dayIds).order('sort_order')
        : { data: [], error: null };
      if (itemRes.error) throw itemRes.error;
      const itemsByDay = new Map();
      (itemRes.data || []).forEach((item) => {
        itemsByDay.set(item.package_day_id, [
          ...(itemsByDay.get(item.package_day_id) || []),
          { ...item, rental: item.rental_details || null }
        ]);
      });
      const days = (daysRes.data || []).map((day) => ({
        ...day,
        services: itemsByDay.get(day.id) || []
      }));

      const usedIds = [...new Set((itemRes.data || []).map((item) => item.item_id).filter(Boolean))];
      let library = [];
      if (usedIds.length) {
        const [itemsRes, ratesRes, roomsByItem, carRatesByItem] = await Promise.all([
          selectLibraryItems((fields) => supabase.from('library_items').select(fields).in('id', usedIds)),
          supabase.from('item_rates').select('*').in('item_id', usedIds),
          fetchRoomTypesForItems(usedIds),
          fetchCarRentalRates(usedIds)
        ]);
        if (itemsRes.error) throw itemsRes.error;
        if (ratesRes.error) throw ratesRes.error;
        library = (itemsRes.data || []).map((item) => ({
          ...item,
          room_types: roomsByItem.get(item.id) || [],
          car_rental_rates: carRatesByItem[item.id] || [],
          item_rates: (ratesRes.data || []).filter((rate) => rate.item_id === item.id)
        }));
      }

      const prices = deriveSeriesPricesFromPackage({
        pkg: pkgRes.data,
        days,
        library,
        periods: periodsRes.data || [],
        bands: bandsRes.data || [],
        vehicleTypes,
        tourTypes,
        today
      });
      if (requestId !== priceRequestRef.current) return;
      setDerivedPrices(prices);
      if (apply) {
        setForm((current) => current.packageId === packageId
          ? {
              ...current,
              sharingPrice: String(prices.sharingPrice),
              singleSupplementPrice: String(prices.singleSupplementPrice),
              childPrice: String(prices.childPrice)
            }
          : current);
      }
    } catch {
      if (requestId !== priceRequestRef.current) return;
      setDerivedPrices(null);
    } finally {
      if (requestId === priceRequestRef.current) setPriceLoading(false);
    }
  }, [seriesPricesReady, today, tourTypes, vehicleTypes]);

  const missingPriceHint = !form.packageId ? '' : (derivedPrices?.hint
    || ([form.sharingPrice, form.singleSupplementPrice, form.childPrice].some((value) => !Number.isFinite(Number(value)) || Number(value) <= 0)
      ? 'The three prices are read from the package. Save a price on the package if they stay at zero.'
      : ''));

  const load = useCallback(async () => {
    if (!companyId) {
      setTemplates([]); setDepartures([]); setBookings([]); setPackages([]);
      setSeriesChart([]); setTourTypes([]); setVehicleTypes([]); setDerivedPrices(null);
      setSeriesPricesReady(false);
      setLoading(false);
      return;
    }
    try {
      /* tour_type arrives with the package tour-type migration; a workspace that
         has not run it still gets its packages under the long-standing columns. */
      const fetchPackages = async () => {
        const current = await supabase.from('packages')
          .select('id, name, currency_code, tour_type, rate_type')
          .eq('company_id', companyId).order('name');
        if (!current.error) return current;
        const withRateType = await supabase.from('packages')
          .select('id, name, currency_code, rate_type')
          .eq('company_id', companyId).order('name');
        if (!withRateType.error) return withRateType;
        return supabase.from('packages').select('id, name, currency_code').eq('company_id', companyId).order('name');
      };
      const [templateRes, departureRes, bookingRes, packageRes, chartRes, vehicleRes] = await Promise.all([
        supabase.from('series_templates').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
        supabase.from('series_departures').select('*').eq('company_id', companyId).order('departure_date'),
        supabase.from('series_bookings').select('departure_id, seats, status').eq('company_id', companyId),
        fetchPackages(),
        supabase.from('series_chart_bookings').select('*').eq('company_id', companyId).order('departure_date'),
        supabase.from('company_vehicle_types').select(VEHICLE_TYPES.columns).or(vocabularyReadFilter(companyId)).order(...VEHICLE_TYPES.orderBy)
      ]);
      if (templateRes.error) throw templateRes.error;
      if (departureRes.error) throw departureRes.error;
      if (bookingRes.error) throw bookingRes.error;
      if (packageRes.error) throw packageRes.error;
      if (vehicleRes.error) throw vehicleRes.error;
      const chartMissing = chartRes.error && (
        chartRes.error.code === '42P01'
        || chartRes.error.code === 'PGRST205'
        || /series_chart_bookings.*(does not exist|not found|schema cache)/i.test(chartRes.error.message || '')
      );
      if (chartRes.error && !chartMissing) throw chartRes.error;

      /* Tour types decide which packages are series products and which contract
         prices them. The fallback reads the pre-rate_type columns as the shared
         vocabulary does everywhere else. */
      const readTourTypes = (columns) => supabase
        .from(TOUR_TYPES.table)
        .select(columns)
        .or(vocabularyReadFilter(companyId))
        .order(...TOUR_TYPES.orderBy);
      let tourTypeRes = await readTourTypes(TOUR_TYPES.columns);
      if (tourTypeRes.error) tourTypeRes = await readTourTypes(TOUR_TYPES.baseColumns);
      if (tourTypeRes.error) throw tourTypeRes.error;

      /* The three snapshot columns are written only where this workspace has
         them; an older database still saves the one seat price it knows. */
      const priceColumns = await Promise.all([
        columnExists('series_templates', 'sharing_price'),
        columnExists('series_templates', 'single_supplement_price'),
        columnExists('series_templates', 'child_price'),
        columnExists('series_departures', 'sharing_price'),
        columnExists('series_departures', 'single_supplement_price'),
        columnExists('series_departures', 'child_price')
      ]);

      /* The duration is the package's own day count, read from the rows rather
         than stored a second time here where the two could disagree. */
      const packageIds = (packageRes.data || []).map((row) => row.id);
      const dayRes = packageIds.length
        ? await supabase.from('package_days').select('package_id, day_number').in('package_id', packageIds)
        : { data: [], error: null };
      if (dayRes.error) throw dayRes.error;
      const daysByPackage = new Map();
      (dayRes.data || []).forEach((row) => {
        daysByPackage.set(row.package_id, [...(daysByPackage.get(row.package_id) || []), row]);
      });

      setSchemaMissing(false);
      setTemplates(templateRes.data || []);
      setDepartures(departureRes.data || []);
      setBookings(bookingRes.data || []);
      setSeriesChart(chartMissing ? [] : chartRes.data || []);
      setSeriesChartMissing(!!chartMissing);
      setTourTypes(mergeVocabulary(tourTypeRes.data || [], TOUR_TYPES.keyColumn));
      setVehicleTypes(mergeVocabulary(vehicleRes.data || [], VEHICLE_TYPES.keyColumn));
      setSeriesPricesReady(priceColumns.every(Boolean));
      setPackages((packageRes.data || []).map((row) => ({
        ...row,
        ...templateDuration(daysByPackage.get(row.id) || [])
      })));
    } catch (err) {
      const message = String(err?.message || err);
      /* A workspace that has not applied the migration cannot select the tables
         at all. The page says which file is missing rather than shouting about a
         failed query, and the rest of the app carries on. */
      if (err?.code === '42P01' || err?.code === 'PGRST205'
        || (/series_/.test(message) && /does not exist|not found|schema cache/i.test(message))) {
        setSchemaMissing(true);
      } else {
        showToast(`Could not load series departures: ${message}`, 'error');
      }
      setTemplates([]); setDepartures([]); setBookings([]); setSeriesChart([]);
      setTourTypes([]); setVehicleTypes([]); setDerivedPrices(null);
      setSeriesPricesReady(false);
    } finally {
      setLoading(false);
    }
  }, [companyId, showToast]);

  useEffect(() => {
    void (async () => { await load(); })();
  }, [load]);

  const packageOf = useCallback((id) => packages.find((row) => row.id === id) || null, [packages]);
  const templateOf = useCallback((id) => templates.find((row) => row.id === id) || null, [templates]);

  const bookingsByDeparture = useMemo(() => {
    const map = new Map();
    bookings.forEach((row) => map.set(row.departure_id, [...(map.get(row.departure_id) || []), row]));
    return map;
  }, [bookings]);

  const rollupFor = useCallback((departure) => (
    seatRollup(bookingsByDeparture.get(departure.id) || [], departure.seat_capacity)
  ), [bookingsByDeparture]);

  const departuresOf = useCallback((templateId) => departures.filter((row) => row.template_id === templateId), [departures]);

  const currencyOptions = useMemo(() => {
    const known = currencies.map((row) => String(row.code || '').toUpperCase()).filter(Boolean);
    return [...new Set([...known, String(form.currency || 'ZAR').toUpperCase()])].sort();
  }, [currencies, form.currency]);

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError('');
    setDerivedPrices(null);
    setPriceLoading(false);
    setShowForm(true);
    setTab('templates');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openEdit = (template) => {
    setEditing(template);
    setForm(formOf(template));
    setFormError('');
    setDerivedPrices(null);
    setPriceLoading(false);
    setShowForm(true);
    setTab('templates');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    /* Saved figures stay authoritative; the derivation only supplies the hint
       when one of them is absent on an older template. */
    void deriveForPackage(template.package_id, false);
  };

  const choosePackage = (packageId) => {
    const pkg = packageOf(packageId);
    setForm((current) => ({
      ...current,
      packageId: packageId || '',
      currency: pkg?.currency_code ? String(pkg.currency_code).toUpperCase() : current.currency,
      sharingPrice: '',
      singleSupplementPrice: '',
      childPrice: ''
    }));
    setDerivedPrices(null);
    void deriveForPackage(packageId, true);
  };

  const closeForm = () => {
    priceRequestRef.current += 1;
    setShowForm(false);
    setEditing(null);
    setForm(emptyForm);
    setFormError('');
    setDerivedPrices(null);
    setPriceLoading(false);
  };

  /* Every refusal names the field and the figure, and stays on the form. A
     template that cannot generate a date is worse than one that was refused:
     the operator would only find out on the calendar. */
  const validate = () => {
    if (!form.name.trim()) return 'Give the series a name.';
    if (!form.packageId) return 'Choose the package this series runs. The itinerary and its rates live there.';
    if (!form.operatesOn.length) return 'Choose at least one weekday the tour departs on.';
    if (!form.validFrom || !form.validTo) return 'Both ends of the validity window are needed before any date can be generated.';
    if (form.validTo < form.validFrom) return `The window ends (${dateLabel(form.validTo)}) before it starts (${dateLabel(form.validFrom)}).`;
    const min = wholeNumber(form.minPax);
    const max = wholeNumber(form.maxPax);
    const guarantee = wholeNumber(form.guaranteeMin);
    const seats = form.seats === '' ? 0 : wholeNumber(form.seats);
    const release = form.releaseDays === '' ? 0 : wholeNumber(form.releaseDays);
    if (!Number.isFinite(min) || min < 1) return 'The minimum party size must be at least 1.';
    if (!Number.isFinite(max) || max < min) return `The maximum party size (${form.maxPax}) cannot be below the minimum (${min}).`;
    if (!Number.isFinite(guarantee) || guarantee < 0) return 'The guarantee minimum cannot be negative. Use 0 for no guarantee rule.';
    if (guarantee > max) return `A guarantee of ${guarantee} above the ceiling of ${max} could never be met, so the departure would sit open for ever.`;
    if (!Number.isFinite(seats) || seats < 0) return 'Seats per departure cannot be negative. Leave it blank for no cap yet.';
    if (seats > 0 && max > seats) return `The series takes parties up to ${max} but only offers ${seats} seats. Raise the seats or lower the maximum.`;
    if (!Number.isFinite(release) || release < 0) return 'The release period cannot be negative. Use 0 for no release control.';
    const prices = [form.sharingPrice, form.singleSupplementPrice, form.childPrice]
      .map((value) => (value === '' ? 0 : Number(value)));
    if (prices.some((value) => !Number.isFinite(value) || value < 0)) {
      return 'Prices come from the package and cannot be negative. A zero means the package does not define that figure yet.';
    }
    if (!generateDepartureDates({ operatesOn: form.operatesOn, validFrom: form.validFrom, validTo: form.validTo }).length) {
      return `No ${operatesLabel(form.operatesOn)} falls between ${dateLabel(form.validFrom)} and ${dateLabel(form.validTo)}. Widen the window or change the weekdays.`;
    }
    return '';
  };

  const saveTemplate = async (event) => {
    event.preventDefault();
    const problem = validate();
    if (problem) { setFormError(problem); return; }
    if (!companyId) { setFormError('No company is selected. Pick a tenant in the sidebar first.'); return; }
    setFormError('');
    setSaving(true);
    try {
      const payload = {
        company_id: companyId,
        package_id: form.packageId,
        name: form.name.trim(),
        code: form.code.trim(),
        operates_on: [...form.operatesOn].sort((a, b) => a - b),
        valid_from: form.validFrom,
        valid_to: form.validTo,
        min_pax: wholeNumber(form.minPax),
        max_pax: wholeNumber(form.maxPax),
        guarantee_min: wholeNumber(form.guaranteeMin),
        seats_per_departure: form.seats === '' ? 0 : wholeNumber(form.seats),
        release_days: form.releaseDays === '' ? 0 : wholeNumber(form.releaseDays),
        /* The migration keeps price_per_seat equal to sharing_price by trigger.
           Unmigrated workspaces still get the one column they know. */
        ...(seriesPricesReady
          ? {
              sharing_price: Number(form.sharingPrice) || 0,
              single_supplement_price: Number(form.singleSupplementPrice) || 0,
              child_price: Number(form.childPrice) || 0
            }
          : { price_per_seat: Number(form.sharingPrice) || 0 }),
        currency_code: String(form.currency || 'ZAR').toUpperCase(),
        status: form.status,
        notes: form.notes.trim()
      };
      const { error } = editing
        ? await supabase.from('series_templates').update(payload).eq('id', editing.id).eq('company_id', companyId)
        : await supabase.from('series_templates').insert(payload);
      if (error) throw error;
      showToast(editing ? `${payload.name} updated` : `${payload.name} created — generate its dates on the calendar`, 'success');
      closeForm();
      await load();
    } catch (err) {
      showToast(`Could not save the series: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeTemplate = async (template) => {
    const own = departuresOf(template.id);
    const held = own.reduce((sum, row) => sum + (bookingsByDeparture.get(row.id)?.length || 0), 0);
    /* Deleting the template cascades to its departures and their seat ledger.
       A series that has sold a place is a record, so it is archived instead. */
    if (held > 0) {
      showToast(`"${template.name}" holds ${held} booking${held === 1 ? '' : 's'} across its departures. Edit it and set the status to Archived instead — deleting would take the sold seats with it.`, 'warning');
      return;
    }
    const ok = await confirm({
      title: 'Delete this series?',
      message: `"${template.name}" will be removed.`,
      detail: own.length
        ? `Its ${own.length} generated departure${own.length === 1 ? '' : 's'} go with it. None of them holds a booking. The package it runs is not touched.`
        : 'It has no departures yet. The package it runs is not touched.',
      confirmLabel: 'Delete series',
      destructive: true
    });
    if (!ok) return;
    try {
      const { error } = await supabase.from('series_templates').delete().eq('id', template.id).eq('company_id', companyId);
      if (error) throw error;
      showToast('Series deleted', 'success');
      await load();
    } catch (err) {
      showToast(`Could not delete the series: ${err.message}`, 'error');
    }
  };

  /* One action produces the whole calendar. Generation is additive: a date that
     already exists is left exactly as it is, because it may be half sold. */
  const generateFor = async (template) => {
    const schedule = generateDepartureDates({
      operatesOn: template.operates_on,
      validFrom: template.valid_from,
      validTo: template.valid_to
    });
    if (!schedule.length) {
      showToast(`"${template.name}" produces no dates. Set the weekdays it operates and a validity window that contains one.`, 'warning');
      return;
    }
    const existing = new Set(departuresOf(template.id).map((row) => String(row.departure_date).slice(0, 10)));
    const dates = schedule.filter((iso) => !existing.has(iso));
    if (!dates.length) {
      showToast(`Every ${operatesLabel(template.operates_on)} between ${dateLabel(template.valid_from)} and ${dateLabel(template.valid_to)} is already on the calendar (${schedule.length} departures).`, 'success');
      return;
    }
    const pkg = packageOf(template.package_id);
    const durationDays = pkg?.durationDays || 0;
    const sharing = Number(template.sharing_price ?? template.price_per_seat) || 0;
    const priceText = seriesPricesReady
      ? `${money(sharing, template.currency_code)} sharing, ${money(template.single_supplement_price, template.currency_code)} single supplement, ${money(template.child_price, template.currency_code)} child`
      : `${money(sharing, template.currency_code)} per seat`;
    const ok = await confirm({
      title: `Add ${dates.length} departure${dates.length === 1 ? '' : 's'}?`,
      message: `${dateLabel(dates[0])} to ${dateLabel(dates[dates.length - 1])}, departing ${operatesLabel(template.operates_on)}.`,
      detail: [
        `${existing.size} departure${existing.size === 1 ? '' : 's'} already on this calendar are left untouched.`,
        Number(template.seats_per_departure) > 0
          ? `Each is opened with ${template.seats_per_departure} seats at ${priceText}.`
          : `No seat cap is stated on the series, so each departure opens with no cap until the allocations are loaded. Prices are ${priceText}.`,
        durationDays > 0
          ? `Return dates follow the package's ${durationDays} days.`
          : 'The package has no days built yet, so no return date is recorded.'
      ].join(' '),
      confirmLabel: `Add ${dates.length} departure${dates.length === 1 ? '' : 's'}`
    });
    if (!ok) return;
    setSaving(true);
    try {
      const rows = dates.map((iso) => ({
        company_id: companyId,
        template_id: template.id,
        departure_date: iso,
        departure_code: departureCode(iso),
        return_date: durationDays > 0 ? returnDateFor(iso, durationDays) : null,
        status: 'open',
        seat_capacity: Number(template.seats_per_departure) || 0,
        guarantee_min: Number(template.guarantee_min) || 0,
        ...(seriesPricesReady
          ? {
              sharing_price: Number(template.sharing_price ?? template.price_per_seat) || 0,
              single_supplement_price: Number(template.single_supplement_price) || 0,
              child_price: Number(template.child_price) || 0
            }
          : { price_per_seat: sharing }),
        currency_code: template.currency_code || 'ZAR',
        release_date: releaseDateFor(iso, template.release_days)
      }));
      const { error } = await supabase.from('series_departures').insert(rows);
      if (error) throw error;
      showToast(`${rows.length} departure${rows.length === 1 ? '' : 's'} added to ${template.name}`, 'success');
      setSelected([]);
      await load();
    } catch (err) {
      showToast(`Could not generate the dates: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const visibleTemplates = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return templates;
    return templates.filter((row) => `${row.name} ${row.code} ${packageOf(row.package_id)?.name || ''}`.toLowerCase().includes(term));
  }, [templates, search, packageOf]);

  const visibleDepartures = useMemo(() => departures.filter((row) => (
    (calendarTemplate === 'all' || row.template_id === calendarTemplate)
    && (calendarStatus === 'all' || row.status === calendarStatus)
  )), [departures, calendarTemplate, calendarStatus]);

  const selectedRows = useMemo(() => {
    const chosen = new Set(selected);
    return visibleDepartures.filter((row) => chosen.has(row.id));
  }, [visibleDepartures, selected]);

  const toggleRow = (id) => setSelected((prev) => (prev.includes(id) ? prev.filter((row) => row !== id) : [...prev, id]));
  const allVisibleSelected = visibleDepartures.length > 0 && selectedRows.length === visibleDepartures.length;

  const applyBulkStatus = async () => {
    if (!selectedRows.length) return;
    const ok = await confirm({
      title: `Set ${selectedRows.length} departure${selectedRows.length === 1 ? '' : 's'} to ${departureStatusLabel(bulkStatus)}?`,
      message: `${dateLabel(selectedRows[0].departure_date)} to ${dateLabel(selectedRows[selectedRows.length - 1].departure_date)}.`,
      detail: bulkStatus === 'cancelled' || bulkStatus === 'closed'
        ? 'No further seats can be sold on a departure in this state. Bookings already taken are not changed.'
        : 'This is an operator decision. The seat arithmetic will not overrule it.',
      confirmLabel: `Set ${departureStatusLabel(bulkStatus)}`
    });
    if (!ok) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('series_departures')
        .update({ status: bulkStatus })
        .in('id', selectedRows.map((row) => row.id))
        .eq('company_id', companyId);
      if (error) throw error;
      showToast(`${selectedRows.length} departure${selectedRows.length === 1 ? '' : 's'} set to ${departureStatusLabel(bulkStatus)}`, 'success');
      setSelected([]);
      await load();
    } catch (err) {
      showToast(`Could not change the status: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteSelected = async () => {
    if (!selectedRows.length) return;
    const booked = selectedRows.filter((row) => (bookingsByDeparture.get(row.id)?.length || 0) > 0);
    const removable = selectedRows.filter((row) => !bookingsByDeparture.get(row.id)?.length);
    if (!removable.length) {
      showToast(`Every selected departure holds a booking, so none was deleted. Set them to Cancelled instead — the seat ledger is the record of what was sold.`, 'warning');
      return;
    }
    const ok = await confirm({
      title: `Delete ${removable.length} departure${removable.length === 1 ? '' : 's'}?`,
      message: `${dateLabel(removable[0].departure_date)} to ${dateLabel(removable[removable.length - 1].departure_date)}.`,
      detail: booked.length
        ? `${booked.length} of the selection hold bookings and are kept. Generating the series again will re-create the deleted dates.`
        : 'None holds a booking. Generating the series again will re-create these dates.',
      confirmLabel: `Delete ${removable.length}`,
      destructive: true
    });
    if (!ok) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('series_departures')
        .delete()
        .in('id', removable.map((row) => row.id))
        .eq('company_id', companyId);
      if (error) throw error;
      showToast(`${removable.length} departure${removable.length === 1 ? '' : 's'} deleted${booked.length ? `; ${booked.length} with bookings kept` : ''}`, 'success');
      setSelected([]);
      await load();
    } catch (err) {
      showToast(`Could not delete the departures: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const chosenTemplate = calendarTemplate === 'all' ? null : templateOf(calendarTemplate);
  const seatsSold = departures.reduce((sum, row) => sum + rollupFor(row).sold, 0);
  const upcoming = departures.filter((row) => row.departure_date >= today && row.status !== 'cancelled').length;

  const tabs = [
    { id: 'templates', label: 'Series Templates', count: templates.length },
    { id: 'calendar', label: 'Departure Calendar', count: departures.length },
    { id: 'chart', label: 'Series Chart', count: seriesChart.length }
  ];

  return (
    <div className="super-admin-page" style={{ paddingBottom: '4rem' }}>
      <header className="page-header" style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
        <div className="header-title">
          <CalendarRange className="header-icon" />
          <div>
            <h1>Series Departures</h1>
            <p>Fixed dates sold seat by seat out of the rooms and vehicles you hold from the supplier</p>
          </div>
        </div>
        {mayWrite && !schemaMissing && (
          <button className="primary-btn" style={{ width: 'auto', padding: '0.625rem 1.25rem', background: '#0d7478', display: 'flex', alignItems: 'center', gap: '0.4rem' }} onClick={openAdd}>
            <Plus size={18} /> New Series
          </button>
        )}
      </header>

      <div style={{ background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: '12px', padding: '0.9rem 1.1rem', marginBottom: '1.5rem', fontSize: '0.85rem', color: '#134e4a', maxWidth: '70rem' }}>
        <strong>The itinerary stays on the package.</strong> A series points at a package and adds only what a package deliberately does not carry: the weekdays it runs, the seats offered, the number that guarantees it, and the day unsold rooms go back. Sold seats are counted from the bookings, never typed in here.
        <div style={{ marginTop: '0.55rem' }}><strong>Current booking flow:</strong></div>
        <ol style={{ margin: '0.25rem 0 0 1.25rem', padding: 0 }}>
          <li>Create the series template from a package, set its operating weekdays and date window, then generate the departure dates here.</li>
          <li>Create an itinerary (new itineraries currently start as Quotations) with exact dates, then add the linked package on the itinerary day matching an open departure. The schedule check applies to that package section even if the overall itinerary is FIT.</li>
          <li>Complete the required supplier confirmations and mark the itinerary Confirmed. A Series-type itinerary appears in Series Chart; an FIT itinerary with a Series section does not, because the chart still uses the itinerary-wide tour type.</li>
        </ol>
        <div style={{ marginTop: '0.55rem' }}>
          <strong>Important:</strong> The package-section guard verifies the selected day against an active series departure and labels it as a Series section, but it does not change that line&apos;s pricing contract or reserve seats. Series Chart is a confirmation report, not a seat reservation; confirming an itinerary does not reduce departure availability or create a row in the departure seat ledger. Separate FIT and Series pricing contracts within one itinerary are not yet supported.
        </div>
      </div>

      {!mayWrite && !schemaMissing && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.7rem 1.1rem', marginBottom: '1.5rem', fontSize: '0.82rem', color: '#475569' }}>
          Series Departures is view-only for your role. Ask an Admin for write access to build a series or change a departure.
        </div>
      )}

      {schemaMissing ? (
        <div className="admin-table-container" style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
          <CalendarRange size={48} style={{ marginBottom: '1rem', opacity: 0.4 }} />
          <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.4rem' }}>Series Departures is not on this workspace yet</h3>
          <p style={{ maxWidth: '460px', margin: '0 auto', fontSize: '0.85rem' }}>
            Applying migration <code>{MIGRATION}</code> creates the templates, departures, allocations and seat ledger. Packages and private tours work exactly as they do today until then.
          </p>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
            {tabs.map((entry) => (
              <button
                key={entry.id}
                onClick={() => { setTab(entry.id); setSelected([]); }}
                style={{
                  padding: '0.55rem 1.15rem',
                  borderRadius: '8px',
                  border: '1px solid ' + (tab === entry.id ? '#0d7478' : '#e2e8f0'),
                  background: tab === entry.id ? '#0d7478' : '#fff',
                  color: tab === entry.id ? '#fff' : '#475569',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                {entry.label} <span style={{ opacity: 0.7 }}>({entry.count})</span>
              </button>
            ))}
          </div>

          {tab === 'chart' && (
            <div className="admin-table-container">
              <div className="table-header-actions">
                <h2 style={{ margin: 0, fontSize: '1rem', color: '#1e293b' }}>Confirmed series itineraries</h2>
                <button type="button" className="secondary-btn" style={{ width: 'auto', padding: '0.5rem 1rem' }} onClick={() => void load()} disabled={loading}>
                  Refresh
                </button>
              </div>
              {seriesChartMissing ? (
                <p style={{ padding: '1rem 1.25rem', color: '#64748b' }}>
                  Apply migration <code>20261270</code> to enable the automatic confirmed-series chart.
                </p>
              ) : (
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Consultant</th><th>Itinerary ref #</th><th>Series name</th>
                      <th>Series code / type</th><th>Series dates</th><th>Pickup hotel</th><th>Drop-off hotel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {seriesChart.length === 0 ? (
                      <tr><td colSpan="7" style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                        {loading ? 'Loading confirmed series itineraries…' : 'No confirmed series itineraries yet. Confirm a series-type itinerary to add its summary here; this does not reserve seats.'}
                      </td></tr>
                    ) : seriesChart.map((entry) => (
                      <tr key={entry.id}>
                        <td>{entry.consultant_name || '—'}</td>
                        <td>{entry.itinerary_ref || '—'}</td>
                        <td>{entry.series_name || '—'}</td>
                        <td>{entry.series_code || '—'}</td>
                        <td>{dateLabel(entry.departure_date)}{entry.return_date ? ` – ${dateLabel(entry.return_date)}` : ''}</td>
                        <td>{entry.pickup_hotel || '—'}</td>
                        <td>{entry.dropoff_hotel || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tab !== 'chart' && (
            <>
          {tab === 'calendar' && !loading && templates.length > 0 && (
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
              <Stat label="Series" value={templates.length} />
              <Stat label="Departures" value={departures.length} tone="#0d7478" />
              <Stat label="Still to run" value={upcoming} tone="#0d7478" />
              <Stat label="Seats sold" value={seatsSold} tone={seatsSold > 0 ? '#15803d' : '#94a3b8'} />
            </div>
          )}

          {showForm && mayWrite && tab === 'templates' && (
            <div style={{ background: '#fff', borderRadius: '16px', padding: '2rem', border: '1px solid #cbd5e1', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.05)', marginBottom: '2.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CalendarRange size={22} color="#0d7478" /> {editing ? `Edit Series: ${editing.name}` : 'New Series'}
                </h2>
                <button onClick={closeForm} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }} title="Close form">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={saveTemplate}>
                <SectionTitle>What runs</SectionTitle>
                {seriesPackages.length === 0 ? (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '0.9rem 1.1rem', color: '#92400e', fontSize: '0.85rem' }}>
                    {packages.length === 0
                      ? 'No packages yet. A series runs a package, so build the fixed itinerary and its contracted rates first.'
                      : 'No package is marked as a tour series yet. Give one a Tour type that maps to a series contract on the Packages page.'}
                    <button type="button" className="secondary-btn" style={{ width: 'auto', padding: '0.4rem 1rem', marginLeft: '0.75rem' }} onClick={() => navigate('/packages')}>Open Packages</button>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <Field label="Series name">
                      <input type="text" className="pricing-select" placeholder="Cape Town & Garden Route Explorer" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    </Field>
                    <Field label="Series code" hint="Your own reference, if you keep one. Departure codes are generated from the date.">
                      <input type="text" className="pricing-select" placeholder="CTGR-7" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
                    </Field>
                    <Field label="Package it runs" hint={form.packageId && packageOf(form.packageId)
                      ? `${packageOf(form.packageId).durationDays} days / ${packageOf(form.packageId).durationNights} nights`
                      : 'The days, services and contracted rates are edited on the package.'}>
                      <SearchableSelect
                        className="pricing-select"
                        value={form.packageId}
                        onChange={(e) => choosePackage(e.target.value)}
                      >
                        <option value="">Choose a series package…</option>
                        {seriesPackages.map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.name}</option>)}
                      </SearchableSelect>
                    </Field>
                    <Field label="Status" hint="Only an active series is offered for sale. Archived keeps its history.">
                      <select className="pricing-select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                        <option value="draft">Draft — still being set up</option>
                        <option value="active">Active — on sale</option>
                        <option value="archived">Archived — no longer sold</option>
                      </select>
                    </Field>
                  </div>
                )}

                <SectionTitle>When it departs</SectionTitle>
                <Field label="Operates on" hint="Departure dates are generated on these weekdays inside the window below.">
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
                    {WEEKDAYS.map((day) => {
                      const on = form.operatesOn.includes(day.value);
                      return (
                        <button
                          type="button"
                          key={day.value}
                          title={day.label}
                          onClick={() => setForm({ ...form, operatesOn: on ? form.operatesOn.filter((value) => value !== day.value) : [...form.operatesOn, day.value] })}
                          style={{
                            padding: '0.45rem 0.9rem', borderRadius: '8px', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer',
                            border: '1px solid ' + (on ? '#0d7478' : '#e2e8f0'),
                            background: on ? '#0d7478' : '#fff',
                            color: on ? '#fff' : '#475569'
                          }}
                        >
                          {day.short}
                        </button>
                      );
                    })}
                  </div>
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
                  <Field label="Valid from">
                    <input type="date" className="pricing-select" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />
                  </Field>
                  <Field label="Valid to">
                    <input type="date" className="pricing-select" value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.target.value })} />
                  </Field>
                </div>

                <SectionTitle>Seats, guarantee and release</SectionTitle>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <Field label="Minimum party size">
                    <input type="number" min="1" step="1" className="pricing-select" value={form.minPax} onChange={(e) => setForm({ ...form, minPax: e.target.value })} />
                  </Field>
                  <Field label="Maximum party size">
                    <input type="number" min="1" step="1" className="pricing-select" value={form.maxPax} onChange={(e) => setForm({ ...form, maxPax: e.target.value })} />
                  </Field>
                  <Field label="Guaranteed at (paying passengers)" hint="Once this many seats are sold the departure runs. 0 means no guarantee rule.">
                    <input type="number" min="0" step="1" className="pricing-select" value={form.guaranteeMin} onChange={(e) => setForm({ ...form, guaranteeMin: e.target.value })} />
                  </Field>
                  <Field label="Seats offered per departure" hint="Blank means no cap stated yet — the allocations decide it, and nothing is refused.">
                    <input type="number" min="0" step="1" className="pricing-select" placeholder="No cap stated yet" value={form.seats} onChange={(e) => setForm({ ...form, seats: e.target.value })} />
                  </Field>
                  <Field label="Release period (days before departure)" hint="Unsold rooms go back to the supplier this many days before arrival. 0 means no release control.">
                    <input type="number" min="0" step="1" className="pricing-select" value={form.releaseDays} onChange={(e) => setForm({ ...form, releaseDays: e.target.value })} />
                  </Field>
                  <Field label="Currency">
                    <select className="pricing-select" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                      {currencyOptions.map((code) => <option key={code} value={code}>{code}</option>)}
                    </select>
                  </Field>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <Field
                      label="Selling prices (read from the package)"
                      hint="Changing the package refills these from its first active season and smallest priced pax band. Saved figures on an existing series are kept."
                    >
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.75rem' }}>
                        {[
                          ['Price per person sharing', 'sharingPrice'],
                          ['Single supplement', 'singleSupplementPrice'],
                          ['Child price', 'childPrice']
                        ].map(([label, key]) => (
                          <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b' }}>{label}</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              readOnly
                              aria-label={label}
                              className="pricing-select"
                              placeholder={priceLoading ? 'Reading…' : 'From package'}
                              value={form[key]}
                            />
                          </label>
                        ))}
                      </div>
                      {derivedPrices && (
                        <small style={{ display: 'block', marginTop: '0.35rem', color: '#64748b' }}>
                          {derivedPrices.pax ? `${derivedPrices.pax} pax band` : 'No priced pax band'}
                          {derivedPrices.period ? ` · ${derivedPrices.period}` : ''} · {derivedPrices.currency}
                        </small>
                      )}
                      {missingPriceHint && (
                        <div role="status" style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start', marginTop: '0.5rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '0.5rem 0.7rem', color: '#92400e', fontSize: '0.78rem' }}>
                          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
                          <span>{missingPriceHint}</span>
                        </div>
                      )}
                    </Field>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <Field label="Notes">
                      <textarea className="pricing-select" rows="2" placeholder="Anything the desk should know about this series" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ width: '100%', resize: 'vertical' }} />
                    </Field>
                  </div>
                </div>

                {formError && (
                  <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '0.8rem 1rem', marginTop: '1.25rem', color: '#b91c1c', fontSize: '0.85rem' }}>
                    <AlertTriangle size={17} style={{ flexShrink: 0, marginTop: '1px' }} />
                    <span>{formError}</span>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
                  <button type="button" className="secondary-btn" style={{ width: 'auto', padding: '0.625rem 1.5rem' }} onClick={closeForm} disabled={saving}>Cancel</button>
                  <button type="submit" className="primary-btn" style={{ background: '#0d7478', width: 'auto', padding: '0.625rem 1.5rem' }} disabled={saving || !seriesPackages.length}>
                    {saving ? 'Saving…' : editing ? 'Save changes' : 'Create series'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {tab === 'templates' ? (
            <div className="admin-table-container">
              <div className="table-header-actions">
                <div className="search-box" style={{ flex: 1, width: 'auto', maxWidth: '520px' }}>
                  <Search size={18} color="#94a3b8" />
                  <input type="text" placeholder="Search by series, code or package…" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <span style={{ fontSize: '0.82rem', color: '#64748b' }}>{visibleTemplates.length} series</span>
              </div>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Series</th>
                    <th>Package</th>
                    <th>Operates on</th>
                    <th>Validity</th>
                    <th>Party size</th>
                    <th>Seats &amp; price</th>
                    <th>Release</th>
                    <th>Departures</th>
                    <th>Status</th>
                    {mayWrite && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={mayWrite ? 10 : 9} className="text-center" style={{ padding: '3rem' }}>Loading series…</td></tr>
                  ) : visibleTemplates.length === 0 ? (
                    <tr>
                      <td colSpan={mayWrite ? 10 : 9} className="text-center" style={{ padding: '3rem', color: '#64748b' }}>
                        <CalendarRange size={48} style={{ marginBottom: '1rem', opacity: 0.4 }} />
                        <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.4rem' }}>{search ? 'No series matches' : 'No series yet'}</h3>
                        <p style={{ maxWidth: '440px', margin: '0 auto 1.25rem' }}>
                          {search ? 'Try a different search term.' : 'Point a series at a package, say which weekdays it runs, and generate the calendar from it.'}
                        </p>
                        {!search && mayWrite && (
                          <button className="primary-btn" style={{ width: 'auto', padding: '0.625rem 1.5rem', background: '#0d7478' }} onClick={openAdd}>
                            <Plus size={18} /> Create your first series
                          </button>
                        )}
                      </td>
                    </tr>
                  ) : visibleTemplates.map((template) => {
                    const pkg = packageOf(template.package_id);
                    const own = departuresOf(template.id);
                    const seats = Number(template.seats_per_departure) || 0;
                    return (
                      <tr key={template.id} style={template.status === 'archived' ? { opacity: 0.6 } : undefined}>
                        <td>
                          <div className="company-cell">
                            <div>
                              <span className="company-name">{template.name}</span>
                              <span className="company-id">{template.code || 'No code'}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          {pkg ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                              <button type="button" className="package-list-name" onClick={() => navigate(`/packages/view/${pkg.id}`)}>{pkg.name}</button>
                              <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                                {pkg.durationDays > 0 ? `${pkg.durationDays} days / ${pkg.durationNights} nights` : 'No days built yet'}
                              </span>
                            </div>
                          ) : <span style={{ color: '#b91c1c', fontSize: '0.85rem' }}>Package no longer available</span>}
                        </td>
                        <td style={{ fontSize: '0.85rem', color: '#475569' }}>
                          {operatesLabel(template.operates_on) || <span style={{ color: '#b45309' }}>No weekdays set</span>}
                        </td>
                        <td style={{ fontSize: '0.82rem', color: '#475569' }}>
                          {dateLabel(template.valid_from)}<br />to {dateLabel(template.valid_to)}
                        </td>
                        <td style={{ fontSize: '0.85rem', color: '#475569' }}>
                          {template.min_pax}–{template.max_pax} pax
                          <div style={{ fontSize: '0.78rem', color: Number(template.guarantee_min) > 0 ? '#15803d' : '#94a3b8' }}>
                            {Number(template.guarantee_min) > 0 ? `Guarantees at ${template.guarantee_min}` : 'No guarantee rule'}
                          </div>
                        </td>
                        <td style={{ fontSize: '0.85rem' }}>
                          <div style={{ fontWeight: 700, color: seats > 0 ? '#1e293b' : '#b45309', marginBottom: '0.35rem' }}>
                            {seats > 0 ? `${seats} seats` : 'No cap stated'}
                          </div>
                          <PriceGroup row={template} currency={template.currency_code} />
                        </td>
                        <td style={{ fontSize: '0.85rem', color: '#475569' }}>
                          {Number(template.release_days) > 0 ? `${template.release_days} days before` : <span style={{ color: '#94a3b8' }}>No release control</span>}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="package-list-name"
                            onClick={() => { setCalendarTemplate(template.id); setCalendarStatus('all'); setSelected([]); setTab('calendar'); }}
                            title="Open this series on the calendar"
                          >
                            {own.length}
                          </button>
                        </td>
                        <td><TemplateStatusBadge status={template.status} /></td>
                        {mayWrite && (
                          <td>
                            <div className="action-buttons">
                              <button className="action-btn" onClick={() => generateFor(template)} title="Generate the missing departure dates" disabled={saving}>
                                <CalendarPlus size={16} />
                              </button>
                              <button className="action-btn" onClick={() => openEdit(template)} title="Edit series">
                                <Edit3 size={16} />
                              </button>
                              <button className="action-btn delete" onClick={() => removeTemplate(template)} title="Delete series">
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="admin-table-container">
              <div className="table-header-actions" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
                <SearchableSelect
                  className="pricing-select"
                  style={{ width: '320px' }}
                  value={calendarTemplate}
                  onChange={(e) => { setCalendarTemplate(e.target.value); setSelected([]); }}
                >
                  <option value="all">All series ({departures.length} departures)</option>
                  {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                </SearchableSelect>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {[{ id: 'all', label: 'All' }, ...DEPARTURE_STATUSES.map((status) => ({ id: status, label: departureStatusLabel(status) }))].map((entry) => (
                    <button
                      key={entry.id}
                      onClick={() => { setCalendarStatus(entry.id); setSelected([]); }}
                      style={{
                        padding: '0.4rem 0.85rem', borderRadius: '8px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                        border: '1px solid ' + (calendarStatus === entry.id ? '#0d7478' : '#e2e8f0'),
                        background: calendarStatus === entry.id ? '#0d7478' : '#fff',
                        color: calendarStatus === entry.id ? '#fff' : '#475569'
                      }}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
                {mayWrite && chosenTemplate && (
                  <button
                    className="primary-btn"
                    style={{ width: 'auto', padding: '0.5rem 1.1rem', background: '#0d7478', display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: 'auto' }}
                    onClick={() => generateFor(chosenTemplate)}
                    disabled={saving}
                  >
                    <CalendarPlus size={17} /> Generate missing dates
                  </button>
                )}
              </div>

              {mayWrite && !chosenTemplate && templates.length > 0 && (
                <div style={{ padding: '0 1.25rem 0.9rem', fontSize: '0.8rem', color: '#64748b' }}>
                  Choose one series above to generate its missing dates, or use the calendar button on its row in Series Templates.
                </div>
              )}

              {mayWrite && selectedRows.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: '10px', padding: '0.7rem 1rem', margin: '0 1.25rem 1rem' }}>
                  <strong style={{ fontSize: '0.85rem', color: '#134e4a' }}>{selectedRows.length} selected</strong>
                  <select className="pricing-select" style={{ width: 'auto', minWidth: '11rem' }} value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
                    {DEPARTURE_STATUSES.map((status) => <option key={status} value={status}>{departureStatusLabel(status)}</option>)}
                  </select>
                  <button className="primary-btn" style={{ width: 'auto', padding: '0.45rem 1.1rem', background: '#0d7478' }} onClick={applyBulkStatus} disabled={saving}>
                    Set status
                  </button>
                  <button className="secondary-btn" style={{ width: 'auto', padding: '0.45rem 1.1rem', color: '#b91c1c' }} onClick={deleteSelected} disabled={saving}>
                    Delete selected
                  </button>
                  <button className="secondary-btn" style={{ width: 'auto', padding: '0.45rem 1.1rem', marginLeft: 'auto' }} onClick={() => setSelected([])}>
                    Clear selection
                  </button>
                </div>
              )}

              <table className="admin-table">
                <thead>
                  <tr>
                    {mayWrite && (
                      <th style={{ width: '2.5rem' }}>
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          disabled={visibleDepartures.length === 0}
                          title="Select every departure listed"
                          onChange={() => setSelected(allVisibleSelected ? [] : visibleDepartures.map((row) => row.id))}
                        />
                      </th>
                    )}
                    <th>Departure</th>
                    <th>Code</th>
                    <th>Series</th>
                    <th>Returns</th>
                    <th>Seats</th>
                    <th>Status</th>
                    <th>Release back</th>
                    <th>Prices</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={mayWrite ? 9 : 8} className="text-center" style={{ padding: '3rem' }}>Loading departures…</td></tr>
                  ) : visibleDepartures.length === 0 ? (
                    <tr>
                      <td colSpan={mayWrite ? 9 : 8} className="text-center" style={{ padding: '3rem', color: '#64748b' }}>
                        <CalendarRange size={48} style={{ marginBottom: '1rem', opacity: 0.4 }} />
                        <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.4rem' }}>
                          {departures.length === 0 ? 'No departures generated yet' : 'No departure matches this filter'}
                        </h3>
                        <p style={{ maxWidth: '460px', margin: '0 auto' }}>
                          {departures.length === 0
                            ? 'Create a series, then generate its dates. Every weekday it operates inside the validity window becomes one departure.'
                            : 'Choose another series or status.'}
                        </p>
                      </td>
                    </tr>
                  ) : visibleDepartures.map((departure) => {
                    const seats = rollupFor(departure);
                    const template = templateOf(departure.template_id);
                    const releaseDue = departure.release_date && departure.release_date <= today
                      && ['open', 'guaranteed', 'waitlist'].includes(departure.status);
                    return (
                      <tr key={departure.id} style={selected.includes(departure.id) ? { background: '#f0fdfa' } : undefined}>
                        {mayWrite && (
                          <td><input type="checkbox" checked={selected.includes(departure.id)} onChange={() => toggleRow(departure.id)} /></td>
                        )}
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.88rem' }}>{dateLabel(departure.departure_date)}</span>
                            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{dayShort(departure.departure_date)}</span>
                          </div>
                        </td>
                        <td style={{ fontSize: '0.8rem', color: '#475569', fontFamily: 'monospace' }}>{departure.departure_code}</td>
                        <td style={{ fontSize: '0.85rem', color: '#475569' }}>{template?.name || 'Series no longer available'}</td>
                        <td style={{ fontSize: '0.82rem', color: '#475569' }}>
                          {departure.return_date ? dateLabel(departure.return_date) : <span style={{ color: '#b45309' }}>No return date</span>}
                        </td>
                        <td style={{ fontSize: '0.85rem' }}>
                          <div style={{ fontWeight: 700, color: '#1e293b' }}>
                            {seats.sold} sold{seats.capacity > 0 ? ` of ${seats.capacity}` : ''}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: seats.remaining === 0 ? '#b45309' : '#64748b' }}>
                            {seats.remaining === null ? 'No cap stated' : `${seats.remaining} remaining`}
                            {seats.optioned > 0 && ` · ${seats.optioned} on option`}
                            {seats.waitlisted > 0 && ` · ${seats.waitlisted} waiting`}
                          </div>
                        </td>
                        <td><StatusBadge status={departure.status} /></td>
                        <td style={{ fontSize: '0.82rem', color: releaseDue ? '#b45309' : '#475569', fontWeight: releaseDue ? 700 : 400 }}>
                          {departure.release_date
                            ? dateLabel(departure.release_date)
                            : <span style={{ color: '#94a3b8' }}>No release control</span>}
                        </td>
                        <td style={{ fontSize: '0.85rem' }}>
                          <PriceGroup row={departure} currency={departure.currency_code} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!loading && visibleDepartures.length > 0 && (
                <div style={{ padding: '0.9rem 1.25rem', fontSize: '0.8rem', color: '#64748b' }}>
                  {visibleDepartures.length} departure{visibleDepartures.length === 1 ? '' : 's'} listed
                  {calendarStatus !== 'all' || calendarTemplate !== 'all' ? ` of ${departures.length}` : ''}.
                  Sold seats are counted from the booking ledger; the database refuses a sale beyond the cap.
                </div>
              )}
            </div>
          )}
            </>
          )}
        </>
      )}

      {confirmDialog && <ConfirmDialog {...confirmDialog} />}
    </div>
  );
};

export default SeriesDepartures;