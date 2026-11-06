import {
  SURCHARGE_CATEGORY,
  SURCHARGE_TYPES,
  isSurchargeItem,
  surchargeTypeOf,
  surchargeTypeLabel,
  surchargeBasisOf,
  surchargeUnitBasisOf,
  surchargeRateColumns,
  surchargeRateAmount,
  unitBasesFor,
  isValidUnitBasis,
  feeEditorRowFromRecord,
  feeSeasonKey,
  feeAmountsBySeason,
  feeRatePayload,
  moveFeeAmount,
  surchargeBuyTotal,
  surchargeChildAmount,
  surchargeGuideAmount,
  feeBasisChargesHeads,
  surchargePricing
} from '../src/lib/surchargeFees.js';
import { libraryItemKind } from '../src/lib/libraryItemDetail.js';
import { sidebarLibraryRate } from '../src/lib/servicePricing.js';
import { computePerPersonRows, perPersonHeadBreakdown } from '../src/lib/perPersonPricing.js';

const check = (label, actual, expected) => {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  if (!passed) process.exitCode = 1;
};

/* (A) The rename covers tickets as well as levies, and old rows still read. */
check('the category is named Fees & Tickets', SURCHARGE_CATEGORY, 'Fees & Tickets');
check('the new name reads as a fee', isSurchargeItem({ category: 'Fees & Tickets' }), true);
check('rows saved under the old name still read as fees', isSurchargeItem({ category: 'Surcharge Fees' }), true);
check('an accommodation is not a fee', isSurchargeItem({ category: 'Accommodation' }), false);
check('the detail view keys a fee off the new name', libraryItemKind('Fees & Tickets'), 'surcharge');

/* (B) A fee figure is written into exactly the column its type and basis read. */
const entranceItem = { category: SURCHARGE_CATEGORY, surcharge_type: 'entrance_fee' };
const levyItem = { category: SURCHARGE_CATEGORY, surcharge_type: 'conservation_levy' };
check('entrance fee per person writes the per-person column',
  surchargeRateColumns({ type: 'entrance_fee', unitBasis: 'per_person', amount: '850' }),
  { entrance_fee_per_person: 850 });
check('entrance fee per vehicle writes the per-vehicle column',
  surchargeRateColumns({ type: 'entrance_fee', unitBasis: 'per_vehicle', amount: '1200' }),
  { entrance_fee_per_vehicle: 1200 });
check('levy per adult writes the adult column',
  surchargeRateColumns({ type: 'conservation_levy', unitBasis: 'per_adult', amount: '120' }),
  { conservation_levy_per_adult: 120 });
check('levy per child writes the child column',
  surchargeRateColumns({ type: 'conservation_levy', unitBasis: 'per_child', amount: '60' }),
  { conservation_levy_per_child: 60 });
check('a per-unit fee writes the unit price',
  surchargeRateColumns({ type: 'entrance_fee', unitBasis: 'per_unit', amount: '500' }),
  { unit_price: 500 });
check('a blank amount stores a blank, not a free fee',
  surchargeRateColumns({ type: 'entrance_fee', unitBasis: 'per_person', amount: '' }),
  { entrance_fee_per_person: null });

/* (C) Each column round-trips through the reader the editor uses. */
const roundTrips = [
  ['entrance per person', entranceItem, 'per_person', 850],
  ['entrance per vehicle', entranceItem, 'per_vehicle', 1200],
  ['levy per adult', levyItem, 'per_adult', 120],
  ['levy per person', levyItem, 'per_person', 120],
  ['levy per child', levyItem, 'per_child', 60],
  ['fee per unit', entranceItem, 'per_unit', 500]
];
roundTrips.forEach(([label, item, unitBasis, amount]) => {
  const row = feeRatePayload({
    itemId: 'fee-1',
    currency: 'ZAR',
    seasonName: 'High season',
    validFrom: '2026-06-01',
    validTo: '2026-09-30',
    type: surchargeTypeOf(item),
    unitBasis,
    amount
  });
  const readItem = { ...item, surcharge_unit_basis: unitBasis };
  check(`${label} round-trips through its column`, surchargeRateAmount(row, readItem), amount);
});

