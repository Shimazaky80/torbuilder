/* A composed package offer: several lines that are sold as one thing, and the
   hire component that has no dates of its own.

   Two rules live here, and they answer the same problem from both ends.

   THE OFFER. A package line is one library item, which is the right shape for a
   lodge night and the wrong shape for what an operator sells: a Cape Town airport
   transfer is a car for three rental days, the hire desk's paperwork fee and a
   guide's time, quoted as ONE thing at ONE price. Lines that belong together carry
   the same bundle_key and one bundle_label; nothing about how each is priced
   changes, only how they are grouped, totalled and printed.

   THE HIRE WITHOUT DATES. A hire asked for on an itinerary has a pick-up stamp, and
   that stamp decides the tariff. A hire asked for as a package component has no
   stamp — the package is sold for a validity range, not for a day — so the old rule
   froze whatever the dialog had answered at drop time and the composed offer drifted
   out of date while the guide beside it re-priced. Here the hire carries a REFERENCE
   LENGTH (how many 24-hour blocks one transfer uses) and the tariff is re-answered
   every time the package's dates or the contract change.

   Which tariff answers a stretch of dates is the rental version of the question the
   package already asks of an item rate, so it follows the same shape: the most
   specific window winning, Pricing Protection standing in for a tariff that has since
   closed, and a refusal rather than a guess when the contract does not reach these
   dates at all. It differs in two places, deliberately. An item_rates row with no
   dates is an unpriced row and never counts as covered; a rental tariff with no dates
   is what the drop dialog itself calls "Any date", so it does cover — it simply ranks
   last, behind any window written for these particular weeks. And where an item needs
   ONE season row spanning the whole package range, a hire contract does not: the desk
   re-prices annually, so a year-long package is covered by its tariffs end to end,
   each handing over to the next, and only a range that runs past the last of them is
   left unpriced. */
import {
  buildRentalDetails,
  carRentalGroupLabel,
  carRentalGroups,
  isRentalFeeLine,
  rentalFeeDetails,
  rentalLineBuyTotal,
  rentalPackageRate,
  resolveRentalSeason,
  selectRentalBand,
  sortRentalSeasonsBySpecificity
} from './carRentalPricing';

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const asNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/* A hire recorded as a package component: a reference length and no stamps. A hire
   with real pick-up and return dates keeps the freeze it always had — the day the car
   left the yard answered its tariff question, and the client was quoted that figure. */
export const isReferenceHire = (details) => Boolean(details) && details.referenceHire === true;

/* A tariff runs for the whole validity range when it starts on or before it and ends
   on or after it. An end that the contract leaves unnamed is left open rather than
   treated as missing, because a hire contract with no dates is a tariff good on any
   day — see the header. */
const seasonCoversWindow = (season, window) => (
  (!season.validFrom || season.validFrom <= window.from)
  && (!season.validTo || season.validTo >= window.to)
);

/* The day after a tariff's last, as the contract writes it. Measured in whole days
   because that is how the desk sells them: a tariff ending 30 April and its
   replacement starting 1 May leave no day unpriced between them. */
const dayAfter = (date) => {
  const stamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(stamp) ? null : new Date(stamp + 86400000).toISOString().slice(0, 10);
};

/* Does the contract, read as a whole, speak for every date in this range?

   A hire desk re-prices annually, so a package sold from January to October is
   normally covered by TWO tariffs — the January-to-April ladder and the
   May-to-October one that replaces it — and never by one. Asking a single tariff to
   span the range made every such package read as though the desk had not priced it
   at all. What the contract says instead is that the year is covered end to end, one
   tariff handing over to the next, so that is the test: no day between the first and
   the last date the package sells for is left outside every tariff. Only a range
   that runs past the contract's last day — or starts before its first, or falls in a
   gap the desk genuinely left unpriced — stops being covered. */
const unionCoversWindow = (seasons, window) => {
  const ranges = seasons
    .filter((season) => season.validFrom || season.validTo)
    .map((season) => [season.validFrom || '0000-01-01', season.validTo || '9999-12-31'])
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (!ranges.length) return false;
  let cursor = window.from;
  for (const [from, to] of ranges) {
    if (to < cursor) continue;
    if (from > cursor) return false;
    if (to >= window.to) return true;
    const next = dayAfter(to);
    if (next === null) return false;
    cursor = next;
  }
  return false;
};

