/* Car hire: the 24-hour block decides the money.

   A rental is not billed by calendar days. Collect at 08:00 on the 18th and
   return at 08:00 on the 19th and that is one 24-hour block; return at 08:05 and
   it is two, even though only five minutes were late. The block count selects
   the rental-length band, and the band's PER-DAY rate is multiplied by it.

   Two questions have to be answered before a block count means anything, and each
   answers one of them. The pick-up date selects the season — the contract sells
   the same car group at other money in other weeks, and each season keeps its own
   ladder. The block count then selects the band inside that season.

   Everything here is pure so the rule can be tested without a database. */

const DAY_MINUTES = 1440;

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

const asNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/* Parsed from the text, not from Date(): a DST shift would otherwise turn a
   clean 24-hour hire into 23 or 25 hours and hand the client a free extra day,
   or charge one that was not used. Date.UTC is used only as a day counter. */
const stampToMinutes = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (!match) return null;
  const [, year, month, day, hour = '0', minute = '0'] = match;
  const h = Number(hour);
  const m = Number(minute);
  if (h > 23 || m > 59) return null;
  const days = Math.floor(Date.UTC(Number(year), Number(month) - 1, Number(day)) / 86400000);
  return days * DAY_MINUTES + h * 60 + m;
};

/* Whole 24-hour blocks, rounded up. Zero means the hire is not a hire: either a
   stamp is missing or the car is being returned before it leaves. */
export const rentalDayCount = (pickupAt, returnAt) => {
  const from = stampToMinutes(pickupAt);
  const to = stampToMinutes(returnAt);
  if (from === null || to === null) return 0;
  const diff = to - from;
  if (diff <= 0) return 0;
  return Math.max(1, Math.ceil(diff / DAY_MINUTES));
};

export const isCarRentalItem = (itemOrCategory) => {
  const category = typeof itemOrCategory === 'string' ? itemOrCategory : itemOrCategory?.category;
  return /car\s*rental|rent-a-car|rental car/i.test(String(category || ''));
};

export const gearLabel = (gear) => {
  const value = String(gear || '').toLowerCase();
  if (value === 'manual' || value === 'm') return 'M — Manual';
  if (value === 'automatic' || value === 'a') return 'A — Automatic';
  return value || '';
};

export const fuelLabel = (fuel) => {
  const value = String(fuel || '').toLowerCase();
  if (value === 'fuel' || value === 'f') return 'F — Fuel';
  if (value === 'electric' || value === 'e') return 'E — Electric';
  return value || '';
};

export const carRentalGroupLabel = (group) => {
  if (!group) return '';
  return [group.vehicleGroup, group.vehicleName].filter(Boolean).join(' · ') || group.rateCode || 'Vehicle';
};

/* The window as the contract writes it. A tariff with neither end named is not a
   tariff with an unknown date, it is a tariff good on any day, and the dialog has
   to say so instead of printing "open → open". */
export const rentalSeasonLabel = (validFrom, validTo) => (
  !validFrom && !validTo ? 'Any date' : `${validFrom || 'open'} → ${validTo || 'open'}`
);

const bandLabel = (band) => `${band.minDays}–${band.maxDays === null ? '∞' : band.maxDays} days`;

/* One library item is one hire contract holding several vehicle groups. The
   contract repeats a group once per tariff season — its Rental Price Validity
   window — and once per rental-length band inside that season, because the same
   car is not the same money in December and in June. Fold those rows back into
   what the operator actually signed: a group, holding its seasons, each season
   holding its ladder. */
const seasonSpanDays = (season) => {
  if (!season.validFrom || !season.validTo) return Infinity;
  const from = stampToMinutes(season.validFrom);
  const to = stampToMinutes(season.validTo);
  if (from === null || to === null) return Infinity;
  return Math.max(0, (to - from) / DAY_MINUTES);
};

/* The least specific window last: one that names both ends says more about a
   date than one that names an end, and a dated window says more than a tariff
   open to any day. Used to rank the windows that actually cover a pick-up date. */
const bySpecificity = (a, b) => (
  (b.boundedEnds - a.boundedEnds)
  || (a.spanDays - b.spanDays)
  || String(a.validFrom || '9999-12-31').localeCompare(String(b.validFrom || '9999-12-31'))
  || String(a.validTo || '9999-12-31').localeCompare(String(b.validTo || '9999-12-31'))
);

