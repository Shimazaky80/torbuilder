/* Single-supplement waiver: the library rate card asks how many single rooms
   are waived and derives the supplement from the single and sharing rates.
   The stored ladder keeps the shape every pricing path already reads. */
import { calculateRoomCharges } from '../src/lib/roomAllocationHelper.js';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PricingSeasonsTab } from '../src/components/PricingSeasonsTab.jsx';
import { computePerPersonRows, perPersonHeadBreakdown, perPersonPrintRows } from '../src/lib/perPersonPricing.js';
import { presentationPricingColumns, singleSupplementForSeason, accommodationRatesForTrip } from '../src/lib/packagePricing.js';
import { applyProtectionToRate } from '../src/lib/priceValidity.js';
import { libraryItemDetail } from '../src/lib/libraryItemDetail.js';
import {
  baseSingleSupplement,
  combineSingleSupplements,
  normaliseSingleSupplementLadder,
  singleSupplementForOrdinal,
  singleSupplementLadderSummary,
  totalSingleSupplement,
  stripWaiverNote,
  waiverFromLadder,
  waiverLadder,
  waiverNoteCount,
  withWaiverNote
} from '../src/lib/singleSupplement.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};
const checkJson = (label, actual, expected) => check(label, JSON.stringify(actual), JSON.stringify(expected));

const ladder = [
  { singles: 2, supplement: 0 },
  { singles: 4, supplement: 150 }
];

checkJson('ladder sorts and drops half-typed rows', normaliseSingleSupplementLadder({
  single_supplement_tiers: [
    { singles: 4, supplement: 150 },
    { singles: 2, supplement: 0 },
    { singles: 3, supplement: '' }
  ]
}), ladder);
checkJson('ladder coverage never shrinks', normaliseSingleSupplementLadder({
  single_supplement_tiers: [{ singles: 4, supplement: 100 }, { singles: 2, supplement: 0 }]
}), [{ singles: 2, supplement: 0 }, { singles: 4, supplement: 100 }]);

check('a stored 0 supplement falls back to the single-sharing gap', baseSingleSupplement({ single_supplement: 0 }, 900, 1200), 300);
check('an entered supplement is the authoritative figure', baseSingleSupplement({ single_supplement: 200 }, 900, 1200), 200);
check('an empty supplement falls back to the gap', baseSingleSupplement({}, 900, 1200), 300);

check('no ordinal never pays a supplement', singleSupplementForOrdinal(ladder, 300, 0), 0);
check('the first single is waived', singleSupplementForOrdinal(ladder, 300, 1), 0);
check('the second single is waived', singleSupplementForOrdinal(ladder, 300, 2), 0);
check('the third single takes the reduced tier', singleSupplementForOrdinal(ladder, 300, 3), 150);
check('beyond the ladder the base supplement applies', singleSupplementForOrdinal(ladder, 300, 5), 300);
check('total for two singles is waived', totalSingleSupplement(ladder, 300, 2), 0);
check('total for three singles is one reduced tier', totalSingleSupplement(ladder, 300, 3), 150);
check('total for five singles is two tiers plus a base', totalSingleSupplement(ladder, 300, 5), 600);

checkJson('ladder summary names the waiver and the next charge', singleSupplementLadderSummary(ladder, 300), {
  waived: 2, nextSupplement: 150, nextSingles: 4, beyond: 300
});

/* ---------------- Waiver count (library rate card) ---------------- */
checkJson('a waiver count becomes a single zero-supplement tier', waiverLadder(3), [{ singles: 3, supplement: 0 }]);
checkJson('a blank waiver clears the ladder', waiverLadder(''), []);
checkJson('zero waivers clears the ladder', waiverLadder(0), []);
check('a saved waiver reads back into the editor', waiverFromLadder({ single_supplement_tiers: waiverLadder(4) }), 4);
check('a rate without a ladder has no waiver', waiverFromLadder({}), 0);
check('a legacy ladder keeps its leading waiver', waiverFromLadder({ single_supplement_tiers: ladder }), 2);

