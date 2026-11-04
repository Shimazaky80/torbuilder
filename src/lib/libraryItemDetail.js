/* The read-only rate card behind the library "eye" action, and the document the
 * export buttons print.
 *
 * Every category is charged differently, so one flat table of column names
 * cannot be read: a transfer is sold per vehicle (or by pax tier), a meal per
 * person, a guide per trip, a room by sharing basis. This module turns an item
 * and its rate rows into one presentation shape that both the on-screen modal
 * and the Word / Excel / PDF exports render, so an exported sheet can never
 * drift from what the operator saw on screen.
 *
 * Occupancy and child tiers describe a room, not a per-person or per-vehicle
 * price, so they only appear for accommodation. Guide, transport, meals and the
 * rest show the figures they actually charge and nothing else.
 */

import {
  CHARGE_BASIS,
  SURCHARGE_CATEGORY,
  SURCHARGE_TYPES,
  UNIT_BASES,
  isSurchargeChargeable,
  isSurchargeItem,
  feeUsesLevyColumns,
  surchargeBasisOf,
  surchargeTypeOf,
  surchargeUnitBasisOf
} from './surchargeFees';
import { normaliseSingleSupplementLadder, stripWaiverNote, waiverFromLadder } from './singleSupplement';
import { collapseOccupancyLadder, isOccupancyBasis, isOccupancyTiered } from './occupancyPricing';
import { nightBandLabel, weekendDaysLabel, weekendPriceOf } from './accommodationOptions';
import { crewLadderTiers, normaliseStaffTiers, staffTierBands } from './staffRoomTiers';
import { starGlyphs } from './starGrading';
import { carRentalGroups } from './carRentalPricing';

/* The destination an item is picked by: the region (for a property, the city its
   supplier is in) narrowed by its area. `location` is the older single field and
   stands in when no region was ever set. An item with none of them returns '', so
   a picker can say the destination is unknown instead of printing nothing and
   leaving the operator to wonder where the item went. Any library select that
   feeds a picker has to name all three columns, or every card reads
   "No destination set". */
export const itemDestinationLabel = (item = {}) => {
  const region = item.destination_region || item.destinationRegion || item.location
    || item.destination_area || item.destinationArea;
  const area = item.destination_area || item.destinationArea;
  return [region, area]
    .map((part) => String(part || '').trim())
    .filter((part, index, all) => part && all.indexOf(part) === index)
    .join(' \u00b7 ');
};

export const libraryItemKind = (category) => {
  const value = String(category || '').trim();
  if (isSurchargeItem({ category: value })) return 'surcharge';
  if (value === 'Accommodation') return 'accommodation';
  if (value === 'Transfers') return 'transfers';
  if (value === 'Transport') return 'transport';
  if (value === 'Activities / Tours') return 'activities';
  if (value === 'Flights / Charter') return 'flights';
  if (value === 'Meals') return 'meals';
  if (value === 'Trains') return 'trains';
  if (value === 'Tickets') return 'tickets';
  if (value === 'Extras') return 'extras';
  if (value === 'Car Rental') return 'car_rental';
  if (value === 'Guide' || value === 'Guide / Driver') return 'guide';
  return 'other';
};

const CATEGORY_LABELS = {
  accommodation: 'Accommodation',
  transfers: 'Transfers',
  transport: 'Transport',
  activities: 'Activities / Tours',
  flights: 'Flights / Charter',
  meals: 'Meals',
  trains: 'Trains',
  tickets: 'Tickets',
  extras: 'Extras',
  car_rental: 'Car Rental',
  guide: 'Guide',
  surcharge: SURCHARGE_CATEGORY,
  other: 'Service'
};

/* The basis is stored on the rate row, but an older row can rely on the item's
   pricing model instead; either one names the same contract. */
const BASIS_LABELS = {
  per_person: 'per person',
  per_person_sharing: 'per person sharing',
  per_person_occupancy: 'per person by occupancy',
  per_room: 'per room',
  per_vehicle: 'per vehicle',
  per_trip: 'per trip',
  per_unit: 'per unit',
  per_adult: 'per adult',
  per_child: 'per child',
  tiered: 'by pax count'
};

const TICKET_TYPE_LABELS = {
  standard: 'Standard',
  fast_track: 'Fast track',
  both: 'Standard + fast track'
};

const MENU_LABELS = { a_la_carte: 'À la carte', buffet: 'Buffet' };

/* What a hired vehicle is engaged for. The transport_type column is the only
   place the four jobs are told apart, and the driver's meals and overnight follow
   from it, so the rate card names the job it was priced for. */
const TRANSPORT_TYPE_LABELS = {
  tour_activity: 'Tour / activity transport',
  transfer: 'Transfer',
  overland: 'Overland',
  at_disposal: 'At disposal'
};