/* How a contract is read back to the operator: the seasons in the order they
   begin, with an undated tariff last because it speaks for every week and none in
   particular. Ranking for a date is a different question and lives in
   resolveRentalSeason, so the printed ladder stays chronological. */
const byWindowStart = (a, b) => (
  String(a.validFrom || '9999-12-31').localeCompare(String(b.validFrom || '9999-12-31'))
  || String(a.validTo || '9999-12-31').localeCompare(String(b.validTo || '9999-12-31'))
);

export const carRentalGroups = (item) => {
  const rows = Array.isArray(item?.car_rental_rates) ? item.car_rental_rates : [];
  const byKey = new Map();
  const bySeason = new Map();
  rows.forEach((rate) => {
    const key = [rate.vehicle_group || '', rate.vehicle_name || '', rate.rate_code || ''].join('|');
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        vehicleGroup: rate.vehicle_group || '',
        vehicleName: rate.vehicle_name || '',
        rateCode: rate.rate_code || '',
        kmsUnlimited: rate.kms_unlimited !== false,
        kmsIncluded: asNumber(rate.kms_included),
        luggage: asNumber(rate.luggage),
        doors: asNumber(rate.doors),
        passengers: asNumber(rate.max_passengers),
        aircon: rate.has_aircon !== false,
        gear: rate.gear || 'automatic',
        fuelType: rate.fuel_type || 'fuel',
        currency: rate.currency || item?.currency || '',
        seasons: []
      });
    }
    const group = byKey.get(key);
    const window = [rate.valid_from || '', rate.valid_to || ''];
    const seasonKey = `${key}|${window.join('|')}`;
    if (!bySeason.has(seasonKey)) {
      const season = {
        key: seasonKey,
        groupKey: key,
        vehicleGroup: group.vehicleGroup,
        vehicleName: group.vehicleName,
        rateCode: group.rateCode,
        validFrom: window[0],
        validTo: window[1],
        windowLabel: rentalSeasonLabel(window[0], window[1]),
        currency: rate.currency || item?.currency || '',
        boundedEnds: (window[0] ? 1 : 0) + (window[1] ? 1 : 0),
        bands: []
      };
      season.spanDays = seasonSpanDays(season);
      season.groupLabel = carRentalGroupLabel(season);
      bySeason.set(seasonKey, season);
      group.seasons.push(season);
    }
    bySeason.get(seasonKey).bands.push({
      id: rate.id || null,
      minDays: asNumber(rate.min_days),
      maxDays: rate.max_days === null || rate.max_days === undefined || rate.max_days === '' ? null : asNumber(rate.max_days),
      price: asNumber(rate.price),
      currency: rate.currency || item?.currency || ''
    });
  });
  byKey.forEach((group) => {
    group.seasons.sort(byWindowStart);
    group.seasons.forEach((season) => {
      season.bands.sort((a, b) => a.minDays - b.minDays);
      /* The label every refusal carries: which car, and off which of its tariffs
         the answer was looked for. */
      season.label = `${season.groupLabel} (${season.windowLabel})`;
    });
  });
  return [...byKey.values()];
};

/* The band is chosen by the block count, and an unfilled range is a refusal with
   the reason in it — a hire company does not quote a 20-day rental off a tariff
   that stops at 14, and quietly using the 14-day rate would be a lie on paper.
   The ladder read here is one season's, never the pooled ladder of every season
   a group was ever sold across. */
export const selectRentalBand = (season, days) => {
  const bands = Array.isArray(season?.bands) ? season.bands : [];
  const name = season?.label || carRentalGroupLabel(season);
  if (!days) return { band: null, error: 'Set a pick-up and return date and time to price the hire.' };
  const fit = bands.find((band) => band.minDays <= days && (band.maxDays === null || days <= band.maxDays));
  if (fit) return { band: fit, error: null };
  if (!bands.length) return { band: null, error: `${name} has no rental-length bands priced. Add them in Library Items.` };
  const shortest = Math.min(...bands.map((b) => b.minDays));
  const longest = Math.max(...bands.map((b) => (b.maxDays === null ? Infinity : b.maxDays)));
  if (days < shortest) {
    return { band: null, error: `${days} rental days is shorter than this contract sells — the shortest band is ${bandLabel(bands.find((b) => b.minDays === shortest))}.` };
  }
  if (days > longest) {
    return { band: null, error: `${days} rental days is longer than any band on ${name} — the longest is ${bandLabel(bands.find((b) => (b.maxDays === null ? Infinity : b.maxDays) === longest) || bands[bands.length - 1])}. Hire a second car or price the longer band in Library Items.` };
  }
  return { band: null, error: `${days} rental days falls in a gap between the bands priced for ${name}. Close the gap in Library Items.` };
};

