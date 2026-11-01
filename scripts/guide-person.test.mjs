import {
  guideChargeTotal,
  lineGuideUpliftPercent
} from '../src/lib/guidePricing.js';
import {
  applyGuideUplift,
  guideMemberMatchesDestination,
  guideMemberName,
  guideMemberSupplierName,
  guideMembersByDestination,
  guideMembersById,
  guideSnapshotCharge,
  guideSnapshotName,
  guideSnapshotUplift,
  guideStampLabel,
  guideUpliftPercent,
  priceGuideLine
} from '../src/lib/guideRoster.js';
import {
  repriceServicesForPax,
  revalidateServicesForWindow
} from '../src/lib/servicePricing.js';

let failures = 0;
const check = (label, actual, expected) => {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};

console.log('\n--- Running Guide As A Person Verification Tests ---\n');

/* 1. The uplift is one percentage on the destination's contract money. */
const season = {
  currency: 'ZAR',
  season_name: 'Nov 2026 - Oct 2027',
  valid_from: '2026-11-01',
  valid_to: '2027-10-31',
  rate_basis: 'per_trip',
  price_1_adult: 0,
  guide_transfer_rate: 400,
  guide_half_day_rate: 600,
  guide_full_day_rate: 0,
  guide_overland_rate: 0,
  guide_dinner_rate: 0
};

check('no uplift is the contract figure untouched', guideChargeTotal(season, ['transfer', 'half_day']), 1000);
check('a +10% guide costs R1,100 on that R1,000 line', guideChargeTotal(season, ['transfer', 'half_day'], true, 10), 1100);
check('the uplift rounds to cents', guideChargeTotal({ ...season, guide_transfer_rate: 333, guide_half_day_rate: 0 }, ['transfer'], true, 7), 356.31);
check('a zero uplift changes nothing', guideChargeTotal(season, ['transfer', 'half_day'], true, 0), 1000);
check('a negative uplift is not a discount', guideChargeTotal(season, ['transfer', 'half_day'], true, -25), 1000);
check('a stray text uplift is not a discount', guideChargeTotal(season, ['transfer', 'half_day'], true, 'ten'), 1000);
check('a guide not needed charges nothing, premium or not', guideChargeTotal(season, ['transfer', 'half_day'], false, 10), 0);
check('an unknown service type contributes nothing', guideChargeTotal(season, ['transfer', 'piloting'], true, 10), 440);

/* 2. The percentage is typed by a human and arrives from PostgREST as a numeric string. */
check('PostgREST reads as a number', guideUpliftPercent({ rate_uplift_percent: '10.0000' }), 10);
check('camelCase reads too', guideUpliftPercent({ rateUpliftPercent: 12.5 }), 12.5);
check('a negative is standard', guideUpliftPercent({ rate_uplift_percent: -10 }), 0);
check('blank is standard', guideUpliftPercent({ rate_uplift_percent: '' }), 0);
check('junk is standard', guideUpliftPercent({ rate_uplift_percent: 'premium' }), 0);
check('nobody is standard', guideUpliftPercent(null), 0);
check('a name joins the parts typed', guideMemberName({ first_name: 'John', last_name: 'Michael' }), 'John Michael');
check('a lone name still prints', guideMemberName({ first_name: '  Thabo  ', last_name: '' }), 'Thabo');
check('a supplier link prints as a supplier name', guideMemberSupplierName({ suppliers: { name: 'Cape Guides' } }), 'Cape Guides');
check('a freelance guide has no supplier', guideMemberSupplierName({ suppliers: null }), '');

/* 3. applyGuideUplift and priceGuideLine: the fee is the only thing that moves. */
check('uplift lands on the cents', applyGuideUplift(999.99, { rate_uplift_percent: 3 }), 1029.99);
check('no percentage is the amount itself', applyGuideUplift(1000, null), 1000);

