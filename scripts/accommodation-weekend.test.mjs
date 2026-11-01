/* Weekend pricing: the supplier names the nights it treats as weekend and the
   price those nights carry, per room type. It is a per-night figure on the same
   charge type, so a single stay can contain both a normal and a weekend night. */
import {
  rateForNight,
  rateForNights,
  weekendDaysLabel,
  weekendDaysOf,
  weekendNightOf,
  weekendPriceOf
} from '../src/lib/accommodationOptions.js';
import { applyProtectionToRate } from '../src/lib/priceValidity.js';
import { libraryItemDetail } from '../src/lib/libraryItemDetail.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};
const checkJson = (label, actual, expected) => check(label, JSON.stringify(actual), JSON.stringify(expected));

/* 2026-10-30 is a Friday, 31 a Saturday, 1 November a Sunday. */
const FRIDAY = '2026-10-30';
const SATURDAY = '2026-10-31';
const SUNDAY = '2026-11-01';
const MONDAY = '2026-11-02';

checkJson('weekend days sort, dedupe and drop non-days', weekendDaysOf({
  weekend_days: [6, 5, 5, 9, 0, '7']
}), [5, 6, 7]);
checkJson('no weekend days stays empty', weekendDaysOf({ weekend_days: null }), []);
check('weekend label names the picked nights', weekendDaysLabel({ weekend_days: [5, 6] }), 'Fri, Sat');
check('weekend label is blank with no days', weekendDaysLabel({}), '');

const flat = {
  id: 'r1',
  rate_basis: 'per_room',
  unit_price: 2800,
  price_2_adults: 2800,
  double_twin_rate: 2800,
  price_1_adult: 2800,
  single_room_rate: 2800,
  price_3_plus_adults: 2800,
  weekend_days: [5, 6],
  weekend_price: 3200
};

check('a Friday is a weekend night', weekendNightOf(flat, FRIDAY), true);
check('a Saturday is a weekend night', weekendNightOf(flat, SATURDAY), true);
check('a Sunday is not when only Fri/Sat are picked', weekendNightOf(flat, SUNDAY), false);
check('a Monday is never a weekend night', weekendNightOf(flat, MONDAY), false);
check('an unset weekend price is never applied', weekendNightOf({ ...flat, weekend_price: null }, FRIDAY), false);
check('no date is never a weekend night', weekendNightOf(flat, ''), false);

const friday = rateForNight(flat, FRIDAY);
check('the weekend price replaces the room rate', friday.unit_price, 3200);
check('a room with no separate single rate charges the weekend price solo', friday.single_room_rate, 3200);
check('the weekend copy is marked', friday.weekend_night, true);
check('the original row is untouched', flat.unit_price, 2800);
check('a weekday keeps the same row', rateForNight(flat, MONDAY), flat);

const separateSingle = rateForNight({ ...flat, single_room_rate: 4000, price_1_adult: 4000 }, FRIDAY);
check('a contracted single room rate is kept', separateSingle.single_room_rate, 4000);
check('the shared room still takes the weekend price', separateSingle.unit_price, 3200);

const pps = {
  rate_basis: 'per_person_sharing',
  price_1_adult: 2600,
  price_2_adults: 1800,
  double_twin_rate: 1800,
  unit_price: 1800,
  price_3_plus_adults: null,
  weekend_days: [5, 6],
  weekend_price: 2200
};
const ppsFriday = rateForNight(pps, FRIDAY);
check('PPS sharing takes the weekend price', ppsFriday.price_2_adults, 2200);
check('PPS unit price follows the sharing figure', ppsFriday.unit_price, 2200);
check('PPS single keeps its contracted figure', ppsFriday.price_1_adult, 2600);
check('an empty extra-adult figure follows the sharing rate', ppsFriday.price_3_plus_adults, 2200);
check('a distinct extra-adult figure is kept', rateForNight({ ...pps, price_3_plus_adults: 1500 }, FRIDAY).price_3_plus_adults, 1500);

/* Night bands and weekends compose: the band picks the row, the date picks which
   of that row's two nightly prices applies. */
const rates = [
  { ...flat, id: 'short', min_nights: 1, max_nights: 3, unit_price: 2800, weekend_price: 3200 },
  { ...flat, id: 'long', min_nights: 4, max_nights: null, unit_price: 2300, weekend_price: 2700 }
];
const longStay = rateForNights(rates, rates[0], 5);
check('the long band prices a five-night stay', longStay.id, 'long');
const longFriday = rateForNight(longStay, FRIDAY);
check('a weekend night inside the long band takes that band weekend price', longFriday.unit_price, 2700);
check('a weekday inside the long band keeps the long band price', rateForNight(longStay, MONDAY).unit_price, 2300);

const protectedFriday = applyProtectionToRate(flat, 10);
check('pricing protection uplifts the weekend price', protectedFriday.weekend_price, 3520);
check('pricing protection marks the row', protectedFriday.price_protection_percent, 10);

check('weekend price reads as a number', weekendPriceOf({ weekend_price: '3200' }), 3200);
check('a missing weekend price is null', weekendPriceOf({}), null);

const detail = libraryItemDetail({
  item: {
    category: 'Accommodation',
    currency: 'ZAR',
    pricing_model: 'per_room',
    name: 'Boardwalk Hotel',
    item_rates: [flat]
  }
});
const priceRows = (detail.seasons[0].sections.find((section) => section.key === 'prices') || {}).rows || [];
const weekendRow = priceRows.find((row) => row.label === 'Weekend rate (Fri, Sat)');
check('the rate card prints the weekend row', weekendRow?.value, 'ZAR 3,200.00 / room / night');

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll weekend-rate checks passed');
