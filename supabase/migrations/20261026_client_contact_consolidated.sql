-- =============================================================================
-- Client contact + itinerary presentation + retire clients.phone
--
-- SINGLE SOURCE OF TRUTH. This migration supersedes and replaces:
--   * 20260924_client_billto_contact_3.sql   (Bill-To contact snapshots)
--   * 20260924_itinerary_presentation.sql     (client logo + block positions)
--   * 20260925_itinerary_presentation_2.sql   (company contact, inclusions)
--   * 20261025_client_retire_phone.sql        (retire duplicate phone field)
-- Those four were folded in here and removed; do not re-create them.
--
-- Deliberately NOT included, because they are separate features with their own
-- migrations: 20261006_presentation_settings.sql,
-- 20261007_invoice_per_person_breakdown.sql,
-- 20261024_accommodation_pricing_breakdown.sql.
--
-- Idempotent: safe to run this whole block more than once, and safe to run
-- against a database where some or all of these columns already exist.
-- Run in Supabase Dashboard -> SQL Editor, as a single block.
-- =============================================================================

-- 1) Create the live client contact fields FIRST, because step 2 writes to them.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS contact_tel     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_cell    TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_website TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS logo_data_url   TEXT NOT NULL DEFAULT '';

-- 2) Preserve any existing contact numbers before retiring the duplicate field.
--    The Clients module now captures "Tel # / Landline" and "Cell #", so the
--    old generic clients.phone column is redundant and was the reason contact
--    numbers never reached the documents.
--    Guarded, so this is a no-op if clients.phone has already been dropped.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'clients'
       AND column_name  = 'phone'
  ) THEN
    UPDATE public.clients
       SET contact_tel = COALESCE(NULLIF(TRIM(contact_tel), ''), NULLIF(TRIM(phone), ''))
     WHERE phone IS NOT NULL
       AND TRIM(phone) <> '';

    UPDATE public.clients
       SET contact_cell = COALESCE(NULLIF(TRIM(contact_cell), ''), NULLIF(TRIM(phone), ''))
     WHERE phone IS NOT NULL
       AND TRIM(phone) <> ''
       AND COALESCE(NULLIF(TRIM(contact_tel), ''), '') = '';
  END IF;
END $$;

-- 3) Retire the duplicate column.
ALTER TABLE public.clients DROP COLUMN IF EXISTS phone;

-- 4) Bill-To contact snapshot on issued documents.
--    NOTE: receipts live in invoice_receipts, and quotation + provisional
--    documents are both rows in itineraries.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS bill_to_tel           TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bill_to_cell          TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bill_to_website       TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bill_to_logo_data_url TEXT NOT NULL DEFAULT '';

-- bill_to_address is required here: recording a receipt copies the invoice's
-- bill-to block (name, email, tel, cell, website, address) onto the receipt.
-- This column existed in no earlier migration, so without it receipt creation
-- fails with "column bill_to_address does not exist".
ALTER TABLE public.invoice_receipts
  ADD COLUMN IF NOT EXISTS bill_to_address TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bill_to_tel     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bill_to_cell    TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bill_to_website TEXT NOT NULL DEFAULT '';

ALTER TABLE public.credit_notes
  ADD COLUMN IF NOT EXISTS bill_to_tel     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bill_to_cell    TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bill_to_website TEXT NOT NULL DEFAULT '';

ALTER TABLE public.itineraries
  ADD COLUMN IF NOT EXISTS bill_to_tel     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bill_to_cell    TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bill_to_website TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS inclusions      TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS exclusions      TEXT NOT NULL DEFAULT '';

-- 5) Company (Bill From) contact details + presentation preferences.
ALTER TABLE public.company_billing_settings
  ADD COLUMN IF NOT EXISTS contact_email TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_tel   TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_cell  TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS client_logo_size                TEXT NOT NULL DEFAULT 'md',
  ADD COLUMN IF NOT EXISTS client_logo_position            TEXT NOT NULL DEFAULT 'left',
  ADD COLUMN IF NOT EXISTS client_billing_address_position TEXT NOT NULL DEFAULT 'left',
  ADD COLUMN IF NOT EXISTS itinerary_pricing_position       TEXT NOT NULL DEFAULT 'above',
  ADD COLUMN IF NOT EXISTS itinerary_terms                  TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS itinerary_terms_position         TEXT NOT NULL DEFAULT 'under_day_by_day',
  ADD COLUMN IF NOT EXISTS itinerary_inclusions             TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS itinerary_inclusions_position    TEXT NOT NULL DEFAULT 'under_day_by_day',
  ADD COLUMN IF NOT EXISTS itinerary_exclusions             TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS itinerary_exclusions_position    TEXT NOT NULL DEFAULT 'under_day_by_day',
  ADD COLUMN IF NOT EXISTS itinerary_include_default_inclusions BOOLEAN NOT NULL DEFAULT true;

-- 6) Normalise any out-of-range values BEFORE re-adding the constraints.
--    Postgres validates existing rows when a CHECK is added, so a single stale
--    value would abort the whole block. Resetting to the defaults first means
--    the constraints below can never fail on pre-existing data.
UPDATE public.company_billing_settings SET client_logo_size                = 'md'    WHERE client_logo_size                NOT IN ('sm', 'md', 'lg');
UPDATE public.company_billing_settings SET client_logo_position            = 'left'  WHERE client_logo_position            NOT IN ('left', 'center', 'right');
UPDATE public.company_billing_settings SET client_billing_address_position = 'left'  WHERE client_billing_address_position NOT IN ('left', 'center', 'right');
UPDATE public.company_billing_settings SET itinerary_pricing_position     = 'above' WHERE itinerary_pricing_position     NOT IN ('above', 'below');
UPDATE public.company_billing_settings SET itinerary_terms_position       = 'under_day_by_day' WHERE itinerary_terms_position       NOT IN ('under_day_by_day', 'before_pricing', 'after_pricing');
UPDATE public.company_billing_settings SET itinerary_inclusions_position  = 'under_day_by_day' WHERE itinerary_inclusions_position  NOT IN ('under_day_by_day', 'before_pricing', 'after_pricing');
UPDATE public.company_billing_settings SET itinerary_exclusions_position  = 'under_day_by_day' WHERE itinerary_exclusions_position  NOT IN ('under_day_by_day', 'before_pricing', 'after_pricing');

-- 7) Re-assert the presentation check constraints (dropped first so this is
--    idempotent even if a previous run left them in place).
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

-- 8) Make the new columns immediately visible to the app.
NOTIFY pgrst, 'reload schema';
