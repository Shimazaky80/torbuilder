/* Which season prices a line, and what the builder is allowed to do about it.
   177 checks, 20 numbered blocks, all run through the SHIPPED modules
   (src/lib/priceValidity.js, accommodationOptions.js, servicePricing.js,
   roomAllocationHelper.js, packagePricing.js and the two charge dialogs).

   The case that opened this file — IT-2026-00001, Southern Sun The Cullinan,
   travel 2026-10-29 -> 2026-10-30, where line pricing read Winter 2026-04-01..
   2026-08-31 while the dialog displayed Summer 2026-09-01..2027-03-31:
     Summer: single 4260, 2-sharing 2290, 3+ 470
     Winter: single 3025, 2-sharing 1675 (the wrong one)
   Expect: season resolution -> Summer, and the room charge for 2 adults
   -> 2 x 2290 = 4580, NOT 2 x 1675 = 3350.

   Coverage beyond that regression:
     1-6   season resolution and the season-aware rate reader; the single,
           sharing and extra-adult room charges it produces
     7-8   Pricing Protection: only a PRIOR-YEAR season in the same calendar
           period may stand in, and a trip outside every season still falls back
     9-11  the charge dialog arriving with two candidate rows, and protection
           travelling with the row it is handed
     12    the dialogs rendered with react-dom/server (real component output)
     13-14 guide flat per-service-type rates; one accommodation at several
           charge types
     15-15e the out-of-season add flow: `future` consent, `stale` with no
           percentage, the one-off percentage the add dialog collects living on
           the line, the tightest-then-latest season tie-break, and `unit_cost`
           counting as a real price
     16-18 the reusable coverage note, pinned rows, and choices the dialog lists
     19-19f child fares: band selection by age, space-selling categories that
           ignore them, and the invoice breakdown for a mixed party
     20    extras charged per unit

   The source uses Vite-style extensionless imports, so this is bundled before
   it runs:  npm run test:pricing
*/
import { resolveSeasonForTravel, rateForTravel, applyProtectionToRate, rateTravelCoverage, seasonLineStatus, rateHasPrice, ESTIMATE_SEASON_STATUSES, CONSENT_SEASON_STATUSES, PROTECTABLE_SEASON_STATUSES } from '../src/lib/priceValidity.js';
import {
  accommodationOptionGroups,
  accommodationSeasonChoices,
  accommodationHasChoices,
  coverageNote,
  seasonChoiceLabel,
  seasonForRate,
  formatSeasonDate
} from '../src/lib/accommodationOptions.js';
import { calculateRoomCharges, getRateRow, buildRoomModalItem } from '../src/lib/roomAllocationHelper.js';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import RoomAllocationModal from '../src/components/RoomAllocationModal.jsx';
import AccommodationChargeModal from '../src/components/AccommodationChargeModal.jsx';
import {
  chargesChildRate,
  contractedServiceTotal,
  contractPaxRate,
  childAgesForParty,
  childFigureForLine,
  repriceServicesForPax,
  sidebarLibraryRate,
  supplierPaymentDocumentStatus
} from '../src/lib/servicePricing.js';
import { computePerPersonRows } from '../src/lib/perPersonPricing.js';

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
check('rendered dialog shows contract occupancy', fixedHtml.includes('Contract Capacity: 4 pax'), true);
check('rendered dialog shows room type', fixedHtml.includes('Standard Room'), true);
/* The diagnostic that was missing from the reported screenshot. */
check('RAW multi-season item renders NO season label (the bug signal)', rawHtml.includes('Season:'), false);
check(
  'resolved and raw items declare different seasons',
  fixedHtml.includes('Season: Summer') && !rawHtml.includes('Season: Summer'),
  true
);

/* 13. A guide prices from its per-service-type flat fields, so its dated
      season must count as priced even though the classic money columns are all
      zero. Without this the itinerary blocked every guide with "No season in
      the pricing matrix covers the travel dates". */
const guideRate = {
  id: 'r-guide', currency: 'ZAR', season_name: 'Base Season',
  valid_from: '2026-01-01', valid_to: '2026-12-31',
  guide_full_day_rate: 2360, guide_overland_rate: 3600,
  price_1_adult: 0, price_2_adults: 0, rate_basis: 'per_trip'
};
const guideSeason = resolveSeasonForTravel({
  rates: [guideRate], currencyCode: 'ZAR',
  startDate: '2026-10-29', endDate: '2026-10-30'
});
check('a guide season priced by its guide fields is not priceless', guideSeason.status, 'ok');
check('the guide season resolves and can be added', guideSeason.canAdd, true);
check('the guide season names itself', guideSeason.seasonName, 'Base Season');
const guideRow = rateForTravel({
  rates: [guideRate], currencyCode: 'ZAR',
  startDate: '2026-10-29', endDate: '2026-10-30'
});
check('rateForTravel keeps the guide full-day figure', guideRow.guide_full_day_rate, 2360);

