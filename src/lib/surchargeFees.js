/* Fees & Tickets as independent service lines.
 *
 * Park / entrance fees and conservation levies used to be per-season columns
 * hanging off a Transfers / Activities / Accommodation item, which meant they
 * were invisible on the itinerary (they were fetched and never read) and
 * impossible to price independently. They are now their own category with
 * their own library items, so each becomes a normal service line on the day.
 *
 * The rules that are not obvious:
 *
 *  - Basis. A supplier charges an entrance fee once for the whole booking, or
 *    once per night. A per-night fee attached to accommodation repeats for the
 *    number of nights that property is on the itinerary; a once-off fee does
 *    not. A per-night fee with nothing to attach to has no way to know how many
 *    times to repeat, so the caller asks the operator.
 *
 *  - Chargeable. Some suppliers include the fee in the room rate and it is only
 *    there for reference; others bill it on top. A non-chargeable surcharge is
 *    still shown on the itinerary, but it carries no markup and no money is
 *    added to the total - it is the supplier's figure, passed through as-is.
 *
 *  - Link. A fee that belongs to one accommodation carries that item's id so
 *    the two arrive together and stay together on the same day.
 *
 *  - Type. Entrance fees and tickets are bought at the same gate and priced
 *    from the same columns - a ticket is a name, not a new ladder. Only a
 *    conservation levy keeps its own adult/child columns, and only a levy
 *    prices a booking that bills children alone.
 */

import { resolveSeasonForTravel, applyProtectionToRate, protectionForSeason } from './priceValidity';

export const SURCHARGE_CATEGORY = 'Fees & Tickets';

/* Rows saved before the rename still read as fees, so a database that has not
   run the rename migration behaves exactly like one that has. */
export const LEGACY_SURCHARGE_CATEGORY = 'Surcharge Fees';

export const SURCHARGE_TYPES = [
  { id: 'entrance_fee', label: 'Park / Entrance Fees' },
  { id: 'conservation_levy', label: 'Conservation Levy' },
  { id: 'porterage', label: 'Porterage' },
  { id: 'ticket', label: 'Ticket' }
];

export const CHARGE_BASIS = [
  { id: 'once_off', label: 'Once Off' },
  { id: 'per_night', label: 'Per Night' }
];

/* What the fee is charged on. Entrance fees have no per-child figure in the
   rate row, so they are not offered per child: silently charging the adult
   figure or the per-person figure here would bill the wrong number.
   (An entrance fee still prices a CHILD - see surchargeChildAmount - it just
   does not offer a basis that bills ONLY children.)

   "Per Vehicle" is the flat basis a park gate actually uses - it bills the
   car, not the heads - so it is offered on every fee type and stores its
   figure in the one vehicle column the rate table has.
   "Per Unit" is what that basis was called before it was named: kept so an
   item already saved on it still prices, but never offered again. */
export const UNIT_BASES = [
  { id: 'per_person', label: 'Per Person' },
  { id: 'per_adult', label: 'Per Adult' },
  { id: 'per_child', label: 'Per Child', conservationOnly: true },
  { id: 'per_vehicle', label: 'Per Vehicle' },
  { id: 'per_unit', label: 'Per Unit', legacyOnly: true }
];

export const unitBasesFor = (item) => {
  const type = surchargeTypeOf(item);
  const stored = surchargeUnitBasisOf(item);
  /* Porterage bills every traveller per head - guide and driver excepted - so
     per person is the only basis it offers. A figure stored on another basis
     stays listed so the row still reads honestly until it is re-saved. */
  if (type === 'porterage') return UNIT_BASES.filter((u) => u.id === 'per_person' || u.id === stored);
  return UNIT_BASES.filter((u) => {
    if (u.conservationOnly && type !== 'conservation_levy') return false;
    if (u.legacyOnly && stored !== u.id) return false;
    return true;
  });
};

/* Whether this fee type can price the basis at all - which is not the same
   question as whether the editor still offers it. A legacy "per unit" item
   prices on every type, so it stays valid even though the dropdown lists it
   only while it is the stored answer; "per child" belongs to a levy alone,
   because no other type stores a child-only figure. */
export const isValidUnitBasis = (item, basis) => {
  if (surchargeTypeOf(item) === 'porterage') return basis === 'per_person';
  return basis !== 'per_child' || surchargeTypeOf(item) === 'conservation_levy';
};

