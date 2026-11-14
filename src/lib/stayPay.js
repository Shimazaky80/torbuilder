/* Stay X Pay Y accommodation promotions.
 *
 * A stay-pay offer is not a charge type and not a night band: it changes WHICH
 * room-nights are billed, not what a night costs. "Stay 7, pay 5" leaves five
 * nights charged at their contracted figure and waives the other two in full -
 * sharing, single supplement and child figures alike - because the builder
 * stamps the whole night, not one component of its price.
 *
 * The rules that are not obvious:
 *
 *  - Scope. A rule names the room keys it applies to. An empty list means every
 *    room at the property, which is how most suppliers sell the offer.
 *
 *  - Validity. The CHECK-IN date must fall inside the rule's window. A stay that
 *    checks in before the offer starts is not entitled to it, even if some of
 *    its nights fall inside the window.
 *
 *  - Cycles. stayNights/payNights describe one cycle. With repeat on, every full
 *    cycle in a longer stay earns its free nights; with repeat off only the
 *    first cycle does. A partial last cycle never earns a free night, because
 *    the guest has not completed the qualifying stay.
 *
 *  - Which nights. 'cheapest' waives the lowest-value nights in the cycle (the
 *    default and the safest for the buyer), 'last' waives the final nights, and
 *    'every_nth' spreads the free nights evenly through the cycle.
 *
 *  - No stacking. A stay may satisfy several rules; only the one with the
 *    biggest saving is applied, so two promotions can never both waive a night.
 *
 * Linked Fees & Tickets lines (park fee, levy, porterage) are separate services
 * and are still charged on a free night - the promotion waives the room only.
 */

const isoDate = (value) => String(value || '').slice(0, 10);

const whole = (value, fallback = 0) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const money = (value) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isISODate = (value) => {
  const date = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
};

export const STAY_PAY_FREE_NIGHT_RULES = [
  { id: 'cheapest', label: 'Cheapest nights' },
  { id: 'last', label: 'Last nights of the stay' },
  { id: 'every_nth', label: 'Spread through the stay' }
];

