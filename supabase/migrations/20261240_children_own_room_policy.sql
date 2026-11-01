-- Children in their own room: some properties charge the standard adult rates,
-- others charge one single room rate for the whole children-only room. The
-- policy is a property-wide contract term, so it lives on the library item
-- next to the child sharing rules. Saved itinerary lines snapshot it, like the
-- destination, so a later Library Item edit does not silently reprice them.
ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS children_own_room_policy TEXT NOT NULL DEFAULT 'child_rates';

ALTER TABLE public.itinerary_day_items
  ADD COLUMN IF NOT EXISTS children_own_room_policy TEXT;

-- Legacy lines predate the rule and priced children at band rates; a NULL
-- snapshot reads back as 'child_rates', which is exactly that behaviour.
UPDATE public.itinerary_day_items AS day_item
SET children_own_room_policy = library_item.children_own_room_policy
FROM public.library_items AS library_item
WHERE day_item.item_id = library_item.id
  AND day_item.children_own_room_policy IS NULL
  AND library_item.children_own_room_policy IS NOT NULL
  AND library_item.children_own_room_policy <> 'child_rates';
