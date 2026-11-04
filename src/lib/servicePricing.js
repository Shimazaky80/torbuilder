import { resolveSeasonForTravel, applyProtectionToRate, seasonLineStatus, protectionForSeason } from './priceValidity';
import { isOccupancyTiered, occupancyCeiling, occupancyRateForPax } from './occupancyPricing';
import { isSurchargeItem, isSurchargeChargeable, surchargeBuyTotal, surchargePricing, surchargeRateAmount } from './surchargeFees';
import { isGuideService, isGuideOnly, guideChargeTotal, lineGuideUpliftPercent, crewShareOn, refreshCrewShare, crewSharePerPerson } from './guidePricing';
import { rentalLineBuyTotal } from './carRentalPricing';
import { allocatedTravellerCount, childRateForAge, hasStaffAccommodation, isAdultTraveller, payingClientCount, tourGuideCount, travellersPlusTlCount } from './roomAllocationHelper';

/* 'per_unit' is an Extras charged once for the service itself - a meet-and-greet,
   a boat hire - whatever the party size. Like the other flat bases its figure is
   stored per head only so it re-adds to the contract total. */
const FLAT_BASIS = new Set(['per_vehicle', 'per_trip', 'per_room', 'per_unit', 'flat']);

export const isFlatBasis = (basis) => FLAT_BASIS.has(String(basis || '').trim());

/* A child pays a contracted price of their own on these three categories only.
   Every other non-accommodation line sells SPACE - a seat on a transfer, a berth
   on a train, a place on a tour, a rental car - and a child takes the same space
   as an adult, so it is billed at the adult figure. A rate card may still print a
   child figure for those categories (the supplier quotes one); it is never
   charged, and the library editor greys the box so it cannot look like a price.
   A line charged once for the service (a per-unit extra, a guide detail) bills no
   head at all, so a child rate on it would be money nobody pays. */
const CHILD_PRICED_CATEGORIES = new Set(['meals', 'tickets', 'extras']);
export const chargesChildRate = (itemOrService) => {
  if (isFlatBasis(itemOrService?.rate_basis || itemOrService?.basis || itemOrService?.pricing_model)) return false;
  return CHILD_PRICED_CATEGORIES.has(
    String(itemOrService?.category || '').trim().toLowerCase()
  );
};

const rateForItem = (item, code) => {
  const rates = Array.isArray(item?.item_rates) ? item.item_rates : [];
  const currency = String(code || '').toUpperCase();
  return rates.find((rate) => String(rate.currency || '').toUpperCase() === currency) || rates[0] || null;
};

const tierRateForPax = (rate, pax) => {
  const tiers = Array.isArray(rate?.tiered_pricing) ? rate.tiered_pricing : [];
  if (!tiers.length) return 0;
  const count = Number(pax) || 0;
  let chosen = tiers.find((tier) => {
    const minimum = parseInt(tier.min_pax, 10) || 0;
    const maximum = parseInt(tier.max_pax, 10) || 0;
    return count >= minimum && (maximum === 0 || count <= maximum);
  });
  if (!chosen) chosen = tiers[tiers.length - 1];
  const total = parseFloat(chosen?.rate) || 0;
  return count > 0 ? total / count : total;
};

const accommodationPaxRate = (rate, pax) => {
  const count = Number(pax) || 0;
  const num = (value) => parseFloat(value) || 0;
  /* A villa on an occupancy ladder is already a per-person figure: every head in
     the room pays the band its occupant count selects. A party larger than the
     top band needs a second villa, and both are filled to the cheapest band. */
  if (isOccupancyTiered(rate)) {
    return occupancyRateForPax(rate, count)
      ?? occupancyRateForPax(rate, occupancyCeiling(rate))
      ?? 0;
  }
  if (String(rate?.rate_basis || '') === 'per_room') {
    const room = num(rate?.unit_price) || num(rate?.price_2_adults) || num(rate?.double_twin_rate) || num(rate?.price_1_adult) || 0;
    const single = num(rate?.single_room_rate) || num(rate?.effective_single_rate) || room;
    const total = count <= 1 ? single : room;
    return count > 0 ? total / count : total;
  }
  if (count <= 1) return num(rate?.price_1_adult) || num(rate?.single_room_rate) || num(rate?.unit_price) || 0;
  if (count === 2) return num(rate?.price_2_adults) || num(rate?.double_twin_rate) || 0;
  const sharing = num(rate?.price_2_adults) || num(rate?.double_twin_rate) || num(rate?.price_1_adult) || 0;
  const extra = num(rate?.price_3_plus_adults) > 0 ? num(rate?.price_3_plus_adults) : sharing;
  return count > 0 ? (2 * sharing + Math.max(0, count - 2) * extra) / count : 0;
};

