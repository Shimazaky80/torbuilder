-- =============================================================================
-- Migration: Guide / Driver Room Rates for Accommodation Library Items
-- Adds:
--   - library_items.guide_driver_room_offered : whether the hotel offers a
--     separate guide/driver room rate
--   - item_rates.guide_rate / item_rates.driver_rate : per-season room rates
--     for guide and driver (0 means "fall back to Single Room rate")
--   - item_rates.guide_meal_plan / item_rates.driver_meal_plan : the meal plan
--     included with each of those rates (mirrors the client meal plan)
-- =============================================================================

ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS guide_driver_room_offered BOOLEAN DEFAULT false;

ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS guide_rate NUMERIC(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS driver_rate NUMERIC(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guide_meal_plan TEXT,
  ADD COLUMN IF NOT EXISTS driver_meal_plan TEXT;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';