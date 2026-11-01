/* Lodging hierarchy: supplier -> property (library item) -> room type -> rate
   plan. These checks pin the rules every screen and document shares: a rate row
   names and sleeps its room, seasons never mix rooms, the package sizes its
   rooms from the room that was sold, and the rate card prints the room. */
import {
  normalizeRoomTypes,
  roomForRate,
  roomMatchesRate,
  ratesForRoom,
  roomsFromRates,
  roomCapacityOf,
  roomOccupancyForRate,
  serviceRoomName
} from '../src/lib/roomTypes.js';
import {
  accommodationHasChoices,
  accommodationRoomChoices,
  accommodationSeasonChoices,
  accommodationSeasonGroups
} from '../src/lib/accommodationOptions.js';
import {
  accommodationRoomCapacity,
  accommodationRoomPlan
} from '../src/lib/packagePricing.js';
import { libraryItemDetail, detailDocumentHtml } from '../src/lib/libraryItemDetail.js';
import { buildItineraryPackage } from '../src/lib/itineraryToPackage.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};
const checkJson = (label, actual, expected) => check(label, JSON.stringify(actual), JSON.stringify(expected));

const rooms = normalizeRoomTypes([
  { id: 'room-cabin', name: 'Safari Cabin', max_occupancy: 2, max_adults: 2, max_children: 1, sort_order: 2 },
  { id: 'room-family', name: 'Family Suite', max_occupancy: 4, max_adults: 2, max_children: 2, sort_order: 1 }
]);
const rates = [
  {
    id: 'rate-cabin-bb', room_type_id: 'room-cabin', room_type: 'Safari Cabin',
    room_max_occupancy: 2, room_max_adults: 2, room_max_children: 1,
    season_name: 'High season', meal_plan: 'Bed & Breakfast',
    valid_from: '2026-01-01', valid_to: '2026-12-31', currency: 'ZAR',
    rate_basis: 'per_person_sharing', price_1_adult: 1800, price_2_adults: 1400
  },
  {
    id: 'rate-cabin-hb', room_type_id: 'room-cabin', room_type: 'Safari Cabin',
    room_max_occupancy: 2, room_max_adults: 2, room_max_children: 1,
    season_name: 'High season', meal_plan: 'Half Board',
    valid_from: '2026-01-01', valid_to: '2026-12-31', currency: 'ZAR',
    rate_basis: 'per_person_sharing', price_1_adult: 2100, price_2_adults: 1700
  },
  {
    id: 'rate-family-bb', room_type_id: 'room-family', room_type: 'Family Suite',
    room_max_occupancy: 4, room_max_adults: 2, room_max_children: 2,
    season_name: 'High season', meal_plan: 'Bed & Breakfast',
    valid_from: '2026-01-01', valid_to: '2026-12-31', currency: 'ZAR',
    rate_basis: 'per_person_sharing', price_1_adult: 2400, price_2_adults: 1900
  }
];
const item = {
  id: 'property', name: 'River Lodge', category: 'Accommodation',
  max_occupancy: 4, currency: 'ZAR',
  roomTypes: rooms,
  item_rates: rates
};

/* --- Room records ------------------------------------------------------- */
checkJson('room types sort by the operator\'s order', rooms.map((room) => room.name), ['Family Suite', 'Safari Cabin']);
check('a room keeps its sleeping capacity', roomCapacityOf(rooms[0]), 4);
check('adults cannot exceed the room capacity', rooms[0].maxAdults, 2);
check('a missing room capacity falls back to two', roomCapacityOf({ name: 'Legacy room' }), 2);
/* Three readings of a room's child beds, all of which used to collapse into one
   number: a cap the property states, a room that takes no children, and a
   property that does not tell adults and children apart at all. */
checkJson('a room that states a child cap keeps it', roomOccupancyForRate({ room_max_occupancy: 4, room_max_children: 2 }),
  { maxOccupancy: 4, maxAdults: 4, maxChildren: 2 });
checkJson('a room typed zero takes no children', roomOccupancyForRate({ room_max_occupancy: 4, room_max_children: 0 }),
  { maxOccupancy: 4, maxAdults: 4, maxChildren: 0 });
checkJson('a room with no child cap states none', roomOccupancyForRate({ room_max_occupancy: 4, room_max_children: null }),
  { maxOccupancy: 4, maxAdults: 4, maxChildren: null });
check('a child cap above the beds reads as the room full of children',
  normalizeRoomTypes([{ id: 'r', name: 'Villa', max_occupancy: 6, max_children: 22 }])[0].maxChildren, 6);
check('a derived room with no child figure on its rate states none',
  roomsFromRates([{ room_type_id: 'r9', room_type: 'Loft', room_max_occupancy: 4 }])[0].maxChildren, null);
checkJson(
  'occupancy is read off the rate row',
  roomOccupancyForRate({ room_max_occupancy: 4, room_max_adults: 3, room_max_children: 1 }),
  { maxOccupancy: 4, maxAdults: 3, maxChildren: 1 }
);

check('a rate finds its room by id', roomForRate(rates[0], rooms)?.name, 'Safari Cabin');
check('a rate finds its room by name when the id is gone', roomForRate({ room_type: 'family suite' }, rooms)?.id, 'room-family');
check('a legacy rate belongs to no room', roomForRate({ id: 'old' }, rooms), null);
check('a room matches its own rate', roomMatchesRate(rooms[1], rates[1]), true);
check('a room does not match another room\'s rate', roomMatchesRate(rooms[1], rates[2]), false);

