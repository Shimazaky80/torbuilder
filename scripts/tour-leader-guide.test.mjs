import assert from 'node:assert/strict';
import {
  normaliseTravellerRole,
  payingClientCount,
  tourLeaderCount,
  tourGuideCount,
  travellersPlusTlCount,
  clientRoomsBooked,
  buildShareContext,
  calculateRoomCharges
} from '../src/lib/roomAllocationHelper';
import {
  guideChargeTotal,
  guideRoomRate,
  guideMealRate,
  guidePerPersonRate,
  getGuideShareDivisor,
  guideTravelRate,
  overnightRiderRate,
  guideMinClientRooms,
  guideRateApplies
} from '../src/lib/guidePricing';
import { servicePax, repriceServicesForPax } from '../src/lib/servicePricing';

const log = (msg) => console.log(`PASS  ${msg}`);

console.log('\n--- Running Tour Leader & Tour Guide Verification Tests ---\n');

// 1. Setup Travellers: 10 clients + 1 TL + 1 Tour Guide
const travellers = [
  ...Array.from({ length: 10 }, (_, i) => ({ id: `client_${i + 1}`, name: `Client ${i + 1}`, surname: 'Test', role: 'client' })),
  { id: 'tl_1', name: 'Leader', surname: 'One', role: 'tour_leader' },
  { id: 'tg_1', name: 'Guide', surname: 'Staff', role: 'tour_guide' }
];

// Helper and Share Context Verifications
const ctx = buildShareContext({ travellers });
assert.equal(ctx.payingClients, 10, 'payingClients must be 10 (clients only)');
assert.equal(ctx.tourLeaders, 1, 'tourLeaders must be 1');
assert.equal(ctx.tourGuides, 1, 'tourGuides must be 1');
assert.equal(ctx.travellersPlusTl, 11, 'travellersPlusTl must be 11 (10 clients + 1 TL)');
assert.equal(getGuideShareDivisor(travellers), 11, 'getGuideShareDivisor must return 11');
log('Share context correctly computes payingClients=10, travellersPlusTl=11, tourGuides=1');

// Backwards compatibility: missing role defaults to client
const legacyTravellers = [
  { name: 'Alice' }, // no role
  { name: 'Bob', role: undefined },
  { name: 'Charlie', role: 'tour_leader' }
];
assert.equal(payingClientCount(legacyTravellers), 2, 'Missing role defaults to client');
assert.equal(travellersPlusTlCount(legacyTravellers), 3, 'Missing role defaults to client');
log('Backwards compatibility: missing roles default to client');

// Test Example 1: 10 clients + 1 TL + 1 TG, TL takes own room, threshold met
// Hotel offers TL rate: 800 (single rate 1200, sharing 600), min rooms = 5
const hotelItem = {
  name: 'Safari Lodge',
  category: 'Accommodation',
  tour_leader_room_offered: true,
  tour_leader_min_rooms: 5,
  item_rates: [{
    currency: 'ZAR',
    rate_basis: 'per_person_sharing',
    price_1_adult: 1200,
    price_2_adults: 600,
    tour_leader_rate: 800,
    guide_rate: 400
  }]
};

// 5 client rooms (each with 2 clients) + 1 TL room + 1 TG staff room
const allocationsEx1 = [
  { roomId: 1, roomType: 'client', allocatedTravellers: [travellers[0], travellers[1]] },
  { roomId: 2, roomType: 'client', allocatedTravellers: [travellers[2], travellers[3]] },
  { roomId: 3, roomType: 'client', allocatedTravellers: [travellers[4], travellers[5]] },
  { roomId: 4, roomType: 'client', allocatedTravellers: [travellers[6], travellers[7]] },
  { roomId: 5, roomType: 'client', allocatedTravellers: [travellers[8], travellers[9]] },
  { roomId: 6, roomType: 'staff', staffRole: 'tour_leader', allocatedTravellers: [travellers[10]] }, // TL own room
  { roomId: 7, roomType: 'staff', staffRole: 'tour_guide', allocatedTravellers: [travellers[11]] }   // TG staff room
];

