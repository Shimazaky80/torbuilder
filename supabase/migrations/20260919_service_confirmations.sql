-- =============================================================================
-- Migration: Service-level confirmation fields (idempotent)
-- Run in Supabase Dashboard -> SQL Editor (one block, one run)
--
-- Adds the per-service confirmation data captured in the builder:
--   * service_time          — Time of service (editable, shown on all items)
--   * confirmation_status   — RQ (On Request) / OK (Confirmed) / NA (Not
--                             Available) / WL (Waitlist) / XX (Cancelled)
--   * confirmation_number   — supplier's confirmation / booking reference
--   * flight_number         — Transfers: inbound/outbound flight number
--   * vehicle_type          — Transfers / Activities: vehicle used
--   * capacity              — Transfers: vehicle capacity
--   * room_type             — Accommodation: room configuration
--   * max_occupancy         — Accommodation: max occupancy per contract
--   * meal_plan             — Accommodation: meal plan per contract
--   * check_in_time         — Accommodation
--   * check_out_time        — Accommodation
--   * start_time / end_time — Activities / Tours / Meals
--   * notes                 — service-specific notes (column already exists)
--
-- Confirmed bookings always reflect status OK (the final confirmation of the
-- provisional RQ/NA/WL results); the vouchers show these fields per category.
-- =============================================================================

ALTER TABLE public.itinerary_day_items
  ADD COLUMN IF NOT EXISTS service_time       TEXT,
  ADD COLUMN IF NOT EXISTS confirmation_status TEXT NOT NULL DEFAULT 'RQ',
  ADD COLUMN IF NOT EXISTS confirmation_number TEXT,
  ADD COLUMN IF NOT EXISTS flight_number      TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_type       TEXT,
  ADD COLUMN IF NOT EXISTS capacity           INTEGER,
  ADD COLUMN IF NOT EXISTS room_type          TEXT,
  ADD COLUMN IF NOT EXISTS max_occupancy      INTEGER,
  ADD COLUMN IF NOT EXISTS meal_plan          TEXT,
  ADD COLUMN IF NOT EXISTS check_in_time      TEXT,
  ADD COLUMN IF NOT EXISTS check_out_time     TEXT,
  ADD COLUMN IF NOT EXISTS start_time         TEXT,
  ADD COLUMN IF NOT EXISTS end_time           TEXT;

-- Confirmation status values are enforced.
ALTER TABLE public.itinerary_day_items DROP CONSTRAINT IF EXISTS itinerary_day_items_confirmation_status_check;
ALTER TABLE public.itinerary_day_items
  ADD CONSTRAINT itinerary_day_items_confirmation_status_check
  CHECK (confirmation_status IN ('RQ', 'OK', 'NA', 'WL', 'XX'));

-- Force PostgREST schema cache reload so the new columns are visible.
NOTIFY pgrst, 'reload schema';