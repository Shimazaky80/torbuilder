import {
  DAY_DESTINATION_COLUMNS,
  DAY_END_TYPES,
  applyDayDestination,
  dayDestinationHeading,
  dayEndLabel,
  dayRoute,
  destinationFields,
  destinationLabel
} from '../src/lib/dayDestination.js';

const check = (label, actual, expected) => {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  if (!passed) process.exitCode = 1;
};

const PLACE_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_ID = '99999999-8888-4777-8666-555555555555';

/* -- What the database receives ----------------------------------------- */
check('the stored columns are the ones the migration adds', DAY_DESTINATION_COLUMNS, [
  'destination_country', 'destination_place_id', 'destination_name', 'destination_region', 'end_of_day'
]);
check('stray spaces are trimmed, blanks become null', destinationFields({
  destination_country: '  South Africa ',
  destination_place_id: PLACE_ID,
  destination_name: ' Cape Town ',
  destination_region: '   ',
  end_of_day: 'overnight'
}), {
  destination_country: 'South Africa',
  destination_place_id: PLACE_ID,
  destination_name: 'Cape Town',
  destination_region: null,
  end_of_day: 'overnight'
});
check('a day with no destination stores nothing', destinationFields({}), {
  destination_country: null,
  destination_place_id: null,
  destination_name: null,
  destination_region: null,
  end_of_day: null
});
check('an unknown end-of-day mode is not stored', destinationFields({ end_of_day: 'whenever' }).end_of_day, null);
check('a missing day is not a crash', destinationFields(null), destinationFields({}));
check('the four end-of-day modes are the picker options', DAY_END_TYPES, ['overnight', 'visit', 'departure', 'transit']);

/* -- What the consultant and traveller read ------------------------------ */
check('the label is place and country', destinationLabel({
  destination_name: 'Oudtshoorn', destination_country: 'South Africa'
}), 'Oudtshoorn, South Africa');
check('a place without a country still labels', destinationLabel({ destination_name: 'Knysna' }), 'Knysna');
check('an empty day has no label', destinationLabel({ destination_name: '  ' }), '');
check('the day heading is number and destination', dayDestinationHeading({
  destination_name: 'Cape Town', destination_country: 'South Africa'
}, 1), 'Day 1 — Cape Town, South Africa');
check('an unset destination leaves a clean day heading', dayDestinationHeading({}, 3), 'Day 3');
check('the heading follows the document language', dayDestinationHeading({
  destination_name: 'Cape Town', destination_country: 'South Africa'
}, 1, 'pt-BR'), 'Dia 1 — Cape Town, South Africa');

/* -- The route line ------------------------------------------------------ */
const capeTown = { destination_place_id: PLACE_ID, destination_name: 'Cape Town', destination_country: 'South Africa' };
const capeTownAgain = { destination_place_id: PLACE_ID, destination_name: 'Cape Town', destination_country: 'South Africa' };
const oudtshoorn = { destination_place_id: OTHER_ID, destination_name: 'Oudtshoorn', destination_country: 'South Africa' };

check('the first day is an arrival', dayRoute(capeTown, undefined), 'Arrival in Cape Town, South Africa');
check('a repeated place reads as a stay, not a move', dayRoute(capeTownAgain, capeTown), 'Stay in Cape Town, South Africa');
check('a new place reads as the route from the last one', dayRoute(oudtshoorn, capeTown), 'Cape Town, South Africa → Oudtshoorn, South Africa');
check('an earlier day with no destination still reads as an arrival', dayRoute(oudtshoorn, {}), 'Arrival in Oudtshoorn, South Africa');
check('a day with no destination has no route line', dayRoute({}, capeTown), '');
check('two saved spellings of one place stay a stay when the IDs match', dayRoute(
  { destination_place_id: PLACE_ID, destination_name: 'Cape Town (CBD)', destination_country: 'South Africa' },
  capeTown
), 'Stay in Cape Town (CBD), South Africa');
check('place IDs compare without regard to case', dayRoute(
  { destination_place_id: PLACE_ID.toUpperCase(), destination_name: 'Cape Town', destination_country: 'South Africa' },
  capeTown
), 'Stay in Cape Town, South Africa');
check('without IDs the same place and region still counts as a stay', dayRoute(
  { destination_name: 'Knysna', destination_country: 'South Africa', destination_region: 'Western Cape' },
  { destination_name: 'Knysna', destination_country: 'South Africa', destination_region: 'Western Cape' }
), 'Stay in Knysna, South Africa');

/* -- The end-of-day line ------------------------------------------------- */
check('overnight names the place', dayEndLabel({ ...capeTown, end_of_day: 'overnight' }), 'Overnight: Cape Town, South Africa');
check('a day visit says there is no overnight', dayEndLabel({ ...capeTown, end_of_day: 'visit' }), 'Day visit: Cape Town, South Africa · no overnight');
check('a departure says there is no overnight', dayEndLabel({ ...capeTown, end_of_day: 'departure' }), 'Departure: Cape Town, South Africa · no overnight');
check('transit needs no destination', dayEndLabel({ end_of_day: 'transit' }), 'In transit');
check('an unspecified end of day prints nothing', dayEndLabel(capeTown), '');
check('an unknown end of day prints nothing', dayEndLabel({ ...capeTown, end_of_day: 'later' }), '');
check('the end-of-day line follows the document language', dayEndLabel({ ...capeTown, end_of_day: 'overnight' }, 'pt-BR'), 'Pernoite: Cape Town, South Africa');

/* -- Copying and bulk applying ------------------------------------------ */
const days = [
  { key: 'a', destination_name: 'Cape Town', destination_country: 'South Africa', destination_place_id: PLACE_ID, end_of_day: 'overnight', services: [{ id: 1 }] },
  { key: 'b', destination_name: 'Oudtshoorn', destination_country: 'South Africa', destination_place_id: OTHER_ID, end_of_day: 'visit', services: [{ id: 2 }] },
  { key: 'c', destination_name: '', end_of_day: 'transit', services: [] }
];
const copyPatch = {
  destination_country: 'South Africa',
  destination_place_id: PLACE_ID,
  destination_name: 'Cape Town',
  destination_region: 'Western Cape'
};
const applied = applyDayDestination(days, [1, 2], copyPatch);
check('only the selected days change', applied.map((day) => day.destination_name), ['Cape Town', 'Cape Town', 'Cape Town']);
check('copying a destination leaves the end-of-day mode alone', applied.map((day) => day.end_of_day), ['overnight', 'visit', 'transit']);
check('copying a destination leaves services and prices alone', applied[1].services, days[1].services);
check('the original day list is not mutated', days[1].destination_name, 'Oudtshoorn');
check('the copied region travels with the place', applied[2].destination_region, 'Western Cape');
check('an untouched day keeps its own fields', applied[0], days[0]);
const onlyEnd = applyDayDestination(days, [0], { end_of_day: 'departure' });
check('an end-of-day-only patch keeps the destination', onlyEnd[0].destination_name, 'Cape Town');
check('an end-of-day-only patch changes the mode', onlyEnd[0].end_of_day, 'departure');
check('unknown patch fields are ignored', applyDayDestination(days, [0], { destination_name: 'Knysna', services: [] })[0].services, days[0].services);
check('an empty selection changes nothing', applyDayDestination(days, [], copyPatch), days);
