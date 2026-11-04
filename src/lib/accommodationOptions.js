import { rateHasPrice, rateTravelCoverage, rateWindow } from './priceValidity';
import { isOccupancyTiered } from './occupancyPricing';
import { ratesForRoom, roomsFromRates, roomTypesOf } from './roomTypes';

/* Accommodation charge options.
 *
 * One accommodation library item can carry more than one charge type (board
 * basis): bed & breakfast, half board, full board with activities, and so on.
 * A charge type belongs to a SEASON, not the other way round: one negotiated
 * season is priced at several board basics, each at its own rate. The tier is
 * stored on the item_rates row as the meal_plan (the same column that has
 * always held the board basis) and the season is stated as the season_name and
 * the valid_from / valid_to window, so a row is read as "this season at this
 * charge type". Rows created before this feature all share the item's single
 * board, so they read back as one option and behave exactly as they used to.
 *
 * On a drop the operator picks the season AND, within it, the charge type. The
 * chosen row's id is then pinned so the line is priced from exactly that figure
 * rather than whatever row the database returned first. */

export const rateOptionLabel = (rate, item) => {
  const label = rate?.meal_plan || rate?.option_name || item?.mealPlan || item?.meal_plan || '';
  return String(label || '').trim();
};

const intOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

/* Hotels contract the same room at a different nightly figure depending on the
   length of the stay - 1-3 nights at one price, 4+ at another. The band lives on
   the rate row beside the charge type so one room stays one library item with
   one season, instead of the room being loaded several times. A row with neither
   bound prices every stay, which is how every older row still reads. */
export const nightBandOf = (rate) => {
  const min = intOrNull(rate?.min_nights);
  const max = intOrNull(rate?.max_nights);
  const low = min === null ? 1 : Math.max(1, min);
  const high = max === null ? null : Math.max(low, max);
  return { min: low, max: high, banded: min !== null || max !== null };
};

export const nightBandLabel = (rate) => {
  const { min, max, banded } = nightBandOf(rate);
  if (!banded) return '';
  if (max === null) return `${min}+ nights`;
  if (max <= min) return min === 1 ? '1 night' : `${min} nights`;
  return `${min}\u2013${max} nights`;
};

export const rateCoversNights = (rate, nights) => {
  const count = Math.floor(Number(nights) || 0);
  if (count < 1) return false;
  const { min, max } = nightBandOf(rate);
  return count >= min && (max === null || count <= max);
};

/* The rows that describe the same thing as `rate` apart from the night band:
   same currency, same season window and same charge type. Bands are only
   compared inside a family, because a half-board row never prices a B&B stay. */
export const sameRateFamily = (a, b) => {
  const wa = rateWindow(a);
  const wb = rateWindow(b);
  return String(a?.currency || '').toUpperCase() === String(b?.currency || '').toUpperCase()
    && (a?.season_name || a?.option_name || '') === (b?.season_name || b?.option_name || '')
    && wa.fromIso === wb.fromIso
    && wa.toIso === wb.toIso
    && rateOptionLabel(a) === rateOptionLabel(b);
};

/* The rate that actually prices a stay of `nights` in the same family as the
   chosen row. Returns the chosen row when no sibling band covers the stay, so a
   bandless contract is never re-priced. */
export const rateForNights = (rates, rate, nights) => {
  if (!rate) return rate;
  const family = (Array.isArray(rates) ? rates : []).filter((row) => sameRateFamily(row, rate));
  if (!family.length) return rate;
  return family.find((row) => rateCoversNights(row, nights)) || rate;
};

/* Which nights count as weekend is part of the supplier contract - Friday and
   Saturday for most properties, Thursday to Saturday for others, a single night
   for some. The operator picks them per room type; nothing is assumed. Days are
   ISO weekdays (1 = Monday ... 7 = Sunday) so the stored value is locale-free. */