/* The tariff that answers the dates a package is sold for.

   ok        one tariff runs for every validity range (the tightest such window wins),
             or the tariffs run back to back across it — then the ladder covering the
             first date the package sells for is the one on offer, and the line names
             it, exactly as a dated hire names the tariff its pick-up day chose
   open      the package has no restricted range, so the contract's own first tariff
             is the one on offer — the same answer a hire with no date gets
   protected none runs for the range; the tariff that closed most recently stands in,
             uplifted by the tenant's Pricing Protection
   stale     the same tariff, but the tenant has set no percentage, so the line is
             charged the old contract figure and has to say so
   blocked   the contract does not reach these dates, or does not sell the
             length — with the reason, never a silent clamp */
export const hireSeasonForWindows = (group, windows = []) => {
  const seasons = Array.isArray(group?.seasons) ? group.seasons : [];
  const name = carRentalGroupLabel(group);
  if (!seasons.length) {
    return { status: 'blocked', season: null, message: `${name} has no rental price validity window. Add one in Library Items.` };
  }
  if (!windows.length) return { status: 'open', season: seasons[0], message: '' };

  const covering = sortRentalSeasonsBySpecificity(
    seasons.filter((season) => windows.every((window) => seasonCoversWindow(season, window)))
  );
  if (covering.length) return { status: 'ok', season: covering[0], message: '' };

  /* No one ladder spans the range, so ask the contract as a whole. */
  if (windows.every((window) => unionCoversWindow(seasons, window))) {
    const { season } = resolveRentalSeason(group, windows[0].from);
    if (season) return { status: 'ok', season, message: '' };
  }

  const ranges = windows.map((window) => `${window.from} – ${window.to}`).join(', ');
  const closed = seasons
    .filter((season) => season.validTo && season.validTo < windows[0].from)
    .sort((a, b) => String(b.validTo).localeCompare(String(a.validTo)));
  if (closed.length) return { status: 'prior', season: closed[0], message: '', ranges };

  const ahead = seasons
    .filter((season) => season.validFrom && season.validFrom > windows[windows.length - 1].to)
    .sort((a, b) => String(a.validFrom).localeCompare(String(b.validFrom)));
  if (ahead.length) {
    return {
      status: 'blocked',
      season: null,
      message: `No tariff on ${name} covers the package validity dates ${ranges}. The nearest one starts ${ahead[0].validFrom}, after the package stops being sold, so the hire desk has not priced this range yet.`
    };
  }
  return {
    status: 'blocked',
    season: null,
    message: `No tariff on ${name} covers the package validity dates ${ranges}. Its tariffs run ${seasons.map((season) => season.windowLabel).join(', ')} — price the contract for these dates in Library Items, or shorten the package validity range.`
  };
};

/**
 * What one hire component of a package offer costs, priced from the contract rows
 * rather than from a figure frozen at drop time.
 *
 * @param {object}  args.group             a folded group from carRentalGroups
 * @param {number}  args.hireDays          the reference length, in 24-hour blocks
 * @param {Array}   args.windows           packageValidityWindows() for the package
 * @param {number}  args.protectionPercent the tenant's Pricing Protection
 * @param {number}  args.contractFee       the hire desk's paperwork fee, if any
 */
export const resolveHireOffer = ({ group, hireDays = 0, windows = [], protectionPercent = 0, contractFee = 0 } = {}) => {
  const days = asNumber(hireDays);
  const name = carRentalGroupLabel(group);
  const pct = Math.max(0, asNumber(protectionPercent));
  const base = {
    ok: false,
    canPrice: false,
    status: 'blocked',
    group: group || null,
    season: null,
    band: null,
    hireDays: days,
    dailyRate: 0,
    hireTotal: 0,
    contractFee: round2(contractFee),
    total: 0,
    currency: group?.currency || '',
    tariffLabel: '',
    validityFrom: '',
    validityTo: '',
    upliftPercent: 0,
    message: ''
  };
  if (!group) {
    return { ...base, message: 'This hire names no vehicle group, so there is nothing to price it from.' };
  }
  if (!days) {
    return { ...base, message: `Say how many 24-hour ${days === 1 ? 'day' : 'days'} one ${name} transfer uses, so the hire has a length to price.` };
  }

  const answer = hireSeasonForWindows(group, windows);
  if (!answer.season) return { ...base, message: answer.message };

  const { band, error } = selectRentalBand(answer.season, days);
  if (!band) {
    return { ...base, season: answer.season, message: error || `${answer.season.label} has no rental-length band for ${days} days.` };
  }

  /* Only a tariff that CLOSED before the package is sold for is a stand-in. A
     contract that simply does not reach the range is blocked above, and a band the
     ladder does not sell is refused by selectRentalBand — the figure a package
     publishes is the desk's, never a neighbour's dressed up as it. */
  const standing = answer.status === 'prior';
  const upliftPercent = standing && pct > 0 ? pct : 0;
  const dailyRate = round2(asNumber(band.price) * (1 + upliftPercent / 100));
  const hireTotal = round2(dailyRate * days);
  const fee = round2(contractFee);
  const status = standing ? (upliftPercent ? 'protected' : 'stale') : answer.status;
  const tariff = `${answer.season.windowLabel}${band ? ` · ${band.minDays}–${band.maxDays === null ? '∞' : band.maxDays} days` : ''}`;

  const currency = answer.season.currency || group.currency || '';
  const message = standing
    ? `${name}: no hire tariff covers ${answer.ranges}, so this offer is priced ${upliftPercent
      ? `with ${upliftPercent}% Pricing Protection on the ${answer.season.windowLabel} tariff, which closed ${answer.season.validTo}`
      : `off the ${answer.season.windowLabel} tariff that closed ${answer.season.validTo}, with no Pricing Protection percentage set — this company has none, so the line is charged that old contract figure exactly as it stands`} at ${currency} ${dailyRate.toFixed(2)} per day.`
    : '';

  return {
    ok: true,
    canPrice: true,
    status,
    group,
    season: answer.season,
    band,
    hireDays: days,
    dailyRate,
    hireTotal,
    contractFee: fee,
    total: round2(hireTotal + fee),
    currency,
    tariffLabel: tariff,
    validityFrom: answer.season.validFrom || '',
    validityTo: answer.season.validTo || '',
    upliftPercent,
    message
  };
};