/* The children this party pays for, as ages.
   The count is the party the operator declared, and it is what turns child pricing
   on: a party of 4 adults stays 4 adults even if an old roster still carries a
   child. The roster supplies the ages when it has them. A bare count - a "2
   children" party with no birthdays against them - gives that many age-less
   children, priced off the item's most expensive published band rather than off
   the first one. */
export const childAgesForParty = ({ childCount = 0, childAges = [], travellers = [] } = {}) => {
  const numeric = (value) => {
    const age = parseFloat(value);
    return Number.isFinite(age) ? age : null;
  };
  const count = Math.max(0, Math.floor(Number(childCount) || 0));
  if (!count) return [];
  const declared = (Array.isArray(childAges) ? childAges : []).map(numeric).filter((age) => age !== null);
  const fromRoster = (Array.isArray(travellers) ? travellers : [])
    .filter((traveller) => !isAdultTraveller(traveller))
    .map((traveller) => numeric(traveller?.age))
    .filter((age) => age !== null);
  const ages = (declared.length ? declared : fromRoster).slice(0, count);
  return [...ages, ...Array.from({ length: count - ages.length }, () => null)];
};

/* One child's contracted figure on a per-person line, or null when the item
   prices no child at all and the child pays the adult figure.
   An explicit 0 is a genuinely free child. An age matches the item's own bands
   through the same resolver the room engine uses; an unknown age takes the most
   expensive published band, because quoting a teenager at the infant rate from a
   missing birthday is worse than charging the adult price. */
export const childFigureForLine = (rate, item, age = null, adultFigure = 0) => {
  const ageRanges = Array.isArray(item?.child_age_ranges || item?.childAgeRanges)
    ? (item?.child_age_ranges || item?.childAgeRanges)
    : [];
  const numericAge = age === null || age === undefined || age === '' ? null : parseFloat(age);
  if (numericAge !== null && Number.isFinite(numericAge)) {
    const resolved = childRateForAge(rate, numericAge, ageRanges, adultFigure);
    return resolved.known ? resolved.rate : null;
  }
  const breakdown = rate?.child_rates_breakdown;
  if (breakdown && typeof breakdown === 'object') {
    const published = Object.keys(breakdown)
      .map((key) => breakdown[key])
      .filter((value) => value !== null && value !== undefined && value !== '')
      .map((value) => parseFloat(value) || 0);
    if (published.length) return Math.max(...published);
  }
  const flat = childRateForAge(rate, null, ageRanges, adultFigure);
  return flat.known ? flat.rate : null;
};

/* The per-person average for a party that includes children on a child-priced
   category: adults at the adult figure, each child at their own.
   Returns null whenever the line is not child-priced or the party carries no
   children, which is what keeps a child-free quote byte-identical to the figure
   this engine has always produced. */
const childSharedPaxRate = (rate, item, count, adultFigure, childOptions = {}) => {
  if (!rate || !chargesChildRate(item) || count <= 0) return null;
  const ages = childAgesForParty(childOptions).slice(0, count);
  if (!ages.length) return null;
  const adults = Math.max(0, count - ages.length);
  const childTotal = ages.reduce((sum, age) => {
    const figure = childFigureForLine(rate, item, age, adultFigure);
    return sum + (figure === null ? adultFigure : figure);
  }, 0);
  return (adultFigure * adults + childTotal) / count;
};

