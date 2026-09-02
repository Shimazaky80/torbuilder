-- =============================================================================
-- Migration: Ticket types (Standard vs Fast Track)
-- Each Ticket library item can offer two distinct per-person pricing sets:
--   Standard  -> quoted via the existing item_rates fields
--                (price_1_adult / child_rates_breakdown)
--   Fast Track -> quoted via new item_rates fields
--                (fast_track_adult_rate / fast_track_child_rates_breakdown)
-- library_items.ticket_type records the type(s) offered:
--   'standard'  : Standard only
--   'fast_track': Fast Track only
--   'both'      : both Standard and Fast Track
-- =============================================================================

-- 1. Ticket type offered on library_items.
ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS ticket_type TEXT DEFAULT 'standard';

-- 2. Fast Track per-season rates on item_rates.
ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS fast_track_adult_rate NUMERIC(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fast_track_child_rates_breakdown JSONB DEFAULT '{}'::jsonb;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';