/* Which tariff answers this pick-up date. The pick-up decides it, because that is
   the day the car leaves the yard and the day the hire desk stamps on the
   agreement. When several windows cover it — a tariff that overlaps its own
   replacement, usually — the narrowest and most dated one wins, since a window
   written for six weeks is about these six weeks in a way a season tariff is not.
   A group with no dates named on any season has nothing to fail on, and the first
   ladder is the one on offer. */
export const resolveRentalSeason = (group, pickupAt) => {
  const seasons = Array.isArray(group?.seasons) ? group.seasons : [];
  if (!seasons.length) {
    return { season: null, error: `${carRentalGroupLabel(group)} has no rental price validity window. Add one in Library Items.` };
  }
  const pickup = String(pickupAt || '').slice(0, 10);
  if (!pickup) return { season: seasons[0], error: null };
  const covering = seasons
    .filter((season) => (
      (!season.validFrom || pickup >= season.validFrom)
      && (!season.validTo || pickup <= season.validTo)
    ))
    .sort(bySpecificity);
  if (covering.length) return { season: covering[0], error: null };
  /* Nothing covers the date, so say which dates the contract does speak for. */
  if (seasons.length === 1) {
    const only = seasons[0];
    if (only.validFrom && pickup < only.validFrom) {
      return { season: null, error: `Priced for hires from ${only.validFrom}, but this car is collected on ${pickup}.` };
    }
    return { season: null, error: `Priced for hires up to ${only.validTo}, but this car is collected on ${pickup}.` };
  }
  return {
    season: null,
    error: `No tariff on ${carRentalGroupLabel(group)} covers a car collected on ${pickup} — its seasons are ${seasons
      .map((season) => season.windowLabel)
      .join(', ')}.`
  };
};

/* The tariff window is Rental Price Validity, tested against the pick-up date:
   a car collected on 11 December prices off the tariff that covers 11 December. */
export const rentalValidityError = (group, pickupAt) => {
  if (!group) return null;
  return resolveRentalSeason(group, pickupAt).error;
};

/* A group the operator can actually drop today, in the order they would want it:
   priced for the date, priced for the length, and then by the smallest vehicle
   that seats the party. */
export const carRentalGroupChoices = (item, { days, pickupAt, pax = 0 } = {}) => {
  const groups = carRentalGroups(item);
  const fee = Number(item?.rental_contract_fee);
  const contractFee = Number.isFinite(fee) && fee > 0 ? fee : 0;
  return groups.map((group) => {
    const { season, error: validity } = resolveRentalSeason(group, pickupAt);
    const { band, error } = season
      ? selectRentalBand(season, days)
      : { band: null, error: null };
    const capacityError = pax && group.passengers && group.passengers < pax
      ? `${carRentalGroupLabel(group)} seats ${group.passengers}, this party is ${pax}.`
      : null;
    const price = band && !error && !validity
      ? {
        dailyRate: band.price,
        hireTotal: round2(band.price * days),
        contractFee,
        total: round2(band.price * days + contractFee),
        currency: season.currency || group.currency || item?.currency || ''
      }
      : null;
    return {
      group,
      season,
      band,
      error,
      validity,
      capacityError,
      price,
      /* More than one tariff on the group is worth saying out loud: the same car
         at another time of year is other money, and the operator should see that
         the dialog picked one rather than the contract having only one to pick. */
      seasons: group.seasons,
      unusable: Boolean(error || validity) || !band
    };
  }).sort((a, b) => {
    if (a.unusable !== b.unusable) return a.unusable ? 1 : -1;
    /* A group that cannot seat the party is still listed, but never as the
       default the dialog opens on when one that can is available. */
    if (Boolean(a.capacityError) !== Boolean(b.capacityError)) return a.capacityError ? 1 : -1;
    return a.group.passengers - b.group.passengers;
  });
};