export const contractPaxRate = (item, code, pax, childOptions = {}) => {
  const rate = rateForItem(item, code);
  const raw = rate ? parseFloat(rate.price_1_adult) || parseFloat(rate.unit_price) || 0 : 0;
  const basis = rate?.rate_basis || item?.pricing_model || 'per_person';
  const count = Number(pax) || 0;
  if (basis === 'tiered') return tierRateForPax(rate, count);
  if (isOccupancyTiered(rate)) return accommodationPaxRate(rate, count);
  if (basis === 'per_person_sharing') return accommodationPaxRate(rate, count);
  if (String(rate?.rate_basis || '') === 'per_room') return accommodationPaxRate(rate, count);
  if (FLAT_BASIS.has(basis)) return count > 0 ? raw / count : raw;
  /* Per person: the whole party pays the adult figure, unless this category
     contracts a child price of its own and the party has children in it. A meal,
     an entry ticket and an extra are bought per head, so a child who costs the
     supplier less is charged what the supplier contracts. */
  const shared = childSharedPaxRate(rate, item, count, raw, childOptions);
  return shared === null ? raw : shared;
};

export const sidebarLibraryRate = (item, code, pax, childOptions = {}) => {
  const rate = rateForItem(item, code);
  /* A fee is not priced out of the per-person matrix; its figure lives in the
     column for its own type and basis. Show that, or the sidebar reads "not
     priced" for a fee that drops onto the itinerary at a real amount. */
  if (isSurchargeItem(item)) {
    const amount = surchargeRateAmount(rate, item);
    return amount === null ? 0 : amount;
  }
  const basis = rate?.rate_basis || item?.pricing_model || 'per_person';
  if (!['per_vehicle', 'per_trip', 'per_unit', 'flat'].includes(basis)) {
    /* The preview has to be the price the drop will produce, so a party with
       children sees the mixed average, not the adult figure. */
    return contractPaxRate(item, code, pax, childOptions);
  }
  const tierRate = parseFloat(rate?.tiered_pricing?.[0]?.rate) || 0;
  return parseFloat(rate?.price_1_adult || rate?.unit_price) || tierRate;
};

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/* The percentage a line is actually charged at.

   The resolver answers with the company's Settings figure, but a line the
   operator protected with their own percentage at the drop keeps it: that figure
   is what the invoice carries, and re-pricing the line for a bigger party or a
   new travel window must not quietly swap in today's Settings value. A season
   that covers the trip - or has no dates to compare against - takes no uplift. */
const lineProtectionPercent = (service, season) => {
  const stored = Math.max(0, Number(service?.priceProtectionPercent) || 0);
  return protectionForSeason(season, stored || Math.max(0, Number(season.protectionPercent) || 0));
};

const isGuideLineService = (service) => isGuideService(service)
  || isGuideOnly(service)
  || !!service?.guideForKey
  || (Array.isArray(service?.guideServiceTypes) && service.guideServiceTypes.length > 0);

/* A hire line carries its own contract copy — the vehicle group, the rental-length
   band, the whole 24-hour blocks and the flat total those come to. No library rate
   row prices it per head, so no repricer may re-derive it from one. */
const isRentalLineService = (service) => !!service?.rental;

/* How many shares a line's per-person figure is multiplied by.
   Most lines just use the current party size. Two cases differ: a guide line's
   flat per-trip figure is shared by clients + tour leaders (never the tour
   guide), and accommodation whose rooms house staff is carried by the paying
   clients alone. A saved pax wins when present, because that is the divisor the
   stored buy/sell figures were built on. */