/* The same answer looked up from what is stored on the line: the snapshot names the
   group and the reference length, and the contract rows come off the library item. */
export const resolveHireOfferForDetails = ({ item, details, windows = [], protectionPercent = 0 } = {}) => {
  const groups = carRentalGroups(item);
  const wanted = details?.groupKey
    || [details?.vehicleGroup || '', details?.vehicleModel || '', details?.contractType || ''].join('|');
  const group = groups.find((entry) => entry.key === wanted) || null;
  if (!group) {
    return {
      ok: false,
      canPrice: false,
      status: 'blocked',
      group: null,
      hireDays: asNumber(details?.rentalDays),
      dailyRate: 0,
      hireTotal: 0,
      contractFee: asNumber(details?.contractFee),
      total: 0,
      message: `${item?.name || 'This contract'} no longer sells the ${wanted.replace(/\|/g, ' · ') || 'named'} group, so the hire in this offer cannot be re-priced. Re-record it, or price the group in Library Items.`
    };
  }
  const fee = asNumber(item?.rental_contract_fee);
  return resolveHireOffer({
    group,
    hireDays: details?.rentalDays,
    windows,
    protectionPercent,
    /* The fee follows the contract like the tariff does: it is the desk's charge for
       drawing up the agreement, and a new agreement costs what the desk now says. */
    contractFee: fee > 0 ? fee : asNumber(details?.contractFee)
  });
};

/* Every group on the contract, answered for the package's dates instead of for a
   pick-up stamp — the drop dialog's list when the hire is a component. A group that
   cannot price the range is still listed, with the reason beside it, because the way
   out of a refusal is to see what the contract does sell. */
export const hireOfferChoices = (item, { hireDays, windows = [], pax = 0, protectionPercent = 0 } = {}) => {
  const days = asNumber(hireDays);
  const fee = asNumber(item?.rental_contract_fee);
  return carRentalGroups(item).map((group) => {
    const offer = resolveHireOffer({
      group,
      hireDays: days,
      windows,
      protectionPercent,
      contractFee: fee > 0 ? fee : 0
    });
    const capacityError = pax && group.passengers && group.passengers < pax
      ? `${carRentalGroupLabel(group)} seats ${group.passengers}, this party is ${pax}.`
      : null;
    return { group, offer, capacityError, unusable: !offer.canPrice };
  }).sort((a, b) => {
    if (a.unusable !== b.unusable) return a.unusable ? 1 : -1;
    if (Boolean(a.capacityError) !== Boolean(b.capacityError)) return a.capacityError ? 1 : -1;
    return a.group.passengers - b.group.passengers;
  });
};

/* The copy a reference hire stores on its line. It goes through the same builder a
   dated hire uses so the printed grid, the summary label and the money all stay
   identical in shape; what differs is that it names no stamps, and that its band may
   already carry the protection uplift. */
