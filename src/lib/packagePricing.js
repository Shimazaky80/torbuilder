import { childRateForAge } from './roomAllocationHelper';
import { applyProtectionToRate, resolveSeasonForTravel } from './priceValidity';
import { contractPaxRate } from './servicePricing';

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const numberOf = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
/* A service priced under Pricing Protection carries an uplifted snapshot. The live
   library row is the un-uplifted season, so for a protected line the snapshot has to
   win - otherwise the protection would be silently dropped the moment the pricing
   breakdown or a later re-render resolves the rate again. */
const rateFor = (service, item) => {
  if (numberOf(service?.price_protection_percent) > 0 && service?.rate_snapshot) return service.rate_snapshot;
  return item?.item_rates?.find((rate) => rate.id === service.rate_id)
    || service.rate_snapshot
    || {};
};
const capacityFor = (item, service) => Math.max(0, numberOf(item?.max_occupancy) || numberOf(service?.vehicle_capacity));
/* A traveller pattern is a single party size. It used to be adults + children, but a
   child is only ever priced because of the accommodation, so the pattern carries one
   pax count and the child is handled once, in the child price. Legacy rows that still
   hold adults/children are read as their sum so old packages keep working. */
const totalTravellers = (pattern) => Math.max(1,
  numberOf(pattern?.pax) || (numberOf(pattern?.adults) + numberOf(pattern?.children)));
const isAccommodation = (item, service) => /accommodation/i.test(String(item?.category || service?.category || ''));
const isVehicle = (item, service, rate) => {
  const category = String(item?.category || service?.category || '');
  const basis = String(rate?.rate_basis || service?.rate_basis || item?.pricing_model || '').toLowerCase();
  if (basis === 'per_vehicle' || /transfers?|flights?\s*\/?\s*charter/i.test(category)) return true;
  return capacityFor(item, service) > 0 && /activities?|tours?|excursions?/i.test(category);
};
const currencyOf = (service) => service?.currency_code || 'ZAR';
const includedServices = (days = []) => (Array.isArray(days) ? days : [])
  .flatMap((day) => Array.isArray(day?.services) ? day.services : [])
  .filter((service) => service?.is_included !== false);
const libraryEntryFor = (service, library = []) =>
  (Array.isArray(library) ? library : []).find((entry) => entry?.id && entry.id === service?.item_id) || null;

/* Dates are compared as UTC day indexes so a contract window never slides a day
   across a timezone boundary. Anything that is not a plain YYYY-MM-DD string is
   treated as absent, which leaves that end of a window open. */
