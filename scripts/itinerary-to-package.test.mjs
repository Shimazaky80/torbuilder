import { buildItineraryPackage } from '../src/lib/itineraryToPackage.js';

const check = (label, actual, expected) => {
  const passed = Object.is(actual, expected);
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  if (!passed) process.exitCode = 1;
};

const travelWindow = { start: '2026-11-01', end: '2026-11-05' };
const meta = {
  itineraryName: 'Kruger Safari',
  referenceNumber: 'IT-2026-000001',
  numAdults: 3,
  numChildren: 1,
  travellers: [
    { role: 'client', age: 35 },
    { role: 'client', age: 40 },
    { role: 'client', age: 10 },
    { role: 'tour_leader', age: 30 }
  ]
};

const vehicle = {
  id: 'vehicle',
  name: '8-seat van',
  category: 'Transfers',
  max_occupancy: 8,
  item_rates: [{
    id: 'vehicle-rate', currency: 'ZAR', rate_basis: 'per_vehicle',
    price_1_adult: 2100, valid_from: '2026-01-01', valid_to: '2026-12-31'
  }]
};
const guide = {
  id: 'guide',
  name: 'Local guide',
  category: 'Guide',
  item_rates: [{ id: 'guide-rate', currency: 'ZAR', rate_basis: 'per_trip', unit_cost: 0 }]
};
const meal = {
  id: 'meal',
  name: 'Guide lunch',
  category: 'Meals',
  item_rates: [{ id: 'meal-rate', currency: 'ZAR', rate_basis: 'per_person', unit_cost: 80 }]
};
const hotel = {
  id: 'hotel',
  name: 'Lodge',
  category: 'Accommodation',
  max_occupancy: 2,
  item_rates: [{
    id: 'hotel-rate', currency: 'ZAR', rate_basis: 'per_person_sharing',
    price_1_adult: 800, price_2_adults: 700,
    valid_from: '2026-01-01', valid_to: '2026-12-31'
  }]
};
const surcharge = {
  id: 'surcharge',
  name: 'Conservation fee',
  category: 'Surcharge',
  item_rates: [{ id: 'surcharge-rate', currency: 'ZAR', rate_basis: 'per_person', price_1_adult: 75, valid_from: '2026-01-01', valid_to: '2026-12-31' }]
};

const days = [{
  notes: 'Arrival and transfer',
  services: [
    {
      key: 't1', itemId: 'vehicle', name: '8-seat van', category: 'Transfers',
      supplierName: 'Acme Transfers', currencyCode: 'ZAR', basis: 'per_vehicle',
      buyPP: 525, quantity: 1
    },
    {
      key: 't2', itemId: 'guide', name: 'Local guide', category: 'Guide',
      currencyCode: 'ZAR', basis: 'per_trip', buyPP: 100, pax: 3,
      guideServiceTypes: ['guide']
    },
    {
      key: 't3', itemId: 'meal', name: 'Guide lunch', category: 'Meals',
      currencyCode: 'ZAR', basis: 'per_trip', buyPP: 50, pax: 3,
      guideOnly: true, guideForKey: 'guide', guideChargeType: 'guide'
    },
    {
      key: 't4', itemId: 'hotel', name: 'Lodge', category: 'Accommodation',
      currencyCode: 'ZAR', basis: 'per_person_sharing', buyPP: 800, quantity: 2
    },
    {
      key: 't5', itemId: 'surcharge', name: 'Conservation fee', category: 'Surcharge',
      currencyCode: 'ZAR', basis: 'per_person', buyPP: 75, quantity: 4,
      surchargeType: 'Conservation', surchargeUnitBasis: 'per_person'
    },
    {
      key: 't6', itemId: 'missing', name: 'Hand-written transfer', category: 'Transfers',
      currencyCode: 'ZAR', basis: 'per_person', buyPP: 12.5, isOptional: true
    }
  ]
}, {
  notes: '',
  services: []
}];

const built = buildItineraryPackage({
  meta,
  days,
  libraryItems: [vehicle, guide, meal, hotel, surcharge],
  fallbackPax: 4,
  travelWindow,
  currencyCode: 'ZAR'
});

check('package name', built.name, 'Kruger Safari Package');
check('package currency', built.currency_code, 'ZAR');
check('band is the paying party (2 adult clients)', built.pax_options[0].pax, 2);
check('band adults mirror', built.pax_options[0].adults, 2);
check('band is not auto generated', built.pax_options[0].is_auto_generated, false);
check('children accepted', built.accepts_children, true);
check('child range', JSON.stringify(built.child_age_ranges), JSON.stringify([{ name: 'Children', ageFrom: 10, ageTo: 10 }]));
check('validity from', built.validity_periods[0].valid_from, '2026-11-01');
check('validity to', built.validity_periods[0].valid_to, '2026-11-05');
check('days copied including empty day', built.days.length, 2);
check('day notes', built.days[0].notes, 'Arrival and transfer');
check('day numbering', built.days[1].day_number, 2);

const [van, guideLine, lunch, lodge, fee, handWritten] = built.days[0].items;
check('vehicle is flat unit cost', van.unit_cost, 2100);
check('vehicle basis', van.rate_basis, 'per_vehicle');
check('vehicle rate', van.rate_id, 'vehicle-rate');
check('vehicle season snapshot', van.rate_snapshot.id, 'vehicle-rate');
check('vehicle capacity', van.vehicle_capacity, 8);

