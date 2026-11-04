import { supabase } from './supabase';

/* The vehicle groups behind a Car Rental item live in their own table with no join
   to library_items, so every reader that can drop a hire fetches them beside its
   items. A workspace that has not applied the car-rental migration has no groups,
   which the drop dialog says out loud - failing the load itself would take the
   whole library down with it. */
export const fetchCarRentalRates = async (itemIds = []) => {
  if (!itemIds.length) return {};
  try {
    const { data, error } = await supabase.from('car_rental_rates').select('*').in('item_id', itemIds);
    if (error) return {};
    return (data || []).reduce((byItem, row) => ({
      ...byItem,
      [row.item_id]: [...(byItem[row.item_id] || []), row]
    }), {});
  } catch {
    return {};
  }
};
