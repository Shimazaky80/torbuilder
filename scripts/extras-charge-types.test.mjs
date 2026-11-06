/* Extras charge types: one extra contracted at several named charges.
 *
 * A fuel supplier that sells 5 litres, a full tank and a different fuel again is
 * ONE library item with three charge types, the same shape a property has always
 * had with its board basics. These checks cover the rules the rest of the app
 * leans on: the name sits on the row's meal_plan only (an Extras row's option_name
 * is its SEASON), a drop only asks when a season really offers a choice, and every
 * later reader stays on the charge the operator picked.
 */
import {
  chargeNameOf,
  extrasChargeGroups,
  extrasChargeNames,
  extrasHasChargeChoices,
  isExtrasItem,
  lineChargeLabel,
  ratesForCharge
} from '../src/lib/extrasChargeTypes';
import { repriceServicesForPax } from '../src/lib/servicePricing';
import { packageSeasonCoverage } from '../src/lib/packagePricing';
import { abbrevMealPlan, showMealPlanOn } from '../src/lib/invoiceDoc';
import { voucherDetailLines } from '../src/lib/voucherDetails';

const check = (label, actual, expected) => {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  if (!passed) process.exitCode = 1;
};

/* Diesel is deliberately the first row of the matrix: anything that resolves
   without asking which charge was bought lands on Diesel, so these checks can
   tell a scoped read from an unscoped one. */
const fuel = {
  id: 'x1',
  name: 'Fuel',
  category: 'Extras',
  currency: 'ZAR',
  pricing_model: 'per_person',
  item_rates: [
    { id: 'r-diesel-high', season_name: 'High', option_name: 'High', meal_plan: 'Diesel', currency: 'ZAR', rate_basis: 'per_person', valid_from: '2026-12-01', valid_to: '2027-02-28', price_1_adult: 200, unit_price: 200 },
    { id: 'r-petrol-high', season_name: 'High', option_name: 'High', meal_plan: 'Petrol', currency: 'ZAR', rate_basis: 'per_person', valid_from: '2026-12-01', valid_to: '2027-02-28', price_1_adult: 120, unit_price: 120 },
    { id: 'r-petrol-low', season_name: 'Low', option_name: 'Low', meal_plan: 'Petrol', currency: 'ZAR', rate_basis: 'per_person', valid_from: '2027-03-01', valid_to: '2027-05-31', price_1_adult: 90, unit_price: 90 }
  ]
};

/* An item with one charge spread over several seasons is the common case and has
   nothing to ask: the travel dates answer which season, as they always did. */
const oneCharge = {
  id: 'x2',
  name: 'Meet and greet',
  category: 'Extras',
  currency: 'ZAR',
  pricing_model: 'per_unit',
  item_rates: [
    { id: 'g-winter', season_name: 'Winter', option_name: 'Winter', meal_plan: null, currency: 'ZAR', rate_basis: 'per_unit', valid_from: '2026-06-01', valid_to: '2026-08-31', price_1_adult: 500, unit_price: 500 },
    { id: 'g-summer', season_name: 'Summer', option_name: 'Summer', meal_plan: null, currency: 'ZAR', rate_basis: 'per_unit', valid_from: '2026-12-01', valid_to: '2027-02-28', price_1_adult: 600, unit_price: 600 }
  ]
};

check('only the Extras category is asked about', [isExtrasItem(fuel), isExtrasItem({ category: 'Meals' }), isExtrasItem(undefined)], [true, false, false]);
check('the charge name is the meal plan, never the season', chargeNameOf(fuel.item_rates[0]), 'Diesel');
check('a row with no charge name has none', chargeNameOf({ season_name: 'High', option_name: 'High', meal_plan: null }), '');
check('charge names come off the rows', extrasChargeNames(fuel), ['Diesel', 'Petrol']);