/* 14. An accommodation negotiated at several charge types stores each option on
       the item_rates meal_plan. Prices are SEASON-first: one season is priced at
       several charge types, each at its own row, and a drop can pin the exact
       row the operator chose. */
const bbWinter = { id: 'r-bb-winter', currency: 'ZAR', meal_plan: 'Bed & Breakfast', season_name: 'Winter', valid_from: '2026-04-01', valid_to: '2026-08-31', price_2_adults: 1675, rate_basis: 'per_person_sharing' };
const bbSummer = { id: 'r-bb-summer', currency: 'ZAR', meal_plan: 'Bed & Breakfast', season_name: 'Summer', valid_from: '2026-09-01', valid_to: '2027-03-31', price_2_adults: 2290, rate_basis: 'per_person_sharing' };
const hbSummer = { id: 'r-hb-summer', currency: 'ZAR', meal_plan: 'Half Board', season_name: 'Summer', valid_from: '2026-09-01', valid_to: '2027-03-31', price_2_adults: 2680, rate_basis: 'per_person_sharing' };
const multiOptionItem = { item_rates: [bbWinter, bbSummer, hbSummer] };

const groups = accommodationOptionGroups(multiOptionItem.item_rates);
check('accommodation rows group into one group per charge option', groups.map((g) => g.label).join(','), 'Bed & Breakfast,Half Board');
check('each option keeps its own season rows', groups.map((g) => g.rates.length).join(','), '2,1');

const choices = accommodationSeasonChoices(multiOptionItem);
check('season choices group SEASON-first', choices.map((c) => c.name).join(','), 'Winter,Summer');
check('a season lists every charge type priced for it', choices.map((c) => c.options.map((o) => o.label).join('|')).join(','), 'Bed & Breakfast,Bed & Breakfast|Half Board');
check('each season row keeps its exact rate id', choices[1].options.map((o) => o.rateId).join(','), 'r-bb-summer,r-hb-summer');
check('one season with one option groups into a single season', accommodationSeasonChoices({ item_rates: [bbSummer] }).length, 1);

check('an accommodation with several charge types on a season prompts on drop', accommodationHasChoices(multiOptionItem), true);
check('a single option priced over two seasons also prompts', accommodationHasChoices({ item_rates: [bbWinter, bbSummer] }), true);
check('a single charge type on a single season does not prompt', accommodationHasChoices({ item_rates: [bbSummer] }), false);
check('the Skukuza case - one season at Bed & Breakfast AND Half Board - prompts', accommodationHasChoices({ item_rates: [bbSummer, hbSummer] }), true);

check('formatSeasonDate prints YYYY/MM/DD', formatSeasonDate('2027-04-01'), '2027/04/01');
check('seasonChoiceLabel shows season with its exact window', seasonChoiceLabel({ name: 'Summer', validFrom: '2027-04-01', validTo: '2027-08-31' }), 'Summer: 2027/04/01-2027/08/31');

const pinned = seasonForRate(hbSummer);
check('a pinned rate yields an addable ok season', pinned.status, 'ok');
check('pinned season can add', pinned.canAdd, true);
check('pinned season prices from the chosen row', pinned.rate.id, 'r-hb-summer');
check('pinned season names the chosen option season', pinned.seasonName, 'Summer');
const pinnedHalfBoard = seasonForRate({ ...hbSummer, price_2_adults: 0 });
check('an unpriced pinned row is flagged, not silently added', pinnedHalfBoard.canAdd, false);

/* 15. A season that starts AFTER the trip (travel 2027-02-16..28 against a
       season opening 2027-03-03) is a future season, not a stale one. Its price
       is usable only as a pre-season estimate, with explicit consent and no
       Pricing Protection. */
const marchSeason = {
  id: 'r-march-2027', currency: 'ZAR', season_name: 'Green Season',
  valid_from: '2027-03-03', valid_to: '2027-05-31',
  price_2_adults: 1850, rate_basis: 'per_person_sharing'
};
const futureTrip = { start: '2027-02-16', end: '2027-02-28' };

const futureSeason = resolveSeasonForTravel({
  rates: [marchSeason], currencyCode: 'ZAR',
  startDate: futureTrip.start, endDate: futureTrip.end
});
check('a season starting after the trip is reported as future', futureSeason.status, 'future');
check('a future season is refused without explicit consent', futureSeason.canAdd, false);
check('a future season still exposes its row for display', futureSeason.rate.id, 'r-march-2027');
check('a future season carries no Pricing Protection', futureSeason.protectionPercent, 0);
check('a future season names its start date', futureSeason.validFrom, '2027-03-03');

