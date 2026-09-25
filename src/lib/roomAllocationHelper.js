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

/* Resolve a child's contracted price from an item_rates row.
   Age-aware when the rate's child_rates_breakdown uses age-band keys and the
   child's age matches one of the given age ranges; otherwise a flat `child`
   key / child-named key / first breakdown band, then price_child / child_rate,
   then child_discount (% off the sharing rate). Returns { rate, known };
   known = false means no explicit child rate is configured — such children pay
   the adult sharing rate. An explicit 0 (free child) is honoured. */
export const childRateForAge = (rate, age, ageRanges = [], sharingBuy = 0) => {
  const definedNum = (v) => (v === null || v === undefined || v === '' ? null : parseFloat(v) || 0);

  const bd = rate?.child_rates_breakdown;
  if (bd && typeof bd === 'object') {
    const keys = Object.keys(bd);
    if (keys.length) {
      if (typeof age === 'number' && Number.isFinite(age) && Array.isArray(ageRanges) && ageRanges.length) {
        const sorted = [...ageRanges].sort((a, b) => (Number(a.ageFrom) || 0) - (Number(b.ageFrom) || 0));
        const band = sorted.find((b) => {
          const from = Number(b.ageFrom) || 0;
          const to = Number(b.ageTo);
          return age >= from && age <= (Number.isFinite(to) ? to : Infinity);
        });
        if (band && Object.prototype.hasOwnProperty.call(bd, String(band.id))) {
          const bandRate = bd[String(band.id)];
          if (bandRate !== null && bandRate !== undefined && bandRate !== '') {
            return { rate: parseFloat(bandRate) || 0, known: true };
          }
        }
      }
      const pick = keys.includes('child')
        ? bd.child
        : keys.find((k) => /child/i.test(k))
          ? bd[keys.find((k) => /child/i.test(k))]
          : bd[keys[0]];
      if (pick !== null && pick !== undefined && pick !== '') {
        return { rate: parseFloat(pick) || 0, known: true };
      }
    }
  }

  const direct = definedNum(rate?.price_child);
  if (direct !== null) return { rate: direct, known: true };
  const legacy = definedNum(rate?.child_rate);
  if (legacy !== null) return { rate: legacy, known: true };
  const discount = parseFloat(rate?.child_discount) || 0;
  if (discount > 0) return { rate: (sharingBuy || 0) * (1 - discount / 100), known: true };
  return { rate: null, known: false };
};

/* Priced contractually from the Library item:
   - 1 guest alone in a room -> single room rate (an adult); a lone child uses
     the child rate when one is configured, else the single rate.
   - 2+ guests -> adults pay the per-person sharing rate for the base 2 adults;
     each additional adult pays the extra-adult rate (price_3_plus_adults,
     falling back to the sharing rate); children pay their age-band child rate
     when configured (0 = free child), else the sharing rate. */
export const calculateRoomCharges = (item, roomAllocations = [], currencyCode = 'ZAR', markupPct = 0, defaultTaxRate = 15) => {
  const rate = getRateRow(item, currencyCode);
  const markup = Number(markupPct) || 0;
  const taxRate = defaultTaxRate;
  const ageRanges = item?.child_age_ranges || [];

  const singlePrice = parseFloat(rate?.price_1_adult) || parseFloat(rate?.single_room_rate) || parseFloat(rate?.unit_price) || 0;
  const sharingPrice = parseFloat(rate?.price_2_adults) || parseFloat(rate?.double_twin_rate) || singlePrice || 0;
  const extraAdultPrice = parseFloat(rate?.price_3_plus_adults) > 0 ? parseFloat(rate?.price_3_plus_adults) : sharingPrice;

  let totalBuy = 0;
  let totalSell = 0;

  const roomsWithCharges = roomAllocations.map((rm, idx) => {
    const occupants = rm.allocatedTravellers || [];
    const adults = occupants.filter(isAdultTraveller).length;
    const children = occupants.length - adults;

    let roomBuy = 0;
    let rateDescription = '';

    if (occupants.length === 0) {
      roomBuy = 0;
      rateDescription = 'Empty room (0 guests)';
    } else if (occupants.length === 1) {
      if (adults === 1) {
        roomBuy = singlePrice;
        rateDescription = `1 Guest (Single Rate: ${singlePrice.toFixed(2)})`;
      } else {
        const soloChild = childRateForAge(rate, parseFloat(occupants[0].age), ageRanges, sharingPrice);
        if (soloChild.known) {
          roomBuy = soloChild.rate;
          rateDescription = `1 Child (Child Rate: ${soloChild.rate.toFixed(2)})`;
        } else {
          roomBuy = singlePrice;
          rateDescription = `1 Child (Single Rate: ${singlePrice.toFixed(2)})`;
        }
      }
    } else {
      const baseAdults = Math.min(adults, 2);
      const extraAdults = Math.max(0, adults - 2);
      const adultCost = baseAdults * sharingPrice + extraAdults * extraAdultPrice;

      let childCost = 0;
      const childRates = [];
      occupants.filter((t) => !isAdultTraveller(t)).forEach((t) => {
        const child = childRateForAge(rate, parseFloat(t.age), ageRanges, sharingPrice);
        const rateForChild = child.known ? child.rate : sharingPrice;
        childCost += rateForChild;
        childRates.push(rateForChild);
      });

      roomBuy = adultCost + childCost;
      const parts = [];
      if (adults > 0) {
        if (extraAdults > 0) {
          parts.push(`${baseAdults} Adult(s) x ${sharingPrice.toFixed(2)} + ${extraAdults} Extra Adult(s) x ${extraAdultPrice.toFixed(2)}`);
        } else {
          parts.push(`${adults} Adult(s) x ${sharingPrice.toFixed(2)}`);
        }
      }
      if (children > 0) {
        parts.push(`${children} Child(ren) x ${childRates.map((v) => v.toFixed(2)).join(' + ')}`);
      }
      rateDescription = parts.length ? parts.join(' + ') : '0 Guests';
    }

    roomBuy = round2(roomBuy);
    const roomSell = round2(roomBuy * (1 + markup / 100));

    totalBuy += roomBuy;
    totalSell += roomSell;

    return {
      ...rm,
      roomId: rm.roomId || idx + 1,
      occupantCount: occupants.length,
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
