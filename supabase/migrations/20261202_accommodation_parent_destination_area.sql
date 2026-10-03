-- Keep the property's specific locality separate from the canonical area used
-- to validate accommodation alternatives and group splits.
ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS destination_area TEXT;

ALTER TABLE public.itinerary_day_items
  ADD COLUMN IF NOT EXISTS destination_area TEXT;

-- Snapshot the canonical area onto saved itinerary rows so later Library Item
-- edits do not silently change the grouping of an existing itinerary.
UPDATE public.itinerary_day_items AS day_item
SET destination_area = library_item.destination_area
FROM public.library_items AS library_item
WHERE day_item.item_id = library_item.id
  AND day_item.destination_area IS NULL
  AND library_item.destination_area IS NOT NULL;
