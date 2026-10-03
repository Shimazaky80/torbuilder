-- ===========================================================================
-- CREDIT WALLET SMOKE TEST
--
-- The whole test is ONE statement. That is deliberate, and it is the fix for
-- "ERROR: 42P01: relation t does not exist".
--
-- The previous version spread itself over many statements and passed ids between
-- them through temp tables (t, r, refused). That only works if every statement
-- runs on the same connection. The Supabase SQL editor does not guarantee that,
-- so the temp table created by one statement was not there for the next one. It
-- passed locally because the local harness runs the whole file in a single
-- session, which hid the fault rather than revealing it.
--
-- One statement means one connection means no state to lose. There is no temp
-- table here, and nothing has to survive between statements.
--
-- HOW TO READ THE RESULT
--
--   A red error  -> at least one check failed. The message names every failure,
--                   what was expected and what actually came back. Nothing is
--                   left behind: the block is one transaction, so a raised
--                   exception rolls back every row it created.
--   No error    -> all checks passed and the fixtures were deleted on the way
--                   out. Each individual check is echoed as a NOTICE.
--
-- So the absence of a red error is the pass. Do not read absent printed output
-- as failure.
-- ===========================================================================

DO $test$
DECLARE
  -- Fixed ids, so a leftover row from an interrupted run is recognised and
  -- cleared rather than colliding with a new one.
  c_co    CONSTANT uuid := '11111111-1111-1111-1111-111111111111';
  c_cl    CONSTANT uuid := '22222222-2222-2222-2222-222222222222';
  c_itin1 CONSTANT uuid := '33333333-3333-3333-3333-333333333333';
  c_day1  CONSTANT uuid := '44444444-4444-4444-4444-444444444444';
  c_itin2 CONSTANT uuid := '55555555-5555-5555-5555-555555555555';
  c_day2  CONSTANT uuid := '66666666-6666-6666-6666-666666666666';

  inv1 uuid;
  inv2 uuid;
  cn1  uuid;
  cn2  uuid;
  applied jsonb;

  hotel_item uuid;
  tour_item  uuid;

  -- Every check is one row in three parallel arrays: what was measured, what came
  -- back, what it should have been. Held by index instead of asserted inline so
  -- the failure list can be printed in full rather than stopping at the first
  -- problem.
  names  text[] := '{}';
  gots   text[] := '{}';
  wants  text[] := '{}';
  failed text[] := '{}';

  i    integer;
  msg  text;
  n_pass integer := 0;
  tbl   text;
  r     record;