// clientRoomsBooked must be 5 (excluding staff room and TL own room)
const clientRoomsEx1 = clientRoomsBooked(allocationsEx1);
assert.equal(clientRoomsEx1, 5, 'clientRoomsBooked must be 5');
log('Example 1: clientRoomsBooked = 5 (staff rooms and TL room never counted)');

const chargesEx1 = calculateRoomCharges(hotelItem, allocationsEx1, 'ZAR', 0);
const tlRoomEx1 = chargesEx1.rooms.find(r => r.roomId === 6);
const tgRoomEx1 = chargesEx1.rooms.find(r => r.roomId === 7);

assert.equal(tlRoomEx1.buyCost, 800, 'TL room must use tour_leader_rate (800) because threshold of 5 client rooms is met');
assert.equal(tgRoomEx1.buyCost, 400, 'TG staff room must use guide_rate (400)');
// TL room split by 10 paying clients = 80 per paying client
const tlPerPayingClientEx1 = tlRoomEx1.buyCost / ctx.payingClients;
assert.equal(tlPerPayingClientEx1, 80, 'TL room split by 10 paying clients = 80');

// Guide fee split by 11 (travellersPlusTl)
const guideFeeTotal = 2200;
const guidePerPaxEx1 = guidePerPersonRate(guideFeeTotal, travellers, true);
assert.equal(guidePerPaxEx1, 200, 'Guide fee 2200 split by 11 travellersPlusTl = 200');
log('Example 1 Verified: TL uses tour_leader_rate (800) split by 10 = 80. Guide fee split by 11 = 200. TG not in either divisor.');

// Test Example 2: 10 clients + 1 TL + 1 TG, TL takes own room, threshold NOT met (min 8 rooms required, 5 booked)
const hotelItemEx2 = {
  ...hotelItem,
  tour_leader_min_rooms: 8
};
const chargesEx2 = calculateRoomCharges(hotelItemEx2, allocationsEx1, 'ZAR', 0);
const tlRoomEx2 = chargesEx2.rooms.find(r => r.roomId === 6);
assert.equal(tlRoomEx2.buyCost, 1200, 'TL room must fall back to normal single rate (1200) when threshold is not met');
const tlPerPayingClientEx2 = tlRoomEx2.buyCost / ctx.payingClients;
assert.equal(tlPerPayingClientEx2, 120, 'TL room split by 10 paying clients = 120');
log('Example 2 Verified: TL room charged at normal single rate (1200) split by 10 = 120. Guide fee still split by 11.');

// Test Example 3: 10 clients + 1 TL + 1 TG, TL shares with a client
const allocationsEx3 = [
  { roomId: 1, roomType: 'client', allocatedTravellers: [travellers[0], travellers[1]] },
  { roomId: 2, roomType: 'client', allocatedTravellers: [travellers[2], travellers[3]] },
  { roomId: 3, roomType: 'client', allocatedTravellers: [travellers[4], travellers[5]] },
  { roomId: 4, roomType: 'client', allocatedTravellers: [travellers[6], travellers[7]] },
  { roomId: 5, roomType: 'client', allocatedTravellers: [travellers[8], travellers[10]] }, // Client 9 + Tour Leader sharing
  { roomId: 6, roomType: 'client', allocatedTravellers: [travellers[9]] },                 // Client 10 single
  { roomId: 7, roomType: 'staff', staffRole: 'tour_guide', allocatedTravellers: [travellers[11]] } // TG staff room
];
assert.equal(clientRoomsBooked(allocationsEx3), 6, 'Client rooms count unaffected by staff room');
const chargesEx3 = calculateRoomCharges(hotelItem, allocationsEx3, 'ZAR', 0);
const sharingTlRoom = chargesEx3.rooms.find(r => r.roomId === 5);
assert.equal(sharingTlRoom.buyCost, 1200, 'Shared room with TL and client is 2 * 600 = 1200 (normal sharing rate)');
const guidePerPaxEx3 = guidePerPersonRate(guideFeeTotal, travellers, true);
assert.equal(guidePerPaxEx3, 200, 'Guide fee still split by 11, TG excluded');
log('Example 3 Verified: TL sharing with client disregards TL rule. Client rooms unaffected by staff room. Guide fee split by 11.');

