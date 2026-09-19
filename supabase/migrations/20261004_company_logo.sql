-- =============================================================================
-- Migration: Company logo for output documents (idempotent)
-- Run in Supabase Dashboard -> SQL Editor (one block, one run)
--
-- Adds the tenant's document branding to company_billing_settings:
--   * logo_data_url  TEXT - the logo as a data URL (image/png). Stored inline so
--                            no storage bucket is required and the logo travels
--                            with every printed / exported document snapshot.
--                            The app resizes uploads to at most 512px first.
--   * logo_size      TEXT - sm / md / lg — print width on documents
--                            (110 / 160 / 220 px). md is the default.
-- =============================================================================

ALTER TABLE public.company_billing_settings
  ADD COLUMN IF NOT EXISTS logo_data_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS logo_size     TEXT NOT NULL DEFAULT 'md';

ALTER TABLE public.company_billing_settings DROP CONSTRAINT IF EXISTS company_billing_settings_logo_size_check;
ALTER TABLE public.company_billing_settings
  ADD CONSTRAINT company_billing_settings_logo_size_check
  CHECK (logo_size IN ('sm', 'md', 'lg'));

-- Force PostgREST schema cache reload so the new columns are visible.
NOTIFY pgrst, 'reload schema';
