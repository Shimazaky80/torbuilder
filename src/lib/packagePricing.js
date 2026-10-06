import { childRateForAge } from './roomAllocationHelper';
import { applyProtectionToRate, resolveSeasonForTravel } from './priceValidity';
import { contractPaxRate } from './servicePricing';

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const numberOf = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

/* Stable keys for bands and day items. A package is rewritten from scratch on every save,
   so a band item that replaces a base service cannot point at a database id: the ids are
   recreated mid-save. The key is minted once, on the client, and carried in the row. */
export const packageKey = () => {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  /* A fallback for a browser without randomUUID, so a missing key never silently breaks
     band membership. Shape only - these are identifiers, never secrets. */
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === 'x' ? random : ((random & 0x3) | 0x8)).toString(16);
  });
};
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

/* Whether a library item is fit to be put in a package at all. This is deliberately only
   about the item, never about the package: whether a vehicle is big enough is a question
   about the whole vehicle set, and that question is answered per band by
   packageBandCapacityError. Comparing a single item against the biggest band here used to
   block the smallest vehicle of the set while letting the bigger ones through, because
   while a package is still being loaded every vehicle set is incomplete. */
export const packageItemCapacitySetupError = (item, rate) => {
  if (!isAccommodation(item, {}) && !isVehicle(item, {}, rate)) return '';
  const capacity = capacityFor(item, {});
  if (!capacity) {
    return `${item?.name || 'This item'} has no maximum occupancy set. Add its contracted vehicle or room capacity in Library Items before using it in a package, or it cannot price a traveller band.`;
  }
  return '';
};

/* ---------------------------------------------------------------------------
   PAX BANDS
   ---------------------------------------------------------------------------
   A band is ONE exact party size: "3 pax", "7 pax". It is not a span of party sizes.

   That is deliberate. A vehicle is priced whole, and the people on the day are the people
   who have to pay for it, so the band a client books IS their headcount: a band of 3 in a
   4-seat vehicle pays vehiclePrice / 3 each, which sums back to the full vehicle price.

   Spreading a fixed vehicle charge over a range and quoting the per-person share as the
   price is what under-charges a small party - a lone traveller on a 4-seat vehicle booked
   into a "1-4" band was quoted a quarter of the vehicle they took. So the range concept is
   gone rather than kept as a second way of saying the same thing. `pax` is the actual
   number of travellers, which is also why the rest of the pricing path needs no change:
   rooms, sharing, single supplement and the unit share already work off the party size.

   Which services a band pays for is resolved in two layers:

   1. TRANSPORT ALTERNATIVES, automatically. Two vehicles on the same day are alternatives,
      not two line items: a party of 10 in a saloon-and-microbus package must be charged
      for the microbus, not for both. The band is served by the smallest vehicle that still
      seats it. This needs no configuration at all - add a saloon, add a microbus, and the
      bands and the right vehicle for each follow by themselves.

   2. EXPLICIT BAND ITEMS, for everything else. A band sometimes needs a different
      itinerary: another excursion, a different lodge, or a service it does not pay for at
      all. Those are explicit overrides, because "one more boat trip for the big group"
      cannot be inferred from a capacity. */

/* One exact party size, accepting either a number or a stored band row. A legacy row that
   used to hold a span collapses onto the number it was already being priced at - its old
   ceiling - so opening an existing package never silently re-quotes it at a different size.
   min_pax and max_pax are still written to the row and are always the same number, which
   keeps the stored columns and their indexes meaningful. */
export const packageBandPax = (option) => {
  const value = typeof option === 'number' ? option : (option?.pax ?? option?.max_pax ?? (numberOf(option?.adults) + numberOf(option?.children)));
  return Math.max(1, numberOf(value) || 1);
};

export const packageBandLabel = (option) => `${packageBandPax(option)} pax`;

/* A stable identity for a band at a given party size.
   The key has to stay the same for as long as the size does, because band services point at
   it and a fresh key on every render would quietly detach them. It is derived from the size
   alone, so it survives a reload, and it is shaped as a UUID because it gets saved as one.
   Two packages producing the same size get the same value, which is harmless: the key is
   only ever read back inside its own package. */
