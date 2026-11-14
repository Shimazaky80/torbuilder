import { t } from './i18n';

export const DAY_DESTINATION_COLUMNS = [
  'destination_country', 'destination_place_id', 'destination_name', 'destination_region', 'end_of_day'
];

export const DAY_END_TYPES = ['overnight', 'visit', 'departure', 'transit'];

const text = (value) => String(value || '').trim();

export const destinationFields = (day = {}) => ({
  destination_country: text(day?.destination_country) || null,
  destination_place_id: day?.destination_place_id || null,
  destination_name: text(day?.destination_name) || null,
  destination_region: text(day?.destination_region) || null,
  end_of_day: DAY_END_TYPES.includes(day?.end_of_day) ? day.end_of_day : null
});

export const destinationLabel = (day) => {
  const name = text(day?.destination_name);
  return name ? [name, text(day?.destination_country)].filter(Boolean).join(', ') : '';
};

export const dayDestinationHeading = (day, number, lang = 'en') => [
  t(lang, 'doc.day', { n: number, count: number }), destinationLabel(day)
].filter(Boolean).join(' — ');

export const dayRoute = (day, previousDay, lang = 'en') => {
  const destination = destinationLabel(day);
  if (!destination) return '';
  const previous = destinationLabel(previousDay);
  /* No known previous place — either this is Day 1 or the earlier day has no
     destination yet — so the day reads as an arrival rather than a bare name. */
  if (!previous) return t(lang, 'doc.arrivalIn', { destination });
  const dayId = text(day.destination_place_id).toLowerCase();
  const previousId = text(previousDay.destination_place_id).toLowerCase();
  const same = dayId && previousId
    ? dayId === previousId
    : destination === previous && text(day.destination_region) === text(previousDay.destination_region);
  return same ? t(lang, 'doc.stayIn', { destination }) : `${previous} → ${destination}`;
};

export const dayEndLabel = (day, lang = 'en') => {
  if (day?.end_of_day === 'transit') return t(lang, 'doc.inTransit');
  const destination = destinationLabel(day);
  if (!destination || !DAY_END_TYPES.includes(day?.end_of_day)) return '';
  const key = { overnight: 'doc.overnightAt', visit: 'doc.dayVisitAt', departure: 'doc.departureFrom' }[day.end_of_day];
  return t(lang, key, { destination });
};

export const applyDayDestination = (days, indexes, patch) => {
  const selected = new Set(indexes);
  const fields = Object.fromEntries(DAY_DESTINATION_COLUMNS
    .filter((key) => Object.hasOwn(patch, key)).map((key) => [key, patch[key]]));
  return days.map((day, index) => selected.has(index)
    ? { ...day, ...destinationFields({ ...day, ...fields }) }
    : day);
};
