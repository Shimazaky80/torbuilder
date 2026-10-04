/* Reproduces the reported bug against the SHIPPED modules.
   Southern Sun The Cullinan, IT-2026-00001, travel 2026-10-29 -> 2026-10-30.
     Summer 2026-09-01..2027-03-31: single 4260, 2-sharing 2290, 3+ 470
     Winter 2026-04-01..2026-08-31: single 3025, 2-sharing 1675 (the wrong one)
   Expect: season resolution -> Summer, and the room charge for 2 adults
   -> 2 x 2290 = 4580, NOT 2 x 1675 = 3350.

   The source uses Vite-style extensionless imports, so this is bundled before
   it runs:  npm run test:pricing
*/
import { resolveSeasonForTravel, rateForTravel, applyProtectionToRate } from '../src/lib/priceValidity.js';
import { calculateRoomCharges, getRateRow, buildRoomModalItem } from '../src/lib/roomAllocationHelper.js';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import RoomAllocationModal from '../src/components/RoomAllocationModal.jsx';
import {
  contractedServiceTotal,
  contractPaxRate,
  repriceServicesForPax,
  sidebarLibraryRate,
  supplierPaymentDocumentStatus
} from '../src/lib/servicePricing.js';

const winter = {
  id: 'r-winter', currency: 'ZAR', season_name: 'Winter',
  valid_from: '2026-04-01', valid_to: '2026-08-31',
  price_1_adult: 3025, price_2_adults: 1675, price_3_plus_adults: 470,
  rate_basis: 'per_person_sharing'
};
const summer = {
  id: 'r-summer', currency: 'ZAR', season_name: 'Summer',
  valid_from: '2026-09-01', valid_to: '2027-03-31',
  price_1_adult: 4260, price_2_adults: 2290, price_3_plus_adults: 470,
  rate_basis: 'per_person_sharing'
};
/* Deliberately worst-case order: winter first, which is what made
   getRateRow() quote 1675. */
const item = { item_rates: [winter, summer], child_age_ranges: [] };
const travel = { start: '2026-10-29', end: '2026-10-30' };

let failures = 0;
const check = (label, actual, expected) => {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};

/* A flat contract amount must be divided by the current traveler count, not
   the count that happened to be on the itinerary when the service was added. */
const vehicleRate = {
  currency: 'ZAR',
  valid_from: '2026-01-01',
  valid_to: '2026-12-31',
  rate_basis: 'per_vehicle',
  price_1_adult: 1401,
  unit_price: 1401
};
const transferItem = {
  id: 'transfer-1',
  category: 'Transfers',
  pricing_model: 'per_vehicle',
  item_rates: [vehicleRate]
};
const staleTransfer = {
  itemId: transferItem.id,
  name: 'Cape Turismo transfer',
  category: 'Transfers',
  currencyCode: 'ZAR',
  basis: 'per_vehicle',
  buyPP: 700.5,
  sellPP: 854.61,
  markup: 22,
  pax: 2
};
const repricedTransfer = repriceServicesForPax({
  days: [{ services: [staleTransfer] }],
  libraryItems: [transferItem],
  paxCount: 3,
  travelWindow: { start: '2026-10-29', end: '2026-10-30' }
});
const transfer = repricedTransfer.days[0].services[0];
check('R1401 vehicle rate is divided by current 3 pax', transfer.buyPP, 467);
check('recalculated transfer buy total remains R1401', transfer.buyPP * transfer.pax, 1401);
check('recalculated transfer sell total includes markup once', transfer.sellPP * transfer.pax, 1709.22);
check('recalculated transfer stores the current pax count', transfer.pax, 3);
check('stale transfer price is counted as repriced', repricedTransfer.repriced, 1);
check('direct contract rate conversion uses all 3 travelers', contractPaxRate(transferItem, 'ZAR', 3), 467);
check('sidebar shows the full Library per-vehicle rate', sidebarLibraryRate(transferItem, 'ZAR', 3), 1401);
const largerVehicleRate = {
  ...transferItem,
  item_rates: [{ ...vehicleRate, price_1_adult: 1698, unit_price: 1698 }]
};
check('sidebar preserves the other Library per-vehicle rate', sidebarLibraryRate(largerVehicleRate, 'ZAR', 3), 1698);
check('daily brief estimate uses contracted buy total, not marked-up sell', contractedServiceTotal({
  category: 'Transfers',
  buyPP: 467,
  sellPP: 569.74
}, 3), 1401);
check('accommodation estimate uses the allocated contract total', contractedServiceTotal({
  category: 'Accommodation',
  buyPP: 1200,
  roomAllocations: [{ allocatedTravellers: [{ id: 'a' }, { id: 'b' }] }]
}, 3), 2400);
check('unchecked supplier payment is not represented as paid', supplierPaymentDocumentStatus(false).stamp, 'NOT PAID');
check('confirmed supplier payment retains paid stamp', supplierPaymentDocumentStatus(true).stamp, 'PAID');
check('unchecked payment document labels the amount as contracted', supplierPaymentDocumentStatus(false).amountLabel, 'Contracted amount');

