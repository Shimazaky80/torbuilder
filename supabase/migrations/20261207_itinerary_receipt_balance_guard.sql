-- Prevent duplicate and over-limit payment receipts from exceeding the live
-- invoice balance or the total billed for the same itinerary and currency.

ALTER TABLE public.invoice_receipts
  ADD COLUMN IF NOT EXISTS client_submission_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS invoice_receipts_company_submission_key_idx
  ON public.invoice_receipts (company_id, client_submission_key)
  WHERE client_submission_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_itinerary_invoice_receipt_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice             public.invoices%ROWTYPE;
  v_itinerary_id        UUID;
  v_currency            TEXT;
  v_invoice_settled     NUMERIC(12,2);
  v_invoice_remaining   NUMERIC(12,2);
  v_booking_settled     NUMERIC(12,2);
  v_booking_billed      NUMERIC(12,2);
  v_trip_value          NUMERIC(12,2);
  v_value_basis         INTEGER;
  v_booking_limit       NUMERIC(12,2);
  v_booking_remaining   NUMERIC(12,2);
  v_allowed             NUMERIC(12,2);
BEGIN
  IF COALESCE(NEW.direction, 'in') <> 'in' THEN
    RETURN NEW;
  END IF;

  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RAISE EXCEPTION 'A payment receipt must be greater than zero'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT i.* INTO v_invoice
  FROM public.invoices i
  WHERE i.id = NEW.invoice_id
    AND i.company_id = NEW.company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The receipt invoice does not belong to this company'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_invoice.status = 'void' THEN
    RAISE EXCEPTION 'A voided invoice cannot receive a payment'
      USING ERRCODE = 'check_violation';
  END IF;

  v_currency := UPPER(COALESCE(v_invoice.currency_code, ''));
  IF UPPER(COALESCE(NEW.currency_code, '')) <> v_currency THEN
    RAISE EXCEPTION 'Receipt currency must match the invoice currency'
      USING ERRCODE = 'check_violation';
  END IF;

  v_itinerary_id := v_invoice.itinerary_id;
  IF v_itinerary_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('invoice-receipt:' || v_invoice.id::TEXT, 0));
  ELSE
    -- Use the same lock key as invoice issuance so billing and payment writes
    -- cannot both validate against an outdated booking balance.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_itinerary_id::TEXT, 0));
  END IF;

  SELECT ROUND(COALESCE(SUM(
    CASE COALESCE(r.direction, 'in')
      WHEN 'in' THEN r.amount
      WHEN 'out' THEN -r.amount
      WHEN 'apply' THEN r.amount
      ELSE 0
    END
  ), 0)::NUMERIC, 2)
  INTO v_invoice_settled
  FROM public.invoice_receipts r
  WHERE r.invoice_id = v_invoice.id;

  v_invoice_remaining := GREATEST(ROUND(v_invoice.total_incl - v_invoice_settled, 2), 0);
  v_allowed := v_invoice_remaining;

  IF v_itinerary_id IS NOT NULL THEN
    v_booking_billed := public.booking_net_billed(NEW.company_id, v_itinerary_id, v_currency);
    v_trip_value := public.booking_trip_value(NEW.company_id, v_itinerary_id, v_currency);
    v_value_basis := public.booking_trip_value_basis(NEW.company_id, v_itinerary_id, v_currency);

    SELECT ROUND(COALESCE(SUM(
      CASE COALESCE(r.direction, 'in')
        WHEN 'in' THEN r.amount
        WHEN 'out' THEN -r.amount
        WHEN 'apply' THEN r.amount
        ELSE 0
      END
    ), 0)::NUMERIC, 2)
    INTO v_booking_settled
    FROM public.invoice_receipts r
    JOIN public.invoices i ON i.id = r.invoice_id
    WHERE i.company_id = NEW.company_id
      AND i.itinerary_id = v_itinerary_id
      AND UPPER(i.currency_code) = v_currency
      AND i.status <> 'void';

    -- The invoiced amount is one ceiling; the priced itinerary value is the
    -- other. If no priced day items exist, use the live invoice total.
    v_booking_limit := GREATEST(0, LEAST(
      v_booking_billed,
      CASE WHEN v_value_basis > 0 THEN v_trip_value ELSE v_booking_billed END
    ));
    v_booking_remaining := GREATEST(ROUND(v_booking_limit - v_booking_settled, 2), 0);
    v_allowed := LEAST(v_invoice_remaining, v_booking_remaining);
  END IF;

  IF ROUND(NEW.amount, 2) - v_allowed > 0.009 THEN
    RAISE EXCEPTION 'Payment exceeds the remaining invoice or itinerary balance'
      USING ERRCODE = 'check_violation',
            DETAIL = json_build_object(
              'reason', 'receipt_limit',
              'invoice_number', v_invoice.invoice_number,
              'currency', v_currency,
              'requested', ROUND(NEW.amount, 2),
              'invoice_remaining', v_invoice_remaining,
              'itinerary_remaining', CASE WHEN v_itinerary_id IS NULL THEN NULL ELSE v_booking_remaining END,
              'allowed', v_allowed
            )::TEXT;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoice_receipts_balance_guard ON public.invoice_receipts;
CREATE TRIGGER invoice_receipts_balance_guard
  BEFORE INSERT ON public.invoice_receipts
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_itinerary_invoice_receipt_balance();

COMMENT ON COLUMN public.invoice_receipts.client_submission_key IS
  'Client-generated idempotency key that prevents one payment-dialog submission from recording more than one receipt.';