export const packageAutoBandKey = (pax) => {
  const seed = `package-band:${packageBandPax(pax)}`;
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619);
  }
  const hex = (value, width) => (value >>> 0).toString(16).padStart(width, '0').slice(-width);
  return [
    hex(hash, 8),
    hex(hash >>> 11, 4),
    `4${hex(hash >>> 7, 3)}`,
    hex((hash & 0x3fff) | 0x8000, 4),
    hex(hash ^ 0x9e3779b9, 12)
  ].join('-');
};

/* A band can be passed as the stored row or as a bare key, so callers that only know the
   key (a day item's tier_key) still resolve. A bare key carries no ceiling, so layer 1
   cannot run for it and only the explicit overrides apply. */
const bandContext = (band) => {
  if (band === null || band === undefined) return { key: '', pax: 0 };
  if (typeof band === 'string' || typeof band === 'number') return { key: String(band), pax: 0 };
  return { key: String(band.item_key || band.tier_key || ''), pax: packageBandPax(band) };
};

const tierKeyOf = (service) => (service?.tier_key ? String(service.tier_key) : '');

/* Transport only. An activity that happens to have a capacity is not an alternative
   vehicle: dropping a 12-seat boat tour in favour of a saloon because the ceiling is 10
   would be nonsense, so capacity-limited activities are left to explicit band items. */
const isTransport = (item, service) => {
  const category = String(item?.category || service?.category || '');
  const basis = String(rateFor(service, item)?.rate_basis || service?.rate_basis || item?.pricing_model || '').toLowerCase();
  if (/transfers?|flights?\s*\/?\s*charter/i.test(category)) return capacityFor(item, service) > 0;
  return (basis === 'per_vehicle' || basis === 'per_trip') && capacityFor(item, service) > 0;
};

const transportCapacity = (item, service) => Math.floor(capacityFor(item, service));

/* Whether a saved line is a vehicle that can stand in for another on the same day. Used by
   the builder to tell "this is a second, bigger vehicle for the bigger bands" apart from
   "this is the only vehicle, and the party does not fit in it". */
export const packageIsTransport = (service, library = []) => {
  const item = libraryEntryFor(service, library);
  if (isAccommodation(item, service)) return false;
  return isTransport(item, service) && transportCapacity(item, service) > 0;
};

/* The capacity a library item will actually contribute to band derivation, or 0 when it is
   not a vehicle. The sidebar shows this rather than the raw occupancy column, so the number
   on the card is the number the band engine will use: an item that is not treated as a
   vehicle here is not going to grow a band, and saying "Max: 3" for it would mislead. */
export const packageVehicleCapacity = (item, rate) => {
  if (!item || isAccommodation(item, null)) return 0;
  return isTransport(item, { rate_basis: rate?.rate_basis }) ? transportCapacity(item, null) : 0;
};

/* Layer 1: keep only the smallest vehicle on the day that still seats the party. When
   nothing seats it the largest is kept, so the price is still produced and
   packageBandCapacityError can say which band is unservable rather than the day silently
   losing its transport. */
const selectTransportForPax = (services, library, pax) => {
  if (!pax) return services;
  const carriers = services
    .map((service) => ({ service, item: libraryEntryFor(service, library) }))
    .filter(({ service, item }) => !isAccommodation(item, service) && isTransport(item, service));
  if (carriers.length < 2) return services;
  const capacities = carriers.map(({ service, item }) => transportCapacity(item, service));
  const fitting = capacities.filter((capacity) => capacity >= pax);
  const chosen = fitting.length ? Math.min(...fitting) : Math.max(...capacities);
  return services.filter((service) => {
    const item = libraryEntryFor(service, library);
    if (isAccommodation(item, service) || !isTransport(item, service)) return true;
    return transportCapacity(item, service) === chosen;
  });
};

/**
 * The services one day contributes to one band.
 *
 * Layer 2 runs first - the band's own items replace, add to, or drop base items - and then
 * layer 1 picks the vehicle out of whatever transport is left. A key that no longer
 * resolves is ignored rather than throwing: item keys are stable, but a base item can be
 * deleted while a band item still points at it, and that must not take the price down.
 */
