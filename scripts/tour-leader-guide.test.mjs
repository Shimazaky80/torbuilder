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
  getGuideShareDivisor
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

console.log('\nAll Tour Leader and Tour Guide verification examples PASSED successfully!\n');