const premium = {
  id: 'g-john', first_name: 'John', last_name: 'Michael', national_id: '8801015000888',
  passport_number: 'A1234567', tax_number: '9101234567', licence_number: 'PGASA-001',
  destination_area: 'Cape Town', supplier_id: 'sup-cape-guides', rate_uplift_percent: '10.0000',
  is_active: true, suppliers: { name: 'Cape Guides' }
};
const standard = {
  id: 'g-thabo', first_name: 'Thabo', last_name: 'Dlamini', national_id: '',
  passport_number: '', tax_number: '', licence_number: '', destination_area: 'Cape Town',
  rate_uplift_percent: '0.0000', is_active: true
};
const retired = {
  id: 'g-old', first_name: 'Legacy', last_name: 'Guide', destination_area: 'Cape Town',
  rate_uplift_percent: '50.0000', is_active: false
};

const withPerson = priceGuideLine({ baseCharge: 1000, member: premium, supplierName: guideMemberSupplierName(premium) });
check('a named guide is priced above the contract', withPerson.charged, 1100);
check('the contract figure is kept beside it', withPerson.baseCharge, 1000);
check('the stamp names the person and the premium', guideStampLabel(withPerson.snapshot), 'John Michael · +10%');
check('the snapshot carries what accounts need', [
  withPerson.snapshot.name, withPerson.snapshot.supplier_name, withPerson.snapshot.national_id,
  withPerson.snapshot.tax_number, withPerson.snapshot.uplift_percent,
  withPerson.snapshot.base_charge, withPerson.snapshot.charged
], ['John Michael', 'Cape Guides', '8801015000888', '9101234567', 10, 1000, 1100]);

const withStandard = priceGuideLine({ baseCharge: 1000, member: standard });
check('a guide on the standard rate costs the standard rate', withStandard.charged, 1000);
check('but is still named for accounts', guideStampLabel(withStandard.snapshot), 'Thabo Dlamini');

const withNobody = priceGuideLine({ baseCharge: 1000, member: null });
check('no person means the contract figure', [withNobody.charged, withNobody.snapshot], [1000, null]);
check('and nothing to stamp', guideStampLabel(null), '');

check('the snapshot charge reads the invoiced figure', guideSnapshotCharge(withPerson.snapshot), 1100);
check('the snapshot uplift reads the percentage', guideSnapshotUplift(withPerson.snapshot), 10);
check('the snapshot name reads the person', guideSnapshotName(withPerson.snapshot), 'John Michael');
check('no snapshot is no money', guideSnapshotCharge(null), 0);

/* 4. The picker never hides a guide: local first, everyone else below, retired out. */
const grouped = guideMembersByDestination([retired, standard, premium, {
  id: 'g-stella', first_name: 'Stella', last_name: 'Abrahams', destination_area: 'Stellenbosch',
  rate_uplift_percent: '5.0000', is_active: true
}, null], 'Cape Town');
check('guides for the destination come first', grouped.here.map(guideMemberName), ['John Michael', 'Thabo Dlamini']);
check('the rest are still offered, not filtered away', grouped.elsewhere.map(guideMemberName), ['Stella Abrahams']);
check('a retired guide is not bookable', grouped.here.concat(grouped.elsewhere).some((m) => m.id === 'g-old'), false);
check('an unknown destination leaves the whole roster visible', guideMembersByDestination([premium, standard], 'Kruger').here.length, 0);
check('and the elsewhere group keeps everybody', guideMembersByDestination([premium, standard], 'Kruger').elsewhere.length, 2);
check('a city also matches', guideMemberMatchesDestination({ city: 'Cape Town' }, 'Cape Town'), true);
check('no destination matches nobody', guideMemberMatchesDestination(premium, ''), false);

check('the directory indexes by id for the reload', Object.keys(guideMembersById([premium, standard, { id: undefined }])), ['g-john', 'g-thabo']);
check('a missing directory is an empty index', guideMembersById(null), {});

