import { supabase } from './supabase';

/* An item is filed under up to three names: the region (for a property, the city
   its supplier is in), the area inside it, and the older single "location" field
   some rows still carry alone. A destination filter offers all of them and an
   item matches when it is filed under any selected name. */
export const DESTINATION_COLUMNS = ['destination_region', 'destination_area', 'location'];

export const destinationsOf = (item) => [...new Set(
  DESTINATION_COLUMNS.map((column) => String(item?.[column] || '').trim()).filter(Boolean)
)];

const cleanDestinations = (names) => [...new Set((names || [])
  .map((name) => String(name || '').trim()).filter(Boolean))];

export const sortedDestinations = (names) => cleanDestinations(names).sort((a, b) => a.localeCompare(b));

/* PostgREST splits an or()/in() list on commas, so a town with a space, a bracket
   or a full stop only matches once the value is quoted - an unquoted
   "Kruger (Mpumalanga)" parses into a filter that matches nothing. */
const quoteValue = (value) => `"${String(value).replace(/["\\]/g, '\\$&')}"`;

/* One or() clause: every column against every selected name. The caller passes the
   result to query.or(), which PostgREST ANDs with any other or() on the builder -
   so a search term and a destination selection narrow the list together. */
export const destinationClause = (names) => {
  const selected = cleanDestinations(names);
  if (!selected.length) return '';
  const list = selected.map(quoteValue).join(',');
  return DESTINATION_COLUMNS.map((column) => `${column}.in.(${list})`).join(',');
};

export const matchesDestinations = (item, names) => {
  const selected = cleanDestinations(names);
  if (!selected.length) return true;
  return destinationsOf(item).some((destination) => selected.includes(destination));
};

/* The option list cannot come from the page of results the picker is showing -
   that would drop every island the last filter hid. One small query names the
   whole contracted catalogue instead. */
export const fetchDestinationCatalog = async (companyId) => {
  if (!companyId) return { destinations: [], error: null };
  let result;
  try {
    result = await supabase
      .from('library_items')
      .select(DESTINATION_COLUMNS.join(', '))
      .eq('company_id', companyId)
      .eq('is_active', true)
      .limit(1000);
  } catch (error) {
    return { destinations: [], error };
  }
  const { data, error } = result;
  if (error) return { destinations: [], error };
  return { destinations: sortedDestinations((data || []).flatMap(destinationsOf)), error: null };
};
