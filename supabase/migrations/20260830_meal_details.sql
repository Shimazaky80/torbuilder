-- =============================================================================
-- Migration: Meals module details
-- Meals are billed per person only. Each meal item records:
--   - meal_type            : type of day  (Breakfast / Lunch / Dinner)
--   - menu_type            : a_la_carte / buffet
--   - meal_gratuity_percent: optional gratuity % added on top of the fare
-- Per-season rates live in item_rates: price_1_adult / child_rates_breakdown
-- plus guide_rate / driver_rate (already added by 20260829_guide_driver_room_rates.sql).
-- =============================================================================

-- 1. Meal item configuration on library_items.
ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS meal_type TEXT DEFAULT 'Breakfast',
  ADD COLUMN IF NOT EXISTS menu_type TEXT DEFAULT 'a_la_carte',
  ADD COLUMN IF NOT EXISTS meal_gratuity_percent NUMERIC(5, 2) DEFAULT 0;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';