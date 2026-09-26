-- Tenant company profile: website
--
-- The tenant (Bill From) block on generated documents already carries the
-- company email, tel and cell. The website was the one profile field still
-- missing, so it is added here and surfaced on every document alongside them.
--
-- Idempotent: safe to re-run.
--
--   clients.contact_website already exists (20260924 client contact migration);
--   this adds the tenant equivalent on company_billing_settings.

ALTER TABLE public.company_billing_settings
  ADD COLUMN IF NOT EXISTS contact_website TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN public.company_billing_settings.contact_website IS
  'Tenant company website, printed under the Bill From company details on all documents.';