const groups = extrasChargeGroups(fuel);
check('one group per season, every charge inside it', [groups.map((g) => g.name), groups.map((g) => g.options.map((o) => o.label))], [
  ['High', 'Low'],
  [['Diesel', 'Petrol'], ['Petrol']]
]);
check('a season with several charges is a question', extrasHasChargeChoices(fuel), true);
check('several seasons of one charge is not', extrasHasChargeChoices(oneCharge), false);
check('the unnamed charge of an item is the item itself', extrasChargeGroups(oneCharge)[0].options.map((o) => o.label), ['Meet and greet']);
check('every charge of an unnamed item still has a price', extrasChargeGroups(oneCharge).flatMap((g) => g.options.map((o) => o.hasPrice)), [true, true]);

check('a named charge narrows to its own rows', ratesForCharge(fuel, 'Petrol').map((r) => r.id), ['r-petrol-high', 'r-petrol-low']);
check('no charge named is the whole matrix', ratesForCharge(fuel, '').length, 3);
check('an unknown charge never empties the matrix', ratesForCharge(fuel, 'Paraffin').length, 3);

check('the line reads its charge from the saved fields', [
  lineChargeLabel({ mealPlan: 'Diesel' }),
  lineChargeLabel({ meal_plan: 'Petrol' }),
  lineChargeLabel({ rate_snapshot: { meal_plan: 'Diesel' } }),
  lineChargeLabel({ rate_snapshot: { option_name: 'High' } })
], ['Diesel', 'Petrol', 'Diesel', '']);

/* -- Re-pricing keeps the line on the charge it was bought as ----------------
   A party that grows re-reads the matrix, and without the charge pinned a fuel
   line priced as Petrol quietly turns into Diesel. */
const reprice = (mealPlan) => repriceServicesForPax({
  days: [{ day_number: 1, date: '2026-12-20', services: [{ key: 's1', itemId: 'x1', name: 'Fuel', category: 'Extras', mealPlan, currencyCode: 'ZAR', pax: 2, buyPP: 100, markup: 0 }] }],
  libraryItems: [fuel],
  paxCount: 4,
  travelWindow: { start: '2026-12-15', end: '2027-01-10' }
}).days[0].services[0];

check('a grown party keeps the Petrol charge', [reprice('Petrol').buyPP, reprice('Petrol').seasonName], [120, 'High']);
check('a grown party keeps the Diesel charge', reprice('Diesel').buyPP, 200);
check('a line with no charge named falls back to the matrix', reprice('').buyPP, 200);

/* -- A package's season swap stays inside the charge ------------------------
   The suggestion exists to move a line to the season that covers the package
   dates. It must not also change what the client was sold. */
const coverage = packageSeasonCoverage(fuel, fuel.item_rates[2], [{ valid_from: '2026-12-01', valid_to: '2027-02-28' }]);
check('the swap names the same charge in the covering season', [coverage.status, coverage.coveringRateId], ['swap', 'r-petrol-high']);

/* -- Documents name the charge ------------------------------------------------
   The supplier booking the fuel has to be told which of its charges was sold. */
check('the voucher names the charge', voucherDetailLines({ category: 'Extras', mealPlan: 'Diesel' }).includes('Charge: Diesel'), true);
check('the voucher says nothing about a charge that is not named', voucherDetailLines({ category: 'Extras', mealPlan: '' }).some((line) => line.startsWith('Charge:')), false);
check('the invoice prints an extra\'s charge', showMealPlanOn({ category: 'Extras', meal_plan: 'Full tank' }, {}), true);
check('the invoice still ignores a category that sells no charges', showMealPlanOn({ category: 'Meals', meal_plan: 'Dinner' }, {}), false);
check('a written charge is not squashed into a board abbreviation', abbrevMealPlan('Fuel charge'), 'Fuel charge');
check('a board still abbreviates', abbrevMealPlan('Half Board'), 'HB');

if (process.exitCode) {
  console.log('\nSome extras charge-type checks failed.');
} else {
  console.log('\nAll extras charge-type checks passed.');
}