const futureAllowed = resolveSeasonForTravel({
  rates: [marchSeason], currencyCode: 'ZAR',
  startDate: futureTrip.start, endDate: futureTrip.end,
  allowFuture: true
});
check('a future season can be added once consented', futureAllowed.canAdd, true);
check('a consented future season is still an estimate, never ok', futureAllowed.status, 'future');
check('a consented future season keeps its contracted figure', futureAllowed.rate.price_2_adults, 1850);

/* Protection still wins over a future season: an earlier season sharing the
   trip's calendar period is the better basis and the existing safeguard. */
const priorWinterForFuture = { ...winter, valid_from: '2025-04-01', valid_to: '2025-08-31' };
const nextWinter = { ...winter, valid_from: '2027-03-03', valid_to: '2027-05-31' };
const protectedOverFuture = resolveSeasonForTravel({
  rates: [priorWinterForFuture, nextWinter], currencyCode: 'ZAR',
  startDate: '2026-07-15', endDate: '2026-07-20', protectionPercent: 10
});
check('an earlier same-period season still wins over a future one', protectedOverFuture.status, 'protected');
check('the prior season carries the protection uplift', protectedOverFuture.protectionPercent, 10);

/* 15b. The same prior season with NO protection percentage set. This is the
       case that used to come back as 'ok' and be recorded as a matched line, so
       a 2025 contract price could bill a 2026 trip with no badge and no
       question asked. It is an estimate now, and it says which season it is. */
const barePriorSeason = { ...winter, id: 'r-winter-2025-bare', valid_from: '2025-03-16', valid_to: '2025-08-31' };
const unprotected = resolveSeasonForTravel({
  rates: [barePriorSeason], currencyCode: 'ZAR',
  startDate: '2026-07-15', endDate: '2026-07-20'
});
check('a prior season with no protection percentage is stale, not ok', unprotected.status, 'stale');
check('a stale season can be added once the operator answers', unprotected.canAdd, true);
check('a stale season is confirmed before it lands', CONSENT_SEASON_STATUSES.has(unprotected.status), true);
check('the confirmation offers a percentage for a stale season', PROTECTABLE_SEASON_STATUSES.has(unprotected.status), true);
check('a future season still needs consent', CONSENT_SEASON_STATUSES.has('future'), true);
/* Uplifting a season that belongs to a year ahead of the trip, or a live season
   that only misses part of the trip, would misprice the days it is used for. */
check('a future season is never offered a percentage', PROTECTABLE_SEASON_STATUSES.has('future'), false);
check('a part-covering season is never offered a percentage', PROTECTABLE_SEASON_STATUSES.has('partial'), false);
check('a stale season carries no uplift', unprotected.protectionPercent, 0);
check('a stale season counts the years behind the trip', unprotected.staleByYears, 1);
check('a stale season names the season it prices from', unprotected.seasonName, 'Winter');
check('a stale season states its own start date', unprotected.validFrom, '2025-03-16');
check('a stale reason gives the exact window', unprotected.reason.includes('2025-03-16 to 2025-08-31'), true);
check('a stale reason says the old figure is what is charged', unprotected.reason.includes('no Pricing Protection percentage set'), true);
check('a stale season is an estimate on the line, never a match', seasonLineStatus(unprotected, 0), 'estimate');
check('a stale season is warned as an estimate', ESTIMATE_SEASON_STATUSES.has(unprotected.status), true);
check('a stale season keeps the contract figure it quotes', unprotected.rate.price_2_adults, 1675);

/* 15c. The percentage typed into the add dialog belongs to the line, not to
        Settings. Re-pricing for a bigger party must keep charging at the figure
        agreed when the line was dropped, and a line saved with no percentage must
        not pick up one it was never given. */