const isoDate = (value) => {
  const text = String(value ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
};
const dayIndex = (value) => {
  const text = isoDate(value);
  return text ? Date.UTC(Number(text.slice(0, 4)), Number(text.slice(5, 7)) - 1, Number(text.slice(8, 10))) : null;
};

/* Complete, correctly ordered validity ranges the package is sold for. An
   incomplete or inverted row is dropped here rather than treated as open-ended,
   so a half-filled date can never widen the contract window it is checked
   against. */
export const packageValidityWindows = (periods = []) => (Array.isArray(periods) ? periods : [])
  .map((period) => ({ from: isoDate(period?.valid_from), to: isoDate(period?.valid_to) }))
  .filter((window) => window.from && window.to && window.to >= window.from)
  .map((window) => ({ ...window, fromDay: dayIndex(window.from), toDay: dayIndex(window.to) }));

const seasonLabel = (rate) => String(rate?.season_name || rate?.option_name || '').trim() || 'Contract rate';
const seasonWindowText = (rate) => {
  const from = isoDate(rate?.valid_from);
  const to = isoDate(rate?.valid_to);
  if (from && to) return `${from} – ${to}`;
  if (from) return `from ${from}`;
  if (to) return `until ${to}`;
  return 'no validity dates';
};

/* Coverage is containment and undated rows never count as covered: a season has
   to prove it runs for the whole package validity range before it can price it. */
const rateCoversWindow = (rate, window) => {
  const from = dayIndex(rate?.valid_from);
  const to = dayIndex(rate?.valid_to);
  if (from === null && to === null) return false;
  return (from === null || from <= window.fromDay) && (to === null || to >= window.toDay);
};
const rateCoverageCount = (rate, windows) =>
  windows.reduce((total, window) => total + (rateCoversWindow(rate, window) ? 1 : 0), 0);

const uniqueRates = (item, rate) => {
  const rows = [rate, ...(Array.isArray(item?.item_rates) ? item.item_rates : [])].filter(Boolean);
  return [...new Map(rows.map((row) => [row.id ?? `${row.currency || ''}:${seasonLabel(row)}:${seasonWindowText(row)}`, row])).values()];
};

/**
 * Does the season behind this contract rate actually cover the dates the package
 * is sold for?
 *
 * One package day item carries one season, so a single season has to span every
 * validity range on the package. Four outcomes:
 *   open    the package has no restricted validity range — nothing to check.
 *   ok      the chosen season covers the whole package validity range.
 *   swap    another season on the same item does cover it; name it so the user
 *           can switch instead of hunting through the matrix.
 *   missing no season covers it, so the user has to add an item that is
 *           contracted for the package dates before the package can be saved.
 */
export const packageSeasonCoverage = (item, rate, periods = []) => {
  const windows = packageValidityWindows(periods);
  const name = item?.name || 'This item';
  if (!windows.length) return { status: 'open', ok: true, message: '' };

  const ranges = windows.map((window) => `${window.from} – ${window.to}`).join(', ');
  const rates = uniqueRates(item, rate);
  if (rate && rateCoverageCount(rate, windows) === windows.length) return { status: 'ok', ok: true, message: '' };

  const covering = rates.find((row) => rateCoverageCount(row, windows) === windows.length);
  if (covering) {
    return {
      status: 'swap',
      ok: false,
      coveringRateId: covering.id || null,
      message: `${name} is priced from “${seasonLabel(rate)}” (${seasonWindowText(rate)}), which does not cover the package validity dates ${ranges}. Use the “${seasonLabel(covering)}” season (${seasonWindowText(covering)}) instead, or extend that season in Library Items.`
    };
  }

  const partial = rates.filter((row) => rateCoverageCount(row, windows) > 0);
  if (partial.length) {
    const best = partial.reduce((winner, row) => (
      rateCoverageCount(row, windows) > rateCoverageCount(winner, windows) ? row : winner
    ));
    return {
      status: 'missing',
      ok: false,
      message: `${name} has no single season that covers the whole package validity range ${ranges}. Its closest season “${seasonLabel(best)}” (${seasonWindowText(best)}) only covers part of it. Add an item contracted for the full package dates, or shorten the package validity range.`
    };
  }

  return {
    status: 'missing',
    ok: false,
    message: `${name} has no season in its pricing matrix that covers the package validity dates ${ranges}. Add an item that is contracted for the full package dates, or change the package validity dates.`
  };
};

export const packageItemSeasonError = (item, rate, periods = []) => packageSeasonCoverage(item, rate, periods).message;

/**
 * Which season prices an item on this package, and whether Pricing Protection stands
 * in for it.
 *
 * This delegates to the same resolver the itinerary builder uses, so a package and an
 * itinerary can never disagree about the same contract row. A season that sits behind
 * the package dates is protected exactly as it would be on a trip, using the tenant's
 * protection percentage; the returned rate is already uplifted, so callers can price
 * straight from it.
 *
 *   open      the package has no restricted validity range - nothing to check
 *   ok        a season spans every validity range
 *   protected no season spans them; the closest prior season is uplifted
 *   blocked   nothing usable, so the item cannot join the package
 */
export const packageSeasonResolution = ({ item, rate, periods = [], currencyCode = '', protectionPercent = 0 } = {}) => {
  const windows = packageValidityWindows(periods);
  if (!windows.length) return { status: 'open', ok: true, canAdd: true, protectionPercent: 0, rate: rate || null, seasonName: '', message: '' };

  const name = item?.name || 'This item';
  const rates = uniqueRates(item, rate);
  const ranges = windows.map((window) => `${window.from} – ${window.to}`).join(', ');
  const results = windows.map((window) => resolveSeasonForTravel({
    rates,
    currencyCode: currencyCode || rate?.currency || item?.currency || '',
    startDate: window.from,
    endDate: window.to,
    protectionPercent
  }));

  const blocked = results.find((result) => !result.canAdd);
  if (blocked) {
    return { status: 'blocked', ok: false, canAdd: false, protectionPercent: 0, rate: null, seasonName: '', message: `${name}: ${blocked.reason}` };
  }

  const guarded = results.find((result) => result.status === 'protected');
  if (guarded) {
    const years = guarded.staleByYears;
    return {
      status: 'protected',
      ok: true,
      canAdd: true,
      protectionPercent: guarded.protectionPercent,
      rate: applyProtectionToRate(guarded.rate, guarded.protectionPercent),
      seasonName: guarded.seasonName,
      message: `${name}: no season covers ${ranges}. Pricing Protection applied — ${guarded.protectionPercent}% added to the “${guarded.seasonName || 'previous'}” season${years ? ` (${years} year${years === 1 ? '' : 's'} old)` : ''}, which runs ${guarded.validFrom || 'open'} – ${guarded.validTo || 'open'}.`
    };
  }

  const covering = results[0];
  return {
    status: 'ok',
    ok: true,
    canAdd: true,
    protectionPercent: 0,
    rate: covering.rate || rate || null,
    seasonName: covering.seasonName,
    message: covering.reason ? `${name}: ${covering.reason}` : ''
  };
};



/* The season to price an item with on this package: the first one that covers the
   whole validity range, so adding an item never silently picks a season that does
   not apply. Returns undefined when the package has no restricted dates. */
export const packageRateForDates = (item, periods = []) => {
  const windows = packageValidityWindows(periods);
  const rates = Array.isArray(item?.item_rates) ? item.item_rates : [];
  if (!windows.length) return undefined;
  return rates.find((row) => rateCoverageCount(row, windows) === windows.length) || undefined;
};

export const packageItemCapacityError = (item, rate, patterns = []) => {
  if (!isAccommodation(item, {}) && !isVehicle(item, {}, rate)) return '';
  const capacity = capacityFor(item, {});
  if (!capacity) {
    return `${item?.name || 'This item'} has no maximum occupancy set. Add its contracted vehicle or room capacity in Library Items before using it in a package.`;
  }
  if (isAccommodation(item, {})) return '';
  if (!patterns.length) return 'Add at least one traveller pattern before adding a capacity-limited transport or activity service.';
  const oversized = patterns.find((pattern) => totalTravellers(pattern) > capacity);
  return oversized
    ? `${item?.name || 'This item'} holds up to ${capacity} travellers, but a package pattern has ${totalTravellers(oversized)}. Choose a contracted item with sufficient capacity.`
    : '';
};

/* One party split into rooms of the contracted capacity. Children are not separated
   out here: the pattern is a single pax count and a child is priced once, against the
   accommodation contract, in the child price. */
export const roomsForPax = (pax, capacity) => {
  const travellers = Math.max(0, Math.floor(numberOf(pax)));
  const limit = Math.max(1, Math.floor(numberOf(capacity)));
  const roomCount = Math.ceil((travellers || 1) / limit);
  return Array.from({ length: roomCount }, (_, index) => ({
    occupants: Math.max(0, Math.min(limit, travellers - index * limit))
  }));
};

const amount = (...values) => {
  let fallback = 0;
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))) {
      fallback = Number(value);
      if (fallback !== 0) return fallback;
    }
  }
  return fallback;
};
const FLAT_BASES = new Set(['per_vehicle', 'per_trip', 'per_room', 'flat']);