BEGIN
  ---------------------------------------------------------------------------
  -- Clear anything a previous interrupted run left behind for these ids.
  -- Without this a second run collides on the primary keys and reports a
  -- duplicate-key error, which says nothing about the wallet.
  ---------------------------------------------------------------------------
  FOREACH tbl IN ARRAY ARRAY[
    'invoice_receipts','invoice_line_items','credit_notes','journal_entries',
    'client_credit_ledger','invoices','itinerary_day_items','itinerary_days',
    'itineraries','invoice_ref_counters','credit_note_ref_counters',
    'receipt_ref_counters']
  LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('DELETE FROM public.%I WHERE company_id = $1', tbl) USING c_co;
    END IF;
  END LOOP;
  DELETE FROM public.clients   WHERE id = c_cl;
  DELETE FROM public.companies WHERE id = c_co;

  ---------------------------------------------------------------------------
  -- Fixture: a company, a client, and a confirmed booking with two services
  -- worth 10,000. Two items rather than one so a credit can name exactly one of
  -- them, which is the whole point of itemising.
  ---------------------------------------------------------------------------
  INSERT INTO companies (id, name) VALUES (c_co, 'WALLET TEST CO');

  -- One name column, and email is nullable.
  INSERT INTO clients (id, company_id, name, email)
    VALUES (c_cl, c_co, 'Wendy Wallet', 'wendy@test.local');

  INSERT INTO itineraries
    (id, company_id, client_id, itinerary_name, currency_code, num_adults, status)
    VALUES (c_itin1, c_co, c_cl, 'Wallet Test Trip', 'ZAR', 2, 'confirmed');

  INSERT INTO itinerary_days (id, itinerary_id, company_id, day_number, day_date)
    VALUES (c_day1, c_itin1, c_co, 1, '2026-05-01');

  -- Hotel 6,000 and Tour 4,000. total_sell is what the server-side trip value
  -- guard reads, so these two numbers have to add up to the invoice total.
  INSERT INTO itinerary_day_items
    (itinerary_day_id, company_id, item_name, currency_code, total_sell, is_included, quantity, pax)
  VALUES
    (c_day1, c_co, 'Hotel', 'ZAR', 6000, true, 1, 1),
    (c_day1, c_co, 'Tour',  'ZAR', 4000, true, 1, 1);

  -- Read back by name rather than with RETURNING. A two row INSERT ... RETURNING
  -- id, item_name INTO hotel_item, tour_item asks for one row per variable and
  -- fails with "query returned more than one row", because RETURNING produces two
  -- rows and not a pair of columns.
  SELECT id INTO hotel_item
    FROM itinerary_day_items WHERE company_id = c_co AND item_name = 'Hotel'
    ORDER BY id LIMIT 1;
  SELECT id INTO tour_item
    FROM itinerary_day_items WHERE company_id = c_co AND item_name = 'Tour'
    ORDER BY id LIMIT 1;

  ---------------------------------------------------------------------------
  -- Bill the booking in full, then pay it in full. Paying it first is what makes
  -- the first case meaningful: the credit lands on an already settled invoice.
  --
  -- The receipt number is a literal rather than one drawn from the counter, so
  -- the test does not depend on a counter having been seeded for this company.
  ---------------------------------------------------------------------------
  inv1 := (public.issue_booking_invoice(
    c_co, c_itin1, 'ZAR', 10000,
    jsonb_build_object(
      'client_id', c_cl,
      'invoice_type', 'invoice', 'status', 'validated',
      'subtotal_excl', 10000, 'tax_total', 0, 'total_incl', 10000,
      'tax_label', 'VAT', 'tax_rate', 0, 'balance_due', 10000,
      'issued_date', '2026-05-02', 'due_date', '2026-05-16',
      'bill_to_name', 'Wendy Wallet', 'bill_to_email', 'wendy@test.local'),
    '[]'::jsonb
  )->>'id')::uuid;

  INSERT INTO invoice_receipts
    (company_id, invoice_id, receipt_number, invoice_number, currency_code,
     amount, direction, received_date, payment_method)
    VALUES (c_co, inv1, 'WALLET-TEST-RCT-1', 'INV-TEST', 'ZAR',
            10000, 'in', '2026-05-03', 'card');

  ---------------------------------------------------------------------------
  -- 1. A credit note credits the WALLET and leaves the invoice alone.
  --    The Tour came off the itinerary, so the credit names that one item and is
  --    for 4,000. Expect: wallet 4,000; invoice still 10,000 paid and settled.
  ---------------------------------------------------------------------------
  cn1 := (public.issue_client_credit_note(
    c_co, inv1, 4000, 'Tour withdrawn by the client', 'keep',
    jsonb_build_array(jsonb_build_object(
      'day_number', 1, 'item_id', tour_item, 'quantity', 1,
      'unit_price', 4000, 'subtotal_excl', 4000, 'line_total', 4000, 'sort_order', 0))
  )->>'id')::uuid;

  names := array_append(names, 'wallet balance before it is spent');
  gots  := array_append(gots,  public.client_credit_balance(c_co, c_cl, 'ZAR')::text);
  wants := array_append(wants, '4000.00');

  ---------------------------------------------------------------------------
  -- 2. A second booking, 5,000. Credit is offered and applied to it.
  --    Expect: 4,000 taken off, wallet 0, second invoice still owes 1,000.
  ---------------------------------------------------------------------------
  INSERT INTO itineraries
    (id, company_id, client_id, itinerary_name, currency_code, num_adults, status)
    VALUES (c_itin2, c_co, c_cl, 'Second Trip', 'ZAR', 2, 'confirmed');

  INSERT INTO itinerary_days (id, itinerary_id, company_id, day_number, day_date)
    VALUES (c_day2, c_itin2, c_co, 1, '2026-07-01');

  INSERT INTO itinerary_day_items
    (itinerary_day_id, company_id, item_name, currency_code, total_sell, is_included, quantity, pax)
    VALUES (c_day2, c_co, 'Lodge', 'ZAR', 5000, true, 1, 1);

  inv2 := (public.issue_booking_invoice(
    c_co, c_itin2, 'ZAR', 5000,
    jsonb_build_object(
      'client_id', c_cl,
      'invoice_type', 'invoice', 'status', 'validated',
      'subtotal_excl', 5000, 'tax_total', 0, 'total_incl', 5000,
      'tax_label', 'VAT', 'tax_rate', 0, 'balance_due', 5000,
      'issued_date', '2026-07-02', 'due_date', '2026-07-16',
      'bill_to_name', 'Wendy Wallet', 'bill_to_email', 'wendy@test.local'),
    '[]'::jsonb
  )->>'id')::uuid;

  applied := public.apply_client_credit(c_co, inv2, NULL, TRUE);

  ---------------------------------------------------------------------------
  -- 3. A third credit, this time paid out in cash rather than kept.
  --    Expect: 1,000 paid out, wallet back to 0, and the invoice it was raised
  --    against still settled. A payout is not a clawback of the original payment.
  ---------------------------------------------------------------------------
  cn2 := (public.issue_client_credit_note(
    c_co, inv1, 1000, 'Lodge downgraded', 'refund',
    jsonb_build_array(jsonb_build_object(
      'day_number', 1, 'item_id', hotel_item, 'quantity', 1,
      'unit_price', 1000, 'subtotal_excl', 1000, 'line_total', 1000, 'sort_order', 0))
  )->>'id')::uuid;

  -- Measured results, in the order they are explained above.
  names := array_append(names, 'wallet balance (expect 0.00)');
  gots  := array_append(gots,  public.client_credit_balance(c_co, c_cl, 'ZAR')::text);
  wants := array_append(wants, '0.00');

  names := array_append(names, 'credit note total (expect 4000.00)');
  gots  := array_append(gots,  (SELECT total_incl::text FROM credit_notes WHERE id = cn1));
  wants := array_append(wants, '4000.00');

  names := array_append(names, 'credit note net + tax = total (expect true)');
  gots  := array_append(gots,  (SELECT (subtotal_excl + tax_total = total_incl)::text
                                 FROM credit_notes WHERE id = cn1));
  wants := array_append(wants, 'true');

  names := array_append(names, 'credit note is itemised (expect 1)');
  gots  := array_append(gots,  (SELECT count(*)::text FROM invoice_line_items
                                 WHERE credit_note_id = cn1));
  wants := array_append(wants, '1');

  names := array_append(names, 'credit line tied to the library item (expect Tour)');
  gots  := array_append(gots,  (SELECT item_name FROM invoice_line_items WHERE credit_note_id = cn1));
  wants := array_append(wants, 'Tour');

  -- Wallet movements are deliberately excluded from the settled figure: they are
  -- the wallet spending itself, not cash paid against the invoice.
  names := array_append(names, 'still settled: invoice 1 balance after credit (expect 0.00)');
  gots  := array_append(gots,  (SELECT GREATEST(i.total_incl - COALESCE((
                   SELECT SUM(CASE WHEN direction = 'out' THEN -amount ELSE amount END)
                     FROM invoice_receipts
                    WHERE invoice_id = inv1 AND direction <> 'wallet_out'), 0), 0)::text
                   FROM invoices i WHERE i.id = inv1));
  wants := array_append(wants, '0.00');

  names := array_append(names, 'credit applied to invoice 2 (expect 4000.00)');
  gots  := array_append(gots,  (applied->>'applied')::text);
  wants := array_append(wants, '4000.00');

  names := array_append(names, 'invoice 2 balance after credit (expect 1000.00)');
  gots  := array_append(gots,  (SELECT GREATEST(i.total_incl - COALESCE((
                   SELECT SUM(CASE WHEN direction = 'out' THEN -amount ELSE amount END)
                     FROM invoice_receipts
                    WHERE invoice_id = inv2 AND direction <> 'wallet_out'), 0), 0)::text
                   FROM invoices i WHERE i.id = inv2));
  wants := array_append(wants, '1000.00');

  names := array_append(names, 'invoice 2 status, 1000 short (expect validated)');
  gots  := array_append(gots,  (SELECT status FROM invoices WHERE id = inv2));
  wants := array_append(wants, 'validated');

  names := array_append(names, 'payout recorded as wallet_out (expect 1)');
  gots  := array_append(gots,  (SELECT count(*)::text FROM invoice_receipts
                                 WHERE direction = 'wallet_out' AND invoice_id = inv1));
  wants := array_append(wants, '1');

  names := array_append(names, 'ledger movements: credit, debit, credit, debit (expect 4)');
  gots  := array_append(gots,  (SELECT count(*)::text FROM client_credit_ledger
                                 WHERE client_id = c_cl));
  wants := array_append(wants, '4');

  names := array_append(names, 'ledger balances to zero (expect true)');
  gots  := array_append(gots,  (SELECT (COALESCE(SUM(CASE WHEN direction = 'credit'
                                                        THEN amount ELSE -amount END), 0) = 0)::text
                                 FROM client_credit_ledger WHERE client_id = c_cl));
  wants := array_append(wants, 'true');

  names := array_append(names, 'wallet never negative at any point (expect true)');
  gots  := array_append(gots,  (SELECT (MIN(running) >= 0)::text FROM (
                      SELECT SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END)
                               OVER (ORDER BY seq) AS running
                        FROM client_credit_ledger WHERE client_id = c_cl) AS steps));
  wants := array_append(wants, 'true');

  ---------------------------------------------------------------------------
  -- Six cases that must be REFUSED.
  --
  -- Each call is built as text and run in one loop. A helper routine would be
  -- tidier, but PL/pgSQL does not allow a nested PROCEDURE or FUNCTION inside a
  -- DO block at all, so a loop over VALUES is the portable way to do it here.
  --
  -- Comparing the message, not merely checking that something failed, is the
  -- point. A loose match lets a guard firing for the wrong reason read as a
  -- pass, which is exactly how the duplicate-line and malformed-id guards came to
  -- exist without ever firing.
  ---------------------------------------------------------------------------
  FOR r IN
    SELECT * FROM (VALUES
      ('refused: no lines',
       'A credit note must list the itinerary services it is for',
       format('SELECT public.issue_client_credit_note(%L::uuid, %L::uuid, 500, %L, %L, %L::jsonb)',
              c_co, inv1, 'Admin', 'keep', '[]')),

      -- Lines that do not add up to the credited amount.
      ('refused: lines do not sum',
       'The credit note lines do not add up to the credit amount',
       format('SELECT public.issue_client_credit_note(%L::uuid, %L::uuid, 500, %L, %L, %L::jsonb)',
              c_co, inv1, 'Admin', 'keep',
              jsonb_build_array(jsonb_build_object(
                'item_id', hotel_item, 'quantity', 1, 'line_total', 100))::text)),

      -- The same itinerary service on two lines. Each line is real and the pair
      -- adds up, so every other check passes while the credit is really for one
      -- service counted twice.
      ('refused: duplicate service',
       'A credit note cannot credit the same itinerary service twice',
       format('SELECT public.issue_client_credit_note(%L::uuid, %L::uuid, 1200, %L, %L, %L::jsonb)',
              c_co, inv1, 'Admin', 'keep',
              jsonb_build_array(
                jsonb_build_object('item_id', hotel_item, 'quantity', 1,
                                   'line_total', 600, 'sort_order', 0),
                jsonb_build_object('item_id', hotel_item, 'quantity', 1,
                                   'line_total', 600, 'sort_order', 1))::text)),

      -- A service reference that is not a UUID at all. Without a shape check
      -- this surfaces as "invalid input syntax for type uuid", which tells the
      -- caller nothing about what to fix.
      ('refused: malformed service id',
       'A credit note line has an invalid service reference',
       format('SELECT public.issue_client_credit_note(%L::uuid, %L::uuid, 500, %L, %L, %L::jsonb)',
              c_co, inv1, 'Admin', 'keep',
              jsonb_build_array(jsonb_build_object(
                'item_id', 'not-a-uuid', 'quantity', 1, 'line_total', 500))::text)),

      -- A service that is not on this booking at all.
      ('refused: service not on this trip',
       'A credit note line is not a service on this itinerary',
       format('SELECT public.issue_client_credit_note(%L::uuid, %L::uuid, 500, %L, %L, %L::jsonb)',
              c_co, inv1, 'Admin', 'keep',
              jsonb_build_array(jsonb_build_object(
                'item_id', '99999999-9999-9999-9999-999999999999',
                'quantity', 1, 'line_total', 500))::text)),

      -- Far more than any invoice still owes. The wallet was paid out to zero
      -- above, so the ceiling that bites first is the invoice's own outstanding
      -- balance. Asserting the message it actually gets means a change in which
      -- guard fires first shows up as a failure to look at, rather than being
      -- papered over.
      ('refused: overspend',
       'That is more than is still owed on this invoice',
       format('SELECT public.apply_client_credit(%L::uuid, %L::uuid, 999999, TRUE)',
              c_co, inv2))
    ) AS v(case_name, want_msg, call_it)
  LOOP
    BEGIN
      EXECUTE r.call_it;
      msg := 'NOT REFUSED';
    EXCEPTION WHEN OTHERS THEN
      msg := SQLERRM;
    END;
    names := array_append(names, r.case_name);
    gots  := array_append(gots,  msg);
    wants := array_append(wants, r.want_msg);
  END LOOP;

  ---------------------------------------------------------------------------
  -- Score it.
  ---------------------------------------------------------------------------
  FOR i IN 1 .. coalesce(array_length(names, 1), 0) LOOP
    IF gots[i] IS DISTINCT FROM wants[i] THEN
      failed := array_append(failed, format('%s: expected %s, got %s',
                             names[i], coalesce(wants[i], '<null>'), coalesce(gots[i], '<null>')));
    ELSE
      n_pass := n_pass + 1;
      RAISE NOTICE 'ok  % = %', rpad(names[i], 52), gots[i];
    END IF;
  END LOOP;

  -- The ledger itself, so the movements are readable rather than only counted.
  -- Ordered by seq, not created_at: everything here happens in one transaction,
  -- so now() is identical on every row and created_at ordering is arbitrary.
  FOR msg IN
    SELECT format('    %-6s %-12s %10s  %s', direction, reason, amount, coalesce(note, ''))
      FROM client_credit_ledger WHERE client_id = c_cl ORDER BY seq
  LOOP
    RAISE NOTICE '%', msg;
  END LOOP;

  IF coalesce(array_length(failed, 1), 0) > 0 THEN
    -- Raising here rolls the whole block back, because the block is one
    -- transaction. A failing run therefore leaves nothing behind.
    RAISE EXCEPTION E'credit wallet test FAILED: % of % check(s) failed\n  %',
      array_length(failed, 1), array_length(names, 1), array_to_string(failed, E'\n  ');
  END IF;

  ---------------------------------------------------------------------------
  -- Every check passed. Remove the fixtures so a run leaves the database exactly
  -- as it found it.
  ---------------------------------------------------------------------------
  FOREACH tbl IN ARRAY ARRAY[
    'invoice_receipts','invoice_line_items','credit_notes','journal_entries',
    'client_credit_ledger','invoices','itinerary_day_items','itinerary_days',
    'itineraries','invoice_ref_counters','credit_note_ref_counters',
    'receipt_ref_counters']
  LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('DELETE FROM public.%I WHERE company_id = $1', tbl) USING c_co;
    END IF;
  END LOOP;
  DELETE FROM public.clients   WHERE id = c_cl;
  DELETE FROM public.companies WHERE id = c_co;

  RAISE NOTICE E'\ncredit wallet: % passed, 0 failed, fixtures removed', n_pass;
END
$test$;
