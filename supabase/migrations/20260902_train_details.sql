-- =============================================================================
-- Migration: Trains module journey details
-- Library items of the 'Trains' category carry journey schedule + cabin identity
-- (similar to Flights for the schedule side, Accommodation for the cabin/room
-- side). These are reference fields shown in the itinerary builder — pricing is
-- handled by the existing accommodation-style item_rates matrix.
-- =============================================================================

ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS train_departure_date DATE,
  ADD COLUMN IF NOT EXISTS train_journey_nights INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS train_cabin_name TEXT DEFAULT '';

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';