-- =============================================================================
-- Migration: Flight arrival/departure time on transfers (idempotent)
-- Run in Supabase Dashboard -> SQL Editor (one block, one run)
--
-- Adds flight_time TEXT to itinerary_day_items so the builder can record the
-- transfer / flight arrival OR departure time that the supplier returned with
-- the provisional (RQ) booking result. It is shown right after "Flight number"
-- in both the Provisional Service Request and the Travel Documents tabs and is
-- printed on the supplier vouchers.
--
-- This migration mirrors the style of 20260919_service_confirmations.sql and is
-- safe to re-run.
-- =============================================================================

ALTER TABLE public.itinerary_day_items
  ADD COLUMN IF NOT EXISTS flight_time TEXT;

-- Force PostgREST schema cache reload so the new column is visible.
NOTIFY pgrst, 'reload schema';
