import { useCallback, useEffect, useMemo, useState } from 'react';
import SearchableSelect from '../components/SearchableSelect';
import { useNavigate } from 'react-router-dom';
import {
  BedDouble,
  Download,
  FileSpreadsheet,
  FileText,
  LogOut,
  Plus,
  Search,
  Send,
  Tag,
  Trash2,
  UserPlus,
  Users
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import RoomAllocationModal from '../components/RoomAllocationModal';
import { calculateRoomCharges, defaultAutoAllocation } from '../lib/roomAllocationHelper';

const CATEGORIES = ['All', 'Accommodation', 'Transfers', 'Activities / Tours', 'Meals', 'Flights / Charter', 'Trains', 'Tickets', 'Car Rental', 'Extras'];
const round2 = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const dateLabel = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString() : '—';
const today = () => new Date().toISOString().slice(0, 10);
const simpleFilename = (value) => String(value || 'quotation').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();

function saveDocument(content, filename, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function tariffRowsHtml(rows) {
  return rows.map((row) => {
    const item = row.item_snapshot || {};
    const rateRows = (item.rates || []).map((rate) => {
      const output = Object.entries(rate).filter(([key, value]) => /^(price_|single_room_rate|double_twin_rate|triple_room_rate|unit_price|adult_rate|child_rate|single_supplement|taxes_and_surcharges|rate$)/.test(key) && value !== null && value !== undefined);
      return `<tr><td>${escapeHtml(rate.season_name || rate.option_name || 'Rate')}</td><td>${escapeHtml(rate.valid_from || '')} - ${escapeHtml(rate.valid_to || '')}</td><td>${escapeHtml(rate.room_type || rate.rate_basis || '')}</td><td>${escapeHtml(rate.meal_plan || '')}</td><td>${output.map(([key, value]) => `${escapeHtml(key.replaceAll('_', ' '))}: ${escapeHtml(value)} ${escapeHtml(item.currency || '')}`).join('<br>')}</td></tr>`;
    }).join('');
    return `<h3>${escapeHtml(item.name)} <small>${escapeHtml(row.category)}</small></h3><p>${escapeHtml(item.description || '')}</p><table><tr><th>Season</th><th>Rate period</th><th>Room / basis</th><th>Meal</th><th>Partner prices</th></tr>${rateRows}</table>`;
  }).join('');
}

function profileHeader(profile) {
  const values = [profile?.legal_name, profile?.address, profile?.tax_number ? `Tax no: ${profile.tax_number}` : '', profile?.telephone, profile?.email, profile?.website].filter(Boolean);
  const logo = profile?.logo_data_url ? `<img src="${escapeHtml(profile.logo_data_url)}" style="max-width:180px;max-height:80px;object-fit:contain;margin-bottom:10px" alt="Company logo">` : '';
  return `${logo}${values.map((value) => `<div>${escapeHtml(value)}</div>`).join('')}`;
}

function documentHtml(title, profile, content) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font:14px Arial,sans-serif;color:#1d2d31;margin:36px}h1{color:#0d7478;margin:18px 0 4px}h2{color:#0d7478;margin-top:26px}h3{margin:20px 0 4px}small{color:#66787d;font-weight:400}table{border-collapse:collapse;width:100%;margin:8px 0 20px}th,td{border:1px solid #cbd5d7;padding:7px;text-align:left;vertical-align:top}th{background:#eef3f3}.brand{margin-bottom:24px;color:#42565a}.muted{color:#65787c}</style></head><body><div class="brand">${profileHeader(profile)}</div>${content}</body></html>`;
}

function chosenRate(item, serviceDate, rentalDays = 1) {
  const rates = item.item_snapshot?.rates || [];
  const dateRates = rates.filter((rate) => (!rate.valid_from || rate.valid_from <= serviceDate) && (!rate.valid_to || rate.valid_to >= serviceDate)
    && (rate.min_days === undefined || Number(rentalDays) >= Number(rate.min_days))
    && (rate.max_days === null || rate.max_days === undefined || Number(rentalDays) <= Number(rate.max_days)));
  return dateRates[0] || null;
}

function rateAmount(rate, child = false, age = 8, item = null, variant = '') {
  if (!rate) return 0;
  if (child) {
    const band = (item?.item_snapshot?.child_age_ranges || []).find((entry) => Number(age) >= Number(entry.ageFrom) && Number(age) <= Number(entry.ageTo));
    const childRates = variant === 'fast_track' ? rate.fast_track_child_rates_breakdown : rate.child_rates_breakdown;
    const bandValue = band ? Number(childRates?.[band.id]) : NaN;
    if (Number.isFinite(bandValue)) return bandValue;
    if (childRates?.child !== undefined) return Number(childRates.child) || 0;
    const direct = ['price_child_0_1', 'price_child_0_5', 'price_child_1_5', 'price_child_2_11', 'price_child_6_11', 'price_child_12_17', 'child_rate'];
    for (const key of direct) if (rate[key] !== undefined && rate[key] !== null && Number.isFinite(Number(rate[key]))) return Number(rate[key]);
  }
  const rateKey = variant === 'fast_track' ? 'fast_track_adult_rate' : variant === 'standard' ? 'price_1_adult' : variant;
  if (rateKey && Number.isFinite(Number(rate[rateKey]))) return Number(rate[rateKey]);
  const keys = child
    ? ['price_2_adults', 'price_1_adult', 'unit_price', 'rate']
    : ['price_2_adults', 'price_1_adult', 'adult_rate', 'single_room_rate', 'double_twin_rate', 'unit_price', 'rate', 'price'];
  for (const key of keys) {
    if (rate[key] !== undefined && rate[key] !== null && Number.isFinite(Number(rate[key]))) return Number(rate[key]);
  }
  const tier = Array.isArray(rate.tiered_pricing) ? rate.tiered_pricing[0] : null;
  return Number(tier?.rate) || 0;
}

function childRateFor(service, age) {
  const band = (service.childAgeRanges || []).find((entry) => Number(age) >= Number(entry.ageFrom) && Number(age) <= Number(entry.ageTo));
  const rates = service.variant === 'fast_track' ? service.fastTrackChildRateBands : service.childRateBands;
  const bandRate = band ? rates?.[band.id] : undefined;
  if (bandRate !== undefined && bandRate !== null) return Number(bandRate) || 0;
  return Number(service.childRate) || 0;
}

function makeQuoteHtml(quote, profile) {
  const data = quote.quotation_data || {};
  const travellers = Array.isArray(quote.travellers) ? quote.travellers : [];
  const days = Array.isArray(data.days) ? data.days : [];
  const currencies = [...new Set(days.flatMap((day) => (day.services || []).map((service) => service.currency || 'ZAR')))];
  const content = `<h1>${escapeHtml(quote.title)}</h1><p class="muted">Reference: ${escapeHtml(quote.reference_number || '—')} &nbsp; | &nbsp; ${escapeHtml(dateLabel(quote.travel_start_date))} – ${escapeHtml(dateLabel(quote.travel_end_date))}</p><p>${quote.num_adults} adult(s), ${quote.num_children} child(ren)${travellers.length ? `<br>${travellers.map((person) => `${escapeHtml([person.name, person.surname].filter(Boolean).join(' '))} (${escapeHtml(person.age)} yrs)`).join(', ')}` : ''}</p>${days.map((day, index) => `<h2>${escapeHtml(day.date ? dateLabel(day.date) : `Day ${index + 1}`)}</h2><table><tr><th>Service</th><th>Category</th><th>Supplier</th><th>Qty</th><th>Sell price</th></tr>${(day.services || []).map((service) => `<tr><td>${escapeHtml(service.name)}</td><td>${escapeHtml(service.category)}</td><td>${escapeHtml(service.supplier_name || '')}</td><td>${escapeHtml(service.quantity || 1)}</td><td>${escapeHtml(service.currency)} ${Number(service.total_sell || 0).toFixed(2)}</td></tr>`).join('')}</table>`).join('')}${currencies.map((currency) => `<h2>Total (${escapeHtml(currency)})</h2><p><strong>${escapeHtml(currency)} ${Number(data.totals?.[currency] || 0).toFixed(2)}</strong></p>`).join('')}`;
  return documentHtml(quote.title, profile, content);
}

export const PartnerPortal = () => {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [context, setContext] = useState(null);
  const [user, setUser] = useState(null);
  const [tariffs, setTariffs] = useState([]);
  const [tariffItems, setTariffItems] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [profile, setProfile] = useState({ legal_name: '', address: '', tax_number: '', email: '', telephone: '', website: '', logo_data_url: '' });
  const [profileRowExists, setProfileRowExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('tariffs');
  const [selectedTariffId, setSelectedTariffId] = useState('');
  const [quoteForm, setQuoteForm] = useState({ title: '', start: '', end: '', adults: 2, children: 0 });
  const [travellers, setTravellers] = useState([
    { id: 't_1', type: 'adult', name: 'Lead', surname: 'Guest', age: '35' },
    { id: 't_2', type: 'adult', name: 'Second', surname: 'Guest', age: '32' }
  ]);
  const [markup, setMarkup] = useState('0');
  const [services, setServices] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');

  // Sidebar filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedCurrency, setSelectedCurrency] = useState('');
  const [globalTargetDay, setGlobalTargetDay] = useState('');
  const [itemTargetDays, setItemTargetDays] = useState({});

  // Room allocation modal state
  const [allocatingServiceKey, setAllocatingServiceKey] = useState(null);

  const loadPortal = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: { user: currentUser } }, { data: contextRows, error: contextError }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.rpc('current_partner_portal_context')
      ]);
      if (!currentUser) throw new Error('Sign in to open the partner portal');
      if (contextError) throw contextError;
      const details = Array.isArray(contextRows) ? contextRows[0] : contextRows;
      if (!details) throw new Error('Partner access is not active');
      setUser(currentUser);
      setContext(details);
      const [tariffRes, quoteRes, profileRes] = await Promise.all([
        supabase.from('partner_tariffs').select('id, name, valid_from, valid_to, categories, all_services, tenant_profile_snapshot, created_at').eq('client_id', details.client_id).eq('status', 'active').gte('valid_to', today()).order('valid_from'),
        supabase.from('partner_quotations').select('*').eq('client_id', details.client_id).order('created_at', { ascending: false }),
        supabase.from('partner_company_profiles').select('*').eq('client_id', details.client_id).maybeSingle()
      ]);
      for (const result of [tariffRes, quoteRes, profileRes]) if (result.error) throw result.error;
      setTariffs(tariffRes.data || []);
      setQuotes(quoteRes.data || []);
      setProfileRowExists(!!profileRes.data);
      if (profileRes.data) setProfile({ legal_name: profileRes.data.legal_name || '', address: profileRes.data.address || '', tax_number: profileRes.data.tax_number || '', email: profileRes.data.email || '', telephone: profileRes.data.telephone || '', website: profileRes.data.website || '', logo_data_url: profileRes.data.logo_data_url || '' });
      if (details.role === 'partner_admin') {
        const { data: inviteRows, error: inviteError } = await supabase.from('partner_portal_invitations').select('id,email,role,status,invite_code,created_at').eq('client_id', details.client_id).order('created_at', { ascending: false });
        if (inviteError) throw inviteError;
        setInvitations(inviteRows || []);
      }
    } catch (error) {
      showToast(error.message || 'Could not load the partner portal', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadPortal();
  }, [loadPortal]);

  useEffect(() => {
    const loadItems = async () => {
      if (!selectedTariffId) { setTariffItems([]); return; }
      const { data, error } = await supabase.from('partner_tariff_items').select('id,category,item_snapshot').eq('tariff_id', selectedTariffId).order('category');
      if (error) { showToast(error.message || 'Could not load tariff services', 'error'); return; }
      setTariffItems(data || []);
    };
    loadItems();
  }, [selectedTariffId, showToast]);

  const selectedTariff = tariffs.find((tariff) => tariff.id === selectedTariffId) || null;

  // Auto select first tariff if available
  useEffect(() => {
    if (tariffs.length > 0 && !selectedTariffId) {
      setSelectedTariffId(tariffs[0].id);
    }
  }, [tariffs, selectedTariffId]);

  // Compute itinerary days array based on start and end dates
  const itineraryDays = useMemo(() => {
    if (!quoteForm.start) return [{ dayNumber: 1, date: '', label: 'Day 1' }];
    const s = new Date(`${quoteForm.start}T00:00:00`);
    const e = quoteForm.end ? new Date(`${quoteForm.end}T00:00:00`) : s;
    const diffTime = Math.max(0, e.getTime() - s.getTime());
    const totalDays = Math.min(30, Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1);
    const list = [];
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(s);
      d.setDate(d.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      list.push({
        dayNumber: i + 1,
        date: iso,
        label: `Day ${i + 1} — ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
      });
    }
    return list;
  }, [quoteForm.start, quoteForm.end]);

  // Auto-select first day as target when dates are set
  useEffect(() => {
    if (itineraryDays.length > 0 && itineraryDays[0].date && !globalTargetDay) {
      setGlobalTargetDay(itineraryDays[0].date);
    }
  }, [itineraryDays, globalTargetDay]);

  // Derive unique currencies from tariff items
  const availableCurrencies = useMemo(() => {
    const set = new Set();
    tariffItems.forEach((row) => {
      const rates = row.item_snapshot?.rates || [];
      rates.forEach((rate) => { if (rate.currency) set.add(rate.currency); });
      if (row.item_snapshot?.currency) set.add(row.item_snapshot.currency);
    });
    return [...set].sort();
  }, [tariffItems]);

  // Auto-select first currency when tariff items load
  useEffect(() => {
    if (availableCurrencies.length > 0 && !selectedCurrency) {
      setSelectedCurrency(availableCurrencies[0]);
    }
  }, [availableCurrencies, selectedCurrency]);

  // Get display price for any service category — with markup applied
  const getItemDisplayPrice = (row, date) => {
    const item = row.item_snapshot || {};
    const markupFactor = 1 + Math.max(0, Number(markup) || 0) / 100;
    // Rate currency can be on the rate row itself OR inherited from item.currency
    const effectiveCurrency = (rate) => rate.currency || item.currency || '';
    const rates = (item.rates || []).filter((rate) => {
      const currMatch = !selectedCurrency || effectiveCurrency(rate) === selectedCurrency;
      const dateMatch = (!rate.valid_from || rate.valid_from <= date) && (!rate.valid_to || rate.valid_to >= date);
      return currMatch && dateMatch;
    });
    // If no currency-specific rate, fall back to any date-valid rate
    const rate = rates[0] || (item.rates || []).find((r) =>
      (!r.valid_from || r.valid_from <= date) && (!r.valid_to || r.valid_to >= date)
    ) || null;
    if (!rate) return null;
    const currency = effectiveCurrency(rate) || selectedCurrency || 'ZAR';
    const baseAmount = rateAmount(rate, false, 8, row, '');
    const amount = Math.round((baseAmount * markupFactor + Number.EPSILON) * 100) / 100;
    const basis = rate.rate_basis || item.pricing_model || 'per person';
    return { currency, amount, basis, rate };
  };

  // Filter tariff items in left sidebar — on-demand: only show when category or search is active
  const filteredSidebarItems = useMemo(() => {
    const hasFilter = !!selectedCategory || searchQuery.trim().length > 0;
    if (!hasFilter) return [];
    return tariffItems.filter((row) => {
      const item = row.item_snapshot || {};
      const categoryMatch = !selectedCategory || row.category === selectedCategory;
      const searchLower = searchQuery.trim().toLowerCase();
      const searchMatch = !searchLower || (
        (item.name || '').toLowerCase().includes(searchLower) ||
        (item.category || '').toLowerCase().includes(searchLower) ||
        (item.destination_region || item.location || '').toLowerCase().includes(searchLower)
      );
      // Currency filter — match on rate.currency OR item.currency (many non-accommodation rates store currency at item level)
      const rates = item.rates || [];
      const currencyMatch = !selectedCurrency || item.currency === selectedCurrency ||
        rates.some((r) => (r.currency || item.currency) === selectedCurrency);
      return categoryMatch && searchMatch && currencyMatch;
    });
  }, [tariffItems, selectedCategory, searchQuery, selectedCurrency]);

  // Sync adults and children count with travellers array
  const adultCount = useMemo(() => travellers.filter((t) => t.type === 'adult').length, [travellers]);
  const childCount = useMemo(() => travellers.filter((t) => t.type === 'child').length, [travellers]);

  const addTraveller = (type) => {
    setTravellers((prev) => [
      ...prev,
      {
        id: `t_${crypto.randomUUID().slice(0, 8)}`,
        type,
        name: type === 'adult' ? `Adult ${adultCount + 1}` : `Child ${childCount + 1}`,
        surname: '',
        age: type === 'adult' ? '30' : '8'
      }
    ]);
  };

  const removeTraveller = (id) => {
    if (travellers.length <= 1) {
      showToast('At least one traveller is required', 'warning');
      return;
    }
    setTravellers((prev) => prev.filter((t) => t.id !== id));
  };

  const updateTraveller = (id, field, value) => {
    setTravellers((prev) => prev.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
  };

  // Add item from sidebar to a specific target day
  const addItemToDay = (itemRow, targetDate) => {
    const serviceDate = targetDate || globalTargetDay || quoteForm.start || today();
    // Pick rate matching selected currency first, then fall back to any date-valid rate
    const rates = (itemRow.item_snapshot?.rates || []).filter((r) =>
      (!r.valid_from || r.valid_from <= serviceDate) && (!r.valid_to || r.valid_to >= serviceDate)
    );
    const rate = rates.find((r) => r.currency === selectedCurrency) || rates[0] || null;
    if (!rate) {
      showToast('No dated rate is available for this service on the selected date', 'warning');
      return;
    }
    const cat = itemRow.category || '';
    const variantOptions = cat === 'Guide'
      ? 'guide_transfer_rate'
      : cat === 'Tickets'
        ? (itemRow.item_snapshot?.ticket_type === 'fast_track' ? 'fast_track' : 'standard')
        : '';
    const basis = rate.rate_basis || itemRow.item_snapshot?.pricing_model || 'per_person';
    const isAccom = /accommodation/i.test(cat);

    const newService = {
      key: crypto.randomUUID(),
      itemId: itemRow.id,
      name: itemRow.item_snapshot.name,
      identifierCode: itemRow.item_snapshot.identifier_code || '',
      category: cat,
      supplierName: itemRow.item_snapshot.supplier_name || '',
      currency: rate.currency || itemRow.item_snapshot.currency || 'ZAR',
      date: serviceDate,
      basis,
      baseAdult: rateAmount(rate, false, 8, itemRow, variantOptions),
      pricingModel: itemRow.item_snapshot.pricing_model,
      rateSnapshot: rate,
      tieredPricing: rate.tiered_pricing || [],
      childRate: rateAmount(rate, true, 8, itemRow, variantOptions),
      childRateBands: rate.child_rates_breakdown || {},
      fastTrackChildRateBands: rate.fast_track_child_rates_breakdown || {},
      childAgeRanges: itemRow.item_snapshot.child_age_ranges || [],
      variant: variantOptions,
      rentalDays: 1,
      quantity: 1,
      maxOccupancy: itemRow.item_snapshot?.max_occupancy || 2,
      roomAllocations: isAccom ? defaultAutoAllocation(travellers, itemRow.item_snapshot?.max_occupancy || 2) : []
    };

    setServices((prev) => [...prev, newService]);
    showToast(`Added "${itemRow.item_snapshot.name}" to ${dateLabel(serviceDate)}`, 'success');
  };

  // Dynamic calculations for all services
  const computedServices = useMemo(() => {
    const markupFactor = 1 + Math.max(0, Number(markup) || 0) / 100;

    return services.map((service) => {
      const isAccom = /accommodation/i.test(service.category);
      if (isAccom && Array.isArray(service.roomAllocations) && service.roomAllocations.length > 0) {
        const itemForCalc = {
          name: service.name,
          category: service.category,
          max_occupancy: service.maxOccupancy,
          child_age_ranges: service.childAgeRanges,
          item_rates: [service.rateSnapshot]
        };
        const accomCalc = calculateRoomCharges(itemForCalc, service.roomAllocations, service.currency, Math.max(0, Number(markup) || 0));
        return {
          ...service,
          unitAdult: accomCalc.totalSell,
          unitChildren: [],
          total: round2(accomCalc.totalSell),
          flat: true,
          accomCalc
        };
      }

      const adults = adultCount;
      const totalPax = Math.max(1, adults + childCount);
      let baseAdult = service.baseAdult;
      if (service.pricingModel === 'per_person_sharing' && service.rateSnapshot) {
        if (adults <= 1) baseAdult = Number(service.rateSnapshot.price_1_adult) || service.baseAdult;
        else if (adults === 2) baseAdult = Number(service.rateSnapshot.price_2_adults) || service.baseAdult;
        else {
          const sharing = Number(service.rateSnapshot.price_2_adults) || Number(service.rateSnapshot.price_1_adult) || service.baseAdult;
          const extra = Number(service.rateSnapshot.price_3_plus_adults) || sharing;
          baseAdult = (2 * sharing + (adults - 2) * extra) / adults;
        }
      }
      const tier = (service.tieredPricing || []).find((entry) => totalPax >= Number(entry.min_pax || 0)
        && (!Number(entry.max_pax) || totalPax <= Number(entry.max_pax)))
        || service.tieredPricing?.[service.tieredPricing.length - 1];
      if (tier) baseAdult = (Number(tier.rate) || 0) / totalPax;
      const unitAdult = round2(baseAdult * markupFactor);
      const flat = ['per_vehicle', 'per_trip', 'per_room', 'flat'].includes(service.basis);
      const unitChildren = travellers.filter((person) => person.type === 'child').map((person) => round2(childRateFor(service, Number(person.age)) * markupFactor));
      const total = tier
        ? Number(tier.rate) * markupFactor
        : flat ? unitAdult * Number(service.rentalDays || 1) : (unitAdult * adults + unitChildren.reduce((sum, childRate) => sum + childRate, 0)) * Number(service.quantity || 1);
      return { ...service, unitAdult, unitChildren, total: round2(total), flat };
    });
  }, [services, markup, adultCount, childCount, travellers]);

  const quoteData = useMemo(() => {
    const days = [...new Set(computedServices.map((service) => service.date))].sort().map((date) => ({
      date,
      services: computedServices.filter((service) => service.date === date).map((service) => ({
        item_id: service.itemId,
        name: service.name,
        category: service.category,
        supplier_name: service.supplierName,
        currency: service.currency,
        basis: service.basis,
        quantity: service.quantity,
        unit_sell_adult: service.unitAdult,
        unit_sell_children: service.unitChildren,
        total_sell: service.total,
        room_allocations: service.roomAllocations || []
      }))
    }));
    const totals = {};
    computedServices.forEach((service) => { totals[service.currency] = round2((totals[service.currency] || 0) + service.total); });
    return { days, totals };
  }, [computedServices]);

  const validQuote = !!quoteForm.start && !!quoteForm.end && quoteForm.start <= quoteForm.end
    && travellers.length > 0 && computedServices.length > 0;

  const saveQuote = async (status) => {
    if (!validQuote || !context || !user) { showToast('Complete dates, travellers, and add at least one service', 'warning'); return; }
    setBusy(true);
    try {
      const ref = `PQ-${today().replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
      const row = {
        company_id: context.company_id,
        client_id: context.client_id,
        tariff_id: selectedTariffId || null,
        created_by: user.id,
        reference_number: ref,
        title: quoteForm.title.trim() || 'Partner quotation',
        travel_start_date: quoteForm.start,
        travel_end_date: quoteForm.end,
        num_adults: adultCount,
        num_children: childCount,
        travellers: travellers.map((person) => ({ id: person.id, type: person.type, name: person.name, surname: person.surname, age: Number(person.age) || 0 })),
        quotation_data: quoteData,
        partner_profile_snapshot: profile,
        currency_code: selectedCurrency || Object.keys(quoteData.totals)[0] || 'ZAR',
        status,
        submitted_at: status === 'draft' ? null : new Date().toISOString()
      };
      const { error } = await supabase.from('partner_quotations').insert(row);
      if (error) throw error;
      showToast(status === 'booking_requested' ? 'Booking request sent to the tenant' : status === 'submitted' ? 'Quotation submitted to the tenant' : 'Quotation saved', 'success');
      setServices([]);
      setQuoteForm({ title: '', start: '', end: '', adults: 2, children: 0 });
      setTab('quotations');
      await loadPortal();
    } catch (error) {
      showToast(error.message || 'Could not save quotation', 'error');
    } finally {
      setBusy(false);
    }
  };

  const exportTariff = async (tariff, format) => {
    const { data, error } = await supabase.from('partner_tariff_items').select('category,item_snapshot').eq('tariff_id', tariff.id).order('category');
    if (error) { showToast(error.message || 'Could not download tariff', 'error'); return; }
    const profileSnapshot = tariff.tenant_profile_snapshot || {};
    const html = documentHtml(tariff.name, profileSnapshot, `<h1>${escapeHtml(tariff.name)}</h1><p class="muted">${escapeHtml(dateLabel(tariff.valid_from))} – ${escapeHtml(dateLabel(tariff.valid_to))}</p>${tariffRowsHtml(data || [])}`);
    const filename = simpleFilename(tariff.name);
    if (format === 'pdf') {
      const printWindow = window.open('', '_blank', 'width=900,height=700');
      if (!printWindow) { showToast('Allow pop-ups to print or save as PDF', 'warning'); return; }
      printWindow.document.write(html.replace('</body>', '<script>window.onload=()=>setTimeout(()=>window.print(),250)</script></body>'));
      printWindow.document.close();
    } else if (format === 'word') saveDocument(html, `${filename}.doc`, 'application/msword');
    else saveDocument(html, `${filename}.xls`, 'application/vnd.ms-excel');
  };

  const exportQuote = (quote, format) => {
    const html = makeQuoteHtml(quote, quote.partner_profile_snapshot || profile);
    const filename = simpleFilename(quote.reference_number || quote.title);
    if (format === 'pdf') {
      const printWindow = window.open('', '_blank', 'width=900,height=700');
      if (!printWindow) { showToast('Allow pop-ups to print or save as PDF', 'warning'); return; }
      printWindow.document.write(html.replace('</body>', '<script>window.onload=()=>setTimeout(()=>window.print(),250)</script></body>'));
      printWindow.document.close();
    } else if (format === 'word') saveDocument(html, `${filename}.doc`, 'application/msword');
    else saveDocument(html, `${filename}.xls`, 'application/vnd.ms-excel');
  };

  const saveProfile = async (event) => {
    event.preventDefault();
    if (!context) return;
    setBusy(true);
    try {
      const { error } = await supabase.from('partner_company_profiles').upsert({
        client_id: context.client_id,
        company_id: context.company_id,
        ...profile,
        updated_by: user.id
      }, { onConflict: 'client_id' });
      if (error) throw error;
      setProfileRowExists(true);
      showToast('Partner document profile saved', 'success');
    } catch (error) {
      showToast(error.message || 'Could not save company profile', 'error');
    } finally {
      setBusy(false);
    }
  };

  const createUserInvite = async (event) => {
    event.preventDefault();
    if (!inviteEmail.trim() || !context) return;
    try {
      const { data: invitation, error } = await supabase.from('partner_portal_invitations').insert({
        company_id: context.company_id,
        client_id: context.client_id,
        email: inviteEmail.trim().toLowerCase(),
        role: 'partner_user',
        invited_by: user.id
      }).select('invite_code').single();
      if (error) throw error;
      const inviteUrl = `${window.location.origin}/partner-register?invite=${invitation.invite_code}`;
      await navigator.clipboard?.writeText(inviteUrl);
      setInviteEmail('');
      showToast('Team invitation created; link copied', 'success');
      await loadPortal();
    } catch (error) {
      showToast(error.message || 'Could not invite team member', 'error');
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  const allocatingService = useMemo(() => {
    return computedServices.find((s) => s.key === allocatingServiceKey) || null;
  }, [computedServices, allocatingServiceKey]);

  if (loading) return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f2f6f4' }}>Loading partner portal...</main>;

  if (!context) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f2f6f4', color: '#203136' }}>
        <div style={{ textAlign: 'center', maxWidth: '440px', padding: '2rem', background: '#fff', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontFamily: 'Arial, sans-serif' }}>
          <h2 style={{ marginTop: 0, color: '#0d7478' }}>Partner Access Required</h2>
          <p style={{ color: '#52656a', lineHeight: 1.55 }}>Your account is logged in, but active partner access was not found. Please verify your invitation link or sign in with your partner account.</p>
          <button type="button" onClick={signOut} style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem', margin: '0.5rem auto 0', padding: '.65rem 1.25rem', background: '#0d7478', color: '#fff', border: 0, borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}><LogOut size={16} /> Sign out & Back to Login</button>
        </div>
      </main>
    );
  }

  return (
    <main style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#f2f6f4', color: '#203136', fontFamily: 'Arial, sans-serif' }}>
      {/* Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', padding: '0.9rem 2rem', background: '#0d7478', color: '#fff', flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Partner Portal</div>
          <h1 style={{ margin: '0.1rem 0 0', fontSize: '1.25rem', fontWeight: 700 }}>{context?.partner_name}</h1>
        </div>
        <button type="button" onClick={signOut} style={{ display: 'inline-flex', gap: '.45rem', alignItems: 'center', background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,.55)', padding: '.45rem .8rem', borderRadius: '4px', cursor: 'pointer', fontSize: '.85rem' }}><LogOut size={15} /> Sign out</button>
      </header>

      {/* Main Body */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Navigation Bar */}
        <nav style={{ display: 'flex', gap: '.5rem', padding: '0 2rem', background: '#fff', borderBottom: '1px solid #d3dfdc', flexShrink: 0 }}>
          {[['tariffs', 'My Tariffs'], ['new-quote', 'New Quotation'], ['quotations', 'My Quotations'], ['profile', 'Company Profile'], ...(context?.role === 'partner_admin' ? [['team', 'Team Access']] : [])].map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)} style={{ padding: '.75rem 1rem', color: tab === id ? '#0d7478' : '#52656a', fontWeight: tab === id ? 700 : 500, border: 0, borderBottom: tab === id ? '3px solid #0d7478' : '3px solid transparent', background: 'transparent', cursor: 'pointer', fontSize: '.9rem' }}>{label}</button>
          ))}
        </nav>

        {/* Tab 1: Tariffs */}
        {tab === 'tariffs' && <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 2rem' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <h2 style={{ margin: '0 0 .35rem', fontSize: '1.2rem', color: '#0d7478' }}>Partner Price Lists</h2>
            <p style={{ color: '#586c70', margin: '0 0 1.2rem', fontSize: '.9rem' }}>Prices below already include the tenant’s partner rate.</p>
            {tariffs.length === 0 ? <p style={{ color: '#64748b' }}>No active tariffs are available today.</p> : <div style={{ display: 'grid', gap: '0.8rem' }}>{tariffs.map((tariff) => <article key={tariff.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '1rem', alignItems: 'center', padding: '1rem 1.2rem', background: '#fff', borderRadius: '6px', border: '1px solid #d8e1de' }}><div><h3 style={{ margin: 0, fontSize: '1.05rem', color: '#1d2d31' }}>{tariff.name}</h3><div style={{ color: '#586c70', fontSize: '.85rem', marginTop: '.3rem' }}>{dateLabel(tariff.valid_from)} – {dateLabel(tariff.valid_to)} · {tariff.all_services ? 'All services' : tariff.categories.join(', ')}</div></div><div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem' }}>{[['pdf', 'PDF'], ['word', 'Word'], ['excel', 'Excel']].map(([format, label]) => <button key={format} type="button" onClick={() => exportTariff(tariff, format)} title={`Download tariff as ${label}`} style={commandStyle}>{format === 'pdf' ? <Download size={14} /> : format === 'word' ? <FileText size={14} /> : <FileSpreadsheet size={14} />}{label}</button>)}</div></article>)}</div>}
          </div>
        </div>}

        {/* Tab 2: New Quotation (2-Column Itinerary Builder) */}
        {tab === 'new-quote' && (
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr)', overflow: 'hidden' }}>
            {/* Left Sidebar: Library Items Picker */}
            <aside style={{ display: 'flex', flexDirection: 'column', background: '#fff', borderRight: '1px solid #d4dfdc', overflow: 'hidden' }}>

              {/* Sidebar top: search + currency */}
              <div style={{ padding: '.75rem .85rem', borderBottom: '1px solid #e2e8f0', background: '#fafcfc', display: 'flex', flexDirection: 'column', gap: '.55rem' }}>
                {/* Search */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                  <Search size={15} color="#0d7478" style={{ flexShrink: 0 }} />
                  <input
                    type="text"
                    placeholder="Search services..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ flex: 1, padding: '.38rem .55rem', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '.82rem' }}
                  />
                </div>

                {/* Currency filter */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.8rem', fontWeight: 600, color: '#374151' }}>
                  <Tag size={13} color="#0d7478" style={{ flexShrink: 0 }} />
                  Currency:
                  <SearchableSelect
                    value={selectedCurrency}
                    onChange={(e) => setSelectedCurrency(e.target.value)}
                    style={{ flex: 1, padding: '.32rem .45rem', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '.8rem', background: '#fff' }}
                  >
                    {availableCurrencies.length === 0 && <option value="">—</option>}
                    {availableCurrencies.map((c) => <option key={c} value={c}>{c}</option>)}
                  </SearchableSelect>
                </label>

                {/* Selected day indicator */}
                <div style={{ fontSize: '.75rem', color: globalTargetDay ? '#0d7478' : '#94a3b8', fontWeight: globalTargetDay ? 700 : 400, padding: '.25rem .4rem', background: globalTargetDay ? '#e6f4f4' : '#f1f5f9', borderRadius: '4px', border: `1px solid ${globalTargetDay ? '#b2dede' : '#e2e8f0'}` }}>
                  {globalTargetDay
                    ? `➕ Adding to: ${itineraryDays.find((d) => d.date === globalTargetDay)?.label || globalTargetDay}`
                    : '👆 Click a day below to select it'}
                </div>
              </div>

              {/* Category islands grid */}
              <div style={{ padding: '.65rem .7rem', borderBottom: '1px solid #e2e8f0', background: '#f8faf9' }}>
                <div style={{ fontSize: '.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: '#94a3b8', marginBottom: '.45rem' }}>Categories</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.35rem' }}>
                  {CATEGORIES.filter((c) => c !== 'All').map((cat) => {
                    const active = selectedCategory === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setSelectedCategory(active ? '' : cat)}
                        style={{
                          padding: '.4rem .5rem',
                          fontSize: '.74rem',
                          fontWeight: active ? 700 : 500,
                          background: active ? '#0d7478' : '#fff',
                          color: active ? '#fff' : '#374151',
                          border: `1px solid ${active ? '#0d7478' : '#d1d5db'}`,
                          borderRadius: '6px',
                          cursor: 'pointer',
                          textAlign: 'center',
                          lineHeight: 1.3,
                          boxShadow: active ? 'none' : '0 1px 2px rgba(0,0,0,0.06)',
                          transition: 'all .15s'
                        }}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Items List — on demand */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '.75rem', display: 'grid', gap: '.6rem', alignContent: 'start' }}>
                {!selectedCategory && !searchQuery.trim() ? (
                  <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#94a3b8', fontSize: '.82rem', lineHeight: 1.55 }}>
                    Select a category or search above to load services.
                  </div>
                ) : filteredSidebarItems.length === 0 ? (
                  <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#64748b', fontSize: '.82rem' }}>
                    No services found{selectedCurrency ? ` in ${selectedCurrency}` : ''}.
                  </div>
                ) : (
                  filteredSidebarItems.map((row) => {
                    const item = row.item_snapshot || {};
                    const refDate = quoteForm.start || today();
                    const priceInfo = getItemDisplayPrice(row, refDate);
                    const isAccom = /accommodation/i.test(row.category);

                    return (
                      <div key={row.id} style={{ padding: '.7rem', background: '#fafcfc', border: '1px solid #dce5e3', borderRadius: '6px', fontSize: '.82rem' }}>
                        {/* Name + category badge */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '.4rem', marginBottom: '.2rem' }}>
                          <h4 style={{ margin: 0, fontSize: '.87rem', color: '#0f172a', fontWeight: 700, lineHeight: 1.3 }}>{item.name}</h4>
                          <span style={{ flexShrink: 0, fontSize: '.68rem', padding: '.12rem .4rem', background: '#e0f2fe', color: '#0369a1', borderRadius: '4px', fontWeight: 600 }}>
                            {row.category}
                          </span>
                        </div>

                        {/* Identifier code */}
                        {item.identifier_code && (
                          <div style={{ fontSize: '.72rem', color: '#64748b', fontFamily: 'monospace', marginBottom: '.15rem' }}>
                            #{item.identifier_code}
                          </div>
                        )}

                        {/* Supplier — always for accommodation, optional for others */}
                        {(isAccom || item.supplier_name) && item.supplier_name && (
                          <div style={{ fontSize: '.75rem', color: '#475569', marginBottom: '.15rem' }}>
                            🏢 {item.supplier_name}
                          </div>
                        )}

                        {item.destination_region && (
                          <div style={{ color: '#64748b', fontSize: '.74rem', marginBottom: '.3rem' }}>📍 {item.destination_region}</div>
                        )}

                        {/* Price with markup */}
                        <div style={{ padding: '.35rem .45rem', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '4px', fontSize: '.78rem', color: '#0d7478', fontWeight: 700, margin: '.3rem 0' }}>
                          {priceInfo
                            ? `${priceInfo.currency} ${priceInfo.amount.toFixed(2)} / ${(priceInfo.basis || 'per person').replaceAll('_', ' ')}`
                            : <span style={{ color: '#94a3b8', fontWeight: 500 }}>No rate available</span>
                          }
                        </div>

                        {/* Add button */}
                        <button
                          type="button"
                          disabled={!globalTargetDay && !quoteForm.start}
                          onClick={() => addItemToDay(row, globalTargetDay || quoteForm.start || today())}
                          style={{
                            ...commandStyle,
                            width: '100%',
                            justifyContent: 'center',
                            padding: '.32rem .6rem',
                            fontSize: '.78rem',
                            background: globalTargetDay ? '#0d7478' : '#64748b',
                            color: '#fff',
                            borderColor: globalTargetDay ? '#0d7478' : '#64748b',
                            marginTop: '.2rem',
                            opacity: (!globalTargetDay && !quoteForm.start) ? 0.5 : 1
                          }}
                        >
                          <Plus size={13} /> {globalTargetDay
                            ? `Add to ${itineraryDays.find((d) => d.date === globalTargetDay)?.label?.split('—')[0]?.trim() || globalTargetDay}`
                            : 'Add to itinerary'}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </aside>

            {/* Right Canvas: Itinerary Builder Canvas */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.75rem', background: '#f2f6f4' }}>
              <div style={{ maxWidth: '980px', margin: '0 auto', display: 'grid', gap: '1.25rem' }}>
                {/* Header Setup Card */}
                <section style={{ padding: '1.2rem', background: '#fff', borderRadius: '8px', border: '1px solid #d4dfdc', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                  <h2 style={{ margin: '0 0 .85rem', fontSize: '1.1rem', color: '#0d7478' }}>Quotation Setup</h2>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '.85rem' }}>
                    <label style={{ display: 'grid', gap: '.3rem', fontSize: '.85rem', fontWeight: 600 }}>
                      Quotation Title
                      <input style={fieldStyle} value={quoteForm.title} onChange={(e) => setQuoteForm((prev) => ({ ...prev, title: e.target.value }))} placeholder="e.g. Cape Town 5-Day Safari & City Tour" />
                    </label>
                    <label style={{ display: 'grid', gap: '.3rem', fontSize: '.85rem', fontWeight: 600 }}>
                      Travel From
                      <input type="date" style={fieldStyle} value={quoteForm.start} onChange={(e) => setQuoteForm((prev) => ({ ...prev, start: e.target.value, end: prev.end && prev.end < e.target.value ? '' : prev.end }))} />
                    </label>
                    <label style={{ display: 'grid', gap: '.3rem', fontSize: '.85rem', fontWeight: 600 }}>
                      Travel To
                      <input type="date" style={fieldStyle} min={quoteForm.start} value={quoteForm.end} onChange={(e) => setQuoteForm((prev) => ({ ...prev, end: e.target.value }))} />
                    </label>
                    <label style={{ display: 'grid', gap: '.3rem', fontSize: '.85rem', fontWeight: 600 }}>

                      Partner Customer Markup (%)
                      <input type="number" min="0" step="0.1" style={fieldStyle} value={markup} onChange={(e) => setMarkup(e.target.value)} />
                    </label>
                  </div>

                  {/* Travellers Roster Card */}
                  <div style={{ marginTop: '1.2rem', paddingTop: '1rem', borderTop: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontWeight: 700, fontSize: '.95rem', color: '#1e293b' }}>
                        <Users size={18} color="#0d7478" />
                        <span>Travellers Roster ({travellers.length} Pax — {adultCount} Adult, {childCount} Child)</span>
                      </div>
                      <div style={{ display: 'flex', gap: '.4rem' }}>
                        <button type="button" onClick={() => addTraveller('adult')} style={{ ...commandStyle, padding: '.35rem .65rem', fontSize: '.8rem' }}>
                          <UserPlus size={14} /> + Adult
                        </button>
                        <button type="button" onClick={() => addTraveller('child')} style={{ ...commandStyle, padding: '.35rem .65rem', fontSize: '.8rem' }}>
                          <UserPlus size={14} /> + Child
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gap: '.45rem' }}>
                      {travellers.map((person, index) => (
                        <div key={person.id} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 1fr 90px 40px', gap: '.5rem', alignItems: 'center', background: '#f8fafc', padding: '.4rem .6rem', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                          <span style={{ fontSize: '.82rem', fontWeight: 700, color: person.type === 'adult' ? '#0369a1' : '#7c3aed' }}>
                            {person.type === 'adult' ? `Adult ${index + 1}` : 'Child'}
                          </span>
                          <input style={fieldStyle} placeholder="First name" value={person.name} onChange={(e) => updateTraveller(person.id, 'name', e.target.value)} />
                          <input style={fieldStyle} placeholder="Surname" value={person.surname} onChange={(e) => updateTraveller(person.id, 'surname', e.target.value)} />
                          <input type="number" min="0" max="120" style={fieldStyle} placeholder="Age" value={person.age} onChange={(e) => updateTraveller(person.id, 'age', e.target.value)} />
                          <button type="button" onClick={() => removeTraveller(person.id)} style={{ border: 0, background: 'transparent', color: '#ef4444', cursor: 'pointer' }} title="Remove traveller">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>

                {/* Day-by-Day Services Canvas */}
                <section style={{ display: 'grid', gap: '1rem' }}>
                  {itineraryDays.map((day) => {
                    const dayServices = computedServices.filter((s) => s.date === day.date || (!day.date && s.date === quoteForm.start));
                    const isSelected = globalTargetDay === day.date;

                    return (
                      <div
                        key={day.date || day.dayNumber}
                        style={{
                          background: '#fff',
                          borderRadius: '8px',
                          border: isSelected ? '2px solid #0d7478' : '1px solid #cbd5e1',
                          overflow: 'hidden',
                          boxShadow: isSelected ? '0 0 0 3px rgba(13,116,120,.12)' : 'none'
                        }}
                      >
                        {/* Day Card Header — click to select as target day */}
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => setGlobalTargetDay(isSelected ? '' : day.date)}
                          onKeyDown={(e) => e.key === 'Enter' && setGlobalTargetDay(isSelected ? '' : day.date)}
                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.75rem 1.1rem', background: isSelected ? '#0d7478' : '#edf4f3', borderBottom: '1px solid #cbd5e1', cursor: 'pointer', userSelect: 'none' }}
                        >
                          <h3 style={{ margin: 0, fontSize: '.98rem', color: isSelected ? '#fff' : '#0d7478', fontWeight: 700 }}>
                            {day.label}
                          </h3>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                            {isSelected && (
                              <span style={{ fontSize: '.72rem', background: 'rgba(255,255,255,.22)', color: '#fff', padding: '.15rem .5rem', borderRadius: '12px', fontWeight: 700 }}>
                                ✓ Selected
                              </span>
                            )}
                            <span style={{ fontSize: '.8rem', color: isSelected ? 'rgba(255,255,255,.8)' : '#64748b', fontWeight: 600 }}>
                              {dayServices.length} {dayServices.length === 1 ? 'service' : 'services'}
                            </span>
                          </div>
                        </div>

                        {/* Day Services List */}
                        <div style={{ padding: '1rem' }}>
                          {dayServices.length === 0 ? (
                            <div style={{ padding: '1rem', textAlign: 'center', color: isSelected ? '#0d7478' : '#94a3b8', fontSize: '.85rem', border: `1px dashed ${isSelected ? '#0d7478' : '#cbd5e1'}`, borderRadius: '6px', background: isSelected ? '#f0fafa' : 'transparent' }}>
                              {isSelected ? '← Pick a service from the sidebar to add here' : 'No services for this day yet.'}

                            </div>
                          ) : (
                            <div style={{ display: 'grid', gap: '.75rem' }}>
                              {dayServices.map((service) => (
                                <div key={service.key} style={{ padding: '.85rem', background: '#fafcfc', border: '1px solid #dce5e3', borderRadius: '6px', fontSize: '.85rem' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '.75rem' }}>
                                    <div style={{ minWidth: 0 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: '.7rem', padding: '.15rem .45rem', background: '#0d7478', color: '#fff', borderRadius: '3px', fontWeight: 600, flexShrink: 0 }}>
                                          {service.category}
                                        </span>
                                        <h4 style={{ margin: 0, fontSize: '.95rem', fontWeight: 700, color: '#0f172a' }}>{service.name}</h4>
                                      </div>
                                      {service.identifierCode && (
                                        <div style={{ fontSize: '.72rem', color: '#94a3b8', fontFamily: 'monospace', marginTop: '.15rem' }}>#{service.identifierCode}</div>
                                      )}
                                      {(/accommodation/i.test(service.category) ? true : !!service.supplierName) && service.supplierName && (
                                        <div style={{ color: '#64748b', fontSize: '.78rem', marginTop: '.2rem' }}>🏢 {service.supplierName}</div>
                                      )}
                                    </div>
                                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                      <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0d7478' }}>
                                        {service.currency} {service.total.toFixed(2)}
                                      </div>
                                      <button type="button" onClick={() => setServices((prev) => prev.filter((s) => s.key !== service.key))} style={{ border: 0, background: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: '.78rem', marginTop: '.2rem' }}>
                                        <Trash2 size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> Remove
                                      </button>
                                    </div>
                                  </div>

                                  {/* Service Controls / Accommodation Room Allocation Button */}
                                  <div style={{ marginTop: '.65rem', paddingTop: '.65rem', borderTop: '1px solid #e2e8f0', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem' }}>
                                    <div style={{ color: '#475569', fontSize: '.8rem' }}>
                                      Unit Price: {service.currency} {service.unitAdult.toFixed(2)} ({service.basis.replaceAll('_', ' ')})
                                    </div>

                                    {/accommodation/i.test(service.category) ? (
                                      <button
                                        type="button"
                                        onClick={() => setAllocatingServiceKey(service.key)}
                                        style={{ ...commandStyle, background: '#e0f2fe', color: '#0369a1', borderColor: '#bae6fd', fontSize: '.8rem' }}
                                      >
                                        <BedDouble size={15} /> Room & Traveller Allocation ({service.roomAllocations?.length || 1} Room)
                                      </button>
                                    ) : (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                                        <label style={{ fontSize: '.78rem', color: '#64748b' }}>Qty:
                                          <input
                                            type="number"
                                            min="1"
                                            value={service.quantity}
                                            onChange={(e) => {
                                              const q = Math.max(1, parseInt(e.target.value, 10) || 1);
                                              setServices((prev) => prev.map((s) => (s.key === service.key ? { ...s, quantity: q } : s)));
                                            }}
                                            style={{ ...fieldStyle, width: '60px', marginLeft: '.3rem', padding: '.25rem .4rem' }}
                                          />
                                        </label>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </section>

                {/* Footer Totals & Submission */}
                <section style={{ padding: '1.2rem', background: '#fff', borderRadius: '8px', border: '1px solid #d4dfdc', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                  <div>
                    <div style={{ fontSize: '.82rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Total Quotation Amount</div>
                    {Object.entries(quoteData.totals).map(([curr, amt]) => (
                      <div key={curr} style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0d7478' }}>
                        {curr} {amt.toFixed(2)}
                      </div>
                    ))}
                    {Object.keys(quoteData.totals).length === 0 && <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#94a3b8' }}>0.00</div>}
                  </div>

                  <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      disabled={busy || !validQuote}
                      onClick={() => saveQuote('submitted')}
                      style={{ ...commandStyle, padding: '.65rem 1.1rem', fontSize: '.9rem' }}
                    >
                      <Send size={16} /> Submit Quotation
                    </button>
                    <button
                      type="button"
                      disabled={busy || !validQuote}
                      onClick={() => saveQuote('booking_requested')}
                      style={{ ...commandStyle, padding: '.65rem 1.1rem', fontSize: '.9rem', background: '#0d7478', color: '#fff' }}
                    >
                      Request Booking
                    </button>
                  </div>
                </section>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: My Quotations */}
        {tab === 'quotations' && <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 2rem' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <h2 style={{ margin: '0 0 1rem', fontSize: '1.2rem', color: '#0d7478' }}>My Saved Quotations</h2>
            {quotes.length === 0 ? <p style={{ color: '#64748b' }}>You have not saved any quotations yet.</p> : <div style={{ overflowX: 'auto' }}><table style={tableStyle}><thead><tr><th>Reference</th><th>Title</th><th>Travel dates</th><th>Travellers</th><th>Status</th><th>Created</th><th>Export</th></tr></thead><tbody>{quotes.map((quote) => <tr key={quote.id}><td><strong>{quote.reference_number}</strong></td><td>{quote.title}</td><td>{dateLabel(quote.travel_start_date)} – {dateLabel(quote.travel_end_date)}</td><td>{quote.num_adults}A / {quote.num_children}C</td><td>{quote.status.replaceAll('_', ' ')}</td><td>{new Date(quote.created_at).toLocaleDateString()}</td><td><div style={{ display: 'flex', gap: '.3rem' }}>{[['pdf', 'PDF'], ['word', 'Word'], ['excel', 'Excel']].map(([format, label]) => <button key={format} type="button" onClick={() => exportQuote(quote, format)} title={`Export ${label}`} style={commandStyle}>{label}</button>)}</div></td></tr>)}</tbody></table></div>}
          </div>
        </div>}

        {/* Tab 4: Company Profile */}
        {tab === 'profile' && <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 2rem' }}>
          <div style={{ maxWidth: '760px', margin: '0 auto' }}>
            <h2 style={{ margin: '0 0 .4rem', fontSize: '1.2rem', color: '#0d7478' }}>Company Profile</h2>
            <p style={{ color: '#586c70', margin: '0 0 1.2rem', fontSize: '.9rem' }}>This profile appears on the quotations you export.</p>
            <form onSubmit={saveProfile} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '.85rem' }}>
              <label style={{ display: 'grid', gap: '.3rem' }}>Legal or trading name<input style={fieldStyle} value={profile.legal_name} onChange={(e) => setProfile((prev) => ({ ...prev, legal_name: e.target.value }))} /></label>
              <label style={{ display: 'grid', gap: '.3rem' }}>Tax number<input style={fieldStyle} value={profile.tax_number} onChange={(e) => setProfile((prev) => ({ ...prev, tax_number: e.target.value }))} /></label>
              <label style={{ display: 'grid', gap: '.3rem' }}>Email<input type="email" style={fieldStyle} value={profile.email} onChange={(e) => setProfile((prev) => ({ ...prev, email: e.target.value }))} /></label>
              <label style={{ display: 'grid', gap: '.3rem' }}>Telephone<input style={fieldStyle} value={profile.telephone} onChange={(e) => setProfile((prev) => ({ ...prev, telephone: e.target.value }))} /></label>
              <label style={{ display: 'grid', gap: '.3rem' }}>Website<input style={fieldStyle} value={profile.website} onChange={(e) => setProfile((prev) => ({ ...prev, website: e.target.value }))} /></label>
              <label style={{ display: 'grid', gap: '.3rem' }}>Logo image URL or data URL<input style={fieldStyle} value={profile.logo_data_url} onChange={(e) => setProfile((prev) => ({ ...prev, logo_data_url: e.target.value }))} /></label>
              <label style={{ display: 'grid', gap: '.3rem', gridColumn: '1 / -1' }}>Address<textarea rows="3" style={fieldStyle} value={profile.address} onChange={(e) => setProfile((prev) => ({ ...prev, address: e.target.value }))} /></label>
              <button className="primary-btn" disabled={busy} style={{ width: 'auto', gridColumn: '1 / -1' }}>{busy ? 'Saving...' : profileRowExists ? 'Save Profile' : 'Create Profile'}</button>
            </form>
          </div>
        </div>}

        {/* Tab 5: Team Access */}
        {tab === 'team' && context?.role === 'partner_admin' && <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 2rem' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <h2 style={{ margin: '0 0 .4rem', fontSize: '1.2rem', color: '#0d7478' }}>Team Access</h2>
            <p style={{ color: '#586c70', margin: '0 0 1.2rem', fontSize: '.9rem' }}>Invite colleagues to view tariffs and collaborate on agency quotations.</p>
            <form onSubmit={createUserInvite} style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '1.2rem' }}><input type="email" required placeholder="Colleague email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} style={{ ...fieldStyle, maxWidth: '360px' }} /><button type="submit" style={commandStyle}><Send size={15} /> Invite User</button></form>
            {invitations.length > 0 && <div style={{ overflowX: 'auto' }}><table style={tableStyle}><thead><tr><th>Email</th><th>Status</th><th>Created</th><th>Link</th></tr></thead><tbody>{invitations.map((invite) => <tr key={invite.id}><td>{invite.email}</td><td>{invite.status}</td><td>{new Date(invite.created_at).toLocaleDateString()}</td><td>{invite.status === 'pending' && <button type="button" style={commandStyle} onClick={async () => { await navigator.clipboard?.writeText(`${window.location.origin}/partner-register?invite=${invite.invite_code}`); showToast('Invitation link copied', 'success'); }}>Copy link</button>}</td></tr>)}</tbody></table></div>}
          </div>
        </div>}
      </div>

      {/* Room Allocation Modal */}
      {allocatingService && (
        <RoomAllocationModal
          isOpen={!!allocatingService}
          onClose={() => setAllocatingServiceKey(null)}
          onSave={(result) => {
            setServices((prev) => prev.map((s) => (s.key === allocatingService.key ? {
              ...s,
              roomAllocations: result.roomAllocations,
              calculatedSell: result.calculatedSell
            } : s)));
            setAllocatingServiceKey(null);
            showToast('Room and traveller allocation saved', 'success');
          }}
          item={{
            name: allocatingService.name,
            maxOccupancy: allocatingService.maxOccupancy,
            child_age_ranges: allocatingService.childAgeRanges,
            item_rates: [allocatingService.rateSnapshot],
            roomAllocations: allocatingService.roomAllocations
          }}
          itineraryTravellers={travellers}
          currencyCode={allocatingService.currency}
          markupPct={Number(markup) || 0}
        />
      )}
    </main>
  );
};

const fieldStyle = { width: '100%', minWidth: 0, padding: '.5rem .6rem', border: '1px solid #becbc8', borderRadius: '4px', background: '#fff', color: '#203136', fontSize: '.85rem' };
const commandStyle = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '.35rem', padding: '.45rem .75rem', border: '1px solid #0d7478', borderRadius: '4px', background: '#fff', color: '#0d7478', cursor: 'pointer', fontWeight: 600, fontSize: '.85rem' };
const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: '.88rem' };