/* How the contracted rate splits into sharing, single and child figures. Kept in
   one place so the room allocation, the traveller breakdown and the child price
   can never quote different numbers from the same contract. */
const accommodationTerms = (service, item) => {
  const rate = rateFor(service, item);
  const flatRoom = String(rate.rate_basis || service.rate_basis || '').toLowerCase() === 'per_room';
  const flatSharing = amount(rate.unit_price, rate.double_twin_rate, rate.price_2_adults);
  const sharing = flatRoom
    ? flatSharing / 2
    : amount(rate.price_2_adults, rate.double_twin_rate, rate.price_1_adult, rate.unit_price);
  const single = amount(rate.single_room_rate, rate.effective_single_rate, rate.price_1_adult, rate.unit_price, sharing);
  return {
    rate,
    flatRoom,
    sharing,
    single,
    extraAdult: amount(rate.price_3_plus_adults, sharing),
    flatSingle: amount(rate.single_room_rate, rate.effective_single_rate, rate.price_1_adult, flatSharing)
  };
};

export const accommodationRoomPlan = (service, item, pattern = {}) => {
  const { sharing, single } = accommodationTerms(service, item);
  const capacity = capacityFor(item, service);
  const pax = totalTravellers(pattern);
  const rooms = roomsForPax(pax, capacity);
  return {
    capacity,
    pax,
    roomCount: Math.max(1, rooms.length),
    sharingPerAdult: round2(sharing),
    singleSupplement: round2(Math.max(0, single - sharing))
  };
};

