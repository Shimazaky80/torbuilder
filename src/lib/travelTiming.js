/* Travel timing.
 *
 * An itinerary has one pricing window. Until now that window was always a pair
 * of exact dates. A quotation can also be requested for "travels in November
 * 2026", where the whole month is the window: the client can depart on any day
 * in it, and the season that prices the line has to cover the whole month to be
 * an exact match.
 *
 * The window bounds live in travel_start_date / travel_end_date (first day of
 * the first month to last day of the last month) so every existing consumer -
 * list filters, season resolution, protection, finance - keeps working on real
 * bounds. travel_date_precision says what those bounds mean:
 *
 *   exact  confirmed travel dates; day rows carry day_date
 *   month  requested month(s); day rows carry no date and duration_days says
 *          how many days the tour runs
 *
 * Nothing in this file turns a month window into a specific departure date.
 */

export const PRECISION_EXACT = 'exact';
export const PRECISION_MONTH = 'month';

const pick = (source, ...keys) => {
  if (!source) return undefined;
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
};

const isoDay = (value) => {
  const s = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
};

const parseMonth = (value) => {
  const s = String(value || '').slice(0, 7);
  const m = s.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!year || month < 1 || month > 12) return null;
  return { year, month };
};

export const isMonthTiming = (source) => (
  pick(source, 'travelDatePrecision', 'travel_date_precision') === PRECISION_MONTH
);

export const monthOf = (value) => {
  const day = isoDay(value);
  if (!day) {
    const raw = String(value || '').slice(0, 7);
    return parseMonth(raw) ? raw : '';
  }
  return day.slice(0, 7);
};

export const monthStartIso = (month) => {
  const parsed = parseMonth(month);
  return parsed ? `${parsed.year}-${String(parsed.month).padStart(2, '0')}-01` : '';
};

export const monthEndIso = (month) => {
  const parsed = parseMonth(month);
  if (!parsed) return '';
  const last = new Date(Date.UTC(parsed.year, parsed.month, 0)).getUTCDate();
  return `${parsed.year}-${String(parsed.month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
};

/* First day of the first month to last day of the last month. */
export const monthWindow = (fromMonth, toMonth) => {
  const from = monthStartIso(fromMonth);
  const to = monthEndIso(toMonth || fromMonth);
  if (!from || !to || to < from) return { start: '', end: '' };
  return { start: from, end: to };
};

export const daysInMonthRange = (fromMonth, toMonth) => {
  const { start, end } = monthWindow(fromMonth, toMonth);
  if (!start || !end) return 0;
  return daysBetween(start, end) + 1;
};

export const daysBetween = (start, end) => {
  const a = isoDay(start);
  const b = isoDay(end);
  if (!a || !b) return 0;
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const diff = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.max(0, Math.round(diff / 86400000));
};

const shortDate = (value) => {
  const day = isoDay(value);
  if (!day) return '';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  });
};

const monthName = (month, { withYear = true } = {}) => {
  const parsed = parseMonth(month);
  if (!parsed) return '';
  return new Date(Date.UTC(parsed.year, parsed.month - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC'
  });
};

/* "November 2026", "November – December 2026", "November 2026 – January 2027". */
export const monthRangeLabel = (fromMonth, toMonth) => {
  const from = monthOf(fromMonth);
  const to = monthOf(toMonth || fromMonth);
  if (!from) return '';
  if (!to || to === from) return monthName(from);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${monthName(from, { withYear: !sameYear })} – ${monthName(to)}`;
};

export const travelTiming = (source) => {
  const precision = isMonthTiming(source) ? PRECISION_MONTH : PRECISION_EXACT;
  const start = isoDay(pick(source, 'travelStart', 'travel_start_date')) || '';
  const end = isoDay(pick(source, 'travelEnd', 'travel_end_date')) || start;
  const monthFrom = precision === PRECISION_MONTH ? monthOf(start) : '';
  const monthTo = precision === PRECISION_MONTH ? monthOf(end || start) : '';
  const storedDuration = Number(pick(source, 'durationDays', 'duration_days')) || 0;
  const durationDays = precision === PRECISION_MONTH
    ? storedDuration
    : (start ? daysBetween(start, end) + 1 : 0);
  const monthLabel = precision === PRECISION_MONTH ? monthRangeLabel(monthFrom, monthTo) : '';
  const datesLabel = precision === PRECISION_MONTH
    ? `${monthLabel || 'Month not set'} (dates to be confirmed)`
    : (start ? `${shortDate(start)} → ${shortDate(end || start)}` : 'Dates not set');
  const daysLabel = precision === PRECISION_MONTH && durationDays > 0
    ? ` · ${durationDays} day${durationDays === 1 ? '' : 's'}`
    : '';
  return {
    precision,
    start,
    end,
    monthFrom,
    monthTo,
    durationDays,
    monthLabel,
    datesLabel,
    dayCount: durationDays,
    label: `${datesLabel}${daysLabel}`
  };
};

/* The window the season engine prices against. Both modes read the stored
 * bounds; the precision only changes how those bounds are displayed and
 * whether day rows may derive dates from them. */
export const travelWindowFor = (source) => {
  const timing = travelTiming(source);
  return { start: timing.start, end: timing.end };
};

export const travelTimingLabel = (source) => travelTiming(source).label;

export const monthTimingError = ({ monthFrom = '', monthTo = '', durationDays = 0 } = {}) => {
  if (!monthFrom || !monthTo) return 'Select the travel month(s)';
  if (!parseMonth(monthFrom) || !parseMonth(monthTo)) return 'Choose a valid month';
  if (monthTo < monthFrom) return 'The last travel month cannot be before the first';
  const duration = Number(durationDays);
  if (!Number.isFinite(duration) || duration < 1) return 'Enter how many days the tour runs';
  const available = daysInMonthRange(monthFrom, monthTo);
  if (available > 0 && duration > available) {
    return `A ${duration}-day tour does not fit in ${monthRangeLabel(monthFrom, monthTo)} (${available} days)`;
  }
  return '';
};
