-- Snapshot the property's destination (town/locality) onto every itinerary line,
-- not just destination_area, so reporting and filtering keep showing where a
-- booking actually sold even after the Library Item's destination is edited.
ALTER TABLE public.itinerary_day_items
  ADD COLUMN IF NOT EXISTS destination_region TEXT;

-- Backfill the lines saved before this column existed from the Library Item
-- they point at, leaving anything already written untouched.
UPDATE public.itinerary_day_items AS day_item
SET destination_region = library_item.destination_region
FROM public.library_items AS library_item
WHERE day_item.item_id = library_item.id
  AND day_item.destination_region IS NULL
  AND library_item.destination_region IS NOT NULL;