export const packageServicesForTier = (day, band = null, library = []) => {
  const { key, pax } = bandContext(band);
  /* Deliberately unfiltered here: a band item with is_included = false is not a service
     that is being skipped, it is the marker that removes a base service from this band.
     Filtering it out first would silently turn "drop the saloon for 11-22 pax" into
     "keep the saloon and charge for it". */
  const all = Array.isArray(day?.services) ? day.services : [];
  const included = (service) => service?.is_included !== false;
  if (!key) return selectTransportForPax(all.filter(included), library, pax);
  const bandItems = all.filter((service) => tierKeyOf(service) === key);
  const replacements = new Map();
  const removals = new Set();
  bandItems.forEach((service) => {
    if (!service.replaces_item_key) return;
    const target = String(service.replaces_item_key);
    if (service.is_included === false) removals.add(target);
    else replacements.set(target, service);
  });
  const base = all.filter((service) => !tierKeyOf(service) && included(service))
    .filter((service) => !removals.has(String(service.item_key)) && !replacements.has(String(service.item_key)));
  const additions = bandItems.filter((service) => included(service) && !service.replaces_item_key);
  return selectTransportForPax(
    [...base, ...replacements.values(), ...additions].sort((a, b) => numberOf(a.sort_order) - numberOf(b.sort_order)),
    library,
    pax
  );
};

/* The vehicles on a day as a single readable line, for a document that should describe the
   itinerary rather than the pricing mechanism behind it. A package is sold at several party
   sizes and each takes the smallest vehicle that seats it, so a client receives ONE vehicle.
   Printing the whole ladder as separate inclusions would tell them they are getting four. */
export const packageTransportSummary = (services = [], library = [], options = {}) => {
  const carriers = (Array.isArray(services) ? services : [])
    .filter((service) => packageIsTransport(service, library))
    .map((service) => {
      const item = libraryEntryFor(service, library);
      return { name: service.item_name || item?.name || 'Vehicle', capacity: transportCapacity(item, service) };
    })
    .sort((a, b) => a.capacity - b.capacity);
  if (!carriers.length) return '';
  /* A document describes what a client receives, not the ladder behind it. A capacity in
     brackets turns a service listing into a specification sheet, and it also implies the
     client has to arrive with exactly that many people to qualify, so the sizes are left
     out unless a caller explicitly asks for them. */
  const withCapacity = carriers.length === 1 && (options.includeCapacity || options.showVehicleOptions)
    ? (carriers[0].capacity ? `${carriers[0].name} (up to ${carriers[0].capacity} travellers)` : carriers[0].name)
    : '';
  if (carriers.length === 1) return withCapacity || carriers[0].name;
  return 'Private vehicle sized to your party';
};

/* The flat service list a band pays for, across every day. */
export const packageItemsForTier = (days = [], band = null, library = []) => (Array.isArray(days) ? days : [])
  .flatMap((day) => packageServicesForTier(day, band, library));

export const packageTierDays = (days = [], band = null, library = []) => (Array.isArray(days) ? days : [])
  .map((day, index) => ({ ...day, day_number: numberOf(day.day_number) || index + 1, services: packageServicesForTier(day, band, library) }));

/**
 * Party sizes the transport in a package could be sold at, offered as suggestions.
 *
 * A saloon that seats 3 and a microbus that seats 10 suggest a 3 pax band and a 10 pax
 * band: those are the party sizes each vehicle was contracted for. Only transport suggests
 * anything - a per-person tour or a lodge has no party size of its own, so it applies to
 * every band instead.
 *
 * These are SUGGESTIONS, never bands. A party size only becomes a band when the operator
 * accepts it or types it, because the party sizes a package sells are a commercial decision
 * and not something the vehicle list gets to decide on its own.
 */
export const packageBandSuggestions = (days = [], library = [], existing = []) => {
  const taken = new Set((Array.isArray(existing) ? existing : []).map((band) => packageBandPax(band)));
  return [...new Set((Array.isArray(days) ? days : [])
    .flatMap((day) => day?.services || [])
    .filter((service) => service?.is_included !== false)
    .map((service) => {
      const item = libraryEntryFor(service, library);
      if (isAccommodation(item, service) || !isTransport(item, service)) return 0;
      return transportCapacity(item, service);
    })
    .filter((value) => value > 0))]
    .sort((a, b) => a - b)
    /* A party size that is already a band is not a suggestion. Offering it would invite the
       operator to add a second band at a size they already sell. */
    .filter((pax) => !taken.has(pax));
};

