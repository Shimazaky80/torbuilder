import { detailDocumentHtml, libraryItemDetail, libraryItemKind } from '../src/lib/libraryItemDetail.js';
import { SURCHARGE_CATEGORY } from '../src/lib/surchargeFees.js';

const check = (label, actual, expected) => {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  if (!passed) process.exitCode = 1;
};

const rowsOf = (card, key) => {
  const section = card.sections.find((entry) => entry.key === key);
  return section ? section.rows.map((row) => [row.label, row.value]) : [];
};
const sectionOf = (card, key) => card.sections.find((entry) => entry.key === key) || null;
const labelsOf = (card) => card.sections.flatMap((section) => section.rows.map((row) => row.label));
const money = (value) => `ZAR ${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const band = (id, name, ageFrom, ageTo) => ({ id, name, ageFrom, ageTo });

/* (A) Guide */
const guide = {
  name: 'Mountain guide',
  category: 'Guide',
  currency: 'ZAR',
  max_occupancy: 2,
  max_adults: 2,
  child_age_ranges: [band('child', 'Child', 0, 12)],
  item_rates: [{
    id: 'g1', season_name: 'High season', valid_from: '2026-01-01', valid_to: '2026-03-31',
    rate_basis: 'per_trip', guide_transfer_rate: 500, guide_full_day_rate: 1200
  }]
};
const guideDetail = libraryItemDetail({ item: guide });
check('guide kind', guideDetail.kind, 'guide');
check('guide hides occupancy and child tiers', guideDetail.facts, []);
check('guide prices print per service', rowsOf(guideDetail.seasons[0], 'prices'), [
  ['Transfer', money(500)],
  ['Full day', money(1200)]
]);
check('guide prices are noted as shared', sectionOf(guideDetail.seasons[0], 'prices').note, 'Per trip, shared among travellers.');
check('guide never prints the room labels', labelsOf(guideDetail.seasons[0]).includes('1 adult (single)'), false);

/* (B) Transfers */
const transferChildBand = band('child', 'Child (up to 12 yrs)', 0, 12);
const perVehicleTransfer = {
  name: 'Airport transfer',
  category: 'Transfers',
  currency: 'ZAR',
  pricing_model: 'per_vehicle',
  max_occupancy: 4,
  max_adults: 4,
  child_age_ranges: [transferChildBand],
  item_rates: [{
    id: 't1', rate_basis: 'per_vehicle', unit_price: 1400, price_1_adult: 1400,
    prices_by_vehicle: { sedan: 1400, van: 2100 }, child_rates_breakdown: { child: 700 }
  }]
};
const vehicleDetail = libraryItemDetail({ item: perVehicleTransfer, vehicleTypes: [{ code: 'sedan', name: 'Sedan' }] });
check('transfer hides capacity and child tiers', vehicleDetail.facts, []);
check('per-vehicle transfer prints per unit', rowsOf(vehicleDetail.seasons[0], 'prices'), [
  ['Sedan', `${money(1400)} / unit`],
  ['van', `${money(2100)} / unit`]
]);
check('per-vehicle transfer never says "1 adult"', labelsOf(vehicleDetail.seasons[0]).includes('1 adult (single)'), false);

const flaggedTransfer = {
  category: 'Transfers',
  currency: 'ZAR',
  pricing_model: 'per_vehicle',
  item_rates: [{
    id: 't5', rate_basis: 'per_vehicle',
    prices_by_vehicle: { sedan: 1400, van: { free: true }, bus: { na: true }, boat: {} }
  }]
};
check('flagged vehicle cells print Free / n/a and leave unpriced codes off', rowsOf(libraryItemDetail({ item: flaggedTransfer }).seasons[0], 'prices'), [
  ['sedan', `${money(1400)} / unit`],
  ['van', 'Free / unit'],
  ['bus', 'n/a / unit']
]);

const flatTransfer = {
  category: 'Transfers',
  currency: 'ZAR',
  pricing_model: 'per_vehicle',
  item_rates: [{ id: 't2', rate_basis: 'per_vehicle', unit_price: 1400, price_1_adult: 1400 }]
};
const flatDetail = libraryItemDetail({ item: flatTransfer });
check('flat transfer prints "Per unit"', rowsOf(flatDetail.seasons[0], 'prices'), [['Per unit', money(1400)]]);

const perPersonTransfer = {
  category: 'Transfers',
  currency: 'ZAR',
  pricing_model: 'per_person',
  child_age_ranges: [transferChildBand],
  item_rates: [{ id: 't3', rate_basis: 'per_person', price_1_adult: 650, unit_price: 650, child_rates_breakdown: { child: 300 } }]
};
const perPersonDetail = libraryItemDetail({ item: perPersonTransfer });
check('per-person transfer prints "Per person"', rowsOf(perPersonDetail.seasons[0], 'prices'), [['Per person', money(650)]]);
check('per-person transfer prints the loaded child rate', rowsOf(perPersonDetail.seasons[0], 'child'), [[`Child rate (0\u201312 yrs)`, money(300)]]);
check('child section is titled "Child rate"', sectionOf(perPersonDetail.seasons[0], 'child').title, 'Child rate');

const tieredTransfer = {
  category: 'Transfers',
  currency: 'ZAR',
  pricing_model: 'tiered',
  item_rates: [{
    id: 't4', rate_basis: 'tiered',
    tiered_pricing: [{ min_pax: 1, max_pax: 3, rate: 2500 }, { min_pax: 4, max_pax: 6, rate: 3200 }]
  }]
};
const tieredDetail = libraryItemDetail({ item: tieredTransfer });
check('tiered transfer prints each pax tier per unit', rowsOf(tieredDetail.seasons[0], 'prices'), [
  [`1\u20133 pax`, `${money(2500)} / unit`],
  [`4\u20136 pax`, `${money(3200)} / unit`]
]);

/* Meals */
const meals = {
  name: 'Lunch',
  category: 'Meals',
  currency: 'ZAR',
  meal_type: 'Lunch',
  menu_type: 'buffet',
  meal_gratuity_percent: 10,
  max_occupancy: 2,
  max_adults: 2,
  child_age_ranges: [transferChildBand],
  item_rates: [{ id: 'm1', rate_basis: 'per_person', price_1_adult: 250, unit_price: 250, child_rates_breakdown: { child: 125 } }]
};
const mealsDetail = libraryItemDetail({ item: meals });
check('meals keep the meal facts, not the room facts', mealsDetail.facts, [
  { label: 'Meal', value: 'Lunch' },
  { label: 'Menu', value: 'Buffet' },
  { label: 'Gratuity', value: '10%' }
]);
check('meals print "Per person"', rowsOf(mealsDetail.seasons[0], 'prices'), [['Per person', money(250)]]);
check('meals child section is "Child rate"', sectionOf(mealsDetail.seasons[0], 'child').title, 'Child rate');
check('meals child rate prints as loaded', rowsOf(mealsDetail.seasons[0], 'child'), [[`Child rate (0\u201312 yrs)`, money(125)]]);

/* Activities / Tours */
const activities = {
  category: 'Activities / Tours',
  currency: 'ZAR',
  max_occupancy: 14,
  max_adults: 14,
  child_age_ranges: [band('child', 'Child (up to 11 yrs)', 0, 11)],
  item_rates: [{ id: 'a1', rate_basis: 'per_person', price_1_adult: 900, child_rates_breakdown: { child: 450 } }]
};
const activitiesDetail = libraryItemDetail({ item: activities });
check('activities hide capacity and tiers', activitiesDetail.facts, []);
check('activities print "Per person"', rowsOf(activitiesDetail.seasons[0], 'prices'), [['Per person', money(900)]]);
check('activities child section is "Child rate"', sectionOf(activitiesDetail.seasons[0], 'child').title, 'Child rate');

/* Tickets */
const tickets = {
  category: 'Tickets',
  currency: 'ZAR',
  ticket_type: 'both',
  max_occupancy: 14,
  max_adults: 14,
  child_age_ranges: [band('inf', 'Infants', 0, 2), band('ch', 'Children', 3, 11)],
  item_rates: [{
    id: 'k1', rate_basis: 'per_person', price_1_adult: 500, fast_track_adult_rate: 750,
    child_rates_breakdown: { inf: 0, ch: 250 }, fast_track_child_rates_breakdown: { ch: 400 }
  }]
};
const ticketsDetail = libraryItemDetail({ item: tickets });
check('tickets keep only the ticket type fact', ticketsDetail.facts, [{ label: 'Ticket type', value: 'Standard + fast track' }]);
check('tickets print adult and fast track per person', rowsOf(ticketsDetail.seasons[0], 'prices'), [
  ['Per person', money(500)],
  ['Fast track (per person)', money(750)]
]);
check('tickets child bands print as loaded', rowsOf(ticketsDetail.seasons[0], 'child'), [[`Children (3\u201311 yrs)`, money(250)]]);
check('tickets fast track child rates print', rowsOf(ticketsDetail.seasons[0], 'fast-child'), [[`Children (3\u201311 yrs)`, money(400)]]);

/* Extras */
const extras = {
  category: 'Extras',
  currency: 'ZAR',
  child_age_ranges: [transferChildBand],
  item_rates: [{ id: 'e1', rate_basis: 'per_person', price_1_adult: 150, child_rates_breakdown: { child: 75 } }]
};
const extrasDetail = libraryItemDetail({ item: extras });
check('extras print per person and child rate', [
  rowsOf(extrasDetail.seasons[0], 'prices'),
  rowsOf(extrasDetail.seasons[0], 'child'),
  sectionOf(extrasDetail.seasons[0], 'child').title
], [
  [['Per person', money(150)]],
  [[`Child rate (0\u201312 yrs)`, money(75)]],
  'Child rate'
]);

/* Accommodation keeps its room facts and sharing labels */
const accommodation = {
  name: 'Lodge',
  category: 'Accommodation',
  currency: 'ZAR',
  max_occupancy: 2,
  max_adults: 2,
  meal_plan: 'Bed & Breakfast',
  child_age_ranges: [band('ch', 'Children', 3, 11)],
  guide_driver_room_offered: true,
  item_rates: [{
    id: 'r1', rate_basis: 'per_person_sharing',
    price_1_adult: 810, price_2_adults: 540, price_3_plus_adults: 480,
    single_supplement: 300, child_discount: 50, child_rates_breakdown: { ch: 330 },
    guide_rate: 400, driver_rate: 350
  }]
};
const accommodationDetail = libraryItemDetail({ item: accommodation });
check('accommodation keeps the room facts', accommodationDetail.facts.map((fact) => fact.label), [
  'Max occupancy', 'Max adults', 'Child age tiers', 'Default board'
]);
check('accommodation prints sharing labels', rowsOf(accommodationDetail.seasons[0], 'prices'), [
  ['1 adult (single)', money(810)],
  ['2 adults sharing (PPS)', money(540)],
  ['3+ adults (per person)', money(480)],
  ['Single supplement', money(300)],
  ['Child discount', '50%']
]);
check('accommodation child section stays "Child sharing rates"', sectionOf(accommodationDetail.seasons[0], 'child').title, 'Child sharing rates');
check('accommodation guide and driver rows', rowsOf(accommodationDetail.seasons[0], 'guide-driver'), [
  ['Guide', `${money(400)} \u00b7 Bed & Breakfast`],
  ['Driver', `${money(350)} \u00b7 Bed & Breakfast`]
]);

const flatRoom = {
  category: 'Accommodation',
  currency: 'ZAR',
  pricing_model: 'per_room',
  item_rates: [{ id: 'r2', rate_basis: 'per_room', unit_price: 1800, price_2_adults: 1800, single_room_rate: 1200, price_1_adult: 1200 }]
};
const flatRoomDetail = libraryItemDetail({ item: flatRoom });
check('flat room prints the room rate and single occupancy once', rowsOf(flatRoomDetail.seasons[0], 'prices'), [
  ['Room rate (per room)', money(1800)],
  ['Single occupancy (1 adult)', money(1200)]
]);

/* Trains */
const train = {
  category: 'Trains',
  currency: 'ZAR',
  pricing_model: 'per_room',
  train_cabin_name: 'Deluxe',
  train_journey_nights: 2,
  max_occupancy: 2,
  max_adults: 2,
  child_age_ranges: [transferChildBand],
  item_rates: [{ id: 'tr1', rate_basis: 'per_room', unit_price: 5000, child_rates_breakdown: { child: 2500 } }]
};
const trainDetail = libraryItemDetail({ item: train });
check('trains keep the cabin facts only', trainDetail.facts, [
  { label: 'Cabin', value: 'Deluxe' },
  { label: 'Journey', value: '2 nights' }
]);
check('flat train prints the cabin rate', rowsOf(trainDetail.seasons[0], 'prices'), [['Cabin rate (per cabin)', money(5000)]]);
check('train child section is "Child rate"', sectionOf(trainDetail.seasons[0], 'child').title, 'Child rate');

/* Flights / Charter */
const charter = {
  category: 'Flights / Charter',
  currency: 'ZAR',
  pricing_model: 'per_vehicle',
  departure_city: 'NBO',
  arrival_city: 'MBA',
  airline_name: 'Safarilink',
  flight_number: 'SL123',
  max_occupancy: 12,
  item_rates: [{ id: 'f1', rate_basis: 'per_vehicle', unit_price: 3000, price_1_adult: 3000 }]
};
const charterDetail = libraryItemDetail({ item: charter });
check('flights keep route facts, not capacity', charterDetail.facts, [
  { label: 'Route', value: 'NBO \u2192 MBA' },
  { label: 'Airline', value: 'Safarilink' },
  { label: 'Flight', value: 'SL123' }
]);
check('charter prints the whole-flight rate', rowsOf(charterDetail.seasons[0], 'prices'), [['Charter (per flight)', money(3000)]]);

const flightPerPerson = {
  category: 'Flights / Charter',
  currency: 'ZAR',
  pricing_model: 'per_person',
  item_rates: [{ id: 'f2', rate_basis: 'per_person', price_1_adult: 450, taxes_and_surcharges: 90 }]
};
const flightDetail = libraryItemDetail({ item: flightPerPerson });
check('per-person flight prints the fare and taxes', rowsOf(flightDetail.seasons[0], 'prices'), [
  ['Per person', money(450)],
  ['Taxes & surcharges', money(90)]
]);

/* Surcharge Fees */
const entranceFee = {
  category: SURCHARGE_CATEGORY,
  currency: 'ZAR',
  surcharge_type: 'entrance_fee',
  surcharge_charge_basis: 'per_night',
  surcharge_unit_basis: 'per_vehicle',
  surcharge_chargeable: false,
  max_occupancy: 2,
  item_rates: [{ id: 's1', entrance_fee_per_vehicle: 40 }]
};
const entranceDetail = libraryItemDetail({ item: entranceFee });
check('surcharge facts describe the fee, not a room', entranceDetail.facts, [
  { label: 'Fee type', value: 'Entrance Fees' },
  { label: 'Charged', value: 'Per Night' },
  { label: 'Rate is per', value: 'Per Vehicle' },
  { label: 'Chargeable', value: 'No \u2014 shown for reference' }
]);
check('per-vehicle entrance fee prints its column once', rowsOf(entranceDetail.seasons[0], 'prices'), [['Per vehicle', money(40)]]);

const levy = {
  category: SURCHARGE_CATEGORY,
  currency: 'ZAR',
  surcharge_type: 'conservation_levy',
  surcharge_charge_basis: 'once_off',
  surcharge_unit_basis: 'per_adult',
  item_rates: [{ id: 's2', conservation_levy_per_adult: 120, conservation_levy_per_child: 60 }]
};
const levyDetail = libraryItemDetail({ item: levy });
check('conservation levy prints adult and child figures', rowsOf(levyDetail.seasons[0], 'prices'), [
  ['Per adult', money(120)],
  ['Per child', money(60)]
]);

/* Car Rental */
const carRental = {
  name: 'Compact car',
  category: 'Car Rental',
  currency: 'ZAR',
  max_occupancy: 5,
  max_adults: 5,
  child_age_ranges: [transferChildBand],
  item_rates: [],
  car_rental_rates: [
    { vehicle_group: 'C', vehicle_name: 'Toyota Starlet', rate_code: 'STD', kms_unlimited: true, valid_from: '2026-01-01', valid_to: '2026-06-30', min_days: 1, max_days: 2, price: 800 },
    { vehicle_group: 'C', vehicle_name: 'Toyota Starlet', rate_code: 'STD', kms_unlimited: true, valid_from: '2026-01-01', valid_to: '2026-06-30', min_days: 3, max_days: 7, price: 1500 }
  ]
};
const carDetail = libraryItemDetail({ item: carRental });
check('car rental hides the room facts', carDetail.facts, []);
check('car rental groups the day ranges', carDetail.carRental.length, 1);
check('car rental rows are per vehicle', carDetail.carRental[0].rows.map((row) => [row.label, row.value]), [
  [`1\u20132 days`, `${money(800)} / vehicle`],
  [`3\u20137 days`, `${money(1500)} / vehicle`]
]);
check('car rental is not empty', carDetail.empty, false);

/* Model plumbing */
check('legacy category name maps to guide', libraryItemKind('Guide / Driver'), 'guide');
check('surcharge category maps to surcharge', libraryItemKind(SURCHARGE_CATEGORY), 'surcharge');
check('unknown category stays generic', libraryItemKind('Boat'), 'other');
check('an item with no rates is empty', libraryItemDetail({ item: { name: 'Nothing', category: 'Extras' } }).empty, true);

/* The export document carries the same rows and escapes the name */
const document = detailDocumentHtml(accommodationDetail);
check('document names the item', document.includes('Lodge'), true);
check('document prints the season', document.includes('High season') || document.includes('Season 1'), true);
check('document prints the price rows', document.includes(money(810)), true);
check('document uses tables Excel can read', document.includes('<table class="rows">'), true);
check('document escapes markup in the name', detailDocumentHtml(libraryItemDetail({ item: { name: '<b>Bold</b>', category: 'Extras' } })).includes('&lt;b&gt;Bold&lt;/b&gt;'), true);
