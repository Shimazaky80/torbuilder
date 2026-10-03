/* Surcharge Fees as independent service lines.
 *
 * Entrance fees and conservation levies used to be per-season columns hanging
 * off a Transfers / Activities / Accommodation item, which meant they were
 * invisible on the itinerary (they were fetched and never read) and impossible
 * to price independently. They are now their own category with their own
 * library items, so each becomes a normal service line on the day.
 *
 * The rules that are not obvious:
 *
 *  - Basis. A supplier charges an entrance fee once for the whole booking, or
 *    once per night. A per-night fee attached to accommodation repeats for the
 *    number of nights that property is on the itinerary; a once-off fee does
 *    not. A per-night fee with nothing to attach to has no way to know how many
 *    times to repeat, so the caller asks the operator.
 *
 *  - Chargeable. Some suppliers include the fee in the room rate and it is only
 *    there for reference; others bill it on top. A non-chargeable surcharge is
 *    still shown on the itinerary, but it carries no markup and no money is
 *    added to the total - it is the supplier's figure, passed through as-is.
 *
 *  - Link. A surcharge that belongs to one accommodation carries that item's id
 *    so the two arrive together and stay together on the same day.
 */

export const SURCHARGE_CATEGORY = 'Surcharge Fees';

export const SURCHARGE_TYPES = [
  { id: 'entrance_fee', label: 'Entrance Fees' },
  { id: 'conservation_levy', label: 'Conservation Levy' }
];

export const CHARGE_BASIS = [
  { id: 'once_off', label: 'Once Off' },
  { id: 'per_night', label: 'Per Night' }
];

/* What the fee is charged on. Entrance fees have no per-child figure in the
   rate row, so they are not offered per child: silently charging the adult
   figure or the per-person figure here would bill the wrong number. */
export const UNIT_BASES = [
  { id: 'per_person', label: 'Per Person' },
  { id: 'per_adult', label: 'Per Adult' },
  { id: 'per_child', label: 'Per Child', conservationOnly: true },
  { id: 'per_unit', label: 'Per Unit' },
  { id: 'per_vehicle', label: 'Per Vehicle' }
];

export const unitBasesFor = (item) => {
  const type = surchargeTypeOf(item);
  return UNIT_BASES.filter((u) => !(u.conservationOnly && type !== 'conservation_levy'));
};

export const isValidUnitBasis = (item, basis) =>
  unitBasesFor(item).some((u) => u.id === basis);

export const isSurchargeItem = (item) => /surcharge/i.test(String(item?.category || ''));

export const surchargeTypeOf = (item) => {
  const raw = String(item?.surcharge_type || item?.fee_type || '').toLowerCase();
  if (raw.includes('conservation')) return 'conservation_levy';
  if (raw.includes('entrance')) return 'entrance_fee';
  return 'entrance_fee';
};

export const surchargeBasisOf = (item) =>
  String(item?.surcharge_charge_basis || '') === 'per_night' ? 'per_night' : 'once_off';

export const surchargeUnitBasisOf = (item) => {
  const raw = String(item?.surcharge_unit_basis || 'per_person').toLowerCase();
  return UNIT_BASES.some((u) => u.id === raw) ? raw : 'per_person';
};

/* Default true: a fee that is quoted is a fee that is billed. A tenant that
   wants the supplier figure shown for reference only sets this to false. */
export const isSurchargeChargeable = (item) => item?.surcharge_chargeable !== false;

export const surchargeLinkId = (item) => item?.linked_item_id || item?.surcharge_linked_item_id || null;

export const surchargeLabel = (item) => {
  const type = surchargeTypeOf(item);
  return (SURCHARGE_TYPES.find((t) => t.id === type) || SURCHARGE_TYPES[0]).label;
};

/* The linked accommodation item, if any. */
export const linkedAccommodationOf = (item, allItems = []) => {
  const id = surchargeLinkId(item);
  if (!id) return null;
  return (Array.isArray(allItems) ? allItems : []).find((it) => it.id === id) || null;
};

/* Every surcharge linked to this accommodation, in library order. */
export const surchargesForItem = (accommodationItem, allItems = []) => {
  const id = accommodationItem?.id;
  if (!id) return [];
  return (Array.isArray(allItems) ? allItems : []).filter(
    (it) => isSurchargeItem(it) && surchargeLinkId(it) === id
  );
};

