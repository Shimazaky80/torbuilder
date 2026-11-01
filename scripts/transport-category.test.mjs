/* Transport - suppliers that sell a vehicle and its driver, nothing else.
   The category is new, so these checks pin the whole contract: it must be read
   as transport by the band engine, bought whole and split across the party, and
   never discounted for a child. */
import {
  calculatePackageTravellerBreakdown,
  packageBandCapacityError,
  packageBandSuggestions,
  packageIsTransport,
  packageItemsForTier,
  packageItemCapacitySetupError,
  packageTransportSummary,
  packageVehicleCapacity
} from '../src/lib/packagePricing.js';
import {
  chargesChildRate,
  contractPaxRate,
  repriceServicesForPax,
  sidebarLibraryRate
} from '../src/lib/servicePricing.js';
import { libraryItemDetail, libraryItemKind } from '../src/lib/libraryItemDetail.js';
import { voucherDetailLines } from '../src/lib/voucherDetails.js';

let failures = 0;
const check = (label, actual, expected) => {
  const passed = Object.is(actual, expected);
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};

const coachRate = {
  id: 'coach-rate',
  currency: 'ZAR',
  rate_basis: 'per_vehicle',
  unit_price: 12000,
  price_1_adult: 12000,
  child_rates_breakdown: { child: 6000 }
};
const coach = {
  id: 'coach-1',
  name: '30-seat coach',
  category: 'Transport',
  currency: 'ZAR',
  sub_category: '30-Seat Bus',
  transport_type: 'overland',
  pricing_model: 'per_vehicle',
  max_occupancy: 30,
  max_adults: 30,
  child_age_ranges: [{ id: 'child', name: 'Child', ageFrom: 2, ageTo: 11 }],
  item_rates: [coachRate]
};
/* The line a saved package carries: the rate is locked into the line, so the
   engine reads the snapshot and not the live contract. */
const coachLine = {
  item_key: 'k-coach',
  item_id: coach.id,
  item_name: coach.name,
  category: 'Transport',
  rate_id: coachRate.id,
  rate_snapshot: coachRate,
  rate_basis: 'per_vehicle',
  currency_code: 'ZAR',
  quantity: 1,
  is_included: true
};
const coachDays = [{ day_number: 1, services: [coachLine] }];

check('the new category is its own kind', libraryItemKind('Transport'), 'transport');
check('a hired vehicle brings its capacity into the band engine', packageVehicleCapacity(coach, coachRate), 30);
check('a saved transport line is recognised as a vehicle', packageIsTransport(coachLine, [coach]), true);
check('a coach with a contracted capacity is fit to be added', packageItemCapacitySetupError(coach, coachRate), '');
check('a coach with no capacity set is refused', packageItemCapacitySetupError({ ...coach, max_occupancy: 0 }, coachRate).includes('no maximum occupancy set'), true);

/* The vehicle label is no longer asked of a Transport item: its name, seats and
   hire type already say what is bought. An item that was never labelled stores
   its own category in that column, and a card repeating the heading says nothing. */
const factLabels = (item) => libraryItemDetail({ item }).facts.map((fact) => fact.label);
check('a vehicle named on an older item still prints on the card', factLabels(coach).includes('Vehicle'), true);
check('an item storing only its category names no vehicle', factLabels({ ...coach, sub_category: 'Transport' }).includes('Vehicle'), false);

/* Band derivation: the party sizes a vehicle was contracted for come off the
   capacity, the same way a transfer's do. */
check('a 30-seat coach suggests a 30 pax band', packageBandSuggestions(coachDays, [coach], []).join(','), '30');
check('a band inside the coach seats its party', packageBandCapacityError(coachDays, [coach], { pax: 12 }), '');
check('a band bigger than the coach is refused', packageBandCapacityError(coachDays, [coach], { pax: 34 }).includes('largest vehicle priced for this band holds 30'), true);

/* Buying the vehicle whole: 12 travellers on a R12 000 hire share R1 000 each
   and the band still pays exactly R12 000, not twelve rounded shares. */
const quote = (pax, childRange = null) => calculatePackageTravellerBreakdown({
  days: coachDays,
  pattern: { pax },
  library: [coach],
  childRange
});
check('a party of 12 pays the coach share per head', quote(12).unitPerPerson, 1000);
check('the party re-adds to the whole contracted hire', quote(12).partyTotal, 12000);
/* The share is rounded for display, but the band total is the contract cost, so
   it comes back exact rather than a cent adrift. */