const priorVehicleRate = { ...vehicleRate, valid_from: '2025-01-01', valid_to: '2025-12-31', price_1_adult: 1000, unit_price: 1000 };
const priorVehicleItem = {
  id: 'prior-vehicle', category: 'Transfers', pricing_model: 'per_vehicle',
  currency: 'ZAR', item_rates: [priorVehicleRate]
};
const priorLine = (percent) => ({
  itemId: priorVehicleItem.id, name: 'Prior-year transfer', category: 'Transfers',
  currencyCode: 'ZAR', basis: 'per_vehicle', buyPP: 500, sellPP: 500, markup: 0, pax: 2,
  priceProtectionPercent: percent
});
const repricedAtOwnPercent = repriceServicesForPax({
  days: [{ services: [priorLine(8)] }],
  libraryItems: [priorVehicleItem],
  paxCount: 4,
  travelWindow: { start: '2026-10-29', end: '2026-10-30' }
}).days[0].services[0];
check('a line keeps the percentage agreed at its drop', repricedAtOwnPercent.priceProtectionPercent, 8);
check('a kept percentage re-prices off the uplifted rate', repricedAtOwnPercent.buyPP, 270);
check('a kept percentage restamps the line as protected', repricedAtOwnPercent.rateSeasonStatus, 'protected');
const repricedWithoutPercent = repriceServicesForPax({
  days: [{ services: [priorLine(0)] }],
  libraryItems: [priorVehicleItem],
  paxCount: 4,
  travelWindow: { start: '2026-10-29', end: '2026-10-30' }
}).days[0].services[0];
check('a line added unprotected stays at the old contract figure', repricedWithoutPercent.buyPP, 250);
check('an unprotected line is still marked as an estimate', repricedWithoutPercent.rateSeasonStatus, 'estimate');

/* 15d. Which season the resolver picks, on the shape the operator asked about:
        Cape Turismo transfer Airport to CBD contracted 01 Nov - 31 Oct, with a
        2025-11-01..2026-10-31 row and a 2026-11-01..2027-10-31 row. */
const novToOct2025 = {
  id: 'ct-2025', currency: 'ZAR', season_name: 'Nov 2025 - Oct 2026',
  valid_from: '2025-11-01', valid_to: '2026-10-31',
  rate_basis: 'per_vehicle', price_1_adult: 900, unit_price: 900
};
const novToOct2026 = {
  id: 'ct-2026', currency: 'ZAR', season_name: 'Nov 2026 - Oct 2027',
  valid_from: '2026-11-01', valid_to: '2027-10-31',
  rate_basis: 'per_vehicle', price_1_adult: 1000, unit_price: 1000
};
const ctRates = [novToOct2025, novToOct2026];
const ctInside = resolveSeasonForTravel({
  rates: ctRates, currencyCode: 'ZAR', startDate: '2027-03-14', endDate: '2027-03-18'
});
check('a trip inside the newer season takes the newer season', ctInside.status, 'ok');
check('the newer season is the row the line is priced from', ctInside.rate.id, 'ct-2026');
check('the newer season names its own window', ctInside.validFrom, '2026-11-01');
/* Reverse the order the database returned them and the answer must not move. */
const ctInsideReversed = resolveSeasonForTravel({
  rates: [novToOct2026, novToOct2025], currencyCode: 'ZAR', startDate: '2027-03-14', endDate: '2027-03-18'
});
check('query order cannot change the season picked', ctInsideReversed.rate.id, 'ct-2026');

/* A full-calendar-year trip is NOT inside either Nov-to-Oct season: neither row
   spans 01 Jan to 31 Dec, so the resolver does not quietly price it. The newest
   season still standing behind the trip is offered as a stand-in, uplifted when
   a percentage exists and called stale when it does not. */
const ctWholeYear = resolveSeasonForTravel({
  rates: ctRates, currencyCode: 'ZAR',
  startDate: '2027-01-01', endDate: '2027-12-31', protectionPercent: 5
});
check('a window no Nov-to-Oct season spans is not an exact match', ctWholeYear.status, 'protected');
check('the closest prior season stands in, not the oldest one', ctWholeYear.rate.id, 'ct-2026');
check('the standing-in season is one year behind the trip', ctWholeYear.staleByYears, 1);
const ctWholeYearBare = resolveSeasonForTravel({
  rates: ctRates, currencyCode: 'ZAR', startDate: '2027-01-01', endDate: '2027-12-31'
});
check('with no percentage it is called stale instead', ctWholeYearBare.status, 'stale');

/* Two seasons of equal length both covering a trip - a calendar-year contract and
   a Nov-to-Oct contract - are decided by currency, not by query order. */
const calendar2026 = {
  id: 'cal-2026', currency: 'ZAR', season_name: 'Jan - Dec 2026',
  valid_from: '2026-01-01', valid_to: '2026-12-31',
  rate_basis: 'per_vehicle', price_1_adult: 800, unit_price: 800
};
const ctTied = resolveSeasonForTravel({
  rates: [calendar2026, novToOct2026], currencyCode: 'ZAR',
  startDate: '2026-11-15', endDate: '2026-11-20'
});
check('equal-length seasons are decided by which starts later', ctTied.rate.id, 'ct-2026');
const ctTiedReversed = resolveSeasonForTravel({
  rates: [novToOct2026, calendar2026], currencyCode: 'ZAR',
  startDate: '2026-11-15', endDate: '2026-11-20'
});
check('the tie-break does not depend on query order', ctTiedReversed.rate.id, 'ct-2026');

