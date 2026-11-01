import { round2, vatOfInclusive } from './invoiceDoc';
import {
  baseSingleSupplement,
  normaliseSingleSupplementLadder,
  singleSupplementForOrdinal
} from './singleSupplement';
import { roomTypesOf, soldRoomCapacity } from './roomTypes';
import { isOccupancyTiered, occupancyRateForPax } from './occupancyPricing';
import { staffRoomLadder, staffRoomRates, staffRateValue, hasStaffRate } from './staffRoomTiers';

export const isAdultTraveller = (t) => {
  if (!t) return true;
  const age = parseInt(t.age, 10);
  if (Number.isNaN(age)) return true;
  return age >= 18;
};

/* Staff/traveller role helpers */
export const normaliseTravellerRole = (role) => {
  const r = String(role || '').trim().toLowerCase();
  if (r === 'tour_leader' || r === 'tourleader' || r === 'leader') return 'tour_leader';
  if (r === 'tour_guide' || r === 'tourguide' || r === 'guide') return 'tour_guide';
  if (r === 'driver') return 'driver';
  if (r === 'client') return 'client';
  return 'client';
};

export const payingClientCount = (travellers = []) => {
  const list = Array.isArray(travellers) ? travellers : [];
  return list.filter((t) => normaliseTravellerRole(t?.role) === 'client').length;
};

export const tourLeaderCount = (travellers = []) => {
  const list = Array.isArray(travellers) ? travellers : [];
  return list.filter((t) => normaliseTravellerRole(t?.role) === 'tour_leader').length;
};

export const tourGuideCount = (travellers = []) => {
  const list = Array.isArray(travellers) ? travellers : [];
  return list.filter((t) => normaliseTravellerRole(t?.role) === 'tour_guide').length;
};

// Travellers + Tour Leaders only - used for guide expenses split
// Tour Guide is EXCLUDED even though they're in the traveller list
export const travellersPlusTlCount = (travellers = []) => {
  const list = Array.isArray(travellers) ? travellers : [];
  return list.filter((t) => {
    const r = normaliseTravellerRole(t?.role);
    return r === 'client' || r === 'tour_leader';
  }).length;
};

// Rooms allocated to client group only - excludes staff rooms
export const clientRoomsBooked = (allocations = []) => {
  const list = Array.isArray(allocations) ? allocations : [];
  return list.filter((rm) => {
    if (!rm) return false;
    if (rm.roomType === 'staff' || rm.isStaffRoom === true) return false;
    if (rm.staffRole) return false;
    const occs = Array.isArray(rm.allocatedTravellers) ? rm.allocatedTravellers : [];
    // Tour guide or driver must never be counted as client room
    if (occs.some((t) => {
      const r = normaliseTravellerRole(t?.role);
      return r === 'tour_guide' || r === 'driver';
    })) {
      return false;
    }
    // Tour leader taking their own room does not count towards client rooms
    if (occs.length === 1 && normaliseTravellerRole(occs[0]?.role) === 'tour_leader') {
      return false;
    }
    return true;
  }).length;
};

/* True when any room houses staff rather than paying guests only — a staff
   room, a named staff role, or an occupant with a staff role. Those beds are
   absorbed by the paying clients, so the accommodation line is divided across
   the clients alone. */
export const hasStaffAccommodation = (allocations = []) => (Array.isArray(allocations) ? allocations : [])
  .some((rm) => {
    if (!rm) return false;
    if (rm.roomType === 'staff' || rm.isStaffRoom === true || rm.staffRole) return true;
    const occupants = Array.isArray(rm.allocatedTravellers) ? rm.allocatedTravellers : [];
    return occupants.some((t) => {
      const role = normaliseTravellerRole(t?.role);
      return role === 'tour_leader' || role === 'tour_guide' || role === 'driver';
    });
  });

