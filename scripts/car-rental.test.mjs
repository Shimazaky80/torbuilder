import {
  buildRentalDetails,
  carRentalBuyTotal,
  carRentalGroupChoices,
  carRentalGroups,
  carRentalHireTotal,
  isCarRentalItem,
  isRentalFeeLine,
  rentalCollectionDayIndex,
  rentalDayCount,
  rentalDayDetails,
  rentalDayPlacement,
  rentalDayShares,
  rentalFeeDetails,
  rentalFeeLineLabel,
  rentalLineBuyTotal,
  rentalPackageRate,
  rentalPrintsSpecGrid,
  rentalSeasonLabel,
  rentalSummaryLabel,
  rentalValidityError,
  rentalVehicleLabel,
  resolveRentalSeason,
  selectRentalBand
} from '../src/lib/carRentalPricing.js';
import { carSpecGridHtml, carSpecText, carSpecValue } from '../src/lib/carSpecIcons.js';
import { voucherDetailLines } from '../src/lib/voucherDetails.js';
import {
  repriceServicesForPax,
  revalidateServicesForWindow
} from '../src/lib/servicePricing.js';
import {
  calculatePackageTravellerBreakdown,
  packageIsTransport,
  packageSeasonCoverage,
  packageSeasonResolution
} from '../src/lib/packagePricing.js';
import { buildItineraryPackage } from '../src/lib/itineraryToPackage.js';

let failures = 0;
const check = (label, actual, expected) => {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};
const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

console.log('\n--- Running Car Rental Hire Pricing Tests ---\n');

/* 1. The 24-hour charge, exactly as the hire desk states it.
   Collected 08:00 on the 18th: back at 08:00 on the 19th is one day, and five
   minutes past the hour is a second day — the contract does not prorate. */
check('eight hours short of a day is still one block', rentalDayCount('2026-11-18T08:00', '2026-11-19T07:59'), 1);
check('the hour on the hour is one block', rentalDayCount('2026-11-18T08:00', '2026-11-19T08:00'), 1);
check('five minutes late is a full extra day', rentalDayCount('2026-11-18T08:00', '2026-11-19T08:05'), 2);
check('three exact days', rentalDayCount('2026-11-18T08:00', '2026-11-21T08:00'), 3);
check('a minute over three days is four', rentalDayCount('2026-11-18T08:00', '2026-11-21T08:01'), 4);
check('dates without times count calendar days', rentalDayCount('2026-11-18', '2026-11-21'), 3);
check('a space separator reads like a T', rentalDayCount('2026-11-18 08:00', '2026-11-19 08:00'), 1);
check('no return is no hire', rentalDayCount('2026-11-18T08:00', ''), 0);
check('the same moment is no hire', rentalDayCount('2026-11-18T08:00', '2026-11-18T08:00'), 0);
check('a car back before it left is no hire', rentalDayCount('2026-11-18T08:00', '2026-11-17T08:00'), 0);
check('garbage is no hire', rentalDayCount('sometime', 'later'), 0);
/* The stamps are read from the text, so the two hours a DST switch adds or takes
   away cannot gift or steal a rental day. */
check('a leap crossing counts the days it is out', rentalDayCount('2028-02-28T08:00', '2028-03-01T08:00'), 2);
check('a 365-day hire counts 365', rentalDayCount('2026-01-01T08:00', '2027-01-01T08:00'), 365);

/* 2. One hire contract, several vehicle groups, and each group repeated once per
   tariff season as well as per rental band — the same car is other money in
   July, and the ladder is different too. */