/* (D) A fee's rate row carries the property's season window, not its own. */
const seasonRow = feeRatePayload({
  itemId: 'fee-2',
  currency: 'ZAR',
  seasonName: 'Low season',
  validFrom: '2026-01-01',
  validTo: '2026-05-31',
  type: 'conservation_levy',
  unitBasis: 'per_adult',
  amount: 90
});
check('the fee row mirrors the property season window',
  [seasonRow.season_name, seasonRow.valid_from, seasonRow.valid_to], ['Low season', '2026-01-01', '2026-05-31']);
check('an undated season stays open-ended', [seasonRow.valid_from !== null, feeRatePayload({ itemId: 'x', validFrom: '', validTo: '', amount: 10 }).valid_from], [true, null]);
check('the fee row carries only its own figure',
  [seasonRow.price_1_adult, seasonRow.conservation_levy_per_adult, seasonRow.entrance_fee_per_person],
  [null, 90, undefined]);

/* (E) Reading a saved fee back: a priced season supplies the one figure the
   property editor holds, and the fee's own terms survive. */
const savedLevy = {
  id: 'fee-3',
  name: 'Kruger conservation levy',
  category: SURCHARGE_CATEGORY,
  surcharge_type: 'conservation_levy',
  surcharge_charge_basis: 'per_night',
  surcharge_unit_basis: 'per_adult',
  surcharge_chargeable: false,
  item_rates: [
    { id: 'r1', season_name: 'Low season', conservation_levy_per_adult: null },
    { id: 'r2', season_name: 'High season', conservation_levy_per_adult: 140 }
  ]
};
check('a saved fee reads back into one editor row', feeEditorRowFromRecord(savedLevy), {
  key: 'fee_fee-3',
  dbId: 'fee-3',
  name: 'Kruger conservation levy',
  type: 'conservation_levy',
  chargeBasis: 'per_night',
  unitBasis: 'per_adult',
  chargeable: false,
  amount: '140',
  amounts: { 'High season||': '140' },
  childAmounts: {}
});

/* A fee is charged per season now: each priced rate row supplies that season's
   amount, and a season with no row (or a blank row) is not charged at all. */
const feeSeasons = [
  { seasonName: 'Low season', validFrom: '2026-01-01', validTo: '2026-05-31' },
  { seasonName: 'High season', validFrom: '2026-06-01', validTo: '2026-09-30' }
];
const savedLevyPerSeason = {
  ...savedLevy,
  item_rates: [
    { id: 'r1', season_name: 'Low season', valid_from: '2026-01-01', valid_to: '2026-05-31', conservation_levy_per_adult: 90 },
    { id: 'r2', season_name: 'High season', valid_from: '2026-06-01', valid_to: '2026-09-30', conservation_levy_per_adult: 140 }
  ]
};
check('a fee key normalises a blank name and a timestamp',
  feeSeasonKey('  ', '2026-06-01T00:00:00', ''), 'Base Season|2026-06-01|');
check('a fee reads one amount per season', feeAmountsBySeason(savedLevyPerSeason, feeSeasons), {
  [feeSeasonKey('Low season', '2026-01-01', '2026-05-31')]: '90',
  [feeSeasonKey('High season', '2026-06-01', '2026-09-30')]: '140'
});
check('only the season that has a fee row is priced',
  feeAmountsBySeason({ ...savedLevyPerSeason, item_rates: [savedLevyPerSeason.item_rates[1]] }, feeSeasons),
  { [feeSeasonKey('High season', '2026-06-01', '2026-09-30')]: '140' });
check('a renamed season finds its amount by window',
  feeAmountsBySeason(savedLevyPerSeason, [{ seasonName: 'Peak season', validFrom: '2026-06-01', validTo: '2026-09-30' }]),
  { [feeSeasonKey('Peak season', '2026-06-01', '2026-09-30')]: '140' });
check('the editor row carries every season amount',
  feeEditorRowFromRecord(savedLevyPerSeason, feeSeasons).amounts,
  {
    [feeSeasonKey('Low season', '2026-01-01', '2026-05-31')]: '90',
    [feeSeasonKey('High season', '2026-06-01', '2026-09-30')]: '140'
  });