export const isSurchargeItem = (item) => {
  const category = String(item?.category || '').trim();
  return category === SURCHARGE_CATEGORY || category === LEGACY_SURCHARGE_CATEGORY || /surcharge/i.test(category);
};

/* Conservation levies, park fees, entrance fees, tickets, porterage, toll fees,
   and any other surcharge fees are excluded from the day-by-day routing in export
   documents and must only show under Inclusions. */
export const isFeeLevyOrTollItem = (item) => {
  if (!item) return false;
  if (isSurchargeItem(item)) return true;
  const cat = String(item.category || '').trim().toLowerCase();
  const name = String(item.item_name || item.name || '').trim().toLowerCase();
  const feeType = String(item.surcharge_type || item.fee_type || '').trim().toLowerCase();
  if (['fees & tickets', 'surcharge fees', 'fees', 'levies', 'tickets', 'ticket'].includes(cat)) return true;
  if (/fee|levy|levies|porterage|toll/.test(cat)) return true;
  if (/fee|levy|levies|porterage|toll/.test(feeType)) return true;
  if (/conservation\s*lev(y|ies)|park\s*fee|entrance\s*fee|porterage|toll\s*(fee)?/i.test(name)) return true;
  return false;
};

export const surchargeTypeOf = (item) => {
  const raw = String(item?.surcharge_type || item?.fee_type || '').toLowerCase();
  if (raw.includes('conservation')) return 'conservation_levy';
  if (raw.includes('porterage')) return 'porterage';
  if (raw.includes('ticket')) return 'ticket';
  if (raw.includes('entrance')) return 'entrance_fee';
  return 'entrance_fee';
};

/* A ticket is bought at the same gate as an entrance fee and is priced from the
   same columns - the type only changes what the editor, the rate card and the
   documents say. A conservation levy is the odd one out: it quotes its own
   adult/child ladder. */
export const feeUsesLevyColumns = (item) => surchargeTypeOf(item) === 'conservation_levy';

/* Porterage is a once-per-stay service charged outside the season calendar, so
   it is always once-off even if a row stored another answer. */
export const surchargeBasisOf = (item) => {
  if (surchargeTypeOf(item) === 'porterage') return 'once_off';
  return String(item?.surcharge_charge_basis || '') === 'per_night' ? 'per_night' : 'once_off';
};

export const surchargeUnitBasisOf = (item) => {
  const raw = String(item?.surcharge_unit_basis || 'per_person').toLowerCase();
  return UNIT_BASES.some((u) => u.id === raw) ? raw : 'per_person';
};

export const surchargeTypeLabel = (type) =>
  (SURCHARGE_TYPES.find((t) => t.id === type) || SURCHARGE_TYPES[0]).label;

/* A rate cell the operator left blank is no figure at all, so it reads back as
   null rather than 0 - "not priced", "free" and "some amount" are three
   different answers and only the middle one is 0. */
const rateNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/* A fee that admits people one head at a time. A per-unit or per-vehicle fee
   buys a THING - a booking, a car - so there is no extra head, child or guide,
   with a price of its own. */
export const feeBasisChargesHeads = (unitBasis) => unitBasis !== 'per_unit' && unitBasis !== 'per_vehicle';

export const feeChargesPerHead = (item) => feeBasisChargesHeads(surchargeUnitBasisOf(item));

/* The figure a fee's rate row stores for its own type and basis. A blank cell
   means the row was never priced rather than a real zero, so the editor can
   tell "no fee here" apart from a deliberate 0. */
export const surchargeRateAmount = (rate, item) => {
  if (!rate) return null;
  const unitBasis = surchargeUnitBasisOf(item);
  /* A vehicle is a vehicle whoever quotes it, so every fee type reads the per-
     vehicle figure from the one vehicle column before its type is consulted. */
  if (unitBasis === 'per_vehicle') return rateNumber(rate.entrance_fee_per_vehicle);
  if (unitBasis === 'per_unit') return rateNumber(rate.unit_price);
  if (feeUsesLevyColumns(item)) {
    return unitBasis === 'per_child'
      ? rateNumber(rate.conservation_levy_per_child)
      : rateNumber(rate.conservation_levy_per_adult);
  }
  return rateNumber(rate.entrance_fee_per_person);
};

