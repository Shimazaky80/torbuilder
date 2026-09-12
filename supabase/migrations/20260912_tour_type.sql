-- Activities / Tours category: tour type support (Half Day, Full Day,
-- Escorted Dinner / Lunch, Overland Transfer) used as service headers in the
-- itinerary builder.
-- Run in Supabase Dashboard -> SQL Editor (one block, one run)

ALTER TABLE public.library_items ADD COLUMN IF NOT EXISTS tour_type TEXT;

NOTIFY pgrst, 'reload schema';