/* Villas and apartments priced per person by how many sleep in them.
 *
 * Pinned to a real supplier sheet: a 4-bedroom villa sold from 2 to 8 pax and a
 * 3-bedroom sold from 2 to 6. The ladder is read through one pure module, so the
 * checks below run it through every engine that quotes a room - the per-night
 * allocation, the package breakdown, the invoice split, the sidebar preview, the
 * rate card and price protection - and prove they cannot disagree.
 */
import {
  OCCUPANCY_BASIS,
  collapseOccupancyLadder,
  isOccupancyTiered,
  normalizeOccupancyLadder,
  occupancyCeiling,
  occupancyFloor,
  occupancyLadderError,
  occupancyRateForPax,
  pricedCapacity
} from '../src/lib/occupancyPricing.js';
import { calculateRoomCharges } from '../src/lib/roomAllocationHelper.js';
import { rateRoomCapacity, soldRoomCapacity } from '../src/lib/roomTypes.js';
import { accommodationRatesForTrip, accommodationRoomPlan, calculatePackageTravellerBreakdown, roomsForPax } from '../src/lib/packagePricing.js';
import { computePerPersonRows } from '../src/lib/perPersonPricing.js';
import { contractPaxRate, sidebarLibraryRate } from '../src/lib/servicePricing.js';
import { libraryItemDetail } from '../src/lib/libraryItemDetail.js';
import { applyProtectionToRate, rateHasPrice } from '../src/lib/priceValidity.js';

let failures = 0;
const check = (label, actual, expected) => {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};

/* Typed straight off the sheet: one line per party size. */
const fourBedRate = {
  id: 'villa-4b',
  rate_basis: OCCUPANCY_BASIS,
  occupancy_rates: [
    { min_pax: 2, max_pax: 2, rate: 17205 },
    { min_pax: 3, max_pax: 3, rate: 11471 },
    { min_pax: 4, max_pax: 4, rate: 8603 },
    { min_pax: 5, max_pax: 5, rate: 6882 },
    { min_pax: 6, max_pax: 6, rate: 6882 },
    { min_pax: 7, max_pax: 7, rate: 6882 },
    { min_pax: 8, max_pax: 8, rate: 6882 }
  ]
};
const threeBedRate = {
  id: 'villa-3b',
  rate_basis: OCCUPANCY_BASIS,
  occupancy_rates: [
    { min_pax: 2, max_pax: 2, rate: 16374 },
    { min_pax: 3, max_pax: 3, rate: 10917 },
    { min_pax: 4, max_pax: 6, rate: 8187 }
  ]
};

check('a villa room is recognised by its basis', isOccupancyTiered(fourBedRate), true);
check('a standard sharing room is not', isOccupancyTiered({ rate_basis: 'per_person_sharing', price_2_adults: 540 }), false);
check('a ladder stored without the basis still reads as a ladder', isOccupancyTiered({ occupancy_rates: [{ min_pax: 2, max_pax: 2, rate: 100 }] }), true);

check('the ladder reads in party order', normalizeOccupancyLadder([...fourBedRate.occupancy_rates].reverse()).map((t) => t.minPax).join(','), '2,3,4,5,6,7,8');
check('a band with no price is dropped', normalizeOccupancyLadder([{ min_pax: 2, max_pax: 2, rate: null }, { min_pax: 3, max_pax: 3, rate: 100 }]).length, 1);
check('an inverted band is dropped', normalizeOccupancyLadder([{ min_pax: 6, max_pax: 4, rate: 100 }]).length, 0);
check('a single pax column fills both ends of the band', normalizeOccupancyLadder([{ pax: 4, rate: 8603 }]), [{ minPax: 4, maxPax: 4, rate: 8603 }]);

check('each party pays its own band', [2, 3, 4, 5, 8].map((pax) => occupancyRateForPax(fourBedRate, pax)).join(','), '17205,11471,8603,6882,6882');
check('the 3-bedroom stops where its beds stop', occupancyRateForPax(threeBedRate, 6), 8187);
/* The supplier's "-" is a room that does not take them, not a discount: pricing a
   7 pax party in a 6 bed villa at the 6 pax figure would quote a stay nobody can
   honour. */
