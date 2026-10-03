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
  validateDayAccommodation,
  validateAccommodationServiceInDay
} from '../src/lib/roomAllocationHelper.js';

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
check('alternative modal offers the entire party', alternativeHtml.includes('Travellers To Allocate (2)'), true);
check('alternative modal lists both travellers', alternativeHtml.includes('Misael') && alternativeHtml.includes('Zoya'), true);
check('alternative cannot be treated as a group split', alternativeHtml.includes('Group split'), false);
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
check('split dialog hides traveler housed by the first property', splitHtml.includes('Misael Villalobos'), false);
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

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
