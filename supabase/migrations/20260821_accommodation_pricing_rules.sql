-- =============================================================================
-- Migration: Accommodation Pricing Rules & Matrix Structure
-- Clarifies:
--   - 1 Adult = Single Room rate
--   - 2 Adults = Double / Twin Room Sharing rate
--   - Child rates (0-5, 6-11, 12-17) = Rates allowed for child sharing with adult(s)
--   - Single Supplement = Double/Twin + Supplement = Single rate
-- =============================================================================

-- Add explicit pricing fields to public.item_rates if not already present
ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS single_room_rate       NUMERIC(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS double_twin_rate       NUMERIC(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS effective_single_rate  NUMERIC(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rate_basis             TEXT DEFAULT 'per_person_sharing',
  ADD COLUMN IF NOT EXISTS child_sharing_policy   TEXT DEFAULT 'sharing_with_adults',
  ADD COLUMN IF NOT EXISTS notes                  TEXT;

-- Update existing item_rates to populate effective_single_rate
UPDATE public.item_rates
SET 
  single_room_rate = COALESCE(NULLIF(price_1_adult, 0), price_2_adults + COALESCE(single_supplement, 0), 0),
  double_twin_rate = COALESCE(price_2_adults, 0),
  effective_single_rate = CASE 
    WHEN price_1_adult > 0 THEN price_1_adult
    WHEN price_2_adults > 0 AND single_supplement > 0 THEN price_2_adults + single_supplement
    ELSE COALESCE(price_1_adult, price_2_adults, 0)
  END
WHERE effective_single_rate IS NULL OR effective_single_rate = 0;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