/* 15e. A vehicle contract can carry its figure only in `unit_cost`. That is a
       real price on the row, so the season must be usable and not reported as
       empty. */
const unitCostOnly = {
  id: 'uc-only', currency: 'ZAR', season_name: 'Nov 2026 - Oct 2027',
  valid_from: '2026-11-01', valid_to: '2027-10-31',
  rate_basis: 'per_vehicle', unit_cost: 1000
};
check('a season priced only in unit_cost is a priced season', rateHasPrice(unitCostOnly), true);
const unitCostTrip = resolveSeasonForTravel({
  rates: [unitCostOnly], currencyCode: 'ZAR', startDate: '2027-03-14', endDate: '2027-03-18'
});
check('a unit_cost-only season covers the trip', unitCostTrip.status, 'ok');
check('the trip is priced from the unit_cost row', unitCostTrip.rate.id, 'uc-only');

/* 16. The reusable coverage check, which the dialog labels and line badges use. */
check('coverage: a covering season', rateTravelCoverage(summer, travel.start, travel.end).status, 'covers');
check('coverage: a season that ended before the trip', rateTravelCoverage(winter, travel.start, travel.end).status, 'ends_before');
check('coverage: a season that starts after the trip', rateTravelCoverage(marchSeason, futureTrip.start, futureTrip.end).status, 'starts_after');
const expiresMidTrip = { ...summer, valid_from: '2026-10-01', valid_to: '2026-11-25' };
check('coverage: a season that expires mid-trip', rateTravelCoverage(expiresMidTrip, '2026-11-20', '2026-12-05').status, 'ends_during');
const startsMidTrip = { ...summer, valid_from: '2026-11-01', valid_to: '2027-03-31' };
check('coverage: a season that starts mid-trip', rateTravelCoverage(startsMidTrip, '2026-10-29', '2026-11-05').status, 'starts_during');
check('coverage: an undated row', rateTravelCoverage({ valid_from: null, valid_to: null }, travel.start, travel.end).status, 'undated');
check('coverage: unset travel dates', rateTravelCoverage(marchSeason, '', '').status, 'open');
check('coverage note names a future window', coverageNote(rateTravelCoverage(marchSeason, futureTrip.start, futureTrip.end)), 'starts after the trip (2027/03/03)');

/* 17. A pinned row (the dialog's explicit choice) follows the same rule. */
const pinnedFuture = seasonForRate(marchSeason, { startDate: futureTrip.start, endDate: futureTrip.end });
check('a pinned future row needs consent', pinnedFuture.status, 'future');
check('a pinned future row cannot add without consent', pinnedFuture.canAdd, false);
const pinnedFutureAllowed = seasonForRate(marchSeason, { startDate: futureTrip.start, endDate: futureTrip.end, allowEstimate: true });
check('a pinned future row adds as an estimate with consent', pinnedFutureAllowed.canAdd, true);
check('a pinned estimate carries no protection', pinnedFutureAllowed.protectionPercent, 0);
const pinnedExpired = seasonForRate(winter, { startDate: travel.start, endDate: travel.end });
check('a pinned season that ended is reported as expired', pinnedExpired.status, 'expired');
const pinnedPartial = seasonForRate(expiresMidTrip, { startDate: '2026-11-20', endDate: '2026-12-05' });
check('a pinned season that expires mid-trip is partial', pinnedPartial.status, 'partial');

/* 18. The charge dialog used to filter out every season that did not cover the
       trip, leaving the future-only case with an empty list while Apply stayed
       enabled on a hidden rate. Every window must be listed and chooseable, with
       a non-covering choice clearly labelled as an estimate. */
const futureLodge = {
  name: 'Future Lodge',
  item_rates: [
    { ...marchSeason, meal_plan: 'Bed & Breakfast' },
    { ...marchSeason, id: 'r-march-hb', meal_plan: 'Half Board', price_2_adults: 2200 }
  ]
};
const renderChargeModal = (modalItem, start, end, defaultRate = '') => renderToStaticMarkup(
  React.createElement(AccommodationChargeModal, {
    item: modalItem,
    currency: 'ZAR',
    travelStart: start,
    travelEnd: end,
    defaultRateId: defaultRate,
    onConfirm: () => {},
    onCancel: () => {}
  })
);
const futureModalHtml = renderChargeModal(futureLodge, futureTrip.start, futureTrip.end);
check('future-only accommodation still lists its season', futureModalHtml.includes('Green Season'), true);
check('future-only accommodation shows the exact validity window', futureModalHtml.includes('2027/03/03-2027/05/31'), true);
check('future-only accommodation says the window starts after the trip', futureModalHtml.includes('starts after the travel dates'), true);
check('future-only accommodation offers the estimate action', futureModalHtml.includes('Apply estimate'), true);
check('future-only accommodation shows the charge types', futureModalHtml.includes('Half Board'), true);

