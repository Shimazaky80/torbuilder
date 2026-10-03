-- 20261107_atomic_invoice_guard.sql
--
-- Makes the over-billing guard atomic.
--
-- The guard used to be a read-then-insert in the browser: read what the booking
-- has already billed, check the new invoice fits in the gap, then insert. Two
-- operators issuing from two tabs (or one operator double-clicking) could both
-- read the same pre-insert state, both pass, and both insert. The check and the
-- write have to happen inside one transaction, on the server, or the check is
-- only advice.
--
-- This migration adds one function that does both, under a lock:
--
--   1. takes an advisory lock keyed on the itinerary, so issues for one booking
--      queue behind each other instead of racing;
--   2. recomputes what the booking has already billed, from the database, inside
--      that transaction;
--   3. refuses the invoice if it would bill more than the trip is worth;
--   4. inserts the header and its line items in the same transaction, so a
--      half-written invoice is no longer possible.
--
-- Limit of this approach, stated plainly: the trip's total value is not stored
-- on the itinerary (it is computed in the browser from the day items and the
-- party size), so the caller passes it in and the function cannot verify it. That
-- makes the function authoritative about "how much has already been billed" and
-- about concurrency, but not about "what the trip is worth". A caller who passes
-- an inflated trip total can still over-bill. Closing that last gap needs the
-- trip total persisted on the itinerary, which is a separate change.
--
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------
-- What the booking has already billed, in one currency.
--
-- Voided invoices were billed and then undone, so they contribute nothing. Credit
-- notes are money given back, so they reduce the figure. Receipts are
-- deliberately ignored: what a booking has been *charged* is a question about
-- documents, and cash received against them settles them separately.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.booking_net_billed(
  p_company_id   UUID,
  p_itinerary_id UUID,
  p_currency     TEXT
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT ROUND(
    COALESCE((
      SELECT SUM(i.total_incl)
      FROM public.invoices i
      WHERE i.company_id   = p_company_id
        AND i.itinerary_id = p_itinerary_id
        AND UPPER(i.currency_code) = UPPER(p_currency)
        AND i.status <> 'void'
    ), 0)
    -
    COALESCE((
      /* Only credit notes whose own invoice still stands. A credit note against
         a voided invoice is the reversal of that void, and counting it without
         the void would credit back a charge that was never live. */
      SELECT SUM(c.total_incl)
      FROM public.credit_notes c
      JOIN public.invoices i ON i.id = c.invoice_id
      WHERE c.company_id   = p_company_id
        AND i.itinerary_id = p_itinerary_id
        AND UPPER(c.currency_code) = UPPER(p_currency)
        /* The parent must be in this currency too. Matching only the credit
           note would let a credit raised in another currency reduce an
           allowance denominated in this one. */
        AND UPPER(i.currency_code) = UPPER(p_currency)
        AND c.status <> 'void'
        AND i.status <> 'void'
    ), 0)
  , 2);
$$;

COMMENT ON FUNCTION public.booking_net_billed(UUID, UUID, TEXT) IS
  'What this booking has already billed in one currency: live invoices less live credit notes. Receipts excluded.';

-- ---------------------------------------------------------------------------
-- Issue an invoice under a guard that cannot be raced.
--
-- p_trip_total  what the trip is worth in this currency (see the note above)
-- p_invoice     the invoice header as jsonb
-- p_lines       the line items as a jsonb array
--
-- Raises an exception carrying a machine-readable payload rather than silently
-- inserting something the caller then has to notice is wrong.
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

  /* The guard filters and writes on this currency, so it cannot be null or
     blank. Without this the function would silently issue into a null currency
     column rather than saying what was wrong. */
  IF p_currency IS NULL OR btrim(p_currency) = '' THEN
    RAISE EXCEPTION 'No currency supplied'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  /* A trip cannot be worth less than nothing. Anything else is accepted, since
     the real total is not stored server-side and this is only a floor. */
  IF p_trip_total IS NOT NULL AND p_trip_total < 0 THEN
    RAISE EXCEPTION 'A trip total cannot be negative'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_proposed := ROUND(COALESCE((p_invoice->>'total_incl')::NUMERIC, 0), 2);

  IF v_proposed < 0 THEN
    RAISE EXCEPTION 'An invoice cannot be negative'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- A zero-value invoice is not worth raising, and the browser has always
  -- refused it. Enforced here too, or a client could still insert a R0.00
  -- document that posts nothing and says nothing.
  IF v_proposed <= 0.009 THEN
    RAISE EXCEPTION 'This booking has nothing left to invoice'
      USING ERRCODE = 'check_violation',
            DETAIL = json_build_object(
              'reason',   'nothing',
              'proposed', v_proposed,
              'currency', UPPER(p_currency)
            )::TEXT;
  END IF;

  -- Serialise issues for this booking. hashtextextended gives a stable bigint
  -- key; the _xact_ variant releases automatically at commit or rollback, so a
  -- failed attempt cannot wedge the booking.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_itinerary_id::text, 0));

  -- Recomputed here, inside the lock, rather than trusted from the caller.
  v_billed := public.booking_net_billed(p_company_id, p_itinerary_id, p_currency);

  /* Clamped at zero, exactly as the browser's billableRemaining is. A booking
     can end up billed past its own value once credit notes are taken into
     account, and the honest figure to report then is "nothing left", not a
     negative allowance the two sides would then disagree about. */
  v_limit  := GREATEST(ROUND(COALESCE(p_trip_total, 0) - v_billed, 2), 0);

  IF v_proposed - v_limit > 0.009 THEN
    RAISE EXCEPTION 'This booking cannot be billed that much'
      USING ERRCODE = 'check_violation',
            DETAIL = json_build_object(
              /* 'over' is the word the browser-side guard uses, so one
                 message serves a refusal whichever side caught it. */
              'reason',      CASE WHEN v_limit <= 0.009 THEN 'nothing' ELSE 'over' END,
              'proposed',    v_proposed,
              'limit',       v_limit,
              'billed',      v_billed,
              'trip_total',  ROUND(COALESCE(p_trip_total, 0), 2),
              'currency',    UPPER(p_currency)
            )::TEXT;
  END IF;

  v_number := public.get_next_invoice_reference(p_company_id);
  IF v_number IS NULL THEN
    RAISE EXCEPTION 'Could not allocate an invoice number'
      USING ERRCODE = 'internal_error';
  END IF;

  /* The number is allocated here, so the caller could not have put it in the
     accounting snapshot. Stamp it in now, otherwise the stored export disagrees
     with the stored row — and the repricing diff reads that snapshot. */
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

  -- Line items in the same transaction. Previously a failure here left a header
  -- with no lines and relied on the caller to delete it, which is exactly the
  -- kind of cleanup that gets skipped.
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
    'id',        v_invoice_id,
    'number',    v_number,
    'billed',    v_billed,
    'limit',     v_limit,
    'line_count',v_inserted
  );
END;
$$;

COMMENT ON FUNCTION public.issue_booking_invoice(UUID, UUID, TEXT, NUMERIC, JSONB, JSONB) IS
  'Issue an invoice for a booking under a lock, refusing to bill more than the trip is worth. Header and lines are written in one transaction.';

-- Only the issuing paths need this, and only while they are being migrated
-- across. The browser already filters every query by company.
GRANT EXECUTE ON FUNCTION public.booking_net_billed(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_booking_invoice(UUID, UUID, TEXT, NUMERIC, JSONB, JSONB) TO authenticated;
