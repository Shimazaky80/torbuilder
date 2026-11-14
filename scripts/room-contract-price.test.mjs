/* One property, two villas, one season name — the Moditlo mispricing, pinned.
 *
 * IT-2026-000004 sold the 3-Bed Villa (4–6 pax @ 8,187) and was charged 8,603:
 * the 4-Bed Villa's 4-pax band. Both rows share a season name, validity dates
 * and board, so a room-blind season resolution let the first row in the matrix
 * win the tie. Every resolver a line passes through — the allocation dialog,
 * the window revalidator, the per-person split, the package guards and the
 * season preview — must narrow the pool to the room the line SOLD before
 * resolving, and a room with no rows of its own must refuse, never borrow its
 * sibling's ladder.
 */
import { OCCUPANCY_BASIS, occupancyRateForPax } from '../src/lib/occupancyPricing.js';
import { serviceRoomIdentity, ratesForServiceRoom, roomTypesOf } from '../src/lib/roomTypes.js';
import { resolveSeasonForTravel } from '../src/lib/priceValidity.js';
import { buildRoomModalItem, calculateRoomCharges, allocationIdentityPatch } from '../src/lib/roomAllocationHelper.js';
import { withRoomTypeRates, homogeneousRoomIdentity } from '../src/lib/roomTypePricing.js';
import { revalidateServicesForWindow } from '../src/lib/servicePricing.js';
import { computePerPersonRows } from '../src/lib/perPersonPricing.js';
import {
  accommodationPerPersonForSeason,
  accommodationRatesForTrip,
  packageSeasonCoverage,
  packageSeasonResolution
} from '../src/lib/packagePricing.js';

let failures = 0;
const check = (label, actual, expected) => {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};

const SEASON = '8 Jan 2027 – 7 Jan 2028';
const window = { start: '2027-02-01', end: '2027-02-04' };

/* Typed off the supplier sheet. The 4-Bed row sits FIRST: with both rows tied
   on span and start date, matrix order is what picked the wrong villa. */
const v4Row = {
  id: 'v4-2027', currency: 'ZAR', season_name: SEASON,
  valid_from: '2027-01-08', valid_to: '2028-01-07',
  meal_plan: 'All Inclusive', rate_basis: OCCUPANCY_BASIS,
  room_type_id: 'room-v4', room_type: '4-Bed Villa', room_max_occupancy: 8,
  occupancy_rates: [
    { min_pax: 2, max_pax: 2, rate: 17205 },
    { min_pax: 3, max_pax: 3, rate: 11471 },
    { min_pax: 4, max_pax: 4, rate: 8603 },
    { min_pax: 5, max_pax: 8, rate: 6882 }
  ]
};
const v3Row = {
  id: 'v3-2027', currency: 'ZAR', season_name: SEASON,
  valid_from: '2027-01-08', valid_to: '2028-01-07',
  meal_plan: 'All Inclusive', rate_basis: OCCUPANCY_BASIS,
  room_type_id: 'room-v3', room_type: '3-Bed Villa', room_max_occupancy: 6,
  occupancy_rates: [
    { min_pax: 2, max_pax: 2, rate: 16374 },
    { min_pax: 3, max_pax: 3, rate: 10917 },
    { min_pax: 4, max_pax: 6, rate: 8187 }
  ]
};
const moditlo = {
  id: 'moditlo', name: 'Moditlo River Lodge', category: 'Accommodation',
  currency: 'ZAR', max_occupancy: 8,
  room_types: [
    { id: 'room-v4', name: '4-Bed Villa', max_occupancy: 8 },
    { id: 'room-v3', name: '3-Bed Villa', max_occupancy: 6 }
  ],
  item_rates: [v4Row, v3Row]
};
const v3Line = {
  itemId: 'moditlo', roomTypeId: 'room-v3', roomType: '3-Bed Villa', mealPlan: 'All Inclusive'
};
const guests = (...ages) => ({ allocatedTravellers: ages.map((age, index) => ({ id: `g${index}`, age })) });