const allWindowsHtml = renderChargeModal({ name: 'Both Seasons', item_rates: [bbWinter, bbSummer] }, travel.start, travel.end);
check('the dialog lists a season that ended before the trip', allWindowsHtml.includes('Winter'), true);
check('the dialog still lists the covering season', allWindowsHtml.includes('Summer'), true);
check('a covering selection uses the ordinary apply action', allWindowsHtml.includes('Apply charge type'), true);

/* 19. CHILD FARES ON A PER-HEAD LINE.
       A meal, an entry and an extra are bought per head, so a child is charged the
       figure the supplier contracted for them. Everything else on a day line sells
       SPACE - a seat on a transfer, a place on a tour, a berth on a train, a
       charter, a rental car - and a child takes the same space as an adult, so it
       pays the adult figure even when the supplier's rate card quotes a child fare.
       A party with no children must price exactly as it did before this rule
       existed: every check below has a child-free twin. */
const mealRate = {
  id: 'r-meal', currency: 'ZAR', season_name: 'Base Season',
  valid_from: '2026-01-01', valid_to: '2026-12-31',
  rate_basis: 'per_person', price_1_adult: 400, unit_price: 400,
  child_rates_breakdown: { child: 250 }
};
const mealItem = {
  id: 'meal-1', name: 'Buffet lunch', category: 'Meals',
  pricing_model: 'per_person', child_age_ranges: [], item_rates: [mealRate]
};
const ticketRate = {
  id: 'r-ticket', currency: 'ZAR', season_name: 'Base Season',
  valid_from: '2026-01-01', valid_to: '2026-12-31',
  rate_basis: 'per_person', price_1_adult: 500, unit_price: 500,
  child_sharing_policy: 'by_age_range',
  child_rates_breakdown: { b1: 100, b2: 200 }
};
const ticketItem = {
  id: 'ticket-1', name: 'Park entry', category: 'Tickets',
  pricing_model: 'per_person',
  child_age_ranges: [
    { id: 'b1', name: '2-5', ageFrom: 2, ageTo: 5 },
    { id: 'b2', name: '6-11', ageFrom: 6, ageTo: 11 }
  ],
  item_rates: [ticketRate]
};

check('a per-head category is the only kind that charges a child', [
  chargesChildRate(mealItem), chargesChildRate(ticketItem), chargesChildRate({ category: 'Extras' }),
  chargesChildRate({ category: 'Transfers' }), chargesChildRate({ category: 'Transport' }),
  chargesChildRate({ category: 'Trains' }),
  chargesChildRate({ category: 'Activities / Tours' }), chargesChildRate({ category: 'Fees & Tickets' })
].join(','), 'true,true,true,false,false,false,false,false');

/* 19a. Parity: nothing moves for a party of adults. */
check('an adult-only party still pays the library figure per person', contractPaxRate(mealItem, 'ZAR', 3), 400);
check('a child-free roster never changes a line', contractPaxRate(mealItem, 'ZAR', 3, {
  childCount: 0, travellers: [{ age: 40 }, { age: 38 }, { age: 35 }]
}), 400);

/* 19b. A child on a per-head line pays the contracted child figure. */
check('one child on a table of 3 is charged the child meal price', contractPaxRate(mealItem, 'ZAR', 3, { childCount: 1 }), (400 * 2 + 250) / 3);
check('the mixed average re-adds to what the party is invoiced', Math.round(contractPaxRate(mealItem, 'ZAR', 3, { childCount: 1 }) * 3), 1050);
check('both children on a table of 4 pay it twice', contractPaxRate(mealItem, 'ZAR', 4, { childCount: 2 }), (400 * 2 + 250 * 2) / 4);

/* 19c. Ages pick the band; no age picks the most expensive published band. */
check('an 8 year old pays the 6-11 entry band', contractPaxRate(ticketItem, 'ZAR', 3, { childCount: 1, childAges: [8] }), (500 * 2 + 200) / 3);
check('a 4 year old pays the 2-5 entry band', contractPaxRate(ticketItem, 'ZAR', 3, { childCount: 1, childAges: [4] }), (500 * 2 + 100) / 3);
check('a child with no birthday on file pays the dearest band, not the infant one',
  contractPaxRate(ticketItem, 'ZAR', 3, { childCount: 1 }), (500 * 2 + 200) / 3);