const item = {
  id: 'car-1',
  name: 'Europcar Cape Town — City Hire',
  category: 'Car Rental',
  currency: 'ZAR',
  rental_contract_fee: '185.0000',
  supplier: { name: 'Europcar', city_location: 'Cape Town' },
  car_rental_rates: [
    { id: 'c4', item_id: 'car-1', vehicle_group: 'C', vehicle_name: 'Toyota Corolla Quest or similar', rate_code: 'Classic Max (CM)', kms_unlimited: false, kms_included: 400, luggage: 2, doors: 4, max_passengers: 4, has_aircon: true, gear: 'automatic', fuel_type: 'fuel', min_days: 31, max_days: null, price: 620, valid_from: '2026-11-01', valid_to: '2027-01-31', currency: 'ZAR' },
    { id: 'c1', item_id: 'car-1', vehicle_group: 'C', vehicle_name: 'Toyota Corolla Quest or similar', rate_code: 'Classic Max (CM)', kms_unlimited: false, kms_included: 400, luggage: 2, doors: 4, max_passengers: 4, has_aircon: true, gear: 'automatic', fuel_type: 'fuel', min_days: 1, max_days: 6, price: 850, valid_from: '2026-11-01', valid_to: '2027-01-31', currency: 'ZAR' },
    { id: 'c2', item_id: 'car-1', vehicle_group: 'C', vehicle_name: 'Toyota Corolla Quest or similar', rate_code: 'Classic Max (CM)', kms_unlimited: false, kms_included: 400, luggage: 2, doors: 4, max_passengers: 4, has_aircon: true, gear: 'automatic', fuel_type: 'fuel', min_days: 7, max_days: 13, price: 780, valid_from: '2026-11-01', valid_to: '2027-01-31', currency: 'ZAR' },
    { id: 'c3', item_id: 'car-1', vehicle_group: 'C', vehicle_name: 'Toyota Corolla Quest or similar', rate_code: 'Classic Max (CM)', kms_unlimited: false, kms_included: 400, luggage: 2, doors: 4, max_passengers: 4, has_aircon: true, gear: 'automatic', fuel_type: 'fuel', min_days: 14, max_days: 30, price: 700, valid_from: '2026-11-01', valid_to: '2027-01-31', currency: 'ZAR' },
    /* The same car sold again in midwinter at other money — a second Rental Price
       Validity window on the same group, with a shorter ladder of its own. */
    { id: 'c5', item_id: 'car-1', vehicle_group: 'C', vehicle_name: 'Toyota Corolla Quest or similar', rate_code: 'Classic Max (CM)', kms_unlimited: false, kms_included: 400, luggage: 2, doors: 4, max_passengers: 4, has_aircon: true, gear: 'automatic', fuel_type: 'fuel', min_days: 1, max_days: 6, price: 990, valid_from: '2027-06-01', valid_to: '2027-06-30', currency: 'ZAR' },
    { id: 'a1', item_id: 'car-1', vehicle_group: 'A', vehicle_name: 'Hyundai i10 or similar', rate_code: 'Economy (B)', max_passengers: 2, luggage: 1, doors: 5, has_aircon: true, gear: 'manual', fuel_type: 'fuel', min_days: 1, max_days: 6, price: 520, valid_from: '2026-11-01', valid_to: '2027-01-31', currency: 'ZAR' },
    /* The economy car also sits on an open tariff the contract never dated. */
    { id: 'a2', item_id: 'car-1', vehicle_group: 'A', vehicle_name: 'Hyundai i10 or similar', rate_code: 'Economy (B)', max_passengers: 2, luggage: 1, doors: 5, has_aircon: true, gear: 'manual', fuel_type: 'fuel', min_days: 1, max_days: 6, price: 600, valid_from: null, valid_to: null, currency: 'ZAR' },
    { id: 'e1', item_id: 'car-1', vehicle_group: 'E', vehicle_name: 'Nissan Leaf or similar', rate_code: 'Green Max (GM)', max_passengers: 5, luggage: 2, doors: 5, has_aircon: true, gear: 'automatic', fuel_type: 'electric', min_days: 1, max_days: 6, price: 1100, valid_from: '2026-11-01', valid_to: '2027-01-31', currency: 'ZAR' },
    /* A tariff that expired before the trip: the pick-up date is what it fails on. */
    { id: 'd1', item_id: 'car-1', vehicle_group: 'D', vehicle_name: 'Ford Ranger 2.4 or similar', rate_code: 'Utility (U)', max_passengers: 5, luggage: 3, doors: 4, has_aircon: true, gear: 'manual', fuel_type: 'fuel', min_days: 1, max_days: 13, price: 1400, valid_from: '2025-12-01', valid_to: '2026-10-31', currency: 'ZAR' },
    /* A contract with a hole in its ladder — 7 to 13 days is simply not sold. */
    { id: 'g1', item_id: 'car-1', vehicle_group: 'G', vehicle_name: 'VW Polo or similar', rate_code: 'Compact (C)', max_passengers: 5, luggage: 2, doors: 5, has_aircon: true, gear: 'automatic', fuel_type: 'fuel', min_days: 1, max_days: 6, price: 750, valid_from: '2026-11-01', valid_to: '2027-01-31', currency: 'ZAR' },
    { id: 'g2', item_id: 'car-1', vehicle_group: 'G', vehicle_name: 'VW Polo or similar', rate_code: 'Compact (C)', max_passengers: 5, luggage: 2, doors: 5, has_aircon: true, gear: 'automatic', fuel_type: 'fuel', min_days: 14, max_days: 30, price: 690, valid_from: '2026-11-01', valid_to: '2027-01-31', currency: 'ZAR' },
    /* A group that only sells the middle of the ladder. */
    { id: 'h1', item_id: 'car-1', vehicle_group: 'H', vehicle_name: 'Suzuki Jimny or similar', rate_code: 'Off Road (OR)', max_passengers: 5, luggage: 2, doors: 3, has_aircon: true, gear: 'manual', fuel_type: 'fuel', min_days: 7, max_days: 13, price: 900, valid_from: '2026-11-01', valid_to: '2027-01-31', currency: 'ZAR' }
  ]
};

const groups = carRentalGroups(item);
const groupOf = (letter) => groups.find((g) => g.vehicleGroup === letter);
check('rows fold into one entry per vehicle group, not one per tariff', groups.length, 6);
check('a group sold across two windows folds them into one card', groupOf('C').seasons.length, 2);
check('the group carries no validity of its own any more', [groupOf('C').validFrom, groupOf('C').validTo], [undefined, undefined]);
check('the season\'s bands sort shortest first', groupOf('C').seasons[0].bands.map((b) => b.minDays), [1, 7, 14, 31]);
check('an open-ended band stays open', groupOf('C').seasons[0].bands[3].maxDays, null);
check('a second season keeps only its own ladder', groupOf('C').seasons[1].bands.map((b) => [b.minDays, b.maxDays, b.price]), [[1, 6, 990]]);
check('each season names its own window', groupOf('C').seasons.map((s) => s.windowLabel), ['2026-11-01 → 2027-01-31', '2027-06-01 → 2027-06-30']);
check('a refusal names the car and the tariff it was looked for in', groupOf('C').seasons[1].label, 'C · Toyota Corolla Quest or similar (2027-06-01 → 2027-06-30)');
check('the contract type rides on the group', groupOf('C').rateCode, 'Classic Max (CM)');
check('gear and fuel keep the words the grid maps', [groupOf('E').gear, groupOf('E').fuelType], ['automatic', 'electric']);

/* 2b. The pick-up date picks the season and the block count picks the band inside
   it — and the band is never looked for in the other season's ladder. */
check('a December pick-up prices off the December tariff', resolveRentalSeason(groupOf('C'), '2026-12-11T08:00').season.windowLabel, '2026-11-01 → 2027-01-31');
check('a June pick-up prices the same car at June money', selectRentalBand(resolveRentalSeason(groupOf('C'), '2027-06-10T08:00').season, 1).band.price, 990);
check('the winter tariff does not lend the summer ladder its long bands', /longer than any band on C · Toyota Corolla Quest or similar \(2027-06-01 → 2027-06-30\)/.test(selectRentalBand(groupOf('C').seasons[1], 90).error), true);
check('six days takes the 1-6 band', selectRentalBand(groupOf('C').seasons[0], 6).band.price, 850);
check('seven days moves up to the 7-13 band', selectRentalBand(groupOf('C').seasons[0], 7).band.price, 780);
check('an open band takes anything above its floor', selectRentalBand(groupOf('C').seasons[0], 90).band.price, 620);
check('shorter than the shortest band refuses', /shorter than this contract sells/.test(selectRentalBand(groupOf('H').seasons[0], 3).error), true);
check('longer than every band refuses', /longer than any band/.test(selectRentalBand(groupOf('H').seasons[0], 90).error), true);
check('a gap in the ladder refuses with the reason', /gap between the bands/.test(selectRentalBand(groupOf('G').seasons[0], 10).error), true);
check('no dates is a refusal, not a zero', selectRentalBand(groupOf('C').seasons[0], 0).error, 'Set a pick-up and return date and time to price the hire.');

