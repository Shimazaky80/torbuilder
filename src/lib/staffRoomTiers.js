/* Guide / driver room deals follow the tour leader contract shape.

   A ladder states the willingness of a property to include rooms once enough
   paying client rooms are booked:

     { minClientRooms: 10, rooms: 1, rate: 0 }

   `rooms` is the TOTAL number of guide (or driver) rooms included from that
   threshold, `rate` applies to the rooms the tier adds, and a typed 0 is a
   genuinely free room. A tier that keeps the previous room count is a rate
   band for those rooms (1–10 client rooms @ 800, 11+ @ 650). A tier never
   shrinks the allowance of the one before it.

   Without a ladder the legacy contract still applies: one room from the item's
   minimum client rooms at the flat guide/driver rate (a blank flat rate means
   the property charges its normal single rate). */

export const hasStaffRate = (value) => value !== null && value !== undefined && value !== '';

export const staffRateValue = (value, fallback) => (hasStaffRate(value) ? Number(value) || 0 : fallback);

/* Normalise a stored ladder, dropping half-typed rows the same way the TL
   editor does so a blank threshold cannot become a free room from zero. */
export const normaliseStaffTiers = (tiers) => (Array.isArray(tiers) ? tiers : [])
  .filter((tier) => tier && hasStaffRate(tier.rate) && Number.isFinite(Number(tier.rate)))
  .map((tier) => ({
    minRooms: Math.max(0, Math.round(Number(tier.minRooms ?? tier.minClientRooms ?? tier.min_rooms) || 0)),
    rooms: Math.max(1, Math.floor(Number(tier.rooms) || 1)),
    rate: Number(tier.rate)
  }))
  .sort((a, b) => a.minRooms - b.minRooms);

/* The ladder actually used for pricing: the stored tiers when present,
   otherwise the legacy single room included from the item's threshold. When
   the property does not offer a guide/driver room at all, there is no ladder
   and every bed pays the single rate. */
export const staffRoomLadder = ({ offered, tiers, minRooms = 1, rate = 0 } = {}) => {
  if (!offered) return [];
  const stored = normaliseStaffTiers(tiers);
  if (stored.length) return stored;
  return [{ minRooms: Math.max(1, Math.round(Number(minRooms) || 1)), rooms: 1, rate: Number(rate) || 0 }];
};

/* The rate earned by each included room, in room order, for a given number of
   paying client rooms. Rooms beyond the returned list pay the single rate.

   A tier that introduces no new bed is a rate band over the rooms already
   included, not a no-op: a property can charge 1 guide room at 800 for 1–10
   client rooms and the same room at 650 from 11. Without this, the second row
   priced nothing and the first rate leaked into every later band. */
export const staffRoomRates = (ladder, clientRooms) => {
  const rates = [];
  let included = 0;
  (Array.isArray(ladder) ? ladder : []).forEach((tier) => {
    const rooms = Math.max(included, tier.rooms);
    if (Number(clientRooms) >= tier.minRooms) {
      if (rooms > included) {
        for (let i = included; i < rooms; i += 1) rates[i] = tier.rate;
      } else {
        for (let i = 0; i < rooms; i += 1) rates[i] = tier.rate;
      }
    }
    included = rooms;
  });
  return rates;
};

/* The ladder as explicit bands, one per threshold, each with the client-room
   range it covers (null maxRooms = open-ended). `added` is how many rooms the
   tier introduces; 0 means the tier re-prices the rooms already included. */
export const staffTierBands = (ladder) => {
  const tiers = [];
  normaliseStaffTiers(ladder).forEach((tier) => {
    const existing = tiers.findIndex((entry) => entry.minRooms === tier.minRooms);
    if (existing >= 0) tiers[existing] = tier;
    else tiers.push(tier);
  });
  tiers.sort((a, b) => a.minRooms - b.minRooms);
  let previousRooms = 0;
  return tiers.map((tier, index) => {
    const rooms = Math.max(previousRooms, tier.rooms);
    const band = {
      minRooms: tier.minRooms,
      maxRooms: tiers[index + 1] ? Math.max(tier.minRooms, tiers[index + 1].minRooms - 1) : null,
      rooms,
      added: Math.max(0, tier.rooms - previousRooms),
      rate: tier.rate
    };
    previousRooms = rooms;
    return band;
  });
};

/* One-line summary of a ladder for previews, e.g.
   "1–10 client rooms: 1 room @ ZAR 800 · 11+ client rooms: 1 room @ ZAR 650". */
export const staffTierSummary = (ladder, money, roomLabel = 'room') => staffTierBands(ladder).map((band) => {
  const range = band.maxRooms === null ? `${band.minRooms}+` : `${band.minRooms}\u2013${band.maxRooms}`;
  const rooms = `${band.rooms} ${roomLabel}${band.rooms === 1 ? '' : 's'}${band.added > 0 && band.rooms > band.added ? ` (${band.added} more)` : ''}`;
  return `${range} client rooms: ${rooms} @ ${money(band.rate)}`;
}).join(' \u00b7 ');
