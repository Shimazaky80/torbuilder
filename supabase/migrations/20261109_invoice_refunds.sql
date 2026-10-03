-- 20261109_invoice_refunds.sql
--
-- Money could only ever move one way: into the business. A receipt records cash
-- arriving, and nothing recorded cash leaving. That made a real situation
-- unrepresentable -- a client who overpaid and wants some of it back, or a
-- cancellation where the money has to be handed back. An operator had to fake it
-- with a negative receipt, which the settlement arithmetic had no way to
-- interpret, or silently do nothing and be wrong.
--
-- THE MODEL
--
-- A refund is money leaving against an invoice that received it. It is not a
-- credit note and must not be confused with one:
--
--   credit note  reduces what the client is charged. No money moves.
--   refund       moves money back out. The charge stands.
--
-- So a refund is the mirror of a receipt on the cash side, and it puts the
-- amount back on the receivable:
--
--     Debit  Accounts Receivable    the client owes it again
--     Credit Bank / Cash            the money left
--
-- Modelling it as a refund rather than a negative receipt matters for the
-- arithmetic. total_incl - received - credited is the balance; a refund raises
-- the received figure's net, so the balance comes back up by exactly the amount
-- handed back. Nothing has to be special-cased, and a client who gets R2 000
-- back on an R8 000 invoice with R5 000 outstanding is genuinely R7 000 out.
--
-- THE RULE
--
-- A refund may never exceed what that invoice has actually received. This is
-- enforced in the database, under the same advisory lock the invoice guard uses,
-- so two operators refunding at once cannot between them hand back more cash
-- than came in. The browser check is for a clear message; this is the one that
-- counts.
--
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------
-- Direction.
--
-- A receipt row is now either money in or money out. Existing rows are all money
-- in, which is what they are, so the backfill is a constant rather than a
-- calculation.
-- ---------------------------------------------------------------------------
ALTER TABLE public.invoice_receipts
  ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'in';

-- The check is added separately and NOT VALID first, so that on a large existing
-- table the scan happens once and does not lock the table against reads for the
-- duration.
ALTER TABLE public.invoice_receipts
  DROP CONSTRAINT IF EXISTS invoice_receipts_direction_check;

ALTER TABLE public.invoice_receipts
  ADD CONSTRAINT invoice_receipts_direction_check
  CHECK (direction IN ('in', 'out')) NOT VALID;

ALTER TABLE public.invoice_receipts
  VALIDATE CONSTRAINT invoice_receipts_direction_check;