/* 2c. Two windows on one car, and which of them the desk would honour. */
check('a tariff that names no date reads as any date', rentalSeasonLabel(null, null), 'Any date');
check('a tariff with one end named says which end is open', rentalSeasonLabel('2026-11-01', null), '2026-11-01 → open');
const overlapItem = {
  currency: 'ZAR',
  car_rental_rates: [
    { id: 'o1', vehicle_group: 'K', vehicle_name: 'Toyota Hilux or similar', rate_code: 'Luxury (LX)', max_passengers: 5, min_days: 1, max_days: 6, price: 850, valid_from: '2026-11-01', valid_to: '2027-01-31' },
    { id: 'o2', vehicle_group: 'K', vehicle_name: 'Toyota Hilux or similar', rate_code: 'Luxury (LX)', max_passengers: 5, min_days: 1, max_days: 6, price: 1000, valid_from: '2026-12-01', valid_to: '2026-12-31' },
    { id: 'o3', vehicle_group: 'K', vehicle_name: 'Toyota Hilux or similar', rate_code: 'Luxury (LX)', max_passengers: 5, min_days: 1, max_days: 6, price: 700, valid_from: null, valid_to: null }
  ]
};
const overlap = carRentalGroups(overlapItem)[0];
check('three rows on one car fold to three seasons', overlap.seasons.length, 3);
check('the narrowest dated tariff beats a broad one covering the same day', resolveRentalSeason(overlap, '2026-12-11T08:00').season.validFrom, '2026-12-01');
check('an open tariff loses to a dated one that covers the date', resolveRentalSeason(overlap, '2026-11-15T08:00').season.validTo, '2027-01-31');
check('and an open tariff is the answer no dated window gives', resolveRentalSeason(overlap, '2027-05-05T08:00').season.windowLabel, 'Any date');
check('the open tariff is the last one the dialog offers', overlap.seasons.map((s) => s.windowLabel), ['2026-11-01 → 2027-01-31', '2026-12-01 → 2026-12-31', 'Any date']);
check('one tariff with two ends still refuses with the old plain words', rentalValidityError(groupOf('D'), '2026-11-18T08:00'), 'Priced for hires up to 2026-10-31, but this car is collected on 2026-11-18.');
check('and the same words when the car is collected before it began', rentalValidityError(groupOf('D'), '2025-11-30T08:00'), 'Priced for hires from 2025-12-01, but this car is collected on 2025-11-30.');
check('a pick-up between two seasons names every window the contract sells', /No tariff on C · Toyota Corolla Quest or similar covers a car collected on 2027-03-05 — its seasons are 2026-11-01 → 2027-01-31, 2027-06-01 → 2027-06-30\./.test(rentalValidityError(groupOf('C'), '2027-03-05T08:00')), true);
check('a pick-up inside the tariff window prices', rentalValidityError(groupOf('C'), '2026-12-11T08:00'), null);
check('a pick-up before the window names the tariff', /collected on 2026-11-18/.test(rentalValidityError(groupOf('D'), '2026-11-18T08:00')), true);
check('a pick-up after the window names the tariff', /hires up to 2026-10-31/.test(rentalValidityError(groupOf('D'), '2026-12-11T08:00')), true);
check('a group with no season at all is a refusal, not a free hire', rentalValidityError({ vehicleGroup: 'Z', seasons: [] }, '2026-12-11T08:00'), 'Z has no rental price validity window. Add one in Library Items.');

/* 3. The choices the drop dialog lists: days times the band, plus the contract
   fee the hire desk charges every time, folded into the same line. */
const choices = carRentalGroupChoices(item, { days: 1, pickupAt: '2026-12-11T08:00', pax: 4 });
const byGroup = (letter) => choices.find((choice) => choice.group.vehicleGroup === letter);
check('the contract fee is read from the item', byGroup('C').price.contractFee, 185);
check('one day of hire at the 1-6 band', byGroup('C').price.hireTotal, 850);
check('the line total is the hire plus the contract fee', byGroup('C').price.total, 1035);
check('seven days moves down the ladder and re-adds the fee', carRentalGroupChoices(item, { days: 7, pickupAt: '2026-12-11T08:00', pax: 4 }).find((c) => c.group.vehicleGroup === 'C').price.total, 5645);
check('a two-seater refuses a party of four', byGroup('A').capacityError, 'A · Hyundai i10 or similar seats 2, this party is 4.');
check('an expired tariff is unusable', byGroup('D').unusable, true);
check('a gap in the ladder is unusable at the missing length', carRentalGroupChoices(item, { days: 10, pickupAt: '2026-12-11T08:00', pax: 4 }).find((c) => c.group.vehicleGroup === 'G').unusable, true);
check('the first usable choice is the smallest car that seats the party', choices[0].group.vehicleGroup, 'C');
check('unusable groups are listed last, with their reason', choices.filter((c) => c.unusable).map((c) => c.group.vehicleGroup), ['D', 'H']);
check('a hire with no party size has no capacity refusal', carRentalGroupChoices(item, { days: 1, pickupAt: '2026-12-11T08:00', pax: 0 }).find((c) => c.group.vehicleGroup === 'A').capacityError, null);
check('the choice carries the season it priced from', byGroup('C').season.windowLabel, '2026-11-01 → 2027-01-31');
check('a group on several tariffs still shows every one of them', byGroup('C').seasons.length, 2);
check('a dated tariff is the answer, not the open one on the same car', byGroup('A').price.dailyRate, 520);
check('only car rental categories are hires', [isCarRentalItem(item), isCarRentalItem({ category: 'Transfers' }), isCarRentalItem({ category: 'Fees & Tickets' })], [true, false, false]);

/* 3b. The same contract on another date is other money, and a date the contract
   does not sell at all is a refusal the dialog has to carry. */