const unitContributionPerTraveller = (service, item, pax) => {
  const rate = rateFor(service, item);
  const currency = service.currency_code || rate.currency || item?.currency || 'ZAR';
  const pricedItem = {
    ...(item || {}),
    pricing_model: item?.pricing_model || rate.rate_basis || service.rate_basis,
    item_rates: [rate]
  };
  const unitPax = contractPaxRate(pricedItem, currency, pax);
  const unitCost = amount(rate.price_1_adult, rate.unit_price, rate.unit_cost, service.unit_cost);
  const basis = String(rate.rate_basis || service.rate_basis || item?.pricing_model || '').toLowerCase();
  const quantity = Math.max(1, numberOf(service.quantity) || 1);
  let perTraveller = unitPax || unitCost;
  if (FLAT_BASES.has(basis)) {
    perTraveller = unitPax || unitCost / pax;
  }
  if (basis === 'per_vehicle') {
    const capacity = capacityFor(item, service);
    perTraveller = unitCost * Math.ceil(pax / Math.max(1, capacity)) / pax;
  }
  return round2(perTraveller * quantity);
};

/**
 * The one child age range a package declares.
 *
 * A package carries a single child range, never a per-age table of its own: the price
 * is decided by whichever band the accommodation itself contracts for that range.
 * The ceiling is 18 because some properties still treat an 18 year old as a child.
 */
export const PACKAGE_MAX_CHILD_AGE = 18;

export const normaliseChildAgeRange = (range) => {
  const from = Math.min(PACKAGE_MAX_CHILD_AGE, Math.max(0, Math.floor(numberOf(range?.ageFrom))));
  const rawTo = range?.ageTo;
  const to = rawTo === null || rawTo === undefined || rawTo === ''
    ? PACKAGE_MAX_CHILD_AGE
    : Math.min(PACKAGE_MAX_CHILD_AGE, Math.max(from, Math.floor(numberOf(rawTo))));
  return { name: String(range?.name || 'Children'), ageFrom: from, ageTo: to };
};

/* A null range means children have not been priced yet, which is different from a
   range that no property happens to allow. */
export const packageChildAgeRange = (range) => (
  range && typeof range === 'object' ? normaliseChildAgeRange(range) : null
);

