/* Pricing-matrix season validity and Pricing Protection.
 *
 * A library item carries one item_rates row per season, each with a
 * valid_from / valid_to window. An itinerary has one travel window. Adding an
 * item to a day has to pick the season that actually covers the travel dates
 * instead of whatever row happens to come back first, and it has to say so
 * when it cannot.
 *
 * Four outcomes, in the order they are decided:
 *
 *   no_price  the item has no usable price for the currency at all. The item
 *             must not be added - there is nothing to charge and nothing to
 *             protect.
 *   ok        a season window covers the travel dates exactly, and that season
 *             actually carries a price. Used as loaded.
 *   undated   the rates carry no dates at all (legacy rows created before the
 *             matrix existed). Nothing to validate against, so used as
 *             loaded - but flagged so the caller can mention it.
 *   protected no season covers the travel dates, so the nearest prior season
 *             is used and the tenant's protection percentage is applied.
 *   future    no season covers the trip and none can stand in for it, but a
 *             priced season starts after the trip ends. That price is usable
 *             only as a pre-season estimate and only when the caller says so;
 *             by default it is refused rather than silently pricing a line.
 *   provisional
 *             month-only timing: no season covers the whole requested month(s),
 *             but a current season covers part of it. Only returned when the
 *             caller allows it; the line is valid for travel inside the
 *             season's share of the window only.
 *
 * Coverage is exact for confirmed dates. A season that only overlaps the travel
 * window for part of it is not accepted: the operator has to price the whole
 * itinerary from one season, and a season that expires mid-trip prices some of
 * the nights at last year's figure with nothing on the quote to say so. A
 * month-timed quotation is different: the window is what is known, so a season
 * covering part of it can price the quote for that part, explicitly marked as
 * provisional and with its validity window recorded on the line.
 *
 * "Nearest prior season" is the most recent row whose calendar period matches the
 * travel period but whose year is behind: a Dec-2027/Jan-2028 season priced
 * against an Oct-2026 trip is the same product in a later year, not a stale
 * price. A row is only a candidate for protection when it is BEHIND the travel
 * dates and shares the period of the year, so protection never quietly re-prices
 * a trip into a season that does not exist yet. When no such row exists there is
 * nothing to protect against and the call is blocked with a clear reason.
 */

import { occupancyLadderOf } from './occupancyPricing';

const DAY_MS = 86400000;

const iso = (v) => (v ? String(v).slice(0, 10) : '');

/* UTC day index, so a date never shifts across a timezone boundary. */
export const parseDay = (v) => {
  const s = iso(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d || m > 12 || d > 31) return null;
  return Date.UTC(y, m - 1, d) / DAY_MS;
};

export const dayToIso = (day) => {
  if (day === null || day === undefined || !Number.isFinite(day)) return '';
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
};

