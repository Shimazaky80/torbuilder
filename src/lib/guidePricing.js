import { rateForTravel } from './priceValidity';
import { travellersPlusTlCount } from './roomAllocationHelper';
import { crewLadderTiers, hasStaffRate, staffRateValue, staffRoomLadder, staffRoomRates } from './staffRoomTiers';

export const getGuideShareDivisor = (travellers = []) => {
  const n = travellersPlusTlCount(travellers);
  return n > 0 ? n : 1;
};

/* Guide service detour — shared helpers for the Itinerary Builder and the
   Package Builder.

   A Guide (library category 'Guide') is not priced like a normal service: the
   supplier charges a flat per-trip amount that DIFFERS by the service the guide
   accompanies (Transfer / Half Day / Full Day / Overland / Dinner Transfer).
   The five amounts live on the guide's contract rate as guide_*_rate (flat,
   NUMERIC); the operator picks the service types when the guide is dropped and
   the sum is stored on the day item under guide_service_types, so the line is
   always re-priceable — and explainable — after a reload.

   Guide DETAILS (Overland only) are the lunch, dinner and overnight the guide
   and driver get fed and bedded on the days the guide is used. They are pulled
   from the Meals and Accommodation module rates and stored as separate lines
   flagged guide_only, so they never inflate the client accommodation figure.

   A crew figure on an ordinary line's own rate row — the guide's seat on a
   flight, the guide's place on a tour — is the opposite case: the party buys it
   with its own ticket, so it folds into that line and is shared by the
   travellers. See crewChargeOf. */

export const GUIDE_SERVICE_TYPES = ['transfer', 'half_day', 'full_day', 'overland', 'dinner_transfer'];

export const GUIDE_SERVICE_TYPE_LABELS = {
  transfer: 'Transfer',
  half_day: 'Half Day',
  full_day: 'Full Day',
  overland: 'Overland',
  dinner_transfer: 'Dinner Transfer'
};

export const GUIDE_RATE_FIELD_BY_TYPE = {
  transfer: 'guide_transfer_rate',
  half_day: 'guide_half_day_rate',
  full_day: 'guide_full_day_rate',
  overland: 'guide_overland_rate',
  dinner_transfer: 'guide_dinner_rate'
};

/* A library item is a guide service when its category is exactly the 'Guide'
   category (it was renamed from 'Guide / Driver' by 20260901). */
export const isGuideItem = (item) => /^guide([ /]+driver)?$/i.test(String(item?.category || '').trim());

/* A day item built from a guide library item carries the same category, so the
   check doubles for services (itinerary svc camelCase + package snake_case). */
export const isGuideService = (service) => /^guide([ /]+driver)?$/i.test(String(service?.category || '').trim());

/* A line that prices only the guide & driver (their lunch/dinner/overnight). */
export const isGuideOnly = (service) => (
  service?.guide_only === true || service?.guide_only === 'true' || service?.guideOnly === true
);

export const isValidGuideServiceType = (type) => GUIDE_SERVICE_TYPES.includes(type);

export const guideSelection = (types) => (Array.isArray(types) ? types : [])
  .map((type) => String(type || '').trim().toLowerCase())
  .filter(isValidGuideServiceType);

export const guideServiceTypeLabel = (type) => GUIDE_SERVICE_TYPE_LABELS[type] || type;

/* The flat per-trip amount for one service type, from the guide's contract rate. */
export const guideRateFor = (rate = {}, type) => {
  const field = GUIDE_RATE_FIELD_BY_TYPE[type];
  const value = Number(rate?.[field]);
  return Number.isFinite(value) ? value : 0;
};

/* The summed per-trip charge for a selected set of service types.
   Only charged when guide_needed is true (or undefined/not explicitly false).

   `upliftPercent` belongs to the PERSON guiding, not to the season: a senior
   guide costs more than the destination's contract figure while sharing it.
   Left at 0 the sum is the contract money untouched, so every existing caller —
   and every guide with no one named on the line — is unchanged. */
