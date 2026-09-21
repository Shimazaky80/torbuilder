-- =============================================================================
-- Migration: Client Credit (on-account) flag + invoice lifecycle alignment
-- Patch-style, idempotent. Run in Supabase Dashboard -> SQL Editor.
--
-- WHAT CHANGES
--   1. clients.is_credit  BOOLEAN  — marks a client whose account is on
--      account / on credit terms. Credit (on-account) clients are NOT asked
--      for a deposit; direct/other clients are. NULL defaults to FALSE.
--   2. invoices: remove the "one live deposit-or-final per (itinerary,
--      currency)" cap so an itinerary can carry SEVERAL live invoices at once
--      (e.g. a deposit invoice plus an ongoing balance invoice while the
--      travellers are still in-transit).
--   3. Invoices are raised as Proforma first; they become a real "Invoice"
--      the moment payment is confirmed and a receipt is issued. The single
--      "Final invoice" concept is dropped, so we widen invoice_type CHECK to
--      accept the neutral 'invoice' (existing 'deposit'/'final' rows are kept).
-- =============================================================================

-- ─── STEP 1: clients.is_credit flag ──────────────────────────────────────────
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS is_credit BOOLEAN NOT NULL DEFAULT false;

-- ─── STEP 2: drop the one-live-invoice-per-(itinerary,currency) cap ─────────
-- Multiple invoices may coexist while travellers are still travelling, so a
-- deposit/balance invoice no longer blocks issuing another one. The per-company
-- invoice_number uniqueness (invoices_company_number_idx) still prevents
-- duplicate numbering.
DROP INDEX IF EXISTS public.invoices_live_itinerary_currency_idx;

-- Keep a non-unique index for fast per-itinerary lookups.
DROP INDEX IF EXISTS public.invoices_itinerary_currency_idx;
CREATE INDEX IF NOT EXISTS invoices_itinerary_currency_idx
  ON public.invoices (itinerary_id, currency_code) WHERE status <> 'void';

-- ─── STEP 3: widen invoice_type to the neutral 'invoice' ────────────────────
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_invoice_type_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_invoice_type_check
    CHECK (invoice_type IN ('deposit', 'final', 'invoice'));

ALTER TABLE public.invoices
  ALTER COLUMN invoice_type SET DEFAULT 'invoice';

-- Newly generated invoices default to the neutral 'invoice' type going forward.
UPDATE public.invoices SET invoice_type = 'invoice' WHERE invoice_type IS NULL OR invoice_type = '';