// Test Example 4: Guide needed only on Day 3
const day1GuideNeeded = false;
const day2GuideNeeded = false;
const day3GuideNeeded = true;
const day4GuideNeeded = false;

const guideFeeDay1 = guidePerPersonRate(guideFeeTotal, travellers, day1GuideNeeded);
const guideFeeDay2 = guidePerPersonRate(guideFeeTotal, travellers, day2GuideNeeded);
const guideFeeDay3 = guidePerPersonRate(guideFeeTotal, travellers, day3GuideNeeded);
const guideFeeDay4 = guidePerPersonRate(guideFeeTotal, travellers, day4GuideNeeded);

assert.equal(guideFeeDay1, 0, 'Day 1 guide fee must be 0 when guide_needed=false');
assert.equal(guideFeeDay2, 0, 'Day 2 guide fee must be 0 when guide_needed=false');
assert.equal(guideFeeDay3, 200, 'Day 3 guide fee must be 200 when guide_needed=true (2200/11)');
assert.equal(guideFeeDay4, 0, 'Day 4 guide fee must be 0 when guide_needed=false');

// Meal and overnight checks with guide_needed
const rate = hotelItem.item_rates[0];
assert.equal(guideMealRate(rate, false), 0, 'Guide meal rate must be 0 when guide_needed=false');
assert.equal(guideRoomRate(rate, false), 0, 'Guide room rate must be 0 when guide_needed=false');
assert.equal(guideMealRate(rate, true), 400, 'Guide meal rate charged when guide_needed=true');
assert.equal(guideRoomRate(rate, true), 400, 'Guide room rate charged when guide_needed=true');
log('Example 4 Verified: Guide charges only fire when guide_needed=true. Days 1,2,4 charge 0; Day 3 charges 200 (divided by 11).');

// Test Example 5: the saved line divisors match the share context on reload and reprice
const guideLine = {
  name: 'Guide',
  category: 'Guide',
  buyPP: 200,
  sellPP: 240,
  markup: 20,
  pax: 11,
  guideServiceTypes: ['half_day']
};
assert.equal(servicePax({ ...guideLine, pax: undefined }, 2, ctx), 11, 'Unsaved guide line uses clients+TL (11), not the party size');
assert.equal(servicePax(guideLine, 2, ctx), 11, 'Saved guide line keeps the divisor it was priced on');
log('Example 5: guide lines read 11 (clients + TL) from the share context or the saved pax');

const tlAccommodation = {
  name: 'Safari Lodge',
  category: 'Accommodation',
  buyPP: 100,
  sellPP: 120,
  markup: 20,
  pax: 11,
  roomAllocations: allocationsEx1
};
assert.equal(servicePax(tlAccommodation, 12, ctx), 11, 'Staff accommodation keeps the saved paying-client divisor');
assert.equal(servicePax({ ...tlAccommodation, pax: undefined }, 12, ctx), 10, 'Unsaved staff accommodation falls back to paying clients');
const clientOnlyAccommodation = {
  category: 'Accommodation',
  pax: 4,
  roomAllocations: [{ roomType: 'client', allocatedTravellers: [travellers[0], travellers[1]] }]
};
assert.equal(servicePax(clientOnlyAccommodation, 12, ctx), 2, 'Client-only accommodation keeps its bed count');
log('Example 5: staff accommodation divides by paying clients; client-only rooms keep the bed count');