check('a party above the ceiling gets no price', occupancyRateForPax(threeBedRate, 7), null);
check('a villa not sold to one traveller gets no price', occupancyRateForPax(fourBedRate, 1), null);
check('a zero or missing party gets no price', [occupancyRateForPax(fourBedRate, 0), occupancyRateForPax(fourBedRate, null)], [null, null]);
check('the ceiling is the largest party sold', [occupancyCeiling(fourBedRate), occupancyCeiling(threeBedRate)].join(','), '8,6');
check('the floor is the smallest party sold', [occupancyFloor(fourBedRate), occupancyFloor(threeBedRate)].join(','), '2,2');

/* A rate card states a contract, not a spreadsheet: five, six, seven and eight all
   at the same figure is one band. */
check('consecutive equal rates collapse to one band', collapseOccupancyLadder(fourBedRate), [
  { minPax: 2, maxPax: 2, rate: 17205 },
  { minPax: 3, maxPax: 3, rate: 11471 },
  { minPax: 4, maxPax: 4, rate: 8603 },
  { minPax: 5, maxPax: 8, rate: 6882 }
]);
check('a band already typed as a range survives the collapse', collapseOccupancyLadder(threeBedRate).map((t) => `${t.minPax}-${t.maxPax}`).join(','), '2-2,3-3,4-6');

check('a complete ladder has nothing to report', occupancyLadderError(fourBedRate, 8), '');
check('a ladder wider than the room is refused', occupancyLadderError(threeBedRate, 4), 'The ladder sells up to 6 pax but the room only takes 4.');
check('a gap in the ladder names the missing party size', occupancyLadderError({ occupancy_rates: [{ min_pax: 2, max_pax: 3, rate: 100 }, { min_pax: 6, max_pax: 8, rate: 90 }] }, 8), 'No price for 4\u20135 pax, so a party that size cannot be quoted.');
check('a ladder with no usable band says so', occupancyLadderError({ occupancy_rates: [] }, 8), 'Add at least one occupancy band with a per-person price.');

/* ---------------- The capacity a ladder lets the operator sell ---------------- */
check('a villa sells up to its top band, not its beds', rateRoomCapacity(fourBedRate, 10), 8);
check('a 3-bedroom reads its own ceiling', soldRoomCapacity({ rate: threeBedRate, fallback: 6 }).maxOccupancy, 6);
check('a standard room keeps every bed', rateRoomCapacity({ rate_basis: 'per_person_sharing', price_2_adults: 540 }, 4), 4);
check('the ceiling is what divides the party', roomsForPax(7, pricedCapacity(threeBedRate, 6)).map((r) => r.occupants).join(','), '6,1');

/* ---------------- Room allocation engine (per night) ---------------- */
const villaFour = {
  category: 'Accommodation', name: '4-Bed Villa', currency: 'ZAR', max_occupancy: 8,
  item_rates: [{ ...fourBedRate, currency: 'ZAR' }]
};
const guests = (...ages) => ({ allocatedTravellers: ages.map((age, index) => ({ id: `g${index}`, age })) });

const twoUp = calculateRoomCharges(villaFour, [guests(30, 30)], 'ZAR', 0);
check('two guests each pay the 2 pax band', twoUp.totalBuy, 34410);
check('the band is stated on the room', twoUp.rooms[0].rateDescription, '2 Guests (Occupancy Band: 17205.00 each = 34410.00)');

/* The band is chosen by the heads in the room, not by who is an adult: a lone
   parent with two children is sold the 3 pax figure, three times over. */
const family = calculateRoomCharges(villaFour, [guests(35, 4, 9)], 'ZAR', 0);
check('one adult and two children is a 3 pax villa', family.totalBuy, 34413);
check('and no child rate is applied to it', family.rooms[0].rateDescription.includes('Child'), false);

const twoRooms = calculateRoomCharges(villaFour, [guests(30, 30, 30, 30), guests(30, 30, 10)], 'ZAR', 0);
check('each room pays its own band', twoRooms.totalBuy, (4 * 8603) + (3 * 11471));
check('a fully priced night names no unpriced room', twoRooms.unpricedRooms.length, 0);

/* A party above the top band is a second villa, not a discount. */
const tooMany = calculateRoomCharges(villaFour, [guests(...Array.from({ length: 9 }, () => 30))], 'ZAR', 0);
check('a room above the ladder is charged nothing', tooMany.totalBuy, 0);
check('and is named so the allocation cannot be saved', tooMany.unpricedRooms.map((r) => r.occupants), [9]);
check('the refusal says what is missing', tooMany.unpricedRooms[0].reason.includes('is not sold at 9 pax'), true);