check('the roster supplies the ages when the party typed them', childAgesForParty({
  childCount: 2, travellers: [{ age: 41 }, { age: 8 }, { age: 4 }, { age: 22 }]
}).join(','), '8,4');
check('a declared all-adult party stays adult even with a stale child on the roster',
  childAgesForParty({ childCount: 0, travellers: [{ age: 41 }, { age: 8 }] }).length, 0);
check('a declared child count with no roster is age-less, not silently ignored',
  childAgesForParty({ childCount: 2, travellers: [] }).join(','), ',');
check('an item with no child figure charges the child the adult rate',
  childFigureForLine({ ...mealRate, child_rates_breakdown: {} }, mealItem, 8, 400), null);
check('a configured zero is a genuinely free child',
  childFigureForLine({ ...mealRate, child_rates_breakdown: { child: 0 } }, mealItem, 8, 400), 0);

/* 19d. Space-selling categories ignore the child fare their rate card quotes. */
check('a transfer with a quoted child fare still charges 400 a head',
  contractPaxRate({ ...mealItem, category: 'Transfers' }, 'ZAR', 3, { childCount: 1 }), 400);
check('a train berth with a quoted child fare still charges 400 a head',
  contractPaxRate({ ...mealItem, category: 'Trains' }, 'ZAR', 3, { childCount: 1 }), 400);
check('a tour place with a quoted child fare still charges 400 a head',
  contractPaxRate({ ...mealItem, category: 'Activities / Tours' }, 'ZAR', 3, { childCount: 1 }), 400);
check('a hired vehicle seat with a quoted child fare still charges 400 a head',
  contractPaxRate({ ...mealItem, category: 'Transport' }, 'ZAR', 3, { childCount: 1 }), 400);
check('a charter with a quoted child fare stays a flat figure split by the party',
  contractPaxRate({ ...mealItem, category: 'Flights / Charter', item_rates: [{ ...mealRate, rate_basis: 'per_trip' }] }, 'ZAR', 3, { childCount: 1 }), 400 / 3);
check('a tiered tour is still priced off its party-size tier',
  contractPaxRate(tieredActivity, 'ZAR', 3, { childCount: 1 }), 700);

/* 19e. The preview and the party-size reprice both follow the line price, so an
       operator never drops an item at one figure and sees another on the line. */
check('the sidebar previews the mixed party price', sidebarLibraryRate(mealItem, 'ZAR', 3, { childCount: 1 }), 350);
const repricedMeal = repriceServicesForPax({
  days: [{ services: [{
    itemId: mealItem.id, name: 'Buffet lunch', category: 'Meals', currencyCode: 'ZAR',
    buyPP: 400, sellPP: 480, markup: 20, pax: 2
  }] }],
  libraryItems: [mealItem],
  paxCount: 3,
  childCount: 1,
  travellers: [{ age: 40 }, { age: 38 }, { age: 8 }],
  travelWindow: { start: '2026-10-29', end: '2026-10-30' }
});
check('a party-size reprice carries the child into the line', Math.round(repricedMeal.days[0].services[0].buyPP * 100) / 100, 350);
check('the repriced line sells the whole party at the mixed price once markuped',
  Math.round(repricedMeal.days[0].services[0].sellPP * 3 * 100) / 100, 1260);

/* 19f. THE INVOICE BREAKDOWN: the per-person sharing row keeps the adult figure
       and the child row shows what a child actually costs, while the two rows
   still re-add to the day total the line was bought at. */
const breakdownRows = computePerPersonRows({
  services: [{
    category: 'Meals', currencyCode: 'ZAR', sellPP: 420, taxRate: 15,
    itemId: mealItem.id, item_rates: [mealRate], markup: 20, roomAllocations: []
  }],
  travellers: [{ age: 40 }, { age: 38 }, { age: 8 }],
  rateBy: () => ({ ...mealRate, _ageRanges: [] }),
  defaultTaxRate: 15
});
check('the sharing row shows the adult meal price', Math.round(breakdownRows.perPersonSharing.sell), 480);
check('the child row shows the child meal price', Math.round(breakdownRows.perChild.sell), 300);
check('the two rows re-add to the day total',
  Math.round((breakdownRows.perPersonSharing.sell * 2 + breakdownRows.perChild.sell) * 100) / 100, 1260);
const transferRows = computePerPersonRows({
  services: [{
    category: 'Transfers', currencyCode: 'ZAR', sellPP: 420, taxRate: 15,
    itemId: mealItem.id, item_rates: [mealRate], markup: 20, roomAllocations: []
  }],
  travellers: [{ age: 40 }, { age: 38 }, { age: 8 }],
  rateBy: () => ({ ...mealRate, _ageRanges: [] }),
  defaultTaxRate: 15
});
check('a seat-selling line charges the child the adult rate, so the rows stay whole',
  Math.round(transferRows.perPersonSharing.sell), 420);