/* A database without the ladder column still honours the waiver: it travels in
   the rate notes and never reappears in the notes shown to the operator. */
check('waiver marker writes into the notes', withWaiverNote(null, 3), '[[waiver:3]]');
check('waiver marker appends to existing notes', withWaiverNote('Sea view', 2), 'Sea view [[waiver:2]]');
check('a zero waiver clears the marker', withWaiverNote('[[waiver:3]]', 0), null);
check('waiver marker reads back', waiverNoteCount('Sea view [[waiver:4]]'), 4);
checkJson('notes marker drives the ladder when the column is absent', normaliseSingleSupplementLadder({ notes: '[[waiver:2]]' }), [
  { singles: 2, supplement: 0 }
]);
check('waiver reads back from the notes marker', waiverFromLadder({ notes: '[[waiver:2]]' }), 2);
check('the stored ladder wins over a notes marker', waiverFromLadder({ notes: '[[waiver:5]]', single_supplement_tiers: [{ singles: 1, supplement: 0 }] }), 1);
check('the waiver marker is stripped from displayed notes', stripWaiverNote('Sea view [[waiver:4]]'), 'Sea view');

/* A trip-wide ladder: each property contributes at every single-room ordinal. */
const combined = combineSingleSupplements([
  { supplement: 200, ladder: [{ singles: 2, supplement: 0 }, { singles: 3, supplement: 100 }] },
  { supplement: 300, ladder: [{ singles: 1, supplement: 0 }, { singles: 2, supplement: 50 }] }
]);
check('combined ladder adds every property base', combined.base, 500);
checkJson('combined ladder adds each property tier by ordinal', combined.tiers, [
  { singles: 1, supplement: 0 },
  { singles: 2, supplement: 50 },
  { singles: 3, supplement: 400 }
]);

/* ---------------- Room allocation engine (per night) ---------------- */
const rate = {
  currency: 'ZAR',
  rate_basis: 'per_person_sharing',
  price_1_adult: 1200,
  price_2_adults: 900,
  single_supplement: 200,
  single_supplement_tiers: ladder
};
/* The room engine is counted per night on THIS rate row, so its ladder tops out
   at three singles: 1-2 waived, 3 reduced, 4 onward the base supplement. */
const roomLadder = [{ singles: 2, supplement: 0 }, { singles: 3, supplement: 150 }];
const roomRate = { ...rate, single_supplement_tiers: roomLadder };
const lodge = { category: 'Accommodation', item_rates: [roomRate] };
const solo = (id, age = 30) => ({ allocatedTravellers: [{ id, age }] });

const fourSingles = calculateRoomCharges(lodge, [solo('a'), solo('b'), solo('c'), solo('d')], 'ZAR', 0);
check('first two singles pay the sharing rate', fourSingles.rooms[0].buyCost, 900);
check('second waived single pays the sharing rate', fourSingles.rooms[1].buyCost, 900);
check('third single takes the reduced supplement', fourSingles.rooms[2].buyCost, 1050);
check('fourth single beyond the ladder takes the base supplement', fourSingles.rooms[3].buyCost, 1100);
check('the night totals the ladder, not the single rate', fourSingles.totalBuy, 3950);
check('a waived room says so', fourSingles.rooms[0].rateDescription.includes('waived'), true);

const childLodge = {
  ...lodge,
  child_age_ranges: [{ id: 'ch', name: 'Child', ageFrom: 0, ageTo: 12 }],
  item_rates: [{ ...roomRate, child_rates_breakdown: { ch: 400 } }]
};
const withChild = calculateRoomCharges(childLodge, [solo('a'), solo('kid', 8), solo('b')], 'ZAR', 0);
check('a known child rate still prices the solo child', withChild.rooms[1].buyCost, 400);
check('a solo child consumes a waiver slot', withChild.rooms[2].buyCost, 1050);
check('child + adults total follows the ladder', withChild.totalBuy, 2350);