/* Month-day as MMDD, ignoring the year. */
const monthDay = (day) => {
  const d = new Date(day * DAY_MS);
  return (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
};

const yearOf = (day) => new Date(day * DAY_MS).getUTCFullYear();

/* A window can wrap the year end (24 Dec -> 5 Jan), which is legal for a
   southern-hemisphere season. Split it into the two ranges it really covers. */
const yearlessRanges = (fromDay, toDay) => {
  const a = monthDay(fromDay);
  const b = monthDay(toDay);
  if (a <= b) return [[a, b]];
  return [[a, 1231], [101, b]];
};

const overlapsRange = (r1, r2) => r1.some(([a, b]) => r2.some(([c, d]) => a <= d && c <= b));

/* Do two real date windows share any calendar date (year ignored)? */
export const sharesCalendarPeriod = (aFrom, aTo, bFrom, bTo) => {
  if ([aFrom, aTo, bFrom, bTo].some((d) => d === null)) return false;
  const ra = yearlessRanges(aFrom, aTo);
  const rb = yearlessRanges(bFrom, bTo);
  return overlapsRange(ra, rb);
};

const covers = (fromDay, toDay, winStart, winEnd) => fromDay <= winStart && toDay >= winEnd;

/* How many days of the travel window a row's own pricing window spans. */
const overlapDays = (window, winStart, winEnd) =>
  Math.min(window.toDay, winEnd) - Math.max(window.fromDay, winStart) + 1;

/* The span a row claims, honouring a missing bound as "open ended". */
export const rateWindow = (rate) => {
  const from = parseDay(rate?.valid_from);
  const to = parseDay(rate?.valid_to);
  return {
    from,
    to,
    fromIso: iso(rate?.valid_from),
    toIso: iso(rate?.valid_to),
    dated: from !== null || to !== null,
    /* An open bound is pushed out to the extremes so window maths still works. */
    fromDay: from === null ? -Infinity : from,
    toDay: to === null ? Infinity : to
  };
};

/**
 * Where a rate row's validity window sits against a travel window.
 *
 * The single place a caller should ask "does this season cover the trip?"
 * before offering a choice, so the drop dialog, the sidebar and the line
 * badges all describe a window the same way.
 *
 *   open         the travel dates are not set yet
 *   undated      the row carries no validity dates at all
 *   covers       the row spans the whole trip
 *   starts_after the row begins after the trip ends (a future season)
 *   ends_before  the row ended before the trip starts (an expired season)
 *   starts_during the row begins inside the trip, so the first nights are uncovered
 *   ends_during  the row expires inside the trip, so the last nights are uncovered
 */
export const rateTravelCoverage = (rate, startDate, endDate) => {
  const window = rateWindow(rate);
  const winStart = parseDay(startDate);
  const winEnd = parseDay(endDate) === null ? winStart : parseDay(endDate);
  const base = {
    window,
    validFrom: window.fromIso,
    validTo: window.toIso,
    covers: false,
    daysAhead: 0
  };

  if (winStart === null) return { ...base, status: 'open' };
  if (!window.dated) return { ...base, status: 'undated' };
  if (covers(window.fromDay, window.toDay, winStart, winEnd)) {
    return { ...base, status: 'covers', covers: true };
  }
  if (window.fromDay > winEnd) {
    return { ...base, status: 'starts_after', daysAhead: window.fromDay - winEnd };
  }
  if (window.toDay < winStart) {
    return { ...base, status: 'ends_before' };
  }
  if (window.fromDay > winStart) return { ...base, status: 'starts_during' };
  return { ...base, status: 'ends_during' };
};

const rowsForCurrency = (rates, currencyCode) => {
  const all = Array.isArray(rates) ? rates : [];
  if (!all.length) return [];
  const codeU = String(currencyCode || '').toUpperCase();
  const byCurr = all.filter((r) => String(r.currency || '').toUpperCase() === codeU);
  return byCurr.length ? byCurr : all;
};

/* Any money at all on the row - the matrix has used a lot of column names for
   the same figure over time. */
export const rateHasPrice = (rate) => {
  if (!rate) return false;
  if (occupancyLadderOf(rate).some((band) => band.rate > 0)) return true;
  const fields = [
    'price_1_adult', 'price_2_adults', 'price_3_plus_adults', 'unit_price', 'unit_cost',
    'single_room_rate', 'double_twin_rate', 'effective_single_rate',
    'adult_rate', 'guide_rate', 'driver_rate', 'vehicle_rate',
    'guide_transfer_rate', 'guide_half_day_rate', 'guide_full_day_rate',
    'guide_overland_rate', 'guide_dinner_rate',
    'entrance_fee_per_person', 'entrance_fee_per_vehicle', 'entrance_fee_per_child',
    'conservation_levy_per_adult', 'conservation_levy_per_child'
  ];
  if (fields.some((f) => (parseFloat(rate[f]) || 0) > 0)) return true;
  const breakdown = rate.child_rates_breakdown;
  if (breakdown && typeof breakdown === 'object') {
    return Object.values(breakdown).some((v) => (parseFloat(v) || 0) > 0);
  }
  const tiers = rate.tiered_pricing;
  if (Array.isArray(tiers)) return tiers.some((t) => (parseFloat(t?.rate) || 0) > 0);
  return false;
};

/* Whether the library item carries a price anywhere at all - any currency, any
   season, any column. The picker cards use it to say "no prices loaded" instead
   of showing R0 and refusing the item only once the operator has dropped it. */
export const itemHasPricedRate = (item) => (
  (Array.isArray(item?.item_rates) ? item.item_rates : []).some(rateHasPrice)
);

/* Narrowest covering window wins: a specific week beats a whole-year band. */
const spanOf = (w) => (w.fromDay === -Infinity || w.toDay === Infinity ? Infinity : w.toDay - w.fromDay);

const pickTightest = (candidates) => [...candidates].sort((a, b) => {
  const span = spanOf(a.window) - spanOf(b.window);
  if (span !== 0) return span;
  /* Two rows can cover the trip and claim the same number of days - a
     2026-01-01..2026-12-31 season and a 2026-11-01..2027-10-31 season both span
     365 days over a November week. The later season is the newer contract, so
     it wins rather than whichever row the database happened to return first. */
  return String(b.window.fromIso || '').localeCompare(String(a.window.fromIso || ''));
})[0];

/**
 * Decide which season prices an itinerary, and whether protection applies.
 *
 * @param {object}  args
 * @param {Array}   args.rates            item_rates rows for the item
 * @param {string}  args.currencyCode     itinerary currency
 * @param {string}  args.startDate        itinerary travel start (YYYY-MM-DD)
 * @param {string}  args.endDate          itinerary travel end   (YYYY-MM-DD)
 * @param {number}  args.protectionPercent tenant's Pricing Protection (0 = off)
 * @param {boolean} args.allowFuture      accept a season that starts after the
 *                                        trip as a pre-season estimate
 * @param {boolean} args.allowPartial     accept a season covering part of a
 *                                        month-only window as a provisional
 *                                        price (never protected)
 *
 * Statuses: `ok` a season covers the trip · `protected` a prior-year season
 * standing in with the tenant's uplift · `stale` the same season with no
 * uplift set · `future` / `expired` / `partial` an estimate · `provisional`
 * month-only · `undated` no validity dates · `no_price` nothing usable.
 * @returns {{status:string, rate:object|null, window:object|null,
 *            protectionPercent:number, canAdd:boolean, reason:string,
 *            seasonName:string, validFrom:string, validTo:string,
 *            staleByYears:number}}
 */
export const resolveSeasonForTravel = ({
  rates,
  currencyCode,
  startDate,
  endDate,
  protectionPercent = 0,
  allowFuture = false,
  allowPartial = false
} = {}) => {
  const pct = Math.max(0, parseFloat(protectionPercent) || 0);
  const rows = rowsForCurrency(rates, currencyCode).map((rate) => ({ rate, window: rateWindow(rate) }));
  const base = {
    rate: null,
    window: null,
    protectionPercent: 0,
    seasonName: '',
    validFrom: '',
    validTo: '',
    staleByYears: 0
  };

  if (!rows.length) {
    /* Nothing to check at all. This is never a currency problem - rowsForCurrency
       falls back to every row when none matches the itinerary's - so the reason
       says what the library is actually missing. */
    return {
      ...base,
      status: 'no_price',
      canAdd: false,
      reason: 'This library item has no season prices loaded, so there is nothing to charge for this trip. Price it in Library Items first.'
    };
  }

  const winStart = parseDay(startDate);
  const winEnd = parseDay(endDate) === null ? winStart : parseDay(endDate);
  if (winStart === null) {
    /* No travel dates yet: nothing to validate against, use the first priced
       row and let the dates be checked again once they are set. */
    const fallback = rows.find((r) => rateHasPrice(r.rate));
    if (!fallback) {
      return { ...base, status: 'no_price', canAdd: false, reason: 'This library item has rate rows with no amounts filled in, so there is nothing to charge for this trip. Enter its prices in Library Items first.' };
    }
    return {
      ...base,
      status: 'undated',
      rate: fallback.rate,
      window: fallback.window,
      canAdd: true,
      seasonName: fallback.rate.season_name || fallback.rate.option_name || '',
      validFrom: fallback.window.fromIso,
      validTo: fallback.window.toIso,
      reason: 'Set the itinerary travel dates to check this price against the season.'
    };
  }

  const dated = rows.filter((r) => r.window.dated);

  if (!dated.length) {
    const fallback = rows.find((r) => rateHasPrice(r.rate));
    if (!fallback) {
      return { ...base, status: 'no_price', canAdd: false, reason: 'This library item has rate rows with no amounts filled in, so there is nothing to charge for this trip. Enter its prices in Library Items first.' };
    }
    return {
      ...base,
      status: 'undated',
      rate: fallback.rate,
      window: fallback.window,
      canAdd: true,
      seasonName: fallback.rate.season_name || fallback.rate.option_name || '',
      reason: 'This price has no validity dates in the library, so it could not be checked against the travel dates.'
    };
  }

  /* 1. A season that covers the whole trip.
        rateHasPrice is required as well as coverage: a season can sit over the
        travel dates with every money column still empty, and treating that as a
        match would put a zero-priced line on the itinerary with no warning. */
  const covering = dated
    .filter((r) => rateHasPrice(r.rate))
    .filter((r) => covers(r.window.fromDay, r.window.toDay, winStart, winEnd));
  if (covering.length) {
    const best = pickTightest(covering);
    return {
      ...base,
      status: 'ok',
      rate: best.rate,
      window: best.window,
      canAdd: true,
      seasonName: best.rate.season_name || best.rate.option_name || '',
      validFrom: best.window.fromIso,
      validTo: best.window.toIso,
      reason: ''
    };
  }

  /* 2. No season covers the trip. A season that only overlaps it for part of the
        window is NOT accepted: the requirement is that a season matches the
        itinerary exactly, so a trip running off the end of a season has to fall
        through to protection or be blocked rather than being priced by a season
        that was only correct for some of the nights.

        The one exception is month-only timing. There the requested window is a
        range of months and a contract can legitimately change rate mid-month, so
        no season can be an exact match. A current season that covers part of
        the window is still a real price for the part it covers; it is returned
        as 'provisional', can only be used with the caller's consent, and records
        the exact sub-window the quote is valid for. It is never protected: a
        season that exists now is not an uplifted substitute for a missing one. */
  if (allowPartial) {
    const overlapping = dated
      .filter((r) => rateHasPrice(r.rate))
      .filter((r) => r.window.fromDay <= winEnd && r.window.toDay >= winStart);
    if (overlapping.length) {
      const best = [...overlapping].sort((a, b) => {
        const share = overlapDays(b.window, winStart, winEnd) - overlapDays(a.window, winStart, winEnd);
        if (share !== 0) return share;
        const span = spanOf(a.window) - spanOf(b.window);
        if (span !== 0) return span;
        return String(b.window.fromIso || '').localeCompare(String(a.window.fromIso || ''));
      })[0];
      const coverFrom = Math.max(best.window.fromDay, winStart);
      const coverTo = Math.min(best.window.toDay, winEnd);
      const seasonName = best.rate.season_name || best.rate.option_name || '';
      return {
        ...base,
        status: 'provisional',
        rate: best.rate,
        window: best.window,
        protectionPercent: 0,
        canAdd: true,
        seasonName,
        validFrom: best.window.fromIso,
        validTo: best.window.toIso,
        provisionalFrom: dayToIso(coverFrom),
        provisionalTo: dayToIso(coverTo),
        reason: `The ${seasonName || 'selected'} season (${best.window.fromIso || 'open'} to ${best.window.toIso || 'open'}) covers only part of the requested window ${iso(startDate)} - ${iso(endDate)}. Using it prices the line as a provisional quote valid for travel ${dayToIso(coverFrom)} - ${dayToIso(coverTo)}.`
      };
    }
  }

  /* 3. Protection is only allowed against a season
        from a PREVIOUS year that shares the period of the year - a price that
        is ahead of the trip is a future season, not an outdated one. */
  const tripYear = yearOf(winStart);
  const behind = dated
    .filter((r) => r.window.fromDay !== null && yearOf(r.window.fromDay) < tripYear)
    .filter((r) => sharesCalendarPeriod(r.window.fromDay, r.window.toDay ?? r.window.fromDay, winStart, winEnd))
    .filter((r) => rateHasPrice(r.rate));

  if (behind.length) {
    /* Nearest first, then tightest. Two prior years can share the same calendar
       period and the same span, and "nearest" is what the protection percentage
       is meant to describe - picking whichever the database happened to return
       first could quote a three-year-old season instead of last year's. */
    const best = [...behind].sort((a, b) => {
      const ya = yearOf(a.window.fromDay);
      const yb = yearOf(b.window.fromDay);
      if (yb !== ya) return yb - ya;
      return spanOf(a.window) - spanOf(b.window);
    })[0];
    if (pct > 0) {
      return {
        ...base,
        status: 'protected',
        rate: best.rate,
        window: best.window,
        protectionPercent: pct,
        canAdd: true,
        seasonName: best.rate.season_name || best.rate.option_name || '',
        validFrom: best.window.fromIso,
        validTo: best.window.toIso,
        staleByYears: tripYear - yearOf(best.window.fromDay),
        reason: `No season in the pricing matrix covers ${iso(startDate)} - ${iso(endDate)}.`
      };
    }
    /* Without a percentage there is no uplift standing between this row and the
       invoice: the trip would be charged last year's contract figure and the
       line would read as an exact match. So it is reported as its own status and
       the builder asks, offering the percentage that would make it a fair price.
       If the operator leaves it at zero the line says so out loud. */
    const staleName = best.rate.season_name || best.rate.option_name || 'prior';
    const staleYears = tripYear - yearOf(best.window.fromDay);
    return {
      ...base,
      status: 'stale',
      rate: best.rate,
      window: best.window,
      canAdd: true,
      seasonName: staleName,
      validFrom: best.window.fromIso,
      validTo: best.window.toIso,
      staleByYears: staleYears,
      reason: `No season in the pricing matrix covers ${iso(startDate)} - ${iso(endDate)}. The “${staleName}” season ran ${best.window.fromIso || 'open'} to ${best.window.toIso || 'open'}, ${staleYears} year${staleYears === 1 ? '' : 's'} behind the trip, and with no Pricing Protection percentage set it would be charged exactly as it stands.`
    };
  }

  /* 4. Nothing covers and nothing can protect. A season that starts AFTER the
        trip is a future season, not a stale one: its price is the best guess
        available, but it is an estimate until that season is live. It is only
        used when the caller explicitly allows it, so an item never quietly
        lands on the itinerary at a price the supplier has not opened yet. */
  const ahead = dated
    .filter((r) => rateHasPrice(r.rate))
    .filter((r) => r.window.fromDay > winEnd);
  if (ahead.length) {
    const best = [...ahead].sort((a, b) => {
      if (a.window.fromDay !== b.window.fromDay) return a.window.fromDay - b.window.fromDay;
      return spanOf(a.window) - spanOf(b.window);
    })[0];
    const starts = best.window.fromIso || 'a later date';
    return {
      ...base,
      status: 'future',
      rate: best.rate,
      window: best.window,
      protectionPercent: 0,
      canAdd: allowFuture === true,
      seasonName: best.rate.season_name || best.rate.option_name || '',
      validFrom: best.window.fromIso,
      validTo: best.window.toIso,
      reason: allowFuture
        ? `Priced as a pre-season estimate from the season starting ${starts}, because no season covers ${iso(startDate)} - ${iso(endDate)}. The estimate stays provisional until that season is live.`
        : `No season covers ${iso(startDate)} - ${iso(endDate)}. The nearest priced season starts ${starts}, after the trip, so its price can only be added as a pre-season estimate.`
    };
  }

  /* 5. Nothing usable - the item cannot be priced for this trip. */
  const windows = dated
    .map((r) => `  ${r.rate.season_name || r.rate.option_name || 'Season'}: ${r.window.fromIso || 'open'} to ${r.window.toIso || 'open'}`)
    .join('\n');
  return {
    ...base,
    status: 'no_price',
    canAdd: false,
    reason: `No season in the pricing matrix covers the travel dates ${iso(startDate)} - ${iso(endDate)}, and no earlier season matches the same period to fall back on.\n${windows}`
  };
};

/* The protection uplift on a buy figure. */
export const applyProtection = (amount, protectionPercent) => {
  const base = parseFloat(amount) || 0;
  const pct = Math.max(0, parseFloat(protectionPercent) || 0);
  if (!pct) return base;
  return base * (1 + pct / 100);
};

/* How a resolved season is recorded on an itinerary line.

   `estimate` covers every case where the price cannot be an exact match for
   the travel dates: a season starting after the trip, one that has expired, one
   from a previous year standing in with no protection uplift, or a pinned row
   that only partly overlaps. `provisional` is reserved for month-only pricing,
   where a live season legitimately covers only part of the requested month(s)
   and the line records the sub-window it does cover. */
export const ESTIMATE_SEASON_STATUSES = new Set(['future', 'expired', 'partial', 'stale']);

/* The statuses that mean no season prices this trip, so the builder asks before
   the price lands on a line. The ask is not a dead end: for the ones below
   marked protectable it carries the Pricing Protection percentage the line will
   actually be charged at, pre-filled from Settings.

   A future season is deliberately not protectable - uplifting a price that
   belongs to a year ahead of the trip counts the same year twice - and neither
   is a month window that only partly overlaps, because that season is live and
   its figure is right for the days it does cover. */
export const CONSENT_SEASON_STATUSES = new Set(['protected', 'stale', 'future', 'expired', 'partial']);
export const PROTECTABLE_SEASON_STATUSES = new Set(['protected', 'stale', 'expired']);

/* The rule every entry point prices by: Pricing Protection is a stand-in for a
   season the library does not have. A price that matches the travel dates IS the
   contract figure, so nothing may uplift it - not the company's Settings
   percentage, not a percentage carried over from another line.

   Protection is therefore only ever applied to the same statuses the confirmation
   dialog offers it for (PROTECTABLE_SEASON_STATUSES). An exact match takes none,
   and so does a season that is live for part of the trip or has not been published
   yet - inflating either would misprice the very days it covers. */
export const protectionForSeason = (season, requestedPercent = 0) => (
  PROTECTABLE_SEASON_STATUSES.has(String(season?.status || ''))
    ? Math.max(0, Number(requestedPercent) || 0)
    : 0
);

export const seasonLineStatus = (season, protectionPercent = 0) => {
  const pct = protectionForSeason(season, protectionPercent);
  if (pct > 0) return 'protected';
  if (season?.status === 'undated') return 'undated';
  if (season?.status === 'provisional') return 'provisional';
  if (ESTIMATE_SEASON_STATUSES.has(season?.status)) return 'estimate';
  return 'matched';
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* Every money column a pricing-matrix rate can hold. Pricing Protection has to
   move all of them together, otherwise the uplift leaks out of the columns the
   quote happens not to read. Percentages are deliberately excluded: child_discount
   is a discount rate, not an amount, and scaling it would compound with the
   adult uplift rather than represent the contract figure. */
export const RATE_MONEY_FIELDS = [
  'price_1_adult', 'price_2_adults', 'price_3_plus_adults', 'unit_price', 'unit_cost',
  'price_child_0_1', 'price_child_0_5', 'price_child_2_11', 'price_child_6_11',
  'price_child_12_17', 'price_child_12_18',
  'single_supplement', 'single_room_rate', 'double_twin_rate', 'effective_single_rate',
  'triple_room_rate', 'weekend_price', 'adult_rate', 'child_rate',
  'guide_rate', 'driver_rate', 'vehicle_rate', 'fast_track_adult_rate', 'tour_leader_rate',
  'guide_transfer_rate', 'guide_half_day_rate', 'guide_full_day_rate',
  'guide_overland_rate', 'guide_dinner_rate',
  'entrance_fee_per_person', 'entrance_fee_per_vehicle', 'entrance_fee_per_child',
  'conservation_levy_per_adult', 'conservation_levy_per_child'
];

const scaleMoneyMap = (map, factor) => Object.fromEntries(
  Object.entries(map).map(([k, v]) => {
    const n = parseFloat(v);
    return [k, Number.isFinite(n) && n > 0 ? round2(n * factor) : v];
  })
);

/* Uplift one rate row by a protection percentage, leaving the row itself
   untouched. Returns a copy so the library item's cached rates are not
   mutated and the original price stays visible for comparison. */
export const applyProtectionToRate = (rate, percent) => {
  const pct = Math.max(0, Number(percent) || 0);
  if (!rate || !pct) return rate;
  const factor = 1 + pct / 100;
  const out = { ...rate, price_protection_percent: pct };
  RATE_MONEY_FIELDS.forEach((f) => {
    const v = parseFloat(rate[f]);
    if (Number.isFinite(v) && v > 0) out[f] = round2(v * factor);
  });
  /* An explicit 0 is meaningful in several of these columns (a free child, a
     waived supplement), so only scale a breakdown that actually has numbers. */
  ['child_rates_breakdown', 'fast_track_child_rates_breakdown'].forEach((f) => {
    if (rate[f] && typeof rate[f] === 'object' && !Array.isArray(rate[f])) {
      out[f] = scaleMoneyMap(rate[f], factor);
    }
  });
  /* Tiered pricing carries its own amounts per band. Leaving these behind is
     how a stale season could still quote the old band price. */
  if (Array.isArray(rate.tiered_pricing)) {
    out.tiered_pricing = rate.tiered_pricing.map((band) => {
      const n = parseFloat(band?.rate);
      return Number.isFinite(n) && n > 0 ? { ...band, rate: round2(n * factor) } : band;
    });
  }
  /* A tour leader ladder prices each included room, so its rates are uplifted
     with the rest of the row; a free (0) tier stays free. Guide and driver
     ladders carry the same per-room amounts and follow the same rule. */
  ['tour_leader_tiers', 'guide_tiers', 'driver_tiers'].forEach((f) => {
    if (!Array.isArray(rate[f])) return;
    out[f] = rate[f].map((tier) => {
      const n = parseFloat(tier?.rate);
      return Number.isFinite(n) && n > 0 ? { ...tier, rate: round2(n * factor) } : tier;
    });
  });
  /* An occupancy ladder is the only money a villa row carries, so protection
     means uplifting its bands. The party sizes they are keyed by never move. */
  if (Array.isArray(rate.occupancy_rates)) {
    out.occupancy_rates = rate.occupancy_rates.map((band) => {
      const key = band?.rate === undefined && band?.price !== undefined ? 'price' : 'rate';
      const n = parseFloat(band?.[key]);
      return Number.isFinite(n) && n > 0 ? { ...band, [key]: round2(n * factor) } : band;
    });
  }
  /* The single-supplement ladder is a price ladder too: a waived (0) tier stays
     waived, a charged tier carries the protection uplift. The covered room count
     is never scaled. */
  if (Array.isArray(rate.single_supplement_tiers)) {
    out.single_supplement_tiers = rate.single_supplement_tiers.map((tier) => {
      const n = parseFloat(tier?.supplement);
      return Number.isFinite(n) && n > 0 ? { ...tier, supplement: round2(n * factor) } : tier;
    });
  }
  return out;
};

/* The first row for a currency — what a caller that ignores seasons gets. */
const firstForCurrency = (rates, currencyCode) => {
  const all = Array.isArray(rates) ? rates : [];
  if (!all.length) return null;
  const codeU = String(currencyCode || '').toUpperCase();
  return all.find((r) => String(r.currency || '').toUpperCase() === codeU) || all[0];
};

/**
 * The single rate row that prices this trip, with Pricing Protection applied.
 *
 * The season-aware replacement for "take the first row for this currency".
 * A library item carries one row per season, and callers that skip season
 * resolution price the line from whichever row the database returned first —
 * which is how a room-allocation dialog can quote a winter rate for a summer
 * trip while the sidebar next to it quotes the right one.
 *
 * Returns null only when the item has no rates at all; callers that need a
 * fallback figure should decide that themselves.
 */
export const rateForTravel = ({
  rates,
  currencyCode,
  startDate,
  endDate,
  protectionPercent = 0,
  allowFuture = false,
  allowPartial = false
} = {}) => {
  const all = Array.isArray(rates) ? rates : [];
  if (!all.length) return null;
  const season = resolveSeasonForTravel({
    rates: all,
    currencyCode,
    startDate,
    endDate,
    protectionPercent,
    allowFuture,
    allowPartial
  });
  if (season.rate) return applyProtectionToRate(season.rate, season.protectionPercent || 0);
  /* Nothing covers the travel dates (undated, or blocked). Return whatever a
     season-blind reader would have used so the caller still has a figure. A
     future season's row is returned here too, but as a display fallback only:
     resolveSeasonForTravel still reports canAdd:false unless the caller allowed
     the estimate. */
  return firstForCurrency(all, currencyCode);
};
