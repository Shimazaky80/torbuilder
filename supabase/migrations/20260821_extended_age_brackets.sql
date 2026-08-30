-- =============================================================================
-- Migration: Add Extended Age Ranges and 3+ Adults Pricing Columns
-- =============================================================================

ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS price_3_plus_adults NUMERIC(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_child_0_1     NUMERIC(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_child_2_11    NUMERIC(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_child_12_18   NUMERIC(12, 2) DEFAULT 0;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
