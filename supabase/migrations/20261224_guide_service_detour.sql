-- =============================================================================
-- Migration: Guide service detour
-- A Guide (category 'Guide') is charged per the service it accompanies, so the
-- line records the selected service types on the day item:
--   - guide_service_types jsonb  : ['transfer'] | ['half_day'] | ['full_day']
--                                  | ['overland'] | ['dinner_transfer'] — the
--                                  flat per-trip rate for each selected type is
--                                  summed into unit_cost / rate_basis 'per_trip'.
--   - guide_only boolean         : the line prices the guide & driver only, not
--                                  the clients (guide meals and the guide/driver
--                                  overnight at a supporting property).
-- Both columns land on itinerary_day_items and package_day_items so a guide line
-- survives a reload and feeding remains identical across both builders.
-- =============================================================================

ALTER TABLE public.itinerary_day_items
  ADD COLUMN IF NOT EXISTS guide_service_types JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS guide_only BOOLEAN DEFAULT false;

ALTER TABLE public.package_day_items
  ADD COLUMN IF NOT EXISTS guide_service_types JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS guide_only BOOLEAN DEFAULT false;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';