import { isExtrasItem, chargeLabelOf, lineChargeLabel } from './extrasChargeTypes';
import { isCarRentalItem, isRentalFeeLine } from './carRentalPricing';

/* Fuel allowance.
 *
 * A vehicle provider — a car rental, a transfer or a transport hire — either
 * includes fuel in its tariff or expects the operator to carry it. That is a
 * contract fact, recorded once on the tariff season (fuel_included), not a
 * decision made per booking. A tariff that never stated it reads as null and
 * is treated as "not stated": legacy rows must not start nagging.
 *
 * The allowance itself is the operator's own Extras item with a fuel charge
 * type, priced in the library like any other extra. On a drop the builder asks
 * which vehicle the fuel is for: a tariff that already includes fuel refuses
 * the line inline, because an allowance on top of it bills the client twice.
 * An accepted allowance lands as ONE line linked to the vehicle's library item
 * (linked_item_id on both builders), so it is removed with the vehicle and is
 * never copied onto another day by Copy to Days. */

export const FUEL_INCLUDED_OPTIONS = [
  { id: '', label: 'Not stated' },
  { id: 'included', label: 'Fuel included in the tariff' },
  { id: 'excluded', label: 'Fuel excluded — allowance needed' }
];

/* Tri-state: true / false / null (not stated). Only an explicit false prompts
   for an allowance, and only an explicit true refuses one. */
export const fuelIncludedOf = (rate) => (
  rate?.fuel_included === true ? true : rate?.fuel_included === false ? false : null
);

export const fuelIncludedLabel = (flag) => (
  flag === true ? 'Fuel included' : flag === false ? 'Fuel excluded' : ''
);

export const fuelFlagToColumn = (value) => (
  value === 'included' ? true : value === 'excluded' ? false : null
);

export const fuelFlagFromColumn = (value) => (
  value === true ? 'included' : value === false ? 'excluded' : ''
);

/* A fuel charge by any of the names the trade uses — the editor suggests
   "Fuel charge", "Petrol", "Diesel", "Full tank", and tenants type their own
   ("Fuel allowance"). */
export const isFuelChargeName = (name) => /fuel|petrol|diesel|tank/i.test(String(name || ''));

export const itemHasFuelCharge = (item) => isExtrasItem(item)
  && (Array.isArray(item?.item_rates) ? item.item_rates : [])
    .some((rate) => isFuelChargeName(chargeLabelOf(rate, item)));

/* A saved allowance line: an Extras line sold as a fuel charge. The charge name
   rides on the line (mealPlan / rate snapshot); an item never split into
   charges falls back to its own name. */
export const isFuelAllowanceLine = (line) => /extras/i.test(String(line?.category || ''))
  && isFuelChargeName(lineChargeLabel(line) || line?.item_name || line?.name);

/* The vehicles an allowance can fuel: transfers, transport and hire block
   lines. The hire's paperwork fee is not a vehicle, and neither is anything
   the vehicle merely carries (an activity with a vehicle, a flight). */
export const isVehicleProviderLine = (line) => {
  const category = String(line?.category || '');
  return (/transfers?|transport/i.test(category) || isCarRentalItem(category))
    && !isRentalFeeLine(line?.rental);
};

const vehicleEntry = ({ key, dayIndex, dayLabel, itemId, name, fuelIncluded }) => ({
  key, dayIndex, dayLabel, itemId, name, fuelIncluded
});

/* One entry per vehicle PRODUCT: a hire lays a line per 24-hour block and a
   transfer can repeat across days, but the allowance is one line for the
   engagement, so the picker offers the product once, on its first day. */
const dedupeByItem = (entries) => {
  const seen = new Set();
  return entries.filter((entry) => {
    if (!entry.itemId || seen.has(entry.itemId)) return false;
    seen.add(entry.itemId);
    return true;
  });
};

export const fuelVehiclesFromItinerary = (days = [], library = []) => dedupeByItem(
  (Array.isArray(days) ? days : []).flatMap((day, dayIndex) => (day.services || [])
    .filter(isVehicleProviderLine)
    .map((sv) => {
      const item = library.find((entry) => entry.id === sv.itemId);
      const rate = sv.rental ? null : (item?.item_rates || []).find((entry) => entry.id === sv.rateId);
      return vehicleEntry({
        key: sv.key,
        dayIndex,
        dayLabel: day.date || `Day ${day.dayNumber || dayIndex + 1}`,
        itemId: sv.itemId,
        name: sv.name || item?.name || 'Vehicle',
        fuelIncluded: sv.rental
          ? (sv.rental.fuelIncluded === true ? true : sv.rental.fuelIncluded === false ? false : null)
          : fuelIncludedOf(rate)
      });
    }))
);

export const fuelVehiclesFromPackage = (days = []) => dedupeByItem(
  (Array.isArray(days) ? days : []).flatMap((day, dayIndex) => (day.services || [])
    .filter(isVehicleProviderLine)
    .map((service) => vehicleEntry({
      key: service.item_key,
      dayIndex,
      dayLabel: `Day ${day.day_number || dayIndex + 1}`,
      itemId: service.item_id,
      name: service.item_name || 'Vehicle',
      fuelIncluded: service.rental
        ? (service.rental.fuelIncluded === true ? true : service.rental.fuelIncluded === false ? false : null)
        : fuelIncludedOf(service.rate_snapshot)
    })))
);

/* The picker rows. A vehicle whose tariff includes fuel is refused inline; a
   vehicle already carrying an allowance is not offered a second one. */
export const fuelVehicleOptions = (vehicles = [], coveredItemIds = []) => {
  const covered = new Set(coveredItemIds.filter(Boolean));
  return vehicles.map((vehicle) => ({
    ...vehicle,
    blocked: vehicle.fuelIncluded === true ? 'included'
      : covered.has(vehicle.itemId) ? 'covered' : null
  }));
};

export const fuelBlockMessage = (option) => (
  option?.blocked === 'included'
    ? `${option.name}'s tariff already includes fuel — an allowance on top would bill the client twice.`
    : option?.blocked === 'covered'
      ? `A fuel allowance for ${option.name} has already been added.`
      : ''
);