/* Surcharges with no accommodation to hang off. */
export const unlinkedSurcharges = (allItems = []) =>
  (Array.isArray(allItems) ? allItems : []).filter((it) => isSurchargeItem(it) && !surchargeLinkId(it));

/**
 * How many times a surcharge line repeats for a given number of nights.
 *
 * A once-off fee is 1. A per-night fee linked to accommodation repeats for the
 * nights that property is booked. A per-night fee with no link cannot be
 * derived - `needsRepeatPrompt` says so, and the caller asks the operator for
 * the count instead of guessing.
 */
export const surchargeRepeats = ({ item, nights = 1 } = {}) => {
  if (surchargeBasisOf(item) !== 'per_night') return 1;
  const n = Math.max(1, parseInt(nights, 10) || 1);
  return n;
};

export const needsRepeatPrompt = (item) =>
  surchargeBasisOf(item) === 'per_night' && !surchargeLinkId(item);

/**
 * The buy total for one surcharge line, before markup.
 *
 * `paxCount` and `childCount` drive the per-person / per-adult / per-child
 * bases; the other bases are flat. `nights` feeds the per-night repetition.
 */
export const surchargeBuyTotal = ({ rate, item, paxCount = 1, childCount = 0, nights = 1 } = {}) => {
  const unitBasis = surchargeUnitBasisOf(item);
  const type = surchargeTypeOf(item);
  const repeats = surchargeRepeats({ item, nights });
  const adults = Math.max(0, (parseInt(paxCount, 10) || 0) - (parseInt(childCount, 10) || 0));
  const children = Math.max(0, parseInt(childCount, 10) || 0);

  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  /* Each surcharge type stores its figure in a different pair of columns, so
     the basis has to be read against the type rather than against one set of
     columns - otherwise a levy set per adult silently priced as zero (or as the
     wrong number) depending on which columns happened to be filled in. */
  const unitFigure = type === 'conservation_levy'
    ? { adult: num(rate?.conservation_levy_per_adult), child: num(rate?.conservation_levy_per_child) }
    : { adult: num(rate?.entrance_fee_per_person), child: 0, vehicle: num(rate?.entrance_fee_per_vehicle) };

  let perRepeat = 0;
  switch (unitBasis) {
    case 'per_adult':
      perRepeat = (unitFigure.adult || num(rate?.price_1_adult)) * adults;
      break;
    case 'per_child':
      perRepeat = unitFigure.child * children;
      break;
    case 'per_unit':
      perRepeat = num(rate?.unit_price) || num(rate?.price_1_adult);
      break;
    case 'per_vehicle':
      perRepeat = unitFigure.vehicle || unitFigure.adult;
      break;
    case 'per_person':
    default:
      /* Per person means every traveller, so a levy with a separate child
         figure is adult x adults + child x children. Falling back to the adult
         figure for a child would bill the child's price at the adult rate. */
      perRepeat = (type === 'conservation_levy'
        ? (unitFigure.adult * adults) + (unitFigure.child * children)
        : unitFigure.adult * Math.max(1, parseInt(paxCount, 10) || 0));
      break;
  }

  return {
    unitBasis,
    repeats,
    perRepeat,
    total: perRepeat * repeats
  };
};

/**
 * The sell figure for a surcharge line.
 *
 * Chargeable: the supplier's price carries the tenant's markup, like any other
 * bought service. Not chargeable: the figure is passed through exactly as the
 * supplier quoted it - no markup, so nothing is added to the itinerary total
 * even though the line is still shown.
 */
export const surchargePricing = ({ buyTotal, markupPercent = 0, chargeable = true } = {}) => {
  const buy = parseFloat(buyTotal) || 0;
  if (!chargeable) {
    /* A passed-through fee carries no money, but its supplier figure has to stay
       on the line so the operator can still see what the property told them.
       Dropping it here is what made a "not chargeable" fee print as a blank
       line with no explanation. */
    return { buy: 0, sell: 0, markup: 0, passedThrough: true, reference: buy };
  }
  const markup = Math.max(0, parseFloat(markupPercent) || 0);
  const sell = buy * (1 + markup / 100);
  return { buy, sell, markup, passedThrough: false, reference: buy };
};

/* One-line summary used in toasts. */
export const surchargeRepeatSummary = ({ item, nights = 1, repeats } = {}) => {
  const n = repeats === undefined ? surchargeRepeats({ item, nights }) : repeats;
  if (n <= 1) return '';
  return `repeated ${n}x`;
};
