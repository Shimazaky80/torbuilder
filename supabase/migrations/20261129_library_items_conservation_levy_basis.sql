-- =============================================================================
-- Migration: library_items.conservation_levy_basis (patch-style, idempotent)
--
-- Saving a Library Item failed with:
--   Could not find the 'conservation_levy_basis' column of 'library_items'
--   in the schema cache
--
-- The surcharge_fees migration added fee_type and conservation_levy_basis
-- together, but only fee_type landed on this database. The Library Items
-- page detects the fee feature from fee_type alone, so it kept sending
-- conservation_levy_basis on every save and PostgREST rejected the payload.
--
-- This adds the missing column, backfills it, and restores the CHECK
-- constraint. Safe to re-run at any time.
-- Run in Supabase Dashboard -> SQL Editor
-- =============================================================================

-- 1. Item-level fee type, if it is somehow missing too.
ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS fee_type TEXT NOT NULL DEFAULT 'none';

-- 2. Conservation levy charging basis (per night or per stay).
ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS conservation_levy_basis TEXT NOT NULL DEFAULT 'per_night';

-- 3. Any row written before the column existed (or holding a NULL from an
--    older default) must land on a value the CHECK allows.
UPDATE public.library_items
   SET conservation_levy_basis = 'per_night'
 WHERE conservation_levy_basis IS NULL
    OR conservation_levy_basis NOT IN ('per_night', 'per_stay');

-- 4. Constraints. Dropped first so the patch is re-runnable, then re-added
--    so a column that arrived without one still ends up constrained.
ALTER TABLE public.library_items
  DROP CONSTRAINT IF EXISTS library_items_fee_type_check,
  DROP CONSTRAINT IF EXISTS library_items_conservation_levy_basis_check;

ALTER TABLE public.library_items
  ADD CONSTRAINT library_items_fee_type_check
    CHECK (fee_type IN ('none', 'entrance', 'conservation')),
  ADD CONSTRAINT library_items_conservation_levy_basis_check
    CHECK (conservation_levy_basis IN ('per_night', 'per_stay'));

-- 5. Force PostgREST schema cache reload, otherwise the column is invisible
--    to the API until the cache expires and the same save keeps failing.
NOTIFY pgrst, 'reload schema';
