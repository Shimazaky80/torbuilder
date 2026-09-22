-- =============================================================================
-- Migration: Tenant revenue service / tax authority label per tax rate (idempotent)
-- Run in Supabase Dashboard -> SQL Editor (one block, one run)
--
-- Used on non-ZAR documents for the heading "Net Tax to [Agency] (Output − Input)"
-- in the Itinerary Builder pricing breakdown and cancellation notice emails.
-- ZAR documents always show SARS regardless of this value.
-- =============================================================================

ALTER TABLE public.tax_rates
  ADD COLUMN IF NOT EXISTS revenue_agency TEXT;

COMMENT ON COLUMN public.tax_rates.revenue_agency IS
  'Tax authority label (e.g. HMRC, IRS) shown on non-ZAR documents.';

-- Force PostgREST schema cache reload so the new column is visible.
NOTIFY pgrst, 'reload schema';