check('renaming a season in the editor moves its fee amount with it',
  moveFeeAmount(
    { [feeSeasonKey('Low season', '2026-01-01', '2026-05-31')]: '90' },
    feeSeasonKey('Low season', '2026-01-01', '2026-05-31'),
    feeSeasonKey('Green season', '2026-01-01', '2026-05-31')
  ),
  { [feeSeasonKey('Green season', '2026-01-01', '2026-05-31')]: '90' });
check('a season with no amount is left alone when it is renamed',
  moveFeeAmount({}, feeSeasonKey('Low season', '', ''), feeSeasonKey('Green season', '', '')),
  {});

/* (F) Pricing: once-off charges once, per-night repeats, and a non-chargeable
   fee stays visible but adds no money. */
const perNightLevy = {
  category: SURCHARGE_CATEGORY,
  surcharge_type: 'conservation_levy',
  surcharge_charge_basis: 'per_night',
  surcharge_unit_basis: 'per_person'
};
const feeRow = { conservation_levy_per_adult: 100, conservation_levy_per_child: 50 };
check('a per-night fee repeats for every night of the stay',
  surchargeBuyTotal({ rate: feeRow, item: perNightLevy, paxCount: 4, childCount: 1, nights: 3 }).total, 1050);
check('a once-off fee charges once no matter the nights',
  surchargeBuyTotal({
    rate: feeRow,
    item: { ...perNightLevy, surcharge_charge_basis: 'once_off' },
    paxCount: 4,
    childCount: 1,
    nights: 3
  }).total, 350);
check('a non-chargeable fee keeps its supplier figure but adds nothing',
  surchargePricing({ buyTotal: 350, markupPercent: 20, chargeable: false }),
  { buy: 0, sell: 0, markup: 0, passedThrough: true, reference: 350 });
check('a chargeable fee is marked up like any bought service',
  surchargePricing({ buyTotal: 250, markupPercent: 20, chargeable: true }),
  { buy: 250, sell: 300, markup: 20, passedThrough: false, reference: 250 });

/* (G) Terms survive the legacy shapes. */
check('basis defaults to once off', surchargeBasisOf({}), 'once_off');
check('an unknown basis is read as per person', surchargeUnitBasisOf({ surcharge_unit_basis: 'per_banana' }), 'per_person');

/* (H) "Per unit" is a flat figure of its own. The editor writes unit_price and
   the fee engine reads unit_price back, so the box the operator types into is
   the box that gets charged - no hidden fallback to the adult matrix. */
const unitFee = { category: SURCHARGE_CATEGORY, surcharge_type: 'entrance_fee', surcharge_unit_basis: 'per_unit' };
check('a per-unit fee writes its own column',
  surchargeRateColumns({ type: 'entrance_fee', unitBasis: 'per_unit', amount: '1500' }), { unit_price: 1500 });
check('a per-unit fee reads its own column back', surchargeRateAmount({ unit_price: 1500 }, unitFee), 1500);
check('a per-unit fee charges the flat figure once per repeat',
  surchargeBuyTotal({ rate: { unit_price: 1500 }, item: unitFee, paxCount: 4, childCount: 0, nights: 1 }).total, 1500);
check('the sidebar shows a fee its own figure, not the per-person matrix',
  sidebarLibraryRate({
    category: SURCHARGE_CATEGORY,
    surcharge_type: 'entrance_fee',
    surcharge_unit_basis: 'per_person',
    item_rates: [{ currency: 'ZAR', entrance_fee_per_person: 850 }]
  }, 'ZAR', 2), 850);

/* (I) A child and a guide are heads of their own, but only on a basis that
   bills heads. A per-unit booking or a per-vehicle gate pass buys a THING, so
   the extra boxes the operator was offered had nothing to charge. */
check('a basis that buys a thing charges no heads',
  ['per_unit', 'per_vehicle', 'per_person', 'per_adult', 'per_child'].map(feeBasisChargesHeads),
  [false, false, true, true, true]);