const tieredActivity = {
  id: 'activity-1',
  category: 'Activities / Tours',
  pricing_model: 'tiered',
  item_rates: [{
    ...vehicleRate,
    rate_basis: 'tiered',
    tiered_pricing: [
      { min_pax: 1, max_pax: 2, rate: 1800 },
      { min_pax: 3, max_pax: 6, rate: 2100 }
    ]
  }]
};
check('tiered activity selects the current 3-pax rate', contractPaxRate(tieredActivity, 'ZAR', 3), 700);
const repricedTieredActivity = repriceServicesForPax({
  days: [{ services: [{
    itemId: tieredActivity.id,
    name: 'Tiered activity',
    category: tieredActivity.category,
    currencyCode: 'ZAR',
    buyPP: 900,
    sellPP: 1080,
    markup: 20,
    pax: 2
  }] }],
  libraryItems: [tieredActivity],
  paxCount: 3,
  travelWindow: { start: '2026-10-29', end: '2026-10-30' }
});
check('tiered activity line is refreshed for the new party size', repricedTieredActivity.days[0].services[0].buyPP, 700);

const perPersonActivity = {
  id: 'activity-pp',
  category: 'Activities / Tours',
  pricing_model: 'per_person',
  item_rates: [{ ...vehicleRate, rate_basis: 'per_person', price_1_adult: 250, unit_price: 250 }]
};
const repricedPerPersonActivity = repriceServicesForPax({
  days: [{ services: [{
    itemId: perPersonActivity.id,
    name: 'Per-person activity',
    category: perPersonActivity.category,
    currencyCode: 'ZAR',
    buyPP: 250,
    sellPP: 300,
    markup: 20,
    pax: 2
  }] }],
  libraryItems: [perPersonActivity],
  paxCount: 3,
  travelWindow: { start: '2026-10-29', end: '2026-10-30' }
});
check('per-person activities retain their library unit price', repricedPerPersonActivity.days[0].services[0].buyPP, 250);
check('per-person activities update their pax count', repricedPerPersonActivity.days[0].services[0].pax, 3);

const vehicleFee = {
  id: 'fee-1',
  category: 'Surcharge Fees',
  surcharge_type: 'entrance_fee',
  surcharge_unit_basis: 'per_vehicle',
  item_rates: [{
    ...vehicleRate,
    entrance_fee_per_vehicle: 300
  }]
};
const repricedVehicleFee = repriceServicesForPax({
  days: [{ services: [{
    itemId: vehicleFee.id,
    name: 'Vehicle entrance fee',
    category: vehicleFee.category,
    currencyCode: 'ZAR',
    buyPP: 150,
    sellPP: 180,
    markup: 20,
    pax: 2
  }] }],
  libraryItems: [vehicleFee],
  paxCount: 3,
  travelWindow: { start: '2026-10-29', end: '2026-10-30' }
});
check('vehicle surcharge stays a flat R300 across the group', repricedVehicleFee.days[0].services[0].buyPP * 3, 300);
const unchangedAccommodation = {
  itemId: 'hotel-1',
  name: 'Hotel',
  category: 'Accommodation',
  currencyCode: 'ZAR',
  buyPP: 700.5,
  pax: 2
};
const accommodationResult = repriceServicesForPax({
  days: [{ services: [unchangedAccommodation] }],
  libraryItems: [{ ...transferItem, id: 'hotel-1' }],
  paxCount: 3,
  travelWindow: { start: '2026-10-29', end: '2026-10-30' }
});
check('accommodation is excluded from party-size repricing', accommodationResult.days[0].services[0], unchangedAccommodation);

