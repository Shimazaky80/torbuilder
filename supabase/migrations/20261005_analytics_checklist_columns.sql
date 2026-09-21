-- =============================================================================
-- Migration: Analytics Checklist Columns (patch-style, idempotent)
-- Adds tour type (FIT | Series Departure) and consultant name to itineraries.
-- The consultant_name is captured at the time of editing so the record
-- persists even if staff changes later. Safe to re-run at any time.
-- Run in Supabase Dashboard -> SQL Editor
-- =============================================================================

ALTER TABLE public.itineraries
  ADD COLUMN IF NOT EXISTS itinerary_tour_type TEXT,    -- 'FIT' | 'Series Departure'
  ADD COLUMN IF NOT EXISTS consultant_name      TEXT;   -- name of the responsible consultant

-- Force PostgREST schema cache reload
NOTIFY pgrst, 'reload schema';
