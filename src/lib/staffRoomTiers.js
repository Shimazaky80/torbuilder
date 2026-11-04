/* Guide / driver room deals follow the tour leader contract shape.

   A ladder states the willingness of a property to include rooms once enough
   paying client rooms are booked:

     { minClientRooms: 10, maxClientRooms: 20, rooms: 1, rate: 0 }

   `rooms` is the TOTAL number of guide (or driver) rooms included from that
   threshold, `rate` applies to the rooms the tier adds, and a typed 0 is a
   genuinely free room. A tier that keeps the previous room count is a rate
   band for those rooms (1–10 client rooms @ 800, 11+ @ 650). A tier never
   shrinks the allowance of the one before it.

   `maxClientRooms` is the stopper and it is optional: a row that leaves it out
   runs up to the next threshold, or forever when it is the last row. Stating
   one is how a property says its deal ENDS — above that many paying client
   rooms it releases nothing, and the crew bed pays the normal single rate.

   Without a ladder the legacy contract still applies: one room from the item's
   minimum client rooms at the flat guide/driver rate (a blank flat rate means
   the property charges its normal single rate). */

export const hasStaffRate = (value) => value !== null && value !== undefined && value !== '';

export const staffRateValue = (value, fallback) => (hasStaffRate(value) ? Number(value) || 0 : fallback);

/* The client-room count a tier stops covering at, or null when it does not
   stop. A ceiling typed below its own threshold still has to cover the room it
   was typed against, so it reads as that threshold rather than a band that
   closed before it opened. */
export const staffTierCeiling = (tier) => {
  const raw = tier?.maxRooms ?? tier?.maxClientRooms ?? tier?.max_rooms;
  if (!hasStaffRate(raw)) return null;
  const max = Math.round(Number(raw));
  return Number.isFinite(max) ? max : null;
};

/* Normalise a stored ladder, dropping half-typed rows the same way the TL
   editor does so a blank threshold cannot become a free room from zero. */
export const normaliseStaffTiers = (tiers) => (Array.isArray(tiers) ? tiers : [])
  .filter((tier) => tier && hasStaffRate(tier.rate) && Number.isFinite(Number(tier.rate)))
  .map((tier) => {
    const minRooms = Math.max(0, Math.round(Number(tier.minRooms ?? tier.minClientRooms ?? tier.min_rooms) || 0));
    const ceiling = staffTierCeiling(tier);
    return {
      minRooms,
      maxRooms: ceiling === null ? null : Math.max(minRooms, ceiling),
      rooms: Math.max(1, Math.floor(Number(tier.rooms) || 1)),
      rate: Number(tier.rate)
    };
  })
  .sort((a, b) => a.minRooms - b.minRooms);

/* The ladder actually used for pricing: the stored tiers when present,
   otherwise the legacy single room included from the item's threshold. When
   the property does not offer a guide/driver room at all, there is no ladder
   and every bed pays the single rate. */
export const staffRoomLadder = ({ offered, tiers, minRooms = 1, rate = 0 } = {}) => {
  if (!offered) return [];
  const stored = normaliseStaffTiers(tiers);
  if (stored.length) return stored;
  return [{
    minRooms: Math.max(1, Math.round(Number(minRooms) || 1)),
    maxRooms: null,
    rooms: 1,
    rate: Number(rate) || 0
  }];
};

/* Does this tier still release a room at this many paying client rooms? Below
   its threshold it has not started; past its ceiling its deal has stopped. The
   ceiling is read through `staffTierCeiling` so a ladder assembled in code,
   which never states one, still runs open. */
const staffTierCovers = (tier, clientRooms) => {
  const rooms = Number(clientRooms);
  if (rooms < Number(tier.minRooms) || 0) return false;
  const ceiling = staffTierCeiling(tier);
  return ceiling === null || rooms <= Math.max(Number(tier.minRooms) || 0, ceiling);
};

/* The rate earned by each included room, in room order, for a given number of
   paying client rooms. Rooms beyond the returned list pay the single rate —
   which is also what a stopped ladder returns: nothing, so the crew bed pays
   the property's normal rate.

   A tier that introduces no new bed is a rate band over the rooms already
   included, not a no-op: a property can charge 1 guide room at 800 for 1–10
   client rooms and the same room at 650 from 11. Without this, the second row
   priced nothing and the first rate leaked into every later band. A tier that
   is skipped — not started yet, or already stopped — contributes nothing and
   does not move the running room count, so a later band prices every bed it
   claims rather than leaving a hole behind the expired tier. */
export const staffRoomRates = (ladder, clientRooms) => {
  const rates = [];
  let included = 0;
  (Array.isArray(ladder) ? ladder : []).forEach((tier) => {
    if (!staffTierCovers(tier, clientRooms)) return;
    const rooms = Math.max(included, tier.rooms);
    if (tier.rooms > included) {
      for (let i = included; i < rooms; i += 1) rates[i] = tier.rate;
    } else {
      for (let i = 0; i < rooms; i += 1) rates[i] = tier.rate;
    }
    included = rooms;
  });
  return rates;
};

/* Where a ladder stops, or null when any tier still runs open. A charge note
   needs this to say "the crew deal stops at 20 client rooms" instead of
   claiming the threshold was never met when it was met and then expired. */
export const staffLadderCeiling = (ladder) => {
  const tiers = normaliseStaffTiers(ladder);
  if (!tiers.length) return null;
  if (tiers.some((tier) => tier.maxRooms === null)) return null;
  return Math.max(...tiers.map((tier) => tier.maxRooms));
};

/* Why a ladder contracts nothing at this many client rooms once its first
   threshold has been reached: either the deal stopped at its last ceiling, or
   the count sits in a gap between two bands. Null below the first band, where
   the plain "threshold not met" reading is still the honest one. */
export const staffLadderStoppedReason = (ladder, clientRooms, label = 'crew') => {
  const tiers = normaliseStaffTiers(ladder);
  const rooms = Number(clientRooms);
  if (!tiers.length || !Number.isFinite(rooms)) return null;
  if (rooms < (tiers[0].minRooms || 0)) return null;
  if (tiers.some((tier) => staffTierCovers(tier, rooms))) return null;
  const ceiling = staffLadderCeiling(tiers);
  return ceiling === null || tiers.some((tier) => tier.minRooms > rooms)
    ? `no ${label} band covers ${rooms} client rooms`
    : `${label} deal stops at ${ceiling} client rooms: ${rooms} booked`;
};

/* A property contracts ONE pool of crew rooms, not one per party: its rate card
   reads "1 Driver-Guide room", meaning whichever of the guide and the driver
   beds first takes that room, and the next crew bed pays the normal single
   rate. So the two ladders are one deal — saved into both columns and read from
   the guide one, with the driver column holding a contract typed there before
   the pool existed. */
export const crewLadderTiers = (guideTiers, driverTiers) => {
  const guide = normaliseStaffTiers(guideTiers);
  return guide.length ? guide : normaliseStaffTiers(driverTiers);
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
    const next = tiers[index + 1];
    /* A stated ceiling is the contract. A blank one borrows the next threshold
       so an open ladder still prints the range each rate actually covers. */
    const maxRooms = tier.maxRooms !== null
      ? tier.maxRooms
      : (next ? Math.max(tier.minRooms, next.minRooms - 1) : null);
    const band = {
      minRooms: tier.minRooms,
      maxRooms,
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
