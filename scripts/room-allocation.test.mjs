import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RoomAllocationModal from '../src/components/RoomAllocationModal.jsx';
import { buildLinesFromDays } from '../src/lib/invoiceDoc.js';
import { billableAtPercentage, bookingOverpayment, bookingReceivableRemaining, canBill, invoiceBalance, invoiceOverpayment, netBilled } from '../src/lib/settlement.js';
import { statementFor, statementCurrencies } from '../src/lib/statementOfAccount.js';
import { voucherDetailLines } from '../src/lib/voucherDetails.js';
import {
  allocatedTravellerCount,
  beddedTravellerCount,
  buildRoomModalItem,
  calculateRoomCharges,
  accommodationRegionConflicts,
  accommodationRegionOf,
  canJoinExistingAccommodationDestination,
  joinAccommodationSplitGroup,
  roomCapacityOfService,
  roomOverflow,
  serviceRoomCapacity,
  validateDayAccommodation,
  validateAccommodationServiceInDay,
  withRoomCapacity
} from '../src/lib/roomAllocationHelper.js';
import { roomTypesOf, soldRoomCapacity } from '../src/lib/roomTypes.js';
import { rateForAllocatedRoom, withRoomTypeRates } from '../src/lib/roomTypePricing.js';
import { computePerPersonRows, perPersonHeadBreakdown } from '../src/lib/perPersonPricing.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};

const travellers = [
  { id: 't1', name: 'Misael', surname: 'Villalobos', age: 30 },
  { id: 't2', name: 'Zoya', surname: 'Knapp', age: 30 }
];

const renderModal = ({ item, beddedElsewhere = [] }) => renderToStaticMarkup(
  React.createElement(RoomAllocationModal, {
    isOpen: true,
    onClose: () => {},
    onSave: () => {},
    item,
    itineraryTravellers: travellers,
    beddedElsewhere,
    currencyCode: 'ZAR',
    markupPct: 0
  })
);

const accommodation = (key, extra = {}) => ({
  key,
  category: 'Accommodation',
  maxOccupancy: 4,
  roomAllocations: [],
  ...extra
});

/* Alternatives cover the same party as the booked property. They must retain
   their own allocation pool instead of treating everyone as unavailable. */
const alternativeHtml = renderModal({
  item: { ...accommodation('alt', { isOptional: true }), name: 'Alt Hotel', item_rates: [] }
});
check('alternative modal offers the entire party', alternativeHtml.includes('2 pax · 2 unallocated'), true);
check('alternative modal lists both travellers', alternativeHtml.includes('Misael') && alternativeHtml.includes('Zoya'), true);
check('alternative modal asks for a room before moving anyone', alternativeHtml.includes('Add a room, then select it to move travellers in.'), true);
check('alternative cannot be treated as a group split', alternativeHtml.includes('Group split'), false);

/* The sidebar is a full roster: every traveller carries their current bed
   status, and one room is selected as the target for the arrow/drag move. */
const allocatedHtml = renderModal({
  item: {
    ...accommodation('alloc', { item_rates: [] }),
    name: 'Lodge',
    roomAllocations: [{ roomId: 1, allocatedTravellers: [travellers[0]] }]
  }
});
check('roster counts the whole party', allocatedHtml.includes('2 pax · 1 unallocated'), true);
check('roster names the selected room', allocatedHtml.includes('Selected room: Room 1'), true);
check('roster shows the current room of an allocated traveller', allocatedHtml.includes('class="room-alloc-pill is-bedded">Room 1<'), true);
check('roster shows an unallocated status', allocatedHtml.includes('class="room-alloc-pill is-unallocated">Unallocated<'), true);
check('roster exposes an arrow move to the selected room', allocatedHtml.includes('aria-label="Move Zoya Knapp to Room 1"'), true);
check('roster keeps a search box for large parties', allocatedHtml.includes('placeholder="Search traveller..."'), true);
check('roster offers a checkbox per traveller', allocatedHtml.includes('type="checkbox"') && allocatedHtml.includes('aria-label="Select Zoya Knapp"'), true);
check('roster offers bulk selection of unallocated travellers', allocatedHtml.includes('Select all unallocated'), true);
check('selected room can be auto-filled in one click', allocatedHtml.includes('>Auto-fill<'), true);
check('no auto-fill without a room to fill', alternativeHtml.includes('>Auto-fill<'), false);

/* Dropping accommodation creates the line before the dialog opens. If the
   dialog is cancelled the line is removed again, so a day with no
   accommodation is valid; a line left behind without beds is not. */
check('an unallocated dropped property blocks the night', validateDayAccommodation(
  { services: [accommodation('dropped', { name: 'Dropped Camp' })] },
  travellers
).isValid, false);
check('a cancelled drop leaves the night saveable', validateDayAccommodation(
  { services: [] },
  travellers
).isValid, true);
check('modal item preserves the alternative flag', buildRoomModalItem({
  service: accommodation('alt', { isOptional: true }),
  base: { name: 'Alt Hotel' }
}).isOptional, true);
check('alternative validation ignores allocation coverage', validateAccommodationServiceInDay(
  accommodation('alt', { isOptional: true }),
  [accommodation('booked', {
    roomAllocations: [{ roomId: 1, allocatedTravellers: travellers }]
  })],
  travellers
).isValid, true);