const GUIDE_SERVICES = [
  ['guide_transfer_rate', 'Transfer'],
  ['guide_half_day_rate', 'Half day'],
  ['guide_full_day_rate', 'Full day'],
  ['guide_overland_rate', 'Overland'],
  ['guide_dinner_rate', 'Dinner transfer']
];

/* Legacy columns that carry a price for custom / uncategorised items. The known
   categories above read their own columns, so this set is only the fallback that
   stops a custom category from printing an empty card. */
const LEGACY_PRICE_KEYS = [
  'price_1_adult', 'price_2_adults', 'price_3_plus_adults', 'unit_price', 'unit_cost',
  'child_discount', 'taxes_and_surcharges', 'fuel_surcharge',
  'entrance_fee_per_person', 'entrance_fee_per_vehicle', 'entrance_fee_per_child',
  'conservation_levy_per_adult', 'conservation_levy_per_child',
  'conservation_levy_adult', 'conservation_levy_child',
  'guide_rate', 'driver_rate', 'guide_transfer_rate', 'guide_half_day_rate',
  'guide_full_day_rate', 'guide_overland_rate', 'guide_dinner_rate',
  'fast_track_adult_rate', 'adult_rate', 'child_rate'
];

const LEGACY_LABELS = {
  price_1_adult: '1 adult (single)',
  price_2_adults: '2 adults sharing (PPS)',
  price_3_plus_adults: '3+ adults (per person)',
  unit_cost: 'Unit cost',
  unit_price: 'Unit price',
  child_discount: 'Child discount',
  taxes_and_surcharges: 'Taxes & surcharges',
  fuel_surcharge: 'Fuel surcharge',
  entrance_fee_per_person: 'Entrance fee / person',
  entrance_fee_per_vehicle: 'Entrance fee / vehicle',
  conservation_levy_per_adult: 'Conservation levy / adult',
  conservation_levy_per_child: 'Conservation levy / child',
  entrance_fee_per_child: 'Entrance fee / child',
  conservation_levy_adult: 'Conservation levy / adult',
  conservation_levy_child: 'Conservation levy / child',
  guide_rate: 'Guide rate',
  driver_rate: 'Driver rate',
  guide_transfer_rate: 'Guide transfer rate',
  guide_half_day_rate: 'Guide half day rate',
  guide_full_day_rate: 'Guide full day rate',
  guide_overland_rate: 'Guide overland rate',
  guide_dinner_rate: 'Guide dinner rate',
  fast_track_adult_rate: 'Fast track adult rate',
  adult_rate: 'Adult rate',
  child_rate: 'Child rate'
};

const has = (value) => value !== null && value !== undefined && value !== '';
/* A blank money box is stored as null / "", so it stays hidden. A bare numeric 0
   is the residue of the old "start every box at 0.00" default and reads as not
   loaded, while an explicitly typed 0.00 survives as the string "0.00" and
   prints as a real price. */
const priced = (value) => has(value) && !(typeof value === 'number' && value === 0);

const firstPriced = (values) => {
  for (const value of values) if (priced(value)) return value;
  return null;
};

const sameAmount = (left, right) =>
  priced(left) && priced(right) && Number(left) === Number(right);

/* A per-vehicle price cell is a number, or a flag object the quote engine reads
   as a deliberate zero: {free:true} is FOC, {na:true} means the vehicle is not
   offered on this contract. An object without either flag is unpriced. */
const vehiclePriceLabel = (value, money) => {
  if (value && typeof value === 'object') {
    if (value.free === true) return 'Free';
    if (value.na === true) return 'n/a';
    return null;
  }
  return priced(value) ? money(value) : null;
};

const labelOf = (list, id) => (list.find((entry) => entry.id === id) || {}).label || id;

const basisOf = (rate, item) => String(rate?.rate_basis || item?.pricing_model || 'per_person').toLowerCase();

const ageText = (band) => `${band.ageFrom ?? 0}\u2013${band.ageTo ?? 18} yrs`;

const bandLabel = (band) => `${band.name || 'Child'} (${ageText(band)})`;