/* 1. Season resolution picks the matrix covering the travel dates. */
const season = resolveSeasonForTravel({ rates: item.item_rates, currencyCode: 'ZAR', startDate: travel.start, endDate: travel.end });
check('resolved season name', season.seasonName, 'Summer');
check('resolved season status', season.status, 'ok');

/* 2. The season-aware row reader returns Summer, not the first row. */
const row = rateForTravel({ rates: item.item_rates, currencyCode: 'ZAR', startDate: travel.start, endDate: travel.end });
check('rateForTravel price_2_adults', row.price_2_adults, 2290);

/* 3. The OLD reader is shown to be the source of the reported numbers. */
check('season-blind getRateRow price_2_adults (the bug)', getRateRow(item, 'ZAR').price_2_adults, 1675);

/* 4. What the dialog is handed now: a single, season-resolved matrix. */
const modalItem = { ...item, item_rates: [row] };
/* What both dialog-opening paths hand the modal: the single resolved season,
   exactly as createService computes seasonalRates. */
const seasonal = [row];
const rooms = [{ roomId: 1, allocatedTravellers: [
  { id: 't1', name: 'Misael', surname: 'Villalobos', age: 30 },
  { id: 't2', name: 'Zoya', surname: 'Knapp', age: 30 }
] }];

const wrong = calculateRoomCharges(item, rooms, 'ZAR', 0);   // whole matrix (old path)
const right = calculateRoomCharges(modalItem, rooms, 'ZAR', 0); // resolved (new path)
check('OLD dialog total (reported bug)', wrong.totalBuy, 3350);
check('NEW dialog total', right.totalBuy, 4580);
check('NEW dialog rate description', right.rooms[0].rateDescription, '2 Adult(s) x 2290.00');

/* 5. Single traveller uses the single rate of the correct season. */
const solo = [{ roomId: 1, allocatedTravellers: [{ id: 't1', name: 'A', surname: 'B', age: 30 }] }];
check('NEW single-occupant buy (Summer single 4260)', calculateRoomCharges(modalItem, solo, 'ZAR', 0).totalBuy, 4260);

/* 6. 3 adults -> 2 sharing + 1 extra-adult from Summer. */
const three = [{ roomId: 1, allocatedTravellers: [
  { id: 't1', name: 'A', surname: 'B', age: 30 },
  { id: 't2', name: 'C', surname: 'D', age: 30 },
  { id: 't3', name: 'E', surname: 'F', age: 30 }
] }];
check('NEW 3-adult buy (2x2290 + 470)', calculateRoomCharges(modalItem, three, 'ZAR', 0).totalBuy, 5050);

/* 7. Pricing Protection: a PRIOR-YEAR season sharing the trip's calendar
      period is accepted and uplifted. Trip in July 2026, only last year's
      winter matrix available. */
const lastWinter = { ...winter, id: 'r-winter-2025', valid_from: '2025-04-01', valid_to: '2025-08-31' };
const stale = rateForTravel({ rates: [lastWinter], currencyCode: 'ZAR', startDate: '2026-07-15', endDate: '2026-07-20', protectionPercent: 10 });
check('protected stale season uplifted (3025 -> 3327.5)', stale.price_1_adult, 3327.5);

/* 7b. A season from the SAME year that simply does not cover the trip is not
       eligible for protection — it is a missing season, not an outdated one. */
const notBehind = rateForTravel({ rates: [winter], currencyCode: 'ZAR', startDate: travel.start, endDate: travel.end, protectionPercent: 10 });
check('same-year non-covering season is not uplifted', notBehind.price_1_adult, 3025);

/* 8. A trip outside every season still falls back rather than going null. */
const offSeason = rateForTravel({ rates: item.item_rates, currencyCode: 'ZAR', startDate: '2026-03-15', endDate: '2026-03-20' });
check('off-season fallback is still a ZAR row', typeof offSeason?.price_2_adults, 'number');

/* 9. THE REGRESSION THAT SURVIVED THE FIRST FIX: the dialog opens from TWO
      places — dropping an item (createService) and clicking allocate
      (openRoomAllocationModal). The drop path passed the raw library item,
      handing the dialog every season at once, so it priced from whichever row
      came back first. Both must now go through buildRoomModalItem and agree. */
const libItem = { id: 'it1', name: 'Southern Sun', category: 'Accommodation', max_occupancy: 4, item_rates: [winter, summer] };
const freshSvc = { itemId: 'it1', name: 'Southern Sun', category: 'Accommodation', maxOccupancy: '4', roomType: 'Standard Room' };

