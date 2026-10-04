import { childRateForAge } from './roomAllocationHelper';
import { contractPaxRate } from './servicePricing';

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const numberOf = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const rateFor = (service, item) => item?.item_rates?.find((rate) => rate.id === service.rate_id)
  || service.rate_snapshot
  || {};
const capacityFor = (item, service) => Math.max(0, numberOf(item?.max_occupancy) || numberOf(service?.vehicle_capacity));
const totalTravellers = (pattern) => Math.max(1, numberOf(pattern?.adults) + numberOf(pattern?.children));
const isAccommodation = (item, service) => /accommodation/i.test(String(item?.category || service?.category || ''));
const isVehicle = (item, service, rate) => {
  const category = String(item?.category || service?.category || '');
  const basis = String(rate?.rate_basis || service?.rate_basis || item?.pricing_model || '').toLowerCase();
  if (basis === 'per_vehicle' || /transfers?|flights?\s*\/?\s*charter/i.test(category)) return true;
  return capacityFor(item, service) > 0 && /activities?|tours?|excursions?/i.test(category);
};

export const packageItemCapacityError = (item, rate, patterns = []) => {
  if (!isAccommodation(item, {}) && !isVehicle(item, {}, rate)) return '';
  const capacity = capacityFor(item);
  if (!capacity) {
    return `${item?.name || 'This item'} has no maximum occupancy set. Add its contracted vehicle or room capacity in Library Items before using it in a package.`;
  }
  if (isAccommodation(item, {})) return '';
  if (!patterns.length) return 'Add at least one traveller pattern before adding a capacity-limited transport or activity service.';
  const oversized = patterns.find((pattern) => totalTravellers(pattern) > capacity);
  return oversized
    ? `${item?.name || 'This item'} holds up to ${capacity} travellers, but a package pattern has ${totalTravellers(oversized)}. Choose a contracted item with sufficient capacity.`
    : '';
};

export const roomsForTravellerPattern = (adults, children, capacity) => {
  const adultCount = Math.max(0, Math.floor(numberOf(adults)));
  const childCount = Math.max(0, Math.floor(numberOf(children)));
  const limit = Math.max(1, Math.floor(numberOf(capacity)));
  const roomCount = Math.ceil((adultCount + childCount) / limit);
  const rooms = Array.from({ length: roomCount }, () => ({ adults: 0, children: 0 }));
  let remainingAdults = adultCount;
  let remainingChildren = childCount;

  rooms.forEach((room) => {
    if (remainingAdults > 0) {
      room.adults += 1;
      remainingAdults -= 1;
    }
  });
  rooms.forEach((room) => {
    if (remainingChildren > 0 && room.adults > 0 && room.adults + room.children < limit) {
      room.children += 1;
      remainingChildren -= 1;
    }
  });
  rooms.forEach((room) => {
    while (remainingAdults > 0 && room.adults + room.children < limit) {
      room.adults += 1;
      remainingAdults -= 1;
    }
  });
  rooms.forEach((room) => {
    while (remainingChildren > 0 && room.adults + room.children < limit) {
      room.children += 1;
      remainingChildren -= 1;
    }
  });
  return rooms;
};

const amount = (...values) => {
  let fallback = 0;
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))) {
      fallback = Number(value);
      if (fallback !== 0) return fallback;
    }
  }
  return fallback;
};
const FLAT_BASES = new Set(['per_vehicle', 'per_trip', 'per_room', 'flat']);

