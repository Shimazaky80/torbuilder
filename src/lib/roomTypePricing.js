/* Room-type pricing.

   A property sells several rooms at once - Standard, Family Suite, Garden Villa -
   and each has its own negotiated columns. Until now a night was priced from the
   ONE row the line was sold at, so a Family Suite sleeping beside two Standard
   Rooms cost the operator a second accommodation line. The allocation dialog now
   types every room, so this module resolves the sibling rows: for each of the
   property's other room types it finds the row that belongs to the very season,
   currency, charge type and night band the line is priced from.

   Resolution is by identity, never by re-resolving a season. A room type that has
   no row in the line's own season is reported as unpriced rather than borrowed
   from a neighbouring season, because a summer Suite row pricing a winter night
   is the multi-season mispricing this codebase already refuses elsewhere.

   The rows travel on the sold rate as `_roomTypeRates`, so every engine that
   already holds the line's row - the room charge calculator, the per-person
   summary, the document breakdown - prices each room from its own contract
   without a second lookup. A row with no stamp behaves exactly as it did before. */

import { nightBandOf, rateForNight, sameRateFamily } from './accommodationOptions';
import { applyProtectionToRate } from './priceValidity';
import { roomForRate, roomMatchesRate, roomsFromRates, roomTypesOf } from './roomTypes';

/* A room allocation names its bed by id when it has one and by name when it does
   not. Role markers are not room names: a staff or crew bed is priced by the
   property's crew deal on the line's own row, not by a guest room type. */
const ROLE_MARKERS = new Set(['staff', 'client', 'guest', 'crew']);

const allocationTypeName = (room) => {
  const named = String(room?.roomType || room?.room_type || '').trim();
  return ROLE_MARKERS.has(named.toLowerCase()) ? '' : named;
};

const bandKey = (rate) => {
  const { min, max } = nightBandOf(rate);
  return `${min}|${max === null ? '' : max}`;
};

/* The row of one room type that belongs to this line's season, charge type,
   currency and night band. Returns the row, or the reason it cannot price the
   night. */
const siblingRow = (matrix, type, soldRate) => {
  const rows = matrix.filter((row) => roomMatchesRate(type, row));
  if (!rows.length) {
    return { rate: null, reason: `${type.name} has no rate rows at all.` };
  }
  const family = rows.filter((row) => sameRateFamily(row, soldRate));
  if (!family.length) {
    return {
      rate: null,
      reason: `${type.name} has no price in the ${soldRate.season_name || soldRate.option_name || 'chosen'} season, charge type and currency this night is priced from.`
    };
  }
  const band = bandKey(soldRate);
  const sameBand = family.find((row) => bandKey(row) === band);
  if (!sameBand) {
    return {
      rate: null,
      reason: `${type.name} is not contracted for ${nightBandOf(soldRate).max === null ? `${band} nights` : `a ${band} night stay`} in this season.`
    };
  }
  return { rate: sameBand, reason: '' };
};

/* The sold rate with its sibling rows attached. `matrix` is the property's whole
   rate list and `roomTypes` its room records. A property with one room type gets
   no stamp because there is nothing to price differently, and neither does a
   property whose rate rows name no room: those rows are the whole contract, so
   every bed keeps pricing on the line's own row exactly as it does today.

   Where the caller has the rows but not the room records — an invoice reloaded
   from the database, a package line — the rooms are read off the rows
   themselves, because each row already carries its own room's name and capacity. */