/* The second split property offers only travelers who still need a bed. */
const firstSplit = accommodation('split-1', {
  name: 'Camp',
  splitGroupId: 'group-1',
  roomAllocations: [{ roomId: 1, allocatedTravellers: [travellers[0]] }]
});
const secondSplit = accommodation('split-2', {
  name: 'Lodge',
  splitGroupId: 'group-1'
});
const splitServices = [firstSplit, secondSplit];
const splitHtml = renderModal({
  item: { ...secondSplit, item_rates: [] },
  beddedElsewhere: [travellers[0]]
});
check('split dialog offers remaining traveller', splitHtml.includes('Zoya Knapp'), true);
check('split dialog lists the sibling traveller with their bed', splitHtml.includes('Misael Villalobos'), true);
check('split dialog marks the sibling bed as another property', splitHtml.includes('class="room-alloc-pill is-other">Other property<'), true);
check('split dialog refuses to move the sibling traveller', splitHtml.includes('Already has a bed in another property on this night'), true);
check('split dialog does not offer to move a sibling traveler', splitHtml.includes('assigning moves the bed here'), false);
check('split reports one traveller still required', splitHtml.includes('1 Unallocated'), true);
check('partial split night remains incomplete', validateDayAccommodation(
  { services: splitServices },
  travellers
).isValid, false);

const completedSplit = [
  { ...firstSplit, roomAllocations: [{ roomId: 1, allocatedTravellers: [travellers[0]] }] },
  { ...secondSplit, roomAllocations: [{ roomId: 1, allocatedTravellers: [travellers[1]] }] }
];
check('completed split night validates', validateDayAccommodation(
  { services: completedSplit },
  travellers
).isValid, true);
check('split properties share the complete party allocation', beddedTravellerCount(completedSplit), 2);