export const stayPayPromotionId = () =>
  `sp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const emptyStayPayPromotion = () => ({
  id: stayPayPromotionId(),
  name: '',
  roomKeys: [],
  validFrom: '',
  validTo: '',
  stayNights: 7,
  payNights: 5,
  repeat: true,
  freeNightRule: 'cheapest',
  maxFreeNights: 0,
  active: true
});

export const normalizeStayPayPromotion = (rule = {}) => {
  const stayNights = Math.max(1, whole(rule.stayNights, 7));
  const payNights = Math.min(stayNights - 1, Math.max(0, whole(rule.payNights, Math.max(0, stayNights - 1))));
  const freeNightRule = STAY_PAY_FREE_NIGHT_RULES.some((entry) => entry.id === rule.freeNightRule)
    ? rule.freeNightRule
    : 'cheapest';
  return {
    id: String(rule.id || stayPayPromotionId()),
    name: String(rule.name || '').trim(),
    roomKeys: Array.isArray(rule.roomKeys)
      ? [...new Set(rule.roomKeys.map((key) => String(key || '')).filter(Boolean))]
      : [],
    validFrom: isoDate(rule.validFrom),
    validTo: isoDate(rule.validTo),
    stayNights,
    payNights,
    repeat: rule.repeat !== false,
    freeNightRule,
    maxFreeNights: Math.max(0, whole(rule.maxFreeNights, 0)),
    active: rule.active !== false
  };
};

/* The stored column is JSONB, but a value can still arrive as a JSON string
 * from a caller that read it through a text path. Both shapes normalize to the
 * same array, and anything malformed reads as "no promotions". */
export const normalizeStayPayPromotions = (raw) => {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter((rule) => rule && typeof rule === 'object')
    .map((rule) => normalizeStayPayPromotion(rule));
};

/* Why a rule cannot be saved, or '' when it is complete. The editor refuses an
 * offer that could never waive a night rather than storing a promise the
 * builders cannot keep. */
export const stayPayPromotionError = (rule) => {
  const normalized = normalizeStayPayPromotion(rule);
  const label = normalized.name || 'Stay-pay promotion';
  const rawStayNights = whole(rule?.stayNights, NaN);
  const rawPayNights = whole(rule?.payNights, NaN);
  if (!normalized.name) return 'give the promotion a name so the itinerary can say which offer was applied';
  if (!Number.isFinite(rawStayNights) || rawStayNights < 2) {
    return `"${label}": stay nights must be at least two`;
  }
  if (!Number.isFinite(rawPayNights) || rawPayNights < 1) {
    return `"${label}": pay nights must be at least one`;
  }
  if (rawPayNights >= rawStayNights) {
    return `"${label}": pay nights must be fewer than stay nights, otherwise no night is free`;
  }
  for (const [field, value] of [['valid from', rule?.validFrom], ['valid to', rule?.validTo]]) {
    if (value && !isISODate(value)) {
      return `"${label}": ${field} must be a valid calendar date`;
    }
  }
  if (normalized.validFrom && normalized.validTo && normalized.validFrom > normalized.validTo) {
    return `"${label}": valid to is before valid from, so no check-in can ever fall inside the offer`;
  }
  return '';
};

export const stayPayPromotionsOverlapError = (rules = []) => {
  const active = normalizeStayPayPromotions(rules).filter((rule) => rule.active);
  for (let firstIndex = 0; firstIndex < active.length; firstIndex += 1) {
    const first = active[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < active.length; secondIndex += 1) {
      const second = active[secondIndex];
      const roomScopesOverlap = !first.roomKeys.length
        || !second.roomKeys.length
        || first.roomKeys.some((key) => second.roomKeys.includes(key));
      const dateWindowsOverlap = (!first.validTo || !second.validFrom || first.validTo >= second.validFrom)
        && (!second.validTo || !first.validFrom || second.validTo >= first.validFrom);
      if (roomScopesOverlap && dateWindowsOverlap) {
        return `"${first.name || 'Stay-pay promotion'}" and "${second.name || 'Stay-pay promotion'}" overlap for at least one room and check-in date; adjust the room scope or validity window, or deactivate one`;
      }
    }
  }
  return '';
};

export const stayPayPromotionsError = (rules = []) => {
  let entries = rules;
  if (typeof entries === 'string') {
    try {
      entries = JSON.parse(entries);
    } catch {
      return '';
    }
  }
  if (!Array.isArray(entries)) return '';
  for (const rule of entries) {
    const error = stayPayPromotionError(rule);
    if (error) return error;
  }
  return stayPayPromotionsOverlapError(entries);
};

export const stayPayRuleScopeLabel = (rule, rooms = []) => {
  const keys = Array.isArray(rule?.roomKeys) ? rule.roomKeys.filter(Boolean) : [];
  if (!keys.length) return 'All rooms';
  const names = keys.map((key) => {
    const room = (Array.isArray(rooms) ? rooms : []).find(
      (entry) => String(entry.key || '') === String(key) || String(entry.id || '') === String(key)
    );
    return room?.name || key;
  });
  return names.join(', ');
};

export const stayPayRuleSummary = (rule) => {
  const normalized = normalizeStayPayPromotion(rule);
  const free = normalized.stayNights - normalized.payNights;
  const cycle = `Stay ${normalized.stayNights}, pay ${normalized.payNights}`;
  const freeLabel = free === 1 ? '1 free night' : `${free} free nights`;
  const nightSelection = normalized.freeNightRule === 'last'
    ? `the last ${free} night${free === 1 ? '' : 's'}`
    : normalized.freeNightRule === 'every_nth'
      ? `${free} night${free === 1 ? '' : 's'} spread through the stay`
      : `the ${free} cheapest night${free === 1 ? '' : 's'}`;
  const preview = `A ${normalized.stayNights}-night stay pays ${normalized.payNights} nights; ${nightSelection} are free.`;
  const repeat = normalized.repeat ? 'repeats every cycle' : 'first cycle only';
  const window = normalized.validFrom || normalized.validTo
    ? `${normalized.validFrom || 'open'} to ${normalized.validTo || 'open'}`
    : 'no validity window';
  return `${preview} ${cycle} (${freeLabel}) \u00b7 ${repeat} \u00b7 ${window}`;
};

/* Whether a rule is entitled to this stay. The check-in date is the stay's
 * first night; an undated stay (a package without dates) can only use an offer
 * with no validity window, because there is no check-in to test. */
export const stayPayPromotionApplies = (rule, { roomKey = '', checkInDate = '' } = {}) => {
  const normalized = normalizeStayPayPromotion(rule);
  if (!normalized.active) return false;
  const keys = normalized.roomKeys;
  if (keys.length && !keys.some((key) => String(key) === String(roomKey || ''))) return false;
  const date = isoDate(checkInDate);
  if (!date) return !normalized.validFrom && !normalized.validTo;
  if (normalized.validFrom && date < normalized.validFrom) return false;
  if (normalized.validTo && date > normalized.validTo) return false;
  return true;
};

/* The free-night positions inside one full cycle. `values` is the money each
 * night is worth, used by the cheapest rule and to score a saving. */
const freePositionsInCycle = ({ values, freeCount, freeNightRule }) => {
  const count = values.length;
  if (count <= 0 || freeCount <= 0) return [];
  const wanted = Math.min(freeCount, count);
  const indexes = Array.from({ length: count }, (_, index) => index);
  if (freeNightRule === 'last') return indexes.slice(count - wanted);
  if (freeNightRule === 'every_nth') {
    const positions = [];
    for (let i = 1; i <= wanted; i += 1) {
      const position = Math.min(count - 1, Math.max(0, Math.round((i * count) / (wanted + 1))));
      if (!positions.includes(position)) positions.push(position);
    }
    /* Rounding can collide on a very short cycle; fill the gaps from the end so
       the rule still waives exactly the number of nights it promised. */
    for (let index = count - 1; positions.length < wanted && index >= 0; index -= 1) {
      if (!positions.includes(index)) positions.push(index);
    }
    return positions;
  }
  return indexes
    .slice()
    .sort((a, b) => (money(values[a]) - money(values[b])) || (a - b))
    .slice(0, wanted);
};

/* Which indexes of `values` are free, given one rule. The caller has already
 * decided the rule is entitled to the stay. */
export const stayPayFreeNightIndexes = ({
  values = [],
  stayNights = 7,
  payNights = 5,
  repeat = true,
  freeNightRule = 'cheapest',
  maxFreeNights = 0
} = {}) => {
  const list = Array.isArray(values) ? values.map(money) : [];
  const stay = Math.max(1, whole(stayNights, 7));
  const pay = Math.min(stay - 1, Math.max(0, whole(payNights, Math.max(0, stay - 1))));
  const freePerCycle = Math.max(0, stay - pay);
  const cap = Math.max(0, whole(maxFreeNights, 0));
  const candidates = [];
  const cycles = repeat ? Math.floor(list.length / stay) : Math.min(1, Math.floor(list.length / stay));
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const start = cycle * stay;
    const slice = list.slice(start, start + stay);
    freePositionsInCycle({ values: slice, freeCount: freePerCycle, freeNightRule })
      .forEach((position) => candidates.push(start + position));
  }
  if (!candidates.length) return new Set();
  /* A cap is the supplier's promise never to give away more than N nights. Keep
     the most valuable qualifying nights, because that is the saving the guest
     was offered. */
  const chosen = cap > 0 && candidates.length > cap
    ? candidates
      .slice()
      .sort((a, b) => (money(list[b]) - money(list[a])) || (a - b))
      .slice(0, cap)
    : candidates;
  return new Set(chosen);
};

const addDays = (iso, n) => {
  const [y, m, d] = isoDate(iso).split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

const isConsecutive = (a, b) => !!a && !!b && addDays(a, 1) === b;

/* Split dated nights into stays that are actually consecutive. Two bookings at
 * the same property separated by a gap are two stays, each with its own
 * check-in and its own qualifying cycle. */
const consecutiveRuns = (dates) => {
  const runs = [];
  let current = [];
  dates.forEach((date) => {
    if (!current.length || isConsecutive(current[current.length - 1], date)) {
      current.push(date);
    } else {
      runs.push(current);
      current = [date];
    }
  });
  if (current.length) runs.push(current);
  return runs;
};

/**
 * Work out which nights of a stay a promotion waives.
 *
 * `nights` is [{ date, value }] where value is the money the room-night is
 * worth. Duplicate dates are summed into one night, because two lines on the
 * same date are one room-night to the guest. The return value names the rule
 * that won and the set of free positions in the ORIGINAL array, so callers can
 * stamp each line without rebuilding their day structure.
 */
export const planStayPay = ({
  nights = [],
  promotions = [],
  roomKey = '',
  checkInDate = ''
} = {}) => {
  const entries = (Array.isArray(nights) ? nights : [])
    .map((night, index) => ({
      index,
      date: isoDate(night?.date),
      value: money(night?.value)
    }))
    .filter((night) => night.date);
  if (!entries.length) return { freeIndexes: new Set(), rule: null, saving: 0, freeDates: new Set() };

  const byDate = new Map();
  entries.forEach((entry) => {
    byDate.set(entry.date, (byDate.get(entry.date) || 0) + entry.value);
  });
  const dates = [...byDate.keys()].sort();
  const promotionsInScope = normalizeStayPayPromotions(promotions);

  if (!promotionsInScope.length) return { freeIndexes: new Set(), rule: null, saving: 0, freeDates: new Set() };

  /* Each consecutive run is its own stay, so each earns its own free nights. A
     gap in the dates must not throw away the nights the earlier stay qualified
     for, which is why the runs are collected rather than compared: only the
     rules WITHIN a run compete for the bigger saving. Entitlement is tested
     against the run's own check-in, so a second stay that checks in after the
     offer closes does not inherit the first stay's free nights. */
  let saving = 0;
  let bestRule = null;
  let bestRunSaving = -1;
  const freeDates = new Set();
  const ruleByDate = new Map();
  consecutiveRuns(dates).forEach((run, runIndex) => {
    const runCheckIn = runIndex === 0 && checkInDate ? checkInDate : run[0];
    const rules = promotionsInScope.filter((rule) => stayPayPromotionApplies(rule, {
      roomKey,
      checkInDate: runCheckIn
    }));
    if (!rules.length) return;
    const values = run.map((date) => byDate.get(date) || 0);
    let runBest = null;
    rules.forEach((rule) => {
      const indexes = stayPayFreeNightIndexes({
        values,
        stayNights: rule.stayNights,
        payNights: rule.payNights,
        repeat: rule.repeat,
        freeNightRule: rule.freeNightRule,
        maxFreeNights: rule.maxFreeNights
      });
      if (!indexes.size) return;
      const runSaving = [...indexes].reduce((total, index) => total + money(values[index]), 0);
      if (!runBest || runSaving > runBest.saving) {
        runBest = { rule, saving: runSaving, indexes };
      }
    });
    if (!runBest) return;
    saving += runBest.saving;
    runBest.indexes.forEach((index) => {
      freeDates.add(run[index]);
      ruleByDate.set(run[index], runBest.rule);
    });
    if (runBest.saving > bestRunSaving) {
      bestRunSaving = runBest.saving;
      bestRule = runBest.rule;
    }
  });

  if (!bestRule) return { freeIndexes: new Set(), rule: null, saving: 0, freeDates: new Set() };
  const freeIndexes = new Set(
    entries.filter((entry) => freeDates.has(entry.date)).map((entry) => entry.index)
  );
  return { freeIndexes, rule: bestRule, ruleByDate, saving, freeDates };
};

/* The room key a builder line was sold as. Promotions are stored against the
 * library room's own key, while a line carries the room's database id (and its
 * name for display), so the line has to be translated back before a scoped rule
 * can match it. */
export const roomKeyForService = (service = {}, item = {}) => {
  const rooms = Array.isArray(item.roomTypes)
    ? item.roomTypes
    : (Array.isArray(item.room_types) ? item.room_types : []);
  const id = service.roomTypeId || service.room_type_id || '';
  const name = String(service.roomType || service.room_type || '').trim().toLowerCase();
  const byId = rooms.find((room) => id && (
    String(room.id || '') === String(id) || String(room.key || '') === String(id)
  ));
  if (byId) return String(byId.key || byId.id || '');
  const byName = rooms.find((room) => name && String(room.name || '').trim().toLowerCase() === name);
  if (byName) return String(byName.key || byName.id || '');
  return String(id || '');
};

/* A crew bed or an alternative is not a client room-night, so it neither earns
 * nor consumes a free night. */
export const stayPayExcludedService = (service = {}) => (
  service.isOptional === true
  || service.is_included === false
  || service.guideOnly === true
  || service.guide_only === true
  || !!service.guideForKey
  || !!service.guide_for_item_key
);