const makeMoney = (currency) => (value) =>
  `${currency ? `${currency} ` : ''}${(Number(value) || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

const factsFor = ({ kind, item, bands, rates }) => {
  const facts = [];
  const push = (label, value) => {
    if (has(value)) facts.push({ label, value: String(value) });
  };

  if (kind === 'accommodation') {
    /* A property sells rooms, not a single occupancy figure. When its room
       types are loaded they are the readable fact; the property-wide columns
       are the legacy shape of a one-room property. */
    const rooms = Array.isArray(item.room_types) ? item.room_types : (Array.isArray(item.roomTypes) ? item.roomTypes : []);
    if (rooms.length) {
      /* A villa room is sold by how many sleep in it, and the number of beds the
         ladder prices is the capacity an operator can actually sell. */
      push('Room types', rooms
        .map((room) => {
          const name = room.name || 'Room';
          const beds = room.maxOccupancy ?? room.max_occupancy ?? 1;
          return isOccupancyBasis(room.pricingModel ?? room.pricing_model)
            ? `${name} (sleeps ${beds}, priced per person by occupancy)`
            : `${name} (sleeps ${beds})`;
        })
        .join(' \u00b7 '));
    } else {
      push('Max occupancy', item.max_occupancy);
      push('Max adults', item.max_adults);
    }
    if (bands.length) push('Child age tiers', bands.map(bandLabel).join(' \u00b7 '));
    /* The default board is not a library_items column: every season row carries
       its own board, and the first one that has a figure is the item default. */
    push('Default board', item.meal_plan || rates.map((rate) => rate?.meal_plan).find(Boolean));
  }

  if (kind === 'surcharge') {
    push('Fee type', labelOf(SURCHARGE_TYPES, surchargeTypeOf(item)));
    push('Charged', labelOf(CHARGE_BASIS, surchargeBasisOf(item)));
    push('Rate is per', labelOf(UNIT_BASES, surchargeUnitBasisOf(item)));
    if (!isSurchargeChargeable(item)) push('Chargeable', 'No \u2014 shown for reference');
  }

  if (kind === 'meals') {
    push('Meal', item.meal_type);
    push('Menu', MENU_LABELS[item.menu_type]);
    if (Number(item.meal_gratuity_percent) > 0) push('Gratuity', `${item.meal_gratuity_percent}%`);
  }

  if (kind === 'tickets') push('Ticket type', TICKET_TYPE_LABELS[item.ticket_type]);

  if (kind === 'trains') {
    push('Cabin', item.train_cabin_name);
    if (Number(item.train_journey_nights) > 0) push('Journey', `${item.train_journey_nights} night${Number(item.train_journey_nights) === 1 ? '' : 's'}`);
  }

  if (kind === 'flights') {
    const route = [item.departure_city, item.arrival_city].filter(Boolean).join(' \u2192 ');
    push('Route', route);
    push('Airline', item.airline_name);
    push('Flight', item.flight_number);
  }

  if (kind === 'transport') {
    /* A transport item is the vehicle itself, so the card says which vehicle and
       what it is engaged for — the two facts that decide the hire price. The
       vehicle label is optional: an item that never carried one stores its own
       category here, and repeating the heading as a fact says nothing. */
    const vehicle = String(item.sub_category || '').trim();
    push('Vehicle', vehicle && vehicle !== String(item.category || '').trim() ? vehicle : '');
    push('Hired for', TRANSPORT_TYPE_LABELS[item.transport_type] || item.transport_type);
  }

  return facts;
};

/* Child rows read the JSONB map the season row holds. A tour-style item stores a
   single "child" key (the child age is the item's only tier), while an
   accommodation / ticket item keys the map by child band id. */
const childRows = ({ map, bands, money, kind, legacy }) => {
  if (map && typeof map === 'object') {
    const banded = bands
      .filter((band) => priced(map[band.id]))
      .map((band) => ({
        label: bands.length > 1 || kind === 'tickets' ? bandLabel(band) : `Child rate (${ageText(band)})`,
        value: money(map[band.id])
      }));
    if (banded.length) return banded;
    if (priced(map.child)) return [{ label: 'Child', value: money(map.child) }];
  }
  /* A rate written before the breakdown map existed carries a single child
     figure on the legacy column. */
  if (priced(legacy)) return [{ label: 'Child', value: money(legacy) }];
  return [];
};

const priceRows = ({ item, rate, kind, money, vehicleName }) => {
  const rows = [];
  const push = (label, value) => rows.push({ label, value });
  const basis = basisOf(rate, item);

  if (kind === 'accommodation' || kind === 'trains') {
    const noun = kind === 'trains' ? 'Cabin' : 'Room';
    if (isOccupancyTiered(rate)) {
      /* A villa is contracted on how many sleep in it. Every head in the room
         pays the band its own occupant count selects, so the card prints the
         ladder and nothing else: no adult/child split (a child pays the band)
         and no single supplement (a party of two pays the 2 pax figure, it is
         not charged a penalty for leaving beds empty). */
      collapseOccupancyLadder(rate).forEach((band) => {
        const size = band.minPax === band.maxPax
          ? `${band.minPax} pax`
          : `${band.minPax}\u2013${band.maxPax} pax`;
        push(size, `${money(band.rate)} per person / night`);
      });
      return rows;
    }
    if (basis === 'per_room') {
      /* A flat rate is quoted for the room/cabin as a whole. The single-occupancy
         figure is the second number the flat mode needs, and it is only worth a
         row when it differs from the whole-unit price. */
      const whole = firstPriced([rate.unit_price, rate.price_2_adults, rate.double_twin_rate]);
      if (priced(whole)) push(`${noun} rate (per ${noun.toLowerCase()})`, money(whole));
      const single = firstPriced([rate.single_room_rate, rate.effective_single_rate, rate.price_1_adult]);
      if (priced(single) && !sameAmount(single, whole)) {
        push(kind === 'trains' ? 'Single cabin (1 adult)' : 'Single occupancy (1 adult)', money(single));
      }
      if (priced(rate.price_3_plus_adults) && !sameAmount(rate.price_3_plus_adults, whole)) {
        push('3+ adults (per person)', money(rate.price_3_plus_adults));
      }
    } else {
      const p1 = firstPriced([rate.price_1_adult, rate.single_room_rate, rate.effective_single_rate]);
      if (priced(p1)) push('1 adult (single)', money(p1));
      const p2 = firstPriced([rate.price_2_adults, rate.double_twin_rate])
        ?? (priced(rate.unit_price) && !sameAmount(rate.unit_price, p1) ? rate.unit_price : null);
      if (priced(p2)) push('2 adults sharing (PPS)', money(p2));
      if (priced(rate.price_3_plus_adults)) push('3+ adults (per person)', money(rate.price_3_plus_adults));
      /* The single rate above already states what a lone guest pays, so the card
         does not repeat the gap to the sharing rate as a "single supplement".
         What the contract adds is how many single rooms are waived before that
         single rate applies — the only supplement figure the library stores. */
      const supplierLadder = normaliseSingleSupplementLadder(rate);
      const waivedRooms = waiverFromLadder(rate);
      if (waivedRooms > 0) {
        push(
          'Single supplement',
          waivedRooms === 1
            ? 'waived for the first single room'
            : `waived for the first ${waivedRooms} single rooms`
        );
      }
      /* Older contracts may still carry charged tiers. Print those — the waived
         rooms are already named above. */
      let coveredSingles = 0;
      supplierLadder.forEach((tier) => {
        const from = coveredSingles + 1;
        if (tier.supplement !== 0) {
          push(
            from === tier.singles ? `Single room ${tier.singles}` : `Single rooms ${from}\u2013${tier.singles}`,
            money(tier.supplement)
          );
        }
        coveredSingles = tier.singles;
      });
      if (priced(rate.child_discount)) push('Child discount', `${rate.child_discount}%`);
    }
    /* A weekend price is a per-night figure beside the normal one, on the
       nights the contract names - not a second charge type. */
    const weekendNights = weekendDaysLabel(rate);
    const weekendPrice = weekendPriceOf(rate);
    if (weekendNights && priced(weekendPrice)) {
      push(`Weekend rate (${weekendNights})`, `${money(weekendPrice)} / ${noun.toLowerCase()} / night`);
    }
  }

  if (kind === 'transfers' || kind === 'transport' || kind === 'activities' || kind === 'flights') {
    /* A transfer / transport / activity is sold three ways: a flat rate per
       vehicle, a rate banded by party size, or a straight per-person fare. The
       rows follow the loaded basis rather than a fixed column order, so a
       per-vehicle contract never prints its figure under a "1 adult" label. */
    /* A hired vehicle is bought whole, so a transport card names the vehicle; the
       older categories keep the generic "unit" wording they have always printed. */
    const unitNoun = kind === 'transport' ? 'vehicle' : 'unit';
    if (basis === 'per_vehicle') {
      const vehiclePrices = Object.entries(rate.prices_by_vehicle || {})
        .map(([code, value]) => [vehicleName(code), vehiclePriceLabel(value, money)])
        .filter(([, label]) => label !== null);
      if (vehiclePrices.length) {
        vehiclePrices.forEach(([label, value]) => push(label, `${value} / ${unitNoun}`));
      } else {
        const flat = firstPriced([rate.unit_price, rate.price_1_adult, rate.adult_rate]);
        if (priced(flat)) push(kind === 'flights' ? 'Charter (per flight)' : kind === 'transport' ? 'Per vehicle' : 'Per unit', money(flat));
      }
    } else if (basis === 'tiered') {
      const tiers = (Array.isArray(rate.tiered_pricing) ? rate.tiered_pricing : [])
        .filter((tier) => tier && priced(tier.rate));
      if (tiers.length) {
        tiers.forEach((tier) => push(`${tier.min_pax ?? '?'}\u2013${tier.max_pax ?? '?'} pax`, `${money(tier.rate)} / unit`));
      } else {
        const flat = firstPriced([rate.price_1_adult, rate.unit_price, rate.adult_rate]);
        if (priced(flat)) push('Per unit', money(flat));
      }
    } else {
      const adult = firstPriced([rate.price_1_adult, rate.unit_price, rate.adult_rate]);
      if (priced(adult)) push('Per person', money(adult));
    }

    /* The seat the supplier sells the guide is a fare of its own, so the card
       names it beside the clients' price instead of leaving the operator to work
       it out. Only a flight the supplier offers the guide on prints it. A charter
       prices the whole aircraft, so there only a typed crew figure can price one
       seat; on a per-person flight the clients' fare is the fallback. */
    if (kind === 'flights' && (item.guide_flight_offered === true || priced(rate.guide_rate))) {
      const clientsFare = basis === 'per_vehicle'
        ? null
        : firstPriced([rate.price_1_adult, rate.unit_price, rate.adult_rate]);
      const crewFare = firstPriced([rate.guide_rate, clientsFare]);
      if (priced(crewFare)) push('Guide seat', `${money(crewFare)} / person`);
    }

    /* An activity's own tariff can price the guide's place too - a game drive
       charges for every seat it fills, including the guide's. */
    if (kind === 'activities' && priced(rate.guide_rate)) {
      push("Guide's place", `${money(rate.guide_rate)} / person`);
    }
  }

  if (kind === 'meals' || kind === 'extras') {
    const adult = firstPriced([rate.price_1_adult, rate.unit_price, rate.adult_rate]);
    if (priced(adult)) push(basis === 'per_unit' ? 'Per unit (whole service)' : 'Per person', money(adult));
  }

  if (kind === 'tickets') {
    const adult = firstPriced([rate.price_1_adult, rate.adult_rate]);
    if (priced(adult)) {
      push(item.ticket_type === 'fast_track' ? 'Fast track (per person)' : 'Per person', money(adult));
    }
    if (priced(rate.fast_track_adult_rate) && item.ticket_type !== 'fast_track') {
      push('Fast track (per person)', money(rate.fast_track_adult_rate));
    }
  }

  if (kind === 'guide') {
    GUIDE_SERVICES.forEach(([key, label]) => {
      if (priced(rate[key])) push(label, money(rate[key]));
    });
  }

  if (kind === 'surcharge') {
    const unit = surchargeUnitBasisOf(item);
    /* The flat bases buy a thing, not a head, so they print that one figure and
       no ladder beside it. A vehicle is a vehicle whoever quotes it: the same
       column serves an entrance fee, a ticket and a levy. */
    if (unit === 'per_vehicle') {
      if (priced(rate.entrance_fee_per_vehicle)) push('Per vehicle', money(rate.entrance_fee_per_vehicle));
    } else if (unit === 'per_unit') {
      if (priced(rate.unit_price)) push('Per unit', money(rate.unit_price));
    } else if (feeUsesLevyColumns(item)) {
      const adult = firstPriced([rate.conservation_levy_per_adult, rate.conservation_levy_adult]);
      const child = firstPriced([rate.conservation_levy_per_child, rate.conservation_levy_child]);
      if (priced(adult)) {
        const adultOnly = priced(child) || unit === 'per_adult';
        push(!adultOnly && unit === 'per_person' ? 'Per person' : 'Per adult', money(adult));
      }
      if (priced(child)) push('Per child', money(child));
      if (priced(rate.guide_rate)) push("Guide's place", money(rate.guide_rate));
    } else {
      if (priced(rate.entrance_fee_per_person)) {
        push(unit === 'per_adult' ? 'Per adult' : 'Per person', money(rate.entrance_fee_per_person));
      }
      /* An entrance fee with a child figure is one the park splits by age; with
         none, a child walks in on the visitor price and there is nothing to
         print. */
      if (priced(rate.entrance_fee_per_child)) push('Per child', money(rate.entrance_fee_per_child));
      if (priced(rate.guide_rate)) push("Guide's place", money(rate.guide_rate));
    }
  }

  if (kind === 'other') {
    const seen = new Set();
    LEGACY_PRICE_KEYS.forEach((key) => {
      const value = rate[key];
      if (!priced(value)) return;
      if (key === 'child_discount') {
        push(LEGACY_LABELS[key], `${value}%`);
        return;
      }
      const signature = Number(value);
      if (['price_1_adult', 'price_2_adults', 'price_3_plus_adults', 'unit_price', 'unit_cost'].includes(key)) {
        if (seen.has(signature)) return;
        seen.add(signature);
      }
      push(LEGACY_LABELS[key] || key.replace(/_/g, ' '), money(value));
    });
  }

  /* Charges that sit on top of the headline figure are the same wherever they
     are found. */
  if (priced(rate.taxes_and_surcharges)) push('Taxes & surcharges', money(rate.taxes_and_surcharges));
  if (priced(rate.fuel_surcharge)) push('Fuel surcharge', money(rate.fuel_surcharge));

  return rows;
};

/* One row per client-room band, so the card states the range each rate covers
   ("1–10 client rooms", then "11+") instead of a bare threshold. A tier states
   the TOTAL rooms included, so a band that adds rooms names how many. */
const ladderRows = ({ label, ladder, roomLabel, meals, money }) => staffTierBands(ladder).map((band) => {
  const range = band.maxRooms === null ? `${band.minRooms}+` : `${band.minRooms}\u2013${band.maxRooms}`;
  const rooms = `${band.rooms} ${roomLabel}${band.rooms === 1 ? '' : 's'}${band.added > 0 && band.rooms > band.added ? ` (${band.added} more)` : ''}`;
  return {
    label: `${label} (${range} client rooms)`,
    value: `${rooms} @ ${money(band.rate)}${meals ? ` \u00b7 ${meals}` : ''}`
  };
});

/* A property contracts ONE pool of crew rooms — its rate card reads
   "Driver-Guide room", meaning whichever of the guide and the driver beds first
   takes it — so the card states the rule once instead of a deal per party. The
   meal plans stay per person, so they are named together and only split out when
   the property feeds the two differently. */
const crewRows = ({ tiers, meals, money }) => ladderRows({
  label: 'Driver-Guide',
  ladder: tiers,
  roomLabel: 'crew room',
  meals,
  money
});

const seasonCard = ({ item, rate, index, kind, money, bands, vehicleName }) => {
  const sections = [];

  const prices = priceRows({ item, rate, kind, money, vehicleName });
  if (prices.length) {
    sections.push({
      key: 'prices',
      title: 'Prices',
      note: kind === 'guide' ? 'Per trip, shared among travellers.' : undefined,
      rows: prices
    });
  }

  if (kind === 'accommodation' || kind === 'trains') {
    const standard = childRows({ map: rate.child_rates_breakdown, bands, money, kind, legacy: rate.child_rate });
    if (standard.length) {
      sections.push({ key: 'child', title: kind === 'trains' ? 'Child rate' : 'Child sharing rates', rows: standard });
    }
  } else if (kind !== 'guide' && kind !== 'surcharge') {
    /* A service charged once for itself bills no head at all, so a child figure
       against it is a rate-card number nothing will ever invoice. */
    const perUnit = basisOf(rate, item) === 'per_unit';
    const standard = perUnit ? [] : childRows({ map: rate.child_rates_breakdown, bands, money, kind, legacy: rate.child_rate });
    if (standard.length) sections.push({ key: 'child', title: 'Child rate', rows: standard });
    if (kind === 'tickets') {
      const fastTrack = childRows({ map: rate.fast_track_child_rates_breakdown, bands, money, kind, legacy: rate.fast_track_child_rate });
      if (fastTrack.length) sections.push({ key: 'fast-child', title: 'Fast track child rates', rows: fastTrack });
    }
  }

  if (kind === 'accommodation') {
    const board = rate.meal_plan || item.meal_plan;
    const guideMeals = rate.guide_meal_plan || board;
    const driverMeals = rate.driver_meal_plan || board;
    /* A tour leader room can be free, so a 0 is a configured price here; only a
       missing rate reads as "charge the single rate". */
    const tlConfigured = has(rate.tour_leader_rate);
    const tlTiers = normaliseStaffTiers(rate.tour_leader_tiers);
    /* One pool, one rule: the crew ladder a property typed into either column. */
    const crewTiers = crewLadderTiers(rate.guide_tiers, rate.driver_tiers);
    if (priced(rate.guide_rate) || priced(rate.driver_rate) || item.guide_driver_room_offered || crewTiers.length || tlConfigured || item.tour_leader_room_offered) {
      const rows = [];
      const crewMinRooms = Math.max(1, Number(item.guide_min_rooms) || 1);
      /* The pool is one deal, so the guide figure heads it and the driver figure
         stands in only where the guide box was left blank. A blank pair means the
         property beds crew at its own single rate. */
      const crewConfigured = priced(rate.guide_rate) || priced(rate.driver_rate);
      const crewHeadline = firstPriced([rate.guide_rate, rate.driver_rate]);
      const crewSingle = firstPriced([rate.price_1_adult, rate.single_room_rate, rate.effective_single_rate, rate.unit_price]);
      const crewMealNote = !guideMeals ? '' : (guideMeals === driverMeals ? guideMeals : `${guideMeals} guide \u00b7 ${driverMeals} driver`);
      if (crewTiers.length) {
        rows.push(...crewRows({ tiers: crewTiers, meals: crewMealNote, money }));
      } else if (crewConfigured || item.guide_driver_room_offered) {
        /* The crew bed follows the same contract shape as the TL deal: the
           property's crew rate only applies once its minimum client rooms are
           booked, and a blank rate falls back to the single rate. Print both the
           threshold and the figure actually charged instead of a dash. */
        const charged = crewConfigured ? crewHeadline : crewSingle;
        rows.push({
          label: `Driver-Guide${crewConfigured
            ? (crewMinRooms > 1 ? ` (from ${crewMinRooms} client rooms)` : '')
            : ` (single rate${crewMinRooms > 1 ? ` until ${crewMinRooms} client rooms` : ''})`}`,
          value: `${charged !== null ? money(charged) : '\u2014'}${crewMealNote ? ` \u00b7 ${crewMealNote}` : ''}`
        });
      }
      if (tlConfigured || item.tour_leader_room_offered || tlTiers.length) {
        const boardSuffix = board ? ` \u00b7 ${board}` : '';
        if (tlTiers.length) {
          /* A ladder replaces the flat TL rate. One row per client-room band
             keeps the "how many client rooms include how many TL rooms, at
             what rate" readable instead of hiding it in a trailing sentence. */
          rows.push(...ladderRows({
            label: 'Tour Leader',
            ladder: tlTiers,
            roomLabel: 'TL room',
            meals: board,
            money
          }));
        } else {
          /* No ladder: one TL room is included from the item's threshold, priced
             at the TL rate or — when that box was left blank — at the Single
             rate the pricing engine falls back to. Printing a dash there hides
             the figure the client is actually charged. */
          const minRooms = Math.max(1, Number(item.tour_leader_min_rooms) || 1);
          const singleRate = firstPriced([rate.price_1_adult, rate.single_room_rate, rate.effective_single_rate, rate.unit_price]);
          const headline = tlConfigured ? rate.tour_leader_rate : singleRate;
          const fallback = !tlConfigured && priced(singleRate) ? ' \u00b7 single rate' : '';
          rows.push({
            label: `Tour Leader (from ${minRooms} client room${minRooms === 1 ? '' : 's'})`,
            value: `${headline !== null ? money(headline) : '\u2014'}${boardSuffix}${fallback}`
          });
        }
      }
      sections.push({ key: 'guide-driver', title: 'Guide & driver', rows });
    }
  }

  /* A meal the crew is booked on prints the figure the guide or driver is
     actually charged: the contracted crew rate, or the adult fare it falls back
     to when that box was left blank. */
  if (kind === 'meals') {
    const adult = firstPriced([rate.price_1_adult, rate.unit_price]);
    const crewRow = (label, crewRate) => {
      const configured = priced(crewRate);
      const headline = configured ? crewRate : adult;
      return {
        label,
        value: `${headline !== null ? money(headline) : '\u2014'} / person${!configured && priced(adult) ? ' \u00b7 adult fare' : ''}`
      };
    };
    const rows = [];
    if (item.guide_meal_offered === true || priced(rate.guide_rate)) rows.push(crewRow('Guide', rate.guide_rate));
    if (item.driver_meal_offered === true || priced(rate.driver_rate)) rows.push(crewRow('Driver', rate.driver_rate));
    if (rows.length) sections.push({ key: 'guide-driver', title: 'Guide & driver', rows });
  }

  const chips = [
    rate.room_type,
    `${rate.valid_from || 'open'}\u2013${rate.valid_to || 'open'}`,
    kind === 'surcharge' ? null : BASIS_LABELS[basisOf(rate, item)],
    rate.meal_plan,
    nightBandLabel(rate)
  ].filter(Boolean);

  return {
    key: rate.id ?? `season-${index}`,
    title: rate.season_name || rate.option_name || `Season ${index + 1}`,
    chips,
    sections,
    notes: stripWaiverNote(rate.notes)
  };
};

/* A vehicle group is one card, and the card prints the tariff seasons the group
   is actually sold across. With one window the bands carry just their day range,
   as they always did; with several, every band names the window it belongs to,
   because two ladders for the same car are only two ladders if you can tell which
   weeks each one speaks for. */
const carRentalCard = (group, index, money) => {
  const many = group.seasons.length > 1;
  return {
    key: group.key || `car-${index}`,
    title: [group.vehicleGroup, group.vehicleName].filter(Boolean).join(' \u00b7 ') || 'Vehicle',
    chips: [
      group.rateCode,
      group.kmsUnlimited !== false ? 'Unlimited km' : `${group.kmsIncluded || 0} km included`,
      many ? `${group.seasons.length} rental price seasons` : group.seasons[0]?.windowLabel
    ].filter(Boolean),
    rows: group.seasons.flatMap((season) => season.bands.map((band) => ({
      label: `${many ? `${season.windowLabel} \u00b7 ` : ''}${band.minDays}\u2013${band.maxDays === null ? '\u221e' : band.maxDays} days`,
      value: `${money(band.price)} / vehicle`
    })))
  };
};

export const libraryItemDetail = ({ item = {}, vehicleTypes = [] } = {}) => {
  const kind = libraryItemKind(item.category);
  const currency = item.currency || item.currency_code || '';
  const money = makeMoney(currency);
  const bands = Array.isArray(item.child_age_ranges) ? item.child_age_ranges : [];
  const rates = Array.isArray(item.item_rates) ? item.item_rates : [];
  const vehicleName = (code) =>
    vehicleTypes.find((type) => String(type.id ?? type.code) === String(code))?.name || code;

  /* Folded by the same engine that prices a hire, so the card and the drop dialog
     describe the same contract: groups, the seasons each group is sold across, and
     the ladder inside each season. */
  const carGroups = carRentalGroups(item);

  const seasons = rates.map((rate, index) => seasonCard({ item, rate, index, kind, money, bands, vehicleName }));

  const basis = String(item.pricing_model || '').toLowerCase();
  /* A graded hotel carries its stars wherever the property is named, on screen
     and in every export of this card. */
  const supplierChip = item.supplier?.name
    ? [item.supplier.name, starGlyphs(item.supplier.star_rating)].filter(Boolean).join(' \u00b7 ')
    : '';
  const chips = [
    { kind: 'category', text: CATEGORY_LABELS[kind] },
    supplierChip ? { kind: 'supplier', text: supplierChip } : null,
    itemDestinationLabel(item) ? { kind: 'destination', text: itemDestinationLabel(item) } : null,
    currency ? { kind: 'currency', text: currency } : null,
    kind === 'surcharge' ? null : BASIS_LABELS[basis] ? { kind: 'basis', text: BASIS_LABELS[basis] } : null
  ].filter(Boolean);

  return {
    kind,
    name: item.name || 'Untitled item',
    identifierCode: item.identifier_code || '',
    currency,
    chips,
    facts: factsFor({ kind, item, bands, rates }),
    seasons,
    carRental: carGroups.map((group, index) => carRentalCard(group, index, money)),
    empty: seasons.length === 0 && carGroups.length === 0
  };
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const escapeMultiline = (value) => escapeHtml(value).replace(/\r?\n/g, '<br>');

/* One self-contained HTML document feeds all three exports: Word accepts it as a
   .doc, Excel reads the tables out of a .xls, and the PDF path opens it in a
   print window. Keeping a single serialisation means the three formats cannot
   show different numbers. */
export const detailDocumentHtml = (model) => {
  const title = model.identifierCode ? `${model.name} \u2014 ${model.identifierCode}` : model.name;
  const facts = model.facts.length
    ? `<table class="facts">${model.facts
      .map((fact) => `<tr><th>${escapeHtml(fact.label)}</th><td>${escapeHtml(fact.value)}</td></tr>`)
      .join('')}</table>`
    : '';

  const sectionMarkup = (section) => `
    <h3>${escapeHtml(section.title)}</h3>
    ${section.note ? `<p class="note">${escapeHtml(section.note)}</p>` : ''}
    <table class="rows">
      ${section.rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td class="value">${escapeHtml(row.value)}</td></tr>`).join('')}
    </table>`;

  const seasonMarkup = model.seasons
    .map((season) => `
    <section class="card">
      <h2>${escapeHtml(season.title)}</h2>
      ${season.chips.length ? `<p class="chips">${season.chips.map(escapeHtml).join(' \u00b7 ')}</p>` : ''}
      ${season.sections.map(sectionMarkup).join('')}
      ${season.notes ? `<p class="note">${escapeMultiline(season.notes)}</p>` : ''}
    </section>`)
    .join('');

  const carMarkup = model.carRental.length
    ? `<section class="card"><h2>Car rental rates</h2>${model.carRental
      .map((group) => `
      <h3>${escapeHtml(group.title)}</h3>
      ${group.chips.length ? `<p class="chips">${group.chips.map(escapeHtml).join(' \u00b7 ')}</p>` : ''}
      <table class="rows">
        ${group.rows.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td class="value">${escapeHtml(row.value)}</td></tr>`).join('')}
      </table>`)
      .join('')}</section>`
    : '';

  const empty = model.empty
    ? '<p class="note">No rates have been recorded for this item yet.</p>'
    : '';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @page { margin: 18mm; }
  body { font: 12px Arial, Helvetica, sans-serif; color: #0f172a; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; color: #0d7478; }
  .meta { color: #475569; font-size: 11px; margin-bottom: 14px; }
  .facts { border-collapse: collapse; margin-bottom: 16px; font-size: 11px; }
  .facts th { text-align: left; color: #64748b; font-weight: 700; padding: 2px 14px 2px 0; white-space: nowrap; }
  .facts td { padding: 2px 0; }
  .card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 14px; margin-bottom: 14px; page-break-inside: avoid; }
  h2 { font-size: 14px; margin: 0 0 2px; }
  h3 { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; margin: 12px 0 4px; }
  .chips { color: #64748b; font-size: 10px; margin: 0 0 6px; }
  .note { color: #64748b; font-size: 10px; margin: 6px 0; }
  table.rows { border-collapse: collapse; width: 100%; }
  table.rows td { border-bottom: 1px dashed #e2e8f0; padding: 4px 0; font-size: 11px; }
  table.rows td:first-child { color: #475569; }
  table.rows td.value { text-align: right; font-weight: 700; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<div class="meta">${model.chips.map((chip) => escapeHtml(chip.text)).join(' \u00b7 ')}</div>
${facts}
${empty}
${seasonMarkup}
${carMarkup}
</body>
</html>`;
};
