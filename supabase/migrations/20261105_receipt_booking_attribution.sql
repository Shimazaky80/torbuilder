-- ─── Attribute historic receipts to the booking they settled ────────────────
-- A receipt row links to its invoice but carries no itinerary of its own, and
-- the receipt form did not pass one through, so receipts posted before that was
-- fixed have a null itinerary_id. The ledger was still correct — the money was
-- debited to bank and credited to receivables either way, and the trial balance
-- never moved — but the per-itinerary journal view showed those bookings as
-- still owing money that had in fact been received.
--
-- For booking 9b4092e5 that misread as 6,328.00 outstanding when the client had
-- in fact overpaid by 1,898.40. Nothing about the accounting was wrong; the
-- attribution was, and attribution is what the per-booking view is built on.
--
-- Only rows with a null itinerary are touched, so this is idempotent and cannot
-- move an entry that is already attributed correctly. The booking and client are
-- taken from the invoice the receipt settles, which is the same source the
-- posting path now uses.

UPDATE journal_entries e
   SET itinerary_id = i.itinerary_id,
       client_id    = i.client_id
  FROM public.invoice_receipts rc
  JOIN public.invoices i ON i.id = rc.invoice_id
 WHERE e.source_type   = 'receipt'
   AND e.source_id     = rc.id
   AND e.company_id    = rc.company_id
   AND e.itinerary_id IS NULL;

-- Credit notes inherit the booking from the entry they reverse, but a reversal
-- of an entry that itself had no booking leaves the credit unattributed too.
-- Resolved from the original invoice so a reversal is never the reason a
-- booking looks unpaid.
UPDATE journal_entries e
   SET itinerary_id = i.itinerary_id,
       client_id    = i.client_id
  FROM public.credit_notes cn
  JOIN public.invoices i ON i.id = cn.invoice_id
 WHERE e.source_type   = 'credit_note'
   AND e.source_id     = cn.id
   AND e.company_id    = cn.company_id
   AND e.itinerary_id IS NULL;