const joined = joinAccommodationSplitGroup([
  accommodation('legacy-included'),
  accommodation('option', { isOptional: true })
], 'group-2');
check('starting a split joins pre-existing included accommodations', joined[0].splitGroupId, 'group-2');
check('alternatives stay outside the split group', joined[1].splitGroupId, undefined);
const regionalExisting = accommodation('regional-existing', {
  itemId: 'library-existing',
  name: 'Existing hotel'
});
const regionLibraryItems = [{
  id: 'library-existing',
  destination_region: 'Sea Point',
  destination_area: 'Cape Town'
}];
check('destination comparison ignores case and repeated spaces', accommodationRegionOf({
  destination_area: '  CAPE   TOWN '
}), 'cape town');
check('different localities in the same parent destination are allowed', accommodationRegionConflicts(
  [regionalExisting],
  { name: 'Second hotel', destination_region: 'Cape Town', destination_area: 'Cape Town' },
  regionLibraryItems
).length, 0);
check('different parent destinations are rejected', accommodationRegionConflicts(
  [regionalExisting],
  { name: 'Different region hotel', destination_region: 'George', destination_area: 'Garden Route' },
  regionLibraryItems
).length, 1);
check('missing parent destination is rejected when a second accommodation is added', accommodationRegionConflicts(
  [regionalExisting],
  { name: 'Unassigned destination hotel' },
  regionLibraryItems
).length, 1);
check('a legacy accommodation without a parent destination is rejected', accommodationRegionConflicts(
  [regionalExisting],
  { name: 'Second hotel', destination_area: 'Cape Town' },
  [{ id: 'library-existing', destination_region: 'Sea Point' }]
).length, 1);
const regionalPartySplit = [
  accommodation('cape-town-stay', {
    destinationArea: 'Cape Town',
    splitGroupId: 'destination-group',
    roomAllocations: [{ roomId: 1, allocatedTravellers: [travellers[0]] }]
  }),
  accommodation('garden-route-stay', {
    destinationArea: 'Garden Route',
    splitGroupId: 'destination-group',
    roomAllocations: [{ roomId: 1, allocatedTravellers: [travellers[1]] }]
  })
];
check('a traveler split across destination regions validates with distinct allocations', validateDayAccommodation(
  { services: regionalPartySplit },
  travellers
).isValid, true);
check('a traveler cannot be allocated in two destination regions', validateDayAccommodation(
  {
    services: [
      regionalPartySplit[0],
      {
        ...regionalPartySplit[1],
        roomAllocations: [{ roomId: 1, allocatedTravellers: [travellers[0]] }]
      }
    ]
  },
  travellers
).isValid, false);
check('a later property can join an existing destination branch', canJoinExistingAccommodationDestination(
  regionalPartySplit,
  { destination_area: 'cape town' }
), true);
check('a new destination still requires an explicit traveler split', canJoinExistingAccommodationDestination(
  regionalPartySplit,
  { destination_area: 'Namibia' }
), false);
check('missing region data cannot join an existing destination branch', canJoinExistingAccommodationDestination(
  [accommodation('unassigned', { destinationArea: '' })],
  { destination_area: 'Cape Town' }
), false);
const provisionalInvoices = [
  { id: 'proforma-1', total_incl: 300, status: 'proforma', currency_code: 'ZAR' },
  { id: 'proforma-2', total_incl: 200, status: 'proforma', currency_code: 'ZAR' }
];
check('unpaid provisional invoices count against the itinerary balance', netBilled(
  provisionalInvoices,
  [],
  'ZAR'
), 500);
check('another invoice is allowed while itinerary balance remains', canBill(
  500,
  1000,
  provisionalInvoices,
  [],
  'ZAR'
).ok, true);
check('invoice issuance remains capped at the remaining itinerary balance', canBill(
  501,
  1000,
  provisionalInvoices,
  [],
  'ZAR'
).ok, false);
const mixedCurrencyInvoices = [
  { id: 'zar-invoice', total_incl: 1000, status: 'validated', currency_code: 'ZAR' },
  { id: 'usd-invoice', total_incl: 200, status: 'proforma', currency_code: 'USD' }
];
const mixedCurrencyCredits = [
  { id: 'usd-credit', invoice_id: 'usd-invoice', total_incl: 50, status: 'issued', currency_code: 'USD' }
];
check('ZAR billed balance excludes USD invoices and credits', netBilled(
  mixedCurrencyInvoices,
  mixedCurrencyCredits,
  'ZAR'
), 1000);
check('USD billed balance excludes ZAR invoices and subtracts USD credits', netBilled(
  mixedCurrencyInvoices,
  mixedCurrencyCredits,
  'USD'
), 150);
check('USD can be invoiced independently of a fully billed ZAR itinerary', canBill(
  850,
  1000,
  mixedCurrencyInvoices,
  mixedCurrencyCredits,
  'USD'
).ok, true);
check('USD overbilling is capped against the USD balance only', canBill(
  851,
  1000,
  mixedCurrencyInvoices,
  mixedCurrencyCredits,
  'USD'
).ok, false);
const overpaidInvoices = [
  { id: 'zar-deposit', total_incl: 5234.89, status: 'proforma', currency_code: 'ZAR' },
  { id: 'zar-final-1', total_incl: 1744.96, status: 'validated', currency_code: 'ZAR' },
  { id: 'zar-final-2', total_incl: 1744.96, status: 'validated', currency_code: 'ZAR' },
  { id: 'usd-only', total_incl: 76.08, status: 'validated', currency_code: 'USD' }
];
const duplicateReceipts = [
  { invoice_id: 'zar-deposit', amount: 5234.89, direction: 'in' },
  { invoice_id: 'zar-final-1', amount: 1744.96, direction: 'in' },
  { invoice_id: 'zar-final-2', amount: 1744.96, direction: 'in' },
  { invoice_id: 'zar-final-2', amount: 1744.96, direction: 'in' }
];
check('duplicate ZAR receipts leave no additional booking receipt balance', bookingReceivableRemaining(
  overpaidInvoices,
  duplicateReceipts,
  [],
  'ZAR'
), 0);
check('USD receipt balance remains independent of ZAR receipts', bookingReceivableRemaining(
  overpaidInvoices,
  duplicateReceipts,
  [],
  'USD'
), 76.08);
check('a part-paid invoice cannot receive more than the remaining booking balance', bookingReceivableRemaining(
  [
    { id: 'deposit', total_incl: 600, status: 'proforma', currency_code: 'ZAR' },
    { id: 'balance', total_incl: 400, status: 'validated', currency_code: 'ZAR' }
  ],
  [{ invoice_id: 'deposit', amount: 600, direction: 'in' }],
  [],
  'ZAR'
), 400);
check('overpayment is calculated above billed amount in the same currency', bookingOverpayment(
  8724.81,
  overpaidInvoices,
  duplicateReceipts,
  [],
  'ZAR'
), 1744.96);
const paidAboveInvoice = { id: 'paid-over', total_incl: 1000, status: 'paid', currency_code: 'ZAR' };
const excessPaymentReceipt = [{ invoice_id: 'paid-over', amount: 1250, direction: 'in' }];
check('an excess receipt does not make the invoice balance negative', invoiceBalance(
  paidAboveInvoice,
  excessPaymentReceipt
), 0);
check('excess received remains separately resolvable', invoiceOverpayment(
  paidAboveInvoice,
  excessPaymentReceipt
), 250);
check('refund reduces the available overpayment by the refunded amount', bookingOverpayment(
  8724.81,
  overpaidInvoices,
  [...duplicateReceipts, { invoice_id: 'zar-final-2', amount: 1744.96, direction: 'out' }],
  [],
  'ZAR'
), 0);
check('overpayment credit note resolves the same excess once', bookingOverpayment(
  8724.81,
  overpaidInvoices,
  duplicateReceipts,
  [{ invoice_id: 'zar-final-2', total_incl: 1744.96, reason: 'Duplicate payment correction' }],
  'ZAR'
), 0);
check('an existing client credit note is not offered again as overpayment', bookingOverpayment(
  8724.81,
  overpaidInvoices,
  duplicateReceipts,
  [{ invoice_id: 'zar-final-2', total_incl: 1744.96, reason: 'Previously credited price difference' }],
  'ZAR'
), 0);
check('overpayment credit notes do not free billed itinerary value', netBilled(
  [{ id: 'paid-invoice', total_incl: 1000, status: 'paid', currency_code: 'ZAR' }],
  [{
    id: 'overpayment-credit',
    invoice_id: 'paid-invoice',
    total_incl: 250,
    status: 'issued',
    currency_code: 'ZAR',
    accounting_export: { purpose: 'overpayment' }
  }],
  'ZAR'
), 1000);
check('percentage billing calculates a share of the full currency total', billableAtPercentage(
  1000,
  30,
  [],
  [],
  'ZAR'
), 300);
check('percentage billing subtracts invoices and credits only in that currency', billableAtPercentage(
  1000,
  30,
  mixedCurrencyInvoices,
  mixedCurrencyCredits,
  'USD'
), 300);
check('percentage billing never exceeds the remaining currency balance', billableAtPercentage(
  1000,
  90,
  mixedCurrencyInvoices,
  mixedCurrencyCredits,
  'USD'
), 850);
check('account statement lists each document currency and its fallback currency', statementCurrencies(
  mixedCurrencyInvoices,
  [],
  mixedCurrencyCredits,
  'GBP'
).join(','), 'GBP,USD,ZAR');
check('ZAR account statement balance excludes USD documents', statementFor(
  {},
  'ZAR',
  mixedCurrencyInvoices,
  [],
  mixedCurrencyCredits
).closing, 1000);
check('USD account statement balance excludes ZAR documents', statementFor(
  {},
  'USD',
  mixedCurrencyInvoices,
  [],
  mixedCurrencyCredits
).closing, 150);
check('statement shows a credit-note document row', statementFor(
  {},
  'USD',
  mixedCurrencyInvoices,
  [],
  mixedCurrencyCredits
).rows.some((row) => row.kind === 'credit_note'), true);
const overpaymentStatement = statementFor(
  {},
  'ZAR',
  [{ id: 'paid-invoice', invoice_number: 'INV-1', total_incl: 1000, status: 'paid', currency_code: 'ZAR' }],
  [{ id: 'payment', invoice_id: 'paid-invoice', receipt_number: 'RCT-1', amount: 1250, direction: 'in', currency_code: 'ZAR' }],
  [{
    id: 'overpayment-credit',
    invoice_id: 'paid-invoice',
    credit_note_number: 'CRN-1',
    total_incl: 250,
    status: 'issued',
    currency_code: 'ZAR',
    accounting_export: { purpose: 'overpayment' }
  }]
);
check('overpayment credit note is visible without double-crediting the statement', overpaymentStatement.rows.some((row) =>
  row.kind === 'credit_note' && row.credit === 0 && row.description.startsWith('Overpayment credit note')
), true);
check('overpayment statement balance reflects excess cash once', overpaymentStatement.closing, -250);