/* 5. A line carries its own uplift, so the directory can be retuned without
      rewriting anything already sold. */
check('the line reads its own percentage', lineGuideUpliftPercent({ guideUpliftPercent: 10 }), 10);
check('or the snapshot when only that is stored', lineGuideUpliftPercent({ guideSnapshot: { uplift_percent: 7.5 } }), 7.5);
check('or the saved DB snapshot', lineGuideUpliftPercent({ guide_snapshot: { uplift_percent: '12.0000' } }), 12);
check('a reloaded line with no snapshot is standard', lineGuideUpliftPercent({ guideUpliftPercent: 0, guide_snapshot: null }), 0);
check('a junk percentage is standard', lineGuideUpliftPercent({ guide_snapshot: { uplift_percent: 'ten' } }), 0);
check('a saved snapshot outranks anything the field was retuned to', lineGuideUpliftPercent({
  guideUpliftPercent: guideUpliftPercent({ ...premium, rate_uplift_percent: '25.0000' }),
  guideSnapshot: withPerson.snapshot
}), 10);

/* 6. Season change: the new contract money, the same person's uplift. */
const priorSeasonRate = { ...season, valid_from: '2025-11-01', valid_to: '2026-10-31', season_name: 'Nov 2025 - Oct 2026', guide_transfer_rate: 360, guide_half_day_rate: 540 };
const nextSeasonRate = { ...season, guide_transfer_rate: 400, guide_half_day_rate: 600 };
const guideItem = { id: 'guide-item', name: 'Guide', category: 'Guide', currency: 'ZAR', item_rates: [priorSeasonRate, nextSeasonRate] };
const mealItem = { id: 'meal-item', name: 'Lunch', category: 'Meals', currency: 'ZAR', item_rates: [{ ...nextSeasonRate, valid_from: '2026-11-01', valid_to: '2027-10-31', price_1_adult: 100 }] };

const pricedLine = ({ rate, member, types = ['transfer', 'half_day'], pax = 4, markup = 20 } = {}) => {
  const baseCharge = guideChargeTotal(rate, types);
  const priced = priceGuideLine({ baseCharge, member, supplierName: guideMemberSupplierName(member) });
  const buyPP = Math.round((priced.charged / pax) * 100) / 100;
  return {
    itemId: guideItem.id,
    name: 'Guide',
    category: 'Guide',
    currencyCode: 'ZAR',
    guideServiceTypes: types,
    guide_needed: true,
    guideMemberId: member?.id || null,
    guideUpliftPercent: priced.snapshot?.uplift_percent || 0,
    guideSnapshot: priced.snapshot,
    basis: 'per_trip',
    buyPP,
    sellPP: Math.round(buyPP * (1 + markup / 100) * 100) / 100,
    markup,
    pax,
    seasonName: rate.season_name,
    seasonValidFrom: rate.valid_from,
    seasonValidTo: rate.valid_to,
    rateSeasonStatus: 'matched',
    item_rates: [rate]
  };
};

const travellers = [
  ...Array.from({ length: 4 }, (_, i) => ({ id: `c${i}`, name: `Client ${i}`, role: 'client' })),
  { id: 'tg', name: 'Guide', surname: 'Staff', role: 'tour_guide' }
];

const lineOnPriorSeason = pricedLine({ rate: priorSeasonRate, member: premium });
check('the prior season priced the premium guide at R990', lineOnPriorSeason.buyPP * 4, 990);

const nextWindow = { start: '2026-11-05', end: '2026-11-14' };
const revalidated = revalidateServicesForWindow({
  days: [{
    services: [
      lineOnPriorSeason,
      {
        itemId: mealItem.id, name: 'Lunch', category: 'Meals', currencyCode: 'ZAR',
        guideOnly: true, guideForKey: lineOnPriorSeason.name, buyPP: 100, sellPP: 120, markup: 20, pax: 4,
        seasonName: nextSeasonRate.season_name, seasonValidFrom: nextSeasonRate.valid_from,
        seasonValidTo: nextSeasonRate.valid_to, rateSeasonStatus: 'matched', item_rates: [mealItem.item_rates[0]]
      }
    ]
  }],
  libraryItems: [guideItem, mealItem],
  paxCount: 4,
  travellers,
  travelWindow: nextWindow
});
const movedLine = revalidated.days[0].services[0];
const crewMealLine = revalidated.days[0].services[1];