const plainLodge = {
  category: 'Accommodation',
  item_rates: [{ currency: 'ZAR', rate_basis: 'per_person_sharing', price_1_adult: 1200, price_2_adults: 900 }]
};
check('no ladder keeps the single rate unchanged',
  calculateRoomCharges(plainLodge, [solo('a')], 'ZAR', 0).totalBuy, 1200);

const notesWaivedLodge = {
  category: 'Accommodation',
  item_rates: [{
    currency: 'ZAR', rate_basis: 'per_person_sharing', price_1_adult: 1200, price_2_adults: 900,
    notes: '[[waiver:2]]'
  }]
};
const notesWaived = calculateRoomCharges(notesWaivedLodge, [solo('a'), solo('b'), solo('c')], 'ZAR', 0);
check('a notes-only waiver keeps the first two singles on the sharing rate', notesWaived.rooms[1].buyCost, 900);
check('a notes-only waiver charges the third single the single rate', notesWaived.rooms[2].buyCost, 1200);

const flatLodge = {
  category: 'Accommodation',
  item_rates: [{
    currency: 'ZAR', rate_basis: 'per_room', unit_price: 1500, single_room_rate: 1700,
    single_supplement_tiers: [{ singles: 1, supplement: 0 }]
  }]
};
check('a flat room ignores the ladder and charges its single room rate',
  calculateRoomCharges(flatLodge, [solo('a'), solo('b')], 'ZAR', 0).totalBuy, 3400);

/* ---------------- Per-person breakdown ---------------- */
const perPerson = (rooms, travellers, pp, extraRate = roomRate) => computePerPersonRows({
  services: [{
    category: 'Accommodation', currencyCode: 'ZAR', sellPP: pp, taxRate: 0,
    itemId: 'lodge', roomAllocations: rooms, markup: 0
  }],
  travellers,
  rateBy: () => ({ ...extraRate, _ageRanges: [] }),
  defaultTaxRate: 0
});
const fourAdults = [{ id: 'a', age: 30 }, { id: 'b', age: 30 }, { id: 'c', age: 30 }, { id: 'd', age: 30 }];
const ppFour = perPerson([solo('a'), solo('b'), solo('c'), solo('d')], fourAdults, 987.5);
check('per-person sharing is the sharing rate', ppFour.perPersonSharing.sell, 900);
check('per-person single supplement follows the ladder', ppFour.singleSupplement.sell, 350);

const ppChild = perPerson(
  [solo('a'), solo('kid', 8), solo('b')],
  [{ id: 'a', age: 30 }, { id: 'kid', age: 8 }, { id: 'b', age: 30 }],
  587.5,
  childLodge.item_rates[0]
);
check('the child row is that child\'s own contracted room price', ppChild.perChild.sell, 300);
check('and the adults carry the room money between them', ppChild.perPersonSharing.sell, 675);
check('the child still consumes a waiver slot in per-person rows', ppChild.singleSupplement.sell, 112.5);

/* ---------------- Marked-up contracts re-add to the day line ----------------
   A ladder is quoted in library (buy) money, so the breakdown scales it; the
   plain gap between the single and sharing rates is ALREADY a selling figure,
   so scaling that again marks the supplement up twice and the summary stops
   matching the total the room engine charged. Every case below prices one night
   through the room engine and through the per-person rows and requires the adult
   row for every adult, the supplement once and the child row for every child to
   add back to the same money. */
