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
 *
 * Coverage is exact. A season that only overlaps the travel window for part of
 * it is not accepted: the operator has to price the whole itinerary from one
 * season, and a season that expires mid-trip prices some of the nights at last
 * year's figure with nothing on the quote to say so.
 *
 * "Nearest prior season" is the most recent row whose calendar period matches the
 * travel period but whose year is behind: a Dec-2027/Jan-2028 season priced
 * against an Oct-2026 trip is the same product in a later year, not a stale
 * price. A row is only a candidate for protection when it is BEHIND the travel
 * dates and shares the period of the year, so protection never quietly re-prices
 * a trip into a season that does not exist yet. When no such row exists there is
 * nothing to protect against and the call is blocked with a clear reason.
 */

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
  const fields = [
    'price_1_adult', 'price_2_adults', 'price_3_plus_adults', 'unit_price',
    'single_room_rate', 'double_twin_rate', 'effective_single_rate',
    'adult_rate', 'guide_rate', 'driver_rate', 'vehicle_rate',
    'entrance_fee_per_person', 'entrance_fee_per_vehicle',
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

/* Narrowest covering window wins: a specific week beats a whole-year band. */
const spanOf = (w) => (w.fromDay === -Infinity || w.toDay === Infinity ? Infinity : w.toDay - w.fromDay);

const pickTightest = (candidates) =>
  [...candidates].sort((a, b) => spanOf(a.window) - spanOf(b.window))[0];

/**
 * Decide which season prices an itinerary, and whether protection applies.
 *
 * @param {object}  args
 * @param {Array}   args.rates            item_rates rows for the item
 * @param {string}  args.currencyCode     itinerary currency
 * @param {string}  args.startDate        itinerary travel start (YYYY-MM-DD)
 * @param {string}  args.endDate          itinerary travel end   (YYYY-MM-DD)
 * @param {number}  args.protectionPercent tenant's Pricing Protection (0 = off)
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
  protectionPercent = 0
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
    return {
      ...base,
      status: 'no_price',
      canAdd: false,
      reason: 'This library item has no price loaded for this currency.'
    };
  }

  const winStart = parseDay(startDate);
  const winEnd = parseDay(endDate) === null ? winStart : parseDay(endDate);
  if (winStart === null) {
    /* No travel dates yet: nothing to validate against, use the first priced
       row and let the dates be checked again once they are set. */
    const fallback = rows.find((r) => rateHasPrice(r.rate));
    if (!fallback) {
      return { ...base, status: 'no_price', canAdd: false, reason: 'This library item has no price loaded.' };
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
      return { ...base, status: 'no_price', canAdd: false, reason: 'This library item has no price loaded.' };
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
        that was only correct for some of the nights. */

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
    return {
      ...base,
      status: 'ok',
      rate: best.rate,
      window: best.window,
      canAdd: true,
      seasonName: best.rate.season_name || best.rate.option_name || '',
      validFrom: best.window.fromIso,
      validTo: best.window.toIso,
      staleByYears: tripYear - yearOf(best.window.fromDay),
      reason: `No season in the pricing matrix covers ${iso(startDate)} - ${iso(endDate)}; the closest prior season price was used without protection because no protection percentage is set.`
    };
  }

  /* 4. Nothing usable - the item cannot be priced for this trip. */
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
  'triple_room_rate', 'adult_rate', 'child_rate',
  'guide_rate', 'driver_rate', 'vehicle_rate', 'fast_track_adult_rate',
  'entrance_fee_per_person', 'entrance_fee_per_vehicle',
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
  protectionPercent = 0
} = {}) => {
  const all = Array.isArray(rates) ? rates : [];
  if (!all.length) return null;
  const season = resolveSeasonForTravel({
    rates: all,
    currencyCode,
    startDate,
    endDate,
    protectionPercent
  });
  if (season.rate) return applyProtectionToRate(season.rate, season.protectionPercent || 0);
  /* Nothing covers the travel dates (undated, or blocked). Return whatever a
     season-blind reader would have used so the caller still has a figure. */
  return firstForCurrency(all, currencyCode);
};
