/* Lodging hierarchy helpers.
 *
 * Supplier -> accommodation library item (the property) -> room type -> rate plan.
 * Everything here is pure so the same rules run in the builder, the package
 * engine, the rate card and the tests. A rate row carries its room's id, name
 * and capacity, which lets a snapshot price a line without a second lookup.
 */

import { pricedCapacity } from './occupancyPricing';

const intOr = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/* How many children a room takes. A property that does not split its guests by
   age states nothing, and that is a different contract from a room that takes
   no children: null means any guest can take any bed, so only the room's total
   caps it, while 0 means a child cannot be placed in it at all. A figure above
   the beds is a typing mistake, not a wider room, so it reads as the room full
   of children. */
const childCapOf = (value, maxOccupancy) => {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(Math.max(1, maxOccupancy), parsed));
};

export const normalizeRoomType = (row = {}) => {
  const maxOccupancy = Math.max(1, intOr(row.max_occupancy ?? row.maxOccupancy, 2));
  const maxChildren = childCapOf(row.max_children ?? row.maxChildren, maxOccupancy);
  const childPolicy = String(row.child_policy ?? row.childPolicy ?? (maxChildren === 0 ? 'adults_only' : 'standard')).trim();
  const rawChildAgeRanges = row.child_age_ranges ?? row.childAgeRanges;
  const childAgeRanges = Array.isArray(rawChildAgeRanges) ? rawChildAgeRanges : [];
  const rawSharingRules = row.sharing_capacity_rules ?? row.sharingCapacityRules;
  return {
    key: String(row.id || row.key || ''),
    id: row.id || null,
    name: String(row.name ?? row.room_type ?? '').trim(),
    description: String(row.description ?? '').trim(),
    maxOccupancy,
    maxAdults: Math.max(1, Math.min(maxOccupancy, intOr(row.max_adults ?? row.maxAdults, maxOccupancy))),
    maxChildren,
    childPolicy,
    childAgeRanges,
    hasChildAgeRanges: row.hasChildAgeRanges ?? Array.isArray(rawChildAgeRanges),
    sharingCapacityRules: Array.isArray(rawSharingRules) ? rawSharingRules : [],
    hasSharingCapacityRules: row.hasSharingCapacityRules ?? Array.isArray(rawSharingRules),
    pricingModel: String(row.pricing_model ?? row.pricingModel ?? '').trim(),
    sortOrder: intOr(row.sort_order ?? row.sortOrder, 0)
  };
};

export const roomAllowsChildren = (room) => (
  room?.maxChildren !== 0 && room?.childPolicy !== 'adults_only' && room?.childPolicy !== 'no_children'
);

export const roomIsFlatRate = (room) => (
  room?.pricingModel === 'per_unit' || room?.childPolicy === 'flat_rate'
);

export const normalizeRoomTypes = (rows) => (Array.isArray(rows) ? rows : [])
  .filter((row) => row && (row.id || row.key || row.name))
  .map(normalizeRoomType)
  .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name));

export const roomTypesOf = (item) => {
  const candidates = [item?.roomTypes, item?.room_types, item?._room_types];
  const found = candidates.find((value) => Array.isArray(value) && value.length > 0);
  return normalizeRoomTypes(found || candidates.find(Array.isArray) || []);
};

export const roomTypeNameOf = (room) => String(room?.name || '').trim();

export const roomTypeKeyOf = (room) => String(room?.key || room?.id || '');

export const roomForAllocation = (rooms, allocation) => {
  const list = (Array.isArray(rooms) ? rooms : []).map(normalizeRoomType);
  const id = String(allocation?.roomTypeId ?? allocation?.room_type_id ?? '');
  if (id) {
    const byId = list.find((room) => String(room.id || room.key) === id);
    if (byId) return byId;
  }
  const name = String(allocation?.roomType ?? allocation?.room_type ?? '').trim().toLowerCase();
  return name ? list.find((room) => room.name.toLowerCase() === name) || null : null;
};

export const childAgeRangesForAllocation = (item, allocation) => {
  const room = roomForAllocation(roomTypesOf(item), allocation);
  if (room?.hasChildAgeRanges) return room.childAgeRanges;
  const fallback = item?.child_age_ranges ?? item?.childAgeRanges;
  return Array.isArray(fallback) ? fallback : [];
};

const rateRoomTypeId = (rate) => String(rate?.room_type_id ?? rate?.roomTypeId ?? '').trim();
const rateRoomTypeName = (rate) => String(rate?.room_type ?? rate?.roomType ?? rate?.room_name ?? '').trim();
const normRoomName = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const roomIdsOf = (room) => {
  const ids = [room?.id, room?.key, room?.room_type_id, room?.roomTypeId]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  return [...new Set(ids)];
};

/* The room a rate row prices. Older rows have no room, so a null answer means
   "this rate belongs to the item as a whole" and every caller keeps its legacy
   behaviour. */
