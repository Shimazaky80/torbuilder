-- Refund only cash that exceeds the amount settled on the inclusive invoice.
-- A refund of that excess must not reopen the invoice or turn a client credit
-- into a new receivable.

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
  v_invoice        RECORD;
  v_cash_received  NUMERIC(12,2);
  v_credit_applied NUMERIC(12,2);
  v_refundable     NUMERIC(12,2);
  v_amount         NUMERIC(12,2);
  v_number         TEXT;
  v_receipt_id     UUID;
  v_remaining      NUMERIC(12,2);
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

  PERFORM pg_advisory_xact_lock(hashtextextended(p_invoice_id::text, 0));

  SELECT i.* INTO v_invoice
  FROM public.invoices i
  WHERE i.id = p_invoice_id
    AND i.company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That invoice does not belong to this company'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_invoice.status = 'void' THEN
    RAISE EXCEPTION 'A voided invoice cannot be refunded'
      USING ERRCODE = 'check_violation',
            DETAIL = json_build_object('reason', 'void', 'currency', UPPER(v_invoice.currency_code))::TEXT;
  END IF;

  SELECT ROUND(COALESCE(SUM(
    CASE WHEN r.direction = 'out' THEN -r.amount
         WHEN r.direction = 'in' OR r.direction IS NULL THEN r.amount
         ELSE 0
    END
  ), 0)::NUMERIC, 2)
  INTO v_cash_received
  FROM public.invoice_receipts r
  WHERE r.invoice_id = p_invoice_id;
  v_cash_received := GREATEST(v_cash_received, 0);

  SELECT ROUND(COALESCE(SUM(r.amount), 0)::NUMERIC, 2)
  INTO v_credit_applied
  FROM public.invoice_receipts r
  WHERE r.invoice_id = p_invoice_id
    AND r.direction = 'apply';

  /* Applied wallet credit settles the invoice, but a refund still cannot
     exceed the cash that remains in hand. */
  v_refundable := LEAST(
    v_cash_received,
    GREATEST(ROUND(v_cash_received + v_credit_applied - v_invoice.total_incl, 2), 0)
  );

  IF v_amount > v_refundable + 0.009 THEN
    RAISE EXCEPTION 'That is more than the excess cash received against this invoice'
      USING ERRCODE = 'check_violation',
            DETAIL = json_build_object(
              'reason', 'exceeds_overpayment',
              'refundable', v_refundable,
              'requested', v_amount,
              'invoice_number', v_invoice.invoice_number,
              'currency', UPPER(v_invoice.currency_code)
            )::TEXT;
  END IF;

  v_number := public.get_next_receipt_reference(p_company_id);
  IF v_number IS NULL THEN
    RAISE EXCEPTION 'Could not allocate a receipt number'
      USING ERRCODE = 'internal_error';
  END IF;

  v_remaining := GREATEST(ROUND(
    v_invoice.total_incl - (v_cash_received - v_amount) - v_credit_applied, 2
  ), 0);

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
    v_remaining,
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
      'outstanding_after', v_remaining
    ),
    NULLIF(p_reason, '')
  )
  RETURNING id INTO v_receipt_id;

  UPDATE public.invoices
  SET status = CASE WHEN v_remaining <= 0.009 THEN 'paid' ELSE 'validated' END,
      balance_due = v_remaining,
      paid_at = CASE WHEN v_remaining <= 0.009 THEN paid_at ELSE NULL END,
      updated_at = now()
  WHERE id = p_invoice_id;

  RETURN json_build_object(
    'id', v_receipt_id,
    'number', v_number,
    'amount', v_amount,
    'received', v_cash_received - v_amount,
    'outstanding', v_remaining,
    'invoice_number', v_invoice.invoice_number,
    'currency', UPPER(v_invoice.currency_code)
  );
END;
$$;

COMMENT ON FUNCTION public.issue_invoice_refund(UUID, UUID, NUMERIC, TEXT) IS
  'Refund excess cash without reopening the invoice. The locked database calculation includes wallet credit applied to the inclusive invoice total and caps the refund at cash actually held.';

GRANT EXECUTE ON FUNCTION public.issue_invoice_refund(UUID, UUID, NUMERIC, TEXT) TO authenticated;