/* What one CHILD pays this fee, when the property prices children separately.
   null means it does not, and a child is admitted on the visitor's figure -
   the same "not split by age" answer a room gives when it carries no child
   slots. Only a per_child levy has a child figure with no adult one beside it. */
export const surchargeChildAmount = (rate, item) => {
  if (!rate || !feeChargesPerHead(item)) return null;
  if (feeUsesLevyColumns(item)) {
    return rateNumber(rate.conservation_levy_per_child);
  }
  return rateNumber(rate.entrance_fee_per_child);
};

/* What the operator's own GUIDE pays to be admitted. null means the property
   gave no crew figure, so the guide is charged the visitor amount the fee
   bills - 0 typed on purpose is the free one. */
export const surchargeGuideAmount = (rate, item) => (
  rate && feeChargesPerHead(item) ? rateNumber(rate.guide_rate) : null
);

/* The rate columns a fee row writes, matching the columns surchargeBuyTotal
   reads for the same type and basis. `childAmount` and `guideAmount` are only
   written when the caller passes them: a workspace whose migration has not run
   must not be told to write a column it does not have, and a fee on a flat
   basis has no head to price beside the thing it buys. */
export const surchargeRateColumns = ({
  type, unitBasis, amount, childAmount, guideAmount
}) => {
  const parsed = parseFloat(amount);
  const value = Number.isFinite(parsed) ? parsed : null;
  const columns = {};
  if (unitBasis === 'per_vehicle') {
    columns.entrance_fee_per_vehicle = value;
  } else if (unitBasis === 'per_unit') {
    columns.unit_price = value;
  } else if (type === 'conservation_levy') {
    if (unitBasis === 'per_child') columns.conservation_levy_per_child = value;
    else columns.conservation_levy_per_adult = value;
  } else if (type === 'porterage') {
    columns.entrance_fee_per_person = value;
    columns.unit_price = value;
  } else {
    columns.entrance_fee_per_person = value;
  }
  const heads = feeBasisChargesHeads(unitBasis);
  const childColumn = type === 'conservation_levy' ? 'conservation_levy_per_child' : 'entrance_fee_per_child';
  if (childAmount !== undefined && heads && columns[childColumn] === undefined) {
    columns[childColumn] = rateNumber(childAmount);
  }
  if (guideAmount !== undefined && heads) {
    columns.guide_rate = rateNumber(guideAmount);
  }
  return columns;
};

/* A season's identity, shared by the editor and the save path. A fee carries
   one amount per property season, so the key has to survive a round-trip
   through item_rates: the name plus both date bounds, normalised. */
export const feeSeasonName = (name) => String(name || '').trim() || 'Base Season';

const seasonDateKey = (value) => String(value || '').slice(0, 10);

export const feeSeasonKey = (seasonName, validFrom = '', validTo = '') =>
  `${feeSeasonName(seasonName)}|${seasonDateKey(validFrom)}|${seasonDateKey(validTo)}`;

const rateSeasonKey = (rate) => feeSeasonKey(
  rate?.season_name || rate?.option_name,
  rate?.valid_from,
  rate?.valid_to
);

/* A fee's rate rows read into a map keyed by season. `seasons` lets a renamed
   or re-dated season still find its figure: exact key first, then the same
   window, then the same name, and finally position when both lists are the
   same length. Without seasons the map is keyed straight off the rate rows.
   `read` picks which figure of the row to collect - the visitor amount by
   default, a child amount for the row's own child column. */