export const WEEKEND_DAY_OPTIONS = [
  { value: 1, short: 'Mon', label: 'Monday' },
  { value: 2, short: 'Tue', label: 'Tuesday' },
  { value: 3, short: 'Wed', label: 'Wednesday' },
  { value: 4, short: 'Thu', label: 'Thursday' },
  { value: 5, short: 'Fri', label: 'Friday' },
  { value: 6, short: 'Sat', label: 'Saturday' },
  { value: 7, short: 'Sun', label: 'Sunday' }
];

export const weekendDaysOf = (rate) => {
  const raw = Array.isArray(rate?.weekend_days) ? rate.weekend_days : [];
  const days = raw
    .map((value) => parseInt(value, 10))
    .filter((value) => value >= 1 && value <= 7);
  return [...new Set(days)].sort((a, b) => a - b);
};

export const weekendPriceOf = (rate) => {
  const value = parseFloat(rate?.weekend_price);
  return Number.isFinite(value) ? value : null;
};

export const weekendDaysLabel = (rate) => weekendDaysOf(rate)
  .map((value) => (WEEKEND_DAY_OPTIONS.find((day) => day.value === value) || {}).short || '')
  .filter(Boolean)
  .join(', ');

const isoWeekdayOf = (iso) => {
  const match = String(iso ?? '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return 0;
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
  return day === 0 ? 7 : day;
};

export const weekendNightOf = (rate, isoDate) => {
  const days = weekendDaysOf(rate);
  if (!days.length || weekendPriceOf(rate) === null) return false;
  return days.includes(isoWeekdayOf(isoDate));
};

const sameFigure = (a, b) => {
  const left = parseFloat(a);
  const right = parseFloat(b);
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 0.005;
};

/* The row as it prices ONE night: on a weekend night the normal nightly figure
   is replaced by the weekend price. It is still the same row, season and charge
   type - only the date decides - so the returned copy keeps every other column
   (supplements, tiers, guide rates) exactly as contracted. A distinct single
   room rate is left alone: the weekend price is the shared room's figure, and a
   property that quoted a separate single price did not quote a weekend one. */
export const rateForNight = (rate, isoDate) => {
  if (!rate || !weekendNightOf(rate, isoDate)) return rate;
  /* A villa on an occupancy ladder has no single nightly figure to swap: each
     band is the contract for that party size and the supplier quotes the ladder,
     not a weekend column. The editor keeps the weekend field off these rows. */
  if (isOccupancyTiered(rate)) return rate;
  const price = weekendPriceOf(rate);
  const flat = String(rate.rate_basis || '') === 'per_room';
  const standard = parseFloat(flat ? rate.unit_price : rate.price_2_adults)
    || parseFloat(rate.unit_price) || 0;
  const single = parseFloat(rate.single_room_rate)
    || parseFloat(rate.effective_single_rate) || parseFloat(rate.price_1_adult) || 0;
  const separateSingle = single > 0 && !sameFigure(single, standard);
  const out = {
    ...rate,
    weekend_night: true,
    unit_price: price,
    price_2_adults: price,
    double_twin_rate: price
  };
  if (!separateSingle) {
    out.price_1_adult = price;
    out.single_room_rate = price;
    out.effective_single_rate = price;
  }
  const extraAdult = parseFloat(rate.price_3_plus_adults);
  if (!(extraAdult > 0) || sameFigure(extraAdult, standard)) out.price_3_plus_adults = price;
  return out;
};

/* Group rate rows into charge types, keeping first-seen order so the library
   editor's option order is the order the operator sees on a drop. */
export const accommodationOptionGroups = (rates) => {
  const rows = Array.isArray(rates) ? rates : [];
  const order = [];
  const byLabel = new Map();
  rows.forEach((rate) => {
    const label = rateOptionLabel(rate) || 'Standard';
    if (!byLabel.has(label)) {
      byLabel.set(label, []);
      order.push(label);
    }
    byLabel.get(label).push(rate);
  });
  return order.map((label) => ({ label, rates: byLabel.get(label) }));
};

const seasonNameOf = (rate) => rate?.season_name || rate?.option_name || 'Base Season';

/* Two rows describe the same season when they carry the same name and the same
   window, so that identity groups every charge type of that season together. */
export const seasonKeyOfRate = (rate) => {
  const window = rateWindow(rate);
  return `${seasonNameOf(rate)}|${window.fromIso}|${window.toIso}`;
};

/* Rate rows grouped SEASON-first: one group per season, each holding every
   charge type priced for that season. This is the shape the library editor and
   the drop dialog both work in — "one season, several charge types".

   A property can sell several room types. Passing a room scopes the grouping to
   that room's rows, so a season never mixes a standard room with a suite. */
export const accommodationSeasonGroups = (item, room = null) => {
  const rows = ratesForRoom(item?.item_rates, room);
  const order = [];
  const byKey = new Map();
  rows.forEach((rate) => {
    const key = seasonKeyOfRate(rate);
    if (!byKey.has(key)) {
      const window = rateWindow(rate);
      byKey.set(key, {
        name: seasonNameOf(rate),
        validFrom: window.fromIso,
        validTo: window.toIso,
        options: []
      });
      order.push(key);
    }
    const group = byKey.get(key);
    const label = rateOptionLabel(rate) || 'Standard';
    let option = group.options.find((entry) => entry.label === label);
    if (!option) {
      option = { label, rateId: rate.id, hasPrice: false, banded: false, bands: [] };
      group.options.push(option);
    }
    const { min, max, banded } = nightBandOf(rate);
    const bandKey = `${min}|${max}`;
    const existing = option.bands.find((entry) => entry.key === bandKey);
    if (existing) {
      /* Two rows for the same band are the same ladder; keep the priced one so
         a stray empty duplicate cannot hide the figure. */
      if (!existing.hasPrice && rateHasPrice(rate)) {
        existing.rateId = rate.id;
        existing.hasPrice = true;
      }
      return;
    }
    option.bands.push({
      key: bandKey,
      rateId: rate.id,
      label: nightBandLabel(rate),
      min,
      max,
      banded,
      hasPrice: rateHasPrice(rate)
    });
  });
  order.forEach((key) => {
    byKey.get(key).options.forEach((option) => {
      option.bands.sort((a, b) => (a.min - b.min) || ((a.max ?? Infinity) - (b.max ?? Infinity)));
      const representative = option.bands.find((band) => !band.banded && band.hasPrice)
        || option.bands.find((band) => band.hasPrice)
        || option.bands[0];
      option.rateId = representative.rateId;
      option.hasPrice = option.bands.some((band) => band.hasPrice);
      option.banded = option.bands.some((band) => band.banded);
    });
  });
  return order.map((key) => byKey.get(key));
};

/* Every season with its charge types, the shape the drop dialog renders: the
   season (name + window) is the outer choice and each charge type inside it
   carries the row id, whether it is priced, and its night bands. */
export const accommodationSeasonChoices = (item, room = null) => accommodationSeasonGroups(item, room);

/* The rooms a drop has to choose from. `item.roomTypes` is authoritative when
   the property has been loaded; otherwise the room copies on the rate rows let
   a package or partner view offer the same choice. */
export const accommodationRoomChoices = (item) => {
  const rooms = roomTypesOf(item);
  return rooms.length ? rooms : roomsFromRates(item?.item_rates);
};

/* True when a drop has something to ask about: more than one room, more than one
   season, a season offering more than one charge type, or a charge type priced at
   more than one night band. A one-room, one-season, one-option, one-band item
   keeps adding straight away, exactly as before. */
export const accommodationHasChoices = (item) => {
  const rooms = accommodationRoomChoices(item);
  if (rooms.length > 1) return true;
  const groups = accommodationSeasonGroups(item, rooms[0] || null);
  return groups.length > 1 || groups.some((group) => (
    group.options.length > 1 || group.options.some((option) => option.bands.length > 1)
  ));
};

export const formatSeasonDate = (iso) => {
  const s = String(iso || '').slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : (s || 'open');
};

/* "[Season name]: 2027/04/01-2027/08/31", the label (D) asks a drop to show so
   the operator can pick the season against the travel dates. */
export const seasonChoiceLabel = (season) => {
  const from = season.validFrom ? formatSeasonDate(season.validFrom) : 'open';
  const to = season.validTo ? formatSeasonDate(season.validTo) : 'open';
  return `${season.name || 'Season'}: ${from}-${to}`;
};

/* How a pinned row's window reads against the travel dates, in the words the
   drop dialog and the line badge use. */
export const coverageNote = (coverage) => {
  const from = formatSeasonDate(coverage?.validFrom);
  const to = formatSeasonDate(coverage?.validTo);
  switch (coverage?.status) {
    case 'covers':
      return 'matches the travel dates';
    case 'starts_after':
      return `starts after the trip (${from})`;
    case 'ends_before':
      return `ended before the trip (${to})`;
    case 'starts_during':
      return `starts during the trip (${from})`;
    case 'ends_during':
      return `ends during the trip (${to})`;
    case 'undated':
      return 'has no validity dates';
    default:
      return 'travel dates not set';
  }
};

/* The statuses that mean a pinned row does not price the trip exactly. They can
   still be used, but only with the operator's consent, and never with Pricing
   Protection - a future or expired season is not a substitute for the real one. */
export const ESTIMATE_COVERAGE = ['starts_after', 'ends_before', 'starts_during', 'ends_during'];

/* The season object resolveSeasonForTravel() would have returned for one pinned
   row, so a caller that already knows which row it wants can reuse the same
   downstream shape. A pinned row is the operator's explicit choice, so it is
   always taken as-is when the travel dates are unknown; when they are known the
   row is checked and a non-covering window becomes an estimate that can only be
   added with allowEstimate. */
export const seasonForRate = (rate, { startDate = '', endDate = '', allowEstimate = false } = {}) => {
  const window = rateWindow(rate);
  const priced = rateHasPrice(rate);
  const coverage = rateTravelCoverage(rate, startDate, endDate);
  const base = {
    rate,
    window,
    coverage,
    protectionPercent: 0,
    seasonName: seasonNameOf(rate),
    validFrom: window.fromIso,
    validTo: window.toIso,
    staleByYears: 0,
    reason: ''
  };

  if (coverage.status === 'open' || coverage.status === 'covers') {
    return { ...base, status: 'ok', canAdd: priced };
  }
  if (coverage.status === 'undated') {
    return {
      ...base,
      status: 'undated',
      canAdd: priced,
      reason: 'This price has no validity dates in the library, so it could not be checked against the travel dates.'
    };
  }

  const future = coverage.status === 'starts_after';
  const expired = coverage.status === 'ends_before';
  const status = future ? 'future' : expired ? 'expired' : 'partial';
  return {
    ...base,
    status,
    canAdd: allowEstimate && priced,
    reason: future
      ? `The ${base.seasonName} season starts ${formatSeasonDate(coverage.validFrom)}, after the travel dates. Using it prices the line as a pre-season estimate.`
      : expired
        ? `The ${base.seasonName} season ended ${formatSeasonDate(coverage.validTo)}, before the travel dates. Using it prices the line from an expired season without Pricing Protection.`
        : `The ${base.seasonName} season (${formatSeasonDate(coverage.validFrom)}-${formatSeasonDate(coverage.validTo)}) only covers part of the travel dates. Using it prices the line as an estimate.`
  };
};

/* The rows for one option, or the whole matrix when no option is named. Passing
   a room scopes the offer to that room's rows first. */
export const ratesForOption = (item, optionLabel, room = null) => {
  const rows = ratesForRoom(item?.item_rates, room);
  if (!optionLabel) return rows;
  const wanted = String(optionLabel).trim();
  const scoped = rows.filter((rate) => rateOptionLabel(rate, item) === wanted);
  return scoped.length ? scoped : rows;
};

export const rateById = (item, rateId) => (
  (Array.isArray(item?.item_rates) ? item.item_rates : []).find((rate) => rate.id === rateId) || null
);