/* ---------------- The identity and the scoped pool ---------------- */
check('a camelCase line names its room', serviceRoomIdentity(v3Line), { id: 'room-v3', name: '3-Bed Villa' });
check('a snake_case line names the same room', serviceRoomIdentity({ room_type_id: 'room-v3', room_type: '3-Bed Villa' }), { id: 'room-v3', name: '3-Bed Villa' });
check('a rate row answers as the room it prices', serviceRoomIdentity(v3Row), { id: 'room-v3', name: '3-Bed Villa' });
check('a line that never named a room has no identity', [serviceRoomIdentity({}), serviceRoomIdentity(null)], [null, null]);

check('the pool narrows to the sold room by id',
  ratesForServiceRoom(moditlo.item_rates, v3Line, roomTypesOf(moditlo)).map((row) => row.id), ['v3-2027']);
check('a name-only line scopes case-insensitively',
  ratesForServiceRoom(moditlo.item_rates, { roomType: '3-bed villa' }, roomTypesOf(moditlo)).map((row) => row.id), ['v3-2027']);
check('without room records the row columns still scope',
  ratesForServiceRoom(moditlo.item_rates, { roomTypeId: 'room-v3' }, []).map((row) => row.id), ['v3-2027']);
check('a legacy line reads the whole matrix',
  ratesForServiceRoom(moditlo.item_rates, {}, roomTypesOf(moditlo)).length, 2);
check('a matrix that names no room is everyone\'s contract',
  ratesForServiceRoom([{ id: 'legacy', currency: 'ZAR' }], v3Line, []).map((row) => row.id), ['legacy']);
check('a room with no rows of its own gets an empty pool, not its sibling\'s',
  ratesForServiceRoom(moditlo.item_rates, { roomTypeId: 'room-gone', roomType: 'Garden Villa' }, roomTypesOf(moditlo)), []);

/* ---------------- The hazard, and the scoped resolution ---------------- */
/* This is the bug: over the whole matrix the tie falls to the first row, so the
   3-Bed Villa line resolved the 4-Bed Villa's ladder. Kept as a check so the
   fixture can never stop reproducing the original failure. */
check('room-blind resolution picks the first villa (the original bug)',
  resolveSeasonForTravel({ rates: moditlo.item_rates, currencyCode: 'ZAR', startDate: window.start, endDate: window.end }).rate.id, 'v4-2027');
const scopedSeason = resolveSeasonForTravel({
  rates: ratesForServiceRoom(moditlo.item_rates, v3Line, roomTypesOf(moditlo)),
  currencyCode: 'ZAR', startDate: window.start, endDate: window.end
});
check('room-scoped resolution picks the sold villa', scopedSeason.rate.id, 'v3-2027');
check('and the season covers the trip', scopedSeason.status, 'ok');

/* ---------------- The allocation dialog ---------------- */
const stamped = withRoomTypeRates(v3Row, { item: moditlo, rates: moditlo.item_rates });
check('the sold row carries both rooms\' contracts', stamped._roomTypeRates.length, 2);
const modalItem = buildRoomModalItem({
  base: moditlo,
  service: { itemId: 'moditlo', ...v3Line },
  modalRates: [stamped],
  season: { seasonName: SEASON, validFrom: '2027-01-08', validTo: '2028-01-07', status: 'ok' }
});
check('the dialog sells the 3-Bed ceiling, not the property\'s beds', modalItem.maxOccupancy, 6);
check('four guests in the sold villa pay the 4–6 band',
  calculateRoomCharges(modalItem, [guests(30, 30, 30, 30)], 'ZAR', 0).totalBuy, 32748);
const mixedNight = calculateRoomCharges(modalItem, [
  guests(30, 30, 30, 30),
  { roomTypeId: 'room-v4', roomType: '4-Bed Villa', ...guests(30, 30) }
], 'ZAR', 0);
check('a typed 4-Bed beside it pays its own 2-pax band', mixedNight.totalBuy, 32748 + 34410);
check('and neither room is refused', mixedNight.unpricedRooms.length, 0);
const overcrowded = calculateRoomCharges(modalItem, [guests(30, 30, 30, 30, 30, 30, 30)], 'ZAR', 0);
check('seven in a six-bed villa is refused, not clamped', overcrowded.totalBuy, 0);
check('the refusal names the unsold party size', overcrowded.unpricedRooms[0].reason.includes('is not sold at 7 pax'), true);

