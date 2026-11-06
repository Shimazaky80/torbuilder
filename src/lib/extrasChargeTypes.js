import { rateHasPrice, rateWindow } from './priceValidity';

/* Extras charge types.
 *
 * A fuel charge is not one price. The same agreement sells 5 litres at one
 * figure, a full tank at another and a different fuel again at a third, and the
 * operator who wants all three used to add three Extras library items to get
 * them. One Extras item carries them as CHARGE TYPES instead: the same shape an
 * accommodation has always had, where one season is priced at several board
 * basics and each row names its own.
 *
 * The name rides on the rate row's meal_plan, the column that has always held
 * an accommodation's charge type, so no new column is needed and a row is read
 * exactly as the board-basis rows are. A row with no name is the item's one
 * default charge - which is how every Extras item built so far reads, so an
 * older quote is untouched by this feature.
 *
 * On a drop the operator is asked which charge the line is sold as, only when
 * the item actually offers more than one. The chosen row is pinned, and the
 * line's own name carries the charge so two fuel lines on one day can be told
 * apart on the invoice. */

export const EXTRAS_CATEGORY = 'Extras';

export const isExtrasItem = (item) => String(item?.category || '').trim().toLowerCase() === EXTRAS_CATEGORY.toLowerCase();

/* The names the editor offers before the operator types their own. Fuel is the
   charge the tenants ask for most, and a fuel contract is split by what goes in
   the tank rather than by the item. */
export const EXTRAS_CHARGE_SUGGESTIONS = [
  'Fuel charge',
  'Petrol',
  'Diesel',
  'Full tank',
  'Return as found'
];

const seasonNameOf = (rate) => String(rate?.season_name || rate?.option_name || 'Base Season').trim() || 'Base Season';

/* The charge a rate row sells. Blank means the item has never been split into
   charges, and the item's own name stands in for it. */
export const chargeNameOf = (rate) => String(rate?.meal_plan || '').trim();

export const chargeLabelOf = (rate, item) => chargeNameOf(rate)
  || String(item?.name || item?.item_name || 'Charge').trim()
  || 'Charge';

/* The charge a SAVED line was sold as. The itinerary keeps it in mealPlan, the
   package in its rate snapshot, and a document reads whichever copy it has. */
export const lineChargeLabel = (line) => String(line?.mealPlan ?? line?.meal_plan
  ?? line?.rate_snapshot?.meal_plan ?? '').trim();

/* The rows that could price the charge a line was sold as, whatever season.
   Used by the repricing engines: a party that grows or dates that move re-resolve
   the SEASON, and must never swap the line onto a different charge. An unnamed
   charge, or a name no row carries, leaves the whole matrix in play, so an older
   quote re-prices exactly as it always did. */
export const ratesForCharge = (item, chargeName) => {
  const rows = Array.isArray(item?.item_rates) ? item.item_rates : [];
  const wanted = String(chargeName || '').trim();
  if (!wanted) return rows;
  const named = rows.filter((rate) => chargeNameOf(rate) === wanted);
  return named.length ? named : rows;
};

/* Every season of an Extras item with the charges priced in it - the shape the
   drop dialog renders. Seasons come in the order the library holds them; a
   season nobody has named carries the item's own name as its one charge. */
export const extrasChargeGroups = (item) => {
  const rows = Array.isArray(item?.item_rates) ? item.item_rates : [];
  const order = [];
  const byKey = new Map();
  rows.forEach((rate) => {
    const window = rateWindow(rate);
    const key = `${seasonNameOf(rate)}|${window.fromIso}|${window.toIso}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        name: seasonNameOf(rate),
        validFrom: window.fromIso,
        validTo: window.toIso,
        options: []
      });
      order.push(key);
    }
    const group = byKey.get(key);
    const label = chargeLabelOf(rate, item);
    let option = group.options.find((entry) => entry.label === label);
    if (!option) {
      option = { label, rateId: rate.id, hasPrice: false };
      group.options.push(option);
    }
    /* Two rows for one charge are the same charge; keep the priced one so a
       stray empty duplicate cannot hide the figure behind a greyed row. */
    if (!option.hasPrice && rateHasPrice(rate)) {
      option.rateId = rate.id;
      option.hasPrice = true;
    }
  });
  return order.map((key) => byKey.get(key));
};

/* True when a drop has more than one charge to choose between. Several SEASONS
   are not a reason to ask: a season nobody has split is resolved from the travel
   dates on its own, exactly as it was before charges existed, so a plain Extras
   item still drops straight in. */
export const extrasHasChargeChoices = (item) => extrasChargeGroups(item)
  .some((group) => group.options.length > 1);

/* The charge types one season holds, for the library editor's chips. */
export const extrasChargeNames = (item) => [...new Set(
  (Array.isArray(item?.item_rates) ? item.item_rates : [])
    .map((rate) => chargeNameOf(rate))
    .filter(Boolean)
)];
