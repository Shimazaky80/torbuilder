-- Migration: Accommodation weekend per-person rates
--
-- Adds support for storing detailed per-person weekend rates on item_rates:
--   weekend_rates JSONB: {
--     price_1_adult: NUMERIC,
--     price_2_adults: NUMERIC,
--     price_3_plus_adults: NUMERIC,
--     child_rates: JSONB
--   }

ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS weekend_rates JSONB;

NOTIFY pgrst, 'reload schema';
