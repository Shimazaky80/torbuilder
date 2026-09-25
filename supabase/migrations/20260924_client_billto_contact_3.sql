-- =============================================================================
-- V3 — Client Bill-To contact snapshot (Tel# / Cell# / Email / Website)
-- =============================================================================
-- Adds the live client contact fields plus a Bill-To contact snapshot on every
-- issued document. Idempotent — safe to re-run.
--
--    clients | contact_tel / contact_cell / contact_website      (live record)
--    invoices          | bill_to_tel / bill_to_cell / bill_to_website  (snapshot)
--    invoice_receipts  | bill_to_tel / bill_to_cell / bill_to_website  (snapshot)
--    credit_notes      | bill_to_tel / bill_to_cell / bill_to_website  (snapshot)
--    itineraries       | bill_to_tel / bill_to_cell / bill_to_website  (snapshot)
--
-- NOTE: quotation + provisional documents are rows in `itineraries` (status
-- 'quotation' / 'provisional'), so that one table covers both.
-- =============================================================================

-- ---- clients: live Bill-To contact fields ------------
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS contact_tel       TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_cell      TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_website   TEXT NOT NULL DEFAULT '';

-- ---- documents: Bill-To contact snapshot (take at issue time) ----
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS bill_to_tel      TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bill_to_cell     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bill_to_website  TEXT NOT NULL DEFAULT '';

ALTER TABLE public.invoice_receipts
  ADD COLUMN IF NOT EXISTS bill_to_tel      TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bill_to_cell     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bill_to_website  TEXT NOT NULL DEFAULT '';

ALTER TABLE public.credit_notes
  ADD COLUMN IF NOT EXISTS bill_to_tel      TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bill_to_cell     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bill_to_website  TEXT NOT NULL DEFAULT '';

ALTER TABLE public.itineraries
  ADD COLUMN IF NOT EXISTS bill_to_tel      TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bill_to_cell     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bill_to_website  TEXT NOT NULL DEFAULT '';

-- Reload PostgREST schema cache so the new columns are immediately usable.
NOTIFY pgrst, 'reload schema';