export const referenceHireDetails = ({ item, offer, source = {} }) => {
  if (!offer?.group) return null;
  const band = offer.upliftPercent && offer.band
    ? { ...offer.band, price: offer.dailyRate }
    : offer.band;
  const details = buildRentalDetails({
    item,
    group: offer.group,
    season: offer.season,
    band,
    days: offer.hireDays,
    pickupAt: '',
    returnAt: '',
    pickupLocation: source.pickupLocation || '',
    returnLocation: source.sameReturn === false ? (source.returnLocation || '') : (source.pickupLocation || ''),
    sameReturn: source.sameReturn !== false,
    contractFee: offer.contractFee
  });
  if (!details) return null;
  return {
    ...details,
    referenceHire: true,
    groupKey: offer.group.key,
    upliftPercent: offer.upliftPercent,
    /* What the line was answered from, kept so a reloaded package can say which
       tariff it is standing on without re-reading the contract. */
    hireStatus: offer.status,
    hireTariff: offer.tariffLabel,
    hireMessage: offer.message
  };
};

/* The rate-shaped answer a re-resolved hire leaves behind: the snapshot the line
   already carries, with the figures the contract gives today. The season guards
   return it and the builder stores it, so a hire that has moved to another tariff
   never keeps the old money under a new name. Seats are not carried here — a group
   that changed is re-recorded, not quietly re-seated. */
export const hireOfferRateSnapshot = (rate, offer) => ({
  ...(rate || {}),
  currency: String(offer.currency || rate?.currency || 'ZAR').toUpperCase(),
  rate_basis: 'per_trip',
  unit_price: offer.hireTotal,
  unit_cost: offer.hireTotal,
  season_name: `Hire ${offer.band ? `${offer.band.minDays}–${offer.band.maxDays === null ? '∞' : offer.band.maxDays} days` : ''}`.trim(),
  valid_from: offer.validityFrom || null,
  valid_to: offer.validityTo || null,
  price_protection_percent: offer.upliftPercent,
  hire_uplift_percent: offer.upliftPercent,
  reference_hire: true,
  rental_price_validity: true
});

/* ---------------------------------------------------------------------------
   RE-ANSWERING THE OFFER'S HIRE
   ------------------------------------------------------------------------- */

/* One line carrying the answer the contract gives today. Only the money, the copy
   and the protection stamp change: the line keeps its identity, its quantity and
   everything the operator typed beside the hire. The uplift it was answered under
   travels inside the copy (referenceHireDetails stamps it there), so the line re-states
   it beside itself and the ⚑ stamp the day draws reads the same figure. */
const repriceHireLine = (service, details, currency) => {
  const code = details.currency || currency || service.currency_code || 'ZAR';
  const amount = rentalLineBuyTotal(details);
  const uplift = asNumber(details.upliftPercent);
  return {
    ...service,
    currency_code: code,
    unit_cost: amount,
    unit_price: amount,
    vehicle_capacity: asNumber(details.passengers) || service.vehicle_capacity || 0,
    rental: details,
    rate_snapshot: rentalPackageRate(details, code, amount),
    price_protection_percent: uplift,
    protected_season_name: uplift ? (details.hireTariff || '') : ''
  };
};

/* Would this answer move the line at all? Comparing the figures rather than the
   objects is what lets a caller re-resolve on every keystroke without marking a
   saved package dirty for a tariff that has not changed. */
const hireLineMoved = (service, details, amount) => !(
  Math.abs(amount - asNumber(service.unit_cost)) < 0.005
  && asNumber(service.rental?.dailyRate) === asNumber(details.dailyRate)
  && asNumber(service.rental?.rentalDays) === asNumber(details.rentalDays)
  && asNumber(service.rental?.contractFee) === asNumber(details.contractFee)
  && asNumber(service.price_protection_percent) === asNumber(details.upliftPercent)
);

/**
 * Re-answer every hire component on a package's days.
 *
 * Pure and quiet: it returns the same `days` array when nothing moved, and a line
 * it cannot price (the group has gone, or no tariff answers and the caller still
 * wants to see the old figure) keeps what it had — refusing the save is the season
 * guard's job, not this function's. A dated hire is never looked at.
 *
 * @param {Array}   days             the package days, each with its services
 * @param {Array}   args.items       library items carrying their car_rental_rates
 * @param {Array}   args.windows     packageValidityWindows() for the package
 * @param {number}  args.protectionPercent
 * @param {string}  args.currency    the package currency, for a copy that names none
 */
