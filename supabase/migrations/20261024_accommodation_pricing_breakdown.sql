-- =============================================================================
-- Migration: Accommodation per-room pricing breakdown (idempotent)
-- Run in Supabase Dashboard -> SQL Editor (one block, one run)
--
-- Extends company_billing_settings with a presentation preference for the
-- "Service per day (detailed)" breakdown:
--   * pricing_breakdown_mode             ('daily' | 'per_person') - unchanged
--   * pricing_breakdown_accommodation    ('one' | 'rooms')
--       - 'one'   default: accommodation shown as one line for all travellers
--       - 'rooms' accommodation split into one line per occupied room/occupancy
--                 (e.g. one line for 2 travellers, one for 1 traveller, one
--                  for 2A, 1C); all other services keep their own lines.
--
-- Any rows stuck on the experimental 'accommodation' / 'accommodation_split'
-- values are reset to 'daily'. Idempotent: safe to re-run.
-- =============================================================================

-- 1) Reset any rows still on the removed experimental modes, then tighten the
--    constraint back to the two supported breakdown modes.
UPDATE public.company_billing_settings
   SET pricing_breakdown_mode = 'daily'
 WHERE pricing_breakdown_mode NOT IN ('daily', 'per_person');

ALTER TABLE public.company_billing_settings DROP CONSTRAINT IF EXISTS company_billing_settings_pricing_breakdown_mode_check;
ALTER TABLE public.company_billing_settings
  ADD CONSTRAINT company_billing_settings_pricing_breakdown_mode_check
  CHECK (pricing_breakdown_mode IN ('daily', 'per_person'));

-- 2) Accommodation-lines presentation preference ('one' default).
ALTER TABLE public.company_billing_settings
  ADD COLUMN IF NOT EXISTS pricing_breakdown_accommodation TEXT NOT NULL DEFAULT 'one';

-- Force PostgREST schema cache reload so the new column and constraint are visible.
NOTIFY pgrst, 'reload schema';