/* A sibling with no row in THIS season is refused on its own terms — a summer
   villa must never be priced from the neighbour's autumn contract. */
const v4Autumn = {
  ...v4Row, id: 'v4-autumn', season_name: '8 Jan 2028 – 7 Jan 2029',
  valid_from: '2028-01-08', valid_to: '2029-01-07'
};
const autumnOnly = { ...moditlo, item_rates: [v3Row, v4Autumn] };
const autumnStamp = withRoomTypeRates(v3Row, { item: autumnOnly, rates: autumnOnly.item_rates });
const refusedSibling = calculateRoomCharges(buildRoomModalItem({
  base: autumnOnly,
  service: { itemId: 'moditlo', ...v3Line },
  modalRates: [autumnStamp],
  season: { seasonName: SEASON, status: 'ok' }
}), [guests(30, 30, 30, 30), { roomTypeId: 'room-v4', roomType: '4-Bed Villa', ...guests(30, 30) }], 'ZAR', 0);
check('the sold villa still pays its own band', refusedSibling.totalBuy, 32748);
check('the sibling with no row in this season charges nothing', refusedSibling.unpricedRooms.length, 1);
check('and says which season lacks the price', refusedSibling.unpricedRooms[0].reason.includes('no price in the'), true);

/* ---------------- The window revalidator ---------------- */
const staleLine = (room, buyPP) => ({
  key: `line-${room.roomTypeId}`, itemId: 'moditlo', name: 'Moditlo River Lodge', category: 'Accommodation',
  currencyCode: 'ZAR', ...room, buyPP, sellPP: buyPP, pax: 4, markup: 15, quantity: 1,
  seasonName: '8 Jan 2026 – 7 Jan 2027', seasonValidFrom: '2026-01-08', seasonValidTo: '2027-01-07',
  rateSeasonStatus: 'matched', priceProtectionPercent: 0
});
const revalidated = revalidateServicesForWindow({
  days: [{ date: window.start, services: [
    staleLine(v3Line, 8603),
    staleLine({ roomTypeId: 'room-v4', roomType: '4-Bed Villa', mealPlan: 'All Inclusive' }, 8187)
  ] }],
  libraryItems: [moditlo], paxCount: 4, travelWindow: window
});
check('the mispriced 3-Bed line heals to its own contract', revalidated.days[0].services[0].buyPP, 8187);
check('its sell follows at the line\'s markup', revalidated.days[0].services[0].sellPP, 9415.05);
check('and the row stamped on it is the 3-Bed row', revalidated.days[0].services[0].item_rates[0].id, 'v3-2027');
check('the 4-Bed line keeps its own ladder', revalidated.days[0].services[1].buyPP, 8603);
check('both lines were re-derived', revalidated.repriced, 2);
check('a covered season raises no issue', revalidated.issues.length, 0);

const goneRoom = revalidateServicesForWindow({
  days: [{ date: window.start, services: [staleLine({ roomTypeId: 'room-gone', roomType: 'Garden Villa', mealPlan: 'All Inclusive' }, 8603)] }],
  libraryItems: [moditlo], paxCount: 4, travelWindow: window
});
check('a room whose rows are gone is reported', goneRoom.issues[0].reason, 'The Garden Villa room has no season prices in the library.');
check('and its price is left alone, not borrowed', goneRoom.days[0].services[0].buyPP, 8603);
check('nothing was re-priced', goneRoom.repriced, 0);

const settled = revalidateServicesForWindow({
  days: [{ date: window.start, services: [{
    ...staleLine(v3Line, 8187), sellPP: 9415.05,
    seasonName: SEASON, seasonValidFrom: '2027-01-08', seasonValidTo: '2028-01-07'
  }] }],
  libraryItems: [moditlo], paxCount: 4, travelWindow: window
});
check('a line already on the right season does not move', settled.repriced, 0);
check('its figure is untouched', settled.days[0].services[0].buyPP, 8187);

const legacy = revalidateServicesForWindow({
  days: [{ date: window.start, services: [{ ...staleLine({}, 8187), roomTypeId: undefined, roomType: undefined }] }],
  libraryItems: [moditlo], paxCount: 4, travelWindow: window
});
check('a legacy line with no room keeps whole-matrix behaviour', legacy.days[0].services[0].buyPP, 8603);