export const feeAmountsBySeason = (feeItem, seasons = [], read = surchargeRateAmount) => {
  const rates = Array.isArray(feeItem?.item_rates) ? feeItem.item_rates : [];
  const priced = rates
    .map((rate) => ({ rate, amount: read(rate, feeItem) }))
    .filter((entry) => entry.amount !== null);
  const groups = (Array.isArray(seasons) ? seasons : []).filter(Boolean);
  const amounts = {};

  if (!groups.length) {
    priced.forEach(({ rate, amount }) => {
      amounts[rateSeasonKey(rate)] = String(amount);
    });
    return amounts;
  }

  const used = new Set();
  const set = (group, entry) => {
    if (!entry || used.has(entry)) return;
    used.add(entry);
    amounts[feeSeasonKey(group.seasonName, group.validFrom, group.validTo)] = String(entry.amount);
  };

  /* 1. Same season identity. */
  groups.forEach((group) => {
    const key = feeSeasonKey(group.seasonName, group.validFrom, group.validTo);
    if (amounts[key] !== undefined) return;
    set(group, priced.find((entry) => rateSeasonKey(entry.rate) === key && !used.has(entry)));
  });

  /* 2. The operator renamed the season but kept its window. */
  groups.forEach((group) => {
    const key = feeSeasonKey(group.seasonName, group.validFrom, group.validTo);
    if (amounts[key] !== undefined) return;
    set(group, priced.find((entry) => !used.has(entry)
      && seasonDateKey(entry.rate?.valid_from) === seasonDateKey(group.validFrom)
      && seasonDateKey(entry.rate?.valid_to) === seasonDateKey(group.validTo)));
  });

  /* 3. The operator moved the season but kept its name. */
  groups.forEach((group) => {
    const key = feeSeasonKey(group.seasonName, group.validFrom, group.validTo);
    if (amounts[key] !== undefined) return;
    set(group, priced.find((entry) => !used.has(entry)
      && feeSeasonName(entry.rate?.season_name || entry.rate?.option_name)
        === feeSeasonName(group.seasonName)));
  });

  /* 4. Both changed in the same edit: the rows and seasons still line up. */
  if (priced.length === groups.length) {
    groups.forEach((group, index) => {
      const key = feeSeasonKey(group.seasonName, group.validFrom, group.validTo);
      if (amounts[key] !== undefined) return;
      set(group, priced[index]);
    });
  }

  return amounts;
};

/* A season's fee amount is keyed by its name and window. Retyping either in the
   editor moves the figure with the season; leaving it under the old key would
   make the save path look up the new key, find nothing, and drop a fee the
   operator never touched. */
export const moveFeeAmount = (amounts, oldKey, newKey) => {
  if (!amounts || typeof amounts !== 'object') return amounts;
  if (!oldKey || !newKey || oldKey === newKey) return amounts;
  if (!Object.prototype.hasOwnProperty.call(amounts, oldKey)) return amounts;
  const moved = { ...amounts, [newKey]: amounts[oldKey] };
  delete moved[oldKey];
  return moved;
};

/* A fee's own validity windows. A levy runs on the park authority's calendar,
   not the property's: a room season of 20 Dec - 7 Jan straddles two levy years,
   so the fee cannot borrow the room's window without billing one figure for
   both. Each window is a name plus both date bounds; the amount maps stay keyed
   by feeSeasonKey so a renamed or re-dated window carries its figure with it. */