const dropModalItem = buildRoomModalItem({ base: libItem, service: freshSvc, modalRates: seasonal, season });
const allocateModalItem = buildRoomModalItem({ base: libItem, service: { ...freshSvc, roomAllocations: rooms }, modalRates: seasonal, season });

check('drop path carries exactly one season', dropModalItem.item_rates.length, 1);
check('drop path prices from Summer, not Winter', getRateRow(dropModalItem, 'ZAR').price_1_adult, 4260);
check('drop path names the season it used', dropModalItem._seasonName, 'Summer');
check('drop path carries the season window', `${dropModalItem._seasonFrom}..${dropModalItem._seasonTo}`, '2026-09-01..2027-03-31');
check('drop path keeps contract max occupancy', String(dropModalItem.maxOccupancy), '4');
check('drop path keeps room type', dropModalItem.roomType, 'Standard Room');
check('allocate path preserves existing allocations', allocateModalItem.roomAllocations.length, 1);
check('drop path starts with no allocation yet', dropModalItem.roomAllocations.length, 0);

/* Both paths must produce the SAME room charge — that is the whole point. */
const dropTotal = calculateRoomCharges(dropModalItem, rooms, 'ZAR', 0).totalBuy;
const allocateTotal = calculateRoomCharges({ ...allocateModalItem, roomAllocations: rooms }, rooms, 'ZAR', 0).totalBuy;
check('drop and allocate agree on the room total', dropTotal, allocateTotal);
check('drop path room total is the Summer figure', dropTotal, 4580);

/* The dialog must never be handed a multi-season matrix again. */
check('multi-season matrix is never handed to the dialog', dropModalItem.item_rates.length > 1, false);

/* 10. The pre-fix behaviour, pinned so it cannot quietly return. */
check('raw multi-season item still yields the wrong Winter row (documents the bug)', getRateRow(libItem, 'ZAR').price_1_adult, 3025);

/* 11. Protection travels with the row the dialog is given.
      Reuses lastWinter (last year's matrix) from check 7. */
const protectedSeason = resolveSeasonForTravel({ rates: [lastWinter], currencyCode: 'ZAR', startDate: '2026-07-15', endDate: '2026-07-20', protectionPercent: 10 });
const protectedModal = buildRoomModalItem({
  base: { id: 'it1', name: 'X', item_rates: [lastWinter] },
  service: freshSvc,
  modalRates: [applyProtectionToRate(protectedSeason.rate, protectedSeason.protectionPercent)],
  season: protectedSeason
});
check('dialog receives the protected figure', getRateRow(protectedModal, 'ZAR').price_1_adult, 3327.5);
check('dialog flags a protected season', protectedModal._seasonStatus, 'protected');

/* 12. RENDER THE ACTUAL COMPONENT — the check the earlier build could not do.
      The season label is what tells an operator which matrix priced the room;
      with the raw multi-season item it cannot render, which is exactly how the
      wrong-season dialog went unnoticed. */
const renderModal = (it) => renderToStaticMarkup(
  React.createElement(RoomAllocationModal, {
    isOpen: true,
    onClose: () => {},
    onSave: () => {},
    item: it,
    itineraryTravellers: [
      { name: 'Misael', surname: 'Villalobos', age: 30 },
      { name: 'Zoya', surname: 'Knapp', age: 30 }
    ],
    currencyCode: 'ZAR',
    markupPct: 22
  })
);

const fixedHtml = renderModal(dropModalItem);
const rawHtml = renderModal({ ...libItem, maxOccupancy: 4, roomType: 'Standard Room' });

check('rendered dialog names the season', fixedHtml.includes('Season: Summer'), true);
check('rendered dialog shows the season window', fixedHtml.includes('2026-09-01 – 2027-03-31'), true);
check('rendered dialog shows the property', fixedHtml.includes('Southern Sun'), true);
check('rendered dialog shows contract occupancy', fixedHtml.includes('Contract Max Occupancy: 4'), true);
check('rendered dialog shows room type', fixedHtml.includes('Standard Room'), true);
/* The diagnostic that was missing from the reported screenshot. */
check('RAW multi-season item renders NO season label (the bug signal)', rawHtml.includes('Season:'), false);
check(
  'resolved and raw items declare different seasons',
  fixedHtml.includes('Season: Summer') && !rawHtml.includes('Season: Summer'),
  true
);

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