const entrancePerPerson = {
  category: SURCHARGE_CATEGORY,
  surcharge_type: 'entrance_fee',
  surcharge_charge_basis: 'once_off',
  surcharge_unit_basis: 'per_person'
};
check('an entrance fee reads its own child column',
  surchargeChildAmount({ entrance_fee_per_person: 850, entrance_fee_per_child: 430 }, entrancePerPerson), 430);
check('a child figure of 0 is a free child, not an unpriced one',
  surchargeChildAmount({ entrance_fee_per_person: 850, entrance_fee_per_child: 0 }, entrancePerPerson), 0);
check('no child column means the property does not split by age',
  surchargeChildAmount({ entrance_fee_per_person: 850 }, entrancePerPerson), null);
check('a levy reads the child column it already had',
  surchargeChildAmount({ conservation_levy_per_adult: 100, conservation_levy_per_child: 50 },
    { ...levyItem, surcharge_unit_basis: 'per_person' }), 50);
check('a per-vehicle fee has no child to price',
  surchargeChildAmount({ entrance_fee_per_vehicle: 1200, entrance_fee_per_child: 430 },
    { ...entranceItem, surcharge_unit_basis: 'per_vehicle' }), null);
check('a fee reads its guide figure',
  surchargeGuideAmount({ entrance_fee_per_person: 850, guide_rate: 0 }, entrancePerPerson), 0);
check('a guide figure left blank means the guide pays the visitor amount',
  surchargeGuideAmount({ entrance_fee_per_person: 850 }, entrancePerPerson), null);
check('a per-unit fee has no guide place',
  surchargeGuideAmount({ unit_price: 1500, guide_rate: 200 }, unitFee), null);

check('the child and guide figures write beside the visitor one',
  surchargeRateColumns({ type: 'entrance_fee', unitBasis: 'per_person', amount: '850', childAmount: '430', guideAmount: '0' }),
  { entrance_fee_per_person: 850, entrance_fee_per_child: 430, guide_rate: 0 });
check('a basis that prices children itself keeps its own figure',
  surchargeRateColumns({ type: 'conservation_levy', unitBasis: 'per_child', amount: '60', childAmount: '45' }),
  { conservation_levy_per_child: 60 });
check('a flat basis writes neither extra column',
  surchargeRateColumns({ type: 'entrance_fee', unitBasis: 'per_vehicle', amount: '1200', childAmount: '430', guideAmount: '200' }),
  { entrance_fee_per_vehicle: 1200 });
check('a caller that passes no child or guide writes no new column',
  surchargeRateColumns({ type: 'entrance_fee', unitBasis: 'per_person', amount: '850' }),
  { entrance_fee_per_person: 850 });

/* (J) The linked fee in the property editor holds one child amount per season,
   beside the visitor amounts it already held. */
const entrancePerSeason = {
  id: 'fee-4',
  name: 'Kruger gate entry',
  category: SURCHARGE_CATEGORY,
  surcharge_type: 'entrance_fee',
  surcharge_charge_basis: 'once_off',
  surcharge_unit_basis: 'per_person',
  item_rates: [
    { id: 'r1', season_name: 'Low season', valid_from: '2026-01-01', valid_to: '2026-05-31', entrance_fee_per_person: 780, entrance_fee_per_child: 390 },
    { id: 'r2', season_name: 'High season', valid_from: '2026-06-01', valid_to: '2026-09-30', entrance_fee_per_person: 850 }
  ]
};
check('a fee reads its child amounts per season',
  feeAmountsBySeason(entrancePerSeason, feeSeasons, surchargeChildAmount),
  { [feeSeasonKey('Low season', '2026-01-01', '2026-05-31')]: '390' });
check('the editor row holds visitor and child amounts side by side',
  [feeEditorRowFromRecord(entrancePerSeason, feeSeasons).amounts,
    feeEditorRowFromRecord(entrancePerSeason, feeSeasons).childAmounts],
  [
    {
      [feeSeasonKey('Low season', '2026-01-01', '2026-05-31')]: '780',
      [feeSeasonKey('High season', '2026-06-01', '2026-09-30')]: '850'
    },
    { [feeSeasonKey('Low season', '2026-01-01', '2026-05-31')]: '390' }
  ]);