export const guideChargeTotal = (rate = {}, types = [], guideNeeded = true, upliftPercent = 0) => {
  if (guideNeeded === false) return 0;
  const base = guideSelection(types).reduce((sum, type) => sum + guideRateFor(rate, type), 0);
  const percent = Number(upliftPercent);
  if (!Number.isFinite(percent) || percent <= 0) return base;
  return Math.round(base * (1 + percent / 100) * 100) / 100;
};

/* The uplift a line must be priced at, read from the line itself.

   The percentage travels on the guide snapshot written when the person was
   picked, so a reprice or a season change keeps the same person's uplift without
   the directory being loaded - and a guide retuned in the directory tomorrow
   cannot rewrite a figure that has already been sold. */
export const lineGuideUpliftPercent = (service) => {
  const snapshot = service?.guideSnapshot ?? service?.guide_snapshot;
  const stored = Number(snapshot?.uplift_percent ?? service?.guideUpliftPercent);
  return Number.isFinite(stored) && stored > 0 ? stored : 0;
};

/* Human-readable summary of the selected service types, e.g. "Half Day · Dinner Transfer". */
export const guideLabel = (types = []) => guideSelection(types)
  .map(guideServiceTypeLabel)
  .join(' · ');

/* TRUE when the guide's detail triggers (lunch/dinner/overnight) claim the guide
   is used as a touring guide, i.e. the operator picked the Overland service type. */
export const isOverlandGuide = (types = []) => guideSelection(types).includes('overland');

export const numberOf = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/* The per-night amount a supporting property charges for the guide. A typed 0
   is a free bed; a blank rate falls back to the single rate. Only charged when
   guide_needed is true. */
export const guideRoomRate = (rate = {}, guideNeeded = true) => {
  if (guideNeeded === false) return 0;
  return staffRateValue(rate?.guide_rate, singleOvernightRate(rate));
};

/* A meal served to the guide is charged at the meal item's guide_rate; 0 means
   the fare the clients pay. Only charged when guide_needed is true. */
export const guideMealRate = (rate = {}, guideNeeded = true) => {
  if (guideNeeded === false) return 0;
  return numberOf(rate?.guide_rate) || numberOf(rate?.price_1_adult) || numberOf(rate?.unit_price);
};

/* The driver is billed the same way, off the same rate row. A crew member who
   eats the clients' fare has no separate figure, so the adult price stands. */
export const driverMealRate = (rate = {}, guideNeeded = true) => {
  if (guideNeeded === false) return 0;
  return numberOf(rate?.driver_rate) || numberOf(rate?.price_1_adult) || numberOf(rate?.unit_price);
};

/* Whether a meal belongs on the crew manifest at all. The supplier states it on
   the item, not on a season, so one meal can be guide-only, driver-only or both.
   An untagged library (nothing flagged anywhere) still feeds the guide - see
   guideMealChoices - so the flag gates the LIST, never the money. */
export const mealAcceptsGuide = (item) => item?.guide_meal_offered === true;

export const mealAcceptsDriver = (item) => item?.driver_meal_offered === true;

/* A flight the supplier also sells the guide a seat on. The seat is folded into
   the clients' flight line and shared by the party - see crewChargeOf - not sold
   as a line of its own. */
export const flightOffersGuideTicket = (item) => item?.guide_flight_offered === true;

/* The guide's seat on a flight. A charter prices the whole aircraft, so only a
   typed crew fare can price one seat on it; on a per-person flight the fare the
   clients pay is the fallback. */
export const guideFlightRate = (rate = {}, { perCharter = false } = {}) => {
  const typed = numberOf(rate?.guide_rate);
  if (typed > 0) return typed;
  return perCharter ? 0 : (numberOf(rate?.price_1_adult) || numberOf(rate?.unit_price));
};

/* ---- The crew place folded onto the line that carries it -----------------

   A guide's seat on a flight and a guide's place on a tour are figures the party
   buys with its own ticket, so they are added to that line's buy and divided
   across the travellers - exactly as a guide fee line shares its flat per-trip
   figure. The old shape was a second line "for the guide alone", which read as
   money nobody was charged. */