/* Older allocations can have a generated modal id while itinerary metadata
   carries no id; inline validation must match the stable traveller name too. */
const legacyAllocation = { id: 'modal-generated-id', name: 'Zoya', surname: 'Knapp', age: 30 };
check('inline split validation matches allocation by traveller name', validateAccommodationServiceInDay(
  accommodation('empty-split', { splitGroupId: 'group-legacy' }),
  [accommodation('legacy-split', {
    splitGroupId: 'group-legacy',
    roomAllocations: [{ roomId: 1, allocatedTravellers: [legacyAllocation] }]
  })],
  [{ name: 'Zoya', surname: 'Knapp', age: 30 }]
).isValid, true);

const onePaxRoomAllocation = [{ roomId: 1, allocatedTravellers: [travellers[1]] }];
const onePaxRoomPrice = calculateRoomCharges({
  item_rates: [{
    currency: 'ZAR',
    price_1_adult: 3280,
    price_2_adults: 2290
  }]
}, onePaxRoomAllocation, 'ZAR', 22);
check('one-person split price uses the number actually allocated', allocatedTravellerCount(onePaxRoomAllocation), 1);
check('one-person split buy total matches the modal', onePaxRoomPrice.totalBuy, 3280);
check('one-person split sell total matches the modal', onePaxRoomPrice.totalSell, 4001.6);
check(
  'one-person split Buy / pax remains the contract single rate',
  Math.round(onePaxRoomPrice.totalBuy / allocatedTravellerCount(onePaxRoomAllocation) * 100) / 100,
  3280
);
const splitInvoiceLines = buildLinesFromDays([{
  dayNumber: 1,
  services: [{
    name: 'DaVinci Hotel',
    category: 'Accommodation',
    currencyCode: 'ZAR',
    sellPP: onePaxRoomPrice.totalSell,
    pax: 3,
    roomAllocations: onePaxRoomAllocation
  }]
}], 3, 'ZAR');
check('invoice uses allocated accommodation pax instead of itinerary pax', splitInvoiceLines.lines[0].quantity, 1);
check('invoice keeps the modal single-occupancy sell total', splitInvoiceLines.totalIncl, 4001.6);

check('transfer voucher labels service time as pick up time', voucherDetailLines({
  category: 'Transfers',
  time: '08:30'
}).includes('Pick up time: 08:30'), true);
check('transfer voucher includes flight departure or arrival time', voucherDetailLines({
  category: 'Transfers',
  flightTime: '09:45'
}).includes('Flight departure / arrival time: 09:45'), true);
check('activity voucher labels start time as pick up time', voucherDetailLines({
  category: 'Activities / Tours',
  startTime: '10:15'
}).includes('Pick up time: 10:15'), true);
check('flight voucher includes flight number and flight time', voucherDetailLines({
  category: 'Flights / Charter',
  flightNumber: 'AB123',
  flightTime: '12:20'
}).filter((line) => line === 'Flight number: AB123' || line === 'Flight departure / arrival time: 12:20').length, 2);

/* Room capacity is beds AND bed types. A three-bed room contracted to two
   adults must refuse a third adult, even though the total has room for them. */
const bayRoom = {
  id: 'room-standard',
  name: 'Standard Room',
  max_occupancy: 3,
  max_adults: 2,
  max_children: 1
};
const bayCapacity = soldRoomCapacity({ rooms: [bayRoom], roomTypeId: 'room-standard' });
check('sold room capacity comes from the room record', bayCapacity.maxOccupancy, 3);
check('sold room capacity states the adult beds', bayCapacity.maxAdults, 2);
check('sold room capacity states the child beds', bayCapacity.maxChildren, 1);
const snapshotCapacity = soldRoomCapacity({
  rooms: [],
  rate: { room_max_occupancy: 2, room_max_adults: 1, room_max_children: 1 }
});
check('a reloaded line falls back to the rate snapshot', snapshotCapacity.maxOccupancy, 2);
check('the rate snapshot keeps the adult cap', snapshotCapacity.maxAdults, 1);
const legacyCapacity = soldRoomCapacity({ rooms: [], rate: null, fallback: 3 });
check('a legacy total alone is still honoured', legacyCapacity.maxOccupancy, 3);
check('a legacy total invents no adult cap', legacyCapacity.maxAdults, null);

