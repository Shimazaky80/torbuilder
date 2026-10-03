import { round2, vatOfInclusive } from './invoiceDoc';

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
 * The object RoomAllocationModal is handed: the library item narrowed to the
 * ONE season that prices this trip, plus that season's identity so the dialog
 * can name the matrix it used.
 *
 * Both ways of opening the dialog must go through this — dropping an item onto
 * a day (which auto-opens from createService) and clicking allocate on a line
 * that is already there — because handing the dialog the raw library item gives
 * it every season at once, and getRateRow() then prices the room from whichever
 * row the database happened to return first. One builder means the two paths
 * can never disagree about which season priced the room.
 *
 * `modalRates` must already be the final rows (protection applied by the
 * caller); this deliberately does no pricing of its own.
 */
export const buildRoomModalItem = ({
  base = {},
  service = null,
  modalRates = [],
  season = null
} = {}) => ({
  ...base,
  id: service?.itemId ?? base.id,
  name: base.name || service?.name || '',
  category: base.category || service?.category || '',
  maxOccupancy: service?.maxOccupancy || base.maxOccupancy || base.max_occupancy,
  roomType: service?.roomType || base.roomType || base.room_type || '',
  roomAllocations: service?.roomAllocations || [],
  isOptional: !!service?.isOptional,
  item_rates: modalRates,
  /* Surfaced so the dialog can say which season it priced from, instead of
     showing a figure the operator has to reconcile against the matrix. */
  _seasonName: season?.seasonName || '',
  _seasonFrom: season?.validFrom || '',
  _seasonTo: season?.validTo || '',
  _seasonStatus: season?.status || '',
  _seasonReason: season?.reason || ''
});

export const accommodationRegionOf = (item) => String(
  item?.destination_area
  || item?.destinationArea
  || ''
).trim().replace(/\s+/g, ' ').toLocaleLowerCase();

export const accommodationRegionConflicts = (services = [], candidate, libraryItems = []) => {
  const candidateRegion = accommodationRegionOf(candidate);
  const byItemId = new Map((libraryItems || []).map((item) => [String(item.id), item]));
  return (services || [])
    .filter((service) => isAccommodationService(service))
    .map((service) => {
      const libraryItem = service.itemId ? byItemId.get(String(service.itemId)) : null;
      const regionValue = service.destinationArea || libraryItem?.destination_area || '';
      const region = accommodationRegionOf({
        destinationArea: regionValue
      });
      return { service, region, regionLabel: String(regionValue).trim() };
    })
    .filter(({ region }) => !candidateRegion || !region || candidateRegion !== region);
};

/* An explicit destination split establishes separate, non-overlapping traveller
   groups by region. A later property can join one of those existing destination
   groups without requiring another override, but missing region data must never
   be treated as a match. */
