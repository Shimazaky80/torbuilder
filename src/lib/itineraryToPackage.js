import { packageKey, packageRateForDates, packageSeasonResolution } from './packagePricing';
import { applyProtectionToRate } from './priceValidity';
import { servicePax } from './servicePricing';
import { isAdultTraveller, normaliseTravellerRole } from './roomAllocationHelper';

/* A package line stores the contract cost of ONE unit, while an itinerary line
   stores a per-person share of the whole line. Flat bases (a vehicle, a guide's
   day, a room) are therefore multiplied back out before they cross over; a
   per-person line crosses over unchanged. */
const FLAT_BASES = new Set(['per_vehicle', 'per_trip', 'per_room', 'per_unit', 'flat']);

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

const guideTypesOf = (service) => (Array.isArray(service?.guideServiceTypes)
  ? service.guideServiceTypes.filter(Boolean)
  : []);

const isGuideDetail = (service) => service?.guideOnly === true || Boolean(service?.guideForKey);

const isSurchargeLine = (service) => Boolean(service?.surchargeType || service?.surchargeUnitBasis);

const validityPeriodsFor = (start, end) => (
  start && end && end >= start
    ? [{ valid_from: start, valid_to: end, name: 'Itinerary dates', accommodation_per_person: null, single_supplement: 0 }]
    : []
);

/* The season the itinerary line was priced from, so the package can re-price
   itself at other party sizes from the same contract row. Lines built in this
   session already carry the resolved (and possibly protected) row; a line read
   back from the database does not, so it is re-resolved from the library. */
const selectRate = (service, item, periods, currency) => {
  const own = (Array.isArray(service?.item_rates) ? service.item_rates : [])
    .filter((rate) => rate && typeof rate === 'object');
  const pool = own.length ? own : (Array.isArray(item?.item_rates) ? item.item_rates : []);
  const code = String(currency || '').trim().toUpperCase();
  const matching = code ? pool.filter((rate) => String(rate?.currency || '').toUpperCase() === code) : pool;
  const candidates = matching.length ? matching : pool;
  if (!candidates.length) return null;

  const covering = packageRateForDates({ item_rates: candidates }, periods);
  const preferred = service?.protectedSeasonName
    ? candidates.find((rate) => rate.season_name === service.protectedSeasonName)
    : null;
  const protection = Number(service?.priceProtectionPercent) || 0;

  if (!covering && protection > 0) {
    /* A line reloaded from the database keeps its protection percent but not the
       season's name. The shared resolver picks the closest prior season exactly
       as the itinerary did, so the package cannot quietly reprice it. */
    const resolution = packageSeasonResolution({
      item: { item_rates: candidates },
      rate: preferred || candidates[0],
      periods,
      currencyCode: code || currency,
      protectionPercent: protection
    });
    if (resolution.status === 'protected' && resolution.rate) return resolution.rate;
  }

  const chosen = covering || preferred || candidates[0] || null;
  if (!chosen) return null;
  if (protection > 0 && Number(chosen?.price_protection_percent) !== protection) {
    return applyProtectionToRate(chosen, protection);
  }
  return chosen;
};

const notesFor = (service) => {
  const parts = [service?.descOverride, service?.notes]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return parts.length ? parts.join('\n') : null;
};

/* A package re-checks every line against its validity dates on save. A line
   with no library rate still needs a season-shaped snapshot, or the first save
   would refuse a line this conversion legitimately copied; the cost itself is
   carried by unit_cost. The same stub is used for a surcharge or a guide &
   driver detail, whose charged amount is not the item's own contract figure. */
const seasonStub = (rate, basis, service, currency, periods) => {
  const period = periods[0] || {};
  return {
    id: rate?.id || undefined,
    currency: String(rate?.currency || service?.currencyCode || currency || 'ZAR').toUpperCase(),
    rate_basis: basis,
    season_name: rate?.season_name || 'Itinerary dates',
    valid_from: rate?.valid_from || period.valid_from || null,
    valid_to: rate?.valid_to || period.valid_to || null
  };
};

