-- =============================================================================
-- Migration: Amount input / rounding preferences (idempotent)
-- Run in Supabase Dashboard -> SQL Editor (one block, one run)
--
-- Adds three tenant-wide controls to company_billing_settings, used by the
-- money entry fields (NOT counts such as pax / capacity):
--   * allow_decimal_amounts  BOOLEAN  - true  = cents allowed (step 0.01)
--                                       false = whole numbers only (step 1)
--   * input_rounding_mode    TEXT     - none / up / down  (how typed money
--                                       values are snapped on blur)
--   * output_rounding_mode   TEXT     - none / up / down  (how calculated
--                                       amounts are rounded)
-- =============================================================================

ALTER TABLE public.company_billing_settings
  ADD COLUMN IF NOT EXISTS allow_decimal_amounts BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS input_rounding_mode  TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS output_rounding_mode TEXT NOT NULL DEFAULT 'none';

ALTER TABLE public.company_billing_settings DROP CONSTRAINT IF EXISTS company_billing_settings_rounding_mode_check;
ALTER TABLE public.company_billing_settings
  ADD CONSTRAINT company_billing_settings_rounding_mode_check
  CHECK (input_rounding_mode IN ('none', 'up', 'down')
     AND output_rounding_mode IN ('none', 'up', 'down'));

-- Force PostgREST schema cache reload so the new columns are visible.
NOTIFY pgrst, 'reload schema';