export const packageBandForPax = (bands = [], pax = 0) => {
  const travellers = numberOf(pax);
  return (Array.isArray(bands) ? bands : []).find((band) => packageBandPax(band) === travellers) || null;
};

/**
 * Whether one band can actually be served.
 *
 * The old check asked "is this party bigger than this item", one service at a time, which
 * is right for a package with a single vehicle and wrong the moment a second one is added:
 * a saloon would block the 4-10 band even though the microbus in the same band seats them.
 * So the question is per day and per band: on every day carrying transport, does at least
 * one vehicle in THIS band's service list hold the party?
 */
export const packageBandCapacityError = (days = [], library = [], band = null) => {
  if (!band) return '';
  const pax = packageBandPax(band);
  const label = packageBandLabel(band);
  for (const day of packageTierDays(days, band, library)) {
    const vehicles = (day.services || [])
      .map((service) => ({ service, item: libraryEntryFor(service, library) }))
      .filter(({ service, item }) => !isAccommodation(item, service) && isTransport(item, service))
      .map(({ service, item }) => ({ name: service.item_name || item?.name || 'This service', capacity: transportCapacity(item, service) }))
      .filter((entry) => entry.capacity > 0);
    if (!vehicles.length || vehicles.some((entry) => entry.capacity >= pax)) continue;
    const best = vehicles.reduce((top, entry) => Math.max(top, entry.capacity), 0);
    return `Day ${numberOf(day.day_number) || 1}: the ${label} band has ${pax} traveller${pax === 1 ? '' : 's'}, but the largest vehicle priced for this band holds ${best}. Give the ${label} band a bigger vehicle, or change it to a party size of ${best} or fewer.`;
  }
  return '';
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
  /* A property states its single supplement outright. Deriving it as the single rate
     minus the sharing rate looks equivalent but is not: on a contract where the single
     rate and the sharing rate resolve to the same figure the difference is zero, which
     quoted a person who cannot share at R0.00. The published supplement is the
     authoritative number, so it is read first and the difference is only a fallback. */
  const supplement = amount(rate.single_supplement, Math.max(0, single - sharing));
  return {
    rate,
    flatRoom,
    sharing,
    single,
    supplement,
    extraAdult: amount(rate.price_3_plus_adults, sharing),
    flatSingle: amount(rate.single_room_rate, rate.effective_single_rate, rate.price_1_adult, flatSharing)
  };
};

export const accommodationRoomPlan = (service, item, pattern = {}) => {
  const { sharing, supplement } = accommodationTerms(service, item);
  const capacity = capacityFor(item, service);
  const pax = totalTravellers(pattern);
  const rooms = roomsForPax(pax, capacity);
  return {
    capacity,
    pax,
    roomCount: Math.max(1, rooms.length),
    sharingPerAdult: round2(sharing),
    singleSupplement: round2(supplement)
  };
};

/* One service's share of the cost, per traveller in the band.
   Deliberately NOT rounded: the caller needs this figure unrounded to multiply back out into
   an exact band total, and rounds only the values it displays. Rounding here would make a
   party of 13 pay 3800.03 for a vehicle contracted at 3800. */
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
    /* A vehicle is priced whole, and the band's pax is the actual party on the day, so the
       share is vehiclePrice / vehiclesNeeded. The caller multiplies back by pax to reach the
       band total, which returns the full contracted vehicle price - and that is the whole
       point of a band being one exact party size rather than a span of them. */
    const capacity = capacityFor(item, service);
    perTraveller = unitCost * Math.ceil(pax / Math.max(1, capacity)) / pax;
  }
  return perTraveller * quantity;
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
   be priced off the infant band.

   A child rate of zero is deliberately NOT treated as a price here. The itinerary
   builder honours a configured 0 as a genuinely free child, but a package publishes
   one price to a buyer, and publishing R0.00 for the accommodation reads as "the
   child is free" when it in fact means the property has no child price for that band.
   So a zero band falls through to the single supplement, which is what the property
   will bill for someone who cannot share. */
