/* Fuel allowance: which vehicles fuel themselves and which need an allowance.
 *
 * A vehicle provider's tariff either includes fuel or expects the operator to
 * carry it. That is a contract fact (fuel_included), tri-state so a legacy row
 * that never stated it does not start nagging. The allowance is the operator's
 * own Extras fuel charge, landed as ONE line linked to the vehicle. These checks
 * cover the pure rules both builders lean on: the flag round-trip, what counts as
 * a fuel charge and a vehicle, one entry per vehicle product, and the inline
 * refusals that stop a double bill or a second allowance.
 */
import {
  FUEL_INCLUDED_OPTIONS,
  fuelIncludedOf,
  fuelIncludedLabel,
  fuelFlagToColumn,
  fuelFlagFromColumn,
  isFuelChargeName,
  itemHasFuelCharge,
  isFuelAllowanceLine,
  isVehicleProviderLine,
  fuelVehiclesFromItinerary,
  fuelVehiclesFromPackage,
  fuelVehicleOptions,
  fuelBlockMessage
} from '../src/lib/fuelAllowance';

const check = (label, actual, expected) => {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  if (!passed) process.exitCode = 1;
};

/* -- The tariff flag is tri-state ------------------------------------------
   Only an explicit false prompts for an allowance; only an explicit true refuses
   one. A row that never stated it reads null and is left alone. */
check('an included tariff reads true', fuelIncludedOf({ fuel_included: true }), true);
check('an excluded tariff reads false', fuelIncludedOf({ fuel_included: false }), false);
check('a never-stated tariff reads null', [
  fuelIncludedOf({ fuel_included: null }),
  fuelIncludedOf({}),
  fuelIncludedOf(undefined)
], [null, null, null]);
check('a truthy non-boolean is not "included"', fuelIncludedOf({ fuel_included: 'yes' }), null);

check('the flag prints only when stated', [
  fuelIncludedLabel(true), fuelIncludedLabel(false), fuelIncludedLabel(null)
], ['Fuel included', 'Fuel excluded', '']);

check('the editor flag round-trips through the column', [
  fuelFlagToColumn('included'), fuelFlagToColumn('excluded'), fuelFlagToColumn(''),
  fuelFlagFromColumn(true), fuelFlagFromColumn(false), fuelFlagFromColumn(null)
], [true, false, null, 'included', 'excluded', '']);
check('the editor offers not-stated, included and excluded', FUEL_INCLUDED_OPTIONS.map((o) => o.id), ['', 'included', 'excluded']);

/* -- What counts as a fuel charge ------------------------------------------ */
check('the trade names are fuel charges', [
  isFuelChargeName('Fuel charge'), isFuelChargeName('Petrol'), isFuelChargeName('Diesel'),
  isFuelChargeName('Full tank'), isFuelChargeName('Fuel allowance'), isFuelChargeName('DIESEL')
], [true, true, true, true, true, true]);
check('a non-fuel charge is not', [isFuelChargeName('Meet and greet'), isFuelChargeName('Porterage'), isFuelChargeName('')], [false, false, false]);

const fuelItem = {
  id: 'x1', name: 'Fuel', category: 'Extras',
  item_rates: [{ id: 'r1', meal_plan: 'Diesel', unit_price: 200 }]
};
const plainExtra = {
  id: 'x2', name: 'Meet and greet', category: 'Extras',
  item_rates: [{ id: 'r2', meal_plan: null, unit_price: 500 }]
};
check('an Extras item with a fuel charge is an allowance source', itemHasFuelCharge(fuelItem), true);
check('an Extras item with no fuel charge is not', itemHasFuelCharge(plainExtra), false);
check('a non-Extras item is never an allowance source', itemHasFuelCharge({ ...fuelItem, category: 'Meals' }), false);
check('an unnamed charge falls back to the item name', itemHasFuelCharge({ id: 'x3', name: 'Fuel allowance', category: 'Extras', item_rates: [{ id: 'r3', meal_plan: null }] }), true);

/* -- A saved allowance line ------------------------------------------------ */
check('an Extras line sold as fuel is an allowance', [
  isFuelAllowanceLine({ category: 'Extras', mealPlan: 'Diesel' }),
  isFuelAllowanceLine({ category: 'Extras', rate_snapshot: { meal_plan: 'Full tank' } }),
  isFuelAllowanceLine({ category: 'Extras', item_name: 'Fuel allowance' })
], [true, true, true]);
check('a non-fuel Extras line is not', isFuelAllowanceLine({ category: 'Extras', mealPlan: 'Meet and greet', item_name: 'Meet and greet' }), false);
check('a fuel-named line in another category is not', isFuelAllowanceLine({ category: 'Meals', mealPlan: 'Diesel' }), false);