const linkedChildRow = feeRatePayload({
  itemId: 'fee-4', currency: 'ZAR', seasonName: 'Low season',
  validFrom: '2026-01-01', validTo: '2026-05-31',
  type: 'entrance_fee', unitBasis: 'per_person', amount: 780, childAmount: 390
});
check('a saved linked fee round-trips its child amount',
  [surchargeRateAmount(linkedChildRow, entrancePerPerson), surchargeChildAmount(linkedChildRow, entrancePerPerson)],
  [780, 390]);
check('a linked fee saved without a child amount leaves the column alone',
  Object.prototype.hasOwnProperty.call(
    feeRatePayload({ itemId: 'fee-4', currency: 'ZAR', type: 'entrance_fee', unitBasis: 'per_person', amount: 780 }),
    'entrance_fee_per_child'
  ), false);

/* (K) Charging the extra heads. Blank follows the visitor figure, 0 is free,
   and a flat basis is untouched by either. */
const entranceRow = { entrance_fee_per_person: 850, entrance_fee_per_child: 430 };
check('a priced child is charged the child figure, not the visitor one',
  surchargeBuyTotal({ rate: entranceRow, item: entrancePerPerson, paxCount: 4, childCount: 2 }).total, 2560);
check('an unpriced child pays the visitor figure, as before',
  surchargeBuyTotal({ rate: { entrance_fee_per_person: 850 }, item: entrancePerPerson, paxCount: 4, childCount: 2 }).total, 3400);
check('a contracted free child is charged nothing',
  surchargeBuyTotal({ rate: { entrance_fee_per_person: 850, entrance_fee_per_child: 0 }, item: entrancePerPerson, paxCount: 4, childCount: 2 }).total, 1700);
check('a guide with no figure of his own pays the visitor amount',
  surchargeBuyTotal({ rate: entranceRow, item: entrancePerPerson, paxCount: 4, childCount: 2, guideCount: 1 }).total, 3410);
check('a guide figure of 0 admits the guide free',
  surchargeBuyTotal({ rate: { ...entranceRow, guide_rate: 0 }, item: entrancePerPerson, paxCount: 4, childCount: 2, guideCount: 1 }).total, 2560);
check('a contracted guide figure is charged once per guide',
  surchargeBuyTotal({ rate: { ...entranceRow, guide_rate: 200 }, item: entrancePerPerson, paxCount: 4, childCount: 2, guideCount: 2 }).total, 2960);
check('a per-adult levy charges the guide the adult figure',
  surchargeBuyTotal({ rate: { ...feeRow, guide_rate: 40 }, item: { ...levyItem, surcharge_unit_basis: 'per_adult' }, paxCount: 4, childCount: 1, guideCount: 1 }).total, 340);
check('a per-night fee repeats the guide with the rest',
  surchargeBuyTotal({ rate: feeRow, item: perNightLevy, paxCount: 4, childCount: 1, guideCount: 1, nights: 3 }).total, 1350);
check('a per-vehicle fee ignores a guide figure',
  surchargeBuyTotal({ rate: { entrance_fee_per_vehicle: 1200, guide_rate: 200 }, item: { ...entranceItem, surcharge_unit_basis: 'per_vehicle' }, paxCount: 4, guideCount: 2 }).total, 1200);
check('a per-unit fee ignores a guide figure',
  surchargeBuyTotal({ rate: { unit_price: 1500, guide_rate: 200 }, item: unitFee, paxCount: 4, guideCount: 1 }).total, 1500);

/* (L) A ticket. It is admitted at the same gate as an entrance fee, so it is
   priced from the same columns — the type names the line, it does not move the
   money. */
const ticketItem = { category: SURCHARGE_CATEGORY, surcharge_type: 'ticket' };
check('a ticket reads as a ticket', surchargeTypeOf({ surcharge_type: 'ticket' }), 'ticket');
check('a ticket is offered in the editor',
  SURCHARGE_TYPES.map((t) => t.id), ['entrance_fee', 'conservation_levy', 'ticket']);