const davinciTravellers = [
  { id: 'd1', name: 'Lucas', surname: 'Silva', age: 41 },
  { id: 'd2', name: 'Beatriz', surname: 'Oliveira', age: 38 },
  { id: 'd3', name: 'Gabriel', surname: 'Santos', age: 45 }
];
const typedService = {
  key: 'davinci',
  itemId: 'davinci',
  category: 'Accommodation',
  name: 'DaVinci Hotel',
  maxOccupancy: 3,
  maxAdults: 2,
  maxChildren: 1,
  roomAllocations: [{ roomId: 1, allocatedTravellers: davinciTravellers }]
};
const threeAdultNight = validateDayAccommodation({ services: [typedService] }, davinciTravellers);
check('three adults in a two-adult room are over capacity', threeAdultNight.isValid, false);
check('the guard names the adult cap', threeAdultNight.reason.includes('adult capacity'), true);
check('the guard reports one bed over', threeAdultNight.overCapacityCount, 1);
check('two adults in the same room remain valid', validateDayAccommodation({
  services: [{ ...typedService, roomAllocations: [{ roomId: 1, allocatedTravellers: davinciTravellers.slice(0, 2) }] }]
}, davinciTravellers.slice(0, 2)).isValid, true);
const familyTravellers = [davinciTravellers[0], davinciTravellers[1], { id: 'c1', name: 'Kid', surname: 'Silva', age: 7 }];
check('two adults plus one child fit the three beds', validateDayAccommodation({
  services: [{ ...typedService, roomAllocations: [{ roomId: 1, allocatedTravellers: familyTravellers }] }]
}, familyTravellers).isValid, true);
check('a child beyond the child cap is refused', validateDayAccommodation({
  services: [{
    ...typedService,
    maxChildren: 0,
    roomAllocations: [{ roomId: 1, allocatedTravellers: familyTravellers }]
  }]
}, familyTravellers).reason.includes('child capacity'), true);

/* A property that does not tell adults and children apart states no child cap.
   That is a different contract from a room that takes no children, and the
   allocator has to keep them apart or a family villa refuses every family. */
const openVillaRoom = { id: 'room-villa', name: 'Luxury Villa', max_occupancy: 6, max_adults: 6, max_children: null };
const openVillaCapacity = soldRoomCapacity({ rooms: [openVillaRoom], roomTypeId: 'room-villa' });
check('an unstated child cap is not read as no child beds', openVillaCapacity.maxChildren, null);
check('an unstated cap still caps the room at its beds', openVillaCapacity.maxOccupancy, 6);
const openVillaSnapshot = soldRoomCapacity({
  rooms: [],
  rate: { room_max_occupancy: 6, room_max_adults: 6, room_max_children: null }
});
check('a reloaded villa line invents no child cap', openVillaSnapshot.maxChildren, null);

const houseful = [...davinciTravellers.slice(0, 2), { id: 'c1', name: 'Ana', surname: 'Silva', age: 6 }, { id: 'c2', name: 'Beto', surname: 'Silva', age: 9 }];
const inOneRoom = (maxChildren) => ({
  services: [{
    key: 'villa',
    itemId: 'villa',
    category: 'Accommodation',
    name: 'Luxury Villa',
    maxOccupancy: 6,
    maxAdults: 6,
    maxChildren,
    roomAllocations: [{ roomId: 1, allocatedTravellers: houseful }]
  }]
});
check('two adults and two children share a villa that does not split them',
  validateDayAccommodation(inOneRoom(null), houseful).isValid, true);
check('the same four are refused by a villa typed zero children',
  validateDayAccommodation(inOneRoom(0), houseful).reason.includes('child capacity'), true);
check('and refused again once the villa caps them at one',
  validateDayAccommodation(inOneRoom(1), houseful).reason.includes('child capacity'), true);
check('an unstated cap leaves the overflow at zero children',
  roomOverflow({ allocatedTravellers: houseful }, roomCapacityOfService({ maxOccupancy: 6, maxAdults: 6, maxChildren: null })).overChildren, 0);
check('a stated cap counts the children over it',
  roomOverflow({ allocatedTravellers: houseful }, roomCapacityOfService({ maxOccupancy: 6, maxAdults: 6, maxChildren: 1 })).overChildren, 1);
check('a line without adult caps keeps the total-only rule', validateDayAccommodation({
  services: [{
    key: 'legacy',
    category: 'Accommodation',
    name: 'Legacy Lodge',
    maxOccupancy: 3,
    roomAllocations: [{ roomId: 1, allocatedTravellers: davinciTravellers }]
  }]
}, davinciTravellers).isValid, true);

/* A saved line only carries the room id; the library carries its beds. */
const davinciLibrary = [{
  id: 'davinci',
  name: 'DaVinci Hotel',
  room_types: [bayRoom],
  item_rates: [{ room_type_id: 'room-standard', room_max_occupancy: 3, room_max_adults: 2, room_max_children: 1 }]
}];
const reloadedService = { itemId: 'davinci', category: 'Accommodation', roomTypeId: 'room-standard', maxOccupancy: 3 };
const reloadedCapacity = serviceRoomCapacity(reloadedService, davinciLibrary);
check('a reloaded line finds its adult cap in the library', reloadedCapacity.maxAdults, 2);
check('the enriched line carries the adult cap', withRoomCapacity(reloadedService, davinciLibrary).maxAdults, 2);
const reloadedOverflow = roomOverflow({ allocatedTravellers: davinciTravellers }, roomCapacityOfService(withRoomCapacity(reloadedService, davinciLibrary)));
check('the overflow counts the adult breach', reloadedOverflow.overAdults, 1);
check('the resolved room list reads the snake-case room rows', roomTypesOf({ room_types: [bayRoom] })[0].key, 'room-standard');

