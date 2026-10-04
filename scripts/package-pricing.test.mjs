import {
  calculatePackageTravellerBreakdown,
  packageItemCapacityError,
  roomsForTravellerPattern
} from '../src/lib/packagePricing.js';

const check = (label, actual, expected) => {
  const passed = Object.is(actual, expected);
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  if (!passed) process.exitCode = 1;
};

const transfer = {
  id: 'transfer',
  name: '6-seat transfer',
  category: 'Transfers',
  max_occupancy: 4,
  item_rates: [{ id: 'transfer-rate', currency: 'ZAR', rate_basis: 'per_vehicle', unit_cost: 1400 }]
};
const accommodation = {
  id: 'hotel',
  name: 'Contract hotel',
  category: 'Accommodation',
  max_occupancy: 2,
  child_age_ranges: [],
  item_rates: [{
    id: 'hotel-rate', currency: 'ZAR', rate_basis: 'per_person_sharing',
    price_1_adult: 810, price_2_adults: 540,
    child_rates_breakdown: { child: 330 }
  }]
};
const packageDays = [{
  services: [
    {
      item_id: 'transfer', rate_id: 'transfer-rate', item_name: '6-seat transfer',
      currency_code: 'ZAR', rate_basis: 'per_vehicle', unit_cost: 1400,
      quantity: 1, is_included: true
    },
    {
      item_id: 'hotel', rate_id: 'hotel-rate', item_name: 'Contract hotel',
      category: 'Accommodation', currency_code: 'ZAR', rate_basis: 'per_person_sharing',
      unit_cost: 810, quantity: 1, is_included: true
    }
  ]
}];

const price = calculatePackageTravellerBreakdown({
  days: packageDays,
  pattern: { adults: 2, children: 2 },
  library: [transfer, accommodation]
})[0];

check('vehicle capacity warns when a traveller pattern exceeds it', Boolean(packageItemCapacityError(transfer, transfer.item_rates[0], [{ adults: 5, children: 0 }])), true);
check('vehicle capacity allows a pattern that fits', packageItemCapacityError(transfer, transfer.item_rates[0], [{ adults: 4, children: 0 }]), '');
check('vehicle capacity cannot be skipped without a traveller pattern', Boolean(packageItemCapacityError(transfer, transfer.item_rates[0], [])), true);
check('accommodation pattern is split into rooms within capacity', roomsForTravellerPattern(2, 2, 2).every((room) => room.adults + room.children <= 2), true);
check('shared unit price is divided across the four travellers', price.unitPerPerson, 350);
check('adult per-person sharing includes the unit share and hotel share', price.totalPerPersonSharing, 890);
check('single supplement is separately itemised', price.singleSupplement, 270);
check('total single-person price includes the supplement', price.totalSinglePerPerson, 1160);
check('child sharing price uses the contracted child rate', price.childPerPerson, 680);
check('accommodation indicates the required room count', price.accommodationRows[0].roomCount, 2);

const noChildRateHotel = {
  ...accommodation,
  item_rates: [{
    id: 'hotel-no-child-rate', currency: 'ZAR', rate_basis: 'per_person_sharing',
    price_1_adult: 810, price_2_adults: 540
  }]
};
const childFallback = calculatePackageTravellerBreakdown({
  days: [{
    services: [{
      item_id: noChildRateHotel.id, rate_id: 'hotel-no-child-rate',
      item_name: noChildRateHotel.name, category: 'Accommodation',
      currency_code: 'ZAR', rate_basis: 'per_person_sharing',
      unit_cost: 810, quantity: 1, is_included: true
    }]
  }],
  pattern: { adults: 1, children: 1 },
  library: [noChildRateHotel]
})[0];
check('child sharing with an adult falls back to single rate without a child contract rate', childFallback.childPerPerson, 810);
check('single adult sharing baseline remains contract sharing rate', childFallback.totalPerPersonSharing, 540);
check('single supplement remains separate from the sharing baseline', childFallback.singleSupplement, 270);

const childOwnRoom = calculatePackageTravellerBreakdown({
  days: [{
    services: [{
      item_id: noChildRateHotel.id, rate_id: 'hotel-no-child-rate',
      item_name: noChildRateHotel.name, category: 'Accommodation',
      currency_code: 'ZAR', rate_basis: 'per_person_sharing',
      unit_cost: 810, vehicle_capacity: 1, quantity: 1, is_included: true
    }]
  }],
  pattern: { adults: 1, children: 1 },
  library: [{ ...noChildRateHotel, max_occupancy: 1 }]
})[0];
check('child in own room is priced at single rate', childOwnRoom.childPerPerson, 810);

const sixTravellerTransfer = calculatePackageTravellerBreakdown({
  days: packageDays.map((day) => ({ ...day, services: [day.services[0]] })),
  pattern: { adults: 6, children: 0 },
  library: [transfer]
})[0];
check('multi-vehicle unit share charges for every vehicle required by capacity', sixTravellerTransfer.unitPerPerson, 466.67);
