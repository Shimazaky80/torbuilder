/* PostgREST rejects a whole select when any one column is missing, so asking for
   suppliers.star_rating before the star-grading migration is applied would empty
   every supplier lookup in the builder and the library. The column is probed
   once per session and only then added to the select lists; until it exists the
   rest of the app keeps loading, just without a grade. */
import { supabase } from './supabase';

let starColumnProbe = null;

export const supplierStarColumn = () => {
  if (!starColumnProbe) {
    starColumnProbe = supabase
      .from('suppliers')
      .select('star_rating')
      .limit(1)
      .then(({ error }) => !error)
      .catch(() => false);
  }
  return starColumnProbe;
};

export const supplierColumns = async (base) =>
  `${base}${(await supplierStarColumn()) ? ', star_rating' : ''}`;