const typedModalHtml = renderModal({
  item: {
    ...accommodation('davinci', { item_rates: [] }),
    name: 'DaVinci Hotel',
    maxOccupancy: 3,
    maxAdults: 2,
    maxChildren: 1
  }
});
check('the dialog states the adult and child beds', typedModalHtml.includes('Contract Capacity: 2 adults + 1 child · 3 pax / Room'), true);

/* A property that does not split its guests by age states no child cap, and the
   dialog must not dress that up as a room that turns children away. */
const openVillaModalHtml = renderModal({
  item: {
    ...accommodation('villa', { item_rates: [] }),
    name: 'Luxury Villa',
    maxOccupancy: 6,
    maxAdults: 6,
    maxChildren: null
  }
});
check('an unsplit villa is sold on its beds alone', openVillaModalHtml.includes('Contract Capacity: 6 pax / Room'), true);
check('an unsplit villa never reads as adults only', /adults only|0 children/.test(openVillaModalHtml), false);
const adultsOnlyModalHtml = renderModal({
  item: {
    ...accommodation('studio', { item_rates: [] }),
    name: 'Studio',
    maxOccupancy: 2,
    maxAdults: 2,
    maxChildren: 0
  }
});
check('a room typed zero children says so', adultsOnlyModalHtml.includes('Contract Capacity: adults only · 2 pax / Room'), true);

/* A night can mix the property's room types, so every room card carries its own
   type picker and sizes itself on that type's beds. One room type leaves nothing
   to choose, and the line's sold type already says what the rooms are. */
const suiteRoom = {
  id: 'room-suite',
  name: 'Family Suite',
  max_occupancy: 4,
  max_adults: 3,
  max_children: 2
};
const mixedProperty = {
  ...accommodation('davinci-mixed', { item_rates: [] }),
  name: 'DaVinci Hotel',
  roomType: 'Standard Room',
  maxOccupancy: 3,
  maxAdults: 2,
  maxChildren: 1,
  room_types: [bayRoom, suiteRoom]
};
const pickerHtml = renderModal({
  item: {
    ...mixedProperty,
    roomAllocations: [
      { roomId: 1, allocatedTravellers: [travellers[0]] },
      { roomId: 2, roomType: 'Family Suite', roomTypeId: 'room-suite', allocatedTravellers: [travellers[1]] }
    ]
  }
});
check('each room card offers the property room types', pickerHtml.includes('room-alloc-type-select'), true);
check('the picker lists both room types', pickerHtml.includes('<option value="Family Suite">Family Suite</option>')
  && pickerHtml.includes('<option value="Standard Room">Standard Room</option>'), true);
const selectedTypeFor = (roomId) => {
  const card = pickerHtml.match(new RegExp(`aria-label="Room type for Room ${roomId}".*?</select>`, 's'));
  const chosen = card && card[0].match(/<option value="([^"]*)" selected/g);
  return chosen ? chosen[0].replace(/^.*value="|".*$/g, '') : '';
};
check('a room with no type of its own is shown as the room the line sold',
  selectedTypeFor(1), 'Standard Room');
check('a room carries the type the allocation named',
  selectedTypeFor(2), 'Family Suite');
check('the picker replaces the flat room-type caption when there is a choice',
  pickerHtml.includes('room-alloc-type-label'), true);
check('a mixed night is not sized on one flat capacity',
  pickerHtml.includes('Max Standard Room / Family Suite per Room'), false);
check('the dialog stops claiming one capacity for every room',
  pickerHtml.includes('Each room is typed below'), true);

const singleTypeHtml = renderModal({
  item: {
    ...accommodation('davinci-one', { item_rates: [] }),
    name: 'DaVinci Hotel',
    roomType: 'Standard Room',
    room_types: [bayRoom],
    roomAllocations: [{ roomId: 1, allocatedTravellers: [travellers[0]] }]
  }
});
check('a one-room-type property gets no picker', singleTypeHtml.includes('room-alloc-type-select'), false);
check('a one-room-type property still names the room on the card',
  singleTypeHtml.includes('Standard Room'), true);

/* A crew room is marked by its role, and that marker drives its pricing - the
   picker must never offer to rename it or overwrite it. */
const crewHtml = renderModal({
  item: {
    ...mixedProperty,
    roomAllocations: [
      { roomId: 1, allocatedTravellers: [travellers[0]] },
      { roomId: 2, roomType: 'staff', staffRole: 'tour_guide', allocatedTravellers: [{ id: 'g1', name: 'Guide', surname: '', age: 40, role: 'tour_guide' }] }
    ]
  }
});
check('a crew room keeps its badge instead of a type picker',
  crewHtml.includes('Staff Room') && !/room-alloc-type-select[^>]*value="staff"/.test(crewHtml), true);
check('a crew room is never offered the guest room types as its own value',
  crewHtml.includes('Selected room: Room 2 · staff'), false);

const libraryModalItem = buildRoomModalItem({
  base: {
    id: 'davinci',
    name: 'DaVinci Hotel',
    category: 'Accommodation',
    room_types: [bayRoom],
    item_rates: []
  },
  service: { itemId: 'davinci', category: 'Accommodation', roomTypeId: 'room-standard', maxOccupancy: 3 }
});
check('the dialog takes the sold room adult beds', libraryModalItem.maxAdults, 2);
check('the dialog takes the sold room child beds', libraryModalItem.maxChildren, 1);

/* Children in their own room: a property either charges the standard adult
   rates or one single room rate for the whole children-only room. Mixed rooms
   keep the child band rates. */