check('the new season reprices the guide fee', revalidated.repriced, 1);
check('the guide lunch line is not repriced off the fee', crewMealLine.buyPP, 100);
check('the new contract money is R1,000', guideChargeTotal(movedLine.item_rates[0], movedLine.guideServiceTypes), 1000);
check('the same person rides onto the new season at +10%', lineGuideUpliftPercent(movedLine), 10);
check('so the line charges R1,100', movedLine.buyPP * movedLine.pax, 1100);
check('the snapshot keeps the contract figure honest', [movedLine.guideSnapshot.base_charge, movedLine.guideSnapshot.charged], [1000, 1100]);
check('the person on the line is unchanged', [movedLine.guideMemberId, movedLine.guideSnapshot.name], ['g-john', 'John Michael']);
check('the sell moves with the buy only through the markup', movedLine.sellPP, 330);
check('the season stamp moved with the price', movedLine.seasonName, 'Nov 2026 - Oct 2027');
check('the revalidated line raises no issue', revalidated.issues.length, 0);

/* The directory record retuned afterwards cannot rewrite the sold figure: the
   line prices off its own snapshot, never off guide_members. */
const retuned = revalidateServicesForWindow({
  days: [{ services: [{ ...movedLine, guideUpliftPercent: 25 }] }],
  libraryItems: [{ ...guideItem, item_rates: [nextSeasonRate] }],
  paxCount: 4,
  travellers,
  travelWindow: nextWindow
});
check('a guide retuned in the directory rewrites nothing already priced', retuned.days[0].services[0].buyPP * 4, 1100);

/* 7. A party change re-splits the uplifted flat total; it never re-prices the
      guide off the library or double-counts the premium. */
const biggerParty = repriceServicesForPax({
  days: [{ services: [{ ...movedLine, guideUpliftPercent: 25 }] }],
  libraryItems: [guideItem],
  paxCount: 5,
  travellers: [
    ...Array.from({ length: 4 }, (_, i) => ({ id: `n${i}`, name: `Client ${i}`, role: 'client' })),
    { id: 'tl', name: 'Leader', role: 'tour_leader' }
  ],
  travelWindow: nextWindow
});
const grownLine = biggerParty.days[0].services[0];
check('a guide line is re-split, not re-priced', grownLine.buyPP * grownLine.pax, 1100);
check('the divisor is clients plus tour leader, never the guide', grownLine.pax, 5);
check('the person keeps the percentage they were sold at', lineGuideUpliftPercent(grownLine), 10);
check('and the snapshot still shows the contract money', grownLine.guideSnapshot.base_charge, 1000);
check('the re-split figure is the flat total over the new divisor', grownLine.buyPP, 220);

/* An unnamed guide is untouched by all of this. */
const unnamed = pricedLine({ rate: priorSeasonRate, member: null });
const unnamedMoved = revalidateServicesForWindow({
  days: [{ services: [unnamed] }],
  libraryItems: [guideItem],
  paxCount: 4,
  travellers,
  travelWindow: nextWindow
}).days[0].services[0];
check('a guide with no one named stays on the contract rate', unnamedMoved.buyPP * unnamedMoved.pax, 1000);
check('and carries no snapshot', unnamedMoved.guideSnapshot, null);

console.log(failures
  ? `\n${failures} guide-person example(s) FAILED\n`
  : '\nAll Guide As A Person verification examples PASSED successfully!\n');
if (failures) process.exitCode = 1;