const bandSpans = (band, from, to) => {
  const bandFrom = numberOf(band?.ageFrom);
  const rawTo = band?.ageTo;
  const bandTo = rawTo === null || rawTo === undefined || rawTo === '' ? Infinity : numberOf(rawTo);
  return bandFrom <= to && bandTo >= from;
};

/* Which contracted band prices a child, for one accommodation and the package's
   declared child range. Several of a property's own bands can span a wide package
   range, so the most expensive one wins: a package quoted as "up to 18" must never
   be priced off the infant band. */
export const childBandForRange = (rate, itemAgeRanges = [], childRange = null, sharing = 0) => {
  const ranges = Array.isArray(itemAgeRanges) ? itemAgeRanges : [];
  if (!childRange) return { rate: null, known: false, band: null };
  if (!ranges.length) {
    const flat = childRateForAge(rate, undefined, [], sharing);
    return flat.known ? { rate: flat.rate, known: true, band: null } : { rate: null, known: false, band: null };
  }
  const priced = ranges
    .filter((band) => bandSpans(band, childRange.ageFrom, childRange.ageTo))
    .map((band) => ({ band, child: childRateForBand(rate, band, ranges, sharing) }))
    .filter((entry) => entry.child.known);
  if (!priced.length) return { rate: null, known: false, band: null };
  const best = priced.reduce((winner, entry) => (
    numberOf(entry.child.rate) > numberOf(winner.child.rate) ? entry : winner
  ));
  return { rate: best.child.rate, known: true, band: best.band };
};

const childAccommodationFor = (service, item, childRange) => {
  const { rate, sharing, single } = accommodationTerms(service, item);
  const child = childBandForRange(rate, item?.child_age_ranges || [], childRange, sharing);
  return {
    /* A child is a sharer only where the property's own contract prices a child for
       this age range. Where it does not, that accommodation does not take the child,
       so it is quoted at the single supplement instead. `null` means no child age
       range has been declared, which is neither of those answers. */
    childAllowed: childRange ? child.known : null,
    childAccommodation: round2(child.known ? child.rate : Math.max(0, single - sharing)),
    childBandName: child.band ? String(child.band?.name || `${numberOf(child.band?.ageFrom)}–${child.band?.ageTo ?? 'open'}`) : ''
  };
};

const accommodationPricing = (service, item, { pax, childRange }) => {
  const terms = accommodationTerms(service, item);
  const { flatRoom, sharing, extraAdult } = terms;
  const capacity = capacityFor(item, service);
  const rooms = roomsForPax(pax, capacity);

  let adultTotal = 0;
  rooms.forEach((room) => {
    if (!room.occupants) return;
    if (flatRoom) {
      adultTotal += room.occupants * sharing;
      return;
    }
    adultTotal += Math.min(room.occupants, 2) * sharing;
    adultTotal += Math.max(0, room.occupants - 2) * extraAdult;
  });

  /* These are all per-traveller figures, so the room count must not be applied a
     second time on top of it. adultTotal is already the sum over the allocated
     rooms, so dividing by pax gives the per-traveller share; multiplying that by
     the room count again is what inflated a 4-room package to four times the
     contract rate. The stored quantity on an accommodation row is the room count,
     which is exactly why the double multiplication was possible. */
  return {
    capacity,
    pax,
    roomCount: Math.max(1, rooms.length),
    sharingPerAdult: round2(adultTotal / pax),
    singleSupplement: round2(Math.max(0, terms.single - sharing)),
    ...childAccommodationFor(service, item, childRange)
  };
};

/**
 * The package price for one party size, per currency.
 *
 * A child only ever differs from an adult because of the accommodation. Every other
 * service is shared unit cost divided by pax, and the child pays exactly that, so the
 * child price starts from the same unit share as the adult price.
 *
 * Three figures come out of it:
 *   adultSharingTotal   unit share + accommodation sharing
 *   singleSupplement    every accommodation's single supplement, for an adult on their own
 *   childTotal          unit share + accommodation, where the property prices a child
 *                       for the declared child range, or its single supplement where it does not
 */