const repricedGuide = repriceServicesForPax({
  days: [{ services: [{ ...guideLine, buyPP: 550, pax: 2 }] }],
  paxCount: 12,
  travellers
});
const repricedGuideLine = repricedGuide.days[0].services[0];
assert.equal(repricedGuideLine.pax, 11, 'Guide reprice stores the clients+TL divisor');
assert.equal(repricedGuideLine.buyPP, 100, 'Guide flat R1100 re-split across 11');
log('Example 5: guide reprice keeps the flat total while switching the divisor to 11');

const repricedStaffRoom = repriceServicesForPax({
  days: [{ services: [{ ...tlAccommodation, sellPP: 120, pax: 11 }] }],
  paxCount: 12,
  travellers
});
const repricedStaffLine = repricedStaffRoom.days[0].services[0];
assert.equal(repricedStaffLine.pax, 10, 'Accommodation reprice stores the paying-client divisor');
assert.equal(repricedStaffLine.buyPP, 110, 'Accommodation R1100 total re-split across 10 clients');
assert.equal(repricedStaffLine.buyPP * repricedStaffLine.pax, 1100, 'Accommodation reprice keeps the contracted total');
log('Example 5: staff-room accommodation reprice keeps the contracted total across paying clients');

// Test Example 6: a configured 0 is a free tour leader room, not a fallback
const freeTlItem = {
  ...hotelItem,
  item_rates: [{ ...hotelItem.item_rates[0], tour_leader_rate: 0 }]
};
const freeCharges = calculateRoomCharges(freeTlItem, allocationsEx1, 'ZAR', 0);
const freeTlRoom = freeCharges.rooms.find(r => r.roomId === 6);
assert.equal(freeTlRoom.buyCost, 0, 'A configured 0 TL rate charges the room at 0 (free)');
assert.match(freeTlRoom.rateDescription, /Tour Leader Room Rate: 0\.00/, 'Free TL room is described as the TL rate, not the single rate');
log('Example 6: a typed 0 TL rate charges a free tour leader room');

// Test Example 7: the best tier reached sets how many TL rooms get the rate
const tieredItem = {
  ...hotelItem,
  item_rates: [{
    ...hotelItem.item_rates[0],
    tour_leader_rate: null,
    tour_leader_tiers: [
      { minClientRooms: 5, rooms: 1, rate: 0 },
      { minClientRooms: 10, rooms: 2, rate: 500 }
    ]
  }]
};
const tierTravellers = [
  ...travellers.slice(0, 10),
  { id: 'tl_2', name: 'Leader', surname: 'Two', role: 'tour_leader' },
  { id: 'tl_3', name: 'Leader', surname: 'Three', role: 'tour_leader' }
];
// 10 single-client rooms -> the 10-room tier; three TL rooms competing for two included rooms.
const tieredAllocations = [
  ...tierTravellers.slice(0, 10).map((t, i) => ({ roomId: i + 1, roomType: 'client', allocatedTravellers: [t] })),
  { roomId: 11, roomType: 'staff', staffRole: 'tour_leader', allocatedTravellers: [travellers[10]] },
  { roomId: 12, roomType: 'staff', staffRole: 'tour_leader', allocatedTravellers: [tierTravellers[10]] },
  { roomId: 13, roomType: 'staff', staffRole: 'tour_leader', allocatedTravellers: [tierTravellers[11]] }
];
assert.equal(clientRoomsBooked(tieredAllocations), 10, 'Ten single-client rooms count as ten client rooms');
const tieredCharges = calculateRoomCharges(tieredItem, tieredAllocations, 'ZAR', 0);
const tlOne = tieredCharges.rooms.find(r => r.roomId === 11);
const tlTwo = tieredCharges.rooms.find(r => r.roomId === 12);
const tlThree = tieredCharges.rooms.find(r => r.roomId === 13);
assert.equal(tlOne.buyCost, 0, 'First TL room is free at the 10-room tier');
assert.equal(tlTwo.buyCost, 500, 'Second TL room takes the tier rate');
assert.equal(tlThree.buyCost, 1200, 'Third TL room pays the normal single rate once the allowance is used');
assert.match(tlThree.rateDescription, /allowance of 2 room\(s\) used/, 'Excess TL room explains why it is not on the TL rate');
log('Example 7: the best tier met opens two TL rooms at 0 and 500; the third pays single (1200)');