export const buildShareContext = ({ travellers = [], allocations = [] } = {}) => {
  const payingClients = payingClientCount(travellers);
  const tourLeaders = tourLeaderCount(travellers);
  const tourGuides = tourGuideCount(travellers);
  const travellersPlusTl = travellersPlusTlCount(travellers);
  const clientRooms = clientRoomsBooked(allocations);
  return {
    payingClients,
    tourLeaders,
    tourGuides,
    travellersPlusTl,
    clientRoomsBooked: clientRooms,
    paxCount: payingClients > 0 ? payingClients : Math.max(1, (Array.isArray(travellers) ? travellers.length : 1))
  };
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
} = {}) => {
  /* The room that priced this line owns its beds. Falling back to the
     property-wide figure is what let a two-bed room read as three elsewhere. */
  const capacity = soldRoomCapacity({
    rooms: roomTypesOf(base),
    rate: modalRates[0] || null,
    roomTypeId: service?.roomTypeId || service?.room_type_id,
    roomType: service?.roomType || service?.room_type,
    fallback: service?.maxOccupancy || base.maxOccupancy || base.max_occupancy
  });
  return {
    ...base,
    id: service?.itemId ?? base.id,
    name: base.name || service?.name || '',
    category: base.category || service?.category || '',
    maxOccupancy: capacity.maxOccupancy || service?.maxOccupancy || base.maxOccupancy || base.max_occupancy,
    maxAdults: capacity.maxAdults,
    maxChildren: capacity.maxChildren,
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
  };
};

/* The same resolution for a saved line: it carries the room id/name, the
   library carries the room record. Used by the save guard and the inline
   warning, which only ever see the day's services. */
export const serviceRoomCapacity = (service, libraryItems = []) => {
  const item = (Array.isArray(libraryItems) ? libraryItems : [])
    .find((candidate) => String(candidate?.id) === String(service?.itemId)) || null;
  const rates = Array.isArray(service?.item_rates) && service.item_rates.length
    ? service.item_rates
    : (Array.isArray(item?.item_rates) ? item.item_rates : []);
  const roomId = service?.roomTypeId || service?.room_type_id || '';
  const rate = (roomId && rates.find((row) => String(row?.room_type_id || '') === String(roomId)))
    || rates[0]
    || null;
  return soldRoomCapacity({
    rooms: roomTypesOf(item),
    rate,
    roomTypeId: roomId,
    roomType: service?.roomType || service?.room_type,
    fallback: service?.maxOccupancy ?? service?.max_occupancy
  });
};

/* A copy of the service with the sold room's capacity attached, so the
   validator can judge adult and child counts rather than only a total. */