export const servicePax = (service, fallbackPax = 0, shareContext = null) => {
  const fallback = Math.max(0, Number(fallbackPax) || 0);
  const saved = Math.max(0, Number(service?.pax) || 0);

  if (/accommodation/i.test(String(service?.category || ''))) {
    if (hasStaffAccommodation(service?.roomAllocations)) {
      if (saved > 0) return saved;
      const paying = Number(shareContext?.payingClients) || 0;
      if (paying > 0) return paying;
    }
    const allocated = allocatedTravellerCount(service?.roomAllocations);
    if (allocated > 0) return allocated;
    return saved > 0 ? saved : fallback;
  }

  if (isGuideLineService(service)) {
    if (saved > 0) return saved;
    const divisor = Number(shareContext?.travellersPlusTl) || 0;
    return divisor > 0 ? divisor : fallback;
  }

  return fallback;
};

export const contractedServiceTotal = (service, fallbackPax = 0, shareContext = null) => {
  const pax = servicePax(service, fallbackPax, shareContext);
  return round2((Number(service?.buyPP) || 0) * Math.max(0, pax));
};

export const supplierPaymentDocumentStatus = (supplierPaid) => supplierPaid === true
  ? {
    heading: 'Proof of Payment',
    stamp: 'PAID',
    amountLabel: 'Amount paid to supplier',
    footnote: 'This document confirms that the amount stated above was paid to the supplier for the service listed.'
  }
  : {
    heading: 'Supplier Payment Record',
    stamp: 'NOT PAID',
    amountLabel: 'Contracted amount',
    footnote: 'Payment has not been confirmed as paid to the supplier. This document shows the contracted amount only and is not proof of payment.'
  };

