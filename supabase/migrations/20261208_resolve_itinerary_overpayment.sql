-- Give an overpaid itinerary an atomic refund-or-credit-note resolution path.

CREATE UNIQUE INDEX IF NOT EXISTS credit_notes_company_submission_key_idx
  ON public.credit_notes (company_id, (accounting_export->>'idempotency_key'))
  WHERE accounting_export ? 'idempotency_key';

CREATE OR REPLACE FUNCTION public.resolve_itinerary_overpayment(
  p_company_id       UUID,
  p_invoice_id       UUID,
  p_amount           NUMERIC,
  p_reason           TEXT,
  p_action           TEXT,
  p_submission_key   TEXT,
  p_lines            JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice            public.invoices%ROWTYPE;
  v_amount             NUMERIC(12,2);
  v_currency           TEXT;
  v_trip_value         NUMERIC(12,2);
  v_value_basis        INTEGER;
  v_billed             NUMERIC(12,2);
  v_settled            NUMERIC(12,2);
  v_resolved           NUMERIC(12,2);
  v_overpayment        NUMERIC(12,2);
  v_invoice_received   NUMERIC(12,2);
  v_invoice_settled    NUMERIC(12,2);
  v_invoice_balance    NUMERIC(12,2);
  v_number             TEXT;
  v_receipt_id         UUID;
  v_result             JSONB;
  v_existing           RECORD;
  v_client             UUID;
BEGIN
  IF p_company_id IS NULL OR p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Company and invoice must be specified'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_amount := ROUND(COALESCE(p_amount, 0), 2);
  IF v_amount <= 0.009 THEN
    RAISE EXCEPTION 'Enter an amount to resolve'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_action NOT IN ('refund', 'credit_note') THEN
    RAISE EXCEPTION 'Choose refund or credit note'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason for the overpayment resolution'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NULLIF(btrim(p_submission_key), '') IS NULL THEN
    RAISE EXCEPTION 'Payment resolution key is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT i.* INTO v_invoice
  FROM public.invoices i
  WHERE i.id = p_invoice_id
    AND i.company_id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That invoice does not belong to this company'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_invoice.itinerary_id IS NULL OR v_invoice.status = 'void' THEN
    RAISE EXCEPTION 'This invoice is not eligible for itinerary overpayment resolution'
      USING ERRCODE = 'check_violation';
  END IF;

  v_currency := UPPER(v_invoice.currency_code);
  v_client := v_invoice.client_id;

  -- Serialise resolution, receipt and invoice writes for this booking.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_invoice.itinerary_id::TEXT, 0));

  IF p_action = 'refund' THEN
    SELECT r.id, r.receipt_number INTO v_existing
    FROM public.invoice_receipts r
    WHERE r.company_id = p_company_id
      AND r.client_submission_key = p_submission_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'action', 'refund', 'id', v_existing.id, 'number', v_existing.receipt_number,
        'invoice_number', v_invoice.invoice_number, 'currency', v_currency, 'duplicate', true
      );
    END IF;
  ELSE
    SELECT c.id, c.credit_note_number INTO v_existing
    FROM public.credit_notes c
    WHERE c.company_id = p_company_id
      AND c.accounting_export->>'idempotency_key' = p_submission_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'action', 'credit_note', 'id', v_existing.id, 'number', v_existing.credit_note_number,
        'invoice_number', v_invoice.invoice_number, 'currency', v_currency, 'duplicate', true
      );
    END IF;
  END IF;

  v_trip_value := public.booking_trip_value(p_company_id, v_invoice.itinerary_id, v_currency);
  v_value_basis := public.booking_trip_value_basis(p_company_id, v_invoice.itinerary_id, v_currency);

  SELECT ROUND(COALESCE(SUM(i.total_incl), 0)::NUMERIC, 2)
  INTO v_billed
  FROM public.invoices i
  WHERE i.company_id = p_company_id
    AND i.itinerary_id = v_invoice.itinerary_id
    AND UPPER(i.currency_code) = v_currency
    AND i.status <> 'void';

  SELECT ROUND(COALESCE(SUM(
    CASE COALESCE(r.direction, 'in')
      WHEN 'in' THEN r.amount
      WHEN 'out' THEN -r.amount
      ELSE 0
    END
  ), 0)::NUMERIC, 2)
  INTO v_settled
  FROM public.invoice_receipts r
  JOIN public.invoices i ON i.id = r.invoice_id
  WHERE i.company_id = p_company_id
    AND i.itinerary_id = v_invoice.itinerary_id
    AND UPPER(i.currency_code) = v_currency
    AND i.status <> 'void';

  SELECT ROUND(COALESCE(SUM(c.total_incl), 0)::NUMERIC, 2)
  INTO v_resolved
  FROM public.credit_notes c
  JOIN public.invoices i ON i.id = c.invoice_id
  WHERE c.company_id = p_company_id
    AND i.itinerary_id = v_invoice.itinerary_id
    AND UPPER(i.currency_code) = v_currency
    AND i.status <> 'void'
    AND c.status <> 'void';

  v_overpayment := GREATEST(
    0,
    ROUND(v_settled - LEAST(v_billed, CASE WHEN v_value_basis > 0 THEN v_trip_value ELSE v_billed END) - v_resolved, 2)
  );

  IF v_amount > v_overpayment + 0.009 THEN
    RAISE EXCEPTION 'Resolution amount exceeds the current itinerary overpayment'
      USING ERRCODE = 'check_violation',
            DETAIL = jsonb_build_object(
              'reason', 'overpayment_limit',
              'requested', v_amount,
              'available', v_overpayment,
              'currency', v_currency
            )::TEXT;
  END IF;

  IF p_action = 'refund' THEN
    SELECT ROUND(COALESCE(SUM(
      CASE COALESCE(r.direction, 'in')
        WHEN 'in' THEN r.amount
        WHEN 'out' THEN -r.amount
        ELSE 0
      END
    ), 0)::NUMERIC, 2)
    INTO v_invoice_received
    FROM public.invoice_receipts r
    WHERE r.invoice_id = v_invoice.id;

    IF v_amount > v_invoice_received + 0.009 THEN
      RAISE EXCEPTION 'Refund amount exceeds cash received against this invoice'
        USING ERRCODE = 'check_violation',
              DETAIL = jsonb_build_object(
                'reason', 'invoice_refund_limit',
                'requested', v_amount,
                'available', GREATEST(v_invoice_received, 0),
                'currency', v_currency
              )::TEXT;
    END IF;

    v_number := public.get_next_receipt_reference(p_company_id);
    IF v_number IS NULL THEN
      RAISE EXCEPTION 'Could not allocate a receipt number'
        USING ERRCODE = 'internal_error';
    END IF;

    v_invoice_settled := ROUND(v_invoice_received + COALESCE((
      SELECT SUM(r.amount)
      FROM public.invoice_receipts r
      WHERE r.invoice_id = v_invoice.id
        AND r.direction = 'apply'
    ), 0)::NUMERIC, 2);
    v_invoice_balance := GREATEST(ROUND(v_invoice.total_incl - (v_invoice_settled - v_amount), 2), 0);

    INSERT INTO public.invoice_receipts (
      company_id, invoice_id, receipt_number, invoice_number, invoice_type,
      currency_code, amount, balance_remaining, direction, received_date,
      payment_method, payment_reference, bill_to_name, bill_to_email,
      supplier_name, supplier_tax_number, supplier_address, bank_details,
      itinerary_id, client_id, accounting_export, client_submission_key, notes
    )
    VALUES (
      p_company_id, v_invoice.id, v_number, v_invoice.invoice_number, v_invoice.invoice_type,
      v_currency, v_amount, v_invoice_balance, 'out', CURRENT_DATE,
      'REFUND', '', v_invoice.bill_to_name, v_invoice.bill_to_email,
      v_invoice.supplier_name, v_invoice.supplier_tax_number, v_invoice.supplier_address,
      v_invoice.bank_details, v_invoice.itinerary_id, v_invoice.client_id,
      jsonb_build_object(
        'schema', 'torbuilder.refund/v1', 'provider_agnostic', true,
        'receipt_number', v_number, 'invoice_number', v_invoice.invoice_number,
        'status', 'refunded', 'date', CURRENT_DATE, 'currency', v_currency,
        'customer', jsonb_build_object('name', v_invoice.bill_to_name, 'email', v_invoice.bill_to_email),
        'amount', v_amount, 'reason', btrim(p_reason), 'outstanding_after', v_invoice_balance,
        'idempotency_key', p_submission_key
      ),
      p_submission_key, btrim(p_reason)
    )
    RETURNING id INTO v_receipt_id;

    UPDATE public.invoices
    SET status = CASE WHEN v_invoice_balance <= 0.009 THEN 'paid' ELSE 'validated' END,
        balance_due = v_invoice_balance,
        paid_at = CASE WHEN v_invoice_balance <= 0.009 THEN paid_at ELSE NULL END,
        updated_at = now()
    WHERE id = v_invoice.id;

    RETURN jsonb_build_object(
      'action', 'refund', 'id', v_receipt_id, 'number', v_number, 'amount', v_amount,
      'invoice_number', v_invoice.invoice_number, 'currency', v_currency,
      'client_id', v_client, 'itinerary_id', v_invoice.itinerary_id,
      'duplicate', false
    );
  END IF;

  IF v_client IS NULL THEN
    RAISE EXCEPTION 'This invoice has no client, so an overpayment credit note cannot be issued'
      USING ERRCODE = 'check_violation';
  END IF;

  v_result := public.issue_client_credit_note(
    p_company_id,
    v_invoice.id,
    v_amount,
    'Overpayment correction: ' || btrim(p_reason),
    'keep',
    COALESCE(p_lines, '[]'::JSONB)
  );

  UPDATE public.credit_notes
  SET accounting_export = jsonb_set(
    COALESCE(accounting_export, '{}'::JSONB),
    '{idempotency_key}',
    to_jsonb(p_submission_key),
    true
  )
  WHERE id = (v_result->>'id')::UUID;

  RETURN v_result || jsonb_build_object('action', 'credit_note', 'duplicate', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_itinerary_overpayment(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, JSONB) TO authenticated;

COMMENT ON FUNCTION public.resolve_itinerary_overpayment(UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, JSONB) IS
  'Resolve a currency-specific itinerary overpayment as cash refund or client credit note, under the itinerary lock and capped at the currently available overpayment.';
