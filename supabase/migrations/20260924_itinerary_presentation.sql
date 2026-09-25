-- =============================================================================
-- Migration: Itinerary presentation + client address/logo on documents (idempotent)
-- Run in Supabase Dashboard -> SQL Editor (one block, one run)
--
-- Adds:
--   * clients.logo_data_url                      optional client logo (uploaded per client)
--   * company_billing_settings.client_logo_*     client logo size/position on documents
--   * company_billing_settings.client_billing_address_position  Bill-To block alignment
--   * company_billing_settings.itinerary_pricing_position  ('above' | 'below') where the
--                 pricing breakdown boxes sit relative to the day-by-day routing
--   * company_billing_settings.itinerary_terms / _inclusions / _exclusions
--                 free-text blocks for the itinerary document plus a position each
--                 ('under_day_by_day' | 'before_pricing' | 'after_pricing')
--   * invoices.bill_to_logo_data_url              logo snapshot taken at issue time
-- Idempotent: safe to re-run.
-- =============================================================================

-- 1) Optional per-client logo.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS logo_data_url TEXT NOT NULL DEFAULT '';

-- 2) Client block presentation preferences on company_billing_settings.
ALTER TABLE public.company_billing_settings
  ADD COLUMN IF NOT EXISTS client_logo_size                TEXT NOT NULL DEFAULT 'md',
  ADD COLUMN IF NOT EXISTS client_logo_position            TEXT NOT NULL DEFAULT 'left',
  ADD COLUMN IF NOT EXISTS client_billing_address_position TEXT NOT NULL DEFAULT 'left';

-- 3) Itinerary presentation preferences on company_billing_settings.
ALTER TABLE public.company_billing_settings
  ADD COLUMN IF NOT EXISTS itinerary_pricing_position   TEXT NOT NULL DEFAULT 'above',
  ADD COLUMN IF NOT EXISTS itinerary_terms              TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS itinerary_terms_position     TEXT NOT NULL DEFAULT 'under_day_by_day',
  ADD COLUMN IF NOT EXISTS itinerary_inclusions         TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS itinerary_inclusions_position TEXT NOT NULL DEFAULT 'under_day_by_day',
  ADD COLUMN IF NOT EXISTS itinerary_exclusions         TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS itinerary_exclusions_position TEXT NOT NULL DEFAULT 'under_day_by_day';

-- 4) Constraints (dropped + re-added so they stay idempotent).
ALTER TABLE public.company_billing_settings DROP CONSTRAINT IF EXISTS client_logo_size_check;
ALTER TABLE public.company_billing_settings
  ADD CONSTRAINT client_logo_size_check CHECK (client_logo_size IN ('sm', 'md', 'lg'));

ALTER TABLE public.company_billing_settings DROP CONSTRAINT IF EXISTS client_logo_position_check;
ALTER TABLE public.company_billing_settings
  ADD CONSTRAINT client_logo_position_check CHECK (client_logo_position IN ('left', 'center', 'right'));

ALTER TABLE public.company_billing_settings DROP CONSTRAINT IF EXISTS client_billing_address_position_check;
ALTER TABLE public.company_billing_settings
  ADD CONSTRAINT client_billing_address_position_check CHECK (client_billing_address_position IN ('left', 'center', 'right'));

ALTER TABLE public.company_billing_settings DROP CONSTRAINT IF EXISTS itinerary_pricing_position_check;
ALTER TABLE public.company_billing_settings
  ADD CONSTRAINT itinerary_pricing_position_check CHECK (itinerary_pricing_position IN ('above', 'below'));

ALTER TABLE public.company_billing_settings DROP CONSTRAINT IF EXISTS itinerary_terms_position_check;
ALTER TABLE public.company_billing_settings
  ADD CONSTRAINT itinerary_terms_position_check
  CHECK (itinerary_terms_position IN ('under_day_by_day', 'before_pricing', 'after_pricing'));

ALTER TABLE public.company_billing_settings DROP CONSTRAINT IF EXISTS itinerary_inclusions_position_check;
ALTER TABLE public.company_billing_settings
  ADD CONSTRAINT itinerary_inclusions_position_check
  CHECK (itinerary_inclusions_position IN ('under_day_by_day', 'before_pricing', 'after_pricing'));

ALTER TABLE public.company_billing_settings DROP CONSTRAINT IF EXISTS itinerary_exclusions_position_check;
ALTER TABLE public.company_billing_settings
  ADD CONSTRAINT itinerary_exclusions_position_check
  CHECK (itinerary_exclusions_position IN ('under_day_by_day', 'before_pricing', 'after_pricing'));

-- 5) Bill-To logo snapshot on issued invoice documents.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS bill_to_logo_data_url TEXT NOT NULL DEFAULT '';

-- Force PostgREST schema cache reload so the new columns are visible.
NOTIFY pgrst, 'reload schema';