const round2t = (n) => Math.round((Number(n) || 0) * 100) / 100;
const markedUp = (item, rooms, travellers, pp, markup = 15) => computePerPersonRows({
  services: [{
    category: 'Accommodation', currencyCode: 'ZAR', sellPP: pp, taxRate: 0,
    itemId: 'lodge', roomAllocations: rooms, markup
  }],
  travellers,
  rateBy: () => ({ ...item.item_rates[0], _ageRanges: item.child_age_ranges || [] }),
  defaultTaxRate: 0
});
const dayLine = (item, rooms, markup = 15) => {
  const charges = calculateRoomCharges(item, rooms, 'ZAR', markup);
  const pax = rooms.reduce((n, rm) => n + rm.allocatedTravellers.length, 0);
  return { sell: round2t(charges.totalSell), pp: round2t(charges.totalSell / pax), pax };
};
const rowsTotal = (r, childCount) => round2t(
  r.perPersonSharing.sell * r.adultsCount
  + (r.hasSingle ? r.singleSupplement.sell : 0)
  + (r.perChild && childCount ? r.perChild.sell * childCount : 0)
);

const plainRate = { currency: 'ZAR', rate_basis: 'per_person_sharing', price_1_adult: 1200, price_2_adults: 900 };
const sharedPlusSolo = {
  category: 'Accommodation',
  item_rates: [plainRate]
};
const soloRooms = [
  { allocatedTravellers: [{ id: 'a', age: 30 }, { id: 'b', age: 30 }] },
  { allocatedTravellers: [{ id: 'c', age: 30 }] }
];
const soloParty = [{ id: 'a', age: 30 }, { id: 'b', age: 30 }, { id: 'c', age: 30 }];
const soloLine = dayLine(sharedPlusSolo, soloRooms);
const soloRows = markedUp(sharedPlusSolo, soloRooms, soloParty, soloLine.pp);
check('a marked-up sharing row is the selling sharing rate', soloRows.perPersonSharing.sell, 1035);
check('a marked-up supplement is the single rate over the sharing rate, once', soloRows.singleSupplement.sell, 345);
check('a marked-up no-ladder contract re-adds to the day line', rowsTotal(soloRows, 0), soloLine.sell);

const kidBand = [{ id: 'kid', name: 'Child', ageFrom: 0, ageTo: 12 }];
const kidLodge = {
  category: 'Accommodation',
  child_age_ranges: kidBand,
  item_rates: [{ ...plainRate, child_rates_breakdown: { kid: 500 } }]
};
const kidRooms = [
  { allocatedTravellers: [{ id: 'a', age: 30 }, { id: 'b', age: 30 }, { id: 'k', age: 6 }] },
  { allocatedTravellers: [{ id: 'c', age: 30 }] }
];
const kidParty = [...soloParty, { id: 'k', age: 6 }];
const kidLine = dayLine(kidLodge, kidRooms);
const kidRows = markedUp(kidLodge, kidRooms, kidParty, kidLine.pp);
check('a marked-up child row is the selling child rate', kidRows.perChild.sell, 575);
check('a marked-up contract with a child re-adds to the day line', rowsTotal(kidRows, 1), kidLine.sell);

/* The exported per-person table prints one row per class of traveller: the figure
   that traveller pays beside the number of them in the party. Multiplying the
   column out must give the money the day line charged — otherwise the document a
   client reads disagrees with the invoice. */
const kidHeads = perPersonHeadBreakdown(kidRows);
check('the per-person table counts every traveller in the party', kidHeads.heads, 4);
check('the per-person table has a row for sharing, the supplement and the child', kidHeads.rows.length, 3);
checkJson('the sharing row is an adult\'s price for each of the three adults',
  [kidHeads.rows[0].unit, kidHeads.rows[0].count, kidHeads.rows[0].incl], [1035, 3, 3105]);
check('the supplement row is the party bill spread over the adults', kidHeads.rows[1].unit, round2t(345 / 3));
checkJson('the child row is that child\'s own price, not a discount off an adult',
  [kidHeads.rows[2].unit, kidHeads.rows[2].count, kidHeads.rows[2].incl], [575, 1, 575]);
check('no row on the per-person table is negative', kidHeads.rows.some((r) => r.unit < 0 || r.incl < 0), false);
check('the per-person column multiplies out to the money the party is charged',
  kidHeads.total.incl, round2t(kidHeads.rows.reduce((sum, r) => sum + r.incl, 0)));