/* 20. AN EXTRA CHARGED PER UNIT.
       An extra may be bought per guest (a child's seat on a cooking class) or as
       one service (a boat hired for the afternoon). The per-unit figure is the
       contract total, never a head price: it is stored divided by the party so the
       line still reconciles, and it must not move with the party size or with the
       number of children in it. */
const unitExtraRate = {
  id: 'r-extra-unit', currency: 'ZAR', season_name: 'Base Season',
  valid_from: '2026-01-01', valid_to: '2026-12-31',
  rate_basis: 'per_unit', price_1_adult: 3500, unit_price: 3500,
  child_rates_breakdown: { child: 1200 }
};
const unitExtraItem = {
  id: 'extra-unit', name: 'Private boat hire', category: 'Extras',
  pricing_model: 'per_unit', child_age_ranges: [], item_rates: [unitExtraRate]
};
const headExtraItem = {
  id: 'extra-head', name: 'Cooking class', category: 'Extras',
  pricing_model: 'per_person', child_age_ranges: [],
  item_rates: [{ ...unitExtraRate, id: 'r-extra-head', rate_basis: 'per_person', price_1_adult: 850, unit_price: 850, child_rates_breakdown: { child: 450 } }]
};

check('a per-unit extra bills no head, so it contracts no child price', [
  chargesChildRate(unitExtraItem), chargesChildRate(headExtraItem)
].join(','), 'false,true');
check('a per-unit extra is one service, not a price per guest',
  Math.round(contractPaxRate(unitExtraItem, 'ZAR', 4) * 4), 3500);
check('the same boat costs 2 guests and 6 guests the same money', [
  Math.round(contractPaxRate(unitExtraItem, 'ZAR', 2) * 2),
  Math.round(contractPaxRate(unitExtraItem, 'ZAR', 6) * 6)
].join(','), '3500,3500');
check('children in the party add nothing to a per-unit extra',
  Math.round(contractPaxRate(unitExtraItem, 'ZAR', 4, { childCount: 2 }) * 4), 3500);
check('the sidebar previews the whole service price',
  sidebarLibraryRate(unitExtraItem, 'ZAR', 4), 3500);
check('a per-person twin still charges each child their own figure',
  contractPaxRate(headExtraItem, 'ZAR', 3, { childCount: 1 }), (850 * 2 + 450) / 3);

const repricedUnit = repriceServicesForPax({
  days: [{ services: [{
    itemId: unitExtraItem.id, name: 'Private boat hire', category: 'Extras',
    currencyCode: 'ZAR', buyPP: 1166.67, sellPP: 1400, markup: 20, pax: 3
  }] }],
  libraryItems: [unitExtraItem],
  paxCount: 5,
  travelWindow: { start: '2026-10-29', end: '2026-10-30' }
});
check('a bigger party re-splits the one service, it does not multiply it',
  contractedServiceTotal(repricedUnit.days[0].services[0], 5), 3500);
check('a re-priced per-unit line keeps the flat basis',
  repricedUnit.days[0].services[0].basis, 'per_unit');

const unitRows = computePerPersonRows({
  services: [{
    category: 'Extras', basis: 'per_unit', currencyCode: 'ZAR', sellPP: 875, taxRate: 15,
    itemId: unitExtraItem.id, item_rates: [unitExtraRate], markup: 20, roomAllocations: []
  }],
  travellers: [{ age: 40 }, { age: 38 }, { age: 9 }, { age: 6 }],
  rateBy: () => ({ ...unitExtraRate, _ageRanges: [] }),
  defaultTaxRate: 15
});
check('a per-unit extra prints no child discount - a child pays the party figure',
  unitRows.perChild.sell, unitRows.perPersonSharing.sell);
check('a per-unit extra keeps the whole party on one sharing row',
  Math.round(unitRows.perPersonSharing.sell * 4), 3500);
const headRows = computePerPersonRows({
  services: [{
    category: 'Extras', basis: 'per_person', currencyCode: 'ZAR', sellPP: 1020, taxRate: 15,
    itemId: headExtraItem.id, item_rates: headExtraItem.item_rates[0], markup: 20, roomAllocations: []
  }],
  travellers: [{ age: 40 }, { age: 38 }, { age: 9 }],
  rateBy: () => ({ ...headExtraItem.item_rates[0], _ageRanges: [] }),
  defaultTaxRate: 15
});
check('a per-person extra still splits its child onto its own row',
  Math.round(headRows.perPersonSharing.sell * 2 + headRows.perChild.sell), 3060);

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