/* ---------------- The per-person split ---------------- */
const rateByCalls = [];
const split = computePerPersonRows({
  services: [{
    category: 'Accommodation', currencyCode: 'ZAR', sellPP: 9415.05, taxRate: 0,
    itemId: 'moditlo', markup: 15, ...v3Line, roomAllocations: [guests(30, 30, 30, 30)]
  }],
  travellers: [{ id: 'a', age: 30 }, { id: 'b', age: 30 }, { id: 'c', age: 30 }, { id: 'd', age: 30 }],
  rateBy: (itemId, svcRates, dayDate, sv) => {
    rateByCalls.push(sv?.roomTypeId || null);
    return v3Row;
  },
  defaultTaxRate: 0
});
check('every resolver call carries the sold room', rateByCalls.length > 0 && rateByCalls.every((id) => id === 'room-v3'), true);
check('the sharing row prints the healed figure', split.perPersonSharing.sell, 9415.05);

/* ---------------- The package guards ---------------- */
const v3Autumn = { ...v3Row, id: 'v3-autumn', season_name: '8 Jan 2028 – 7 Jan 2029', valid_from: '2028-01-08', valid_to: '2029-01-07' };
const twoSeasons = { ...moditlo, item_rates: [v4Row, v4Autumn, v3Row, v3Autumn] };
const coverage = packageSeasonCoverage(twoSeasons, v3Row, [{ valid_from: '2028-02-01', valid_to: '2028-02-10' }]);
check('a swap suggestion stays on the sold villa', coverage.status, 'swap');
check('and names the 3-Bed autumn row, not the 4-Bed one', coverage.coveringRateId, 'v3-autumn');

const protection = packageSeasonResolution({
  item: twoSeasons, rate: v3Row,
  periods: [{ valid_from: '2029-02-01', valid_to: '2029-02-10' }],
  currencyCode: 'ZAR', protectionPercent: 10
});
check('a package beyond every season is protected', protection.status, 'protected');
check('the uplift stands on the sold villa\'s ladder', occupancyRateForPax(protection.rate, 4), 9005.7);

const villaService = {
  item_id: 'moditlo', rate_id: 'v3-2027', item_name: 'Moditlo River Lodge', category: 'Accommodation',
  currency_code: 'ZAR', quantity: 1, is_included: true, room_type_id: 'room-v3', room_type: '3-Bed Villa'
};
check('the season preview quotes the sold villa\'s band',
  accommodationRatesForTrip(villaService, moditlo, window.start, window.end, null, 4).chosen.sharing, 8187);
check('a reloaded line with only a snapshot still scopes',
  accommodationRatesForTrip(
    { ...villaService, room_type_id: undefined, room_type: undefined, rate_snapshot: v3Row },
    moditlo, window.start, window.end, null, 4
  ).chosen.sharing, 8187);
const perPersonSeason = accommodationPerPersonForSeason({
  days: [{ services: [villaService] }], library: [moditlo], from: window.start, to: window.end
});
check('the season\'s accommodation figure derives from the sold room', perPersonSeason.total, 8187);
check('and derives cleanly', perPersonSeason.derived, true);

/* ---------------- The drop path: sold one villa, allocated the other ----------------
   The charge dialog resolves room-blind and pins the 4-Bed row (the tie winner).
   The operator then types Room 1 as the 3-Bed Villa in the allocation dialog. The
   drop path used to hand the dialog the sold row WITHOUT its sibling stamp, so
   rateForAllocatedRoom fell back to the 4-Bed ladder: 4 guests @ 8,603 = 34,412,
   exactly the screenshot. Stamping the siblings — as the allocate button already
   did — prices the typed room from its own contract: 4 @ 8,187 = 32,748. */
