import { rateForTravel } from './priceValidity';

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
   flagged guide_only, so they never inflate the client accommodation figure. */

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

/* The summed per-trip charge for a selected set of service types. */
export const guideChargeTotal = (rate = {}, types = []) => (
  guideSelection(types).reduce((sum, type) => sum + guideRateFor(rate, type), 0)
);

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

/* The per-night/meal amount a supporting property charges for the guide. An
   explicit rate wins; 0 means "fall back to the single rate" (guide_driver_room_rates). */
export const guideRoomRate = (rate = {}) => (
  numberOf(rate?.guide_rate) || numberOf(rate?.single_room_rate) || numberOf(rate?.effective_single_rate)
    || numberOf(rate?.price_1_adult) || numberOf(rate?.unit_price)
);

/* A meal served to the guide is charged at the meal item's guide_rate; 0 means
   the fare the clients pay. */
export const guideMealRate = (rate = {}) => (
  numberOf(rate?.guide_rate) || numberOf(rate?.price_1_adult) || numberOf(rate?.unit_price)
);

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

   0 in guide_rate / driver_rate always means "fall back to the single rate"
   (the editor spells this out next to the input). */

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

/* What a property charges to bed the guide for one night. */
export const guideTravelRate = (rate = {}) => (
  numberOf(rate?.guide_rate) || singleOvernightRate(rate)
);

/* What a property charges to bed the driver for one night. */
export const driverTravelRate = (rate = {}) => (
  numberOf(rate?.driver_rate) || singleOvernightRate(rate)
);

export const overnightRiderRate = (rate = {}, who) => (
  who === 'driver' ? driverTravelRate(rate) : guideTravelRate(rate)
);

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