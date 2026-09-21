-- Tenant tax jurisdiction used by the South Africa VAT guardrail.
-- Run this once in Supabase SQL Editor if migrations are not automatic.

ALTER TABLE public.company_billing_settings
  ADD COLUMN IF NOT EXISTS operating_country TEXT NOT NULL DEFAULT 'South Africa';

NOTIFY pgrst, 'reload schema';
