/* Accommodation night bands: one room, one charge type, several nightly prices
   by length of stay. The band rides on the rate row, groups under the charge
   type, and both pricing paths resolve the band that covers the stay. */
import {
  accommodationHasChoices,
  accommodationSeasonGroups,
  nightBandLabel,
  nightBandOf,
  rateCoversNights,
  rateForNights
} from '../src/lib/accommodationOptions.js';
import { accommodationRatesForTrip } from '../src/lib/packagePricing.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};
const checkJson = (label, actual, expected) => check(label, JSON.stringify(actual), JSON.stringify(expected));

const window = {
  season_name: 'Base',
  option_name: 'Base',
  valid_from: '2027-01-01',
  valid_to: '2027-12-31',
  currency: 'ZAR'
};

const boardwalk = {
  id: 'luxury-short',
  ...window,
  meal_plan: 'Bed & Breakfast',
  rate_basis: 'per_person_sharing',
  price_2_adults: 2800,
  single_room_rate: 3200,
  unit_price: 2800,
  min_nights: 1,
  max_nights: 3
};
const boardwalkLong = {
  id: 'luxury-long',
  ...window,
  meal_plan: 'Bed & Breakfast',
  rate_basis: 'per_person_sharing',
  price_2_adults: 2300,
  single_room_rate: 2700,
  unit_price: 2300,
  min_nights: 4,
  max_nights: null
};
const bandless = {
  id: 'legacy',
  ...window,
  meal_plan: 'Half Board',
  rate_basis: 'per_person_sharing',
  price_2_adults: 3000
};

const item = { id: 'boardwalk', name: 'Boardwalk Hotel', category: 'Accommodation', currency: 'ZAR', item_rates: [boardwalk, boardwalkLong, bandless] };

checkJson('a band reads its two bounds', nightBandOf(boardwalkLong), { min: 4, max: null, banded: true });
checkJson('no bounds means every stay', nightBandOf(bandless), { min: 1, max: null, banded: false });
check('a closed band is written 1-3 nights', nightBandLabel(boardwalk), '1\u20133 nights');
check('an open band is written 4+ nights', nightBandLabel(boardwalkLong), '4+ nights');
check('a single-night band is written in the singular', nightBandLabel({ min_nights: 1, max_nights: 1 }), '1 night');
check('a bandless row has no label', nightBandLabel(bandless), '');

check('3 nights is in the 1-3 band', rateCoversNights(boardwalk, 3), true);
check('4 nights is in the 4+ band', rateCoversNights(boardwalkLong, 4), true);
check('2 nights is not in the 4+ band', rateCoversNights(boardwalkLong, 2), false);
check('a bandless row covers any stay', rateCoversNights(bandless, 9), true);

const groups = accommodationSeasonGroups(item);
check('one season holds both bands', groups.length, 1);
check('the bands belong to one charge type', groups[0].options.length, 2);
const bnb = groups[0].options.find((option) => option.label === 'Bed & Breakfast');
checkJson('the charge type lists its bands shortest first', bnb.bands.map((band) => band.label), ['1\u20133 nights', '4+ nights']);
check('the representative row is the first priced band', bnb.rateId, 'luxury-short');
check('a banded room always asks before it is added', accommodationHasChoices(item), true);

check('5 nights resolves to the 4+ row', rateForNights(item.item_rates, boardwalk, 5).id, 'luxury-long');
check('2 nights keeps the 1-3 row', rateForNights(item.item_rates, boardwalk, 2).id, 'luxury-short');
check('a stay outside every band keeps the chosen row', rateForNights(
  [{ ...boardwalk, max_nights: 3 }, { ...boardwalkLong, min_nights: 6 }],
  boardwalk,
  5
).id, 'luxury-short');
check('a bandless row is never re-priced', rateForNights(item.item_rates, bandless, 5).id, 'legacy');

const bandedItem = { ...item, item_rates: [boardwalk, boardwalkLong] };

const fiveNights = accommodationRatesForTrip({}, bandedItem, '2027-02-01', '2027-02-06', 5);
check('a 5-night trip prices from the 4+ band', fiveNights.chosen.sharing, 2300);
check('only the matching band stays in the preview', fiveNights.rates.length, 1);
const twoNights = accommodationRatesForTrip({}, bandedItem, '2027-02-01', '2027-02-03', 2);
check('a 2-night trip prices from the 1-3 band', twoNights.chosen.sharing, 2800);
check('without a stay length both bands stay in the preview', accommodationRatesForTrip(
  {}, bandedItem, '2027-02-01', '2027-02-03'
).rates.length, 2);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll accommodation night-band checks passed.');