export const childBandForRange = (rate, itemAgeRanges = [], childRange = null, sharing = 0) => {
  const ranges = Array.isArray(itemAgeRanges) ? itemAgeRanges : [];
  if (!childRange) return { rate: null, known: false, band: null, zeroRate: false };
  const usable = (entry) => entry.known && numberOf(entry.rate) > 0;
  if (!ranges.length) {
    const flat = childRateForAge(rate, undefined, [], sharing);
    if (usable(flat)) return { rate: flat.rate, known: true, band: null, zeroRate: false };
    return { rate: null, known: false, band: null, zeroRate: flat.known };
  }
  const candidates = ranges.filter((band) => bandSpans(band, childRange.ageFrom, childRange.ageTo));
  const priced = candidates
    .map((band) => ({ band, child: childRateForBand(rate, band, ranges, sharing) }))
    .filter((entry) => usable(entry.child));
  if (!priced.length) {
    const zeroed = candidates.some((band) => childRateForBand(rate, band, ranges, sharing).known);
    return { rate: null, known: false, band: null, zeroRate: zeroed };
  }
  const best = priced.reduce((winner, entry) => (
    numberOf(entry.child.rate) > numberOf(winner.child.rate) ? entry : winner
  ));
  return { rate: best.child.rate, known: true, band: best.band, zeroRate: false };
};

