-- =============================================================================
-- Migration: Tour leader & guide pricing fields
--
-- The itinerary builder and library already read/write these columns; without
-- them PostgREST rejects the whole row (42703), blocking saves on both screens.
--   guide_needed              itinerary_day_items  — per-day guide charge switch
--   tour_leader_room_offered  library_items        — property offers a TL room
--   tour_leader_min_rooms     library_items        — client rooms needed for it
--   tour_leader_rate          item_rates           — contracted TL room rate
-- =============================================================================

ALTER TABLE public.itinerary_day_items
  ADD COLUMN IF NOT EXISTS guide_needed BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS tour_leader_room_offered BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tour_leader_min_rooms INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS tour_leader_rate NUMERIC(12, 2) DEFAULT 0;

NOTIFY pgrst, 'reload schema';