const lineFor = (service, item, periods, currency, fallbackPax, shareContext) => {
  const guideTypes = guideTypesOf(service);
  const guideDetail = isGuideDetail(service);
  const guide = guideTypes.length > 0;
  const surcharge = isSurchargeLine(service);
  const divisor = Math.max(1, Number(servicePax(service, fallbackPax, shareContext)) || 0);
  const quantity = Math.max(1, Number(service?.quantity) || 1);
  const buyPP = Number(service?.buyPP) || 0;

  let basis = String(service?.basis || 'per_person').toLowerCase();
  let unitCost;
  let outputQuantity = quantity;
  if (guide || guideDetail) {
    /* A guide line is a flat per-trip sum on the itinerary, split across the
       clients and tour leaders. The package carries the flat sum itself. */
    basis = 'per_trip';
    unitCost = round2(buyPP * divisor);
    outputQuantity = 1;
  } else if (surcharge) {
    /* Packages have no surcharge model, so the fee crosses over as the same
       per-person cost the itinerary stored, with its repeats already folded in. */
    basis = 'per_person';
    unitCost = round2(buyPP);
    outputQuantity = 1;
  } else if (FLAT_BASES.has(basis)) {
    unitCost = round2((buyPP * divisor) / quantity);
  } else {
    unitCost = round2(buyPP);
  }

  const rate = selectRate(service, item, periods, service?.currencyCode || currency);
  const snapshot = surcharge || guideDetail
    ? seasonStub(rate, basis, service, currency, periods)
    : (rate || seasonStub(rate, basis, service, currency, periods));
  const isStay = /accommodation/i.test(String(service?.category || item?.category || ''));
  return {
    item_key: packageKey(),
    /* A line whose library item cannot be resolved is still copied, but without
       a dangling reference; its cost and snapshot keep it priceable. */
    item_id: item?.id || null,
    rate_id: item && rate?.id ? rate.id : null,
    item_name: service?.name || item?.name || 'Service',
    category: service?.category || item?.category || '',
    supplier_name: service?.supplierName || item?.supplier?.name || item?.supplier_name || '',
    currency_code: String(service?.currencyCode || currency || 'ZAR').toUpperCase(),
    rate_basis: basis,
    unit_cost: unitCost,
    unit_price: unitCost,
    quantity: outputQuantity,
    is_included: service?.isOptional !== true,
    notes: notesFor(service),
    vehicle_capacity: isStay
      ? (Number(service?.maxOccupancy) || Number(rate?.room_max_occupancy) || Number(item?.max_occupancy) || 0)
      : (Number(service?.maxOccupancy) || Number(item?.max_occupancy) || 0),
    room_type_id: isStay ? (service?.roomTypeId || rate?.room_type_id || null) : null,
    room_type: isStay ? (service?.roomType || rate?.room_type || '') : '',
    tier_key: null,
    replaces_item_key: null,
    rate_snapshot: snapshot,
    price_protection_percent: Number(service?.priceProtectionPercent) || 0,
    protected_season_name: service?.protectedSeasonName || '',
    guide_service_types: guideTypes.length ? guideTypes : null,
    guide_only: service?.guideOnly === true,
    guide_for_item_key: null,
    guide_charge_type: service?.guideChargeType || null
  };
};

/* The package party is the paying party, not the staffing: tour leaders and
   guides are priced into a package as services, never as travellers. */
const partyFor = (meta) => {
  const travellers = Array.isArray(meta?.travellers) ? meta.travellers : [];
  const clients = travellers.filter((traveller) => normaliseTravellerRole(traveller?.role) === 'client');
  const adults = clients.filter(isAdultTraveller).length;
  if (adults > 0) return adults;
  if (clients.length > 0) return clients.length;
  return Math.max(1, (Number(meta?.numAdults) || 0) + (Number(meta?.numChildren) || 0));
};