const childAccommodationFor = (service, item, childRange) => {
  const { sharing, single, supplement } = accommodationTerms(service, item);
  const child = childBandForRange(rateFor(service, item), item?.child_age_ranges || [], childRange, sharing);
  /* A child is only priced differently because of the accommodation, and the room is
     the one thing that cannot be shared with an adult who is already paying the
     sharing rate. So where the property will not take a child at this age it charges
     that child the single supplement, exactly as it would charge an adult who did not
     share. Where the contract states no supplement at all, the child is charged the
     single rate instead, because a room the property bills for single occupancy can
     never come to the buyer as R0.00. */
  const notSharing = supplement > 0 ? supplement : Math.max(single, sharing);
  return {
    childAllowed: childRange ? child.known : null,
    childAccommodation: round2(child.known ? child.rate : notSharing),
    childBasis: child.known
      ? 'Property child rate'
      : (child.zeroRate ? 'Single supplement (no child rate published)' : 'Single supplement'),
    childBandName: child.band ? String(child.band?.name || `${numberOf(child.band?.ageFrom)}–${numberOf(child.band?.ageTo ?? 'open')}`) : ''
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
    singleSupplement: round2(terms.supplement),
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
 *
 * A package is priced in ONE currency. Presenting a total per currency meant a buyer
 * read three amounts as alternatives for the same holiday, and adding the "real" ones
 * together produced a meaningless sum. The first included service sets the package
 * currency; anything priced in another currency is reported in `foreignCurrencyItems`
 * so the builder can refuse it rather than quietly drop it from the total.
 */
/* The currency a package is priced in. The currency chosen when the package was created
   wins, because that is the figure the operator committed to. Falling back to the first
   included service keeps packages that predate the currency column on the currency they
   were actually priced in rather than quietly moving them. */
export const packageCurrencyFor = (days = [], declared = '') => {
  const chosen = String(declared || '').trim().toUpperCase();
  if (chosen) return chosen;
  const first = includedServices(days)[0];
  return first ? currencyOf(first) : 'ZAR';
};

/* The markup a partner is charged on a package comes from the client record, the same
   figure the itinerary builder falls back to when a line carries none of its own. */
export const packageMarkupPercent = (clients = []) => (Array.isArray(clients) ? clients : [])
  .reduce((highest, client) => Math.max(highest, numberOf(client?.markup_percentage)), 0);

export const applyPackageMarkup = (value, percent) => round2(
  numberOf(value) * (1 + Math.max(0, numberOf(percent)) / 100)
);

export const calculatePackageTravellerBreakdown = ({ days = [], pattern, library = [], childRange = null, markupPercent = 0 } = {}) => {
  const pax = totalTravellers(pattern);
  const services = includedServices(days);
  const currency = packageCurrencyFor(days);
  const rows = services.filter((service) => currencyOf(service) === currency);
  const foreignCurrencyItems = services
    .filter((service) => currencyOf(service) !== currency)
    .map((service) => ({
      name: service.item_name || 'Service',
      supplierName: service.supplier_name || '',
      currency: currencyOf(service),
      unitPrice: round2(amount(service.unit_price, service.unit_cost))
    }));

  {
    const unitRows = [];
    const accommodationRows = [];

    rows.forEach((service) => {
      const item = libraryEntryFor(service, library);
      const name = service.item_name || item?.name || (isAccommodation(item, service) ? 'Accommodation' : 'Service');
      if (isAccommodation(item, service)) {
        accommodationRows.push({
          name,
          supplierName: service.supplier_name || item?.supplier_name || '',
          ...accommodationPricing(service, item, { pax, childRange })
        });
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
    const unitTotal = sum(unitRows, 'total');
    const accommodationSharing = sum(accommodationRows, 'sharingPerAdult');
    const childAccommodation = sum(accommodationRows, 'childAccommodation');
    const singleSupplement = sum(accommodationRows, 'singleSupplement');
    /* Only the properties that refuse the child contribute to this, and each
       contributes its own supplement, so it can differ from the party-wide
       singleSupplement when some properties do accept a child. */
    const childSupplement = round2(accommodationRows
      .filter((row) => !row.childAllowed)
      .reduce((total, row) => total + numberOf(row.singleSupplement), 0));

    return {
      currency,
      foreignCurrencyItems,
      pax,
      unitRows,
      accommodationRows,
      unitPerPerson,
      accommodationSharing,
      childAccommodation,
      singleSupplement,
      childSupplement,
/* Whether this package has anywhere to sleep. A single supplement is a room charge:
         it exists only because a property prices a room differently for one occupant, so a
         package with no accommodation has no single supplement at all. Callers use this to
         leave the card out rather than print a zero that reads as a real charge. */
      hasAccommodation: accommodationRows.length > 0,
      adultSharingTotal: round2(unitPerPerson + accommodationSharing),
      /* What the whole party pays for this band, and the figure that proves a vehicle is
         recovered in full. It is built from the row totals rather than from the per-person
         share, because that share is rounded to cents for display and multiplying a rounded
         share back out would leave a party of 13 paying 3800.03 for a vehicle priced at
         3800. The band total is the contract cost, so it has to come back exact. */
      partyTotal: round2(unitTotal + accommodationSharing * pax),
      /* An adult in their own room still pays everything a sharing adult pays, plus the
         supplement on top. Built on the sharing card rather than on the unit share, because
         the supplement is a room charge: leaving the room's sharing rate out of it produced
         a total LOWER than the sharing price it is labelled as being added to. */
      singleSupplementTotal: round2(unitPerPerson + accommodationSharing + singleSupplement),
      childTotal: round2(unitPerPerson + childAccommodation),
      /* Nothing is "refusing a child" until a child age range has actually been
         declared; without one nothing is being priced for a child at all. */
      childNotAllowed: packageChildAgeRange(childRange)
        ? accommodationRows.filter((row) => !row.childAllowed).map((row) => row.name)
        : [],
      childPriced: Boolean(packageChildAgeRange(childRange)),
      unitTotal,
      /* Contract figures above are the net cost. The partner-facing figures apply the
         client's default markup to the same totals, so a document can show what the
         partner pays without ever re-deriving it from the itemised rows. Markup is a
         multiplier on the finished total, never a per-line rounding difference. */
      markupPercent,
      sell: {
        unitPerPerson: applyPackageMarkup(unitPerPerson, markupPercent),
        accommodationSharing: applyPackageMarkup(accommodationSharing, markupPercent),
        childAccommodation: applyPackageMarkup(childAccommodation, markupPercent),
        singleSupplement: applyPackageMarkup(singleSupplement, markupPercent),
        adultSharingTotal: applyPackageMarkup(unitPerPerson + accommodationSharing, markupPercent),
        partyTotal: applyPackageMarkup(unitTotal + accommodationSharing * pax, markupPercent),
        singleSupplementTotal: applyPackageMarkup(unitPerPerson + accommodationSharing + singleSupplement, markupPercent),
        childTotal: applyPackageMarkup(unitPerPerson + childAccommodation, markupPercent)
      }
    };
  }
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
