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
  surchargeBasisOf,
  surchargeTypeOf,
  surchargeUnitBasisOf
} from './surchargeFees';

export const libraryItemKind = (category) => {
  const value = String(category || '').trim();
  if (value === SURCHARGE_CATEGORY) return 'surcharge';
  if (value === 'Accommodation') return 'accommodation';
  if (value === 'Transfers') return 'transfers';
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
  'entrance_fee_per_person', 'entrance_fee_per_vehicle',
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
    push('Max occupancy', item.max_occupancy);
    push('Max adults', item.max_adults);
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
      if (priced(rate.single_supplement)) push('Single supplement', money(rate.single_supplement));
      if (priced(rate.child_discount)) push('Child discount', `${rate.child_discount}%`);
    }
  }

  if (kind === 'transfers' || kind === 'activities' || kind === 'flights') {
    /* A transfer / activity is sold three ways: a flat rate per vehicle, a rate
       banded by party size, or a straight per-person fare. The rows follow the
       loaded basis rather than a fixed column order, so a per-vehicle contract
       never prints its figure under a "1 adult" label. */
    if (basis === 'per_vehicle') {
      const vehiclePrices = Object.entries(rate.prices_by_vehicle || {})
        .map(([code, value]) => [vehicleName(code), vehiclePriceLabel(value, money)])
        .filter(([, label]) => label !== null);
      if (vehiclePrices.length) {
        vehiclePrices.forEach(([label, value]) => push(label, `${value} / unit`));
      } else {
        const flat = firstPriced([rate.unit_price, rate.price_1_adult, rate.adult_rate]);
        if (priced(flat)) push(kind === 'flights' ? 'Charter (per flight)' : 'Per unit', money(flat));
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
  }

  if (kind === 'meals' || kind === 'extras') {
    const adult = firstPriced([rate.price_1_adult, rate.unit_price, rate.adult_rate]);
    if (priced(adult)) push('Per person', money(adult));
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
    if (surchargeTypeOf(item) === 'conservation_levy') {
      const adult = firstPriced([rate.conservation_levy_per_adult, rate.conservation_levy_adult]);
      const child = firstPriced([rate.conservation_levy_per_child, rate.conservation_levy_child]);
      if (priced(adult)) {
        const adultOnly = priced(child) || unit === 'per_child' || unit === 'per_adult';
        push(!adultOnly && unit === 'per_person' ? 'Per person' : unit === 'per_unit' ? 'Per unit' : 'Per adult', money(adult));
      }
      if (priced(child)) push('Per child', money(child));
    } else {
      if (priced(rate.entrance_fee_per_person)) {
        push(unit === 'per_unit' ? 'Per unit' : unit === 'per_adult' ? 'Per adult' : 'Per person', money(rate.entrance_fee_per_person));
      }
      if (priced(rate.entrance_fee_per_vehicle)) push('Per vehicle', money(rate.entrance_fee_per_vehicle));
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
    const standard = childRows({ map: rate.child_rates_breakdown, bands, money, kind, legacy: rate.child_rate });
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
    if (priced(rate.guide_rate) || priced(rate.driver_rate) || item.guide_driver_room_offered || priced(rate.tour_leader_rate) || item.tour_leader_room_offered) {
      const rows = [];
      if (priced(rate.guide_rate) || item.guide_driver_room_offered) {
        rows.push({ label: 'Guide', value: `${priced(rate.guide_rate) ? money(rate.guide_rate) : '\u2014'}${guideMeals ? ` \u00b7 ${guideMeals}` : ''}` });
      }
      if (priced(rate.driver_rate) || item.guide_driver_room_offered) {
        rows.push({ label: 'Driver', value: `${priced(rate.driver_rate) ? money(rate.driver_rate) : '\u2014'}${driverMeals ? ` \u00b7 ${driverMeals}` : ''}` });
      }
      if (priced(rate.tour_leader_rate) || item.tour_leader_room_offered) {
        rows.push({ label: 'Tour Leader', value: `${priced(rate.tour_leader_rate) ? money(rate.tour_leader_rate) : '\u2014'}${board ? ` \u00b7 ${board}` : ''}` });
      }
      sections.push({ key: 'guide-driver', title: 'Guide & driver', rows });
    }
  }

  if (kind === 'meals' && (priced(rate.guide_rate) || priced(rate.driver_rate))) {
    const rows = [];
    if (priced(rate.guide_rate)) rows.push({ label: 'Guide', value: `${money(rate.guide_rate)} / person` });
    if (priced(rate.driver_rate)) rows.push({ label: 'Driver', value: `${money(rate.driver_rate)} / person` });
    sections.push({ key: 'guide-driver', title: 'Guide & driver', rows });
  }

  const chips = [
    `${rate.valid_from || 'open'}\u2013${rate.valid_to || 'open'}`,
    kind === 'surcharge' ? null : BASIS_LABELS[basisOf(rate, item)],
    rate.meal_plan
  ].filter(Boolean);

  return {
    key: rate.id ?? `season-${index}`,
    title: rate.season_name || rate.option_name || `Season ${index + 1}`,
    chips,
    sections,
    notes: rate.notes || ''
  };
};

const carRentalCard = (group, index, money) => ({
  key: group.key || `car-${index}`,
  title: [group.vehicle_group, group.vehicle_name].filter(Boolean).join(' \u00b7 ') || 'Vehicle',
  chips: [
    group.rate_code,
    group.kms_unlimited !== false ? 'Unlimited km' : `${group.kms_included || 0} km included`,
    group.valid_from || group.valid_to ? `${group.valid_from || 'open'}\u2013${group.valid_to || 'open'}` : null
  ].filter(Boolean),
  rows: group.ranges.map((range) => ({
    label: `${range.min_days ?? '?'}\u2013${range.max_days ?? '\u221e'} days`,
    value: `${money(range.price)} / vehicle`
  }))
});

export const libraryItemDetail = ({ item = {}, vehicleTypes = [] } = {}) => {
  const kind = libraryItemKind(item.category);
  const currency = item.currency || item.currency_code || '';
  const money = makeMoney(currency);
  const bands = Array.isArray(item.child_age_ranges) ? item.child_age_ranges : [];
  const rates = Array.isArray(item.item_rates) ? item.item_rates : [];
  const carRates = Array.isArray(item.car_rental_rates) ? item.car_rental_rates : [];
  const vehicleName = (code) =>
    vehicleTypes.find((type) => String(type.id ?? type.code) === String(code))?.name || code;

  const carGroups = (() => {
    const seen = {};
    const groups = [];
    carRates.forEach((rate) => {
      const key = `${rate.vehicle_group || ''}|${rate.vehicle_name || ''}|${rate.rate_code || ''}`;
      if (!seen[key]) {
        seen[key] = { key, ...rate, ranges: [] };
        groups.push(seen[key]);
      }
      seen[key].ranges.push(rate);
    });
    return groups;
  })();

  const seasons = rates.map((rate, index) => seasonCard({ item, rate, index, kind, money, bands, vehicleName }));

  const basis = String(item.pricing_model || '').toLowerCase();
  const chips = [
    { kind: 'category', text: CATEGORY_LABELS[kind] },
    item.supplier?.name ? { kind: 'supplier', text: item.supplier.name } : null,
    [item.destination_region, item.destination_area].filter(Boolean).join(' \u00b7 ')
      ? { kind: 'destination', text: [item.destination_region, item.destination_area].filter(Boolean).join(' \u00b7 ') }
      : null,
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
