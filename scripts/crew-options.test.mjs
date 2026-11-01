import {
  driverMealRate,
  flightOffersGuideTicket,
  guideFlightRate,
  guideMealChoices,
  guideMealRate,
  crewMealLines,
  mealAcceptsDriver,
  mealAcceptsGuide
} from '../src/lib/guidePricing';
import { libraryItemDetail } from '../src/lib/libraryItemDetail.js';
import {
  LIBRARY_ITEM_LIGHT_FIELDS,
  LIBRARY_ITEM_PACKAGE_FIELDS,
  LIBRARY_ITEM_PACKAGE_FIELDS_FALLBACK
} from '../src/lib/libraryItemFields';

const check = (label, actual, expected) => {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  if (!passed) process.exitCode = 1;
};

const rowsOf = (card, key) => {
  const section = card.sections.find((entry) => entry.key === key);
  return section ? section.rows.map((row) => [row.label, row.value]) : [];
};
const money = (value) => `ZAR ${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* The crew flags the supplier states on the item. Only a literal true counts: a
   library row saved before the migration carries null, and a string coming back
   from a form must not silently put a meal on the manifest. */
check('a flagged meal feeds the guide', mealAcceptsGuide({ guide_meal_offered: true }), true);
check('an unflagged meal does not', mealAcceptsGuide({ guide_meal_offered: null }), false);
check('a text "true" is not a flag', mealAcceptsDriver({ driver_meal_offered: 'true' }), false);
check('a flight only offers the guide a seat when flagged', flightOffersGuideTicket({ guide_flight_offered: true }), true);

/* -- The meal picker the guide dialog shows ---------------------------------
   Nothing tagged anywhere keeps the whole Meals module selectable; the moment
   the operator tags one meal, the picker is restricted to the tagged ones. */
const buffet = { id: 'm1', name: 'Buffet lunch', guide_meal_offered: true };
const picnic = { id: 'm2', name: 'Picnic', guide_meal_offered: false };
const tagged = guideMealChoices([buffet, picnic]);
check('tagged meals restrict the picker', [tagged.restricted, tagged.meals.map((m) => m.id)], [true, ['m1']]);
const untagged = guideMealChoices([picnic]);
check('an untagged library falls back to every meal', [untagged.restricted, untagged.meals.map((m) => m.id)], [false, ['m2']]);
check('no meals at all is an empty picker, not undefined', guideMealChoices(undefined), { meals: [], restricted: false });

/* -- Crew rates -------------------------------------------------------------
   A crew member who eats the clients' fare has no separate figure, so the adult
   price stands rather than a zero. */
check('a typed guide meal rate wins', guideMealRate({ guide_rate: 400, price_1_adult: 500 }), 400);
check('a guide meal falls back to the adult fare', guideMealRate({ price_1_adult: 500 }), 500);
check('a typed driver meal rate wins', driverMealRate({ driver_rate: 450, price_1_adult: 500 }), 450);
check('a driver meal falls back to the adult fare', driverMealRate({ unit_price: 600 }), 600);
check('no crew meal is charged when the guide is not needed', driverMealRate({ driver_rate: 450 }, false), 0);

/* -- The guide's seat on a flight -------------------------------------------
   A charter prices the whole aircraft, so only a typed crew fare can price one
   seat on it; a per-person flight charges the guide the clients' fare. */
check('a typed crew fare prices the guide seat', guideFlightRate({ guide_rate: 900, price_1_adult: 1500 }), 900);
check('a per-person flight falls back to the clients fare', guideFlightRate({ price_1_adult: 1500 }), 1500);
check('a charter with no crew fare has no seat price', guideFlightRate({ price_1_adult: 1500 }, { perCharter: true }), 0);
check('a charter with a crew fare prices the seat', guideFlightRate({ guide_rate: 900, unit_price: 12000 }, { perCharter: true }), 900);

/* -- What one meal choice puts on the day -----------------------------------
   The answer is an array: the guide always eats it, and the driver joins when the
   supplier says so, each line priced off its own party's rate. */
const mealRate = { id: 'r1', price_1_adult: 500, guide_rate: 400, driver_rate: 350 };
const guideOnlyMeal = { id: 'm1', name: 'Buffet lunch', category: 'Meals', guide_meal_offered: true, item_rates: [mealRate] };
const crewMeal = { ...guideOnlyMeal, driver_meal_offered: true };

check('no meal is no line', crewMealLines(null), []);
check('a guide-only meal is one line', crewMealLines(guideOnlyMeal).map((l) => [l.who, l.unitCost]), [['guide', 400]]);
check('a crew meal is a guide line and a driver line',
  crewMealLines(crewMeal).map((l) => [l.who, l.unitCost]),
  [['guide', 400], ['driver', 350]]);
check('both lines carry the same item, so the day shows one meal per party',
  crewMealLines(crewMeal).every((l) => l.item.id === 'm1'), true);

/* -- The rate card ----------------------------------------------------------
   The crew figure charged is printed, not the column it came from: a flagged
   meal with no typed crew rate prints the adult fare and says so. */
const mealCard = (extraRates, extraItem = {}) => libraryItemDetail({
  item: {
    name: 'Buffet lunch', category: 'Meals', currency: 'ZAR',
    meal_type: 'Lunch', item_rates: [{ id: 'r1', season_name: 'All year', ...extraRates }],
    ...extraItem
  }
}).seasons[0];

check('an untagged meal shows no crew section', rowsOf(mealCard({ price_1_adult: 500 }), 'guide-driver'), []);
check('a flagged guide meal prints the crew fare',
  rowsOf(mealCard({ price_1_adult: 500, guide_rate: 400 }, { guide_meal_offered: true }), 'guide-driver'),
  [['Guide', `${money(400)} / person`]]);
check('a crew meal without a driver figure prints the adult fare',
  rowsOf(mealCard({ price_1_adult: 500, guide_rate: 400 }, { guide_meal_offered: true, driver_meal_offered: true }), 'guide-driver'),
  [['Guide', `${money(400)} / person`], ['Driver', `${money(500)} / person · adult fare`]]);

const flightCard = (rate) => libraryItemDetail({
  item: {
    name: 'Light aircraft hop', category: 'Flights / Charter', currency: 'ZAR',
    guide_flight_offered: true, item_rates: [{ id: 'f1', season_name: 'All year', ...rate }]
  }
}).seasons[0];
const priceLabels = (card) => card.sections.find((s) => s.key === 'prices').rows.map((r) => r.label);

check('a per-person flight prints the clients fare and the guide seat',
  priceLabels(flightCard({ rate_basis: 'per_person', price_1_adult: 1500, guide_rate: 900 })),
  ['Per person', 'Guide seat']);
check('the guide seat prints the crew fare, not the clients fare',
  flightCard({ rate_basis: 'per_person', price_1_adult: 1500, guide_rate: 900 }).sections
    .find((s) => s.key === 'prices').rows.find((r) => r.label === 'Guide seat').value,
  `${money(900)} / person`);
check('a per-person flight with no crew fare still quotes the clients fare for the seat',
  flightCard({ rate_basis: 'per_person', price_1_adult: 1500 }).sections
    .find((s) => s.key === 'prices').rows.find((r) => r.label === 'Guide seat').value,
  `${money(1500)} / person`);
check('a charter with no crew fare shows no guide seat',
  priceLabels(flightCard({ rate_basis: 'per_vehicle', unit_price: 12000 })),
  ['Charter (per flight)']);
check('a charter with a crew fare shows the seat beside the aircraft price',
  priceLabels(flightCard({ rate_basis: 'per_vehicle', unit_price: 12000, guide_rate: 900 })),
  ['Charter (per flight)', 'Guide seat']);
check('a flight the guide is not sold on prints no seat',
  priceLabels(libraryItemDetail({
    item: {
      name: 'Scheduled hop', category: 'Flights / Charter', currency: 'ZAR',
      item_rates: [{ id: 'f2', season_name: 'All year', rate_basis: 'per_person', price_1_adult: 1500 }]
    }
  }).seasons[0]),
  ['Per person']);

/* -- The columns the builders must load -------------------------------------
   PostgREST rejects the WHOLE select when one named column is missing, so the
   crew flags are added to a projection the caller can retry without them. */
const CREW_COLUMNS = ['guide_meal_offered', 'driver_meal_offered', 'guide_flight_offered'];
const fields = (value) => String(value).replace(/\s/g, '').split(',');

check('the itinerary library load selects the crew flags',
  CREW_COLUMNS.every((c) => fields(LIBRARY_ITEM_LIGHT_FIELDS).includes(c)), true);
check('the package library load selects the crew flags',
  CREW_COLUMNS.every((c) => fields(LIBRARY_ITEM_PACKAGE_FIELDS).includes(c)), true);
check('the retry projection leaves the crew flags out',
  CREW_COLUMNS.some((c) => fields(LIBRARY_ITEM_PACKAGE_FIELDS_FALLBACK).includes(c)), false);
check('the retry projection still loads the item itself',
  ['id', 'name', 'category'].every((c) => fields(LIBRARY_ITEM_PACKAGE_FIELDS_FALLBACK).includes(c)), true);

console.log('\n--- Crew meals & guide flight options suite complete ---\n');
