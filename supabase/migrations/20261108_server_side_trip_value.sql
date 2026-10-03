-- 20261108_server_side_trip_value.sql
--
-- The over-billing guard could not answer the question it was built to answer.
--
-- 20261107 made the guard atomic: it recomputes what a booking has already
-- billed, inside a transaction, under a lock, so two operators issuing from two
-- tabs can no longer both pass the check. That part works. But the trip's value
-- was still passed in by the caller, which left the guard able to be told to
-- approve anything:
--
--     SELECT issue_booking_invoice(..., p_trip_total => 900000, ...);
--
-- An inflated trip total means an inflated allowance, and the guard approves it
-- happily. The caller was being asked to police the very number the guard exists
-- to protect. The SQL is atomic about a comparison whose other side it does not
-- control.
--
-- The trip's value is not a matter of opinion, though. It is already in the
-- database: every priced line sits on itinerary_day_items.total_sell, written
-- when the itinerary is priced. So the server can total it itself, from the same
-- rows the invoice is built out of, and refuse to take the caller's word for it.
--
-- WHAT CHANGES
--
--   1. New function booking_trip_value(): what the booking is worth in one
--      currency, summed from its own priced day items. This mirrors
--      buildCurrencyLines() in the browser exactly -- same rows, same filters --
--      so the two agree by construction rather than by coincidence.
--   2. issue_booking_invoice() uses that figure. The caller's p_trip_total is
--      still accepted, but only as a cross-check, and only where the database
--      has nothing to say.
--   3. The response reports which figure was used and what the caller claimed,
--      so a disagreement is visible rather than silent.
--
-- WHERE THERE ARE NO PRICED ITEMS
--
-- A booking with no priced day items has no server-side value, and refusing every
-- invoice against it would be a regression, not a safeguard. There the caller's
-- figure stands, and the response says so (trip_value_source = 'caller') so it
-- is auditable. This is the honest limit of the change: for a booking that has
-- never been priced, the guard is still only as good as its caller. Every real
-- itinerary has priced items, so this is a fallback, not the normal path.
--
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------
-- What the booking is worth, in one currency.
--
-- Same three filters the browser applies when it builds the invoice: included
-- items only, this currency only, summed on total_sell. total_sell is what the
-- builder persists (sellPP * pax) and what the invoice lines are derived from,
-- so this is the same number the caller would have computed -- only now it is
-- the database's answer rather than the caller's claim.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.booking_trip_value(
  p_company_id   UUID,
  p_itinerary_id UUID,
  p_currency     TEXT
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT ROUND(COALESCE(SUM(di.total_sell), 0)::NUMERIC, 2)
  FROM   public.itinerary_day_items di
  JOIN   public.itinerary_days d ON d.id = di.itinerary_day_id
  WHERE  d.itinerary_id = p_itinerary_id
    AND  di.company_id   = p_company_id
    AND  di.is_included IS TRUE
    AND  UPPER(di.currency_code) = UPPER(p_currency)
    AND  COALESCE(di.total_sell, 0) <> 0;
$$;

COMMENT ON FUNCTION public.booking_trip_value(UUID, UUID, TEXT) IS
  'What this booking is worth in one currency, summed from its priced day items. The server-side basis for the over-billing guard.';

-- ---------------------------------------------------------------------------
-- How many priced lines back that figure.
--
-- Distinguishes "this booking is worth nothing" (all its lines are legitimately
-- zero) from "this booking has never been priced" (there is nothing to total).
-- Only the second is a reason to fall back to the caller.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.booking_trip_value_basis(
  p_company_id   UUID,
  p_itinerary_id UUID,
  p_currency     TEXT
)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT count(*)::INTEGER
  FROM   public.itinerary_day_items di
  JOIN   public.itinerary_days d ON d.id = di.itinerary_day_id
  WHERE  d.itinerary_id = p_itinerary_id
    AND  di.company_id   = p_company_id
    AND  di.is_included IS TRUE
    AND  UPPER(di.currency_code) = UPPER(p_currency);
$$;

COMMENT ON FUNCTION public.booking_trip_value_basis(UUID, UUID, TEXT) IS
  'How many included priced lines the trip value for this currency is summed from. Zero means the booking has never been priced in this currency.';

-- ---------------------------------------------------------------------------
-- The guard, now able to answer for itself.
--
-- The whole change is in this block: the trip value is read from the database,
-- and the caller's figure is demoted from "the truth" to "a claim we check".
-- Everything else -- the lock, the recomputed billed figure, the refusal shape,
-- the atomic header-and-lines write -- is carried over from 20261107 unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_booking_invoice(
  p_company_id   UUID,
  p_itinerary_id UUID,
  p_currency     TEXT,
  p_trip_total   NUMERIC,
  p_invoice      JSONB,
  p_lines        JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_number      TEXT;
  v_invoice_id  UUID;
  v_proposed    NUMERIC(12,2);
  v_billed      NUMERIC(12,2);
  v_limit       NUMERIC(12,2);
  v_server_value NUMERIC(12,2);
  v_basis       INTEGER;
  v_trip_value  NUMERIC(12,2);
  v_source      TEXT;
  v_claimed     NUMERIC(12,2);
  v_line        JSONB;
  v_inserted    INTEGER := 0;
BEGIN
  IF p_company_id IS NULL OR p_itinerary_id IS NULL THEN
    RAISE EXCEPTION 'Booking not specified'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_invoice IS NULL THEN
    RAISE EXCEPTION 'No invoice supplied'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_currency IS NULL OR btrim(p_currency) = '' THEN
    RAISE EXCEPTION 'No currency supplied'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_proposed := ROUND(COALESCE((p_invoice->>'total_incl')::NUMERIC, 0), 2);

  IF v_proposed < 0 THEN
    RAISE EXCEPTION 'An invoice cannot be negative'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_proposed <= 0.009 THEN
    RAISE EXCEPTION 'This booking has nothing left to invoice'
      USING ERRCODE = 'check_violation',
            DETAIL = json_build_object(
              'reason',   'nothing',
              'proposed', v_proposed,
              'currency', UPPER(p_currency)
            )::TEXT;
  END IF;

  -- Serialise issues for this booking. The _xact_ variant releases at commit or
  -- rollback, so a failed attempt cannot wedge the booking.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_itinerary_id::text, 0));

  -- What the booking is worth, according to its own priced items.
  v_server_value := public.booking_trip_value(p_company_id, p_itinerary_id, p_currency);
  v_basis        := public.booking_trip_value_basis(p_company_id, p_itinerary_id, p_currency);

  /* A booking with priced lines is measured by those lines, whatever the caller
     says. A booking with none has nothing to be measured against, so the
     caller's figure stands and the response records that it did. */
  IF v_basis > 0 THEN
    v_trip_value := v_server_value;
    v_source     := 'itinerary';
  ELSE
    v_trip_value := GREATEST(ROUND(COALESCE(p_trip_total, 0), 2), 0);
    v_source     := 'caller';
  END IF;

  v_claimed := ROUND(COALESCE(p_trip_total, 0), 2);

  -- Recomputed here, inside the lock, rather than trusted from the caller.
  v_billed := public.booking_net_billed(p_company_id, p_itinerary_id, p_currency);

  -- Clamped at zero, exactly as the browser's billableRemaining is. A booking can
  -- end up billed past its own value once credit notes are counted, and the
  -- honest figure to report then is "nothing left", not a negative allowance.
  v_limit := GREATEST(ROUND(v_trip_value - v_billed, 2), 0);

  IF v_proposed - v_limit > 0.009 THEN
    RAISE EXCEPTION 'This booking cannot be billed that much'
      USING ERRCODE = 'check_violation',
            DETAIL = json_build_object(
              -- 'over' is the word the browser-side guard uses, so one message
              -- serves a refusal whichever side caught it.
              'reason',       CASE WHEN v_limit <= 0.009 THEN 'nothing' ELSE 'over' END,
              'proposed',     v_proposed,
              'limit',        v_limit,
              'billed',       v_billed,
              'trip_total',   v_trip_value,
              'claimed',      v_claimed,
              'value_source', v_source,
              'currency',     UPPER(p_currency)
            )::TEXT;
  END IF;

  v_number := public.get_next_invoice_reference(p_company_id);
  IF v_number IS NULL THEN
    RAISE EXCEPTION 'Could not allocate an invoice number'
      USING ERRCODE = 'internal_error';
  END IF;

  -- The number is allocated here, so the caller could not have put it in the
  -- accounting snapshot. Stamp it in now, otherwise the stored export disagrees
  -- with the stored row -- and the repricing diff reads that snapshot.
  IF p_invoice ? 'accounting_export' THEN
    p_invoice := jsonb_set(p_invoice, '{accounting_export,invoice_number}', to_jsonb(v_number), true);
  END IF;

  INSERT INTO public.invoices (
    company_id, itinerary_id, client_id, invoice_number, invoice_type, status,
    currency_code, subtotal_excl, tax_total, total_incl, tax_label, tax_rate,
    balance_due, credited_amount, issued_date, due_date, paid_at,
    bill_to_name, bill_to_email, bill_to_address, bill_to_tel, bill_to_cell,
    bill_to_website, bill_to_logo_data_url,
    supplier_name, supplier_tax_number, supplier_address,
    bank_details, notes, per_person_breakdown, accounting_export
  )
  VALUES (
    p_company_id,
    p_itinerary_id,
    NULLIF(p_invoice->>'client_id', '')::UUID,
    v_number,
    COALESCE(NULLIF(p_invoice->>'invoice_type', ''), 'invoice'),
    COALESCE(NULLIF(p_invoice->>'status', ''), 'validated'),
    UPPER(p_currency),
    ROUND(COALESCE((p_invoice->>'subtotal_excl')::NUMERIC, 0), 2),
    ROUND(COALESCE((p_invoice->>'tax_total')::NUMERIC, 0), 2),
    v_proposed,
    COALESCE(p_invoice->>'tax_label', 'VAT'),
    COALESCE((p_invoice->>'tax_rate')::NUMERIC, 15),
    ROUND(COALESCE((p_invoice->>'balance_due')::NUMERIC, v_proposed), 2),
    0,
    COALESCE(NULLIF(p_invoice->>'issued_date', '')::DATE, CURRENT_DATE),
    NULLIF(p_invoice->>'due_date', '')::DATE,
    NULLIF(p_invoice->>'paid_at', '')::TIMESTAMPTZ,
    COALESCE(p_invoice->>'bill_to_name', ''),
    COALESCE(p_invoice->>'bill_to_email', ''),
    COALESCE(p_invoice->>'bill_to_address', ''),
    COALESCE(p_invoice->>'bill_to_tel', ''),
    COALESCE(p_invoice->>'bill_to_cell', ''),
    COALESCE(p_invoice->>'bill_to_website', ''),
    COALESCE(p_invoice->>'bill_to_logo_data_url', ''),
    COALESCE(p_invoice->>'supplier_name', ''),
    COALESCE(p_invoice->>'supplier_tax_number', ''),
    COALESCE(p_invoice->>'supplier_address', ''),
    COALESCE(p_invoice->'bank_details', '{}'::JSONB),
    NULLIF(p_invoice->>'notes', ''),
    COALESCE(p_invoice->'per_person_breakdown', '[]'::JSONB),
    COALESCE(p_invoice->'accounting_export', '{}'::JSONB)
  )
  RETURNING id INTO v_invoice_id;

  -- Line items in the same transaction, as in 20261107.
  IF p_lines IS NOT NULL AND jsonb_typeof(p_lines) = 'array' THEN
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
      INSERT INTO public.invoice_line_items (
        invoice_id, company_id, day_number, service_date, item_name, category,
        supplier_name, meal_plan, quantity, unit_price, subtotal_excl,
        tax_amount, line_total, tax_label, tax_rate, currency_code, sort_order
      )
      VALUES (
        v_invoice_id,
        p_company_id,
        COALESCE((v_line->>'day_number')::INTEGER, 1),
        NULLIF(v_line->>'service_date', '')::DATE,
        COALESCE(v_line->>'item_name', ''),
        NULLIF(v_line->>'category', ''),
        NULLIF(v_line->>'supplier_name', ''),
        NULLIF(v_line->>'meal_plan', ''),
        COALESCE((v_line->>'quantity')::INTEGER, 1),
        ROUND(COALESCE((v_line->>'unit_price')::NUMERIC, 0), 2),
        ROUND(COALESCE((v_line->>'subtotal_excl')::NUMERIC, 0), 2),
        ROUND(COALESCE((v_line->>'tax_amount')::NUMERIC, 0), 2),
        ROUND(COALESCE((v_line->>'line_total')::NUMERIC, 0), 2),
        COALESCE(v_line->>'tax_label', 'VAT'),
        COALESCE((v_line->>'tax_rate')::NUMERIC, 15),
        UPPER(p_currency),
        COALESCE((v_line->>'sort_order')::INTEGER, 0)
      );
      v_inserted := v_inserted + 1;
    END LOOP;
  END IF;

  RETURN json_build_object(
    'id',            v_invoice_id,
    'number',        v_number,
    'billed',        v_billed,
    'limit',         v_limit,
    'trip_total',    v_trip_value,
    'claimed',       v_claimed,
    'value_source',  v_source,
    'value_basis',   v_basis,
    'line_count',    v_inserted
  );
END;
$$;

COMMENT ON FUNCTION public.issue_booking_invoice(UUID, UUID, TEXT, NUMERIC, JSONB, JSONB) IS
  'Issue an invoice for a booking under a lock, refusing to bill more than the trip is worth. The trip value is summed server-side from priced day items; the caller figure is a cross-check. Header and lines are written in one transaction.';

GRANT EXECUTE ON FUNCTION public.booking_trip_value(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.booking_trip_value_basis(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_booking_invoice(UUID, UUID, TEXT, NUMERIC, JSONB, JSONB) TO authenticated;