export const feeWindowId = () => `win_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const feeWindowKey = (window) => feeSeasonKey(window?.seasonName, window?.validFrom, window?.validTo);

export const emptyFeeWindow = (seasonName = '') => ({
  id: feeWindowId(),
  seasonName: String(seasonName || '').trim(),
  validFrom: '',
  validTo: ''
});

/* The windows a saved fee actually carries, read straight off its own rate rows
   in stored order. Rows written before fees owned their calendar borrowed the
   property's seasons, and those windows are still the fee's own contract. */
export const feeWindowsFromRecord = (feeItem) => {
  const rates = Array.isArray(feeItem?.item_rates) ? feeItem.item_rates : [];
  const seen = new Set();
  const windows = [];
  rates.forEach((rate) => {
    const window = {
      seasonName: feeSeasonName(rate?.season_name || rate?.option_name),
      validFrom: seasonDateKey(rate?.valid_from),
      validTo: seasonDateKey(rate?.valid_to)
    };
    const key = feeWindowKey(window);
    if (seen.has(key)) return;
    seen.add(key);
    windows.push({ ...window, id: feeWindowId() });
  });
  return windows;
};

/* Seed a fee's calendar from the property's seasons: the common case where the
   gate price does follow the room contract. Deduped across rooms, because one
   season window priced for three rooms is still one window to the fee. */
export const feeWindowsFromSeasons = (seasons = []) => {
  const seen = new Set();
  const windows = [];
  (Array.isArray(seasons) ? seasons : []).filter(Boolean).forEach((season) => {
    const window = {
      seasonName: feeSeasonName(season.seasonName),
      validFrom: seasonDateKey(season.validFrom),
      validTo: seasonDateKey(season.validTo)
    };
    const key = feeWindowKey(window);
    if (seen.has(key)) return;
    seen.add(key);
    windows.push({ ...window, id: feeWindowId() });
  });
  return windows;
};

/* Two windows of one fee may not overlap: a night inside both would have two
   contracted figures and the resolver would pick whichever row came first.
   Open bounds overlap everything on their open side. */
export const feeWindowsOverlap = (a, b) => {
  const aFrom = seasonDateKey(a?.validFrom);
  const aTo = seasonDateKey(a?.validTo);
  const bFrom = seasonDateKey(b?.validFrom);
  const bTo = seasonDateKey(b?.validTo);
  const startsBeforeOtherEnds = (from, to) => !from || !to || from <= to;
  return startsBeforeOtherEnds(aFrom, bTo) && startsBeforeOtherEnds(bFrom, aTo);
};

export const feeWindowOverlapError = (windows = []) => {
  const list = (Array.isArray(windows) ? windows : []).filter(Boolean);
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (!feeWindowsOverlap(list[i], list[j])) continue;
      const label = (w) => `${w.seasonName || 'Unnamed'} (${w.validFrom || 'open'} to ${w.validTo || 'open'})`;
      return `validity windows "${label(list[i])}" and "${label(list[j])}" overlap, so a night between them would have two prices`;
    }
  }
  return '';
};

/* A linked fee read back into the property editor. The fee's terms are shared
   across the property; `windows` is its own calendar and `amounts` holds one
   figure per window. `amount` keeps the first priced figure for callers that
   still expect a single row. */
export const feeEditorRowFromRecord = (feeItem, windows = null) => {
  const rates = Array.isArray(feeItem?.item_rates) ? feeItem.item_rates : [];
  const pricedRate = rates.find((rate) => surchargeRateAmount(rate, feeItem) !== null) || rates[0];
  const amount = surchargeRateAmount(pricedRate, feeItem);
  const calendar = (Array.isArray(windows) ? windows : feeWindowsFromRecord(feeItem))
    .map((window) => ({ ...window, id: window.id || feeWindowId() }));
  return {
    key: `fee_${feeItem?.id || ''}`,
    dbId: feeItem?.id || null,
    name: feeItem?.name || '',
    type: surchargeTypeOf(feeItem),
    chargeBasis: surchargeBasisOf(feeItem),
    unitBasis: surchargeUnitBasisOf(feeItem),
    chargeable: feeItem?.surcharge_chargeable !== false,
    amount: amount === null ? '' : String(amount),
    windows: calendar,
    amounts: feeAmountsBySeason(feeItem, calendar),
    childAmounts: feeAmountsBySeason(feeItem, calendar, surchargeChildAmount)
  };
};

/* One rate row for a linked fee in one accommodation season. The season window
   is the property's, so the same travel-window resolution that prices the room
   also finds the fee row that covers the trip. */
export const feeRatePayload = ({
  itemId,
  currency,
  seasonName = 'Base Season',
  validFrom = '',
  validTo = '',
  type = 'entrance_fee',
  unitBasis = 'per_person',
  amount,
  childAmount
}) => ({
  item_id: itemId,
  option_name: feeSeasonName(seasonName),
  season_name: feeSeasonName(seasonName),
  meal_plan: null,
  currency,
  valid_from: validFrom || null,
  valid_to: validTo || null,
  price_1_adult: null,
  price_2_adults: null,
  price_3_plus_adults: null,
  child_rates_breakdown: {},
  single_supplement: null,
  child_discount: null,
  single_room_rate: null,
  double_twin_rate: null,
  effective_single_rate: null,
  rate_basis: 'per_person',
  child_sharing_policy: '',
  unit_price: null,
  ...surchargeRateColumns({ type, unitBasis, amount, childAmount })
});

/* Default true: a fee that is quoted is a fee that is billed. A tenant that
   wants the supplier figure shown for reference only sets this to false. */
export const isSurchargeChargeable = (item) => item?.surcharge_chargeable !== false;

export const surchargeLinkId = (item) => item?.linked_item_id || item?.surcharge_linked_item_id || null;

export const surchargeLabel = (item) => surchargeTypeLabel(surchargeTypeOf(item));

/* The linked accommodation item, if any. */
export const linkedAccommodationOf = (item, allItems = []) => {
  const id = surchargeLinkId(item);
  if (!id) return null;
  return (Array.isArray(allItems) ? allItems : []).find((it) => it.id === id) || null;
};

/* Every surcharge linked to this accommodation, in library order. */
export const surchargesForItem = (accommodationItem, allItems = []) => {
  const id = accommodationItem?.id;
  if (!id) return [];
  return (Array.isArray(allItems) ? allItems : []).filter(
    (it) => isSurchargeItem(it) && surchargeLinkId(it) === id
  );
};

/* Surcharges with no accommodation to hang off. */
export const unlinkedSurcharges = (allItems = []) =>
  (Array.isArray(allItems) ? allItems : []).filter((it) => isSurchargeItem(it) && !surchargeLinkId(it));

/**
 * How many times a surcharge line repeats for a given number of nights.
 *
 * A once-off fee is 1. A per-night fee linked to accommodation repeats for the
 * nights that property is booked. A per-night fee with no link cannot be
 * derived - `needsRepeatPrompt` says so, and the caller asks the operator for
 * the count instead of guessing.
 */
export const surchargeRepeats = ({ item, nights = 1 } = {}) => {
  if (surchargeBasisOf(item) !== 'per_night') return 1;
  const n = Math.max(1, parseInt(nights, 10) || 1);
  return n;
};

export const needsRepeatPrompt = (item) =>
  surchargeBasisOf(item) === 'per_night' && !surchargeLinkId(item);

const addNightDays = (iso, n) => {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/* The buy for a fee line night by night. A levy runs on the park authority's
   calendar, not the property's: a room season of 20 Dec - 7 Jan straddles two
   levy years, so each night resolves the fee window covering THAT night and
   the line sums the nights instead of multiplying one season by the count.
   An undated (month-timed) line falls back to the trip window for every night,
   which is the single resolution it always had. A night no season can price
   is returned unpriced - the caller leaves it off and says so, never bills it
   at a guess. */
export const surchargeNightsBuy = ({
  item,
  currencyCode,
  firstDate = '',
  fallbackStart = '',
  fallbackEnd = '',
  nights = 1,
  protectionPercent = 0,
  allowFuture = false,
  allowPartial = false,
  paxCount = 1,
  childCount = 0,
  guideCount = 0
} = {}) => {
  const count = Math.max(1, parseInt(nights, 10) || 1);
  const rates = Array.isArray(item?.item_rates) ? item.item_rates : [];
  const nightRows = [];
  let total = 0;
  let unitBasis = surchargeUnitBasisOf(item);
  for (let n = 0; n < count; n += 1) {
    const date = firstDate ? addNightDays(firstDate, n) : '';
    const season = resolveSeasonForTravel({
      rates,
      currencyCode,
      startDate: date || fallbackStart,
      endDate: date || fallbackEnd,
      protectionPercent,
      allowFuture,
      allowPartial
    });
    if (!season.rate || !season.canAdd) {
      nightRows.push({ date, season, total: 0, perRepeat: 0, priced: false, protectionPercent: 0 });
      continue;
    }
    const pct = protectionForSeason(season, protectionPercent);
    const night = surchargeBuyTotal({
      rate: applyProtectionToRate(season.rate, pct),
      item,
      paxCount,
      childCount,
      guideCount,
      nights: 1
    });
    unitBasis = night.unitBasis;
    total += night.total;
    nightRows.push({ date, season, total: night.total, perRepeat: night.perRepeat, priced: true, protectionPercent: pct });
  }
  return {
    total,
    unitBasis,
    nights: nightRows,
    pricedNights: nightRows.filter((row) => row.priced).length,
    firstSeason: nightRows[0]?.season || null
  };
};

/**
 * The buy total for one surcharge line, before markup.
 *
 * `paxCount` and `childCount` drive the per-person / per-adult / per-child
 * bases; the other bases are flat. `guideCount` is the operator's own guide
 * walking in with the group - only a fee that bills heads has a place to sell
 * them. `nights` feeds the per-night repetition.
 */
export const surchargeBuyTotal = ({ rate, item, paxCount = 1, childCount = 0, guideCount = 0, nights = 1 } = {}) => {
  const unitBasis = surchargeUnitBasisOf(item);
  const type = surchargeTypeOf(item);
  const isPorterage = type === 'porterage';
  const repeats = isPorterage ? 1 : surchargeRepeats({ item, nights });
  const adults = Math.max(0, (parseInt(paxCount, 10) || 0) - (parseInt(childCount, 10) || 0));
  const children = Math.max(0, parseInt(childCount, 10) || 0);
  const guides = isPorterage ? 0 : Math.max(0, parseInt(guideCount, 10) || 0);

  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  /* Each surcharge type stores its head figures in a different pair of columns,
     so the basis has to be read against the type rather than against one set of
     columns - otherwise a levy set per adult silently priced as zero (or as the
     wrong number) depending on which columns happened to be filled in. The
     vehicle figure is the exception: one column, shared by every type. */
  const unitFigure = feeUsesLevyColumns(item)
    ? {
        adult: num(rate?.conservation_levy_per_adult),
        child: num(rate?.conservation_levy_per_child),
        vehicle: num(rate?.entrance_fee_per_vehicle)
      }
    : {
        adult: num(rate?.entrance_fee_per_person),
        child: num(rate?.entrance_fee_per_child),
        vehicle: num(rate?.entrance_fee_per_vehicle)
      };

  /* The amount ONE adult head costs on this basis, which is also what a guide
     falls back to when the property gave no crew figure. It stays 0 on a basis
     that buys a thing (a unit, a vehicle) or bills only children, so a guide is
     never charged an amount this fee does not sell. */
  let adultHead = 0;

  let perRepeat = 0;
  switch (unitBasis) {
    case 'per_adult':
      adultHead = unitFigure.adult || num(rate?.price_1_adult);
      perRepeat = adultHead * adults;
      break;
    case 'per_child':
      perRepeat = unitFigure.child * children;
      break;
    case 'per_unit':
      perRepeat = num(rate?.unit_price) || num(rate?.price_1_adult);
      break;
    case 'per_vehicle':
      /* One vehicle, one figure, whoever quoted it. Falling back to the head
         amount here would charge a car the price of a person. */
      perRepeat = unitFigure.vehicle;
      break;
    case 'per_person':
    default:
      /* Per person means every traveller, so a levy with a separate child
         figure is adult x adults + child x children. Falling back to the adult
         figure for a child would bill the child's price at the adult rate. */
      adultHead = unitFigure.adult;
      if (type === 'conservation_levy') {
        perRepeat = (unitFigure.adult * adults) + (unitFigure.child * children);
      } else {
        /* An entrance fee with no child column priced is one the property does
           not split by age, so every head pays the visitor figure - exactly as
           it did before the column existed. */
        const childFigure = surchargeChildAmount(rate, item);
        perRepeat = childFigure === null
          ? unitFigure.adult * Math.max(1, parseInt(paxCount, 10) || 0)
          : (unitFigure.adult * adults) + (childFigure * children);
      }
      break;
  }

  const guideFigure = isPorterage ? null : surchargeGuideAmount(rate, item);
  const guideHead = guideFigure === null ? adultHead : guideFigure;
  if (!isPorterage && guides > 0 && guideHead) perRepeat += guideHead * guides;

  return {
    unitBasis,
    repeats,
    perRepeat,
    total: perRepeat * repeats
  };
};

/**
 * The sell figure for a surcharge line.
 *
 * Chargeable: the supplier's price carries the tenant's markup, like any other
 * bought service. Not chargeable: the figure is passed through exactly as the
 * supplier quoted it - no markup, so nothing is added to the itinerary total
 * even though the line is still shown.
 */
export const surchargePricing = ({ buyTotal, markupPercent = 0, chargeable = true } = {}) => {
  const buy = parseFloat(buyTotal) || 0;
  if (!chargeable) {
    /* A passed-through fee carries no money, but its supplier figure has to stay
       on the line so the operator can still see what the property told them.
       Dropping it here is what made a "not chargeable" fee print as a blank
       line with no explanation. */
    return { buy: 0, sell: 0, markup: 0, passedThrough: true, reference: buy };
  }
  const markup = Math.max(0, parseFloat(markupPercent) || 0);
  const sell = buy * (1 + markup / 100);
  return { buy, sell, markup, passedThrough: false, reference: buy };
};

/* One-line summary used in toasts. */
export const surchargeRepeatSummary = ({ item, nights = 1, repeats } = {}) => {
  const n = repeats === undefined ? surchargeRepeats({ item, nights }) : repeats;
  if (n <= 1) return '';
  return `repeated ${n}x`;
};
