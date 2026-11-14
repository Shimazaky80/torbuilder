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
import { chargesChildRate, contractPaxRate, repriceServicesForPax, revalidateServicesForWindow, sidebarLibraryRate } from '../src/lib/servicePricing';
import { calculatePackageTravellerBreakdown, packageBandCapacityError, packageIsTransport, packageItemCapacitySetupError, packageSeasonCoverage, packageServicesForTier, packageVehicleCapacity, vehicleColumnPools } from '../src/lib/packagePricing';
import { buildItineraryPackage, vehicleCapacityFromItinerary } from '../src/lib/itineraryToPackage';
import { computePerPersonRows } from '../src/lib/perPersonPricing';
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

const tollRate = {
  id: 'toll-rate', currency: 'ZAR', meal_plan: 'Toll crossing', season_name: 'Annual',
  rate_basis: 'per_vehicle', unit_price: 120, price_1_adult: 120,
  valid_from: '2026-01-01', valid_to: '2026-12-31', child_rates_breakdown: { child: 5 }
};
const toll = {
  id: 'toll', name: 'Road toll', category: 'Extras', pricing_model: 'per_vehicle',
  currency: 'ZAR', max_occupancy: 2, item_rates: [tollRate]
};
const tollLine = {
  key: 'toll-line', itemId: toll.id, name: toll.name, category: 'Extras', basis: 'per_vehicle',
  currencyCode: 'ZAR', mealPlan: 'Toll crossing', quantity: 2, pax: 2, buyPP: 120, sellPP: 144, markup: 20
};
check('one toll is shared over four travellers, not billed to four vehicles', contractPaxRate(toll, 'ZAR', 4), 30);
check('two vehicles pay two tolls even when six travellers go', contractPaxRate(toll, 'ZAR', 6, { quantity: 2, childCount: 1 }), 40);
check('vehicle Extras never charge a child rate', chargesChildRate(toll), false);
check('the sidebar shows the price of one vehicle', sidebarLibraryRate(toll, 'ZAR', 6), 120);
check('service-only Extras keep their existing flat price', contractPaxRate(oneCharge, 'ZAR', 5), 100);
check('per-person Extras still charge each guest', contractPaxRate(fuel, 'ZAR', 5), 200);

const repricedToll = repriceServicesForPax({
  days: [{ services: [tollLine] }], libraryItems: [toll], paxCount: 6,
  travelWindow: { start: '2026-11-01', end: '2026-11-03' }
}).days[0].services[0];
check('pax repricing retains two vehicles and charges the same toll total',
  [repricedToll.quantity, repricedToll.buyPP, repricedToll.sellPP, repricedToll.buyPP * repricedToll.pax], [2, 40, 48, 240]);
const updatedToll = { ...toll, item_rates: [{ ...tollRate, id: 'toll-2027', season_name: 'Next year', price_1_adult: 150, unit_price: 150, valid_from: '2027-01-01', valid_to: '2027-12-31' }] };
const revalidatedToll = revalidateServicesForWindow({
  days: [{ services: [repricedToll] }], libraryItems: [updatedToll], paxCount: 6,
  travelWindow: { start: '2027-02-01', end: '2027-02-03' }
}).days[0].services[0];
check('date repricing retains the vehicle count on the selected charge',
  [revalidatedToll.quantity, revalidatedToll.buyPP, revalidatedToll.mealPlan], [2, 50, 'Toll crossing']);