export const repriceServicesForPax = ({
  days = [],
  libraryItems = [],
  paxCount = 0,
  childCount = 0,
  travellers = [],
  travelWindow = {},
  protectionPercent = 0,
  allowPartial = false
} = {}) => {
  const count = Math.max(0, Number(paxCount) || 0);
  const guideDivisor = travellersPlusTlCount(travellers) || count;
  const payingClients = payingClientCount(travellers);
  const skipped = [];
  let repriced = 0;
  if (!count) return { days, skipped };

  const updatedDays = (Array.isArray(days) ? days : []).map((day) => ({
    ...day,
    services: (Array.isArray(day.services) ? day.services : []).map((service) => {
      /* The car costs what the contract says it costs whoever is sitting in it, so
         a party that grows or shrinks re-splits the same hire total instead of
         repricing the hire — or being reported as a line the builder could not
         price, which is what reading the empty rate matrix would otherwise say.
         A day's line of a spread hire re-splits its own block, not the whole
         contract, or every day of the trip would start charging the hire again. */
      if (isRentalLineService(service) && count > 0) {
        const stored = (Number(service.buyPP) || 0) * (Number(service.pax) || count);
        const flatTotal = rentalLineBuyTotal(service.rental) || round2(stored);
        const buyPP = round2(flatTotal / count);
        const rentalMarkup = Number(service.markup) || 0;
        repriced += 1;
        return {
          ...service,
          buyPP,
          sellPP: round2(buyPP * (1 + rentalMarkup / 100)),
          pax: count
        };
      }

      /* A guide line and its guide-&-driver detail lines are a flat per-trip
         figure split across the party, not a per-person library rate. Re-split
         the same flat total over the new party size so a pax change neither
         inflates the guide nor repriced it off the library. */
      const isGuideLine = (Array.isArray(service.guideServiceTypes) && service.guideServiceTypes.length > 0)
        || service.guideOnly === true || service.guide_only === true || !!service.guideForKey;
      if (isGuideLine && Number(service.buyPP) > 0) {
        const flatTotal = (Number(service.buyPP) || 0) * (Number(service.pax) || count || 1);
        const divisor = guideDivisor > 0 ? guideDivisor : 1;
        const buyPP = round2(flatTotal / divisor);
        const guideMarkup = Number(service.markup) || 0;
        repriced += 1;
        return {
          ...service,
          buyPP,
          sellPP: round2(buyPP * (1 + guideMarkup / 100)),
          pax: divisor
        };
      }

      /* Staff rooms are absorbed by the paying clients: re-split the same
         contracted accommodation total across the clients alone. A line with
         no staff rooms keeps its allocated divisor untouched. */
      if (/accommodation/i.test(String(service.category || ''))) {
        const storedPax = Number(service.pax) || 0;
        if (!hasStaffAccommodation(service.roomAllocations) || payingClients <= 0
          || !storedPax || storedPax === payingClients) {
          return service;
        }
        const flatTotal = (Number(service.buyPP) || 0) * storedPax;
        const buyPP = round2(flatTotal / payingClients);
        const accommodationMarkup = Number(service.markup) || 0;
        repriced += 1;
        return {
          ...service,
          buyPP,
          sellPP: round2(buyPP * (1 + accommodationMarkup / 100)),
          pax: payingClients
        };
      }

      /* A crew figure folded onto a line is shared by the travellers and their
         tour leaders, so a roster that gained or lost a leader re-shares it even
         when the client count itself did not move. */
      const crew = crewShareOn(service);
      if (!service.itemId
        || (Number(service.pax) === count && !(crew && crew.divisor !== guideDivisor))) {
        return service;
      }

      const item = libraryItems.find((entry) => String(entry.id) === String(service.itemId));
      if (!item || !Array.isArray(item.item_rates) || !item.item_rates.length) {
        skipped.push(service.name || 'Unnamed service');
        return service;
      }

      const currencyCode = service.currencyCode || item.currency || '';
      const season = resolveSeasonForTravel({
        rates: item.item_rates,
        currencyCode,
        startDate: travelWindow.start,
        endDate: travelWindow.end,
        protectionPercent,
        allowPartial
      });
      if (!season.rate) {
        skipped.push(service.name || item.name || 'Unnamed service');
        return service;
      }

      const pct = lineProtectionPercent(service, season);
      const rate = pct ? applyProtectionToRate(season.rate, pct) : season.rate;
      const pricedItem = { ...item, item_rates: [rate] };
      const markup = Number(service.markup) || 0;

      if (isSurchargeItem(item)) {
        const chargeable = typeof service.surchargeChargeable === 'boolean'
          ? service.surchargeChargeable
          : isSurchargeChargeable(item);
        const { unitBasis, total } = surchargeBuyTotal({
          rate,
          item,
          paxCount: count,
          childCount,
          /* The gate charges the touring guide a place of their own when the
             fee contracts one, so the crew head rides with the party. */
          guideCount: tourGuideCount(travellers),
          nights: 1
        });
        const priced = surchargePricing({ buyTotal: total, markupPercent: markup, chargeable });
        repriced += 1;
        return {
          ...service,
          basis: unitBasis,
          buyPP: round2(priced.buy / count),
          sellPP: round2(priced.sell / count),
          pax: count,
          surchargeUnitBasis: unitBasis,
          surchargePassedThrough: priced.passedThrough,
          surchargeReference: round2(priced.reference || 0)
        };
      }

      const basis = rate.rate_basis || item.pricing_model || 'per_person';
      const buyPP = round2(contractPaxRate(pricedItem, currencyCode, count, { childCount, travellers }));
      /* The crew figure the line folded in rides the same new season row as the
         clients' fare and re-shares over the same party, so a bigger group neither
         multiplies the guide's seat nor drops it. */
      const nextCrew = refreshCrewShare(crew, rate, {
        perCharter: String(basis).toLowerCase() === 'per_vehicle',
        guideCount: tourGuideCount(travellers)
      });
      const withCrew = round2(buyPP + (nextCrew ? crewSharePerPerson(nextCrew.total, guideDivisor) : 0));
      repriced += 1;
      return {
        ...service,
        basis,
        buyPP: withCrew,
        sellPP: round2(withCrew * (1 + markup / 100)),
        ...(nextCrew ? { crewShare: { ...nextCrew, divisor: guideDivisor } } : {}),
        pax: count,
        item_rates: [rate],
        priceProtectionPercent: pct,
        protectedSeasonName: pct ? season.seasonName : '',
        seasonName: season.seasonName || '',
        seasonValidFrom: season.validFrom || '',
        seasonValidTo: season.validTo || '',
        provisionalFrom: season.status === 'provisional' ? (season.provisionalFrom || '') : '',
        provisionalTo: season.status === 'provisional' ? (season.provisionalTo || '') : '',
        rateSeasonStatus: seasonLineStatus(season, pct)
      };
    })
  }));

  return { days: updatedDays, repriced, skipped };
};