const v3RoomAllocation = { roomTypeId: 'room-v3', roomType: '3-Bed Villa', ...guests(30, 30, 30, 30) };
const dropService = { itemId: 'moditlo', roomTypeId: 'room-v4', roomType: '4-Bed Villa', mealPlan: 'All Inclusive' };
const unstampDrop = buildRoomModalItem({
  base: moditlo, service: dropService, modalRates: [v4Row],
  season: { seasonName: SEASON, status: 'ok' }
});
check('the drop dialog header reads the sold 4-Bed ceiling', unstampDrop.maxOccupancy, 8);
check('without the sibling stamp the typed 3-Bed is charged the 4-Bed band (the cross)',
  calculateRoomCharges(unstampDrop, [v3RoomAllocation], 'ZAR', 0).totalBuy, 34412);
const stampedDrop = buildRoomModalItem({
  base: moditlo, service: dropService,
  modalRates: [withRoomTypeRates(v4Row, { item: moditlo, rates: moditlo.item_rates })],
  season: { seasonName: SEASON, status: 'ok' }
});
check('with the stamp the typed 3-Bed pays its own 4–6 band',
  calculateRoomCharges(stampedDrop, [v3RoomAllocation], 'ZAR', 0).totalBuy, 32748);
check('and the room is priced, not refused',
  calculateRoomCharges(stampedDrop, [v3RoomAllocation], 'ZAR', 0).unpricedRooms.length, 0);

/* ---------------- The line identity follows a homogeneous allocation ---------------- */
check('one typed room names that room',
  homogeneousRoomIdentity([v3RoomAllocation]), { roomTypeId: 'room-v3', roomType: '3-Bed Villa' });
check('two beds of the same room still name it',
  homogeneousRoomIdentity([v3RoomAllocation, { roomTypeId: 'room-v3', roomType: '3-Bed Villa', ...guests(30, 30) }]),
  { roomTypeId: 'room-v3', roomType: '3-Bed Villa' });
check('a mixed night has no single identity',
  homogeneousRoomIdentity([v3RoomAllocation, { roomTypeId: 'room-v4', roomType: '4-Bed Villa', ...guests(30, 30) }]), null);
check('a staff bed prices on the line and is ignored',
  homogeneousRoomIdentity([v3RoomAllocation, { roomType: 'staff', ...guests(50) }]),
  { roomTypeId: 'room-v3', roomType: '3-Bed Villa' });
check('untyped legacy beds name nothing', homogeneousRoomIdentity([guests(30, 30)]), null);
check('an empty allocation names nothing', homogeneousRoomIdentity([]), null);
check('a name-only bed carries the name without an id',
  homogeneousRoomIdentity([{ roomType: '3-Bed Villa', ...guests(30) }]), { roomTypeId: null, roomType: '3-Bed Villa' });

const v4SoldLine = { itemId: 'moditlo', roomTypeId: 'room-v4', roomType: '4-Bed Villa' };
check('confirming the 3-Bed moves the line off the 4-Bed it was sold at',
  allocationIdentityPatch(v4SoldLine, [v3RoomAllocation], moditlo),
  { roomTypeId: 'room-v3', roomType: '3-Bed Villa', maxOccupancy: 6, maxAdults: 6, maxChildren: null });
check('a line already on the allocated room does not move',
  allocationIdentityPatch({ ...v3Line }, [v3RoomAllocation], moditlo), null);
check('a mixed night keeps the sold identity',
  allocationIdentityPatch(v4SoldLine, [v3RoomAllocation, { roomTypeId: 'room-v4', roomType: '4-Bed Villa', ...guests(30, 30) }], moditlo), null);
check('without the room record the identity still moves, capacity left alone',
  allocationIdentityPatch(v4SoldLine, [v3RoomAllocation], null),
  { roomTypeId: 'room-v3', roomType: '3-Bed Villa' });

/* The healed identity then re-prices on its own room, not the sibling. */
const patchedLine = { ...staleLine(v4SoldLine, 8603), ...allocationIdentityPatch(v4SoldLine, [v3RoomAllocation], moditlo) };
const patchedReval = revalidateServicesForWindow({
  days: [{ date: window.start, services: [patchedLine] }],
  libraryItems: [moditlo], paxCount: 4, travelWindow: window
});
check('a date change re-prices the allocated villa, never the sibling', patchedReval.days[0].services[0].buyPP, 8187);

if (failures) process.exitCode = 1;
else console.log('\nRoom contract pricing: all checks passed.');