const clientChildren = (meta) => {
  const travellers = Array.isArray(meta?.travellers) ? meta.travellers : [];
  return travellers.filter((traveller) => (
    normaliseTravellerRole(traveller?.role) === 'client' && !isAdultTraveller(traveller)
  ));
};

const childAgeRangeFor = (meta) => {
  const ages = clientChildren(meta)
    .map((traveller) => parseInt(traveller?.age, 10))
    .filter((age) => Number.isFinite(age) && age >= 0 && age < 18);
  if (!ages.length) return null;
  return {
    name: 'Children',
    ageFrom: Math.max(0, Math.min(...ages)),
    ageTo: Math.min(18, Math.max(...ages))
  };
};

const packageNameFor = (meta) => {
  const reference = String(meta?.referenceNumber || '').trim();
  const base = String(meta?.itineraryName || '').trim() || (reference ? `Itinerary ${reference}` : 'Itinerary');
  return /package$/i.test(base) ? base : `${base} Package`;
};

const descriptionFor = (meta, start, end) => {
  const reference = String(meta?.referenceNumber || '').trim();
  const source = reference ? `Converted from itinerary ${reference}` : 'Converted from an itinerary';
  const dates = start && end ? ` (${start} to ${end})` : '';
  return `${source}${dates}.`;
};

export const buildItineraryPackage = ({
  meta = {},
  days = [],
  libraryItems = [],
  shareContext = null,
  fallbackPax = 0,
  travelWindow = {},
  currencyCode = 'ZAR'
} = {}) => {
  const currency = String(currencyCode || 'ZAR').trim().toUpperCase() || 'ZAR';
  const start = String(travelWindow?.start || '').trim();
  const end = String(travelWindow?.end || '').trim();
  const periods = validityPeriodsFor(start, end);
  const libraryById = new Map(
    (Array.isArray(libraryItems) ? libraryItems : []).map((item) => [String(item.id), item])
  );
  const sourceDays = Array.isArray(days) ? days : [];

  const mappedDays = sourceDays.map((day, dayIndex) => ({
    day_number: dayIndex + 1,
    notes: day?.notes || null,
    items: (day?.services || []).map((service) => lineFor(
      service,
      libraryById.get(String(service?.itemId)),
      periods,
      currency,
      fallbackPax,
      shareContext
    ))
  }));

  /* Guide & driver detail lines point at the guide line by the guide item's id
     on an itinerary; a package links by item_key. The keys are generated above,
     so they are collected first and the links rewritten afterwards. */
  const guideKeys = new Map();
  sourceDays.forEach((day, dayIndex) => {
    (day?.services || []).forEach((service, serviceIndex) => {
      if (guideTypesOf(service).length && service?.itemId) {
        guideKeys.set(String(service.itemId), mappedDays[dayIndex].items[serviceIndex].item_key);
      }
    });
  });
  sourceDays.forEach((day, dayIndex) => {
    (day?.services || []).forEach((service, serviceIndex) => {
      if (service?.guideForKey) {
        mappedDays[dayIndex].items[serviceIndex].guide_for_item_key = guideKeys.get(String(service.guideForKey)) || null;
      }
    });
  });

  const bandPax = partyFor(meta);
  const childRange = childAgeRangeFor(meta);
  const hasTravellers = Array.isArray(meta?.travellers) && meta.travellers.length > 0;
  return {
    name: packageNameFor(meta),
    description: descriptionFor(meta, start, end),
    currency_code: currency,
    accepts_children: hasTravellers ? clientChildren(meta).length > 0 : (Number(meta?.numChildren) || 0) > 0,
    child_age_ranges: childRange ? [childRange] : [],
    days: mappedDays,
    validity_periods: periods,
    pax_options: [{
      item_key: packageKey(),
      pax: bandPax,
      adults: bandPax,
      children: 0,
      min_pax: bandPax,
      max_pax: bandPax,
      is_auto_generated: false
    }]
  };
};