/* The whole contract: the car for all its days plus the flat fee the hire desk
   charges for the paperwork. It is what the dialog quotes and what the line says
   the agreement came to; the money actually billed is per line — the days on their
   own blocks, the fee on a line of its own. */
export const carRentalBuyTotal = (details) => {
  if (!details) return 0;
  const total = Number(details.total);
  if (Number.isFinite(total) && total > 0) return round2(total);
  const days = asNumber(details.rentalDays);
  const daily = asNumber(details.dailyRate);
  return round2(days * daily + asNumber(details.contractFee));
};

/* The car alone, before the paperwork: the band's per-day figure times the whole
   24-hour blocks the hire is out for. */
export const carRentalHireTotal = (details) => round2(asNumber(details?.rentalDays) * asNumber(details?.dailyRate));

/* How one hire sits on a day-by-day: a line for every whole 24-hour block,
   because the car is on hire that day and the operator reads a day's cost off
   that day. The contract's own arithmetic already prices one block — the band's
   per-day rate — so each day takes one block and nothing is divided up and
   rounded into a figure that no longer matches the agreement. The blocks price
   the car only; the contract fee is paperwork money and is billed on its own
   line, because a client reads "how much did the agreement cost" and wants a
   figure answering it rather than a day that costs more than the others.
   The last block closes on the hire total rather than on the sum of the parts,
   so a rate typed to more than two decimals cannot leave a cent unbilled. */
export const rentalDayShares = (details) => {
  if (!details || details.contractFeeOnly === true) return [];
  const blocks = asNumber(details.rentalDays);
  if (!blocks) return [];
  const daily = asNumber(details.dailyRate);
  const hire = carRentalHireTotal(details);
  let taken = 0;
  return Array.from({ length: blocks }, (_, index) => {
    const isLast = index === blocks - 1;
    const buyTotal = isLast ? round2(hire - taken) : round2(daily);
    taken = round2(taken + buyTotal);
    return { ordinal: index + 1, dayCount: blocks, blocks: 1, buyTotal };
  });
};

/* The money one hire line is worth. A line that knows which block of the hire it
   carries bills that block; a line carrying the contract fee bills the fee alone;
   a line carrying the hire with no day stamp — a package line, which is the whole
   vehicle for the whole trip — bills the car for all its days. */
export const rentalLineBuyTotal = (details) => {
  if (!details) return 0;
  if (details.contractFeeOnly === true) return round2(asNumber(details.contractFee));
  const share = asNumber(details.dayShare?.buyTotal);
  return share > 0 ? round2(share) : carRentalHireTotal(details);
};

/* The hire's contract fee as a line of its own. It keeps the whole copy around it —
   the same car, the same two ends, the same tariff window — so it refreshes from
   the library and prints like the hire it belongs to, and carries no day stamp
   because it is not a day of the hire. */
export const rentalFeeDetails = (details) => {
  const fee = round2(asNumber(details?.contractFee));
  if (!fee) return null;
  return {
    ...details,
    contractFeeOnly: true,
    dayShare: null,
    rentalDays: 0,
    dailyRate: 0,
    hireTotal: 0,
    total: fee
  };
};

export const isRentalFeeLine = (details) => details?.contractFeeOnly === true;

/* Which line of a hire is the one a document prints the vehicle's spec grid on.
   A hire billed over several 24-hour blocks is still one car, so the grid is said
   once — on the block the car is collected — rather than repeated on every day it
   is out. The paperwork fee is not a day of the hire, so it prints nothing.
   A line with no day stamp (an older line, or a hire carried whole) is the only
   copy the document has, so it carries the grid. */
export const rentalPrintsSpecGrid = (details) => (
  !!details
  && !isRentalFeeLine(details)
  && (!details.dayShare || Number(details.dayShare.ordinal) <= 1)
);

/* The name the fee's own line carries. A trip can hire two cars, and a line that
   just says "contract fee" would not answer which one. */
export const rentalFeeLineLabel = (details) => {
  const vehicle = [details?.vehicleGroup ? `Group ${details.vehicleGroup}` : '', details?.vehicleModel || '']
    .filter(Boolean).join(' · ');
  return `Rental contract fee${vehicle ? ` — ${vehicle}` : ''}`;
};