/* The adult, child and supplement columns are inert on a ladder room. */
const decoy = {
  ...villaFour,
  child_age_ranges: [{ id: 'child', name: 'Child', ageFrom: 0, ageTo: 12 }],
  item_rates: [{
    ...fourBedRate, currency: 'ZAR',
    price_1_adult: 9999, price_2_adults: 555, price_3_plus_adults: 111,
    single_room_rate: 8888, unit_price: 7777, double_twin_rate: 666,
    child_rates_breakdown: { child: 100 },
    single_supplement: 500, single_supplement_tiers: [{ singles: 1, supplement: 500 }]
  }]
};
check('no other column on the row can price a ladder room',
  calculateRoomCharges(decoy, [guests(30, 30)], 'ZAR', 0).totalBuy, 34410);
check('the markup is applied to the band total', calculateRoomCharges(villaFour, [guests(30, 30)], 'ZAR', 10).totalSell, 37851);

/* ---------------- Package breakdown ---------------- */
const villaLibraryItem = (rate, beds) => ({
  id: 'villa', category: 'Accommodation', name: 'Villa', currency: 'ZAR', max_occupancy: beds,
  item_rates: [{ ...rate, currency: 'ZAR' }]
});
const villaService = (rate) => ({
  item_id: 'villa', rate_id: rate.id, item_name: 'Villa', category: 'Accommodation',
  currency_code: 'ZAR', quantity: 1, is_included: true
});

const sixPlan = accommodationRoomPlan(villaService(threeBedRate), villaLibraryItem(threeBedRate, 6), { pax: 6 });
check('the villa capacity stops at the ladder', sixPlan.capacity, 6);
check('a full villa quotes its top band per head', sixPlan.sharingPerAdult, 8187);
check('a ladder room carries no single supplement', sixPlan.singleSupplement, 0);
check('and is not blocked', sixPlan.blocked, false);

const sevenPlan = accommodationRoomPlan(villaService(threeBedRate), villaLibraryItem(threeBedRate, 6), { pax: 7 });
check('a party that outgrows the villa is blocked', sevenPlan.blocked, true);
check('the block names the room size that cannot be sold', sevenPlan.blockReason.includes('not sold at 1 pax'), true);
check('a blocked band quotes no per-head price', sevenPlan.sharingPerAdult, 0);

const sixTrip = calculatePackageTravellerBreakdown({
  days: [{ services: [villaService(threeBedRate)] }], pattern: { pax: 6 },
  library: [villaLibraryItem(threeBedRate, 6)], childRange: { ageFrom: 0, ageTo: 12 }
});
check('a 6 pax band of the villa is quotable', sixTrip.servable, true);
check('its accommodation row is the 4-6 band', sixTrip.accommodationRows[0].sharingPerAdult, 8187);
check('the night costs the villa, split six ways', sixTrip.accommodationSharing, 8187);

const sevenTrip = calculatePackageTravellerBreakdown({
  days: [{ services: [villaService(threeBedRate)] }], pattern: { pax: 7 },
  library: [villaLibraryItem(threeBedRate, 6)], childRange: { ageFrom: 0, ageTo: 12 }
});
check('a 7 pax band is not quotable off one villa', sevenTrip.servable, false);
check('and the band says why', sevenTrip.blockedVehicleReasons.join(' ').includes('not sold at 1 pax'), true);

/* ---------------- Invoice / per-person split ---------------- */
const perPerson = computePerPersonRows({
  services: [{
    category: 'Accommodation', currencyCode: 'ZAR', sellPP: 17205, taxRate: 0,
    itemId: 'villa', markup: 0, roomAllocations: [guests(30, 30)]
  }],
  travellers: [{ id: 'a', age: 30 }, { id: 'b', age: 30 }],
  rateBy: () => ({ ...fourBedRate, _ageRanges: [] }),
  defaultTaxRate: 0
});
check('the sharing row carries the band the two actually paid', perPerson.perPersonSharing.sell, 17205);
check('a ladder room shows no single supplement row', perPerson.singleSupplement.sell, 0);

