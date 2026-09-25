-- ============================================================================
-- Migration V2 - Itinerary Presentation phase 2 (A–F)
-- ============================================================================
-- Adds:
--   (B) contact email / telephone / cell on the company billing profile
--   (F) explicit VAT-registered opt-in for South African tenants
--   (D/E) per-itinerary Inclusions / Exclusions text (with day-by-day
--         auto-generation on the builder)
--
-- Safe to re-run: every statement is idempotent. Run this whole file in the
-- Supabase SQL Editor (or via the CLI) AFTER the V1 migration.
-- ============================================================================

-- (B) Company contact details used on the supplier (Bill From) block of
--     invoices / receipts / credit notes and the itinerary header.
ALTER TABLE company_billing_settings
  ADD COLUMN IF NOT EXISTS contact_email TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_tel   TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_cell  TEXT NOT NULL DEFAULT '';

-- (F) Explicit opt-in for South African tenants. VAT is applied in ZAR only
--     when this flag is ON; ZAR is not assumed to be VAT-registered by default.
ALTER TABLE company_billing_settings
  ADD COLUMN IF NOT EXISTS vat_registered BOOLEAN NOT NULL DEFAULT false;

-- (D) Include the tenant's default Inclusions text alongside the auto-generated
--     per-itinerary list. When false, only the generated list is printed.
ALTER TABLE company_billing_settings
  ADD COLUMN IF NOT EXISTS itinerary_include_default_inclusions BOOLEAN NOT NULL DEFAULT true;

-- (D/E) Per-itinerary Inclusions / Exclusions. When empty the builder derives
--     them from the day-by-day services; otherwise the manual text wins.
ALTER TABLE itineraries
  ADD COLUMN IF NOT EXISTS inclusions  TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS exclusions  TEXT NOT NULL DEFAULT '';

-- Let PostgREST pick up the schema change live.
NOTIFY pgrst, 'reload schema';
