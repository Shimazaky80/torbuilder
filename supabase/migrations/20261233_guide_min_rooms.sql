-- =============================================================================
-- Migration: Tour guide minimum client rooms
--
-- Some properties only release the contracted guide rate once enough paying
-- client rooms are booked, exactly like the tour leader deal. The threshold is
-- held on the property (not the rate row) because it is a commercial condition
-- of the contract, and it defaults to 1 so every existing item keeps charging
-- its guide rate unchanged.
--
--   guide_min_rooms  library_items  — client rooms needed before guide_rate applies
-- =============================================================================

ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS guide_min_rooms INTEGER NOT NULL DEFAULT 1;

NOTIFY pgrst, 'reload schema';