check('a ticket is named on the line', surchargeTypeLabel('ticket'), 'Ticket');
check('a ticket writes the entrance columns',
  surchargeRateColumns({ type: 'ticket', unitBasis: 'per_person', amount: '850', childAmount: '430' }),
  { entrance_fee_per_person: 850, entrance_fee_per_child: 430 });
check('a ticket reads the entrance columns back',
  surchargeRateAmount({ entrance_fee_per_person: 850, entrance_fee_per_child: 430 },
    { ...ticketItem, surcharge_unit_basis: 'per_person' }), 850);
check('a ticket charges heads the way an entrance fee does',
  surchargeBuyTotal({
    rate: { entrance_fee_per_person: 850, entrance_fee_per_child: 430 },
    item: { ...ticketItem, surcharge_unit_basis: 'per_person' },
    paxCount: 4,
    childCount: 2
  }).total, 2560);
check('a ticket splits by age only when a child figure was stored',
  surchargeBuyTotal({
    rate: { entrance_fee_per_person: 850 },
    item: { ...ticketItem, surcharge_unit_basis: 'per_person' },
    paxCount: 4,
    childCount: 2
  }).total, 3400);
check('a ticket prices a child only beside an adult figure',
  isValidUnitBasis(ticketItem, 'per_child'), false);

/* (M) Per Vehicle is the flat basis on every fee type, a levy included, and it
   is the only figure that basis charges — a car never pays the head price. */
const levyPerVehicle = { ...levyItem, surcharge_unit_basis: 'per_vehicle' };
check('a levy set per vehicle writes the vehicle column',
  surchargeRateColumns({ type: 'conservation_levy', unitBasis: 'per_vehicle', amount: '300' }),
  { entrance_fee_per_vehicle: 300 });
check('a levy set per vehicle reads the vehicle column back',
  surchargeRateAmount({ entrance_fee_per_vehicle: 300, conservation_levy_per_adult: 120 }, levyPerVehicle), 300);
check('a levy set per vehicle charges one vehicle, not a party',
  surchargeBuyTotal({
    rate: { entrance_fee_per_vehicle: 300, conservation_levy_per_adult: 120, guide_rate: 40 },
    item: levyPerVehicle,
    paxCount: 6,
    childCount: 2,
    guideCount: 1
  }).total, 300);
check('a ticket set per vehicle charges one vehicle',
  surchargeBuyTotal({
    rate: { entrance_fee_per_vehicle: 1200, entrance_fee_per_person: 850 },
    item: { ...ticketItem, surcharge_unit_basis: 'per_vehicle' },
    paxCount: 4
  }).total, 1200);
check('a vehicle figure left blank prices nothing, not the head price',
  surchargeBuyTotal({
    rate: { entrance_fee_per_person: 850 },
    item: { ...entranceItem, surcharge_unit_basis: 'per_vehicle' },
    paxCount: 4
  }).total, 0);
check('a per-vehicle levy reads its figure from the editor path too',
  feeEditorRowFromRecord({
    id: 'fee-5',
    name: 'Gate vehicle pass',
    category: SURCHARGE_CATEGORY,
    surcharge_type: 'conservation_levy',
    surcharge_unit_basis: 'per_vehicle',
    item_rates: [{ id: 'r1', season_name: 'High season', entrance_fee_per_vehicle: 300 }]
  }).amount, '300');

/* (N) Which bases each type is offered. "Per Unit" was the same flat idea under
   an ambiguous name, so it is no longer a choice — but an item already saved on
   it must still list it, or its own figure would vanish from the editor. */
check('an entrance fee is offered person, adult and vehicle',
  unitBasesFor(entranceItem).map((u) => u.id), ['per_person', 'per_adult', 'per_vehicle']);
check('a levy adds the basis that bills children alone',
  unitBasesFor(levyItem).map((u) => u.id), ['per_person', 'per_adult', 'per_child', 'per_vehicle']);
check('a ticket is offered what an entrance fee is',
  unitBasesFor(ticketItem).map((u) => u.id), ['per_person', 'per_adult', 'per_vehicle']);
check('a legacy per-unit item still lists its own basis',
  unitBasesFor({ ...entranceItem, surcharge_unit_basis: 'per_unit' }).map((u) => u.id),
  ['per_person', 'per_adult', 'per_vehicle', 'per_unit']);
