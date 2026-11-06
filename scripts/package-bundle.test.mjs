/* The composed package offer.

   Two things make it work and both are tested here: a hire that states a LENGTH
   instead of DATES, and lines that carry a shared key so they read as one thing.
   The hire is the hard half — its tariff has to be answered by the dates the
   package is sold for, on every read, rather than frozen at drop time — so the
   covers-window rule, the protection stand-in, the refusals and the re-price all
   get checked before the grouping. */
import {
  buildRentalDetails,
  carRentalGroups,
  isRentalFeeLine,
  rentalFeeDetails,
  rentalFeeLineLabel,
  rentalLineBuyTotal,
  rentalPackageRate,
  rentalPrintsSpecGrid,
  rentalSummaryLabel
} from '../src/lib/carRentalPricing.js';
import {
  calculatePackageTravellerBreakdown,
  packageSeasonCoverage,
  packageSeasonResolution,
  packageValidityWindows
} from '../src/lib/packagePricing.js';
import {
  bundleGroups,
  bundleOfferLabel,
  defaultBundleLabel,
  hireOfferChoices,
  hireSeasonForWindows,
  isBundleLine,
  isReferenceHire,
  referenceHireDetails,
  repriceHireComponents,
  resolveHireOffer,
  resolveHireOfferForDetails,
  stampBundle,
  unstampBundle
} from '../src/lib/packageBundlePricing.js';