const kidA = { id: 'k1', name: 'Liam', surname: 'Dube', age: 8 };
const kidB = { id: 'k2', name: 'Zanele', surname: 'Dube', age: 6 };
const kidC = { id: 'k3', name: 'Tebogo', surname: 'Dube', age: 11 };
const ownRoomItem = (policy) => ({
  category: 'Accommodation',
  children_own_room_policy: policy,
  child_age_ranges: [{ id: 'child', name: 'Child', ageFrom: 0, ageTo: 12 }],
  item_rates: [{
    currency: 'ZAR',
    price_1_adult: 1000,
    price_2_adults: 700,
    price_3_plus_adults: 650,
    child_rates_breakdown: { child: 350 }
  }]
});
const kidsRoom = (kids) => [{ roomId: 1, allocatedTravellers: kids }];
const roomBuyOf = (result) => result.rooms[0].buyCost;

const twoKidsDefault = calculateRoomCharges(ownRoomItem('child_rates'), kidsRoom([kidA, kidB]), 'ZAR', 0);
check('two children alone keep child band rates by default', roomBuyOf(twoKidsDefault), 700);

const twoKidsAdult = calculateRoomCharges(ownRoomItem('adult_rates'), kidsRoom([kidA, kidB]), 'ZAR', 0);
check('two children alone price at the adult sharing rate each', roomBuyOf(twoKidsAdult), 1400);
check('two children alone name the adult rate in the description', twoKidsAdult.rooms[0].rateDescription.includes('Adult Sharing Rate'), true);

const threeKidsAdult = calculateRoomCharges(ownRoomItem('adult_rates'), kidsRoom([kidA, kidB, kidC]), 'ZAR', 0);
check('three children alone follow the adult ladder (2 sharing + 1 extra)', roomBuyOf(threeKidsAdult), 2050);

const soloKidAdult = calculateRoomCharges(ownRoomItem('adult_rates'), kidsRoom([kidA]), 'ZAR', 0);
check('one child alone prices at the adult single rate', roomBuyOf(soloKidAdult), 1000);

const twoKidsSingle = calculateRoomCharges(ownRoomItem('single_room_rate'), kidsRoom([kidA, kidB]), 'ZAR', 0);
check('two children alone charge one single room rate', roomBuyOf(twoKidsSingle), 1000);

const threeKidsSingle = calculateRoomCharges(ownRoomItem('single_room_rate'), kidsRoom([kidA, kidB, kidC]), 'ZAR', 0);
check('three children alone still charge one single room rate', roomBuyOf(threeKidsSingle), 1000);

const soloKidSingle = calculateRoomCharges(ownRoomItem('single_room_rate'), kidsRoom([kidA]), 'ZAR', 0);
check('one child alone under single-room policy charges the single rate', roomBuyOf(soloKidSingle), 1000);

const mixedAdult = calculateRoomCharges(ownRoomItem('adult_rates'), kidsRoom([travellers[0], kidA]), 'ZAR', 0);
check('a child sharing with an adult keeps the child band rate', roomBuyOf(mixedAdult), 1050);

/* ── One night, several room types ──────────────────────────────────────
   A property sells Standard Rooms and Family Suites at once and negotiates each
   separately. The accommodation LINE is sold at one row, so until the room
   engine could type a bed, a Suite sleeping beside a Standard Room cost the
   operator a second line. The two engines — the room charge calculator and the
   per-person card — must price each room from its own contract and agree. */
const season = { currency: 'ZAR', season_name: 'Summer', valid_from: '2026-11-01', valid_to: '2027-04-30' };
const stdRow = { ...season, id: 'r-std', room_type_id: 'rt-std', room_type: 'Standard Room', room_max_occupancy: 2, price_1_adult: 1200, price_2_adults: 800 };
const suiteRow = { ...season, id: 'r-suite', room_type_id: 'rt-suite', room_type: 'Family Suite', room_max_occupancy: 4, price_1_adult: 2600, price_2_adults: 1500, price_3_plus_adults: 400 };
const villaWinter = { currency: 'ZAR', season_name: 'Winter', valid_from: '2026-06-01', valid_to: '2026-10-30', id: 'r-villa', room_type_id: 'rt-villa', room_type: 'Garden Villa', room_max_occupancy: 2, price_1_adult: 3000, price_2_adults: 2000 };
const typedLodge = {
  category: 'Accommodation',
  child_age_ranges: [],
  room_types: [
    { id: 'rt-std', name: 'Standard Room', max_occupancy: 2, max_adults: 2, sort_order: 1 },
    { id: 'rt-suite', name: 'Family Suite', max_occupancy: 4, max_adults: 4, sort_order: 2 }
  ],
  item_rates: [stdRow, suiteRow]
};
const soldStd = withRoomTypeRates(stdRow, { item: typedLodge, rates: typedLodge.item_rates });
const fiveAdults = ['a1', 'a2', 'a3', 'a4', 'a5'].map((id) => ({ id, age: 30 }));
const typedCharges = (rate, rooms, markup = 0) => calculateRoomCharges(
  { category: 'Accommodation', child_age_ranges: [], item_rates: [rate] }, rooms, 'ZAR', markup
);
const mixedNight = [
  { roomId: 1, roomType: 'Standard Room', roomTypeId: 'rt-std', allocatedTravellers: fiveAdults.slice(0, 2) },
  { roomId: 2, roomType: 'Family Suite', roomTypeId: 'rt-suite', allocatedTravellers: fiveAdults.slice(2) }
];
const mixedCharges = typedCharges(soldStd, mixedNight);
check('a typed standard room keeps the line row', mixedCharges.rooms[0].buyCost, 1600);
check('a typed suite is priced from its own contract', mixedCharges.rooms[1].buyCost, 3400);
check('a mixed night totals both contracts', mixedCharges.totalBuy, 5000);
check('a suite third adult pays the suite extra-adult rate', mixedCharges.rooms[1].rateDescription.includes('400.00'), true);
check('a room prices from the row of its own type', rateForAllocatedRoom(soldStd, mixedNight[1]).rate.id, 'r-suite');
check('a room with no type of its own keeps the line row', rateForAllocatedRoom(soldStd, { roomId: 3, allocatedTravellers: fiveAdults.slice(0, 2) }).rate.id, 'r-std');
const untypedNight = mixedNight.map((rm) => ({ roomId: rm.roomId, allocatedTravellers: rm.allocatedTravellers }));
check('an untyped night still prices every bed on the line row', typedCharges(soldStd, untypedNight).totalBuy, 4000);