check('a basis only a levy stores is refused elsewhere',
  [isValidUnitBasis(levyItem, 'per_child'), isValidUnitBasis(entranceItem, 'per_child')],
  [true, false]);
check('a legacy per-unit basis stays priced on every type',
  [isValidUnitBasis(entranceItem, 'per_unit'), isValidUnitBasis(levyItem, 'per_unit')],
  [true, true]);

/* (J) THE FAMILY QUOTE. A fee's child figure is money the contract applies to a
       child, so the per-person table has to print it on the child's row - the
       category rename moved it outside the head-selling gate that Meals,
       Tickets and Extras pass, and reading the fee's own columns is the only way
       the quotation agrees with what the day line was bought at. */
const familyParty = [{ age: 44 }, { age: 41 }, { age: 8 }];
const gateRate = { entrance_fee_per_person: 400, entrance_fee_per_child: 200 };
const gateItem = { ...entranceItem, surcharge_unit_basis: 'per_person' };
const gateSell = surchargePricing({
  buyTotal: surchargeBuyTotal({ rate: gateRate, item: gateItem, paxCount: 3, childCount: 1 }).total,
  markupPercent: 20
}).sell;
const feeLine = (rate, unitBasis, sellPP) => ({
  category: SURCHARGE_CATEGORY, basis: unitBasis === 'per_unit' ? 'per_unit' : 'per_person',
  currencyCode: 'ZAR', sellPP, taxRate: 0, itemId: 'gate', markup: 20, roomAllocations: [],
  surchargeType: 'entrance_fee', surchargeUnitBasis: unitBasis
});
const familyRows = computePerPersonRows({
  services: [feeLine(gateRate, 'per_person', gateSell / 3)],
  travellers: familyParty,
  rateBy: () => gateRate,
  defaultTaxRate: 0
});
check('the fee line is two visitors and one child, markuped', gateSell, 1200);
check('a child pays their own entrance fee on the child row', familyRows.perChild.sell, 240);
check('and the adults carry only the visitor figures between them', familyRows.perPersonSharing.sell, 480);
check('the two rows re-add to what the day line was bought at',
  familyRows.perPersonSharing.sell * familyRows.adultsCount
  + familyRows.perChild.sell * familyRows.childrenCount, gateSell);
check('and the printed per-person table prints that money once each',
  perPersonHeadBreakdown(familyRows).rows.map((r) => [r.count, r.unit, r.incl].join('/')),
  ['2/480/960', '1/240/240']);
check('a fee that gives no child figure admits the child on the visitor figure',
  computePerPersonRows({
    services: [feeLine({ entrance_fee_per_person: 400 }, 'per_person', 400)],
    travellers: familyParty,
    rateBy: () => ({ entrance_fee_per_person: 400 }),
    defaultTaxRate: 0
  }).perChild.sell, 400);
/* A booking fee buys a thing, not a head, but the party shares it and a child is
   one of the party - so the one charge divides by every traveller. */
check('a fee that buys a thing still splits its share over every traveller',
  computePerPersonRows({
    services: [feeLine({ unit_price: 300 }, 'per_unit', 100)],
    travellers: familyParty,
    rateBy: () => ({ unit_price: 300 }),
    defaultTaxRate: 0
  }).perChild.sell, 100);
const levyRate = { conservation_levy_per_adult: 100, conservation_levy_per_child: 50 };
const levyHead = { ...levyItem, surcharge_unit_basis: 'per_person' };
check('a levy quotes its child from the levy columns, like its adult figure',
  computePerPersonRows({
    services: [{
      ...feeLine({}, 'per_person', surchargePricing({
        buyTotal: surchargeBuyTotal({ rate: levyRate, item: levyHead, paxCount: 3, childCount: 1 }).total,
        markupPercent: 20
      }).sell / 3),
      surchargeType: 'conservation_levy'
    }],
    travellers: familyParty,
    rateBy: () => levyRate,
    defaultTaxRate: 0
  }).perChild.sell, 60);

if (!process.exitCode) console.log('\nAll Fees & Tickets checks passed');
