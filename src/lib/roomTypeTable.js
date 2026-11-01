import { supabase } from './supabase';
import { normalizeRoomTypes } from './roomTypes';

/* The lodging tables arrive with one migration. Until it is applied every room
   lookup has to stay silent: PostgREST rejects a query against a missing table
   and a whole select when a column is missing, which would empty the library.
   One cached probe decides, and callers fall back to the legacy one-room shape. */
let readyProbe = null;

export const roomTypesReady = () => {
  if (!readyProbe) {
    readyProbe = supabase
      .from('library_item_room_types')
      .select('id')
      .limit(1)
      .then(({ error }) => !error)
      .catch(() => false);
  }
  return readyProbe;
};

export const fetchRoomTypesForItems = async (itemIds) => {
  const ids = [...new Set((itemIds || []).filter(Boolean))];
  const byItem = new Map();
  if (!ids.length || !(await roomTypesReady())) return byItem;

  const { data, error } = await supabase
    .from('library_item_room_types')
    .select('*')
    .in('item_id', ids)
    .order('sort_order', { ascending: true });

  if (error || !Array.isArray(data)) return byItem;

  data.forEach((row) => {
    if (!byItem.has(row.item_id)) byItem.set(row.item_id, []);
    byItem.get(row.item_id).push(row);
  });
  byItem.forEach((rows, itemId) => byItem.set(itemId, normalizeRoomTypes(rows)));
  return byItem;
};

export const fetchRoomTypesForItem = async (itemId) => {
  const byItem = await fetchRoomTypesForItems([itemId]);
  return byItem.get(itemId) || [];
};