/* Re-price every library-backed line against a new travel window.

   Used when a month-timed quotation acquires exact dates, or when its months
   change. The rule the operator asked for is simple: if the new window resolves
   to the same season the line was already priced from, the price must not move.
   Only a line whose season actually changed is repriced.

   A window that no usable season covers is not repriced silently; it comes back
   in `issues` so the caller can warn before anything is saved. Guide & driver
   detail lines are flat charges pinned when they were chosen, so they are left
   alone. */
export const revalidateServicesForWindow = ({
  days = [],
  libraryItems = [],
  paxCount = 0,
  childCount = 0,
  travellers = [],
  travelWindow = {},
  protectionPercent = 0,
  allowPartial = false,
  allowFuture = false
} = {}) => {
  const count = Math.max(0, Number(paxCount) || 0);
  const guideDivisor = travellersPlusTlCount(travellers) || count || 1;
  const shareContext = { payingClients: payingClientCount(travellers), travellersPlusTl: guideDivisor };
  const issues = [];
  let repriced = 0;

  const seasonStampMatches = (service, season) => {
    const storedName = service.seasonName || service.protectedSeasonName || '';
    return storedName === (season.seasonName || '')
      && String(service.seasonValidFrom || '') === String(season.validFrom || '')
      && String(service.seasonValidTo || '') === String(season.validTo || '');
  };

  const stamp = (season, pct) => ({
    priceProtectionPercent: pct,
    protectedSeasonName: pct ? (season.seasonName || '') : '',
    seasonName: season.seasonName || '',
    seasonValidFrom: season.validFrom || '',
    seasonValidTo: season.validTo || '',
    provisionalFrom: season.status === 'provisional' ? (season.provisionalFrom || '') : '',
    provisionalTo: season.status === 'provisional' ? (season.provisionalTo || '') : '',
    rateSeasonStatus: seasonLineStatus(season, pct)
  });

  const updatedDays = (Array.isArray(days) ? days : []).map((day) => ({
    ...day,
    services: (Array.isArray(day.services) ? day.services : []).map((service) => {
      if (!service.itemId) return service;
      /* The hire's window is its own: the car is collected and returned at the
         moments the operator agreed with the hire desk, and its price came from
         the tariff covering that pick-up — not from a season matched to the trip.
         Moving the itinerary's dates must not silently re-count the blocks a quote
         already settled; the operator re-opens the hire and says so instead. */
      if (isRentalLineService(service)) return service;
      /* Guide & driver detail lines are flat per-trip figures pinned when the
         operator chose them, not season per-person rates. */
      if (service.guideOnly || service.guideForKey) return service;
      /* A line saved before season tracking cannot be re-derived safely; leave
         it visible rather than replacing its price with a guess. */
      const hasSeasonStamp = !!(service.seasonValidFrom || service.seasonValidTo
        || service.seasonName || service.protectedSeasonName || service.rateSeasonStatus);
      if (!hasSeasonStamp) return service;

      const item = libraryItems.find((entry) => String(entry.id) === String(service.itemId));
      if (!item || !Array.isArray(item.item_rates) || !item.item_rates.length) return service;

      const currencyCode = service.currencyCode || item.currency || '';
      const season = resolveSeasonForTravel({
        rates: item.item_rates,
        currencyCode,
        startDate: travelWindow.start,
        endDate: travelWindow.end,
        protectionPercent,
        allowFuture,
        allowPartial
      });
      const pct = lineProtectionPercent(service, season);
      const nextStatus = seasonLineStatus(season, pct);

      /* Same season and same status: the price is still the right one for the
         new window, so it must not move. */
      if (seasonStampMatches(service, season) && service.rateSeasonStatus === nextStatus) {
        return service;
      }

      const usable = season.rate && ['ok', 'protected', 'stale', 'provisional'].includes(season.status);
      if (!usable) {
        issues.push({
          name: service.name || item.name || 'Unnamed service',
          reason: season.reason || 'No season covers the new travel window.'
        });
        return service;
      }

      const rate = pct ? applyProtectionToRate(season.rate, pct) : season.rate;
      const markup = Number(service.markup) || 0;
      const nextStamp = stamp(season, pct);
      repriced += 1;

      if (isSurchargeItem(item)) {
        const linePax = Math.max(1, Number(service.pax) || count || 1);
        const chargeable = typeof service.surchargeChargeable === 'boolean'
          ? service.surchargeChargeable
          : isSurchargeChargeable(item);
        const { unitBasis, total } = surchargeBuyTotal({
          rate,
          item,
          paxCount: linePax,
          childCount,
          guideCount: tourGuideCount(travellers),
          nights: Math.max(1, Number(service.quantity) || 1)
        });
        const priced = surchargePricing({ buyTotal: total, markupPercent: markup, chargeable });
        return {
          ...service,
          ...nextStamp,
          basis: unitBasis,
          buyPP: round2(priced.buy / linePax),
          sellPP: round2(priced.sell / linePax),
          surchargeUnitBasis: unitBasis,
          surchargePassedThrough: priced.passedThrough,
          surchargeReference: round2(priced.reference || 0),
          item_rates: [rate]
        };
      }

      if (isGuideLineService(service) && Array.isArray(service.guideServiceTypes) && service.guideServiceTypes.length) {
        /* The destination's rate resolves to a new season, and the person named on
           the line costs their percentage above it. Their snapshot is what the
           invoice was written from, so the same uplift rides onto the new season —
           and a guide retuned in the directory last week cannot rewrite a figure
           that has already been sold. */
        const upliftPercent = lineGuideUpliftPercent(service);
        const total = guideChargeTotal(rate, service.guideServiceTypes, service.guide_needed !== false, upliftPercent);
        if (!total && Number(service.buyPP) > 0) {
          issues.push({
            name: service.name || item.name || 'Guide service',
            reason: `The ${season.seasonName || 'resolved'} season has no guide charge for the selected service types.`
          });
          return service;
        }
        const buyPP = round2(total / guideDivisor);
        return {
          ...service,
          ...nextStamp,
          basis: 'per_trip',
          buyPP,
          sellPP: round2(buyPP * (1 + markup / 100)),
          pax: guideDivisor,
          item_rates: [rate],
          ...(service.guideSnapshot ? {
            guideSnapshot: {
              ...service.guideSnapshot,
              base_charge: round2(guideChargeTotal(rate, service.guideServiceTypes, service.guide_needed !== false)),
              charged: round2(total)
            }
          } : {})
        };
      }

      const pricedItem = { ...item, item_rates: [rate] };
      const linePax = servicePax(service, count, shareContext) || count || 1;
      const buyPP = round2(contractPaxRate(pricedItem, currencyCode, linePax, { childCount, travellers }));
      /* A crew figure folded onto the line rides the same season row as the
         clients' ticket, so a new season re-prices the seat too. */
      const crew = crewShareOn(service);
      const nextCrew = crew
        ? refreshCrewShare(crew, rate, {
          perCharter: String(rate.rate_basis || item.pricing_model || '').toLowerCase() === 'per_vehicle',
          guideCount: tourGuideCount(travellers)
        })
        : null;
      const withCrew = round2(buyPP + (nextCrew ? crewSharePerPerson(nextCrew.total, guideDivisor) : 0));
      return {
        ...service,
        ...nextStamp,
        basis: rate.rate_basis || item.pricing_model || service.basis || 'per_person',
        buyPP: withCrew,
        sellPP: round2(withCrew * (1 + markup / 100)),
        ...(nextCrew ? { crewShare: { ...nextCrew, divisor: guideDivisor } } : {}),
        pax: linePax,
        item_rates: [rate]
      };
    })
  }));

  return { days: updatedDays, repriced, issues };
};