export const roomForRate = (rate, rooms) => {
  if (!rate) return null;
  const list = Array.isArray(rooms) ? rooms : [];
  const id = rateRoomTypeId(rate);
  if (id) {
    const byId = list.find((room) => roomIdsOf(room).includes(id));
    if (byId) return byId;
  }
  const name = normRoomName(rateRoomTypeName(rate));
  if (name) {
    const byName = list.find((room) => normRoomName(roomTypeNameOf(room)) === name);
    if (byName) return byName;
  }
  return null;
};

export const roomMatchesRate = (room, rate) => {
  if (!room || !rate) return false;
  const rateId = rateRoomTypeId(rate);
  if (rateId && roomIdsOf(room).includes(rateId)) return true;
  const roomName = normRoomName(roomTypeNameOf(room));
  const rateName = normRoomName(rateRoomTypeName(rate));
  return !!roomName && !!rateName && roomName === rateName;
};

/* Every rate for one room. A pool where no row names a room is the item's
   legacy matrix: every room keeps pricing on it. But once rows name rooms, a
   room with none of its own has no price — falling back to the pool would
   offer a villa the Luxury Room's seasons and validity on a drop. A null room
   (a caller that never had one) still reads the whole pool.

   If rates are room-scoped but none match this room directly, try to recover
   orphaned rates (room-scoped rates that match no known room). This prevents
   false "no seasons priced" when room ids/names are stale or inconsistent. */
export const ratesForRoom = (rates, room, allRooms = []) => {
  const list = Array.isArray(rates) ? rates : [];
  if (!room) return list;
  const scoped = list.filter((rate) => roomMatchesRate(room, rate));
  if (scoped.length) return scoped;
  const roomScopedPool = list.some((rate) => rateRoomTypeId(rate) || rateRoomTypeName(rate));
  if (!roomScopedPool) return list;

  const knownRooms = (Array.isArray(allRooms) ? allRooms : []).filter(Boolean);
  if (knownRooms.length === 0) return [];
  const orphans = list.filter((rate) => !knownRooms.some((known) => roomMatchesRate(known, rate)));
  if (!orphans.length) return [];

  // Recover only orphans that plausibly belong to this room. Rates that clearly
  // name a different room must not leak across rooms.
  const roomName = normRoomName(roomTypeNameOf(room));
  const recoverable = orphans.filter((rate) => {
    const rateName = normRoomName(rateRoomTypeName(rate));
    if (!rateName) return true; // no name - id may be stale; recoverable if room is the only plausible owner
    if (roomName && rateName === roomName) return true;
    return false;
  });
  if (!recoverable.length) return [];

  if (knownRooms.length === 1) return recoverable;

  // If this is the only known room with no direct matches, it's the safest owner
  // for otherwise-unmatched recoverable rates.
  const unmatched = knownRooms.filter((known) => !list.some((rate) => roomMatchesRate(known, rate)));
  if (unmatched.length === 1) {
    const only = unmatched[0];
    const same = roomIdsOf(only).some((id) => roomIdsOf(room).includes(id))
      || normRoomName(roomTypeNameOf(only)) === roomName;
    if (same) return recoverable;
  }

  // As a last resort, only return rates whose name explicitly matches this room.
  const explicitNameMatches = recoverable.filter((rate) => {
    const rateName = normRoomName(rateRoomTypeName(rate));
    return !!roomName && !!rateName && rateName === roomName;
  });
  return explicitNameMatches;
};

/* Rooms derived from rate rows alone. Used where only the rate snapshot is at
   hand (a package line reloaded, a partner quotation, an exported card). */
export const roomsFromRates = (rates) => {
  const list = Array.isArray(rates) ? rates : [];
  const seen = new Map();
  list.forEach((rate) => {
    const id = rateRoomTypeId(rate);
    const name = rateRoomTypeName(rate);
    const key = id || name;
    if (!key || seen.has(key)) return;
    seen.set(key, normalizeRoomType({
      id: id || null,
      key,
      name,
      max_occupancy: rate.room_max_occupancy,
      max_adults: rate.room_max_adults,
      max_children: rate.room_max_children,
      pricing_model: rate.rate_basis
    }));
  });
  return [...seen.values()];
};

/* A room's capacity for the line: the room record when it is loaded, the copy
   taken onto the rate row when it is not. A villa on an occupancy ladder stops
   where its ladder stops - a party above the top band has no price, so the beds
   above it are not a capacity the operator can sell. */
export const rateRoomCapacity = (rate, fallback = 2) => pricedCapacity(
  rate,
  Math.max(1, intOr(rate?.room_max_occupancy, intOr(fallback, 2)))
);

export const roomCapacityOf = (room, fallback = 2) => Math.max(
  1,
  intOr(room?.maxOccupancy ?? room?.max_occupancy, intOr(fallback, 2))
);

export const roomOccupancyForRate = (rate, fallback = 2) => {
  const maxOccupancy = rateRoomCapacity(rate, fallback);
  return {
    maxOccupancy,
    maxAdults: Math.max(1, Math.min(maxOccupancy, intOr(rate?.room_max_adults, maxOccupancy))),
    maxChildren: childCapOf(rate?.room_max_children, maxOccupancy)
  };
};

