import { round2, numOr, vatOfInclusive } from './invoiceDoc';

export const isAdultTraveller = (t) => {
  if (!t) return true;
  const age = parseInt(t.age, 10);
  if (Number.isNaN(age)) return true;
  return age >= 18;
};

export const getRateRow = (item, currencyCode) => {
  if (!item) return null;
  const rates = item.item_rates || [];
  if (!rates.length) return null;
  const codeU = (currencyCode || '').toUpperCase();
  const byCurr = rates.find((r) => (r.currency || '').toUpperCase() === codeU);
  return byCurr || rates[0];
};

/**
 * Calculates per-room buy and sell totals based on room occupant allocation.
 *
 * Single occupancy (1 guest): Single room rate.
 * Double occupancy (2 guests): Double/Twin rate x 2 occupants.
 * 3+ occupancy: 3+ sharing rate x occupants.
 */
export const calculateRoomCharges = (item, roomAllocations = [], currencyCode = 'ZAR', markupPct = 0, defaultTaxRate = 15) => {
  const rate = getRateRow(item, currencyCode);
  const markup = Number(markupPct) || 0;
  const taxRate = defaultTaxRate;

  let totalBuy = 0;
  let totalSell = 0;

  const roomsWithCharges = roomAllocations.map((rm, idx) => {
    const occupants = rm.allocatedTravellers || [];
    const count = occupants.length;
    const adults = occupants.filter(isAdultTraveller).length;
    const children = count - adults;

    let roomBuy = 0;
    let rateDescription = '';

    if (count === 0) {
      roomBuy = 0;
      rateDescription = 'Empty room (0 guests)';
    } else if (count === 1) {
      // Single occupancy
      const singlePrice = parseFloat(rate?.price_1_adult) || parseFloat(rate?.single_room_rate) || parseFloat(rate?.unit_price) || 0;
      roomBuy = singlePrice;
      rateDescription = `1 Guest (Single Rate: ${singlePrice.toFixed(2)})`;
    } else if (count === 2) {
      // Double occupancy
      const doublePerPax = parseFloat(rate?.price_2_adults) || parseFloat(rate?.double_twin_rate) || parseFloat(rate?.price_1_adult) || 0;
      roomBuy = doublePerPax * 2;
      rateDescription = `2 Guests (Sharing Rate: 2 x ${doublePerPax.toFixed(2)})`;
    } else {
      // 3+ occupants
      const sharingPerPax = parseFloat(rate?.price_3_plus_adults) || parseFloat(rate?.price_2_adults) || parseFloat(rate?.double_twin_rate) || parseFloat(rate?.price_1_adult) || 0;
      const childPrice = parseFloat(rate?.price_child) || parseFloat(rate?.child_rate) || 0;

      if (children > 0 && childPrice > 0 && adults > 0) {
        const adultPrice = parseFloat(rate?.price_2_adults) || parseFloat(rate?.double_twin_rate) || parseFloat(rate?.price_1_adult) || 0;
        roomBuy = (adults * adultPrice) + (children * childPrice);
        rateDescription = `${adults} Adult(s) + ${children} Child(ren) (${adults} x ${adultPrice.toFixed(2)} + ${children} x ${childPrice.toFixed(2)})`;
      } else {
        roomBuy = count * sharingPerPax;
        rateDescription = `${count} Guests Sharing (${count} x ${sharingPerPax.toFixed(2)})`;
      }
    }

    roomBuy = round2(roomBuy);
    const roomSell = round2(roomBuy * (1 + markup / 100));

    totalBuy += roomBuy;
    totalSell += roomSell;

    return {
      ...rm,
      roomId: rm.roomId || idx + 1,
      occupantCount: count,
      adultCount: adults,
      childCount: children,
      buyCost: roomBuy,
      sellPrice: roomSell,
      rateDescription
    };
  });

  totalBuy = round2(totalBuy);
  totalSell = round2(totalSell);
  const totalTax = round2(vatOfInclusive(totalSell, taxRate));
  const totalExcl = round2(totalSell - totalTax);

  return {
    rooms: roomsWithCharges,
    totalBuy,
    totalSell,
    totalTax,
    totalExcl
  };
};

/**
 * Generates initial default room allocation for a given traveller array and maxOccupancy.
 */
export const defaultAutoAllocation = (travellers = [], maxOccupancy = 2) => {
  const cap = Math.max(1, parseInt(maxOccupancy, 10) || 2);
  const list = Array.isArray(travellers) ? travellers : [];
  if (!list.length) return [{ roomId: 1, allocatedTravellers: [] }];

  const numRooms = Math.ceil(list.length / cap);
  const rooms = [];

  let travIdx = 0;
  for (let r = 0; r < numRooms; r++) {
    const roomOccupants = [];
    for (let c = 0; c < cap && travIdx < list.length; c++) {
      roomOccupants.push(list[travIdx]);
      travIdx++;
    }
    rooms.push({
      roomId: r + 1,
      allocatedTravellers: roomOccupants
    });
  }

  return rooms;
};

/**
 * Validates whether an accommodation service item has valid room allocation.
 */
export const validateRoomAllocation = (serviceItem, itineraryTravellers = []) => {
  const cat = serviceItem?.category || '';
  const isAccom = /accommodation/i.test(cat);
  if (!isAccom) return { isValid: true, reason: '' };

  const maxOcc = Math.max(1, parseInt(serviceItem.maxOccupancy, 10) || 2);
  const travList = Array.isArray(itineraryTravellers) ? itineraryTravellers : [];
  if (!travList.length) return { isValid: true, reason: '' };

  const roomAllocations = serviceItem.roomAllocations;
  if (!Array.isArray(roomAllocations) || !roomAllocations.length) {
    return {
      isValid: false,
      reason: `Room allocation required for ${serviceItem.name} (${travList.length} travellers)`,
      unallocatedCount: travList.length,
      overCapacityCount: 0
    };
  }

  const allocatedMap = new Set();
  let overCapacityCount = 0;

  roomAllocations.forEach((rm) => {
    const occs = rm.allocatedTravellers || [];
    if (occs.length > maxOcc) {
      overCapacityCount += (occs.length - maxOcc);
    }
    occs.forEach((tr, i) => {
      const id = tr.id || `${tr.name}_${tr.surname}_${i}`;
      allocatedMap.add(id);
    });
  });

  const unallocatedCount = Math.max(0, travList.length - allocatedMap.size);

  if (overCapacityCount > 0) {
    return {
      isValid: false,
      reason: `Room over capacity in ${serviceItem.name} (Max ${maxOcc} per room)`,
      unallocatedCount,
      overCapacityCount
    };
  }

  if (unallocatedCount > 0) {
    return {
      isValid: false,
      reason: `${unallocatedCount} traveller(s) unallocated in ${serviceItem.name}`,
      unallocatedCount,
      overCapacityCount: 0
    };
  }

  return { isValid: true, reason: '', unallocatedCount: 0, overCapacityCount: 0 };
};
