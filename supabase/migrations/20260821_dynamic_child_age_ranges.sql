-- =============================================================================
-- Migration: Dynamic Child Age Ranges & Breakdown Support
-- =============================================================================

ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS child_age_ranges JSONB DEFAULT '[
    {"id": "band_1", "name": "Infants", "ageFrom": 0, "ageTo": 2},
    {"id": "band_2", "name": "Children", "ageFrom": 3, "ageTo": 11},
    {"id": "band_3", "name": "Teens", "ageFrom": 12, "ageTo": 17}
  ]'::jsonb;

ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS child_rates_breakdown JSONB DEFAULT '{}'::jsonb;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
