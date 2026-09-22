-- =============================================================================
-- Migration: Configurable list row limit per menu module (idempotent)
-- Run in Supabase Dashboard -> SQL Editor (one block, one run)
--
-- List modules (Clients, Suppliers, Library Items, Itineraries, Invoices)
-- display at most this many rows by default so the page renders quickly. The
-- default is 2; raising it above 2 warns the user about slower load times.
-- Settings and Dashboard always render everything and ignore this value.
-- =============================================================================

ALTER TABLE public.company_billing_settings
  ADD COLUMN IF NOT EXISTS list_row_limit INTEGER NOT NULL DEFAULT 2;

ALTER TABLE public.company_billing_settings DROP CONSTRAINT IF EXISTS company_billing_settings_list_row_limit_min;
ALTER TABLE public.company_billing_settings
  ADD CONSTRAINT company_billing_settings_list_row_limit_min
  CHECK (list_row_limit IS NULL OR list_row_limit > 0);

-- Force PostgREST schema cache reload so the new column is visible.
NOTIFY pgrst, 'reload schema';