/* Which categories fold a crew figure off their own rate row. Meals and beds are
   deliberately absent: the guide commonly eats a flagged meal the clients never
   book and sleeps at a property they never use, so those stay their own crew
   lines. A Fees & Tickets item already folds the guide's head inside
   surchargeBuyTotal, and a Guide item shares its own flat fee. */
export const crewPlaceKind = (item) => {
  const category = String(item?.category || '').trim().toLowerCase();
  if (category === 'flights / charter') return flightOffersGuideTicket(item) ? 'guide_seat' : null;
  if (category === 'activities / tours') return 'guide_place';
  return null;
};

/* The fare ONE crew head costs on a line of this kind. A seat on a flight falls
   back to what the clients pay — except on a charter, which prices the whole
   aircraft and so has no seat price to give. */
const crewFareFor = (kind, rate, perCharter) => (kind === 'guide_seat'
  ? guideFlightRate(rate, { perCharter })
  : numberOf(rate?.guide_rate));

/* The crew money one line folds into its own buy.
   `guideCount` is the guides travelling with the party; a party that rostered no
   guide is still escorted by one, so a line that sells the crew a place always
   buys at least one. A blank — or a typed zero — crew figure folds nothing, so an
   item that never priced the guide's place is priced exactly as it was before. */
export const crewChargeOf = (item, rate, { perCharter = false, guideCount = 0 } = {}) => {
  const kind = crewPlaceKind(item);
  if (!kind) return null;
  const fare = crewFareFor(kind, rate, perCharter);
  if (!(fare > 0)) return null;
  const heads = Math.max(1, numberOf(guideCount));
  return {
    kind,
    label: kind === 'guide_seat' ? 'Guide seat' : "Guide's place",
    fare,
    heads,
    total: Math.round(fare * heads * 100) / 100
  };
};

/* The crew copy as it rides on a saved line: the money taken at the drop and the
   divisor it was shared over, so a party change re-shares the same figure instead
   of re-deriving it from a library that has moved since. */
export const crewShareOn = (service) => {
  const stored = service?.crewShare ?? service?.crew_share;
  const total = numberOf(stored?.total);
  if (!(total > 0)) return null;
  return {
    ...stored,
    total,
    fare: numberOf(stored.fare),
    heads: Math.max(1, numberOf(stored.heads)),
    divisor: numberOf(stored.divisor)
  };
};

/* What a line that already folded a crew charge owes now that its season row has
   changed: the same number of heads at the new fare. A row that no longer quotes
   the crew keeps the figure the line was sold at — a season edit must not delete
   money the party already agreed to share, and a library that dropped the flag
   cannot silently un-charge a seat. */
export const refreshCrewShare = (stored, rate, { perCharter = false, guideCount = 0 } = {}) => {
  const known = crewShareOn({ crewShare: stored });
  if (!known) return null;
  const heads = Math.max(1, numberOf(guideCount) || known.heads);
  const fare = crewFareFor(known.kind === 'guide_place' ? 'guide_place' : 'guide_seat', rate, perCharter);
  if (!(fare > 0)) return known.heads === heads ? known : { ...known, heads };
  return {
    ...known,
    fare,
    heads,
    total: Math.round(fare * heads * 100) / 100
  };
};

/* The share one traveller carries of a folded crew charge. */
export const crewSharePerPerson = (total, divisor) => {
  const amount = numberOf(total);
  const shares = numberOf(divisor);
  return amount > 0 && shares > 0 ? Math.round((amount / shares) * 100) / 100 : 0;
};

/* Who carries a share: the travellers and their tour leaders, never the guide
   whose fare is being split - the same divisor a guide fee line uses. */
export const crewShareDivisor = (shareContext, travellers = [], fallbackPax = 1) => {
  const fromContext = Number(shareContext?.travellersPlusTl);
  if (fromContext > 0) return fromContext;
  const fromRoster = travellersPlusTlCount(travellers);
  return fromRoster > 0 ? fromRoster : Math.max(1, numberOf(fallbackPax) || 1);
};

/* Meals offered to the guide, restricted to the flagged ones - unless the
   library has not been tagged yet, when every meal stays selectable rather than
   leaving the operator with an empty picker and a guide who goes hungry.
   Returns { meals, restricted }: restricted tells the caller to say which list
   the operator is looking at. */
