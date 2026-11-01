-- Single-supplement waiver ladder (accommodation).
--
-- Some properties charge the sharing rate for the first N single rooms and add
-- the single supplement only from room N+1. Others price the rooms after the
-- waiver differently again, so the contract is a ladder:
--
--   single_supplement_tiers = [
--     { "singles": 2, "supplement": 0 },    -- singles 1-2 waived
--     { "singles": 4, "supplement": 150 }   -- singles 3-4 take a 150 supplement
--   ]
--
-- Each tier states the TOTAL number of single rooms covered once the ladder
-- reaches it, and the supplement charged for the single rooms that tier adds.
-- A tier never shrinks the coverage of the tier before it. A supplement of 0 is
-- a waiver. Singles beyond the last tier pay the season's own single_supplement.
-- The count is per night: each accommodation line is priced on its own, and only
-- paying clients consume a slot (staff, guide/driver and tour-leader rooms do
-- not).
--
-- Packages carry no room allocations, so their quote can only approximate the
-- number of singles. A season may override that number; the itinerary replaces
-- the override with the actual per-night allocation.
ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS single_supplement_tiers JSONB;

ALTER TABLE public.package_validity_periods
  ADD COLUMN IF NOT EXISTS single_rooms INTEGER;

ALTER TABLE public.package_validity_periods
  DROP CONSTRAINT IF EXISTS package_validity_single_rooms_check;

ALTER TABLE public.package_validity_periods
  ADD CONSTRAINT package_validity_single_rooms_check
  CHECK (single_rooms IS NULL OR single_rooms >= 0);

COMMENT ON COLUMN public.item_rates.single_supplement_tiers IS
  'Per-contract single supplement ladder. Each tier: { singles: total single rooms covered, supplement: charge for the rooms it adds }. 0 waives the supplement; beyond the ladder single_supplement applies.';

COMMENT ON COLUMN public.package_validity_periods.single_rooms IS
  'Package quote override for the number of single rooms. NULL = derived from the party size; itinerary room allocations always replace it.';

NOTIFY pgrst, 'reload schema';