/* The hire behind a day's line, with that day's block stamped on it. Storing the
   share inside the snapshot rather than beside it is what makes it survive the
   save: every day's line already keeps its own copy of this JSON. */
export const rentalDayDetails = (details, share) => (
  share ? { ...details, dayShare: share } : details
);

/* Which day of the trip the car leaves the yard.
   A dated itinerary answers with its own day dates: the hire starts on the first
   day it is in hand for, so a pick-up that falls between two tour days belongs to
   the later one and a pick-up before the trip begins belongs to day one. A trip
   held as a month has no day dates, so the stored travel start carries the count.
   Neither anchor is there, and the day the operator dropped the hire on is the
   answer. */
export const rentalCollectionDayIndex = ({ details, days = [], travelStart = '', fallbackDayIndex = 0 } = {}) => {
  const tripDays = Array.isArray(days) ? days : [];
  const collectedOn = stampToMinutes(details?.pickupAt);
  if (collectedOn === null) return asNumber(fallbackDayIndex);
  /* Compared as dates, not as stamps: a car collected at five in the afternoon
     leaves on that day, whatever the trip's own day begins at. */
  const collectedDay = Math.floor(collectedOn / DAY_MINUTES);
  const dayNumbers = tripDays.map((day) => {
    const stamp = stampToMinutes(String(day?.date || '').slice(0, 10));
    return stamp === null ? null : Math.floor(stamp / DAY_MINUTES);
  });
  if (dayNumbers.some((entry) => entry !== null)) {
    const inHand = dayNumbers.findIndex((entry) => entry !== null && entry >= collectedDay);
    /* Collected on a day the trip does not name — after its last day, or on a
       date the itinerary skips — so no day can answer for it and the drop stands. */
    if (inHand < 0) return asNumber(fallbackDayIndex);
    return inHand;
  }
  const start = stampToMinutes(String(travelStart || '').slice(0, 10));
  if (start === null || !tripDays.length) return asNumber(fallbackDayIndex);
  const offset = Math.floor(collectedOn / DAY_MINUTES) - Math.floor(start / DAY_MINUTES);
  return Math.min(Math.max(0, offset), tripDays.length - 1);
};

/* Laying a hire onto the days of a trip when it is dropped: one line per whole
   24-hour block, starting the day the car is collected. Re-recording a hire is not
   answered here — a consultant re-prices one day at a time, so the days the hire
   already had are nobody's to rewrite but theirs.
   A block is a day of billing, so a trip with the days for it always shows one
   block per day: a hire dropped late in the trip but long enough to reach back
   starts earlier instead of stacking its cycles onto the drop day. Only a hire
   longer than the whole trip has nowhere to go, and its last day then bills the
   cycles the trip could not hold — the contract charges for them either way. */
export const rentalDayPlacement = ({ details, startDayIndex = 0, itineraryDays = 0 }) => {
  const blocks = rentalDayShares(details);
  if (!blocks.length) {
    return {
      lines: [],
      carried: 0,
      reason: 'Set a pick-up and return date and time to place the hire.'
    };
  }
  const dayCount = asNumber(itineraryDays);
  const start = Math.min(
    Math.max(0, asNumber(startDayIndex)),
    Math.max(0, dayCount - blocks.length)
  );
  const slots = Math.min(blocks.length, Math.max(0, dayCount - start));
  if (!slots) {
    return {
      lines: [],
      carried: 0,
      reason: 'This hire is collected after the itinerary\'s last day, so it has no day to sit on.'
    };
  }
  const lines = Array.from({ length: slots }, (_, index) => {
    /* The last line bills whatever the trip could not hold, so the days still add
       up to the whole hire. */
    const billed = index === slots - 1 ? blocks.slice(index) : [blocks[index]];
    return {
      dayIndex: start + index,
      share: {
        ordinal: index + 1,
        dayCount: slots,
        blocks: billed.length,
        buyTotal: round2(billed.reduce((sum, entry) => sum + entry.buyTotal, 0))
      }
    };
  });
  return { lines, carried: lines[lines.length - 1].share.blocks - 1 };
};

/* The rate-shaped copy of a hire. Both builders price every package line through
   its locked snapshot, and a hire has no item_rates row to lock, so the snapshot
   is built here: flat, per trip, and carrying the seats the band engine needs.
   The `rental_price_validity` stamp is what tells the package's season guards that
   this line answers its own date question — the tariff window was tested against
   the pick-up date in the dialog, so there is no season left to check. */