export const withRoomTypeRates = (rate, { item = null, rates = [], nightDate = '' } = {}) => {
  if (!rate) return rate;
  const matrix = ((Array.isArray(rates) && rates.length) ? rates : item?.item_rates) || [];
  if (!matrix.length) return rate;
  const types = (() => {
    const fromItem = roomTypesOf(item).filter((type) => type.name);
    return fromItem.length ? fromItem : roomsFromRates(matrix).filter((type) => type.name);
  })();
  const soldRoom = roomForRate(rate, types);
  const percent = Number(rate.price_protection_percent) || 0;
  const ageRanges = Array.isArray(rate._ageRanges)
    ? rate._ageRanges
    : (Array.isArray(item?.child_age_ranges) ? item.child_age_ranges : item?.childAgeRanges);
  /* Child bands belong to the contracted room just like its rates do. A room
     without its own stored bands keeps the legacy property-level fallback. */
  const withAgeBands = (row, type) => {
    if (!row) return row;
    if (type?.hasChildAgeRanges) return { ...row, _ageRanges: type.childAgeRanges };
    return row._ageRanges || !Array.isArray(ageRanges) ? row : { ...row, _ageRanges: ageRanges };
  };
  if (types.length < 2) return withAgeBands(rate, soldRoom);
  if (!types.some((type) => matrix.some((row) => roomMatchesRate(type, row)))) {
    return withAgeBands(rate, soldRoom);
  }
  const entries = types.map((type) => {
    const isSold = soldRoom
      ? String(soldRoom.key || soldRoom.id) === String(type.key || type.id)
      : roomMatchesRate(type, rate);
    if (isSold) return { roomTypeId: type.id, roomType: type.name, rate: withAgeBands(rate, type), reason: '' };
    const found = siblingRow(matrix, type, rate);
    return {
      roomTypeId: type.id,
      roomType: type.name,
      /* Priced for this night and uplifted exactly as the line's own row was. */
      rate: found.rate ? withAgeBands(applyProtectionToRate(rateForNight(found.rate, nightDate), percent), type) : null,
      reason: found.reason
    };
  });
  return { ...rate, _roomTypeRates: entries };
};

/* The row one allocated room is priced from.
   - a room with no type of its own, or a staff/crew bed, is priced on the line's
     row, exactly as it always was;
   - a room typed as the room the line sold is priced on the line's row;
   - a room typed as another of the property's rooms is priced on that room's own
     row, or refused when the line's season does not carry one. */
export const rateForAllocatedRoom = (soldRate, room) => {
  const stamp = Array.isArray(soldRate?._roomTypeRates) ? soldRate._roomTypeRates : null;
  const named = allocationTypeName(room);
  if (!stamp || !named) return { rate: soldRate, roomType: named, reason: '' };
  const id = String(room?.roomTypeId ?? room?.room_type_id ?? '');
  const entry = stamp.find((row) => id && String(row.roomTypeId ?? '') === id)
    || stamp.find((row) => String(row.roomType || '').trim().toLowerCase() === named.toLowerCase());
  if (!entry) return { rate: soldRate, roomType: named, reason: '' };
  return { rate: entry.rate, roomType: entry.roomType, reason: entry.rate ? '' : entry.reason };
};

export const allocationRoomTypeName = allocationTypeName;

/* The one room type a confirmed allocation names, when every typed bed agrees
   on it. Role markers (staff/crew) and untyped legacy beds price on the line's
   own row and are ignored here. A night mixing two guest room types has no
   single identity - the line keeps the room it was sold at and each bed prices
   from its own sibling row. Used to move a line's identity onto the room the
   operator actually allocated, so a later re-price scopes to that room's
   contract instead of the sibling the drop happened to resolve first. */
export const homogeneousRoomIdentity = (roomAllocations) => {
  const list = Array.isArray(roomAllocations) ? roomAllocations : [];
  let first = null;
  for (const room of list) {
    const named = allocationTypeName(room);
    if (!named) continue;
    const id = String(room?.roomTypeId ?? room?.room_type_id ?? '') || null;
    if (!first) {
      first = { roomTypeId: id, roomType: named, key: named.toLowerCase() };
    } else if (first.key !== named.toLowerCase()) {
      return null;
    } else if (!first.roomTypeId && id) {
      first.roomTypeId = id;
    }
  }
  return first ? { roomTypeId: first.roomTypeId, roomType: first.roomType } : null;
};