export const guideMealChoices = (meals = []) => {
  const flagged = (Array.isArray(meals) ? meals : []).filter(mealAcceptsGuide);
  return flagged.length
    ? { meals: flagged, restricted: true }
    : { meals: Array.isArray(meals) ? meals : [], restricted: false };
};

/* What one chosen meal puts on the day: an ARRAY of charged lines. The guide
   always eats it, and the driver joins when the supplier says the driver eats
   this one too. Each line says whom it charges, so the builder prices it off
   that party's rate and the dialog re-opens with the same arrangement. */
export const crewMealLines = (item) => {
  if (!item) return [];
  const rate = (item.item_rates || [])[0] || {};
  const lines = [{ item, who: 'guide', unitCost: guideMealRate(rate) }];
  if (mealAcceptsDriver(item)) {
    lines.push({ item, who: 'driver', unitCost: driverMealRate(rate) });
  }
  return lines;
};

/* ---- Guide & driver overnight (overland) ---------------------------------
   The guide and driver are bedded on the day the guide is used overland. The
   operator chooses WHO is charged for the night (guide only / driver only /
   both — "both" writes one line per party) and WHERE they stay:

     - the clients' accommodation when it contracts a guide & driver room
       (guide_driver_room_offered), at that property's guide_rate / driver_rate;
     - the same property anyway ("proceed") when it does NOT contract one — the
       guide & driver/both are then charged the default single rate each;
     - a different accommodation in the same destination that DOES contract a
       guide & driver room, at that property's contracted rates. The clients
       keep their own room and are never charged for the guide's bed.

   A typed 0 in guide_rate / driver_rate is a free bed; a blank rate means the
   property charges its normal single rate. Either party may also carry a
   client-room ladder (guide_tiers / driver_tiers) that includes one or more
   rooms once enough paying rooms are booked, exactly like the tour leader
   deal. */

/* Who can be billed for one overnight at a property. */
export const GUIDE_CHARGE_TYPES = ['guide', 'driver', 'both'];

export const OVERNIGHT_RIDER_LABELS = {
  guide: 'Guide',
  driver: 'Driver',
  both: 'Guide & driver'
};

/* The property beds a guide & driver when the library item says it offers a
   guide/driver room. This gates both the pricing (contracted guide_rate /
   driver_rate rather than the default single rate) and the alternative-property
   picker. */
export const accommodationAcceptsGuide = (item) => item?.guide_driver_room_offered === true;

/* The default single rate a property charges the guide/driver when it has no
   contracted guide/driver room: one adult in the room alone. */
export const singleOvernightRate = (rate = {}) => (
  numberOf(rate?.single_room_rate)
  || numberOf(rate?.effective_single_rate)
  || numberOf(rate?.price_1_adult)
  || numberOf(rate?.unit_price)
  || numberOf(rate?.room_rate)
);

/* The client-room threshold a property sets before its guide rate applies.
   Unset (or a bad value) means 1, so existing contracts are unchanged. */
export const guideMinClientRooms = (item) => Math.max(1, Number(item?.guide_min_rooms ?? item?.guideMinRooms) || 1);

/* Whether the guide rate is earned. An unknown room count is not a failed
   threshold — the caller simply cannot judge it. */
export const guideRateApplies = (clientRooms, minRooms) => {
  if (clientRooms === undefined || clientRooms === null || clientRooms === '') return true;
  const rooms = Number(clientRooms);
  if (!Number.isFinite(rooms)) return true;
  return rooms >= Math.max(1, Number(minRooms) || 1);
};

/* The one crew pool a property contracts, resolved from its rate row so the
   guide, the driver and the allocation engine all price the same deal. A
   property states "1 Driver-Guide room", not one room per party, so a ladder
   typed into either column is the same rule; the flat figure is the guide rate,
   falling back to the driver's where only that was entered. */