/* The capacity of the room a line actually sold. The room record wins, then
   the figures copied onto the rate row, then whatever the caller already had.
   A null adult/child figure means no cap of that kind is stated - by a legacy
   line that only recorded a total, or by a property that does not split its
   guests by age - so a caller never invents a bed the contract does not name. */
export const soldRoomCapacity = ({ rooms, rate, roomTypeId, roomType, fallback } = {}) => {
  const list = (Array.isArray(rooms) ? rooms : []).map(normalizeRoomType);
  const byId = roomTypeId
    ? list.find((room) => String(room.id || room.key) === String(roomTypeId))
    : null;
  const wantedName = String(roomType || '').trim().toLowerCase();
  const byName = wantedName
    ? list.find((room) => roomTypeNameOf(room).toLowerCase() === wantedName)
    : null;
  const room = roomForRate(rate, list) || byId || byName || null;
  const total = pricedCapacity(rate, intOr(room?.maxOccupancy ?? rate?.room_max_occupancy ?? fallback, 0));
  if (!(total > 0)) return { room, maxOccupancy: 0, maxAdults: null, maxChildren: null };
  const rateHasTypeCaps = ['room_max_adults', 'room_max_children']
    .some((key) => rate?.[key] !== null && rate?.[key] !== undefined);
  const hasTypeCaps = !!room || rateHasTypeCaps;
  const capacity = Math.max(1, total);
  return {
    room,
    maxOccupancy: capacity,
    maxAdults: hasTypeCaps
      ? Math.max(1, Math.min(capacity, intOr(room?.maxAdults ?? rate?.room_max_adults, capacity)))
      : null,
    maxChildren: hasTypeCaps
      ? childCapOf(room?.maxChildren ?? rate?.room_max_children, capacity)
      : null
  };
};

/* The room name a document should print for a sold line. */
export const serviceRoomName = (service) => String(service?.roomType || service?.room_type || '').trim();

/* The room type the travellers actually occupy.
   A night can mix types - a Family Suite beside two Standard Rooms - and the
   room allocation is the authority on who sleeps where, so an allocation row
   that names a type wins for that room. A row with no type of its own is a bed
   in the room this line was sold at, so it reads as the line's sold type rather
   than dropping off the list, and the document still says which rooms the night
   uses. A role marker ('staff', 'client') is not a room name and never prints. */
const ALLOCATION_ROLE_MARKERS = new Set(['staff', 'client', 'guest', 'crew']);

const allocationRoomType = (room, soldRoomType) => {
  const named = String(room?.roomType || room?.room_type || '').trim();
  if (named && !ALLOCATION_ROLE_MARKERS.has(named.toLowerCase())) return named;
  if (named) return '';
  return ALLOCATION_ROLE_MARKERS.has(String(soldRoomType || '').trim().toLowerCase())
    ? '' : String(soldRoomType || '').trim();
};

export const roomTypeOfAllocation = (room, service) => (
  allocationRoomType(room, serviceRoomName(service))
);

export const allocatedRoomTypeLabel = (service) => {
  const rooms = Array.isArray(service?.roomAllocations) ? service.roomAllocations : [];
  const sold = serviceRoomName(service);
  const named = [...new Set(rooms.map((rm) => allocationRoomType(rm, sold)).filter(Boolean))];
  return named.join(', ') || sold;
};

export const serviceRoomId = (service) => service?.roomTypeId || service?.room_type_id || null;

/* The room a service line was sold as, from whichever casing the caller holds
   it in. A null answer means the line never named a room (a legacy row, or a
   non-accommodation line), and every room-scoped resolution then reads the
   whole pool exactly as before. A rate row passed in place of a service also
   answers here, because it carries the same room columns. */
export const serviceRoomIdentity = (service) => {
  const id = String(service?.roomTypeId ?? service?.room_type_id ?? '').trim();
  const name = String(service?.roomType ?? service?.room_type ?? '').trim();
  return id || name ? { id, name } : null;
};

/* The pool of rate rows a service line is allowed to resolve seasons from.
   A line that sold a room must only ever see that room's seasons: two villas
   on the same property can share a season name, validity dates and board, so
   resolving over the whole matrix lets the other villa's occupancy ladder
   win the tie and reprice the line at the wrong figure. The room record is
   preferred for the match, but an identity-only room still scopes by the
   columns the rate rows carry. No identity -> the whole pool (legacy). */
export const ratesForServiceRoom = (rates, service, rooms = []) => {
  const identity = serviceRoomIdentity(service);
  const list = Array.isArray(rates) ? rates : [];
  if (!identity) return list;
  const identityId = String(identity.id || '').trim();
  const identityName = normRoomName(identity.name);
  const room = (Array.isArray(rooms) ? rooms : []).find((candidate) => (
    (identityId && roomIdsOf(candidate).includes(identityId))
    || (identityName && normRoomName(roomTypeNameOf(candidate)) === identityName)
  )) || { id: identityId || null, key: identityId || '', name: identity.name };
  return ratesForRoom(list, room, rooms);
};