const perFamily = computePerPersonRows({
  services: [{
    category: 'Accommodation', currencyCode: 'ZAR', sellPP: 11471, taxRate: 0,
    itemId: 'villa', markup: 0, roomAllocations: [guests(35, 4, 9)]
  }],
  travellers: [{ id: 'a', age: 35 }, { id: 'k1', age: 4 }, { id: 'k2', age: 9 }],
  rateBy: () => ({ ...fourBedRate, _ageRanges: [{ id: 'child', name: 'Child', ageFrom: 0, ageTo: 12 }] }),
  defaultTaxRate: 0
});
check('the child row is not discounted on a villa', perFamily.perChild.sell, 11471);

/* ---------------- Sidebar and card previews ---------------- */
const previewItem = villaLibraryItem(fourBedRate, 8);
check('the sidebar quotes the party size in the villa', contractPaxRate(previewItem, 'ZAR', 2), 17205);
check('every size down the sheet', [2, 3, 4, 5, 8].map((pax) => contractPaxRate(previewItem, 'ZAR', pax)).join(','), '17205,11471,8603,6882,6882');
/* A preview has no room to count heads in. It never prints a dash: it prints the
   band the villa is actually sold at, so the operator sees a real figure. */
check('a lone party reads the fullest band the ladder sells', sidebarLibraryRate(previewItem, 'ZAR', 1), 6882);
check('a party above the ladder reads its cheapest band', contractPaxRate(previewItem, 'ZAR', 12), 6882);

/* A season preview on the package prices the same ladder. Without a party it
   falls back to the ceiling band, so the quoting season never shows a dash. */
check('a season preview with no party quotes the ceiling band',
  accommodationRatesForTrip(villaService(fourBedRate), previewItem, null, null).chosen.sharing, 6882);
check('a season preview with a party quotes that band',
  accommodationRatesForTrip(villaService(fourBedRate), previewItem, null, null, null, 2).chosen.sharing, 17205);
check('a ladder season preview carries no single supplement',
  accommodationRatesForTrip(villaService(fourBedRate), previewItem, null, null, null, 3).chosen.supplement, 0);

/* ---------------- Rate card ---------------- */
const card = libraryItemDetail({
  item: {
    name: '4-Bed Villa', category: 'Accommodation', currency: 'ZAR', max_occupancy: 8,
    room_types: [{ id: 'v4', name: '4-Bed Villa', max_occupancy: 8, pricing_model: OCCUPANCY_BASIS }],
    child_age_ranges: [{ id: 'child', name: 'Child', ageFrom: 0, ageTo: 12 }],
    item_rates: [{ ...fourBedRate, currency: 'ZAR' }]
  }
});
const priceRows = card.seasons[0].sections.find((section) => section.key === 'prices').rows;
check('the card prints the collapsed ladder once', priceRows.map((row) => `${row.label}: ${row.value}`).join(' | '),
  '2 pax: ZAR 17,205.00 per person / night | 3 pax: ZAR 11,471.00 per person / night | 4 pax: ZAR 8,603.00 per person / night | 5–8 pax: ZAR 6,882.00 per person / night');
check('the card prints no adult, child or supplement row',
  priceRows.some((row) => /adult|child|supplement/i.test(row.label)), false);
check('the card says the room is priced by occupancy',
  card.facts.some((fact) => fact.label === 'Room types' && fact.value.includes('priced per person by occupancy')), true);

/* ---------------- Protection uplift ---------------- */
const guarded = applyProtectionToRate(fourBedRate, 10);
check('protection lifts every band', occupancyRateForPax(guarded, 2), 18925.5);
check('protection keeps every band', collapseOccupancyLadder(guarded).length, 4);
check('the original rate is left untouched', occupancyRateForPax(fourBedRate, 2), 17205);
check('a ladder-only row counts as priced',
  rateHasPrice({ currency: 'ZAR', rate_basis: OCCUPANCY_BASIS, occupancy_rates: [{ min_pax: 2, max_pax: 2, rate: 100 }] }), true);
check('a ladder row with no figure is not priced',
  rateHasPrice({ currency: 'ZAR', rate_basis: OCCUPANCY_BASIS, occupancy_rates: [{ min_pax: 2, max_pax: 2, rate: 0 }] }), false);

if (failures) process.exitCode = 1;
else console.log('\nOccupancy-tiered villas: all checks passed.');