check('a room scopes the rate pool', ratesForRoom(rates, rooms[1]).length, 2);
check('no room keeps the whole pool', ratesForRoom(rates, null).length, 3);
check('an unrecognised room keeps the whole pool', ratesForRoom(rates, { name: 'Unknown' }).length, 3);
checkJson('rooms can be rebuilt from rate rows alone', roomsFromRates(rates).map((room) => `${room.name}:${room.maxOccupancy}`), ['Safari Cabin:2', 'Family Suite:4']);

/* --- Seasons never mix rooms -------------------------------------------- */
checkJson('the drop offers both rooms', accommodationRoomChoices(item).map((room) => room.name), ['Family Suite', 'Safari Cabin']);
check('more than one room means the drop asks', accommodationHasChoices(item), true);
check('a one-room property with one price adds straight away', accommodationHasChoices({
  ...item,
  roomTypes: [rooms[1]],
  item_rates: [rates[0]]
}), false);

const cabinSeasons = accommodationSeasonChoices(item, rooms[1]);
check('one room sees only its own season', cabinSeasons.length, 1);
checkJson(
  'the cabin season offers both charge types',
  cabinSeasons[0].options.map((option) => option.label),
  ['Bed & Breakfast', 'Half Board']
);
check('the cabin season never prices the suite', cabinSeasons[0].options.every((option) => option.rateId === 'rate-cabin-bb' || option.rateId === 'rate-cabin-hb'), true);
const familySeasons = accommodationSeasonGroups(item, rooms[0]);
check('the suite season offers only its own charge type', familySeasons[0].options.length, 1);
check('the suite is priced from the suite rate', familySeasons[0].options[0].rateId, 'rate-family-bb');

/* --- Packages size rooms from the room that was sold -------------------- */
const stay = (snapshot, capacity) => ({
  category: 'Accommodation',
  item_name: 'River Lodge',
  vehicle_capacity: capacity,
  rate_snapshot: snapshot
});
const cabinPlan = accommodationRoomPlan(stay(rates[0], 2), item, { pax: 4 });
const familyPlan = accommodationRoomPlan(stay(rates[2], 4), item, { pax: 4 });
check('a party of four in two-sleeper cabins needs two rooms', cabinPlan.roomCount, 2);
check('a party of four in a family suite needs one room', familyPlan.roomCount, 1);
check('the plan reports the room capacity, not the property maximum', cabinPlan.capacity, 2);
const legacyPlan = accommodationRoomPlan({ category: 'Accommodation' }, item, { pax: 5 });
check('a line without a room falls back to the property capacity', legacyPlan.roomCount, 2);
check(
  'the smallest room in the quote sizes the presentation',
  accommodationRoomCapacity({
    days: [{ services: [stay(rates[0], 2), stay(rates[2], 4)] }],
    library: [item]
  }),
  2
);

/* --- Rate cards print the room ------------------------------------------ */
const detail = libraryItemDetail({ item });
const roomFact = detail.facts.find((fact) => fact.label === 'Room types');
check('the rate card lists the property\'s rooms', roomFact?.value, 'Family Suite (sleeps 4) · Safari Cabin (sleeps 2)');
const cabinCard = detail.seasons.find((season) => season.key === 'rate-cabin-bb');
check('the season card names its room', cabinCard?.chips.includes('Safari Cabin'), true);
const exported = detailDocumentHtml(detail);
check('the exported card carries the room list', exported.includes('Room types'), true);
check('the exported card names the room', exported.includes('Safari Cabin'), true);

/* --- Converting an itinerary keeps the room ----------------------------- */
const converted = buildItineraryPackage({
  meta: {
    itineraryName: 'Lodge stay',
    numAdults: 2,
    travellers: [{ role: 'client', age: 35 }, { role: 'client', age: 38 }]
  },
  days: [{
    services: [{
      key: 'stay-1', itemId: 'property', name: 'River Lodge', category: 'Accommodation',
      supplierName: 'River Lodge', currencyCode: 'ZAR', basis: 'per_person_sharing',
      buyPP: 1400, quantity: 1, maxOccupancy: 2,
      roomTypeId: 'room-cabin', roomType: 'Safari Cabin',
      item_rates: [rates[0]]
    }]
  }],
  libraryItems: [item],
  fallbackPax: 2,
  travelWindow: { start: '2026-07-01', end: '2026-07-03' },
  currencyCode: 'ZAR'
});
const convertedLine = converted.days[0].items[0];
check('the package line keeps the room id', convertedLine.room_type_id, 'room-cabin');
check('the package line keeps the room name', convertedLine.room_type, 'Safari Cabin');
check('the package line carries the room capacity', convertedLine.vehicle_capacity, 2);

const nonStayLine = buildItineraryPackage({
  meta: { travellers: [{ role: 'client', age: 35 }] },
  days: [{ services: [{
    key: 'transfer-1', itemId: 'transfer', name: 'Transfer', category: 'Transfers',
    currencyCode: 'ZAR', basis: 'per_vehicle', buyPP: 500, quantity: 1
  }] }],
  libraryItems: [{
    id: 'transfer', name: 'Transfer', category: 'Transfers', max_occupancy: 4,
    item_rates: [{ id: 'transfer-rate', currency: 'ZAR', rate_basis: 'per_vehicle', unit_price: 500 }]
  }],
  travelWindow: { start: '2026-07-01', end: '2026-07-03' },
  currencyCode: 'ZAR'
}).days[0].items[0];
check('a transfer never claims a room', nonStayLine.room_type, '');
check('a transfer keeps its own capacity', nonStayLine.vehicle_capacity, 4);

check('a service name is read for documents', serviceRoomName({ roomType: 'Safari Cabin' }), 'Safari Cabin');

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll lodging room-type checks passed');