let failures = 0;
const check = (label, actual, expected) => {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};
const matches = (label, actual, pattern) => {
  const passed = pattern.test(String(actual || ''));
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}`);
};

console.log('\n--- Running Composed Package Offer Tests ---\n');

/* 1. The contract the composed offer is built from. One car, sold on three
   tariffs: the December window a dated quote would have used, a full-year tariff
   spanning the whole Nov–Oct selling year, and an undated tariff that speaks for
   every week and none in particular. Then the awkward neighbours: a tariff that
   closed before the year, one that only starts after it, one that stops halfway,
   a ladder with a hole in it and a two-seater. */
const carKey = (letter, name, code) => `${letter}|${name}|${code}`;
const item = {
  id: 'car-1',
  name: 'Europcar Cape Town — City Transfer',
  category: 'Car Rental',
  currency: 'ZAR',
  rental_contract_fee: '185.0000',
  car_rental_rates: [
    { id: 'c1', vehicle_group: 'C', vehicle_name: 'Toyota Corolla or similar', rate_code: 'Classic Max (CM)', max_passengers: 4, luggage: 2, doors: 4, has_aircon: true, gear: 'manual', min_days: 1, max_days: 6, price: 850, valid_from: '2026-11-01', valid_to: '2027-01-31', currency: 'ZAR' },
    { id: 'c2', vehicle_group: 'C', vehicle_name: 'Toyota Corolla or similar', rate_code: 'Classic Max (CM)', max_passengers: 4, luggage: 2, doors: 4, has_aircon: true, gear: 'manual', min_days: 7, max_days: 13, price: 780, valid_from: '2026-11-01', valid_to: '2027-01-31', currency: 'ZAR' },
    { id: 'cy', vehicle_group: 'C', vehicle_name: 'Toyota Corolla or similar', rate_code: 'Classic Max (CM)', max_passengers: 4, luggage: 2, doors: 4, has_aircon: true, gear: 'manual', min_days: 1, max_days: 6, price: 900, valid_from: '2026-11-01', valid_to: '2027-10-31', currency: 'ZAR' },
    { id: 'co', vehicle_group: 'C', vehicle_name: 'Toyota Corolla or similar', rate_code: 'Classic Max (CM)', max_passengers: 4, luggage: 2, doors: 4, has_aircon: true, gear: 'manual', min_days: 1, max_days: 6, price: 1000, valid_from: null, valid_to: null, currency: 'ZAR' },
    { id: 'a1', vehicle_group: 'A', vehicle_name: 'Hyundai i10 or similar', rate_code: 'Economy (B)', max_passengers: 2, luggage: 1, doors: 5, has_aircon: true, gear: 'manual', min_days: 1, max_days: 6, price: 600, valid_from: null, valid_to: null, currency: 'ZAR' },
    { id: 'd1', vehicle_group: 'D', vehicle_name: 'Ford Ranger or similar', rate_code: 'Utility (U)', max_passengers: 5, luggage: 3, doors: 4, has_aircon: true, gear: 'manual', min_days: 1, max_days: 6, price: 760, valid_from: '2025-11-01', valid_to: '2026-06-30', currency: 'ZAR' },
    { id: 'e1', vehicle_group: 'E', vehicle_name: 'Nissan Leaf or similar', rate_code: 'Green Max (GM)', max_passengers: 5, luggage: 2, doors: 5, has_aircon: true, gear: 'automatic', min_days: 1, max_days: 6, price: 1200, valid_from: '2028-03-01', valid_to: '2028-05-31', currency: 'ZAR' },
    { id: 'g1', vehicle_group: 'G', vehicle_name: 'VW Polo or similar', rate_code: 'Compact (C)', max_passengers: 5, luggage: 2, doors: 5, has_aircon: true, gear: 'automatic', min_days: 1, max_days: 6, price: 750, valid_from: '2026-11-01', valid_to: '2027-01-31', currency: 'ZAR' },
    { id: 'h1', vehicle_group: 'H', vehicle_name: 'Suzuki Jimny or similar', rate_code: 'Off Road (OR)', max_passengers: 5, luggage: 2, doors: 3, has_aircon: true, gear: 'manual', min_days: 1, max_days: 6, price: 900, valid_from: '2026-11-01', valid_to: '2027-10-31', currency: 'ZAR' },
    { id: 'h2', vehicle_group: 'H', vehicle_name: 'Suzuki Jimny or similar', rate_code: 'Off Road (OR)', max_passengers: 5, luggage: 2, doors: 3, has_aircon: true, gear: 'manual', min_days: 14, max_days: 30, price: 800, valid_from: '2026-11-01', valid_to: '2027-10-31', currency: 'ZAR' },
    /* A contract that only sells the middle of the ladder, so a short transfer has
       no band to sit in. */
    { id: 'n1', vehicle_group: 'N', vehicle_name: 'Hyundai H1 or similar', rate_code: 'Van (V)', max_passengers: 5, luggage: 4, doors: 5, has_aircon: true, gear: 'manual', min_days: 7, max_days: 13, price: 700, valid_from: '2026-11-01', valid_to: '2027-10-31', currency: 'ZAR' }
  ]
};

const groups = carRentalGroups(item);
const groupOf = (letter) => groups.find((g) => g.vehicleGroup === letter);

/* The package is sold all year, which is the whole point: the offer has to be
   quotable from November to October without anyone re-recording the hire. */
const yearPeriods = [{ valid_from: '2026-11-01', valid_to: '2027-10-31' }];
const yearWindows = packageValidityWindows(yearPeriods);
const decWindows = packageValidityWindows([{ valid_from: '2026-11-01', valid_to: '2026-12-20' }]);

/* 2. Which tariff answers a stretch of dates. Containment over every range the
   package is sold for, the tightest such window winning, and an undated tariff
   counting as a cover but ranking last. */
check('the hire has no dates and a length', isReferenceHire({ referenceHire: true }), true);
check('a hire with stamps is not a component', isReferenceHire({ pickupAt: '2026-12-11T08:00' }), false);
check('nothing on the line is not a component', [isReferenceHire(null), isReferenceHire(undefined)], [false, false]);

const yearAnswer = hireSeasonForWindows(groupOf('C'), yearWindows);
check('a tariff running for the whole selling year answers it', [yearAnswer.status, yearAnswer.season.windowLabel], ['ok', '2026-11-01 → 2027-10-31']);
const decAnswer = hireSeasonForWindows(groupOf('C'), decWindows);
check('the window written for these weeks beats the full-year tariff', [decAnswer.status, decAnswer.season.windowLabel], ['ok', '2026-11-01 → 2027-01-31']);
check('a December package prices December money', decAnswer.season.bands[0].price, 850);
const twoRanges = packageValidityWindows([yearPeriods[0], { valid_from: '2027-05-01', valid_to: '2027-06-30' }]);
check('a tariff must span every range, not just one', hireSeasonForWindows(groupOf('C'), twoRanges).season.windowLabel, '2026-11-01 → 2027-10-31');
check('the January tariff fails the second range', hireSeasonForWindows(groupOf('G'), twoRanges).status, 'blocked');
check('an undated tariff speaks for the range when nothing dated does', hireSeasonForWindows(groupOf('A'), yearWindows).season.windowLabel, 'Any date');
const openAnswer = hireSeasonForWindows(groupOf('C'), []);
check('a package with no restricted range takes the contract\'s own first tariff', [openAnswer.status, openAnswer.season.windowLabel], ['open', '2026-11-01 → 2027-01-31']);

/* A hire desk re-prices annually, so the ordinary year-long package is covered by
   TWO tariffs rather than one, and the old rule read that as "not priced". The
   contract is now asked as a whole: tariffs running back to end cover the range, and
   the ladder answering the first date the package sells for is the one on offer.
   Kept as its own contract so the group lists above stay the ones they were. */
const splitItem = {
  id: 'car-2',
  name: 'Europcar — Split Tariff Contract',
  category: 'Car Rental',
  currency: 'ZAR',
  rental_contract_fee: '190.0000',
  car_rental_rates: [
    /* The way a hire desk really writes a year: two tariffs handing over to each
       other, neither spanning the whole selling range on its own. */
    { id: 't1', vehicle_group: 'T', vehicle_name: 'Toyota Vitz or similar', rate_code: 'City (TY)', max_passengers: 4, luggage: 2, doors: 5, has_aircon: true, gear: 'manual', min_days: 1, max_days: 6, price: 805, valid_from: '2027-01-05', valid_to: '2027-04-30', currency: 'ZAR' },
    { id: 't2', vehicle_group: 'T', vehicle_name: 'Toyota Vitz or similar', rate_code: 'City (TY)', max_passengers: 4, luggage: 2, doors: 5, has_aircon: true, gear: 'manual', min_days: 1, max_days: 6, price: 950, valid_from: '2027-05-01', valid_to: '2027-10-31', currency: 'ZAR' },
    /* The same pair with a month the desk left unpriced between them. */
    { id: 'u1', vehicle_group: 'U', vehicle_name: 'Nissan Almera or similar', rate_code: 'Runner (RN)', max_passengers: 4, luggage: 2, doors: 4, has_aircon: true, gear: 'manual', min_days: 1, max_days: 6, price: 700, valid_from: '2027-01-05', valid_to: '2027-04-30', currency: 'ZAR' },
    { id: 'u2', vehicle_group: 'U', vehicle_name: 'Nissan Almera or similar', rate_code: 'Runner (RN)', max_passengers: 4, luggage: 2, doors: 4, has_aircon: true, gear: 'manual', min_days: 1, max_days: 6, price: 720, valid_from: '2027-06-01', valid_to: '2027-10-31', currency: 'ZAR' },
    /* And the same pair stopping short of the last day the package sells for. */
    { id: 'v1', vehicle_group: 'V', vehicle_name: 'Toyota Aygo or similar', rate_code: 'Small (SM)', max_passengers: 4, luggage: 1, doors: 5, has_aircon: true, gear: 'automatic', min_days: 1, max_days: 6, price: 640, valid_from: '2027-01-05', valid_to: '2027-04-30', currency: 'ZAR' },
    { id: 'v2', vehicle_group: 'V', vehicle_name: 'Toyota Aygo or similar', rate_code: 'Small (SM)', max_passengers: 4, luggage: 1, doors: 5, has_aircon: true, gear: 'automatic', min_days: 1, max_days: 6, price: 660, valid_from: '2027-05-01', valid_to: '2027-09-30', currency: 'ZAR' }
  ]
};
const splitGroupOf = (letter) => carRentalGroups(splitItem).find((g) => g.vehicleGroup === letter);
const splitWindows = packageValidityWindows([{ valid_from: '2027-01-05', valid_to: '2027-10-31' }]);
const splitAnswer = hireSeasonForWindows(splitGroupOf('T'), splitWindows);
check('two tariffs running into each other cover the package', splitAnswer.status, 'ok');
check('the tariff the package opens on is the one quoted', [splitAnswer.season.windowLabel, splitAnswer.season.bands[0].price], ['2027-01-05 → 2027-04-30', 805]);
check('so the offer prices without a warning', resolveHireOffer({ group: splitGroupOf('T'), hireDays: 1, windows: splitWindows, contractFee: 190 }).message, '');
check('and the composed offer totals the hire plus its paperwork', resolveHireOffer({ group: splitGroupOf('T'), hireDays: 1, windows: splitWindows, contractFee: 190 }).total, 995);
check('a package narrowed to the second tariff prices the second tariff', hireSeasonForWindows(splitGroupOf('T'), packageValidityWindows([{ valid_from: '2027-07-01', valid_to: '2027-09-30' }])).season.windowLabel, '2027-05-01 → 2027-10-31');
/* Two things the union rule must not excuse: a month the desk left unpriced, and a
   package that runs past the contract's last day. */
check('a gap between the tariffs is still a gap', hireSeasonForWindows(splitGroupOf('U'), splitWindows).status, 'blocked');
check('and a package running past the last tariff is still refused', hireSeasonForWindows(splitGroupOf('V'), splitWindows).status, 'blocked');
matches('the refusal names the tariffs the contract does run', hireSeasonForWindows(splitGroupOf('U'), splitWindows).message, /Its tariffs run 2027-01-05 → 2027-04-30, 2027-06-01 → 2027-10-31/);
check('a single tariff spanning the range still wins outright', [hireSeasonForWindows(groupOf('C'), yearWindows).season.windowLabel, hireSeasonForWindows(groupOf('C'), twoRanges).season.windowLabel], ['2026-11-01 → 2027-10-31', '2026-11-01 → 2027-10-31']);

/* Three ways the contract can fail the dates, and each one says something
   different. The operator needs to know whether to price a new tariff, wait for
   one, or shorten the range. */
const priorAnswer = hireSeasonForWindows(groupOf('D'), yearWindows);
check('a tariff that closed before the range is a stand-in, not an answer', [priorAnswer.status, priorAnswer.season.validTo], ['prior', '2026-06-30']);
check('and it names the dates it was asked about', priorAnswer.ranges, '2026-11-01 – 2027-10-31');
matches('a tariff that stops halfway says which windows it runs', hireSeasonForWindows(groupOf('G'), yearWindows).message, /No tariff on G · VW Polo or similar covers the package validity dates 2026-11-01 – 2027-10-31\. Its tariffs run 2026-11-01 → 2027-01-31/);
matches('a tariff that has not started yet says when it will', hireSeasonForWindows(groupOf('E'), yearWindows).message, /The nearest one starts 2028-03-01, after the package stops being sold/);
matches('a contract with no tariff at all is refused outright', hireSeasonForWindows({ vehicleGroup: 'Z', vehicleName: 'nothing', seasons: [] }, yearWindows).message, /Z · nothing has no rental price validity window\. Add one in Library Items\./);

/* 3. The answer as money: band times length, the desk's paperwork fee beside it,
   and Pricing Protection only ever standing in for a tariff that closed. */
const yearOffer = resolveHireOffer({ group: groupOf('C'), hireDays: 3, windows: yearWindows, protectionPercent: 0, contractFee: 185 });
check('the selling year prices the year tariff', [yearOffer.status, yearOffer.dailyRate, yearOffer.hireTotal], ['ok', 900, 2700]);
check('the offer total is the hire plus the fee', [yearOffer.contractFee, yearOffer.total], [185, 2885]);
check('the tariff the figure came from is readable', yearOffer.tariffLabel, '2026-11-01 → 2027-10-31 · 1–6 days');
check('and the window it stands on is recorded', [yearOffer.validityFrom, yearOffer.validityTo, yearOffer.currency], ['2026-11-01', '2027-10-31', 'ZAR']);
const decOffer = resolveHireOffer({ group: groupOf('C'), hireDays: 3, windows: decWindows, protectionPercent: 0, contractFee: 185 });
check('a December package is a cheaper transfer', [decOffer.dailyRate, decOffer.total], [850, 2735]);
check('seven days moves down the same ladder', resolveHireOffer({ group: groupOf('C'), hireDays: 7, windows: decWindows, contractFee: 185 }).hireTotal, 5460);

const protectedOffer = resolveHireOffer({ group: groupOf('D'), hireDays: 3, windows: yearWindows, protectionPercent: 10, contractFee: 185 });
check('the closed tariff stands in, uplifted', [protectedOffer.status, protectedOffer.dailyRate, protectedOffer.hireTotal, protectedOffer.upliftPercent], ['protected', 836, 2508, 10]);
matches('and says which tariff closed and by how much', protectedOffer.message, /priced with 10% Pricing Protection on the 2025-11-01 → 2026-06-30 tariff, which closed 2026-06-30 at ZAR 836\.00 per day/);
const staleOffer = resolveHireOffer({ group: groupOf('D'), hireDays: 3, windows: yearWindows, protectionPercent: 0, contractFee: 185 });
check('with no percentage set the old contract figure is charged exactly', [staleOffer.status, staleOffer.dailyRate, staleOffer.hireTotal, staleOffer.upliftPercent], ['stale', 760, 2280, 0]);
matches('and the line admits it is standing on a closed tariff', staleOffer.message, /with no Pricing Protection percentage set — this company has none, so the line is charged that old contract figure exactly as it stands/);
check('a tariff that simply does not reach the range is never uplifted', resolveHireOffer({ group: groupOf('G'), hireDays: 3, windows: yearWindows, protectionPercent: 25 }).ok, false);

/* A refusal never becomes a guess. */
matches('a length the ladder does not sell is refused with the reason', resolveHireOffer({ group: groupOf('H'), hireDays: 10, windows: yearWindows }).message, /gap between the bands/);
matches('longer than every band on the chosen tariff is refused, not clamped', resolveHireOffer({ group: groupOf('C'), hireDays: 90, windows: yearWindows }).message, /longer than any band on/);
matches('shorter than the shortest band is refused with the ladder named', resolveHireOffer({ group: groupOf('N'), hireDays: 3, windows: yearWindows }).message, /3 rental days is shorter than this contract sells — the shortest band is 7–13 days/);
check('a length the ladder does sell prices off it', resolveHireOffer({ group: groupOf('N'), hireDays: 10, windows: yearWindows }).hireTotal, 7000);
matches('a hire with no length has nothing to price', resolveHireOffer({ group: groupOf('C'), hireDays: 0, windows: yearWindows }).message, /Say how many 24-hour days one C · Toyota Corolla or similar transfer uses/);
check('and a refusal can still be shown, just not charged', [resolveHireOffer({ group: groupOf('H'), hireDays: 10, windows: yearWindows }).canPrice, resolveHireOffer({ group: groupOf('H'), hireDays: 10, windows: yearWindows }).status], [false, 'blocked']);
check('a group that has gone from the contract is refused', resolveHireOffer({ group: null }).message, 'This hire names no vehicle group, so there is nothing to price it from.');

/* 4. The same answer from what is stored on the line — the snapshot names the
   group and the length, and the desk's fee comes off the contract, not off the
   figure an earlier operator happened to type. */
const stored = { groupKey: carKey('C', 'Toyota Corolla or similar', 'Classic Max (CM)'), rentalDays: 3 };
const fromStored = resolveHireOfferForDetails({ item, details: stored, windows: yearWindows });
check('the line finds its own group by key', [fromStored.ok, fromStored.dailyRate], [true, 900]);
check('the fee is read from the contract, not from the line', fromStored.contractFee, 185);
check('a contract charging no fee falls back to what the line recorded', resolveHireOfferForDetails({
  item: { ...item, rental_contract_fee: 0 }, details: { ...stored, contractFee: 120 }, windows: yearWindows
}).contractFee, 120);
matches('a group the contract stopped selling names itself in the refusal', resolveHireOfferForDetails({
  item, details: { groupKey: 'Q', rentalDays: 3 }, windows: yearWindows
}).message, /Europcar Cape Town — City Transfer no longer sells the Q group, so the hire in this offer cannot be re-priced/);
check('the same hire re-answered for December is December money again', resolveHireOfferForDetails({ item, details: stored, windows: decWindows }).dailyRate, 850);

/* 5. What the drop dialog lists when the hire is a component: every group on the
   contract answered for the package's dates, and the ones that cannot price it
   still visible with their reason beside them. */
const choices = hireOfferChoices(item, { hireDays: 3, windows: yearWindows, pax: 4, protectionPercent: 10 });
check('the usable offers come first, smallest car that fits the party', choices.map((c) => c.group.vehicleGroup), ['C', 'D', 'H', 'A', 'E', 'G', 'N']);
check('a two-seater is offered but told it cannot seat the party', choices.find((c) => c.group.vehicleGroup === 'A').capacityError, 'A · Hyundai i10 or similar seats 2, this party is 4.');
check('a stand-in tariff is still offered, priced and labelled', choices.find((c) => c.group.vehicleGroup === 'D').offer.status, 'protected');
check('what cannot price a three-day transfer is unusable', choices.filter((c) => c.unusable).map((c) => c.group.vehicleGroup), ['E', 'G', 'N']);
matches('a van only sold by the week refuses the short transfer in the dialog too', choices.find((c) => c.group.vehicleGroup === 'N').offer.message, /shorter than this contract sells/);
check('and each unusable one carries its reason', [
  choices.find((c) => c.group.vehicleGroup === 'E').offer.message.startsWith('No tariff on'),
  choices.find((c) => c.group.vehicleGroup === 'G').offer.message.startsWith('No tariff on')
], [true, true]);
check('the length the dialog was given is the length priced', choices[0].offer.hireDays, 3);

/* 6. The copy a component hire stores. It goes through the same builder a dated
   hire uses, so the printed grid and the labels are identical in shape; what
   differs is that it names no stamps and remembers which tariff answered it. */
const details = referenceHireDetails({
  item,
  offer: yearOffer,
  source: { pickupLocation: 'Cape Town International', sameReturn: true }
});
check('the component hire is marked as one', [details.referenceHire, details.groupKey], [true, carKey('C', 'Toyota Corolla or similar', 'Classic Max (CM)')]);
check('it states a length and no dates', [details.rentalDays, details.pickupAt, details.returnAt], [3, '', '']);
check('the money is the hire alone; the fee is another line', [details.dailyRate, details.hireTotal, details.contractFee], [900, 2700, 185]);
check('the tariff and the status it came with are remembered', [details.hireStatus, details.hireTariff], ['ok', '2026-11-01 → 2027-10-31 · 1–6 days']);
check('the car keeps every spec the documents print', [details.contractType, details.vehicleGroup, details.passengers, details.gear, details.aircon], ['Classic Max (CM)', 'C', 4, 'manual', true]);
check('and the place the car goes out of', [details.pickupLocation, details.returnLocation, details.sameReturn], ['Cape Town International', 'Cape Town International', true]);
check('the line bills the transfer, not the paperwork', rentalLineBuyTotal(details), 2700);
check('one hire is one car, so the grid prints once', rentalPrintsSpecGrid(details), true);
check('the label the operator reads back has no departure in it', rentalSummaryLabel(details), 'Group C · Toyota Corolla or similar — 3 × 24h days');
const protectedDetails = referenceHireDetails({ item, offer: protectedOffer, source: { pickupLocation: 'Cape Town International', sameReturn: true } });
check('a protected answer carries the uplifted day rate in its own copy', [protectedDetails.dailyRate, protectedDetails.hireTotal, protectedDetails.upliftPercent, protectedDetails.hireStatus], [836, 2508, 10, 'protected']);
check('and keeps the closed window it was uplifted from', protectedDetails.validityTo, '2026-06-30');
check('a hire with no group behind it records nothing', referenceHireDetails({ item, offer: resolveHireOffer({ group: null }) }), null);

/* 7. The rate-shaped copy the package locks on the line, and the guards reading
   it back. This is what makes the composed offer re-price every season instead of
   keeping the money it was dropped with. */
const carRate = rentalPackageRate(details, 'ZAR');
check('the snapshot is a trip price for one transfer', [carRate.rate_basis, carRate.unit_cost, carRate.max_occupancy], ['per_trip', 2700, 4]);
check('it says the hire it stands on has no date of its own', [carRate.reference_hire, carRate.rental_price_validity], [true, true]);
check('it carries the group and the length so a later reader can re-ask', [carRate.hire_group_key, carRate.hire_days], [carKey('C', 'Toyota Corolla or similar', 'Classic Max (CM)'), 3]);
check('and the uplift it was answered under', carRate.hire_uplift_percent, 0);
const datedDetails = buildRentalDetails({
  item, group: groupOf('C'), season: groupOf('C').seasons[0], band: groupOf('C').seasons[0].bands[0],
  days: 3, pickupAt: '2026-12-11T08:00', returnAt: '2026-12-14T08:00',
  pickupLocation: 'Cape Town International', returnLocation: 'Cape Town International', sameReturn: true, contractFee: 185
});
const datedRate = rentalPackageRate(datedDetails, 'ZAR');
/* The same dated hire with a tariff window that plainly does not reach the selling
   year — the case a component hire would refuse on, and the one a dated hire never
   sees, because its own pick-up stamp answered the question at drop time. */
const staleDatedRate = { ...datedRate, valid_from: '2025-11-01', valid_to: '2026-06-30' };
check('a hire with stamps stays a hire with stamps', [datedRate.reference_hire, datedRate.hire_days], [false, 0]);

check('the selling year is covered by the tariff the offer stands on', packageSeasonCoverage(item, carRate, yearPeriods), { status: 'ok', ok: true, message: '' });
check('a package with no restricted range has nothing to check', packageSeasonCoverage(item, carRate, []), { status: 'open', ok: true, message: '' });
check('a hire priced off a closed tariff is not covered', packageSeasonCoverage(item, rentalPackageRate(protectedDetails, 'ZAR'), yearPeriods).status, 'missing');
check('the paperwork line states no length, so it is not asked', packageSeasonCoverage(item, rentalPackageRate(rentalFeeDetails(details), 'ZAR'), yearPeriods).status, 'missing');
check('a dated hire is settled whatever the package dates say', packageSeasonCoverage(item, staleDatedRate, yearPeriods), { status: 'ok', ok: true, message: '' });

const resolved = packageSeasonResolution({ item, rate: carRate, periods: yearPeriods, currencyCode: 'ZAR', protectionPercent: 10 });
check('the guard re-answers the component hire and publishes the figure', [resolved.status, resolved.ok, resolved.canAdd, resolved.protectionPercent], ['ok', true, true, 0]);
check('the rate it returns is the tariff running for these dates', [resolved.rate.unit_cost, resolved.rate.season_name], [2700, 'Hire 1–6 days']);
check('and it still says the hire has no date', [resolved.rate.reference_hire, resolved.rate.valid_from, resolved.rate.valid_to], [true, '2026-11-01', '2027-10-31']);
const resolvedProtected = packageSeasonResolution({ item, rate: rentalPackageRate(protectedDetails, 'ZAR'), periods: yearPeriods, currencyCode: 'ZAR', protectionPercent: 10 });
check('a closed tariff becomes a protected line, not a blocked one', [resolvedProtected.status, resolvedProtected.protectionPercent], ['protected', 10]);
check('with the uplifted money on the rate and the stamp beside it', [resolvedProtected.rate.unit_cost, resolvedProtected.rate.price_protection_percent], [2508, 10]);
const resolvedGone = packageSeasonResolution({ item, rate: { ...carRate, hire_group_key: 'Q' }, periods: yearPeriods, currencyCode: 'ZAR', protectionPercent: 10 });
check('a hire the contract no longer sells blocks the save with the reason', [resolvedGone.status, resolvedGone.canAdd], ['blocked', false]);
matches('and names the item the operator has to fix', resolvedGone.message, /Europcar Cape Town — City Transfer: .*no longer sells the Q group/);
const settledDated = packageSeasonResolution({ item, rate: staleDatedRate, periods: yearPeriods, protectionPercent: 10 });
check('a dated hire is never re-answered by the guard', [settledDated.status, settledDated.rate], ['ok', staleDatedRate]);

/* 8. The composed offer as the package prices it: three library items, one thing
   being sold, divided over the party like any other shared line. */
const carLine = {
  item_key: 'hire-1', item_id: 'car-1', item_name: item.name, category: 'Car Rental',
  currency_code: 'ZAR', rate_basis: 'per_trip', unit_cost: 2700, unit_price: 2700,
  quantity: 1, is_included: true, vehicle_capacity: 4, rental: details, rate_snapshot: carRate,
  bundle_key: 'b-1', bundle_label: 'Cape Town airport transfer to the CBD'
};
const feeDetails = rentalFeeDetails(details);
const feeRate = rentalPackageRate(feeDetails, 'ZAR');
const feeLine = {
  ...carLine, item_key: 'hire-fee', item_name: rentalFeeLineLabel(feeDetails),
  unit_cost: 185, unit_price: 185, rental: feeDetails, rate_snapshot: feeRate
};
const guideItem = { id: 'guide-1', name: 'Guide, per day', category: 'Activities / Tours', currency: 'ZAR', item_rates: [] };
const guideLine = {
  ...carLine, item_id: 'guide-1', item_name: guideItem.name, category: guideItem.category,
  item_key: 'guide-1', unit_cost: 400, unit_price: 400, vehicle_capacity: 0,
  rental: null, rate_snapshot: { currency: 'ZAR', rate_basis: 'per_trip', unit_price: 400, unit_cost: 400, max_occupancy: 0, season_name: 'Guide rate', valid_from: '2026-11-01', valid_to: '2027-10-31' }
};
const lodgeLine = {
  ...carLine, item_key: 'lodge-1', item_id: 'lodge-1', item_name: 'City Lodge, two nights',
  category: 'Accommodation', unit_cost: 1200, unit_price: 1200, vehicle_capacity: 0, rental: null,
  bundle_key: null, bundle_label: null,
  rate_snapshot: { currency: 'ZAR', rate_basis: 'per_person_sharing', unit_price: 600, unit_cost: 600, max_occupancy: 2, season_name: 'High', valid_from: '2026-11-01', valid_to: '2027-10-31' }
};
const offerDays = [{ day_number: 1, services: [carLine, feeLine, guideLine] }];
const offerPrice = calculatePackageTravellerBreakdown({ days: offerDays, pattern: { pax: 4 }, library: [item, guideItem] });
check('the three parts come to one transfer price', offerPrice.partyTotal, 3285);
check('and the party divides the whole of it', [offerPrice.pax, offerPrice.unitPerPerson], [4, 821.25]);
check('the composed offer is not blocked by the season guard', [offerPrice.servable, offerPrice.blockedVehicleReasons], [true, []]);

/* 9. The offer as a grouping. Nothing about how a line is priced changes; only
   which lines are read together, what they total to and how they print. */
const scattered = [carLine, lodgeLine, feeLine, guideLine];
const dayGroups = bundleGroups(scattered);
check('an offer is one entry, wherever its parts sit on the day', dayGroups.map((g) => g.key), ['b-1', null]);
check('an offer is pulled together wherever its parts sit', dayGroups[0].lines.map((line) => line.item_key), ['hire-1', 'hire-fee', 'guide-1']);
check('its total is the sum of its parts', dayGroups[0].total, 3285);
check('and it carries the name the operator typed', [dayGroups[0].label, dayGroups[0].currency], ['Cape Town airport transfer to the CBD', 'ZAR']);
check('a plain line is its own entry, totalling itself', [dayGroups[1].label, dayGroups[1].total, dayGroups[1].lines.length], ['', 1200, 1]);
check('the offer reads as one thing on the day', bundleOfferLabel(dayGroups[0]), 'Cape Town airport transfer to the CBD — 3 parts');
check('a line with no key is not part of anything', bundleOfferLabel(dayGroups[1]), '');
check('the day with nothing on it groups into nothing', bundleGroups([]), []);
check('a missing line is skipped, not totalled as zero', bundleGroups([carLine, null, guideLine])[0].lines.length, 2);
check('a line excluded from the price totals out of the offer', bundleGroups([carLine, feeLine, guideLine], { lineTotal: (line) => (line.item_key === 'guide-1' ? 0 : line.unit_cost) })[0].total, 2885);
check('the same key in two band views totals twice, once per party size', [
  bundleGroups([carLine], { lineTotal: () => 100 })[0].total,
  bundleGroups([{ ...carLine, is_included: false }], { lineTotal: (line) => (line.is_included === false ? 0 : line.unit_cost) })[0].total
], [100, 0]);

/* 10. Joining, leaving and renaming: every line of an offer carries the key and
   the label, so the identity travels with the rows instead of living in a parent
   nothing else can see. */
check('joining stamps both the key and the name', [stampBundle(lodgeLine, 'b-2', 'Evening city tour').bundle_key, stampBundle(lodgeLine, 'b-2', 'Evening city tour').bundle_label], ['b-2', 'Evening city tour']);
check('a new offer starts with what the first line already calls itself', stampBundle({ item_name: 'Guide, per day' }, 'b-3', '').bundle_label, 'Guide, per day');
check('and with words rather than a blank when it has no name', stampBundle({}, 'b-3', '').bundle_label, 'Composed offer');
check('the name a group falls back to is the first line\'s own', defaultBundleLabel(carLine), item.name);
check('an offer nobody has named still carries the first line\'s own name', bundleGroups([stampBundle(carLine, 'b-9', '')])[0].label, item.name);
check('naming it from the group is what the export does', defaultBundleLabel(bundleGroups([stampBundle(carLine, 'b-9', '')])[0].lines[0]), item.name);
check('leaving takes the key off as well as the name', [unstampBundle(carLine).bundle_key, unstampBundle(carLine).bundle_label], [null, null]);
check('a line with a key is a bundle line and a plain one is not', [isBundleLine(carLine), isBundleLine(lodgeLine)], [true, false]);
check('nothing at all is not a bundle line', isBundleLine(undefined), false);

/* 11. Re-answering the hire. This is the half the consultant never sees happening:
   a package saved in December on the December tariff, still being sold in October,
   reads the tariff that runs for the dates it is offered for. Only the hire's own
   money and copy change — no line is added, moved or removed. */
const savedCarLine = { ...carLine, unit_cost: 2550, unit_price: 2550, rental: { ...details, dailyRate: 850, hireTotal: 2550, total: 2735, hireTariff: '2026-11-01 → 2027-01-31 · 1–6 days' } };
const savedFeeLine = { ...feeLine, rental: { ...feeDetails, groupKey: carRate.hire_group_key } };
const savedDays = [{ services: [savedCarLine, savedFeeLine] }];
const answered = repriceHireComponents(savedDays, { items: [item], windows: yearWindows, protectionPercent: 0, currency: 'ZAR' });
check('the year\'s tariff re-answers the December figure', [answered.changed, answered.days[0].services[0].unit_cost], [true, 2700]);
check('the hire copy moves with the money', [answered.days[0].services[0].rental.dailyRate, answered.days[0].services[0].rental.hireTariff], [900, '2026-11-01 → 2027-10-31 · 1–6 days']);
check('and so does the locked snapshot the package prices from', answered.days[0].services[0].rate_snapshot.unit_cost, 2700);
check('the line keeps its identity and its place in the offer', [answered.days[0].services[0].item_key, answered.days[0].services[0].bundle_key, answered.days[0].services.length], ['hire-1', 'b-1', 2]);
check('the paperwork line is untouched when the desk has not put its fee up', answered.days[0].services[1] === savedFeeLine, true);
const answeredTwice = repriceHireComponents(answered.days, { items: [item], windows: yearWindows, protectionPercent: 0, currency: 'ZAR' });
check('re-asking the same question marks nothing dirty a second time', [answeredTwice.changed, answeredTwice.days === answered.days], [false, true]);
const moved = repriceHireComponents(answered.days, { items: [{ ...item, rental_contract_fee: '200.0000' }], windows: yearWindows, protectionPercent: 0, currency: 'ZAR' });
check('a fee the desk raised follows the same agreement', [moved.changed, moved.days[0].services[1].unit_cost, moved.days[0].services[0].unit_cost], [true, 200, 2700]);
const shortened = repriceHireComponents(answered.days, { items: [item], windows: decWindows, protectionPercent: 0, currency: 'ZAR' });
check('a package narrowed to December goes back to December money', [shortened.days[0].services[0].unit_cost, shortened.days[0].services[0].rental.hireTariff], [2550, '2026-11-01 → 2027-01-31 · 1–6 days']);
const stampedProtected = {
  ...carLine, unit_cost: 2508, unit_price: 2508, price_protection_percent: 10,
  protected_season_name: 'an older tariff',
  rental: { ...protectedDetails, groupKey: carKey('D', 'Ford Ranger or similar', 'Utility (U)') },
  rate_snapshot: rentalPackageRate(protectedDetails, 'ZAR')
};
const reprotected = repriceHireComponents([{ services: [stampedProtected] }], { items: [item], windows: yearWindows, protectionPercent: 10, currency: 'ZAR' });
check('an offer already standing on the uplift stays on it without re-stamping', reprotected.changed, false);
const unprotected = repriceHireComponents([{ services: [stampedProtected] }], { items: [item], windows: yearWindows, protectionPercent: 0, currency: 'ZAR' });
check('the tenant switching protection off re-answers the line', [unprotected.changed, unprotected.days[0].services[0].unit_cost, unprotected.days[0].services[0].price_protection_percent], [true, 2280, 0]);
check('and takes the ⚑ stamp off the day too', unprotected.days[0].services[0].protected_season_name, '');
const datedLine = { ...carLine, unit_cost: 2550, rental: datedDetails, rate_snapshot: datedRate };
const datedPass = repriceHireComponents([{ services: [datedLine] }], { items: [item], windows: yearWindows, protectionPercent: 10, currency: 'ZAR' });
check('a hire with real dates is never re-answered', [datedPass.changed, datedPass.days[0].services[0] === datedLine], [false, true]);
check('a day with no hire is handed straight back', repriceHireComponents([{ services: [lodgeLine] }], { items: [item], windows: yearWindows }).days[0].services[0], lodgeLine);
check('and no hire anywhere means the very same array', repriceHireComponents(savedDays, { items: [], windows: yearWindows }).days === savedDays, true);
const orphan = repriceHireComponents(savedDays, { items: [{ ...item, id: 'somewhere-else' }], windows: yearWindows });
check('a line whose library item is gone keeps its figure', [orphan.changed, orphan.days[0].services[0].unit_cost], [false, 2550]);
const stoppedGroup = repriceHireComponents(savedDays, { items: [{ ...item, car_rental_rates: [item.car_rental_rates[5]] }], windows: yearWindows });
check('a group the contract stopped selling keeps its figure and the guard refuses the save', [stoppedGroup.changed, packageSeasonResolution({ item: { ...item, car_rental_rates: [item.car_rental_rates[5]] }, rate: carRate, periods: yearPeriods }).canAdd], [false, false]);
const openPackage = repriceHireComponents(savedDays, { items: [item], windows: [] });
check('a package with no restricted range keeps its own tariff rather than guessing', openPackage.days[0].services[0].unit_cost, 2550);

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