export const withRoomCapacity = (service, libraryItems = []) => {
  if (!isAccommodationService(service)) return service;
  const capacity = serviceRoomCapacity(service, libraryItems);
  if (!capacity.maxOccupancy) return service;
  return {
    ...service,
    maxOccupancy: capacity.maxOccupancy,
    maxAdults: capacity.maxAdults,
    maxChildren: capacity.maxChildren
  };
};

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

   A single-supplement ladder changes the solo price: a property may let the
   first N singles go at the sharing rate and charge a supplement only from
   single N+1, sometimes at a reduced figure. The ladder is counted per night
   (this function prices one accommodation line), and a solo child consumes a
   slot just like a solo adult. Only paying-client rooms consume a slot; staff,
   guide and tour-leader rooms keep their own pricing. Without a ladder the solo
   guest pays the plain single rate, unchanged.

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
  /* Children in their own room: some properties charge the standard adult
     rates, others charge one single room rate for the whole children-only
     room. Absent or unknown values keep the legacy child band rates. */
  const ownRoomPolicy = String(item?.children_own_room_policy || item?.childrenOwnRoomPolicy || 'child_rates');
  const childrenAsAdults = ownRoomPolicy === 'adult_rates';
  const childrenSingleRoom = ownRoomPolicy === 'single_room_rate';
  /* Flat room rate: unit_price is the room, price_1_adult / single_room_rate is
     the single-room figure. Both are totals for the room, never per person. */
  const isFlatRoom = String(rate?.rate_basis || '') === 'per_room';
  const flatRoomPrice = parseFloat(rate?.unit_price) || parseFloat(rate?.double_twin_rate) || parseFloat(rate?.price_2_adults) || 0;
  const flatSinglePrice = parseFloat(rate?.single_room_rate) || parseFloat(rate?.effective_single_rate) || parseFloat(rate?.price_1_adult) || flatRoomPrice;
  /* A villa or apartment sold on an occupancy ladder: the room's own occupant
     count picks the band and every head in it pays that figure. The adult columns,
     the child bands and the single supplement are all inert on such a room, which
     is why this branch sits ahead of every one of them. */
  const occupancyPriced = isOccupancyTiered(rate);

  // Tour Leader deal, priced off client rooms only. A season may carry a ladder
  // of thresholds (e.g. 10 client rooms -> 1 free TL room, 20 -> 2 free). Each
  // tier states the total number of TL rooms included once that many client
  // rooms are booked, and the rate for the rooms it adds; a later threshold can
  // add rooms at a different rate (first free, second discounted). Without a
  // ladder the legacy single threshold on the item still opens one TL room.
  const clientRooms = clientRoomsBooked(roomAllocations);
  const tlOffered = item?.tour_leader_room_offered === true || item?.tourLeaderRoomOffered === true;
  const tlMinRooms = Math.max(1, Number(item?.tour_leader_min_rooms || item?.tourLeaderMinRooms) || 1);
  /* A rate the operator never entered falls back to the single rate; a typed 0
     is a free room and has to survive. */
  const tlRateRaw = rate?.tour_leader_rate;
  const tlRateConfigured = tlRateRaw !== null && tlRateRaw !== undefined && tlRateRaw !== '';
  const tlRate = tlRateConfigured ? (parseFloat(tlRateRaw) || 0) : singlePrice;
  const tlLadder = tlOffered
    ? (Array.isArray(rate?.tour_leader_tiers) ? rate.tour_leader_tiers : [])
        .filter((tier) => tier && tier.rate !== null && tier.rate !== undefined && tier.rate !== '' && Number.isFinite(Number(tier.rate)))
        .map((tier) => ({
          minRooms: Math.max(0, Math.round(Number(tier.minClientRooms ?? tier.min_rooms) || 0)),
          rooms: Math.max(1, Math.floor(Number(tier.rooms) || 1)),
          rate: Number(tier.rate)
        }))
        .sort((a, b) => a.minRooms - b.minRooms)
    : [];
  const tlTiers = tlOffered ? (tlLadder.length ? tlLadder : [{ minRooms: tlMinRooms, rooms: 1, rate: tlRate }]) : [];
  /* Rate for each included TL room, in room order. Rooms a threshold adds keep
     that threshold's rate; a tier that adds no room is a rate band over the
     rooms already included (1–10 client rooms @ 800, 11+ @ 650). */
  const tlIncludedRates = staffRoomRates(tlTiers, clientRooms);
  const tlFirstThreshold = tlTiers[0]?.minRooms ?? tlMinRooms;
  let tlRoomsCharged = 0;
  /* Guide and driver room deals use the same ladder as the TL deal: a property
     includes one or more guide / driver rooms once enough paying client rooms
     are booked. Each party has its own rule; rooms beyond the allowance (or a
     property that does not offer the deal) pay the normal single rate.

     A configured flat rate or a stored ladder counts as offering the deal even
     when the older "guide & driver room offered" switch was never ticked, so
     existing contracts keep pricing as they did. */
  const guideDriverOffered = item?.guide_driver_room_offered === true || item?.guideDriverRoomOffered === true;
  /* One threshold gates both parties: a property states "from N client rooms
     the guide / driver room is released", not a separate rule per party. */
  const staffMinRooms = Math.max(1, Number(item?.guide_min_rooms ?? item?.guideMinRooms) || 1);
  const guideTiersRaw = rate?.guide_tiers ?? rate?.guideTiers;
  const driverTiersRaw = rate?.driver_tiers ?? rate?.driverTiers;
  const guideLadder = staffRoomLadder({
    offered: guideDriverOffered || hasStaffRate(rate?.guide_rate ?? rate?.guideRate) || !!guideTiersRaw?.length,
    tiers: guideTiersRaw,
    minRooms: staffMinRooms,
    rate: staffRateValue(rate?.guide_rate ?? rate?.guideRate, singlePrice)
  });
  const guideIncludedRates = staffRoomRates(guideLadder, clientRooms);
  const driverLadder = staffRoomLadder({
    offered: guideDriverOffered || hasStaffRate(rate?.driver_rate ?? rate?.driverRate) || !!driverTiersRaw?.length,
    tiers: driverTiersRaw,
    minRooms: staffMinRooms,
    rate: staffRateValue(rate?.driver_rate ?? rate?.driverRate, singlePrice)
  });
  const driverIncludedRates = staffRoomRates(driverLadder, clientRooms);
  let guideRoomsCharged = 0;
  let driverRoomsCharged = 0;

  /* Single-supplement ladder for this night. Ordinals count the paying-client
     single rooms in allocation order, so the first waived room is the one
     listed first. Flat rooms do not consume a slot (they are charged per room,
     not per guest) and neither do staff / TL rooms. */
  const singleLadder = normaliseSingleSupplementLadder(rate);
  const singleSuppBase = baseSingleSupplement(rate, sharingPrice, singlePrice);
  let singleOrdinal = 0;

  let totalBuy = 0;
  let totalSell = 0;
  /* Rooms the ladder cannot price: a party size the supplier does not sell the
     room at. They are charged nothing and named here so the charge dialog can say
     so beside the total, rather than a villa quietly contributing R0. */
  const unpricedRooms = [];

  const roomsWithCharges = roomAllocations.map((rm, idx) => {
    const occupants = rm.allocatedTravellers || [];
    const adults = occupants.filter(isAdultTraveller).length;
    const children = occupants.length - adults;
    const isSoloTourLeader = (occupants.length === 1 && normaliseTravellerRole(occupants[0]?.role) === 'tour_leader') || rm?.staffRole === 'tour_leader';
    const isTourGuide = occupants.some((t) => normaliseTravellerRole(t?.role) === 'tour_guide') || rm?.staffRole === 'tour_guide';
    const isTourDriver = occupants.some((t) => normaliseTravellerRole(t?.role) === 'driver') || rm?.staffRole === 'driver';
    const isStaffRoom = (rm?.roomType === 'staff' || rm?.isStaffRoom === true) && !isSoloTourLeader;

    let roomBuy = 0;
    let rateDescription = '';

    if (occupants.length === 0) {
      roomBuy = 0;
      rateDescription = 'Empty room (0 guests)';
    } else if (isSoloTourLeader) {
      const includedRate = tlRoomsCharged < tlIncludedRates.length ? tlIncludedRates[tlRoomsCharged] : null;
      if (includedRate !== null && includedRate !== undefined) {
        tlRoomsCharged += 1;
        roomBuy = includedRate;
        const included = tlIncludedRates.length;
        rateDescription = included > 1
          ? `Tour Leader Room Rate: ${round2(includedRate).toFixed(2)} (TL room ${tlRoomsCharged} of ${included} included: ${clientRooms} client rooms booked)`
          : `Tour Leader Room Rate: ${round2(includedRate).toFixed(2)} (Threshold of ${tlFirstThreshold} client rooms met)`;
      } else {
        roomBuy = singlePrice;
        rateDescription = tlIncludedRates.length
          ? `Tour Leader Single Rate: ${singlePrice.toFixed(2)} (TL allowance of ${tlIncludedRates.length} room(s) used: ${clientRooms} client rooms booked)`
          : `Tour Leader Single Rate: ${singlePrice.toFixed(2)}${tlOffered ? ` (Threshold of ${tlFirstThreshold} client rooms not met: ${clientRooms} booked)` : ''}`;
      }
    } else if (isTourDriver || isTourGuide || isStaffRoom) {
      const staffNames = occupants.map((t) => t.name).filter(Boolean).join(', ') || 'Staff';
      const isDriverRoom = isTourDriver;
      const label = isDriverRoom ? 'Driver' : isTourGuide ? 'Guide' : 'Staff';
      const ladder = isDriverRoom ? driverLadder : guideLadder;
      const includedRates = isDriverRoom ? driverIncludedRates : guideIncludedRates;
      const chargedAlready = isDriverRoom ? driverRoomsCharged : guideRoomsCharged;
      const includedRate = includedRates[chargedAlready];
      const firstThreshold = ladder[0]?.minRooms;

      if (includedRate !== undefined) {
        if (isDriverRoom) driverRoomsCharged += 1;
        else if (isTourGuide) guideRoomsCharged += 1;
        roomBuy = includedRate;
        rateDescription = includedRates.length > 1
          ? `${label} Room Rate (${staffNames}): ${round2(includedRate).toFixed(2)} (${label.toLowerCase()} room ${chargedAlready + 1} of ${includedRates.length} included: ${clientRooms} client rooms booked)`
          : `${label} Room Rate (${staffNames}): ${round2(includedRate).toFixed(2)} (Threshold of ${firstThreshold} client rooms met)`;
      } else {
        roomBuy = singlePrice;
        rateDescription = includedRates.length
          ? `${label} Single Rate (${staffNames}): ${singlePrice.toFixed(2)} (allowance of ${includedRates.length} ${label.toLowerCase()} room(s) used: ${clientRooms} client rooms booked)`
          : ladder.length
            ? `${label} Single Rate (${staffNames}): ${singlePrice.toFixed(2)} (Threshold of ${firstThreshold} client rooms not met: ${clientRooms} booked)`
            : `${label} Single Rate (${staffNames}): ${singlePrice.toFixed(2)}`;
      }
    } else if (occupancyPriced) {
      /* The band is chosen by how many sleep in THIS room, not by how many adults
         answer to it: a villa holding one adult and two children is a 3 pax villa
         and all three pay the 3 pax figure. */
      const perHead = occupancyRateForPax(rate, occupants.length);
      if (perHead === null) {
        roomBuy = 0;
        rateDescription = `${occupants.length} Guests (not sold at ${occupants.length} pax)`;
        unpricedRooms.push({
          roomId: rm.roomId || idx + 1,
          occupants: occupants.length,
          reason: `${rm.roomName || `Room ${idx + 1}`} is not sold at ${occupants.length} pax, so it cannot be priced.`
        });
      } else {
        roomBuy = round2(perHead * occupants.length);
        rateDescription = occupants.length === 1
          ? `1 Guest (Occupancy Band: ${perHead.toFixed(2)} each)`
          : `${occupants.length} Guests (Occupancy Band: ${perHead.toFixed(2)} each = ${roomBuy.toFixed(2)})`;
      }
    } else if (isFlatRoom) {
      /* One charge for the room: the single-room figure when a lone traveller
         has it to themselves, otherwise the flat room rate. */
      const alone = occupants.length === 1;
      roomBuy = alone ? flatSinglePrice : flatRoomPrice;
      rateDescription = alone
        ? `1 Guest (Flat Single Room Rate: ${round2(roomBuy).toFixed(2)})`
        : `${occupants.length} Guests (Flat Room Rate: ${round2(roomBuy).toFixed(2)})`;
    } else if (occupants.length === 1) {
      singleOrdinal += 1;
      const ladderTop = singleLadder.length ? singleLadder[singleLadder.length - 1].singles : 0;
      const onLadder = singleLadder.length > 0 && singleOrdinal <= ladderTop;
      const supplement = onLadder
        ? singleSupplementForOrdinal(singleLadder, singleSuppBase, singleOrdinal)
        : singleSuppBase;
      const soloLadderPrice = sharingPrice + supplement;
      if (adults === 1 || childrenAsAdults) {
        if (!singleLadder.length) {
          roomBuy = singlePrice;
          rateDescription = `1 Guest (Single Rate: ${singlePrice.toFixed(2)})`;
        } else if (onLadder && supplement === 0) {
          roomBuy = sharingPrice;
          rateDescription = `1 Guest (Single ${singleOrdinal} of ${ladderTop} waived: sharing rate ${round2(sharingPrice).toFixed(2)})`;
        } else if (onLadder) {
          roomBuy = round2(soloLadderPrice);
          rateDescription = `1 Guest (Single ${singleOrdinal} of ${ladderTop}: sharing ${round2(sharingPrice).toFixed(2)} + supplement ${round2(supplement).toFixed(2)})`;
        } else {
          roomBuy = round2(soloLadderPrice);
          rateDescription = `1 Guest (Single ${singleOrdinal} beyond the ladder: sharing ${round2(sharingPrice).toFixed(2)} + supplement ${round2(supplement).toFixed(2)})`;
        }
      } else if (childrenSingleRoom) {
        /* The property charges one single room rate; the supplement ladder
           (a waiver on solo adults) does not discount it. The room still
           occupies a single slot for rooms priced after it. */
        roomBuy = singlePrice;
        rateDescription = `1 Child (Single Room Rate: ${round2(roomBuy).toFixed(2)})`;
      } else {
        const soloChild = childRateForAge(rate, parseFloat(occupants[0].age), ageRanges, sharingPrice);
        if (soloChild.known) {
          roomBuy = soloChild.rate;
          rateDescription = `1 Child (Child Rate: ${soloChild.rate.toFixed(2)})`;
        } else if (!singleLadder.length) {
          roomBuy = singlePrice;
          rateDescription = `1 Child (Single Rate: ${singlePrice.toFixed(2)})`;
        } else if (onLadder && supplement === 0) {
          roomBuy = sharingPrice;
          rateDescription = `1 Child (Single ${singleOrdinal} of ${ladderTop} waived: sharing rate ${round2(sharingPrice).toFixed(2)})`;
        } else {
          roomBuy = round2(soloLadderPrice);
          rateDescription = `1 Child (Single ${singleOrdinal}${onLadder ? ` of ${ladderTop}` : ' beyond the ladder'}: sharing ${round2(sharingPrice).toFixed(2)} + supplement ${round2(supplement).toFixed(2)})`;
        }
      }
    } else if (adults === 0 && childrenAsAdults) {
      /* Children in their own room price exactly as adults would: the first
         two at the sharing rate, extras at the 3+ rate. */
      const baseChildren = Math.min(children, 2);
      const extraChildren = Math.max(0, children - 2);
      roomBuy = baseChildren * sharingPrice + extraChildren * extraAdultPrice;
      rateDescription = extraChildren > 0
        ? `${baseChildren} Child(ren) (Adult Sharing Rate: ${sharingPrice.toFixed(2)}) + ${extraChildren} Extra Child(ren) (Adult Rate: ${extraAdultPrice.toFixed(2)})`
        : `${baseChildren} Child(ren) (Adult Sharing Rate: ${sharingPrice.toFixed(2)} each)`;
    } else if (adults === 0 && childrenSingleRoom) {
      /* The property charges one single room rate for the whole children-only
         room, no matter how many children it holds. */
      roomBuy = singlePrice;
      rateDescription = `${children} Child(ren) (Single Room Rate: ${round2(roomBuy).toFixed(2)})`;
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
    totalExcl,
    unpricedRooms
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

/* A guide & driver overnight is a charge on the itinerary, not a bed for a
   traveller, so it is never counted as client accommodation. Both spellings are
   honoured because the itinerary carries camelCase and a loaded package row
   carries snake_case. */
export const isAccommodationService = (sv) => sv?.guideOnly !== true && sv?.guide_only !== true
  && /accommodation/i.test(sv?.category || '');

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
  const capacity = roomCapacityOfService(serviceItem);
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
  let overflowReason = '';

  roomAllocations.forEach((rm) => {
    const overflow = roomOverflow(rm, capacity);
    if (overflow.over > 0) {
      overCapacityCount += overflow.over;
      overflowReason = overflowReason || roomOverflowReason(serviceItem.name, capacity, overflow);
    }
    (rm.allocatedTravellers || []).forEach((tr, i) => {
      const id = tr.id || `${tr.name}_${tr.surname}_${i}`;
      allocatedMap.add(id);
    });
  });

  const unallocatedCount = Math.max(0, travList.length - allocatedMap.size);

  if (overCapacityCount > 0) {
    return {
      isValid: false,
      reason: overflowReason || `Room over capacity in ${serviceItem.name} (Max ${maxOcc} per room)`,
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

/* A room's contract states beds, adults and children separately. Adults and
   children are only enforced when the room actually states them — an older
   line carries a total alone and must not be judged against a child slot the
   contract never had. */
const statedCap = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

export const roomCapacityOfService = (sv) => ({
  maxOccupancy: maxOccupancyOf(sv),
  maxAdults: statedCap(sv?.maxAdults ?? sv?.max_adults),
  maxChildren: statedCap(sv?.maxChildren ?? sv?.max_children)
});

export const roomOverflow = (room, capacity) => {
  const occupants = Array.isArray(room?.allocatedTravellers) ? room.allocatedTravellers : [];
  const adults = occupants.filter(isAdultTraveller).length;
  const children = occupants.length - adults;
  const overTotal = Math.max(0, occupants.length - capacity.maxOccupancy);
  const overAdults = capacity.maxAdults === null ? 0 : Math.max(0, adults - capacity.maxAdults);
  const overChildren = capacity.maxChildren === null ? 0 : Math.max(0, children - capacity.maxChildren);
  return { adults, children, overTotal, overAdults, overChildren, over: overTotal + overAdults + overChildren };
};

export const roomOverflowReason = (label, capacity, overflow) => {
  if (overflow.overAdults > 0) {
    return `Room over adult capacity in ${label} (Max ${capacity.maxAdults} adult${capacity.maxAdults === 1 ? '' : 's'} per room)`;
  }
  if (overflow.overChildren > 0) {
    return `Room over child capacity in ${label} (Max ${capacity.maxChildren} child${capacity.maxChildren === 1 ? '' : 'ren'} per room)`;
  }
  return `Room over capacity in ${label} (Max ${capacity.maxOccupancy} per room)`;
};

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

    const capacity = roomCapacityOfService(sv);
    const overflow = rooms
      .map((rm) => roomOverflow(rm, capacity))
      .reduce((worst, entry) => (entry.over > worst.over ? entry : worst), { over: 0 });
    if (overflow.over > 0) {
      return {
        isValid: false,
        reason: roomOverflowReason(`option ${sv.name || 'accommodation'}`, capacity, overflow),
        serviceKey: sv.key,
        service: sv,
        unallocatedCount: 0,
        overCapacityCount: overflow.over
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
    const capacity = roomCapacityOfService(sv);
    const worst = (sv.roomAllocations || [])
      .map((rm) => roomOverflow(rm, capacity))
      .reduce((entry, next) => (next.over > entry.over ? next : entry), { over: 0 });
    if (worst.over > 0) {
      return {
        isValid: false,
        reason: roomOverflowReason(sv.name || 'accommodation', capacity, worst),
        serviceKey: sv.key,
        service: sv,
        unallocatedCount: 0,
        overCapacityCount: worst.over
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
    const capacity = roomCapacityOfService(serviceItem);
    const worst = rooms
      .map((rm) => roomOverflow(rm, capacity))
      .reduce((entry, next) => (next.over > entry.over ? next : entry), { over: 0 });
    return {
      isValid: worst.over === 0,
      reason: worst.over === 0
        ? ''
        : roomOverflowReason(`option ${serviceItem.name || 'accommodation'}`, capacity, worst),
      unallocatedCount: 0,
      overCapacityCount: worst.over
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

  const capacity = roomCapacityOfService(serviceItem);
  const worstRoom = rooms
    .map((rm) => roomOverflow(rm, capacity))
    .reduce((entry, next) => (next.over > entry.over ? next : entry), { over: 0 });
  const overCapacityCount = worstRoom.over;
  if (overCapacityCount > 0) {
    return {
      isValid: false,
      reason: roomOverflowReason(serviceItem.name || 'accommodation', capacity, worstRoom),
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
