/* Weekend pricing: the supplier names the nights it treats as weekend and the
   price those nights carry, per room type. It is a per-night figure on the same
   charge type, so a single stay can contain both a normal and a weekend night. */
import {
  rateForNight,
  rateForNights,
  weekendDaysLabel,
  weekendDaysOf,
  weekendNightOf,
  weekendPriceOf,
  weekendRatesOf,
  withWeekendRatesNote,
  stripWeekendRatesNote
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

/* ── Per-person weekend card ──────────────────────────────────────────────
   A room priced per person sharing contracts a whole weekend card: the single,
   sharing, extra-adult and child-band figures those nights carry. Each blank
   column means "not quoted for the weekend", so the normal figure for that same
   column stands. */
const ppsCard = {
  id: 'pps-wr',
  rate_basis: 'per_person_sharing',
  price_1_adult: 2600,
  single_room_rate: 2600,
  effective_single_rate: 2600,
  price_2_adults: 1800,
  double_twin_rate: 1800,
  unit_price: 1800,
  price_3_plus_adults: 1500,
  child_rates_breakdown: { infant: 0, child: 900 },
  weekend_days: [5, 6],
  weekend_price: null,
  weekend_rates: {
    price_1_adult: 3000,
    price_2_adults: 2200,
    price_3_plus_adults: 1800,
    child_rates: { child: 1100 }
  }
};

check('a per-person card makes Friday a weekend night with no flat price', weekendNightOf(ppsCard, FRIDAY), true);
check('the representative weekend figure is the sharing rate', weekendPriceOf(ppsCard), 2200);
const cardFriday = rateForNight(ppsCard, FRIDAY);
check('the weekend single replaces the normal single', cardFriday.price_1_adult, 3000);
check('the weekend single fills the single-room columns', cardFriday.single_room_rate, 3000);
check('the weekend sharing replaces PPS', cardFriday.price_2_adults, 2200);
check('the weekend sharing fills unit and double/twin', cardFriday.unit_price, 2200);
check('the weekend extra adult replaces the third-adult rate', cardFriday.price_3_plus_adults, 1800);
checkJson('the weekend child band overrides while the unquoted band stands', cardFriday.child_rates_breakdown, { infant: 0, child: 1100 });
check('the per-person weekend copy is marked', cardFriday.weekend_night, true);
check('a weekday keeps the per-person card row untouched', rateForNight(ppsCard, MONDAY), ppsCard);
check('the original card row is not mutated', ppsCard.price_2_adults, 1800);

/* A blank weekend single keeps a separately contracted normal single; a blank
   weekend extra keeps a separately contracted normal extra. */
const sharingOnly = rateForNight({ ...ppsCard, weekend_rates: { price_2_adults: 2200 } }, FRIDAY);
check('a blank weekend single keeps the contracted single', sharingOnly.price_1_adult, 2600);
check('a blank weekend single keeps the single-room column', sharingOnly.single_room_rate, 2600);
check('the quoted weekend sharing still applies', sharingOnly.price_2_adults, 2200);
check('a blank weekend extra keeps the contracted extra', sharingOnly.price_3_plus_adults, 1500);
checkJson('no weekend child map leaves the normal child bands', sharingOnly.child_rates_breakdown, { infant: 0, child: 900 });

/* A room that never had a separate single follows the weekend sharing solo,
   and an extra that equals the sharing rate is not a separate contract. */
const noSeparate = rateForNight({
  ...ppsCard,
  price_1_adult: 1800, single_room_rate: 1800, effective_single_rate: 1800,
  price_3_plus_adults: 1800,
  weekend_rates: { price_2_adults: 2200 }
}, FRIDAY);
check('no separate single: the weekend sharing applies solo', noSeparate.price_1_adult, 2200);
check('no separate extra: the weekend sharing applies to the third adult', noSeparate.price_3_plus_adults, 2200);

/* A child-only card still prices the weekend: adults unchanged, children quoted. */
const childOnly = { ...ppsCard, weekend_rates: { child_rates: { child: 1100 } } };
check('a child-only card is a weekend contract', weekendNightOf(childOnly, FRIDAY), true);
check('a child-only card has no representative adult figure', weekendPriceOf(childOnly), null);
const childOnlyFriday = rateForNight(childOnly, FRIDAY);
check('a child-only card leaves the adult single alone', childOnlyFriday.price_1_adult, 2600);
check('a child-only card leaves the adult sharing alone', childOnlyFriday.price_2_adults, 1800);
checkJson('a child-only card overrides the quoted child band', childOnlyFriday.child_rates_breakdown, { infant: 0, child: 1100 });
check('an explicit free weekend child is honoured', rateForNight({ ...ppsCard, weekend_rates: { child_rates: { child: 0 } } }, FRIDAY).child_rates_breakdown.child, 0);

/* An empty card and an occupancy ladder both refuse the weekend swap. */
check('an empty weekend card is not weekend pricing', weekendNightOf({ ...ppsCard, weekend_rates: {} }, FRIDAY), false);
check('an empty card returns the same row', rateForNight({ ...ppsCard, weekend_rates: {} }, FRIDAY).price_2_adults, 1800);
const ladderWeekend = { rate_basis: 'per_person_occupancy', occupancy_rates: [{ min_pax: 2, max_pax: 6, rate: 8187 }], weekend_days: [5, 6], weekend_rates: { price_2_adults: 2200 } };
check('an occupancy ladder ignores the weekend card', rateForNight(ladderWeekend, FRIDAY), ladderWeekend);

/* Protection uplifts every figure on the weekend card with the rest of the row. */
const protectedCard = applyProtectionToRate(ppsCard, 10);
check('protection uplifts the weekend single', protectedCard.weekend_rates.price_1_adult, 3300);
check('protection uplifts the weekend sharing', protectedCard.weekend_rates.price_2_adults, 2420);
check('protection uplifts the weekend extra', protectedCard.weekend_rates.price_3_plus_adults, 1980);
check('protection uplifts the weekend child band', protectedCard.weekend_rates.child_rates.child, 1210);
check('protection keeps the weekend child map to its quoted bands', protectedCard.weekend_rates.child_rates.infant, undefined);

/* Before the weekend_rates column exists the card travels in the rate notes,
   beside the waiver marker; the column wins once it is present. */
const noted = { ...ppsCard, weekend_rates: undefined, notes: withWeekendRatesNote('[[waiver:1]]', ppsCard.weekend_rates) };
checkJson('the weekend card round-trips through the notes marker', weekendRatesOf(noted), ppsCard.weekend_rates);
check('a notes-encoded card prices the weekend night', rateForNight(noted, FRIDAY).price_2_adults, 2200);
check('stripping the weekend note leaves the waiver marker', stripWeekendRatesNote(noted.notes), '[[waiver:1]]');
check('the column wins over the notes marker', weekendRatesOf({ ...noted, weekend_rates: { price_2_adults: 9999 } }).price_2_adults, 9999);
check('no weekend note reads as null', weekendRatesOf({ notes: '[[waiver:1]]' }), null);

/* The rate card prints the per-person weekend figures and the child bands. */
const ppsDetail = libraryItemDetail({
  item: {
    category: 'Accommodation',
    currency: 'ZAR',
    pricing_model: 'per_person_sharing',
    name: 'Sharing Lodge',
    child_age_ranges: [
      { id: 'infant', name: 'Infants', ageFrom: 0, ageTo: 2 },
      { id: 'child', name: 'Children', ageFrom: 3, ageTo: 11 }
    ],
    item_rates: [ppsCard]
  }
});
const ppsRows = (ppsDetail.seasons[0].sections.find((section) => section.key === 'prices') || {}).rows || [];
const ppsRow = (label) => (ppsRows.find((row) => row.label === label) || {}).value;
check('the card prints the weekend single', ppsRow('Weekend rate (Fri, Sat) — 1 adult (single)'), 'ZAR 3,000.00 / person / night');
check('the card prints the weekend sharing', ppsRow('Weekend rate (Fri, Sat) — 2 adults sharing (PPS)'), 'ZAR 2,200.00 / person / night');
check('the card prints the weekend extra adult', ppsRow('Weekend rate (Fri, Sat) — 3+ adults'), 'ZAR 1,800.00 / person / night');
check('the card prints the weekend child band by name', ppsRow('Weekend rate (Fri, Sat) — Children (3–11 yrs)'), 'ZAR 1,100.00 / person / night');

/* The editor's save passes its own season state, which holds the days as
   camelCase weekendDays. Reading only the stored snake_case key wiped the
   weekend contract on every save, so no weekend price ever reached a builder
   or the rate card. */
checkJson('the days read from the editor state the save passes', weekendDaysOf({ weekendDays: [6, 5, 5] }), [5, 6]);
checkJson('the stored key still wins over the editor shape', weekendDaysOf({ weekend_days: [7], weekendDays: [5] }), [7]);
checkJson('string days from a form are normalised', weekendDaysOf({ weekendDays: ['5', '6', '9', '0'] }), [5, 6]);

/* A notes-encoded weekend card prints as price rows, and the raw marker never
   leaks into the card's Notes section as if it were operator prose. */
const notedDetail = libraryItemDetail({
  item: {
    category: 'Accommodation',
    currency: 'ZAR',
    pricing_model: 'per_person_sharing',
    name: 'Noted Lodge',
    item_rates: [noted]
  }
});
const notedRows = (notedDetail.seasons[0].sections.find((section) => section.key === 'prices') || {}).rows || [];
check('a notes-encoded card still prints the weekend sharing row',
  (notedRows.find((row) => row.label === 'Weekend rate (Fri, Sat) — 2 adults sharing (PPS)') || {}).value,
  'ZAR 2,200.00 / person / night');
check('the card notes hide the weekend marker', notedDetail.seasons[0].notes, null);
const proseDetail = libraryItemDetail({
  item: {
    category: 'Accommodation', currency: 'ZAR', pricing_model: 'per_person_sharing', name: 'Prose Lodge',
    item_rates: [{ ...noted, notes: withWeekendRatesNote('Children under 2 stay free.', ppsCard.weekend_rates) }]
  }
});
check('real notes survive beside the hidden marker', proseDetail.seasons[0].notes, 'Children under 2 stay free.');

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll weekend-rate checks passed');