const juneChoices = carRentalGroupChoices(item, { days: 1, pickupAt: '2027-06-10T08:00', pax: 4 });
check('the winter tariff prices the same car at 990 a day', juneChoices.find((c) => c.group.vehicleGroup === 'C').price.dailyRate, 990);
check('and the line total is that hire plus the same fee', juneChoices.find((c) => c.group.vehicleGroup === 'C').price.total, 1175);
check('a June pick-up falls off the economy car\'s dated tariff onto its open one', juneChoices.find((c) => c.group.vehicleGroup === 'A').price.dailyRate, 600);
check('the winter season refuses a ten-day hire rather than borrow a band', carRentalGroupChoices(item, { days: 10, pickupAt: '2027-06-10T08:00', pax: 4 }).find((c) => c.group.vehicleGroup === 'C').error, '10 rental days is longer than any band on C · Toyota Corolla Quest or similar (2027-06-01 → 2027-06-30) — the longest is 1–6 days. Hire a second car or price the longer band in Library Items.');
check('the dialog says which tariff each group was priced off', carRentalGroupChoices(item, { days: 3, pickupAt: '2027-06-10T08:00', pax: 4 }).find((c) => c.group.vehicleGroup === 'C').season.windowLabel, '2027-06-01 → 2027-06-30');
const marchChoices = carRentalGroupChoices(item, { days: 1, pickupAt: '2027-03-05T08:00', pax: 4 });
check('a car collected between two seasons is unusable', marchChoices.find((c) => c.group.vehicleGroup === 'C').unusable, true);
check('and the refusal names the windows it looked in', /its seasons are/.test(marchChoices.find((c) => c.group.vehicleGroup === 'C').validity), true);

/* 4. The snapshot the line stores, and the money a later reader takes off it. */
const details = buildRentalDetails({
  item,
  group: byGroup('C').group,
  season: byGroup('C').season,
  band: byGroup('C').band,
  days: 1,
  pickupAt: '2026-12-11T08:00',
  returnAt: '2026-12-12T08:05',
  pickupLocation: 'Cape Town International',
  returnLocation: 'Cape Town International',
  sameReturn: true,
  contractFee: 185
});
check('the re-counted block total is what the day was late by', rentalDayCount(details.pickupAt, '2026-12-12T08:05'), 2);
check('the snapshot carries the liability wording', details.contractType, 'Classic Max (CM)');
check('the snapshot carries the group, model and specs', [details.vehicleGroup, details.vehicleModel, details.gear, details.passengers, details.doors, details.luggage, details.aircon, details.fuelType], ['C', 'Toyota Corolla Quest or similar', 'automatic', 4, 4, 2, true, 'fuel']);
check('the snapshot names the band it priced from', details.seasonName, '1–6 days');
check('the snapshot keeps the tariff window it was priced in', [details.validityFrom, details.validityTo], ['2026-11-01', '2027-01-31']);
check('the snapshot prints the window as the contract writes it', details.seasonWindow, '2026-11-01 → 2027-01-31');
check('the snapshot says how many tariffs the car is sold across', details.seasonCount, 2);
check('same return copies the pick-up', [details.returnLocation, details.sameReturn], ['Cape Town International', true]);
check('one day plus the fee', [details.hireTotal, details.total], [850, 1035]);
check('the line charges the whole hire', carRentalBuyTotal(details), 1035);
check('a snapshot without a stored total re-derives the same money', carRentalBuyTotal({ ...details, total: null }), 1035);
check('the hire reads back the way the desk says it', rentalSummaryLabel(details), 'Group C · Toyota Corolla Quest or similar — 2026-12-11 08:00 → 2026-12-12 08:05 — 1 × 24h day');
check('the vehicle label leads with the contract type', rentalVehicleLabel(details), 'Classic Max (CM) — Group C · Toyota Corolla Quest or similar');

/* 4b. A winter hire keeps the winter window on its own snapshot, so a later
   reader can see which tariff the money came from. */
const winterChoice = carRentalGroupChoices(item, { days: 2, pickupAt: '2027-06-10T08:00', pax: 4 }).find((c) => c.group.vehicleGroup === 'C');
const winterDetails = buildRentalDetails({
  item,
  group: winterChoice.group,
  season: winterChoice.season,
  band: winterChoice.band,
  days: 2,
  pickupAt: '2027-06-10T08:00',
  returnAt: '2027-06-12T08:00',
  pickupLocation: 'Cape Town International',
  returnLocation: 'Cape Town International',
  sameReturn: true,
  contractFee: 185
});
check('the winter snapshot prices two blocks off the winter band', [winterDetails.dailyRate, winterDetails.total], [990, 2165]);
check('the winter snapshot stamps the winter window', [winterDetails.validityFrom, winterDetails.validityTo, winterDetails.seasonWindow], ['2027-06-01', '2027-06-30', '2027-06-01 → 2027-06-30']);
const winterRate = rentalPackageRate(winterDetails, 'ZAR');
check('and the rate copy the package locks carries the same window', [winterRate.valid_from, winterRate.valid_to], ['2027-06-01', '2027-06-30']);
check('the winter package rate is the winter car, not the summer one', winterRate.unit_cost, 1980);
const winterFeeRate = rentalPackageRate(rentalFeeDetails(winterDetails), 'ZAR');
check('and the paperwork has its own rate copy at the fee', [winterFeeRate.unit_cost, winterFeeRate.rate_basis], [185, 'per_trip']);

/* 5. The spec grid the operator asked for: six icons over six answers, and the
   letters the hire trade writes under them. */