export const crewRoomLadder = (rate = {}, { minRooms } = {}) => staffRoomLadder({
  offered: true,
  tiers: crewLadderTiers(
    rate?.guide_tiers ?? rate?.guideTiers,
    rate?.driver_tiers ?? rate?.driverTiers
  ),
  minRooms,
  rate: staffRateValue(
    [rate?.guide_rate, rate?.guideRate, rate?.driver_rate, rate?.driverRate].find(hasStaffRate),
    singleOvernightRate(rate)
  )
});

/* What a property charges to bed one member of its crew for one night.

   The property may release its contracted crew rate only once enough paying
   client rooms are booked, and may include more than one crew room through a
   ladder (see staffRoomTiers). Those rooms are one pool, so `crewBed` is which
   bed of it this member takes: the first earns the contracted figure and a later
   one pays the normal single rate — as does every bed once a ladder has stopped.
/* An unknown client room count is treated as met, matching the legacy
   threshold behaviour: a package quote carries no room allocation. */
const clientRoomCount = (clientRooms) => (
  clientRooms === undefined || clientRooms === null || clientRooms === ''
    ? Number.POSITIVE_INFINITY
    : Number(clientRooms)
);

const crewBedRate = (rate, bed, { clientRooms, minRooms } = {}) => {
  const included = staffRoomRates(crewRoomLadder(rate, { minRooms }), clientRoomCount(clientRooms))[bed];
  return included !== undefined ? included : singleOvernightRate(rate);
};

/* How many crew rooms the pool releases at this many paying client rooms. A
   note names it to say why the second bed is being charged the single rate. */
export const crewPoolRooms = (rate = {}, { clientRooms, minRooms } = {}) => (
  staffRoomRates(crewRoomLadder(rate, { minRooms }), clientRoomCount(clientRooms)).length
);

export const guideTravelRate = (rate = {}, guideNeeded = true, { clientRooms, minRooms, crewBed = 0 } = {}) => {
  if (guideNeeded === false) return 0;
  return crewBedRate(rate, crewBed, { clientRooms, minRooms });
};

/* The driver beds from the same pool as the guide, from the same threshold. */
export const driverTravelRate = (rate = {}, guideNeeded = true, { clientRooms, minRooms, crewBed = 0 } = {}) => {
  if (guideNeeded === false) return 0;
  return crewBedRate(rate, crewBed, { clientRooms, minRooms });
};

/* One night of crew bedding at one property. A 'both' night draws from the same
   pool, so the second member is priced as its second bed rather than taking the
   contracted crew room a second time. */
export const overnightRiderRate = (rate = {}, who, guideNeeded = true, options = {}) => {
  if (guideNeeded === false) return 0;
  if (who === 'both') return crewBedRate(rate, 0, options) + crewBedRate(rate, 1, options);
  return who === 'driver'
    ? driverTravelRate(rate, true, options)
    : guideTravelRate(rate, true, options);
};

/* Helper to divide guide charges by travellersPlusTlCount (clients + TL only).
   Explicitly ignores Tour Guide count. */
export const guidePerPersonRate = (totalCharge = 0, travellers = [], guideNeeded = true) => {
  if (guideNeeded === false) return 0;
  const divisor = getGuideShareDivisor(travellers);
  return divisor > 0 ? (Number(totalCharge) || 0) / divisor : (Number(totalCharge) || 0);
};

/* The rate row that prices one property's guide bed: the season covering the
   trip when known, else the first row (the engine's season-blind default). */
export const overnightRateRow = (item, currencyCode, startDate, endDate) => {
  const rows = Array.isArray(item?.item_rates) ? item.item_rates : [];
  if (!rows.length) return null;
  const resolved = rateForTravel({
    rates: rows,
    currencyCode,
    startDate,
    endDate
  });
  return resolved || rows[0] || null;
};

/* The destination label used to match an alternative guide-friendly property
   to the clients' accommodation ("same destination" per the requirement). */
export const accommodationDestination = (item) => String(
  item?.destination_area || item?.destinationArea
  || item?.destination_region || item?.destinationRegion
  || item?.location || ''
).trim();

export const sameDestination = (a, b) => {
  const da = accommodationDestination(a);
  return !!da && da === accommodationDestination(b);
};