check('and that is exactly what the day line charged', kidHeads.total.incl, kidLine.sell);
check('a party with neither a single nor a child prints one row and no total split',
  perPersonHeadBreakdown({ ...kidRows, hasSingle: false, hasChildren: false, perChild: null }).rows.length, 1);

/* The same table under the export choice that refuses totals: every figure is one
   traveller's money, so a row that has been multiplied out into party money is not
   a fuller document — it is the document the consultant did not ask for. */
const kidHeadsOnly = perPersonPrintRows(kidRows, { totals: false });
checkJson('per-person-only quantities are one traveller each',
  kidHeadsOnly.rows.map((r) => r.qty), ['1', '1', '1']);
checkJson('per-person-only prints each class at its own price, never the party money',
  kidHeadsOnly.rows.map((r) => r.incl), [1035, 115, 575]);
checkJson('and the columns of one traveller add up to that traveller\'s price',
  kidHeadsOnly.rows.map((r) => round2t(r.subExcl + r.tax) === r.incl), [true, true, true]);
const kidDetailed = perPersonPrintRows(kidRows, { totals: true });
checkJson('the detailed choice keeps the class money and the heads who pay it',
  kidDetailed.rows.map((r) => [r.qty, r.incl].join('/')), ['3/3105', '3/345', '1/575']);
check('which is the money the party is charged', kidDetailed.total.incl, kidLine.sell);
check('a document with no rows to price prints nothing rather than a zero',
  perPersonPrintRows(null, { totals: false }), null);

const tieredLodge = {
  category: 'Accommodation',
  item_rates: [{
    ...plainRate, single_supplement: 200,
    single_supplement_tiers: [{ singles: 1, supplement: 150 }]
  }]
};
const tieredRooms = [{ allocatedTravellers: [{ id: 'a', age: 30 }] }];
const tieredLine = dayLine(tieredLodge, tieredRooms);
const tieredRows = markedUp(tieredLodge, tieredRooms, [{ id: 'a', age: 30 }], tieredLine.pp);
check('a marked-up ladder supplement scales the library figure once', tieredRows.singleSupplement.sell, 172.5);
check('a marked-up ladder contract re-adds to the day line', rowsTotal(tieredRows, 0), tieredLine.sell);

/* ---------------- Package presentation ---------------- */
const columns = presentationPricingColumns({
  codes: ['A'], bands: { A: [2, 3, 4] }, pools: { A: 0 },
  perPersonFixed: 0, accommodation: 0,
  singleSupplement: 200, singleSupplementTiers: ladder,
  singleRoomsOverride: 3, roomCapacity: 2
});
check('a manual override spreads the waived singles over the party', columns[0].each, 0);
check('a manual override prices the third single in every column', columns[1].each, 50);
check('the override is clamped to the party and spread per person', columns[2].each, 37.5);

const heuristic = presentationPricingColumns({
  codes: ['A'], bands: { A: [3] }, pools: { A: 0 },
  perPersonFixed: 0, accommodation: 0,
  singleSupplement: 200, singleSupplementTiers: ladder, roomCapacity: 1
});
check('without an override the party-size allocation prices an odd party',
  heuristic[0].each, 50);