const packageToll = {
  item_key: 'package-toll', item_id: toll.id, item_name: toll.name, category: 'Extras', currency_code: 'ZAR',
  rate_basis: 'per_vehicle', rate_id: tollRate.id, rate_snapshot: tollRate, unit_cost: 120, unit_price: 120,
  quantity: 2, is_included: true, vehicle_capacity: 2
};
const tollDays = [{ services: [packageToll] }];
check('a toll needs no passenger capacity to be added', packageItemCapacitySetupError({ ...toll, max_occupancy: null }, tollRate), '');
check('a toll is not alternative transport even with inherited occupancy', packageIsTransport(packageToll, [toll]), false);
check('a toll supplies no vehicle capacity', packageVehicleCapacity(toll, tollRate), 0);
check('a toll never refuses a larger traveller band', packageBandCapacityError(tollDays, [toll], { pax: 12 }), '');
for (const pax of [1, 4, 6, 12]) {
  const breakdown = calculatePackageTravellerBreakdown({ days: tollDays, library: [toll], pattern: { pax }, childRange: { from: 2, to: 12 } });
  check(`${pax} pax still buy exactly two tolls`, [breakdown.partyTotal, breakdown.unitPerPerson, breakdown.unitChildPerPerson, breakdown.servable], [240, 240 / pax, 240 / pax, true]);
}
const noLibraryToll = calculatePackageTravellerBreakdown({ days: tollDays, pattern: { pax: 6 } });
check('a saved toll snapshot prices without the live library', noLibraryToll.partyTotal, 240);
const singleVehicleToll = calculatePackageTravellerBreakdown({ days: [{ services: [{ ...packageToll, quantity: undefined }] }], library: [toll], pattern: { pax: 6 } });
check('an unspecified vehicle count defaults to one', singleVehicleToll.partyTotal, 120);
const types = [{ code: 'car', max_capacity: 4 }, { code: 'van', max_capacity: 12 }];
const pools = vehicleColumnPools({ days: tollDays, library: [toll], vehicleTypes: types });
check('every package vehicle column includes the explicit toll quantity', [pools.pools.car, pools.pools.van, pools.perPersonFixed], [240, 240, 0]);
const staleVector = { ...packageToll, rate_snapshot: { ...tollRate, prices_by_vehicle: { car: 999 } } };
check('a vehicle Extra ignores stale seat-price vectors', calculatePackageTravellerBreakdown({ days: [{ services: [staleVector] }], library: [toll], pattern: { pax: 6 }, vehicleTypes: types }).partyTotal, 240);
check('the pool also ignores stale seat-price vectors', vehicleColumnPools({ days: [{ services: [staleVector] }], library: [toll], vehicleTypes: types }).pools, { car: 240, van: 240 });
const van = { ...packageToll, item_id: 'van', item_key: 'van', category: 'Transfers', vehicle_capacity: 12, quantity: 1, rate_snapshot: { ...tollRate, unit_price: 600, price_1_adult: 600 } };
const combinedDay = { services: [packageToll, van] };
check('a passenger vehicle cannot replace the toll line', packageServicesForTier(combinedDay, { pax: 6 }, [toll]).map((s) => s.item_key), ['package-toll', 'van']);
check('the package adds tolls to the vehicle rather than replacing it', calculatePackageTravellerBreakdown({ days: [combinedDay], library: [toll], pattern: { pax: 6 } }).partyTotal, 840);
const freeToll = { ...packageToll, unit_cost: 0, unit_price: 0, rate_snapshot: { ...tollRate, unit_price: 0, price_1_adult: 0 } };
check('an explicitly free vehicle Extra stays free', calculatePackageTravellerBreakdown({ days: [{ services: [freeToll] }], library: [toll], pattern: { pax: 6 } }).partyTotal, 0);

const converted = buildItineraryPackage({
  meta: { numAdults: 5, numChildren: 1 }, days: [{ services: [repricedToll] }], libraryItems: [toll],
  fallbackPax: 6, travelWindow: { start: '2026-11-01', end: '2026-11-03' }
});
const convertedLine = converted.days[0].items[0];
check('conversion retains vehicle basis, count and one-vehicle unit cost', [convertedLine.rate_basis, convertedLine.quantity, convertedLine.unit_cost], ['per_vehicle', 2, 120]);
check('conversion does not multiply the toll twice', calculatePackageTravellerBreakdown({ days: [{ services: [convertedLine] }], library: [toll], pattern: { pax: 6 } }).partyTotal, 240);
check('legacy capacity on an Extra cannot set package vehicle size', vehicleCapacityFromItinerary([{ services: [{ ...repricedToll, vehicle_capacity: 50 }] }], { numAdults: 6 }), 6);
const family = [{ age: 35 }, { age: 40 }, { age: 8 }];
const familyPrice = computePerPersonRows({ services: [{ ...tollLine, pax: 3, buyPP: 80, sellPP: 96 }], travellers: family, rateBy: () => tollRate });
check('the child shares the vehicle bill, not a separate toll child fare', [familyPrice.perPersonSharing.sell, familyPrice.perChild.sell], [96, 96]);
check('adult and child shares reconcile to two marked-up tolls', familyPrice.perPersonSharing.sell * 2 + familyPrice.perChild.sell, 288);

if (process.exitCode) {
  console.log('\nSome extras charge-type checks failed.');
} else {
  console.log('\nAll extras charge-type checks passed.');
}
