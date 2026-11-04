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
  return {
    key: String(row.id || row.key || ''),
    id: row.id || null,
    name: String(row.name ?? row.room_type ?? '').trim(),
    description: String(row.description ?? '').trim(),
    maxOccupancy,
    maxAdults: Math.max(1, Math.min(maxOccupancy, intOr(row.max_adults ?? row.maxAdults, maxOccupancy))),
    maxChildren: childCapOf(row.max_children ?? row.maxChildren, maxOccupancy),
    pricingModel: String(row.pricing_model ?? row.pricingModel ?? '').trim(),
    sortOrder: intOr(row.sort_order ?? row.sortOrder, 0)
  };
};

export const normalizeRoomTypes = (rows) => (Array.isArray(rows) ? rows : [])
  .filter((row) => row && (row.id || row.key || row.name))
  .map(normalizeRoomType)
  .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name));

export const roomTypesOf = (item) => normalizeRoomTypes(item?.roomTypes || item?.room_types || item?._room_types);

export const roomTypeNameOf = (room) => String(room?.name || '').trim();

export const roomTypeKeyOf = (room) => String(room?.key || room?.id || '');

/* The room a rate row prices. Older rows have no room, so a null answer means
   "this rate belongs to the item as a whole" and every caller keeps its legacy
   behaviour. */
export const roomForRate = (rate, rooms) => {
  if (!rate) return null;
  const list = Array.isArray(rooms) ? rooms : [];
  const id = String(rate.room_type_id || '');
  if (id) {
    const byId = list.find((room) => String(room.id || room.key) === id);
    if (byId) return byId;
  }
  const name = String(rate.room_type || '').trim().toLowerCase();
  if (name) {
    const byName = list.find((room) => String(room.name || '').trim().toLowerCase() === name);
    if (byName) return byName;
  }
  return null;
};

export const roomMatchesRate = (room, rate) => {
  if (!room || !rate) return false;
  const id = String(room.id || room.key || '');
  if (id && String(rate.room_type_id || '') === id) return true;
  const name = roomTypeNameOf(room).toLowerCase();
  return !!name && String(rate.room_type || '').trim().toLowerCase() === name;
};

/* Every rate for one room, falling back to the whole pool when the room cannot
   be identified (legacy rows, or a caller that never had a room). */
export const ratesForRoom = (rates, room) => {
  const list = Array.isArray(rates) ? rates : [];
  if (!room) return list;
  const scoped = list.filter((rate) => roomMatchesRate(room, rate));
  return scoped.length ? scoped : list;
};

/* Rooms derived from rate rows alone. Used where only the rate snapshot is at
   hand (a package line reloaded, a partner quotation, an exported card). */
export const roomsFromRates = (rates) => {
  const list = Array.isArray(rates) ? rates : [];
  const seen = new Map();
  list.forEach((rate) => {
    const key = String(rate?.room_type_id || '') || String(rate?.room_type || '').trim();
    if (!key || seen.has(key)) return;
    seen.set(key, normalizeRoomType({
      id: rate.room_type_id || null,
      key,
      name: rate.room_type || '',
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
