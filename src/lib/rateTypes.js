/* Contract rate types.
 *
 * A supplier can quote the same room and season twice: one contract for FIT
 * (free independent traveller) bookings and another for Series departures.
 * They are two prices for one product, so they belong on two rate rows of the
 * same library item rather than on two library items. A row with no type is a
 * rate that applies to every contract, which is what every row saved before
 * this feature means.
 *
 * The tour type is the operator's own vocabulary ("FIT", "Series Departure"),
 * so the mapping is a reading of the name rather than a stored key. A tour type
 * that names neither leaves the contract open: the row the season resolver
 * would have used before is still the row it uses now.
 */

export const RATE_TYPES = [
  { id: '', label: 'FIT and Series (any)' },
  { id: 'fit', label: 'FIT' },
  { id: 'series', label: 'Series' }
];

export const normalizeRateType = (value) => {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text || text === 'any' || text === 'all') return '';
  if (text === 'fit' || /\bfit\b/.test(text)) return 'fit';
  if (text === 'series' || /\bseries\b/.test(text) || /\bsto\b/.test(text)) return 'series';
  return text.replace(/\s+/g, '_');
};

export const rateTypeLabel = (value, tourTypes = []) => {
  const wanted = normalizeRateType(value);
  if (!wanted) return RATE_TYPES[0].label;
  const standard = RATE_TYPES.find((type) => type.id === wanted);
  if (standard) return standard.label;
  const match = (tourTypes || []).find((t) => normalizeRateType(t?.name || t?.id) === wanted);
  if (match) return match.name;
  return String(value).replace(/_/g, ' ');
};

/* The contract a tour type asks for. "Series Departure", "STO Series" and
   "Series" all price from the Series contract; "FIT" prices from the FIT one.
   Anything else asks for no particular contract. This is the fallback for a
   tour type whose row states no contract, and for a database that has not run
   the contract migration yet. */
export const rateTypeForTourType = (tourType) => {
  const text = String(tourType ?? '').trim().toLowerCase();
  if (!text) return '';
  if (/\bseries\b/.test(text) || /\bsto\b/.test(text)) return 'series';
  if (/\bfit\b/.test(text)) return 'fit';
  return '';
};

/* What Settings > Tour Types offers against a type. The blank id is "read the
   name", which is what every row meant before the mapping was stored; 'any' is
   the operator saying this type is not sold under one contract at all. */
export const TOUR_TYPE_CONTRACTS = [
  { id: '', label: 'Automatic (read the name)' },
  { id: 'any', label: 'Any contract' },
  { id: 'fit', label: 'FIT' },
  { id: 'series', label: 'Series' }
];

/* The contract for a trip, read from the tour type's stored mapping first and
   its name second.

   `rate_type` being undefined is the tell that the row came from a select
   without the column (an unmigrated database), so the name is still the answer.
   A stored null is the operator leaving it on Automatic; 'any' is an explicit
   answer that must not be second-guessed by the name. */
export const contractTypeForTourType = (tourTypes, tourType) => {
  const name = String(tourType ?? '').trim();
  if (!name) return '';
  const row = (tourTypes || []).find((type) => String(type?.name || '').trim().toLowerCase() === name.toLowerCase());
  if (row && row.rate_type !== undefined) {
    const stored = String(row.rate_type ?? '').trim();
    if (stored.toLowerCase() === 'any') return '';
    const normalized = normalizeRateType(stored);
    if (normalized) return normalized;
  }
  const fromName = rateTypeForTourType(name);
  if (fromName) return fromName;
  return normalizeRateType(name);
};

export const rateTypeOf = (rate) => normalizeRateType(rate?.rate_type ?? rate?.rateType);

/* The rows that can price a booking under one contract.
 *
 * A typed row wins for its own contract; a row with no type is the fallback for
 * every contract. When the operator has not said which contract the trip is
 * (an older tour type, or a package nobody has classified) every row stays
 * available, exactly as it was before rate types existed.
 */
export const ratesForContract = (rates, contractType) => {
  const all = Array.isArray(rates) ? rates : [];
  const wanted = normalizeRateType(contractType);
  if (!wanted) return all;
  /* Exact rows first, then the untyped rows that apply to every contract. An
     untyped row for another room must not disappear just because this property
     also carries a typed row for the contract somewhere in its matrix. */
  const exact = all.filter((rate) => rateTypeOf(rate) === wanted);
  const generic = all.filter((rate) => !rateTypeOf(rate));
  if (exact.length) return [...exact, ...generic];
  return generic.length ? generic : all;
};

/* An item whose rate matrix has been narrowed to one contract. Callers that
 * hand the whole item to a pricing helper (contractPaxRate, resolveSeasonForTravel)
 * use this so a FIT line cannot read the Series row for the same room and season.
 * An item with no typed rows, or a trip with no contract, comes back untouched. */
export const itemForContract = (item, contractType) => {
  if (!item || !contractType || !Array.isArray(item.item_rates) || !item.item_rates.length) return item;
  const rates = ratesForContract(item.item_rates, contractType);
  return rates.length === item.item_rates.length ? item : { ...item, item_rates: rates };
};