// Test Example 8: the lower tier applies until the next threshold is reached
const lowTierAllocations = [
  ...tieredAllocations.slice(0, 5),
  { roomId: 21, roomType: 'staff', staffRole: 'tour_leader', allocatedTravellers: [travellers[10]] },
  { roomId: 22, roomType: 'staff', staffRole: 'tour_leader', allocatedTravellers: [tierTravellers[10]] }
];
const lowTierCharges = calculateRoomCharges(tieredItem, lowTierAllocations, 'ZAR', 0);
assert.equal(lowTierCharges.rooms.find(r => r.roomId === 21).buyCost, 0, 'Five client rooms meet the 5-room tier: first TL room free');
assert.equal(lowTierCharges.rooms.find(r => r.roomId === 22).buyCost, 1200, 'The 5-room tier includes only one TL room: the second pays single');
log('Example 8: tier thresholds step up as more client rooms are booked');

// Test Example 9: below every threshold the TL room prices at the single rate
const belowTierAllocations = [
  ...tieredAllocations.slice(0, 2),
  { roomId: 31, roomType: 'staff', staffRole: 'tour_leader', allocatedTravellers: [travellers[10]] }
];
const belowTierCharges = calculateRoomCharges(tieredItem, belowTierAllocations, 'ZAR', 0);
assert.equal(belowTierCharges.rooms.find(r => r.roomId === 31).buyCost, 1200, 'No tier reached: TL room pays the single rate');
log('Example 9: no TL tier reached falls back to the normal single rate');

// Test Example 10: a season rate without the item offering a TL deal changes nothing
const noTlDeal = { ...hotelItem, tour_leader_room_offered: false };
const noTlCharges = calculateRoomCharges(noTlDeal, allocationsEx1, 'ZAR', 0);
assert.equal(noTlCharges.rooms.find(r => r.roomId === 6).buyCost, 1200, 'Without the TL deal the TL room pays the single rate');
log('Example 10: a TL rate on the season is ignored unless the property offers the deal');

// Test Example 11: the guide rate is gated on the property's minimum client rooms
const guideThresholdHotel = { ...hotelItem, guide_min_rooms: 8 };
const guideBelowCharges = calculateRoomCharges(guideThresholdHotel, allocationsEx1, 'ZAR', 0);
const guideBelowRoom = guideBelowCharges.rooms.find(r => r.roomId === 7);
assert.equal(guideBelowRoom.buyCost, 1200, 'Guide room falls back to the single rate when 5 client rooms are below the 8-room threshold');
assert.match(guideBelowRoom.rateDescription, /Threshold of 8 client rooms not met: 5 booked/, 'Guide room explains the missed threshold');

const guideMetCharges = calculateRoomCharges({ ...hotelItem, guide_min_rooms: 5 }, allocationsEx1, 'ZAR', 0);
const guideMetRoom = guideMetCharges.rooms.find(r => r.roomId === 7);
assert.equal(guideMetRoom.buyCost, 400, 'Guide rate applies when the client-room threshold is met exactly');

const guideNoThreshold = calculateRoomCharges(hotelItem, allocationsEx1, 'ZAR', 0);
assert.equal(guideNoThreshold.rooms.find(r => r.roomId === 7).buyCost, 400, 'An unset guide threshold keeps the guide rate');
log('Example 11: guide room uses guide_rate at/above the client-room threshold and the single rate below it');