/* ---------------- Package season derivation ---------------- */
const lodgeA = {
  id: 'lodge-a', name: 'Lodge A', category: 'Accommodation', max_occupancy: 2,
  item_rates: [{
    id: 'a-rate', currency: 'ZAR', rate_basis: 'per_person_sharing',
    price_1_adult: 1200, price_2_adults: 900, single_supplement: 200,
    single_supplement_tiers: [{ singles: 2, supplement: 0 }, { singles: 3, supplement: 100 }],
    valid_from: '2026-01-01', valid_to: '2026-12-31'
  }]
};
const lodgeB = {
  id: 'lodge-b', name: 'Lodge B', category: 'Accommodation', max_occupancy: 2,
  item_rates: [{
    id: 'b-rate', currency: 'ZAR', rate_basis: 'per_person_sharing',
    price_1_adult: 1400, price_2_adults: 1100, single_supplement: 300,
    single_supplement_tiers: [{ singles: 1, supplement: 0 }, { singles: 2, supplement: 50 }],
    valid_from: '2026-01-01', valid_to: '2026-12-31'
  }]
};
const serviceFor = (id, name) => ({
  item_id: id, item_name: name, category: 'Accommodation', currency_code: 'ZAR',
  rate_basis: 'per_person_sharing', quantity: 1, is_included: true
});
const tripDays = [{ services: [serviceFor('lodge-a', 'Lodge A'), serviceFor('lodge-b', 'Lodge B')] }];
check('a property rate row carries its ladder',
  accommodationRatesForTrip(serviceFor('lodge-a', 'Lodge A'), lodgeA, '2026-06-01', '2026-06-05').chosen.ladder.length, 2);
const seasonSupplement = singleSupplementForSeason({ days: tripDays, library: [lodgeA, lodgeB], from: '2026-06-01', to: '2026-06-05' });
check('the season supplement is every property base', seasonSupplement.total, 500);
checkJson('the season carries the combined ladder', seasonSupplement.tiers, [
  { singles: 1, supplement: 0 },
  { singles: 2, supplement: 50 },
  { singles: 3, supplement: 400 }
]);

/* ---------------- Protection, detail card ---------------- */
const protectedRate = applyProtectionToRate({
  single_supplement: 200,
  single_supplement_tiers: [{ singles: 2, supplement: 0 }, { singles: 4, supplement: 100 }]
}, 10);
check('protection uplifts the base supplement', protectedRate.single_supplement, 220);
checkJson('protection uplifts charged tiers and keeps waivers free', protectedRate.single_supplement_tiers, [
  { singles: 2, supplement: 0 },
  { singles: 4, supplement: 110 }
]);

const detail = libraryItemDetail({
  item: {
    name: 'Lodge', category: 'Accommodation', currency: 'ZAR', max_occupancy: 2,
    item_rates: [{ ...rate, single_supplement_tiers: ladder }]
  }
});
const priceRows = detail.seasons[0].sections.find((section) => section.key === 'prices').rows;
check('the rate card names the waiver, not a derived supplement', priceRows.some((row) => row.label === 'Single supplement' && row.value === 'waived for the first 2 single rooms'), true);
check('the rate card never repeats the single price as a supplement', priceRows.some((row) => row.label === 'Single supplement' && row.value.includes('ZAR')), false);
check('the rate card names the charged tier', priceRows.some((row) => row.label === 'Single rooms 3\u20134' && row.value === 'ZAR 150.00'), true);

/* ---------------- Season editor gating ---------------- */
const renderSeasonEditor = (singleRoomsAvailable) => renderToStaticMarkup(
  React.createElement(PricingSeasonsTab, {
    periods: [{ valid_from: '2026-01-01', valid_to: '2026-12-31', name: '2026', single_supplement: 0 }],
    activeSeason: 0,
    singleRoomsAvailable,
    currency: 'ZAR'
  })
);
const gatedEditor = renderSeasonEditor(false);
const openEditor = renderSeasonEditor(true);
check('an unmigrated database disables the single-room override',
  gatedEditor.includes('available in this workspace yet') && gatedEditor.includes('disabled=""'), true);
check('an unmigrated database explains the override without developer jargon',
  gatedEditor.includes('singles are worked out from the party size') && !/migration|\.sql/i.test(gatedEditor), true);
check('a migrated database keeps the override editable',
  openEditor.includes('disabled=""') || openEditor.includes('available in this workspace yet'), false);

if (failures) {
  console.error(`\n${failures} single-supplement check(s) failed`);
  process.exit(1);
}
console.log('\nAll single-supplement checks passed');