COMMENT ON COLUMN public.invoice_receipts.direction IS
  '''in'' for a payment received, ''out'' for a refund paid back to the client. A refund is money leaving against an invoice that received it -- it is not a credit note, which reduces a charge without moving cash.';

-- ---------------------------------------------------------------------------
-- Net received, per invoice.
--
-- Direction-aware, so every caller can stop summing amounts blindly. Voided
-- receipts do not exist as a status here, so all rows count.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoice_net_received(p_invoice_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT ROUND(COALESCE(SUM(
    CASE WHEN r.direction = 'out' THEN -COALESCE(r.amount, 0) ELSE COALESCE(r.amount, 0) END
  ), 0)::NUMERIC, 2)
  FROM public.invoice_receipts r
  WHERE r.invoice_id = p_invoice_id;
$$;

COMMENT ON FUNCTION public.invoice_net_received(UUID) IS
  'Money received against an invoice less money refunded back, in one figure. Never negative: the refund rule keeps a refund from exceeding what was received.';

-- ---------------------------------------------------------------------------
-- Pay a refund against an invoice.
--
-- Same shape as issue_booking_invoice: take the lock, recompute from the
-- documents, refuse with a machine-readable payload, and write atomically.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_invoice_refund(
  p_company_id UUID,
  p_invoice_id UUID,
  p_amount     NUMERIC,
  p_reason     TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice   RECORD;
  v_received  NUMERIC(12,2);
  v_receivable NUMERIC(12,2);
  v_amount    NUMERIC(12,2);
  v_credited  NUMERIC(12,2);
  v_number    TEXT;
  v_receipt_id UUID;
  v_remaining NUMERIC(12,2);
BEGIN
  IF p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'No invoice supplied'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_amount := ROUND(COALESCE(p_amount, 0), 2);

  IF v_amount <= 0.009 THEN
    RAISE EXCEPTION 'Enter an amount to refund'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  /* Same lock key as the invoice guard, so a refund and an issue on the same
     booking cannot interleave and each decide from a stale view. */
  PERFORM pg_advisory_xact_lock(hashtextextended(p_invoice_id::text, 0));

  SELECT i.* INTO v_invoice
  FROM   public.invoices i
  WHERE  i.id = p_invoice_id
    AND  i.company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That invoice does not belong to this company'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_invoice.status = 'void' THEN
    RAISE EXCEPTION 'A voided invoice cannot be refunded'
      USING ERRCODE = 'check_violation',
            DETAIL = json_build_object('reason', 'void', 'currency', UPPER(v_invoice.currency_code))::TEXT;
  END IF;

  /* Net money still held for this invoice: everything received, less everything
     already refunded back. Netting here is what makes the cap below correct on
     the second refund as well as the first. */
  v_received := ROUND(COALESCE((
    SELECT SUM(CASE WHEN r.direction = 'out' THEN -r.amount ELSE r.amount END)
    FROM   public.invoice_receipts r
    WHERE  r.invoice_id = p_invoice_id
  ), 0)::NUMERIC, 2);

  v_credited := ROUND(COALESCE((
    SELECT SUM(c.total_incl)
    FROM   public.credit_notes c
    WHERE  c.invoice_id = p_invoice_id
      AND  c.status <> 'void'
  ), 0)::NUMERIC, 2);

  /* What is still on the books for this invoice: what was charged, less what
     came in, less what was written off. Never negative -- an overpaid invoice
     has a credit with the client, not a negative receivable, and a refund is
     the correct way to settle that. */
  v_receivable := GREATEST(ROUND(v_invoice.total_incl - v_received - v_credited, 2), 0);

  /* The rule. A refund hands back cash that has to have arrived first, and the
     figure it is checked against is already net of any earlier refunds. */
  IF v_amount > v_received + 0.009 THEN
    RAISE EXCEPTION 'That is more than has been received against this invoice'
      USING ERRCODE = 'check_violation',
            DETAIL = json_build_object(
              'reason',     'exceeds_received',
              'refundable', GREATEST(v_received, 0),
              'requested',  v_amount,
              'received',   v_received,
              'invoice_number', v_invoice.invoice_number,
              'currency',   UPPER(v_invoice.currency_code)
            )::TEXT;
  END IF;

  v_number := public.get_next_receipt_reference(p_company_id);
  IF v_number IS NULL THEN
    RAISE EXCEPTION 'Could not allocate a receipt number'
      USING ERRCODE = 'internal_error';
  END IF;

  INSERT INTO public.invoice_receipts (
    company_id, invoice_id, receipt_number, invoice_number, invoice_type,
    currency_code, amount, balance_remaining, direction, received_date,
    payment_method, payment_reference, bill_to_name, bill_to_email,
    supplier_name, supplier_tax_number, supplier_address, bank_details,
    accounting_export, notes
  )
  VALUES (
    p_company_id,
    p_invoice_id,
    v_number,
    v_invoice.invoice_number,
    v_invoice.invoice_type,
    v_invoice.currency_code,
    v_amount,
    /* What the invoice will still owe once this money has gone back out. The
       receivable goes up by the refund, not down. */
    ROUND(v_receivable + v_amount, 2),
    'out',
    CURRENT_DATE,
    'REFUND',
    '',
    v_invoice.bill_to_name,
    v_invoice.bill_to_email,
    v_invoice.supplier_name,
    v_invoice.supplier_tax_number,
    v_invoice.supplier_address,
    v_invoice.bank_details,
    jsonb_build_object(
      'schema', 'torbuilder.refund/v1',
      'provider_agnostic', true,
      'receipt_number', v_number,
      'invoice_number', v_invoice.invoice_number,
      'status', 'refunded',
      'date', CURRENT_DATE,
      'currency', v_invoice.currency_code,
      'customer', jsonb_build_object('name', v_invoice.bill_to_name, 'email', v_invoice.bill_to_email),
      'amount', v_amount,
      'reason', COALESCE(p_reason, ''),
      'outstanding_after', ROUND(v_receivable + v_amount, 2)
    ),
    NULLIF(p_reason, '')
  )
  RETURNING id INTO v_receipt_id;

  v_remaining := ROUND(v_receivable + v_amount, 2);

  /* The invoice reopens. Handing money back means the sale is live again, so a
     receipt that had closed it out no longer has. */
  UPDATE public.invoices
  SET    status = CASE WHEN v_remaining <= 0.009 THEN 'paid' ELSE 'validated' END,
         balance_due = v_remaining,
         paid_at = CASE WHEN v_remaining <= 0.009 THEN paid_at ELSE NULL END,
         updated_at = now()
  WHERE  id = p_invoice_id;

  RETURN json_build_object(
    'id',            v_receipt_id,
    'number',        v_number,
    'amount',        v_amount,
    /* Net cash still held after this refund, which is the ceiling for the next
       one. Reporting the pre-refund figure here would be ambiguous about
       whether it still counts. */
    'received',      v_received - v_amount,
    'outstanding',   v_remaining,
    'invoice_number', v_invoice.invoice_number,
    'currency',      UPPER(v_invoice.currency_code)
  );
END;
$$;

COMMENT ON FUNCTION public.issue_invoice_refund(UUID, UUID, NUMERIC, TEXT) IS
  'Pay a refund against an invoice, refusing to refund more than was received. The amount is written as a receipt row with direction ''out'' and the invoice is reopened.';

GRANT EXECUTE ON FUNCTION public.invoice_net_received(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_invoice_refund(UUID, UUID, NUMERIC, TEXT) TO authenticated;