check('gear is one letter', carSpecValue(details, 'gear'), 'A');
check('fuel is read from fuelType', carSpecValue(details, 'fuel'), 'F');
check('electric reads as E', carSpecValue({ fuelType: 'electric' }, 'fuel'), 'E');
check('aircon is a tick', carSpecValue(details, 'aircon'), 'tick');
check('no aircon is a cross', carSpecValue({ aircon: false }, 'aircon'), 'cross');
check('seats and bags are numbers', [carSpecValue(details, 'passengers'), carSpecValue(details, 'luggage'), carSpecValue(details, 'doors')], ['4', '2', '4']);
const grid = carSpecGridHtml(details);
check('the printed grid is exactly two rows', (grid.match(/<tr>/g) || []).length, 2);
check('the printed grid is exactly six columns per row', (grid.match(/<td /g) || []).length, 12);
check('the printed grid draws six icons and the aircon tick it answers with', (grid.match(/<svg /g) || []).length, 7);
check('an electric hire prints the bolt in place of the pump', (carSpecGridHtml({ ...details, fuelType: 'electric' }).match(/M4 14a1 1 0 0 1/g) || []).length, 1);

/* 6. The repricers must leave a hire alone: its money came from the band and the
   block count, not from a season the trip happens to sit in. The pair the builder
   makes — the car on one line and the paperwork on the next — both re-split from
   their own rental copies, so neither picks up the other's figure. */
const rentalLine = {
  key: 't1',
  itemId: 'car-1',
  name: item.name,
  category: 'Car Rental',
  currencyCode: 'ZAR',
  basis: 'per_trip',
  buyPP: 283.33,
  markup: 20,
  sellPP: 340,
  pax: 3,
  quantity: 1,
  item_rates: [],
  rental: details
};
const contractFeeLine = {
  ...rentalLine,
  key: 't2',
  name: rentalFeeLineLabel(details),
  buyPP: 61.67,
  sellPP: 74,
  rental: rentalFeeDetails(details)
};
const days = [{ key: 'd1', dayNumber: 1, date: '2026-12-11', services: [rentalLine, contractFeeLine] }];

const grown = repriceServicesForPax({ days, libraryItems: [item], paxCount: 6, travelWindow: { start: '2026-12-11', end: '2026-12-12' } });
check('a bigger party re-splits the car over the car\'s own money', grown.days[0].services[0].buyPP, 141.67);
check('and carries the markup across', grown.days[0].services[0].sellPP, 170);
check('the fee line re-splits over the fee, not the hire', grown.days[0].services[1].buyPP, 30.83);
check('without reporting either line as unpriceable', grown.skipped, []);
check('the pair re-split still comes to the contract', money((grown.days[0].services[0].buyPP + grown.days[0].services[1].buyPP) * 6), 1035);
check('the hire line still names the whole contract it came from', carRentalBuyTotal(grown.days[0].services[0].rental), 1035);

const moved = revalidateServicesForWindow({
  days,
  libraryItems: [item],
  paxCount: 3,
  travelWindow: { start: '2027-04-01', end: '2027-04-05' }
});
check('moving the trip does not re-count the hire', moved.days[0].services[0].buyPP, 283.33);
check('nor re-counts its contract fee', moved.days[0].services[1].buyPP, 61.67);
check('nor flags it as a season problem', moved.issues, []);

/* 7. The same hire inside a package. A package prices every line off its locked
     snapshot and re-checks that snapshot against the package's own validity dates,
     so a hire needs a rate-shaped copy of its contract — and it has to answer the
     date question itself, because a hire tariff is never a season. The package
     below is sold for the Nov–Oct year, which this tariff plainly does not span. */
const packagePeriods = [{ valid_from: '2026-11-01', valid_to: '2027-10-31' }];
const hireRate = rentalPackageRate(details, 'ZAR');
check('the hire snapshot holds the car for all its days', [hireRate.rate_basis, hireRate.unit_cost, hireRate.unit_price], ['per_trip', 850, 850]);
const feeRate = rentalPackageRate(rentalFeeDetails(details), 'ZAR');
check('and the contract fee arrives as a snapshot of its own', [feeRate.rate_basis, feeRate.unit_cost], ['per_trip', 185]);
check('two lines, one contract', feeRate.unit_cost + hireRate.unit_cost, carRentalBuyTotal(details));
check('the hire snapshot carries the seats the band engine needs', hireRate.max_occupancy, 4);
check('the hire snapshot names the band it priced from', hireRate.season_name, 'Hire 1–6 days');
check('the hire snapshot keeps its own tariff window', [hireRate.valid_from, hireRate.valid_to], ['2026-11-01', '2027-01-31']);
check('a hire is settled against package dates its tariff does not span', packageSeasonCoverage(item, hireRate, packagePeriods), { status: 'ok', ok: true, message: '' });
check('the same line without the hire stamp is refused', packageSeasonCoverage(item, { ...hireRate, rental_price_validity: false }, packagePeriods).status, 'missing');
const hireResolution = packageSeasonResolution({ item, rate: hireRate, periods: packagePeriods, currencyCode: 'ZAR', protectionPercent: 10 });
check('protection never stands in for a hire season', [hireResolution.status, hireResolution.ok, hireResolution.canAdd, hireResolution.protectionPercent], ['ok', true, true, 0]);
check('and prices nothing but the contract figure the hire came to', hireResolution.rate, hireRate);

const hireLine = {
  item_key: 'hire-1',
  item_id: 'car-1',
  item_name: item.name,
  category: 'Car Rental',
  currency_code: 'ZAR',
  rate_basis: 'per_trip',
  unit_cost: 850,
  unit_price: 850,
  quantity: 1,
  is_included: true,
  vehicle_capacity: 4,
  rental: details,
  rate_id: null,
  rate_snapshot: hireRate
};
check('a hire is transport, so the band engine can offer a smaller car', packageIsTransport(hireLine, [item]), true);

const hirePrice = calculatePackageTravellerBreakdown({
  days: [{ day_number: 1, services: [hireLine] }],
  pattern: { pax: 4 },
  library: [item]
});
check('four travellers divide the hire as they divide a bus', [hirePrice.pax, hirePrice.unitPerPerson, hirePrice.unitTotal], [4, 212.5, 850]);
check('the party divides the car; the fee is another line', hirePrice.partyTotal, 850);
check('and the hire is not blocked for want of a season', [hirePrice.servable, hirePrice.blockedVehicleReasons], [true, []]);
const hireSell = calculatePackageTravellerBreakdown({
  days: [{ day_number: 1, services: [hireLine] }],
  pattern: { pax: 4 },
  library: [item],
  markupPercent: 20
});
check('the partner markup rides on the divided share', [hireSell.sell.unitPerPerson, hireSell.sell.partyTotal], [255, 1020]);
const twoCars = calculatePackageTravellerBreakdown({
  days: [{ day_number: 1, services: [{ ...hireLine, quantity: 2 }] }],
  pattern: { pax: 4 },
  library: [item]
});
check('a second vehicle doubles the party share, not the band', [twoCars.unitPerPerson, twoCars.partyTotal], [425, 1700]);

