-- =============================================================================
-- Migration: Add guide_for_item_key to package/itinerary day items
-- =============================================================================

ALTER TABLE public.itinerary_day_items
  ADD COLUMN IF NOT EXISTS guide_for_item_key TEXT;

ALTER TABLE public.package_day_items
  ADD COLUMN IF NOT EXISTS guide_for_item_key TEXT;

NOTIFY pgrst, 'reload schema';
