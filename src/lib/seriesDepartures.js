/* Series departures: a fixed-date tour sold seat by seat out of a contracted
   allocation, rather than a private trip priced for one party.

   Everything here is pure and works on calendar days. A departure date is a day
   in the tour's own calendar, never an instant: reading 'YYYY-MM-DD' through the
   local Date constructor moves the day for anyone west of UTC, which would
   generate a Sunday departure for a Monday tour. Dates are therefore read and
   written at UTC midnight and formatted back to the same ten characters.

   The seat count is derived from the booking ledger, never stored on the
   departure. Two numbers meaning the same thing drift, and the ledger is the one
   that can be audited. The database refuses an over-sale on its own, so this
   arithmetic is what the operator is shown, not the boundary that holds. */

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/* Monday is 1 and Sunday is 7, the way an operator says "operates Mon/Thu".
   JavaScript's own getDay() starts at Sunday, so it is converted at the edge and
   never stored. */
export const WEEKDAYS = [
  { value: 1, short: 'Mon', label: 'Monday' },
  { value: 2, short: 'Tue', label: 'Tuesday' },
  { value: 3, short: 'Wed', label: 'Wednesday' },
  { value: 4, short: 'Thu', label: 'Thursday' },
  { value: 5, short: 'Fri', label: 'Friday' },
  { value: 6, short: 'Sat', label: 'Saturday' },
  { value: 7, short: 'Sun', label: 'Sunday' }
];

const utcMs = (iso) => {
  const text = String(iso ?? '').slice(0, 10);
  if (!ISO_DATE.test(text)) return null;
  const [year, month, day] = text.split('-').map(Number);
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  /* 2028-02-30 normalises to 1 March. A date that does not survive the round
     trip was never a day and must not quietly become one. */
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
  return ms;
};

export const toISODate = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null);

export const addDays = (iso, days) => {
  const ms = utcMs(iso);
  return ms === null ? null : toISODate(ms + Math.round(Number(days) || 0) * DAY_MS);
};

export const isoWeekday = (iso) => {
  const ms = utcMs(iso);
  return ms === null ? null : ((new Date(ms).getUTCDay() + 6) % 7) + 1;
};

export const weekdayLabel = (value) => WEEKDAYS.find((day) => day.value === Number(value))?.label || '';

export const seriesPackageDepartureMatch = ({
  travelStart,
  travelDatePrecision = 'exact',
  templates = [],
  departures = []
} = {}) => {
  const seriesTemplates = Array.isArray(templates) ? templates : [];
  if (!seriesTemplates.length) return { matches: true, reason: '' };
  const activeTemplates = seriesTemplates.filter((template) => !template.status || template.status === 'active');
  if (!activeTemplates.length) {
    return {
      matches: false,
      reason: 'This package has no active series schedule. Activate a series template or choose a different package.'
    };
  }
  if (travelDatePrecision !== 'exact' || utcMs(travelStart) === null) {
    return {
      matches: false,
      reason: 'Series packages need an exact date for the selected itinerary day. Set exact dates before adding the package.'
    };
  }

  const date = String(travelStart).slice(0, 10);
  const weekday = isoWeekday(date);
  const inWindow = activeTemplates.filter((template) => (
    date >= String(template.valid_from || '').slice(0, 10)
    && date <= String(template.valid_to || '').slice(0, 10)
  ));
  if (!inWindow.length) {
    const windows = activeTemplates
      .map((template) => `${template.valid_from || 'unknown'} to ${template.valid_to || 'unknown'}`)
      .join('; ');
    return {
      matches: false,
      reason: `The date ${date} is outside this series' operating period (${windows}). Choose an operating date or a different package.`
    };
  }

  const onOperatingDay = inWindow.filter((template) => (
    (Array.isArray(template.operates_on) ? template.operates_on : []).map(Number).includes(weekday)
  ));
  if (!onOperatingDay.length) {
    const operatingDays = [...new Set(inWindow.flatMap((template) => (
      (Array.isArray(template.operates_on) ? template.operates_on : []).map(Number)
    )))].map(weekdayLabel).filter(Boolean);
    return {
      matches: false,
      reason: `This series does not operate on ${weekdayLabel(weekday)}. It runs ${operatingDays.join(' and ') || 'on no configured weekdays'}. Choose an operating date or a different package.`
    };
  }

  const sellableStatuses = new Set(['open', 'guaranteed', 'waitlist']);
  const matchingTemplate = onOperatingDay.find((template) => (
    (Array.isArray(departures) ? departures : []).some((departure) => (
      departure.template_id === template.id
      && String(departure.departure_date || '').slice(0, 10) === date
      && sellableStatuses.has(String(departure.status || '').toLowerCase())
    ))
  ));
  if (!matchingTemplate) {
    return {
      matches: false,
      reason: `There is no bookable series departure for ${date}. Generate or reopen that date in Series Departures, or choose a different package.`
    };
  }

  return {
    matches: true,
    reason: '',
    templateId: matchingTemplate.id,
    templateName: matchingTemplate.name || '',
    departureDate: date
  };
};