const suiteSolo = [
  { roomId: 1, roomType: 'Standard Room', roomTypeId: 'rt-std', allocatedTravellers: fiveAdults.slice(0, 2) },
  { roomId: 2, roomType: 'Family Suite', roomTypeId: 'rt-suite', allocatedTravellers: [fiveAdults[2]] }
];
const soloCharges = typedCharges(soldStd, suiteSolo);
check('a solo guest in the suite pays the suite single, not the standard single', soloCharges.rooms[1].buyCost, 2600);

/* A room type this season does not price is not a cheaper room: it is a room
   this night cannot be housed in, and the dialog refuses the allocation. */
const villaLodge = {
  category: 'Accommodation',
  child_age_ranges: [],
  room_types: [...typedLodge.room_types, { id: 'rt-villa', name: 'Garden Villa', max_occupancy: 2, max_adults: 2, sort_order: 3 }],
  item_rates: [stdRow, suiteRow, villaWinter]
};
const soldWithVilla = withRoomTypeRates(stdRow, { item: villaLodge, rates: villaLodge.item_rates });
const villaRoom = [{ roomId: 1, roomType: 'Garden Villa', roomTypeId: 'rt-villa', allocatedTravellers: fiveAdults.slice(0, 2) }];
const refused = typedCharges(soldWithVilla, villaRoom);
check('a room type with no price in this season charges nothing', refused.totalBuy, 0);
check('the unpriceable room is reported, not swallowed', refused.unpricedRooms.length, 1);
check('the refusal names the season the line is priced from', String(refused.unpricedRooms[0].reason).includes('Summer season'), true);
check('the stamp carries the refusal reason for the room', rateForAllocatedRoom(soldWithVilla, villaRoom[0]).rate, null);

/* The per-person card must re-add to the same money the room engine charged. */
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const near = (label, actual, expected) => {
  const ok = Math.abs(Number(actual) - Number(expected)) < 0.05;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${actual}, expected ${expected} (+/- 0.05)`);
};
const rowsAgainstEngine = (rate, rooms, markup = 15) => {
  const charges = typedCharges(rate, rooms, markup);
  const heads = rooms.flatMap((rm) => rm.allocatedTravellers);
  const rows = computePerPersonRows({
    services: [{
      category: 'Accommodation', currencyCode: 'ZAR', sellPP: money(charges.totalSell / heads.length),
      taxRate: 0, itemId: 'lodge', roomAllocations: rooms, markup
    }],
    travellers: heads,
    rateBy: () => rate,
    defaultTaxRate: 0
  });
  return {
    charges,
    rows,
    total: money(rows.perPersonSharing.sell * rows.totalCount
      + (rows.hasSingle ? rows.singleSupplement.sell : 0))
  };
};
const mixedRows = rowsAgainstEngine(soldStd, mixedNight);
check('a mixed night averages both room contracts into the per-person row', mixedRows.rows.perPersonSharing.sell, 1150);
near('a mixed night re-adds to what the room engine charged', mixedRows.total, mixedRows.charges.totalSell);
const soloRows = rowsAgainstEngine(soldStd, suiteSolo);
near('a solo suite supplement is the suite single over the suite sharing rate',
  soloRows.rows.singleSupplement.sell, 2990 - 1725);
near('a night with a solo suite re-adds to what the room engine charged', soloRows.total, soloRows.charges.totalSell);
const refusedRows = rowsAgainstEngine(soldWithVilla, villaRoom);
near('an unpriceable room contributes nothing to the per-person rows either', refusedRows.total, refusedRows.charges.totalSell);

/* The per-person document table: the party's supplement bill becomes each
   traveller's share of it, and the printed column still re-adds to the money the
   room engine charged for the two different contracts. */
const mixedHead = perPersonHeadBreakdown(mixedRows.rows);
check('a party with no solo traveller prints one row', mixedHead.rows.length, 1);
near('the per-person table is the engine money divided by the heads',
  money(mixedHead.total.incl * mixedHead.heads), mixedRows.charges.totalSell);
const soloHead = perPersonHeadBreakdown(soloRows.rows);
check('a solo traveller adds the supplement row', soloHead.rows.length, 2);
near('the supplement row is the party bill spread over the heads',
  soloHead.rows[1].incl, money(soloRows.rows.singleSupplement.sell / soloHead.heads));
near('the typed party total per person re-adds to what the room engine charged',
  money(soloHead.total.incl * soloHead.heads), soloRows.charges.totalSell);
near('a refused room leaves the per-person table at nothing',
  money(perPersonHeadBreakdown(refusedRows.rows).total.incl * refusedRows.rows.totalCount), refusedRows.charges.totalSell);

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