// Test Example 12: the guide and driver beds share the property's threshold
const guideBedRate = hotelItem.item_rates[0];
assert.equal(guideTravelRate(guideBedRate, true, { clientRooms: 5, minRooms: 8 }), 1200, 'Guide bed below the threshold prices at the single rate');
assert.equal(guideTravelRate(guideBedRate, true, { clientRooms: 8, minRooms: 8 }), 400, 'Guide bed at the threshold prices at the guide rate');
assert.equal(guideTravelRate(guideBedRate, true, { clientRooms: undefined, minRooms: 8 }), 400, 'An unknown room count keeps the guide rate');
assert.equal(overnightRiderRate({ ...guideBedRate, driver_rate: 350 }, 'driver', true, { clientRooms: 5, minRooms: 8 }), 1200, 'The driver bed below the shared threshold pays the single rate');
assert.equal(overnightRiderRate({ ...guideBedRate, driver_rate: 350 }, 'driver', true, { clientRooms: 8, minRooms: 8 }), 350, 'The driver bed at the shared threshold takes the driver rate');
assert.equal(guideMinClientRooms({ guide_min_rooms: 8 }), 8, 'Item threshold reads guide_min_rooms');
assert.equal(guideMinClientRooms({}), 1, 'An unset threshold defaults to one client room');
assert.equal(guideRateApplies(undefined, 8), true, 'No client-room count leaves the rate applicable');
log('Example 12: guide and driver overnight rates both follow the Min Client Rooms rule');

// Test Example 13: guide and driver have independent TL-style ladders
const driverTraveller = { id: 'drv_1', name: 'Driver', surname: 'Staff', role: 'driver' };
const tieredStaffItem = {
  name: 'Tiered Lodge',
  category: 'Accommodation',
  guide_driver_room_offered: true,
  item_rates: [{
    currency: 'ZAR',
    rate_basis: 'per_person_sharing',
    price_1_adult: 1200,
    price_2_adults: 600,
    guide_rate: 400,
    driver_rate: 350,
    guide_tiers: [
      { minClientRooms: 5, rooms: 1, rate: 0 },
      { minClientRooms: 8, rooms: 2, rate: 300 }
    ],
    driver_tiers: [{ minClientRooms: 6, rooms: 1, rate: 250 }]
  }]
};

const staffAllocations = (clientRooms, extraGuide = false) => [
  ...Array.from({ length: clientRooms }, (_, i) => ({
    roomId: i + 1,
    roomType: 'client',
    allocatedTravellers: [{ name: `Client ${i}a` }, { name: `Client ${i}b` }]
  })),
  { roomId: 101, roomType: 'staff', staffRole: 'tour_guide', allocatedTravellers: [travellers[11]] },
  { roomId: 102, roomType: 'staff', staffRole: 'driver', allocatedTravellers: [driverTraveller] },
  ...(extraGuide
    ? [{ roomId: 103, roomType: 'staff', staffRole: 'tour_guide', allocatedTravellers: [{ name: 'Second guide' }] }]
    : [])
];

const fiveClientCharges = calculateRoomCharges(tieredStaffItem, staffAllocations(5), 'ZAR', 0);
assert.equal(fiveClientCharges.rooms.find(r => r.roomId === 101).buyCost, 0, 'Five client rooms include the guide room free');
assert.equal(fiveClientCharges.rooms.find(r => r.roomId === 102).buyCost, 1200, 'The driver ladder starts at six client rooms, so five pays single');

const sixClientCharges = calculateRoomCharges(tieredStaffItem, staffAllocations(6), 'ZAR', 0);
assert.equal(sixClientCharges.rooms.find(r => r.roomId === 102).buyCost, 250, 'Six client rooms earn the driver rate');
assert.equal(sixClientCharges.rooms.find(r => r.roomId === 101).buyCost, 0, 'The guide ladder is judged separately from the driver ladder');

const eightClientCharges = calculateRoomCharges(tieredStaffItem, staffAllocations(8, true), 'ZAR', 0);
assert.equal(eightClientCharges.rooms.find(r => r.roomId === 101).buyCost, 0, 'The first guide room stays free at the higher threshold');
assert.equal(eightClientCharges.rooms.find(r => r.roomId === 103).buyCost, 300, 'The second guide room earns the discounted tier rate');