/* The dates a template's schedule produces inside its validity window. Additive
   by design: `existing` is what the calendar already holds, so re-generating
   after a schedule change adds the new days and never touches a departure that
   may already be sold. Removing a weekday stops future generation; it does not
   cancel a departure — that is an operator's decision, taken on the row. */
export const generateDepartureDates = ({ operatesOn = [], validFrom, validTo, existing = [] } = {}) => {
  const start = utcMs(validFrom);
  const end = utcMs(validTo);
  if (start === null || end === null || end < start) return [];
  const operated = new Set((Array.isArray(operatesOn) ? operatesOn : [])
    .map(Number)
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7));
  /* No weekdays chosen is an unfinished template, not a daily tour. */
  if (!operated.size) return [];
  const held = new Set((Array.isArray(existing) ? existing : []).map((date) => String(date ?? '').slice(0, 10)));
  const dates = [];
  for (let ms = start; ms <= end; ms += DAY_MS) {
    if (!operated.has(((new Date(ms).getUTCDay() + 6) % 7) + 1)) continue;
    const iso = toISODate(ms);
    if (!held.has(iso)) dates.push(iso);
  }
  return dates;
};

export const departureCode = (iso) => {
  const ms = utcMs(iso);
  return ms === null ? '' : `DEP-${toISODate(ms).slice(2).replace(/-/g, '')}`;
};

/* A 7-day tour leaving on the 5th returns on the 11th: the departure day counts
   as day one, so the last night is the night before. */
export const returnDateFor = (iso, durationDays) => addDays(iso, Math.max(1, Math.round(Number(durationDays) || 1)) - 1);

/* Unsold allocations go back to the supplier this many days before arrival.
   Zero or unset means the template has no release control, which is a real
   answer and not the same as "release today". */
export const releaseDateFor = (iso, releaseDays) => {
  const days = Math.round(Number(releaseDays) || 0);
  return days > 0 ? addDays(iso, -days) : null;
};

export const templateDuration = (packageDays = []) => {
  const numbers = (Array.isArray(packageDays) ? packageDays : [])
    .map((day) => Math.round(Number(day?.day_number) || 0))
    .filter((number) => number > 0);
  const durationDays = numbers.length ? Math.max(...numbers) : 0;
  return { durationDays, durationNights: Math.max(0, durationDays - 1) };
};

export const DEPARTURE_STATUSES = ['open', 'guaranteed', 'waitlist', 'closed', 'cancelled', 'completed'];
export const BOOKING_STATUSES = ['provisional', 'confirmed', 'waitlist', 'cancelled', 'completed'];

/* Closed, cancelled and completed are decisions somebody took. The seat
   arithmetic may propose a status; it may never overrule one of these. */
const OPERATOR_STATUSES = ['closed', 'cancelled', 'completed'];

export const departureStatusLabel = (status) => ({
  open: 'Open',
  guaranteed: 'Guaranteed',
  waitlist: 'Waitlist',
  closed: 'Closed',
  cancelled: 'Cancelled',
  completed: 'Completed'
}[String(status || '').toLowerCase()] || 'Open');

const SOLD_STATUSES = new Set(['confirmed', 'completed']);

/* What the ledger says about one departure. An option is reported beside the
   sold count rather than inside it: the database holds confirmed seats against
   the cap, so a provisional party must not make the screen claim a seat is gone
   when the next confirmed sale can still take it. `remaining` is null when no
   cap has been stated — that is "no limit set", never "no seats". */
export const seatRollup = (bookings = [], capacity = 0) => {
  let sold = 0;
  let optioned = 0;
  let waitlisted = 0;
  for (const booking of Array.isArray(bookings) ? bookings : []) {
    const seats = Math.max(0, Math.round(Number(booking?.seats) || 0));
    const status = String(booking?.status || '').toLowerCase();
    if (SOLD_STATUSES.has(status)) sold += seats;
    else if (status === 'provisional') optioned += seats;
    else if (status === 'waitlist') waitlisted += seats;
  }
  const cap = Math.max(0, Math.round(Number(capacity) || 0));
  return {
    sold,
    optioned,
    waitlisted,
    capacity: cap,
    remaining: cap > 0 ? Math.max(0, cap - sold) : null
  };
};

export const resolveDepartureStatus = ({ current = 'open', sold = 0, capacity = 0, guaranteeMin = 0 } = {}) => {
  const status = String(current || 'open').toLowerCase();
  if (OPERATOR_STATUSES.includes(status)) return status;
  const seats = Math.max(0, Math.round(Number(sold) || 0));
  const cap = Math.max(0, Math.round(Number(capacity) || 0));
  const minimum = Math.max(0, Math.round(Number(guaranteeMin) || 0));
  if (cap > 0 && seats >= cap) return 'waitlist';
  /* Guaranteed is a promise made to the supplier, not a live reading of the
     ledger: once the minimum has been met the departure runs, even if a later
     cancellation drops it back below. Only an operator un-declares it. */
  if (status === 'guaranteed') return 'guaranteed';
  if (minimum > 0 && seats >= minimum) return 'guaranteed';
  return 'open';
};