export const rentalPackageRate = (details, currency, unitCost) => {
  const amount = Number.isFinite(Number(unitCost)) && Number(unitCost) > 0
    ? round2(unitCost)
    : rentalLineBuyTotal(details);
  return {
    id: details?.rateId || null,
    currency: String(currency || details?.currency || 'ZAR').toUpperCase(),
    rate_basis: 'per_trip',
    unit_price: amount,
    unit_cost: amount,
    max_occupancy: asNumber(details?.passengers),
    season_name: `Hire ${details?.seasonName || ''}`.trim(),
    valid_from: details?.validityFrom || null,
    valid_to: details?.validityTo || null,
    rental_price_validity: true
  };
};

export const rentalWindowLabel = (pickupAt, returnAt) => {
  const show = (value) => String(value || '').replace('T', ' ').slice(0, 16).trim();
  const from = show(pickupAt);
  const to = show(returnAt);
  if (!from && !to) return '';
  if (!to) return from;
  if (!from) return to;
  return `${from} → ${to}`;
};

export const rentalDaysLabel = (days) => {
  const n = asNumber(days);
  if (!n) return '';
  return `${n} × 24h ${n === 1 ? 'day' : 'days'}`;
};

/* The vehicle as a document has to name it: the contract type first, because
   that is the wording the hire company is liable for, then the group letter and
   the model the hire desk actually puts the keys of. */
export const rentalVehicleLabel = (details) => {
  if (!details) return '';
  const vehicle = [
    details.vehicleGroup ? `Group ${details.vehicleGroup}` : '',
    details.vehicleModel || ''
  ].filter(Boolean).join(' · ');
  return [details.contractType || '', vehicle].filter(Boolean).join(' — ');
};

/* What the line says when the operator is not in the dialog any more: the car,
   the group and the length, in that order, because that is how the hire desk
   reads it back to you on the phone. */
export const rentalSummaryLabel = (details) => {
  if (!details) return '';
  const vehicle = [details.vehicleGroup ? `Group ${details.vehicleGroup}` : '', details.vehicleModel || '']
    .filter(Boolean).join(' · ');
  const window = rentalWindowLabel(details.pickupAt, details.returnAt);
  const days = rentalDaysLabel(details.rentalDays);
  return [vehicle, window, days].filter(Boolean).join(' — ');
};

/* Everything the documents need, in the shape the line stores. Keeping this in
   one place is what makes the printed grid identical to the edited one. */
export const buildRentalDetails = ({ item, group, season, band, days, pickupAt, returnAt, pickupLocation, returnLocation, sameReturn, contractFee }) => {
  if (!group) return null;
  const tariff = season || null;
  const fee = asNumber(contractFee);
  const dailyRate = band ? band.price : 0;
  const hireTotal = round2(dailyRate * days);
  return {
    contractType: group.rateCode || '',
    vehicleGroup: group.vehicleGroup || '',
    vehicleModel: group.vehicleName || '',
    gear: group.gear || '',
    luggage: group.luggage || 0,
    doors: group.doors || 0,
    passengers: group.passengers || 0,
    aircon: group.aircon !== false,
    fuelType: group.fuelType || 'fuel',
    kmsUnlimited: group.kmsUnlimited !== false,
    kmsIncluded: group.kmsUnlimited !== false ? null : group.kmsIncluded || 0,
    pickupLocation: pickupLocation || '',
    returnLocation: sameReturn ? (pickupLocation || '') : (returnLocation || ''),
    sameReturn: sameReturn === true,
    pickupAt: pickupAt || '',
    returnAt: returnAt || '',
    rentalDays: days || 0,
    dailyRate,
    contractFee: fee,
    hireTotal,
    total: round2(hireTotal + fee),
    currency: tariff?.currency || group.currency || item?.currency || '',
    seasonName: band ? `${band.minDays}–${band.maxDays === null ? '∞' : band.maxDays} days` : '',
    seasonWindow: tariff ? tariff.windowLabel : '',
    seasonCount: asNumber((group.seasons || []).length),
    rateId: band?.id || null,
    validityFrom: tariff ? tariff.validFrom : '',
    validityTo: tariff ? tariff.validTo : ''
  };
};