export const repriceHireComponents = (days = [], { items = [], windows = [], protectionPercent = 0, currency = '' } = {}) => {
  if (!Array.isArray(days) || !days.some((day) => (day.services || []).some((service) => isReferenceHire(service.rental)))) {
    return { days, changed: false };
  }
  let changed = false;
  const reprice = (service) => {
    const item = items.find((entry) => entry.id === service.item_id);
    if (!item) return service;
    const offer = resolveHireOfferForDetails({
      item,
      details: service.rental,
      windows,
      protectionPercent
    });
    if (!offer.canPrice) return service;
    return referenceHireDetails({
      item,
      offer,
      source: {
        pickupLocation: service.rental.pickupLocation,
        returnLocation: service.rental.returnLocation,
        sameReturn: service.rental.sameReturn !== false
      }
    });
  };
  const next = days.map((day) => {
    const services = day.services || [];
    if (!services.some((service) => isReferenceHire(service.rental))) return day;
    /* The car this day re-answers for, so its paperwork line can follow it. Keyed
       by group because a day can hold two different hires. */
    const answers = new Map();
    const cars = services.map((service) => {
      if (!isReferenceHire(service.rental) || isRentalFeeLine(service.rental)) return service;
      const details = reprice(service);
      if (details === service || !details) return service;
      answers.set(String(details.groupKey || ''), details);
      const amount = rentalLineBuyTotal(details);
      if (!hireLineMoved(service, details, amount)) return service;
      changed = true;
      return repriceHireLine(service, details, currency);
    });
    /* A contract fee states no hire length, so it cannot ask the tariff question on
       its own. It is the same agreement's charge as the car beside it, so it takes
       that car's answer — including when the desk stops charging one. */
    return {
      ...day,
      services: cars.map((service) => {
        if (!isReferenceHire(service.rental) || !isRentalFeeLine(service.rental)) return service;
        const details = answers.get(String(service.rental.groupKey || '')) || answers.values().next().value || null;
        if (!details) return service;
        const fee = rentalFeeDetails(details);
        if (!fee) return service;
        const amount = rentalLineBuyTotal(fee);
        if (Math.abs(amount - asNumber(service.unit_cost)) < 0.005) return service;
        changed = true;
        const code = fee.currency || currency || service.currency_code || 'ZAR';
        return {
          ...service,
          currency_code: code,
          unit_cost: amount,
          unit_price: amount,
          rental: fee,
          rate_snapshot: rentalPackageRate(fee, code, amount)
        };
      })
    };
  });
  return changed ? { days: next, changed: true } : { days, changed: false };
};

/* ---------------------------------------------------------------------------
   THE COMPOSED OFFER
   ------------------------------------------------------------------------- */

/* Lines on one day collapsed into the offers they belong to.

   A bundle is pulled together wherever its lines sit, because a client reading the
   day asks what the transfer cost, not where each of its three parts happened to
   land. A line with no key stays exactly where it was and is its own entry.
   Band-scoped callers pass the lines of one band only, so the same key appearing in
   two bands totals twice — correctly, once per party size. */
export const bundleGroups = (services = [], { lineTotal = (service) => asNumber(service?.unit_cost) } = {}) => {
  const ordered = [];
  const byKey = new Map();
  (Array.isArray(services) ? services : []).forEach((service) => {
    if (!service) return;
    const key = service.bundle_key || null;
    if (!key) { ordered.push({ key: null, label: '', lines: [service], total: round2(lineTotal(service)), currency: service.currency_code || '' }); return; }
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: service.bundle_label || '', lines: [], total: 0, currency: service.currency_code || '' };
      byKey.set(key, group);
      ordered.push(group);
    }
    if (!group.label && service.bundle_label) group.label = service.bundle_label;
    group.lines.push(service);
  });
  byKey.forEach((group) => {
    group.total = round2(group.lines.reduce((sum, service) => sum + asNumber(lineTotal(service)), 0));
  });
  return ordered;
};

/* The name a new offer starts with, when the operator has not typed one yet: what
   the first line already calls itself. */
export const defaultBundleLabel = (service) => String(service?.item_name || service?.name || 'Composed offer').trim() || 'Composed offer';

/* Joining, leaving and renaming all mean the same thing to the data: every line of
   an offer carries the key and the label, so the offer's identity travels with the
   rows rather than living in a parent nothing else can see. */
export const stampBundle = (service, key, label) => ({
  ...(service || {}),
  bundle_key: key || null,
  bundle_label: key ? (label || defaultBundleLabel(service)) : null
});

/* Leaving an offer: a bundle reduced to one line says nothing a plain line does not,
   so the key comes off rather than being kept as a group of one. */
export const unstampBundle = (service) => stampBundle(service, null, '');

export const isBundleLine = (service) => Boolean(service?.bundle_key);

/* The offer as the day reads it: the name, how many parts it has, and the figure a
   client is shown for the whole of it. */
export const bundleOfferLabel = (group) => (
  group && group.key ? `${group.label || defaultBundleLabel(group.lines[0])} — ${group.lines.length} parts` : ''
);