/* -- What counts as a vehicle ----------------------------------------------
   The hire's paperwork fee is not a vehicle, and neither is anything the vehicle
   merely carries. */
check('transfers, transport and hire blocks are vehicles', [
  isVehicleProviderLine({ category: 'Transfers' }),
  isVehicleProviderLine({ category: 'Transfer' }),
  isVehicleProviderLine({ category: 'Transport' }),
  isVehicleProviderLine({ category: 'Car Rental', rental: { contractFeeOnly: false } })
], [true, true, true, true]);
check('the hire fee, an activity and a flight are not', [
  isVehicleProviderLine({ category: 'Car Rental', rental: { contractFeeOnly: true } }),
  isVehicleProviderLine({ category: 'Activities' }),
  isVehicleProviderLine({ category: 'Flights' })
], [false, false, false]);

/* -- One entry per vehicle product, on its first day ----------------------- */
const library = [
  { id: 't1', name: 'Airport Transfer', category: 'Transfers', item_rates: [{ id: 'tr1', fuel_included: false }, { id: 'tr2', fuel_included: true }] },
  { id: 'c1', name: 'Kruger Hire', category: 'Car Rental', item_rates: [] }
];
const itinDays = [
  { date: '2026-12-01', dayNumber: 1, services: [
    { key: 'a', itemId: 't1', rateId: 'tr1', name: 'Airport Transfer', category: 'Transfers' },
    { key: 'b', itemId: 'c1', name: 'Kruger Hire', category: 'Car Rental', rental: { fuelIncluded: false } }
  ] },
  { date: '2026-12-02', dayNumber: 2, services: [
    { key: 'c', itemId: 'c1', name: 'Kruger Hire', category: 'Car Rental', rental: { fuelIncluded: false } },
    { key: 'd', itemId: 't1', rateId: 'tr2', name: 'Airport Transfer', category: 'Transfers' },
    { key: 'e', itemId: 'c1', name: 'Kruger Hire fee', category: 'Car Rental', rental: { contractFeeOnly: true } }
  ] }
];
const itinVehicles = fuelVehiclesFromItinerary(itinDays, library);
check('a repeated product is offered once, on its first day', itinVehicles.map((v) => [v.itemId, v.dayIndex]), [['t1', 0], ['c1', 0]]);
check('the transfer reads its flag off the priced rate row', itinVehicles[0].fuelIncluded, false);
check('the hire reads its flag off the rental snapshot', itinVehicles[1].fuelIncluded, false);
check('the itinerary labels the vehicle by its date', itinVehicles.map((v) => v.dayLabel), ['2026-12-01', '2026-12-01']);

const pkgDays = [
  { day_number: 1, services: [
    { item_key: 'pk1', item_id: 't1', item_name: 'Airport Transfer', category: 'Transfers', rate_snapshot: { fuel_included: false } },
    { item_key: 'pk2', item_id: 'c1', item_name: 'Kruger Hire', category: 'Car Rental', rental: { fuelIncluded: true } }
  ] },
  { day_number: 2, services: [
    { item_key: 'pk3', item_id: 'c1', item_name: 'Kruger Hire', category: 'Car Rental', rental: { fuelIncluded: true } }
  ] }
];
const pkgVehicles = fuelVehiclesFromPackage(pkgDays);
check('the package offers each product once', pkgVehicles.map((v) => [v.itemId, v.dayIndex]), [['t1', 0], ['c1', 0]]);
check('the package reads flags off snapshot and rental', pkgVehicles.map((v) => v.fuelIncluded), [false, true]);
check('the package labels the vehicle by its day number', pkgVehicles.map((v) => v.dayLabel), ['Day 1', 'Day 1']);

/* -- The picker refusals --------------------------------------------------- */
const options = fuelVehicleOptions([
  { itemId: 'inc', name: 'Included car', fuelIncluded: true },
  { itemId: 'exc', name: 'Excluded car', fuelIncluded: false },
  { itemId: 'cov', name: 'Covered car', fuelIncluded: false },
  { itemId: 'unk', name: 'Unstated car', fuelIncluded: null }
], ['cov']);
check('an included tariff is refused, a covered one is refused, the rest are open', options.map((o) => o.blocked), ['included', null, 'covered', null]);
check('the refusal explains the double bill', fuelBlockMessage(options[0]).includes('bill the client twice'), true);
check('the refusal explains the second allowance', fuelBlockMessage(options[2]).includes('already been added'), true);
check('an open vehicle has no refusal', fuelBlockMessage(options[1]), '');

if (process.exitCode) {
  console.log('\nSome fuel allowance checks failed.');
} else {
  console.log('\nAll fuel allowance checks passed.');
}