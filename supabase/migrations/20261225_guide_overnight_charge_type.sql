-- =============================================================================
-- Migration: Guide & driver overnight charge type
-- An overland guide is always bedded separately from the clients, and the
-- operator chooses who gets charged for the overnight at the property:
--   guide only / driver only / both.
--   - guide_charge_type text : null | 'guide' | 'driver' — one row per charged
--                              party when "both" is chosen, so the choice
--                              (and the reload of the Guide Details dialog)
--                              survives and a line always knows who it prices.
-- Both columns land on itinerary_day_items and package_day_items, mirroring
-- guide_only / guide_for_item_key from the guide service detour.
-- =============================================================================

ALTER TABLE public.itinerary_day_items
  ADD COLUMN IF NOT EXISTS guide_charge_type TEXT;

ALTER TABLE public.package_day_items
  ADD COLUMN IF NOT EXISTS guide_charge_type TEXT;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';