/* 8. A hire created on an itinerary crosses into a package line by line. The car
     is the per-head share of its 24-hour block, the paperwork fee is the fee line,
     and the package needs both whole. */
const crossedFee = rentalFeeDetails(details);
const itineraryDays = [{
  key: 'd1',
  dayNumber: 1,
  date: '2026-12-11',
  notes: 'Pick up the hire car',
  services: [{
    key: 't1',
    itemId: 'car-1',
    name: item.name,
    category: 'Car Rental',
    currencyCode: 'ZAR',
    basis: 'per_trip',
    buyPP: 283.33,
    sellPP: 340,
    pax: 3,
    quantity: 1,
    item_rates: [],
    rental: rentalDayDetails(details, rentalDayShares(details)[0])
  }, {
    key: 't2',
    itemId: 'car-1',
    name: rentalFeeLineLabel(crossedFee),
    category: 'Car Rental',
    currencyCode: 'ZAR',
    basis: 'per_trip',
    buyPP: 61.67,
    sellPP: 74,
    pax: 3,
    quantity: 1,
    item_rates: [],
    rental: crossedFee
  }]
}];
const built = buildItineraryPackage({
  meta: { itineraryName: 'Cape Town Self Drive', numAdults: 3 },
  days: itineraryDays,
  libraryItems: [item],
  fallbackPax: 3,
  travelWindow: { start: packagePeriods[0].valid_from, end: packagePeriods[0].valid_to },
  currencyCode: 'ZAR'
});
const crossed = built.days[0].items[0];
const crossedFeeLine = built.days[0].items[1];
check('the car crosses over as the vehicle, not the head', [crossed.rate_basis, crossed.unit_cost, crossed.quantity], ['per_trip', 850, 1]);
check('a hire never references an item_rates row', crossed.rate_id, null);
check('the crossing keeps the seats', crossed.vehicle_capacity, 4);
check('the crossing keeps the liability wording', crossed.rental.contractType, 'Classic Max (CM)');
check('the crossing locks the snapshot the package prices from', crossed.rate_snapshot.unit_cost, 850);
check('and the fee arrives as a line naming the paperwork', [crossedFeeLine.item_name, crossedFeeLine.unit_cost, crossedFeeLine.rate_snapshot.unit_cost], [rentalFeeLineLabel(crossedFee), 185, 185]);
check('which never claims a day of the hire', crossedFeeLine.rental.dayShare, null);
check('the crossed hire passes the package save guard', packageSeasonCoverage(item, crossed.rate_snapshot, built.validity_periods), { status: 'ok', ok: true, message: '' });
const crossedPrice = calculatePackageTravellerBreakdown({
  days: [{ day_number: 1, services: [crossed, crossedFeeLine] }],
  pattern: { pax: 3 },
  library: [item]
});
check('car and fee together recover exactly the contract', crossedPrice.partyTotal, carRentalBuyTotal(details));

/* 9. The hire on the day-by-day: one line for every whole 24-hour block, each
     carrying its own block's money. The contract does not change — the spread only
     decides which day pays for which day of the car — and the paperwork fee is not
     a day of the hire, so it cannot hide inside one. */
const threeBlocks = buildRentalDetails({
  item,
  group: byGroup('C').group,
  season: byGroup('C').season,
  band: byGroup('C').band,
  days: 3,
  pickupAt: '2026-12-11T08:00',
  returnAt: '2026-12-14T08:00',
  pickupLocation: 'Cape Town International',
  returnLocation: 'Cape Town International',
  sameReturn: true,
  contractFee: 185
});
const shares = rentalDayShares(threeBlocks);
check('a three-block hire is three lines on the trip', shares.map((share) => share.buyTotal), [850, 850, 850]);
check('no share carries the contract fee', shares.every((share) => !share.contractFee), true);
check('every share knows its place in the hire', shares.map((share) => `${share.ordinal}/${share.dayCount}`), ['1/3', '2/3', '3/3']);
check('the days add back up to the car', shares.reduce((sum, share) => sum + share.buyTotal, 0), carRentalHireTotal(threeBlocks));
check('a hire with no blocks answered places nothing', rentalDayShares({ ...threeBlocks, rentalDays: 0 }), []);
const secondDayRental = rentalDayDetails(threeBlocks, shares[1]);
check('a day line bills its own block', rentalLineBuyTotal(secondDayRental), 850);
check('while its copy still describes the whole contract', carRentalBuyTotal(secondDayRental), 2735);
check('and a copy with no day stamp bills the car for all its days', rentalLineBuyTotal(threeBlocks), 2550);
check('the day share survives the save because it rides inside the copy', secondDayRental.dayShare.buyTotal, 850);
const spreadLine = { ...rentalLine, key: 't2', buyPP: 141.67, sellPP: 170, rental: secondDayRental };
const regrown = repriceServicesForPax({
  days: [{ key: 'd2', dayNumber: 2, date: '2026-12-12', services: [spreadLine] }],
  libraryItems: [item],
  paxCount: 6,
  travelWindow: { start: '2026-12-11', end: '2026-12-14' }
});
check('a bigger party re-splits that day, not the whole hire', [regrown.days[0].services[0].buyPP, regrown.days[0].services[0].pax], [141.67, 6]);
check('and the day still answers for its own block', regrown.days[0].services[0].rental.dayShare.buyTotal, 850);
const spreadItineraryDays = ['2026-12-11', '2026-12-12', '2026-12-13'].map((date, index) => ({
  key: `d${index}`,
  dayNumber: index + 1,
  date,
  services: [{
    ...rentalLine,
    key: `spread${index}`,
    buyPP: shares[index].buyTotal / 3,
    rental: rentalDayDetails(threeBlocks, shares[index]),
    repeatGroupId: 'hire-1'
  }]
}));
const spreadBuilt = buildItineraryPackage({
  meta: { itineraryName: 'Garden Route Self Drive', numAdults: 3 },
  days: spreadItineraryDays,
  libraryItems: [item],
  fallbackPax: 3,
  travelWindow: { start: '2026-12-11', end: '2026-12-13' },
  currencyCode: 'ZAR'
});
check('each day crosses into the package as its own block', spreadBuilt.days.map((day) => day.items.map((row) => row.unit_cost)), [[850], [850], [850]]);
check('the package recovers exactly what the car costs', spreadBuilt.days.reduce((sum, day) => sum + day.items[0].unit_cost, 0), 2550);
check('a crossed day keeps the contract it belongs to', spreadBuilt.days[1].items[0].rental.rentalDays, 3);
check('and knows which day of it it is', spreadBuilt.days[1].items[0].rental.dayShare.ordinal, 2);