export const calculatePackageTravellerBreakdown = ({ days = [], pattern, library = [], childRange = null } = {}) => {
  const pax = totalTravellers(pattern);
  const services = includedServices(days);
  const currencies = [...new Set(services.map(currencyOf))];

  return currencies.map((currency) => {
    const rows = services.filter((service) => currencyOf(service) === currency);
    const unitRows = [];
    const accommodationRows = [];

    rows.forEach((service) => {
      const item = libraryEntryFor(service, library);
      const name = service.item_name || item?.name || (isAccommodation(item, service) ? 'Accommodation' : 'Service');
      if (isAccommodation(item, service)) {
        accommodationRows.push({ name, ...accommodationPricing(service, item, { pax, childRange }) });
        return;
      }
      const perPerson = unitContributionPerTraveller(service, item, pax);
      unitRows.push({
        name,
        perPerson: round2(perPerson),
        total: round2(perPerson * pax),
        /* Accommodation figures are zero, not blank: this row genuinely carries no
           room cost, and a blank cell reads as "not worked out yet". */
        sharingPerAdult: 0,
        singleSupplement: 0,
        childAccommodation: 0
      });
    });

    const sum = (rows_, field) => round2(rows_.reduce((total, row) => total + numberOf(row[field]), 0));
    const unitPerPerson = sum(unitRows, 'perPerson');
    const accommodationSharing = sum(accommodationRows, 'sharingPerAdult');
    const childAccommodation = sum(accommodationRows, 'childAccommodation');
    const singleSupplement = sum(accommodationRows, 'singleSupplement');

    return {
      currency,
      pax,
      unitRows,
      accommodationRows,
      unitPerPerson,
      accommodationSharing,
      childAccommodation,
      singleSupplement,
      adultSharingTotal: round2(unitPerPerson + accommodationSharing),
      /* An adult in their own room still pays every shared unit charge, so the card
         is the unit share plus the supplement, not the supplement on its own. */
      singleSupplementTotal: round2(unitPerPerson + singleSupplement),
      childTotal: round2(unitPerPerson + childAccommodation),
      /* Nothing is "refusing a child" until a child age range has actually been
         declared; without one nothing is being priced for a child at all. */
      childNotAllowed: packageChildAgeRange(childRange)
        ? accommodationRows.filter((row) => !row.childAllowed).map((row) => row.name)
        : [],
      childPriced: Boolean(packageChildAgeRange(childRange)),
      unitTotal: sum(unitRows, 'total')
    };
  });
};

/* The biggest party the package is quoted for. Room allocation runs off this so the
   operator never has to add rooms by hand to fit the travellers. */
export const largestTravellerPattern = (patterns = []) => ({
  pax: (Array.isArray(patterns) ? patterns : []).reduce(
    (best, pattern) => Math.max(best, totalTravellers(pattern)), 0
  )
});

/* Contracted child rate for one age band. The band id is looked up directly so a
   package can keep the supplier's own band even when the user renamed it, then
   the band age resolves against the item's ranges, then the flat child figures. */
export const childRateForBand = (rate, band, itemAgeRanges = [], sharing = 0) => {
  const breakdown = rate?.child_rates_breakdown;
  const key = String(band?.id ?? '');
  if (breakdown && typeof breakdown === 'object' && key && Object.prototype.hasOwnProperty.call(breakdown, key)) {
    const bandRate = parseFloat(breakdown[key]);
    if (Number.isFinite(bandRate)) return { rate: bandRate, known: true };
  }
  return childRateForAge(rate, Number(band?.ageFrom), Array.isArray(itemAgeRanges) ? itemAgeRanges : [], sharing);
};
