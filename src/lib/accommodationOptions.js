import { rateHasPrice, rateWindow } from './priceValidity';

/* Accommodation charge options.
 *
 * One accommodation library item can carry more than one charge type (board
 * basis): bed & breakfast, half board, full board with activities, and so on.
 * A charge type belongs to a SEASON, not the other way round: one negotiated
 * season is priced at several board basics, each at its own rate. The tier is
 * stored on the item_rates row as the meal_plan (the same column that has
 * always held the board basis) and the season is stated as the season_name and
 * the valid_from / valid_to window, so a row is read as "this season at this
 * charge type". Rows created before this feature all share the item's single
 * board, so they read back as one option and behave exactly as they used to.
 *
 * On a drop the operator picks the season AND, within it, the charge type. The
 * chosen row's id is then pinned so the line is priced from exactly that figure
 * rather than whatever row the database returned first. */

export const rateOptionLabel = (rate, item) => {
  const label = rate?.meal_plan || rate?.option_name || item?.mealPlan || item?.meal_plan || '';
  return String(label || '').trim();
};

/* Group rate rows into charge types, keeping first-seen order so the library
   editor's option order is the order the operator sees on a drop. */
export const accommodationOptionGroups = (rates) => {
  const rows = Array.isArray(rates) ? rates : [];
  const order = [];
  const byLabel = new Map();
  rows.forEach((rate) => {
    const label = rateOptionLabel(rate) || 'Standard';
    if (!byLabel.has(label)) {
      byLabel.set(label, []);
      order.push(label);
    }
    byLabel.get(label).push(rate);
  });
  return order.map((label) => ({ label, rates: byLabel.get(label) }));
};

const seasonNameOf = (rate) => rate?.season_name || rate?.option_name || 'Base Season';

/* Two rows describe the same season when they carry the same name and the same
   window, so that identity groups every charge type of that season together. */
export const seasonKeyOfRate = (rate) => {
  const window = rateWindow(rate);
  return `${seasonNameOf(rate)}|${window.fromIso}|${window.toIso}`;
};

/* Rate rows grouped SEASON-first: one group per season, each holding every
   charge type priced for that season. This is the shape the library editor and
   the drop dialog both work in — "one season, several charge types". */
export const accommodationSeasonGroups = (item) => {
  const rows = Array.isArray(item?.item_rates) ? item.item_rates : [];
  const order = [];
  const byKey = new Map();
  rows.forEach((rate) => {
    const key = seasonKeyOfRate(rate);
    if (!byKey.has(key)) {
      const window = rateWindow(rate);
      byKey.set(key, {
        name: seasonNameOf(rate),
        validFrom: window.fromIso,
        validTo: window.toIso,
        options: []
      });
      order.push(key);
    }
    const group = byKey.get(key);
    group.options.push({
      label: rateOptionLabel(rate) || 'Standard',
      rateId: rate.id,
      hasPrice: rateHasPrice(rate)
    });
  });
  return order.map((key) => byKey.get(key));
};

/* Every season with its charge types, the shape the drop dialog renders: the
   season (name + window) is the outer choice and each charge type inside it
   carries the row id and whether it is priced. */
export const accommodationSeasonChoices = (item) => accommodationSeasonGroups(item);

/* True when a drop has something to ask about: more than one season, or a
   single season offering more than one charge type. A one-season, one-option
   item keeps adding straight away, exactly as before. */
export const accommodationHasChoices = (item) => {
  const groups = accommodationSeasonGroups(item);
  return groups.length > 1 || groups.some((group) => group.options.length > 1);
};

export const formatSeasonDate = (iso) => {
  const s = String(iso || '').slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : (s || 'open');
};

/* "[Season name]: 2027/04/01-2027/08/31", the label (D) asks a drop to show so
   the operator can pick the season against the travel dates. */
export const seasonChoiceLabel = (season) => {
  const from = season.validFrom ? formatSeasonDate(season.validFrom) : 'open';
  const to = season.validTo ? formatSeasonDate(season.validTo) : 'open';
  return `${season.name || 'Season'}: ${from}-${to}`;
};

/* The season object resolveSeasonForTravel() would have returned for one pinned
   row, so a caller that already knows which row it wants can reuse the same
   downstream shape. */
export const seasonForRate = (rate) => {
  const window = rateWindow(rate);
  return {
    status: 'ok',
    rate,
    window,
    protectionPercent: 0,
    canAdd: rateHasPrice(rate),
    seasonName: seasonNameOf(rate),
    validFrom: window.fromIso,
    validTo: window.toIso,
    staleByYears: 0,
    reason: ''
  };
};

/* The rows for one option, or the whole matrix when no option is named. */
export const ratesForOption = (item, optionLabel) => {
  const rows = Array.isArray(item?.item_rates) ? item.item_rates : [];
  if (!optionLabel) return rows;
  const wanted = String(optionLabel).trim();
  const scoped = rows.filter((rate) => rateOptionLabel(rate, item) === wanted);
  return scoped.length ? scoped : rows;
};

export const rateById = (item, rateId) => (
  (Array.isArray(item?.item_rates) ? item.item_rates : []).find((rate) => rate.id === rateId) || null
);