check('guide flat per-trip cost', guideLine.unit_cost, 300);
check('guide basis', guideLine.rate_basis, 'per_trip');
check('guide quantity', guideLine.quantity, 1);
check('guide service types', JSON.stringify(guideLine.guide_service_types), JSON.stringify(['guide']));

check('guide detail flat cost', lunch.unit_cost, 150);
check('guide detail basis', lunch.rate_basis, 'per_trip');
check('guide detail quantity', lunch.quantity, 1);
check('guide detail linked to guide', lunch.guide_for_item_key, guideLine.item_key);
check('guide detail charge type', lunch.guide_charge_type, 'guide');

check('accommodation per-person cost', lodge.unit_cost, 800);
check('accommodation rate', lodge.rate_id, 'hotel-rate');
check('accommodation season snapshot', lodge.rate_snapshot.id, 'hotel-rate');

check('surcharge normalized to per-person', fee.rate_basis, 'per_person');
check('surcharge repeats folded into cost', fee.unit_cost, 75);
check('surcharge repeat count not multiplied again', fee.quantity, 1);
check('surcharge snapshot carries no money', fee.rate_snapshot.price_1_adult, undefined);
check('surcharge snapshot keeps season dates', fee.rate_snapshot.valid_from, '2026-01-01');

check('unresolved item kept without a dangling id', handWritten.item_id, null);
check('unresolved item keeps its cost', handWritten.unit_cost, 12.5);
check('unresolved item carries a season stub', handWritten.rate_snapshot.valid_from, '2026-11-01');
check('optional line stays optional', handWritten.is_included, false);

/* A protected line snapshots the uplifted season, exactly as the itinerary
   priced it, so the package does not silently drop Pricing Protection. */
const protectedLine = {
  itemId: 'hotel', name: 'Lodge', category: 'Accommodation',
  currencyCode: 'ZAR', basis: 'per_person_sharing', buyPP: 800,
  priceProtectionPercent: 10, protectedSeasonName: '2025/26'
};
const protectedPackage = buildItineraryPackage({
  meta: { ...meta, travellers: meta.travellers.filter((traveller) => traveller.role === 'client') },
  days: [{ services: [protectedLine] }],
  libraryItems: [hotel],
  fallbackPax: 3,
  travelWindow,
  currencyCode: 'ZAR'
});
check('protected snapshot scaled', protectedPackage.days[0].items[0].rate_snapshot.price_1_adult, 880);
check('protection percent kept', protectedPackage.days[0].items[0].price_protection_percent, 10);

/* A reloaded line keeps the protection percent but not the season's name. The
   closest prior season must be found from the library and uplifted, so the
   package price still matches what the itinerary charged. */
const priorSeasonHotel = {
  id: 'hotel-prior',
  name: 'Lodge',
  category: 'Accommodation',
  item_rates: [{
    id: 'hotel-prior-rate', currency: 'ZAR', rate_basis: 'per_person_sharing',
    price_1_adult: 800, valid_from: '2025-01-01', valid_to: '2025-12-31', season_name: '2025'
  }]
};
const reloadedPackage = buildItineraryPackage({
  meta: { ...meta, travellers: meta.travellers.filter((traveller) => traveller.role === 'client') },
  days: [{
    services: [{
      itemId: 'hotel-prior', name: 'Lodge', category: 'Accommodation',
      currencyCode: 'ZAR', basis: 'per_person_sharing', buyPP: 800, priceProtectionPercent: 10
    }]
  }],
  libraryItems: [priorSeasonHotel],
  fallbackPax: 3,
  travelWindow,
  currencyCode: 'ZAR'
});
check('reloaded protected line finds prior season', reloadedPackage.days[0].items[0].rate_snapshot.price_1_adult, 880);
check('reloaded protected line keeps protection', reloadedPackage.days[0].items[0].price_protection_percent, 10);

/* Client linkage and client markup must not travel with the conversion: the
   package payload is unassigned, and every line carries contract cost only. */
const markedUpPackage = buildItineraryPackage({
  meta: {
    ...meta,
    client: { id: 'client-1', name: 'Smith' },
    clientId: 'client-1',
    travellers: meta.travellers.filter((traveller) => traveller.role === 'client')
  },
  days: [{
    services: [{
      itemId: 'hotel', name: 'Lodge', category: 'Accommodation',
      currencyCode: 'ZAR', basis: 'per_person_sharing',
      buyPP: 800, markup: 25, sellPP: 1000, quantity: 2
    }, {
      itemId: 'guide', name: 'Local guide', category: 'Guide',
      currencyCode: 'ZAR', basis: 'per_trip',
      buyPP: 100, markup: 25, sellPP: 125, pax: 3,
      guideServiceTypes: ['guide']
    }]
  }],
  libraryItems: [hotel, guide],
  fallbackPax: 3,
  travelWindow,
  currencyCode: 'ZAR'
});
const [markedLodge, markedGuide] = markedUpPackage.days[0].items;
check('package has no client reference', ['client', 'clientId', 'client_id'].some((key) => key in markedUpPackage), false);
check('package has no markup setting', 'default_markup_percentage' in markedUpPackage, false);
check('line cost is the contract rate', markedLodge.unit_cost, 800);
check('line price is the contract rate', markedLodge.unit_price, 800);
check('line carries no markup field', Object.prototype.hasOwnProperty.call(markedLodge, 'markup'), false);
check('line carries no sell price field', Object.prototype.hasOwnProperty.call(markedLodge, 'sellPP'), false);
check('snapshot stays at the contract rate', markedLodge.rate_snapshot.price_1_adult, 800);
check('guide flat cost ignores marked sell', markedGuide.unit_cost, 300);