export const canJoinExistingAccommodationDestination = (services = [], candidate, libraryItems = []) => {
  const candidateRegion = accommodationRegionOf(candidate);
  if (!candidateRegion) return false;
  const byItemId = new Map((libraryItems || []).map((item) => [String(item.id), item]));
  const regions = (services || [])
    .filter((service) => isAccommodationService(service) && !service.isOptional)
    .map((service) => {
      const libraryItem = service.itemId ? byItemId.get(String(service.itemId)) : null;
      return accommodationRegionOf({
        destinationArea: service.destinationArea || libraryItem?.destination_area
      });
    });
  return regions.length > 0 && regions.every(Boolean) && regions.includes(candidateRegion);
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
     when configured (0 = free child), else the sharing rate.

   A flat room rate is different: it is the price of the room, not a per-person
   price, so the room is charged once no matter who sleeps in it. The one case
   that differs is a room holding a single traveller, who does not share and so
   pays the single-room figure. Charging `occupants x rate` here would silently
   double a shared flat room, which is why this branch exists at all. */
export const calculateRoomCharges = (item, roomAllocations = [], currencyCode = 'ZAR', markupPct = 0, defaultTaxRate = 15) => {
  const rate = getRateRow(item, currencyCode);
  const markup = Number(markupPct) || 0;
  const taxRate = defaultTaxRate;
  const ageRanges = item?.child_age_ranges || [];

  const singlePrice = parseFloat(rate?.price_1_adult) || parseFloat(rate?.single_room_rate) || parseFloat(rate?.unit_price) || 0;
  const sharingPrice = parseFloat(rate?.price_2_adults) || parseFloat(rate?.double_twin_rate) || singlePrice || 0;
  const extraAdultPrice = parseFloat(rate?.price_3_plus_adults) > 0 ? parseFloat(rate?.price_3_plus_adults) : sharingPrice;
  /* Flat room rate: unit_price is the room, price_1_adult / single_room_rate is
     the single-room figure. Both are totals for the room, never per person. */
  const isFlatRoom = String(rate?.rate_basis || '') === 'per_room';
  const flatRoomPrice = parseFloat(rate?.unit_price) || parseFloat(rate?.double_twin_rate) || parseFloat(rate?.price_2_adults) || 0;
  const flatSinglePrice = parseFloat(rate?.single_room_rate) || parseFloat(rate?.effective_single_rate) || parseFloat(rate?.price_1_adult) || flatRoomPrice;

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
    } else if (isFlatRoom) {
      /* One charge for the room: the single-room figure when a lone traveller
         has it to themselves, otherwise the flat room rate. */
      const alone = occupants.length === 1;
      roomBuy = alone ? flatSinglePrice : flatRoomPrice;
      rateDescription = alone
        ? `1 Guest (Flat Single Room Rate: ${round2(roomBuy).toFixed(2)})`
        : `${occupants.length} Guests (Flat Room Rate: ${round2(roomBuy).toFixed(2)})`;
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

export const isAccommodationService = (sv) => /accommodation/i.test(sv?.category || '');

/* Stable identity for a traveller so the same guest can be recognised across
   every accommodation on a night. Ids when we have them, otherwise name +
   surname — the same matching the room modal and the allocation counts use. */
export const travellerIdentity = (t) => {
  if (!t) return '';
  if (t.id) return `id:${t.id}`;
  return `nm:${String(t.name || '').trim().toLowerCase()}|${String(t.surname || '').trim().toLowerCase()}`;
};

/* Name+surname key — always available regardless of whether an id is present.
   Used so itinerary travellers (which may have no id) match against room-modal
   allocated travellers (which always get a synthetic id like trav_0_Name). */
const travellerNameKey = (t) =>
  `nm:${String(t?.name || '').trim().toLowerCase()}|${String(t?.surname || '').trim().toLowerCase()}`;

export const travellerDisplayName = (t) =>
  `${String(t?.name || '').trim()} ${String(t?.surname || '').trim()}`.trim() || 'A traveller';

/* Included accommodation services on a night, in the order they were added.
   Alternatives/options are left out entirely: the client has not chosen them,
   so they neither hold a bed nor have to be allocated. */
export const includedAccommodationsOnDay = (day = {}) =>
  (day?.services || []).filter((sv) => isAccommodationService(sv) && !sv.isOptional);

/* How many distinct travellers already hold a bed across a set of
   accommodation services. Used to decide whether a night still has room for
   another property in a group split. */
export const beddedTravellerCount = (services = []) => {
  const keys = new Set();
  (Array.isArray(services) ? services : []).forEach((sv) => {
    if (!isAccommodationService(sv) || sv.isOptional) return;
    (Array.isArray(sv?.roomAllocations) ? sv.roomAllocations : []).forEach((rm) => {
      (rm.allocatedTravellers || []).forEach((tr) => {
        const key = travellerIdentity(tr);
        if (key) keys.add(key);
      });
    });
  });
  return keys.size;
};

export const allocatedTravellerCount = (roomAllocations = []) => {
  const keys = new Set();
  (Array.isArray(roomAllocations) ? roomAllocations : []).forEach((room) => {
    (Array.isArray(room?.allocatedTravellers) ? room.allocatedTravellers : []).forEach((traveller) => {
      const key = travellerIdentity(traveller);
      if (key) keys.add(key);
    });
  });
  return keys.size;
};

/* A property added as part of a group split must share the same split identity
   as the included accommodations already on that night. */
export const joinAccommodationSplitGroup = (services = [], splitGroupId) => {
  if (!splitGroupId) return services;
  return (services || []).map((service) => (
    isAccommodationService(service) && !service.isOptional
      ? { ...service, splitGroupId }
      : service
  ));
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

/* Every bed assigned to a traveller on one night, across the included
   properties of that night. Returns key -> [service names holding a bed].

   IMPORTANT: each traveller is indexed by BOTH their id-based key AND their
   name+surname key. This bridges the identity gap between:
     - itinerary travellers stored in meta.travellers (JSONB, often no id field)
     - room-allocation entries produced by the modal (always a synthetic id like
       trav_0_Michael because the modal guarantees a non-null id).
   Without double-indexing, `beds.has(travellerIdentity(metaTraveller))` is
   always false for anyone who has no id in the itinerary row, causing the
   "N traveller(s) have no room" guardrail to fire even when every traveller
   is correctly allocated. */
const bedsOnNight = (services) => {
  const beds = new Map();
  const addEntry = (key, holder) => {
    if (!key) return;
    const holders = beds.get(key) || [];
    holders.push(holder);
    beds.set(key, holders);
  };
  (services || []).forEach((sv) => {
    const rooms = Array.isArray(sv?.roomAllocations) ? sv.roomAllocations : [];
    rooms.forEach((rm) => {
      (rm.allocatedTravellers || []).forEach((tr) => {
        const holder = { key: sv.key, name: sv.name || 'accommodation' };
        /* Index by id-key so travellers that have a real DB id match cleanly. */
        const idKey = travellerIdentity(tr);
        addEntry(idKey, holder);
        /* ALSO index by name-key so itinerary travellers without an id (or
           whose id differs from the synthetic modal id) still find a match. */
        const nmKey = travellerNameKey(tr);
        if (nmKey !== idKey) addEntry(nmKey, holder);
      });
    });
  });
  return beds;
};

const isSameService = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  return !!(a.key && b.key && a.key === b.key);
};

const maxOccupancyOf = (sv) => Math.max(1, parseInt(sv?.maxOccupancy ?? sv?.max_occupancy, 10) || 2);

const overCapacityInRooms = (rooms = [], sv) =>
  (Array.isArray(rooms) ? rooms : []).reduce(
    (n, rm) => n + Math.max(0, (rm?.allocatedTravellers || []).length - maxOccupancyOf(sv)),
    0
  );

/**
 * Day-level accommodation guardrail.
 *
 * A party may be split across more than one included property on the same
 * night (a twin-share plus a single, a lodge plus a camp), so "everyone has a
 * bed" is a property of the NIGHT rather than of any one service. What must
 * hold no matter how the party is spread:
 *   - no room over its contracted capacity;
 *   - no traveller holding a bed in two included properties that night;
 *   - between them, the included properties house the whole party.
 *
 * Alternatives/options are excluded from the coverage requirement and from the
 * night total, but they are still held to the allocation rules: an option that
 * overbooks a room or parks a traveller who is already bedded elsewhere that
 * night is a data error, not a cheaper choice.
 */
export const validateDayAccommodation = (day = {}, itineraryTravellers = []) => {
  const included = includedAccommodationsOnDay(day);
  const alternatives = (day?.services || []).filter(
    (sv) => isAccommodationService(sv) && sv.isOptional
  );
  if (!included.length && !alternatives.length) return { isValid: true, reason: '' };

  const travList = Array.isArray(itineraryTravellers) ? itineraryTravellers : [];
  if (!travList.length) return { isValid: true, reason: '' };

  /* An option is still held to its own room capacity — but nothing more. Its
     whole point is to list the same party as the property that is booked, so
     it is never compared against the included properties or other options. */
  for (const sv of alternatives) {
    const rooms = Array.isArray(sv.roomAllocations) ? sv.roomAllocations : [];
    if (!rooms.length) continue;

    const maxOcc = maxOccupancyOf(sv);
    const over = overCapacityInRooms(rooms, sv);
    if (over > 0) {
      return {
        isValid: false,
        reason: `Room over capacity in option ${sv.name || 'accommodation'} (Max ${maxOcc} per room)`,
        serviceKey: sv.key,
        service: sv,
        unallocatedCount: 0,
        overCapacityCount: over
      };
    }
  }

  if (!included.length) return { isValid: true, reason: '' };

  for (const sv of included) {
    if (!Array.isArray(sv.roomAllocations) || !sv.roomAllocations.length) {
      return {
        isValid: false,
        reason: `Room allocation required for ${sv.name || 'accommodation'} (${travList.length} travellers)`,
        serviceKey: sv.key,
        service: sv,
        unallocatedCount: travList.length,
        overCapacityCount: 0
      };
    }
  }

  for (const sv of included) {
    const maxOcc = Math.max(1, parseInt(sv.maxOccupancy, 10) || 2);
    const over = (sv.roomAllocations || []).reduce(
      (n, rm) => n + Math.max(0, (rm.allocatedTravellers || []).length - maxOcc),
      0
    );
    if (over > 0) {
      return {
        isValid: false,
        reason: `Room over capacity in ${sv.name || 'accommodation'} (Max ${maxOcc} per room)`,
        serviceKey: sv.key,
        service: sv,
        unallocatedCount: 0,
        overCapacityCount: over
      };
    }
  }

  const beds = bedsOnNight(included);

  for (const [key, holders] of beds) {
    if (holders.length < 2) continue;
    const traveller = travList.find((t) => travellerIdentity(t) === key);
    const names = [...new Set(holders.map((h) => h.name))];
    return {
      isValid: false,
      reason: `${travellerDisplayName(traveller)} is allocated to ${names.join(' and ')} on the same night`,
      serviceKey: holders[holders.length - 1].key,
      unallocatedCount: 0,
      overCapacityCount: 0
    };
  }

  /* Check by id-key first; fall back to name-key for travellers that have no
     real id (stored as plain JSONB with only name/surname/age in the itinerary
     row) and whose allocated-traveller counterpart got a synthetic modal id. */
  const missing = travList.filter((t) => !beds.has(travellerIdentity(t)) && !beds.has(travellerNameKey(t)));
  if (missing.length) {
    const named = missing.slice(0, 3).map(travellerDisplayName).join(', ');
    return {
      isValid: false,
      reason: `${missing.length} traveller(s) have no room on this night — ${named}${missing.length > 3 ? ', …' : ''}`,
      serviceKey: included[0]?.key,
      unallocatedCount: missing.length,
      overCapacityCount: 0
    };
  }

  return { isValid: true, reason: '', unallocatedCount: 0, overCapacityCount: 0 };
};

/**
 * Per-service view of the night-level guard, for the inline warning on a single
 * service row. A service only has to house the travellers who are not already
 * bedded down in another included property that night, so a split group reads
 * as valid instead of "6 traveller(s) unallocated".
 */
export const validateAccommodationServiceInDay = (serviceItem, dayServices = [], itineraryTravellers = []) => {
  if (!isAccommodationService(serviceItem)) return { isValid: true, reason: '' };

  const travList = Array.isArray(itineraryTravellers) ? itineraryTravellers : [];
  if (!travList.length) return { isValid: true, reason: '' };

  const rooms = Array.isArray(serviceItem.roomAllocations) ? serviceItem.roomAllocations : [];

  /* An option is a quote, not a bed: it may carry no allocation at all, and it
     quotes the same party as the property that is actually booked, so the
     double-booking rule below must not be applied to it. Only its rooms are
     checked. */
  if (serviceItem.isOptional) {
    if (!rooms.length) return { isValid: true, reason: '' };
    return {
      isValid: overCapacityInRooms(rooms, serviceItem) === 0,
      reason:
        overCapacityInRooms(rooms, serviceItem) === 0
          ? ''
          : `Room over capacity in option ${serviceItem.name || 'accommodation'} (Max ${maxOccupancyOf(serviceItem)} per room)`,
      unallocatedCount: 0,
      overCapacityCount: overCapacityInRooms(rooms, serviceItem)
    };
  }

  const siblings = (dayServices || []).filter(
    (sv) => isAccommodationService(sv) && !sv.isOptional && !isSameService(sv, serviceItem)
  );
  const elsewhere = bedsOnNight(siblings);
  const stillNeedABed = travList.filter(
    (t) => !elsewhere.has(travellerIdentity(t)) && !elsewhere.has(travellerNameKey(t))
  );

  if (!rooms.length) {
    if (!stillNeedABed.length) return { isValid: true, reason: '' };
    return {
      isValid: false,
      reason: `Room allocation required for ${serviceItem.name || 'accommodation'} (${stillNeedABed.length} travellers)`,
      unallocatedCount: stillNeedABed.length,
      overCapacityCount: 0
    };
  }

  const maxOcc = maxOccupancyOf(serviceItem);
  const overCapacityCount = overCapacityInRooms(rooms, serviceItem);
  if (overCapacityCount > 0) {
    return {
      isValid: false,
      reason: `Room over capacity in ${serviceItem.name || 'accommodation'} (Max ${maxOcc} per room)`,
      unallocatedCount: 0,
      overCapacityCount
    };
  }

  const own = bedsOnNight([serviceItem]);
  for (const traveller of travList) {
    const idKey = travellerIdentity(traveller);
    const nameKey = travellerNameKey(traveller);
    const other = own.has(idKey) || own.has(nameKey)
      ? elsewhere.get(idKey) || elsewhere.get(nameKey)
      : null;
    if (!other) continue;
    return {
      isValid: false,
      reason: `${travellerDisplayName(traveller)} is already allocated to ${other.map((o) => o.name).join(', ')} on this night`,
      unallocatedCount: 0,
      overCapacityCount: 0
    };
  }

  return { isValid: true, reason: '', unallocatedCount: 0, overCapacityCount: 0 };
};
