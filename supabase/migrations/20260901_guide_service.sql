-- =============================================================================
-- Migration: Standalone Guide service
-- The Guide is a standalone service that charges a flat per-trip price which
-- DIFFERS by the service it accompanies. The itinerary builder picks the rate
-- for the service at hand:
--   item_rates.guide_transfer_rate     : Transfer price
--   item_rates.guide_half_day_rate     : Half Day price
--   item_rates.guide_full_day_rate     : Full Day price
--   item_rates.guide_overland_rate     : Overland price
--   item_rates.guide_dinner_rate       : Dinner transfer price
-- This migration also renames the library category 'Guide / Driver' -> 'Guide'
-- and adds guide trigger flags on library_items (meals + accommodation only —
-- NOT costs; the itinerary builder pulls those from the Meals and Accommodation
-- module rates).
-- =============================================================================

-- 1. Rename the category (reference seed + any existing library items).
UPDATE public.library_categories SET name = 'Guide' WHERE name = 'Guide / Driver';
UPDATE public.library_items SET category = 'Guide' WHERE category = 'Guide / Driver';

-- 2. Guide trigger configuration on library_items (Guide only).
ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS guide_meals TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS guide_accommodation BOOLEAN DEFAULT false;

-- 3. Guide flat per-trip rates by service type on item_rates.
ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS guide_transfer_rate NUMERIC(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guide_half_day_rate NUMERIC(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guide_full_day_rate NUMERIC(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guide_overland_rate NUMERIC(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guide_dinner_rate NUMERIC(12, 2) DEFAULT 0;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';