-- Ensure a tenant can read its credit notes after an authorized RPC inserts
-- them. This keeps invoices, statements of account, and Finance in sync.

ALTER TABLE public.credit_notes ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.credit_notes TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'credit_notes'
      AND policyname = 'Users view company credit notes'
  ) THEN
    CREATE POLICY "Users view company credit notes"
      ON public.credit_notes
      FOR SELECT
      USING (
        company_id = public.get_user_company_id()
        OR public.is_super_admin()
      );
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- Allow another overpayment adjustment when the invoice already has a credit
-- note. Existing notes are deducted from the itinerary overpayment below, so
-- removing the per-invoice blocker does not permit issuing the same credit
-- twice.
CREATE OR REPLACE FUNCTION public.issue_itinerary_overpayment_credit_note(
  p_company_id     UUID,
  p_invoice_id     UUID,
  p_amount         NUMERIC,
  p_reason         TEXT,
  p_submission_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice          public.invoices%ROWTYPE;
  v_amount           NUMERIC(12,2);
  v_currency         TEXT;
  v_trip_value       NUMERIC(12,2);
  v_value_basis      INTEGER;
  v_billed           NUMERIC(12,2);
  v_cash_settled     NUMERIC(12,2);
  v_credit_notes     NUMERIC(12,2);
  v_invoice_cash     NUMERIC(12,2);
  v_available        NUMERIC(12,2);
  v_invoice_overpay  NUMERIC(12,2);
  v_number           TEXT;
  v_credit_id        UUID;
  v_ratio            NUMERIC;
  v_subtotal         NUMERIC(12,2);
  v_tax              NUMERIC(12,2);
  v_reason           TEXT;
  v_client           UUID;
  v_existing         RECORD;
BEGIN
  IF p_company_id IS NULL OR p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Company and invoice must be specified'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_amount := ROUND(COALESCE(p_amount, 0), 2);
  v_reason := NULLIF(btrim(p_reason), '');
  IF v_amount <= 0.009 THEN
    RAISE EXCEPTION 'Enter an amount to credit'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Give a reason for the overpayment credit note'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NULLIF(btrim(p_submission_key), '') IS NULL THEN
    RAISE EXCEPTION 'Credit note submission key is required'
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
    RAISE EXCEPTION 'This invoice is not eligible for itinerary overpayment credit'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_invoice.client_id IS NULL THEN
    RAISE EXCEPTION 'This invoice has no client to receive the credit'
      USING ERRCODE = 'check_violation';
  END IF;

  v_currency := UPPER(v_invoice.currency_code);
  v_client := v_invoice.client_id;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_invoice.itinerary_id::TEXT, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_company_id::TEXT || ':credit:' || v_client::TEXT || ':' || v_currency, 0));

  SELECT c.id, c.credit_note_number, c.total_incl INTO v_existing
  FROM public.credit_notes c
  WHERE c.company_id = p_company_id
    AND c.accounting_export->>'idempotency_key' = p_submission_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'id', v_existing.id,
      'number', v_existing.credit_note_number,
      'amount', v_existing.total_incl,
      'action', 'credit_note',
      'duplicate', true,
      'invoice_number', v_invoice.invoice_number,
      'currency', v_currency,
      'client_id', v_client,
      'itinerary_id', v_invoice.itinerary_id
    );
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
  INTO v_cash_settled
  FROM public.invoice_receipts r
  JOIN public.invoices i ON i.id = r.invoice_id
  WHERE i.company_id = p_company_id
    AND i.itinerary_id = v_invoice.itinerary_id
    AND UPPER(i.currency_code) = v_currency
    AND i.status <> 'void';

  SELECT ROUND(COALESCE(SUM(c.total_incl), 0)::NUMERIC, 2)
  INTO v_credit_notes
  FROM public.credit_notes c
  JOIN public.invoices i ON i.id = c.invoice_id
  WHERE c.company_id = p_company_id
    AND i.itinerary_id = v_invoice.itinerary_id
    AND UPPER(i.currency_code) = v_currency
    AND i.status <> 'void'
    AND c.status <> 'void';

  v_available := GREATEST(
    0,
    ROUND(
      v_cash_settled
      - LEAST(v_billed, CASE WHEN v_value_basis > 0 THEN v_trip_value ELSE v_billed END)
      - v_credit_notes,
      2
    )
  );

  SELECT ROUND(COALESCE(SUM(
    CASE COALESCE(r.direction, 'in')
      WHEN 'in' THEN r.amount
      WHEN 'out' THEN -r.amount
      ELSE 0
    END
  ), 0)::NUMERIC, 2)
  INTO v_invoice_cash
  FROM public.invoice_receipts r
  WHERE r.invoice_id = v_invoice.id;

  v_invoice_overpay := GREATEST(
    0,
    ROUND(v_invoice_cash - ROUND(v_invoice.total_incl, 2), 2)
  );

  IF v_amount > v_available + 0.009 OR v_amount > v_invoice_overpay + 0.009 THEN
    RAISE EXCEPTION 'Credit note exceeds the available overpayment'
      USING ERRCODE = 'check_violation',
            DETAIL = jsonb_build_object(
              'reason', 'overpayment_limit',
              'requested', v_amount,
              'available', LEAST(v_available, v_invoice_overpay),
              'currency', v_currency
            )::TEXT;
  END IF;

  v_ratio := CASE WHEN ROUND(v_invoice.total_incl, 2) > 0
    THEN v_amount / ROUND(v_invoice.total_incl, 2)
    ELSE 0
  END;
  v_subtotal := ROUND(COALESCE(v_invoice.subtotal_excl, 0) * v_ratio, 2);
  v_tax := ROUND(v_amount - v_subtotal, 2);
  v_number := public.get_next_credit_note_reference(p_company_id);
  IF v_number IS NULL THEN
    RAISE EXCEPTION 'Could not allocate a credit note number'
      USING ERRCODE = 'internal_error';
  END IF;

  INSERT INTO public.credit_notes (
    company_id, invoice_id, invoice_number, invoice_type, credit_note_number,
    status, currency_code, subtotal_excl, tax_total, total_incl, tax_label,
    tax_rate, reason, issued_date, bill_to_name, bill_to_email, bill_to_address,
    supplier_name, supplier_tax_number, supplier_address, accounting_export
  )
  VALUES (
    p_company_id, v_invoice.id, v_invoice.invoice_number, v_invoice.invoice_type, v_number,
    'issued', v_currency, v_subtotal, v_tax, v_amount,
    COALESCE(v_invoice.tax_label, 'Tax'), COALESCE(v_invoice.tax_rate, 0),
    'Overpayment correction: ' || v_reason, CURRENT_DATE,
    COALESCE(v_invoice.bill_to_name, ''), COALESCE(v_invoice.bill_to_email, ''),
    COALESCE(v_invoice.bill_to_address, ''), COALESCE(v_invoice.supplier_name, ''),
    COALESCE(v_invoice.supplier_tax_number, ''), COALESCE(v_invoice.supplier_address, ''),
    jsonb_build_object(
      'schema', 'torbuilder.credit_note/v1',
      'provider_agnostic', true,
      'credit_note_number', v_number,
      'invoice_number', v_invoice.invoice_number,
      'status', 'issued',
      'date', CURRENT_DATE,
      'currency', v_currency,
      'customer', jsonb_build_object('name', v_invoice.bill_to_name, 'email', v_invoice.bill_to_email),
      'amount', v_amount,
      'reason', 'Overpayment correction: ' || v_reason,
      'allocation', 'keep',
      'idempotency_key', p_submission_key,
      'lines', jsonb_build_array(jsonb_build_object(
        'item_name', 'Overpayment correction',
        'category', 'Financial adjustment',
        'quantity', 1,
        'line_total', v_amount
      ))
    )
  )
  RETURNING id INTO v_credit_id;

  INSERT INTO public.invoice_line_items (
    invoice_id, company_id, credit_note_id, day_number, item_name, category,
    quantity, unit_price, subtotal_excl, tax_amount, line_total, tax_label,
    tax_rate, currency_code, sort_order, item_id
  )
  VALUES (
    v_invoice.id, p_company_id, v_credit_id, 0, 'Overpayment correction',
    'Financial adjustment', 1, v_amount, v_subtotal, v_tax, v_amount,
    COALESCE(v_invoice.tax_label, 'Tax'), COALESCE(v_invoice.tax_rate, 0),
    v_currency, 0, NULL
  );

  PERFORM public.client_credit_post(
    p_company_id, v_client, v_currency, v_amount, 'credit',
    'credit_note', 'credit_note', v_credit_id, v_number, v_invoice.itinerary_id,
    'Overpayment correction: ' || v_reason
  );

  RETURN jsonb_build_object(
    'id', v_credit_id,
    'number', v_number,
    'amount', v_amount,
    'action', 'credit_note',
    'invoice_number', v_invoice.invoice_number,
    'currency', v_currency,
    'client_id', v_client,
    'itinerary_id', v_invoice.itinerary_id,
    'duplicate', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_itinerary_overpayment_credit_note(UUID, UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_itinerary_overpayment_credit_note(UUID, UUID, NUMERIC, TEXT, TEXT) TO authenticated;