const tieredStaffRate = tieredStaffItem.item_rates[0];
assert.equal(guideTravelRate(tieredStaffRate, true, { clientRooms: 5, tiers: tieredStaffRate.guide_tiers }), 0, 'Guide overnight is free once the five-room tier is met');
assert.equal(guideTravelRate(tieredStaffRate, true, { clientRooms: 4, tiers: tieredStaffRate.guide_tiers }), 1200, 'Guide overnight below every tier pays the single rate');
assert.equal(overnightRiderRate(tieredStaffRate, 'driver', true, { clientRooms: 6, tiers: tieredStaffRate.driver_tiers }), 250, 'Driver overnight uses its own tier');
assert.equal(overnightRiderRate(tieredStaffRate, 'driver', true, { clientRooms: 5, tiers: tieredStaffRate.driver_tiers }), 1200, 'Driver overnight below its tier pays the single rate');
log('Example 13: guide and driver room rules are independent ladders with free and discounted rooms');

// Test Example 14: a ladder that keeps the room count is a rate band, not a no-op.
// 1–10 client rooms include one guide/driver/TL room at 800; from 11 it is 650.
const bandLadder = [
  { minClientRooms: 1, rooms: 1, rate: 800 },
  { minClientRooms: 11, rooms: 1, rate: 650 }
];
const bandedItem = {
  ...hotelItem,
  guide_driver_room_offered: true,
  item_rates: [{
    ...hotelItem.item_rates[0],
    tour_leader_rate: null,
    guide_rate: null,
    driver_rate: null,
    tour_leader_tiers: bandLadder,
    guide_tiers: bandLadder,
    driver_tiers: bandLadder
  }]
};
const bandRoom = (charges, roomId) => charges.rooms.find(r => r.roomId === roomId);

const tenClientCharges = calculateRoomCharges(bandedItem, staffAllocations(10), 'ZAR', 0);
assert.equal(bandRoom(tenClientCharges, 101).buyCost, 800, 'Ten client rooms pay the 1–10 guide band');
assert.equal(bandRoom(tenClientCharges, 102).buyCost, 800, 'Ten client rooms pay the 1–10 driver band');

const elevenClientCharges = calculateRoomCharges(bandedItem, staffAllocations(11), 'ZAR', 0);
assert.equal(bandRoom(elevenClientCharges, 101).buyCost, 650, 'Eleven client rooms move the guide room to the 650 band');
assert.equal(bandRoom(elevenClientCharges, 102).buyCost, 650, 'Eleven client rooms move the driver room to the 650 band');

const bandRate = bandedItem.item_rates[0];
assert.equal(guideTravelRate(bandRate, true, { clientRooms: 10, tiers: bandRate.guide_tiers }), 800, 'The guide overnight holds 800 up to the tenth client room');
assert.equal(guideTravelRate(bandRate, true, { clientRooms: 11, tiers: bandRate.guide_tiers }), 650, 'The guide overnight drops to 650 at the eleventh client room');

const elevenWithTl = calculateRoomCharges(bandedItem, [
  ...staffAllocations(11),
  { roomId: 104, roomType: 'staff', staffRole: 'tour_leader', allocatedTravellers: [travellers[10]] }
], 'ZAR', 0);
assert.equal(bandRoom(elevenWithTl, 104).buyCost, 650, 'The tour leader room follows the same 11+ band');
const tenWithTl = calculateRoomCharges(bandedItem, [
  ...staffAllocations(10),
  { roomId: 103, roomType: 'staff', staffRole: 'tour_leader', allocatedTravellers: [travellers[10]] }
], 'ZAR', 0);
assert.equal(bandRoom(tenWithTl, 103).buyCost, 800, 'The tour leader room stays at 800 through ten client rooms');
log('Example 14: a repeated room count with a new rate prices later client-room bands');

console.log('\nAll Tour Leader and Tour Guide verification examples PASSED successfully!\n');