const accommodationPrices = (service, item, pattern) => {
  const rate = rateFor(service, item);
  const capacity = capacityFor(item, service);
  const flatRoom = String(rate.rate_basis || service.rate_basis || '').toLowerCase() === 'per_room';
  const flatSharing = amount(rate.unit_price, rate.double_twin_rate, rate.price_2_adults);
  const sharing = flatRoom
    ? flatSharing / 2
    : amount(rate.price_2_adults, rate.double_twin_rate, rate.price_1_adult, rate.unit_price);
  const single = amount(rate.single_room_rate, rate.effective_single_rate, rate.price_1_adult, rate.unit_price, sharing);
  const child = childRateForAge(rate, undefined, item?.child_age_ranges || [], sharing);
  const rooms = roomsForTravellerPattern(pattern.adults, pattern.children, capacity);
  const quantity = Math.max(1, numberOf(service.quantity) || 1);
  let adultTotal = 0;
  let childTotal = 0;

  rooms.forEach((room) => {
    const occupants = room.adults + room.children;
    if (!occupants) return;
    if (flatRoom) {
      const flatSingle = amount(rate.single_room_rate, rate.effective_single_rate, rate.price_1_adult, flatSharing);
      adultTotal += room.adults * sharing;
      childTotal += room.children * (room.adults > 0 && child.known ? child.rate : flatSingle);
      return;
    }
    if (room.adults > 0) {
      adultTotal += Math.min(room.adults, 2) * sharing;
      adultTotal += Math.max(0, room.adults - 2) * amount(rate.price_3_plus_adults, sharing);
    }
    if (room.children > 0) {
      childTotal += room.children * (room.adults > 0 && child.known ? child.rate : single);
    }
  });

  const adultCount = Math.max(1, numberOf(pattern.adults));
  const childCount = Math.max(0, numberOf(pattern.children));
  const sharingPerAdult = round2(adultTotal / adultCount / quantity);
  const childPerTraveller = childCount
    ? round2(childTotal / childCount / quantity)
    : round2(child.known ? child.rate : single);
  const singleSupplement = round2(Math.max(0, single - sharing) * quantity);
  return {
    sharingPerAdult: round2(sharingPerAdult * quantity),
    singleSupplement,
    childPerTraveller: round2(childPerTraveller * quantity),
    roomCount: rooms.length,
    capacity
  };
};

const unitContributionPerTraveller = (service, item, travellers) => {
  const rate = rateFor(service, item);
  const currency = service.currency_code || rate.currency || item?.currency || 'ZAR';
  const pricedItem = {
    ...(item || {}),
    pricing_model: item?.pricing_model || rate.rate_basis || service.rate_basis,
    item_rates: [rate]
  };
  const unitPax = contractPaxRate(pricedItem, currency, travellers);
  const unitCost = amount(rate.price_1_adult, rate.unit_price, rate.unit_cost, service.unit_cost);
  const basis = String(rate.rate_basis || service.rate_basis || item?.pricing_model || '').toLowerCase();
  const quantity = Math.max(1, numberOf(service.quantity) || 1);
  let perTraveller = unitPax || unitCost;
  if (FLAT_BASES.has(basis)) {
    perTraveller = unitPax || unitCost / travellers;
  }
  if (basis === 'per_vehicle') {
    const capacity = capacityFor(item, service);
    perTraveller = unitCost * Math.ceil(travellers / Math.max(1, capacity)) / travellers;
  }
  return round2(perTraveller * quantity);
};

export const calculatePackageTravellerBreakdown = ({ days = [], pattern, library = [] } = {}) => {
  const adults = Math.max(1, numberOf(pattern?.adults));
  const children = Math.max(0, numberOf(pattern?.children));
  const travellers = adults + children;
  const services = (Array.isArray(days) ? days : [])
    .flatMap((day) => Array.isArray(day.services) ? day.services : [])
    .filter((service) => service.is_included !== false);
  const currencies = [...new Set(services.map((service) => service.currency_code || 'ZAR'))];

  return currencies.map((currency) => {
    const rows = services.filter((service) => (service.currency_code || 'ZAR') === currency)
      .map((service) => ({
        service,
        item: library.find((entry) => entry.id === service.item_id) || null
      }));
    const commonRows = [];
    const accommodationRows = [];
    rows.forEach(({ service, item }) => {
      if (isAccommodation(item, service)) {
        accommodationRows.push({
          name: service.item_name || item?.name || 'Accommodation',
          ...accommodationPrices(service, item, { adults, children })
        });
      } else {
        const perPerson = unitContributionPerTraveller(service, item, travellers);
        commonRows.push({
          name: service.item_name || item?.name || 'Service',
          perPerson: round2(perPerson),
          total: round2(perPerson * travellers)
        });
      }
    });

    const unitPerPerson = round2(commonRows.reduce((sum, row) => sum + row.perPerson, 0));
    const accommodationSharing = round2(accommodationRows.reduce((sum, row) => sum + row.sharingPerAdult, 0));
    const singleSupplement = round2(accommodationRows.reduce((sum, row) => sum + row.singleSupplement, 0));
    const childAccommodation = round2(accommodationRows.reduce((sum, row) => sum + row.childPerTraveller, 0));
    return {
      currency,
      unitRows: commonRows,
      accommodationRows,
      unitPerPerson,
      totalPerPersonSharing: round2(unitPerPerson + accommodationSharing),
      singleSupplement,
      totalSinglePerPerson: round2(unitPerPerson + accommodationSharing + singleSupplement),
      childPerPerson: round2(unitPerPerson + childAccommodation),
      unitTotal: round2(commonRows.reduce((sum, row) => sum + row.total, 0))
    };
  });
};