/* 10. Laying a hire onto the trip when it is dropped: a line for every 24-hour
     cycle, on the day it is billed. A hire dropped late in the trip but long
     enough to reach back starts earlier rather than stacking its cycles onto the
     drop day — the day the car was dropped on is not the day it left the yard.
     Re-recording answers for one day at a time (the consultant's control), so the
     placement never moves a hire's existing lines; only a hire longer than the
     whole trip has nowhere to go, and the last day bills what will not fit. */
const placedOn = (entry) => `${entry.dayIndex}:${entry.share.buyTotal}`;
const addThree = rentalDayPlacement({ details: threeBlocks, startDayIndex: 0, itineraryDays: 5 });
check('a three-block hire collected on day one covers days one to three', addThree.lines.map(placedOn), ['0:850', '1:850', '2:850']);
check('and nothing is carried over', addThree.carried, 0);
check('each line is stamped with the day of the contract it bills', addThree.lines.map((line) => line.share.ordinal), [1, 2, 3]);
const lateHire = rentalDayPlacement({ details: threeBlocks, startDayIndex: 4, itineraryDays: 5 });
check('a three-cycle hire dropped on the last day of a five-day trip takes three days', lateHire.lines.map(placedOn), ['2:850', '3:850', '4:850']);
check('so no cycle is stacked on another', lateHire.carried, 0);
const nineOnTen = rentalDayPlacement({
  details: { ...threeBlocks, rentalDays: 9, dailyRate: 772, hireTotal: 6948, total: 7133 },
  startDayIndex: 9,
  itineraryDays: 10
});
check('the hire from the screenshot is nine lines on a ten-day trip', nineOnTen.lines.length, 9);
check('one cycle per day, ending on the day it was dropped on', nineOnTen.lines.map((line) => line.dayIndex), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
check('and the nine lines are the whole car', nineOnTen.lines.reduce((sum, line) => sum + line.share.buyTotal, 0), 6948);
const longerThanTheTrip = rentalDayPlacement({ details: { ...threeBlocks, rentalDays: 5 }, startDayIndex: 4, itineraryDays: 3 });
check('a hire longer than the trip is billed on every day it has', longerThanTheTrip.lines.map(placedOn), ['0:850', '1:850', '2:2550']);
check('with the cycles that will not fit named', [longerThanTheTrip.carried, longerThanTheTrip.lines[2].share.blocks], [2, 3]);
check('a trip with no days has nothing to lay a hire on', rentalDayPlacement({ details: threeBlocks, startDayIndex: 0, itineraryDays: 0 }).reason, 'This hire is collected after the itinerary\'s last day, so it has no day to sit on.');
check('a hire with no dates answered places nothing and says why', rentalDayPlacement({ details: { ...threeBlocks, rentalDays: 0 }, itineraryDays: 5 }).reason, 'Set a pick-up and return date and time to place the hire.');
const oneBlock = { ...threeBlocks, rentalDays: 1, hireTotal: 850, total: 1035 };
check('a one-block hire is one line for the car', rentalDayPlacement({ details: oneBlock, startDayIndex: 1, itineraryDays: 5 }).lines.map(placedOn), ['1:850']);

/* 10b. Which day the car leaves the yard. The pick-up stamp answers when the trip
     is dated; a trip held as a month has no day dates, so its stored travel start
     counts the days; and neither anchor leaves the day it was dropped on. */
const datedTrip = [{ date: '2026-12-09' }, { date: '2026-12-10' }, { date: '2026-12-11' }, { date: '2026-12-12' }];
check('a dated trip starts the hire on the day it is collected', rentalCollectionDayIndex({ details: threeBlocks, days: datedTrip, fallbackDayIndex: 3 }), 2);
check('a car collected late in the afternoon still leaves that day', rentalCollectionDayIndex({ details: { ...threeBlocks, pickupAt: '2026-12-10T17:00' }, days: datedTrip, fallbackDayIndex: 3 }), 1);
check('a car collected before the trip begins is in hand on day one', rentalCollectionDayIndex({ details: { ...threeBlocks, pickupAt: '2026-12-05T08:00' }, days: datedTrip, fallbackDayIndex: 3 }), 0);
check('a car collected after the trip ends keeps the day it was dropped on', rentalCollectionDayIndex({ details: { ...threeBlocks, pickupAt: '2026-12-30T08:00' }, days: datedTrip, fallbackDayIndex: 1 }), 1);
const monthTrip = [{ date: '' }, { date: '' }, { date: '' }];
check('a month-timed trip counts the hire from its travel start', rentalCollectionDayIndex({ details: threeBlocks, days: monthTrip, travelStart: '2026-12-11' }), 0);
check('a hire collected two days after the start is on that day', rentalCollectionDayIndex({ details: { ...threeBlocks, pickupAt: '2026-12-13T08:00' }, days: monthTrip, travelStart: '2026-12-11' }), 2);
check('a pick-up before the stored start is day one', rentalCollectionDayIndex({ details: { ...threeBlocks, pickupAt: '2026-12-05T08:00' }, days: monthTrip, travelStart: '2026-12-11' }), 0);
check('a hire past the end of a short trip is its last day', rentalCollectionDayIndex({ details: { ...threeBlocks, pickupAt: '2026-12-30T08:00' }, days: monthTrip, travelStart: '2026-12-11' }), 2);
check('a trip with no dates and no start keeps the drop day', rentalCollectionDayIndex({ details: threeBlocks, days: monthTrip, travelStart: '', fallbackDayIndex: 2 }), 2);
check('and a hire with no pick-up answered keeps it too', rentalCollectionDayIndex({ details: { ...threeBlocks, pickupAt: '' }, days: datedTrip, fallbackDayIndex: 3 }), 3);

/* 11. The contract fee as a line of its own. Clients ask what the agreement cost,
     so the paperwork charge is told separately rather than hidden inside the day
     the car was collected — and it keeps the hire around it, because it is still
     the same contract on the same car for the same window. */
const feeLine = rentalFeeDetails(threeBlocks);
check('the fee copy says it is only the fee', isRentalFeeLine(feeLine), true);
check('and bills the fee and nothing else', rentalLineBuyTotal(feeLine), 185);
check('it is not a day, so the placement never gives it a block', rentalDayShares(feeLine), []);
check('it keeps the car and the two ends it is charged for', [feeLine.vehicleGroup, feeLine.pickupAt, feeLine.returnAt], ['C', '2026-12-11T08:00', '2026-12-14T08:00']);
check('and names itself after the car it belongs to', rentalFeeLineLabel(feeLine), 'Rental contract fee — Group C · Toyota Corolla Quest or similar');
check('a contract that charges no fee has no fee line', rentalFeeDetails({ ...threeBlocks, contractFee: 0 }), null);
check('the days and the fee together are the contract', shares.reduce((sum, share) => sum + share.buyTotal, 0) + rentalLineBuyTotal(feeLine), carRentalBuyTotal(threeBlocks));
const feeRepriced = repriceServicesForPax({
  days: [{ key: 'd1', dayNumber: 1, date: '2026-12-11', services: [{ ...rentalLine, key: 'f1', buyPP: 61.67, sellPP: 74, pax: 3, rental: feeLine }] }],
  libraryItems: [item],
  paxCount: 6,
  travelWindow: { start: '2026-12-11', end: '2026-12-14' }
});
check('a bigger party re-shares the fee line', feeRepriced.days[0].services[0].buyPP, 30.83);
check('without turning it back into a day of the hire', feeRepriced.days[0].services[0].rental.contractFeeOnly, true);

/* 12. The vehicle's six facts inside the documents. One hire is one car however
   many 24-hour blocks bill it, so the grid is drawn once — on the block the car is
   collected — and never on the paperwork line. A document that prints draws the
   icons; a document that is text writes them out, because an email cannot draw a
   gear. */
check('a hire carried whole prints the grid: it is the only copy the document has', rentalPrintsSpecGrid(threeBlocks), true);
check('the block the car is collected on prints it', rentalPrintsSpecGrid(rentalDayDetails(threeBlocks, shares[0])), true);
check('the second day of the same car does not', rentalPrintsSpecGrid(rentalDayDetails(threeBlocks, shares[1])), false);
check('nor does the last', rentalPrintsSpecGrid(rentalDayDetails(threeBlocks, shares[2])), false);
check('the contract fee is not a day of the hire, so it names no vehicle', rentalPrintsSpecGrid(feeLine), false);
check('and a line with no hire on it prints nothing', [rentalPrintsSpecGrid(null), rentalPrintsSpecGrid(undefined)], [false, false]);
check('the written spec line carries all six facts', carSpecText(threeBlocks), 'Vehicle specs — Gearbox: A · Luggage capacity: 2 · Doors: 4 · Passengers: 4 · Air conditioning: Yes · Fuel or electric: F');
check('an electric hire is written as electric', carSpecText({ ...threeBlocks, fuelType: 'electric' }).endsWith('Fuel or electric: E'), true);
const hireVoucher = voucherDetailLines({ category: 'Car Rental', item_name: 'Hire', rental: threeBlocks });
check('the emailed voucher tells the car, the window, the length and the yards', hireVoucher, [
  'Confirmation Status: OK',
  'Vehicle type: Classic Max (CM) — Group C · Toyota Corolla Quest or similar',
  'Collected / returned: 2026-12-11 08:00 → 2026-12-14 08:00',
  'Length of hire: 3 × 24h days',
  'Pick up location: Cape Town International',
  'Return location: Cape Town International',
  'Mileage: 400 km included',
  'Vehicle specs — Gearbox: A · Luggage capacity: 2 · Doors: 4 · Passengers: 4 · Air conditioning: Yes · Fuel or electric: F'
]);
check('an unlimited hire says so instead of counting', voucherDetailLines({ category: 'Car Rental', rental: { ...threeBlocks, kmsUnlimited: true } }).includes('Mileage: Unlimited km'), true);
check('the printed voucher drops the words because it draws the grid', voucherDetailLines({ category: 'Car Rental', rental: threeBlocks }, { specs: false }).some((line) => line.startsWith('Vehicle specs')), false);
check('and the grid it draws is still six icons over six answers', (carSpecGridHtml(threeBlocks).match(/<svg /g) || []).length, 7);
check('a middle block says which block of the hire it is', voucherDetailLines({ category: 'Car Rental', rental: rentalDayDetails(threeBlocks, shares[1]) }).includes('Billing block: 2 of 3'), true);
check('the fee line answers for the paperwork alone', voucherDetailLines({ category: 'Car Rental', rental: feeLine }), [
  'Confirmation Status: OK',
  'Vehicle type: Classic Max (CM) — Group C · Toyota Corolla Quest or similar',
  'Contract fee for the hire agreement above'
]);
check('a capped hire states the kilometres it includes', voucherDetailLines({ category: 'Car Rental', rental: { ...threeBlocks, kmsUnlimited: false, kmsIncluded: 350 } }).includes('Mileage: 350 km included'), true);
check('a transfer keeps its own voucher details', voucherDetailLines({ category: 'Transfers', time: '06:30', vehicleType: 'Sedan', capacity: 3 }), [
  'Confirmation Status: OK',
  'Pick up time: 06:30',
  'Vehicle type: Sedan',
  'Capacity: 3'
]);

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