check('a 13 pax band is a rounding-free R12 000', [quote(13).unitPerPerson, quote(13).partyTotal].join(','), '923.08,12000');
check('a vehicle-only band sleeps nobody, so it has no supplement', [quote(12).hasAccommodation, quote(12).singleSupplement].join(','), 'false,0');
check('one coach reads as one vehicle on a client document', packageTransportSummary([coachLine], [coach]), '30-seat coach');

/* A party that outruns the vehicle buys another one: the hire is multiplied by
   the vehicles needed before it is shared out. */
const minibusRate = { ...coachRate, id: 'minibus-rate', unit_price: 3000, price_1_adult: 3000 };
const minibus = { ...coach, id: 'minibus-1', name: '6-seat minibus', max_occupancy: 6, item_rates: [minibusRate] };
const minibusLine = { ...coachLine, item_id: minibus.id, item_name: minibus.name, rate_id: minibusRate.id, rate_snapshot: minibusRate };
const minibusQuote = calculatePackageTravellerBreakdown({
  days: [{ day_number: 1, services: [minibusLine] }],
  pattern: { pax: 13 },
  library: [minibus]
});
check('13 travellers on 6-seat buses need three of them', minibusQuote.partyTotal, 9000);
check('the three buses are shared across the party', minibusQuote.unitPerPerson, 692.31);

/* A Transport line competes with the rest of the day's fleet on capacity, not
   on category: the band takes the smallest vehicle that seats it. */
const fleetDays = [{ day_number: 1, services: [coachLine, minibusLine] }];
check('a 12 pax band keeps only the vehicle that seats it', packageItemsForTier(fleetDays, { pax: 12 }, [coach, minibus]).map((s) => s.item_name).join(','), '30-seat coach');
check('a 4 pax band takes the smaller minibus', packageItemsForTier(fleetDays, { pax: 4 }, [coach, minibus]).map((s) => s.item_name).join(','), '6-seat minibus');

/* Space sells at adult rates: the coach contracts a child figure, and the
   engine must ignore it, because a child in a seat costs the same as an adult. */
check('a hired vehicle never charges a child rate', chargesChildRate(coach), false);
const childRange = { ageFrom: 2, ageTo: 11 };
check('a child on a coach pays the adult share', quote(12, childRange).unitChildPerPerson, 1000);
check('a coach-only party totals the same with children on it', quote(12, childRange).childTotal, 1000);
check('the itinerary splits the hire by the party, child or no child', contractPaxRate(coach, 'ZAR', 12, { childCount: 3 }), 1000);
check('the sidebar card shows the whole hire', sidebarLibraryRate(coach, 'ZAR', 12), 12000);

/* A party-size change reprices the line off the current count, not the count it
   was dropped in at. */
const staleCoach = {
  itemId: coach.id,
  name: coach.name,
  category: 'Transport',
  currencyCode: 'ZAR',
  basis: 'per_vehicle',
  buyPP: 4000,
  sellPP: 4800,
  markup: 20,
  pax: 3
};
const repriced = repriceServicesForPax({
  days: [{ services: [staleCoach] }],
  libraryItems: [coach],
  paxCount: 12,
  travelWindow: { start: '2026-10-29', end: '2026-10-30' }
}).days[0].services[0];
check('a coach moved to 12 pax is re-divided', repriced.buyPP, 1000);
check('the repriced coach still recovers the full hire', Math.round(repriced.buyPP * repriced.pax), 12000);

/* The voucher books the pick-up and the vehicle. A coach has no flight to meet,
   so it must not print the transfer's flight fields. (Every voucher opens with the
   confirmation status line, so these read the detail lines under it.) */
const detail = (sv) => voucherDetailLines(sv).slice(1).join(' | ');
check('a transport voucher carries the pick-up, vehicle and seats', detail({
  category: 'Transport',
  confirmationNumber: 'HR-4412',
  time: '07:00',
  vehicleType: '30-Seat Bus',
  capacity: 28,
  flightNumber: 'SL123'
}), 'Confirmation Number: HR-4412 | Pick up time: 07:00 | Vehicle type: 30-Seat Bus | Capacity: 28');
check('a transport voucher leaves out an absent vehicle', detail({ category: 'Transport', time: '07:00' }), 'Pick up time: 07:00');

/* The older categories are untouched by this: a transfer keeps its flight
   fields and a tour keeps its per-head pricing. */
check('a transfer voucher still prints its flight number', detail({
  category: 'Transfers', flightNumber: 'SL123', time: '06:30'
}), 'Flight number: SL123 | Pick up time: 06:30');

if (failures) process.exitCode = 1;
else console.log('\nTransport category: all checks passed.');
