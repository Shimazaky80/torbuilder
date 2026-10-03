-- Flatten the deposit/final invoice pair into ordinary invoices.
--
-- WHY
-- Booking used to be billed as two documents that each carried the same
-- total_incl: a deposit recording the opening percentage, and a final
-- recording in credited_amount how much of the trip the deposit had already
-- covered. The pair only added up because the posting rule in
-- financeJournal.js split the final's total by that credit.
--
--     deposit invoice  ->  deposit_amount
--     final invoice    ->  total_incl - credited_amount
--
-- which sums to total_incl exactly once per booking. 20261104 posted the
-- verified ledger on that basis, and that ledger is correct and must not be
-- re-posted.
--
-- Now an invoice bills what it says it bills, so that split no longer exists
-- and each document has to stand on its own. This migration restates each
-- invoice header to the amount its journal entry ALREADY posted, so header
-- and ledger agree and no re-posting is needed.
--
-- WHAT IT DOES
--   1. Restate total_incl / subtotal_excl / tax_total to the posted amount, for
--      documents that actually stand.
--   2. Set balance_due to that amount for anything not already settled.
--   3. Scale invoice_line_items onto the same amount, so a document's own
--      itemisation still adds up to its total.
--   4. Collapse invoice_type to 'invoice' and retire the pair's columns.
--   5. Give credited_amount its new meaning: the credit actually raised against
--      that invoice, rather than the deposit's share of the pair.
--
-- Voided documents are historical records paired with the credit note that
-- reverses them. They posted nothing, so their figures are left untouched and
-- only the type changes.
--
-- Arithmetically identical to 20261104's posting rule, so restated totals
-- reconcile against the live journal to the cent.

BEGIN;

-- ── 1 + 2. Restate the headers to what the journal already posted ───────────
--
-- Pro-rata, with tax as the balancing figure, exactly as the backfill did it:
--   ratio = gross / total
--   net   = round(subtotal_excl * ratio, 2)
--   tax   = round(gross - net, 2)
-- so net + tax reconstructs the receivable with no rounding stranded.

DO $$
DECLARE
  r          record;
  v_total    numeric;
  v_gross    numeric;
  v_ratio    numeric;
  v_net      numeric;
  v_tax      numeric;
  v_settled  boolean;
BEGIN
  FOR r IN
    SELECT id, total_incl, subtotal_excl, invoice_type, deposit_amount,
           credited_amount, status
    FROM   invoices
    WHERE  invoice_type IN ('deposit', 'final')
  LOOP
    v_total := round(COALESCE(r.total_incl, 0)::numeric, 2);

    /* A voided document posted nothing and is kept only as history, together
       with the credit note that reverses it. Restating its figures would invent
       an amount that was never receivable, so it is left exactly as it stands
       and only retyped below. */
    IF COALESCE(r.status, '') = 'void' THEN
      UPDATE invoices SET invoice_type = 'invoice' WHERE id = r.id;
      CONTINUE;
    END IF;

    IF r.invoice_type = 'deposit' THEN
      v_gross := LEAST(round(COALESCE(r.deposit_amount, 0)::numeric, 2), v_total);
      IF v_gross <= 0 THEN
        v_gross := v_total;
      END IF;
    ELSE
      v_gross := round(v_total - COALESCE(r.credited_amount, 0)::numeric, 2);
    END IF;
    v_gross := GREATEST(v_gross, 0);

    v_ratio := CASE WHEN v_total > 0 THEN v_gross / v_total ELSE 0 END;
    v_net   := round(COALESCE(r.subtotal_excl, 0)::numeric * v_ratio, 2);
    v_tax   := round(v_gross - v_net, 2);

    /* An open document still owes what it billed. A settled one owes nothing. */
    v_settled := COALESCE(r.status, '') = 'paid';

    UPDATE invoices
    SET    total_incl      = v_gross,
           subtotal_excl   = v_net,
           tax_total       = v_tax,
           balance_due     = CASE WHEN v_settled THEN 0 ELSE v_gross END,
           invoice_type    = 'invoice',
           deposit_amount  = 0,
           credited_amount = 0
    WHERE  id = r.id;

    RAISE NOTICE 'invoice % (%): % -> %', r.id, r.invoice_type, v_total, v_gross;
  END LOOP;
END $$;

-- ── 3. Scale the line items onto the restated total ────────────────────────
--
-- A document that billed part of the trip kept the whole trip's itemisation.
-- Proportional, with the drift pushed onto the largest line so the lines still
-- add up to the header exactly rather than a cent or two adrift.

DO $$
DECLARE
  r        record;
  v_total  numeric;
  v_sum    numeric;
  v_factor numeric;
  v_drift  numeric;
  v_big    uuid;
  v_net    numeric;
  v_lt     numeric;
  v_tax    numeric;
  v_up     numeric;
  v_big_subtotal numeric;
  v_big_line    numeric;
  v_big_unit    numeric;
BEGIN
  FOR r IN
    SELECT i.id, i.total_incl
    FROM   invoices i
    WHERE  i.invoice_type = 'invoice'
  LOOP
    v_total := round(COALESCE(r.total_incl, 0)::numeric, 2);
    IF v_total <= 0 THEN
      CONTINUE;
    END IF;

    SELECT round(COALESCE(SUM(line_total), 0)::numeric, 2)
    INTO   v_sum
    FROM   invoice_line_items
    WHERE  invoice_id = r.id;

    /* No lines, or lines that already describe the amount: leave them be. */
    IF v_sum <= 0 OR round(v_sum, 2) = v_total THEN
      CONTINUE;
    END IF;

    v_factor := v_total / v_sum;
    v_drift  := v_total - v_sum;

    -- Which line absorbs the rounding drift, and what it currently holds. The
    -- current values have to be read in, not referenced bare: inside this block
    -- there is no table in scope to resolve a column name against.
    SELECT id, subtotal_excl, line_total, unit_price
    INTO   v_big, v_big_subtotal, v_big_line, v_big_unit
    FROM   invoice_line_items
    WHERE  invoice_id = r.id
    ORDER  BY line_total DESC, created_at
    LIMIT  1;

    UPDATE invoice_line_items
    SET    unit_price   = round(unit_price   * v_factor, 2),
           subtotal_excl = round(subtotal_excl * v_factor, 2),
           tax_amount   = round(line_total   * v_factor, 2)
                            - round(subtotal_excl * v_factor, 2),
           line_total   = round(line_total   * v_factor, 2)
    WHERE  invoice_id = r.id
      AND  id <> v_big;

    -- The absorbing line takes the residual, so the lines still add up to the
    -- header to the cent and its tax stays consistent with its own line_total.
    v_net := round(v_big_subtotal * v_factor, 2);
    v_lt  := round(v_big_line * v_factor, 2) + v_drift;
    v_tax := v_lt - v_net;
    v_up  := round(v_big_unit * v_factor, 2);

    UPDATE invoice_line_items
    SET    line_total    = v_lt,
           subtotal_excl = v_net,
           tax_amount    = v_tax,
           unit_price    = v_up
    WHERE  id = v_big;
  END LOOP;
END $$;

-- ── 4. Retype anything the loop above did not reach ────────────────────────
--
-- Includes documents created between the two loops, and any invoice whose type
-- was already 'invoice'. Idempotent: running twice changes nothing further.

UPDATE invoices
SET    invoice_type    = 'invoice'
WHERE  invoice_type NOT IN ('invoice');

-- ── 5. Restore credited_amount to what it now means ─────────────────────────
--
-- The old pair used credited_amount to mean "how much of the trip the deposit
-- already covered", which is why the loop above zeroed it: that reading is gone.
-- Under the flattened model it means "how much has been credited back against
-- this invoice", and the app depends on it to decide whether a document still
-- stands. Zeroing it without restoring the real figure would make a fully
-- credited invoice look unpaid and post a second time.
--
-- Credit notes that are themselves void are not credits, and a credit note
-- against a voided invoice is the reversal of that void rather than a reduction
-- of anything live.

UPDATE invoices i
SET    credited_amount = COALESCE(c.given, 0)
FROM  (
  SELECT i2.id, round(SUM(cn.total_incl), 2) AS given
  FROM   invoices i2
  JOIN   credit_notes cn ON cn.invoice_id = i2.id
  WHERE  cn.status <> 'void'
    AND  i2.status <> 'void'
  GROUP  BY i2.id
) c
WHERE  i.id = c.id
  AND  i.credited_amount IS DISTINCT FROM c.given;

-- ── Verification ───────────────────────────────────────────────────────────
--
-- The journal is untouched by this migration, so every posted invoice must
-- still match the AR debit its own entry carries. This RAISES and rolls the
-- whole migration back if any one of them disagrees.

DO $$
DECLARE
  v_bad integer;
  v_detail text;
BEGIN
  SELECT count(*), string_agg(txt, E'\n')
  INTO   v_bad, v_detail
  FROM  (
    SELECT format('%s: header %s vs journal AR %s',
                  i.invoice_number,
                  i.total_incl,
                  j.ar) AS txt
    FROM   invoices i
    JOIN   (
      SELECT e.source_id, round(SUM(l.amount), 2) AS ar
      FROM   journal_entries e
      JOIN   journal_lines l ON l.entry_id = e.id
      WHERE  e.source_type = 'invoice'
        AND  l.account_code = 'AR'
        AND  l.line_type = 'debit'
      GROUP  BY e.source_id
    ) j ON j.source_id = i.id
    WHERE  round(i.total_incl, 2) <> j.ar
  ) mismatched;

  IF v_bad > 0 THEN
    RAISE EXCEPTION E'invoice headers no longer match the ledger:\n%', v_detail;
  END IF;

  RAISE NOTICE 'OK: every posted invoice reconciles to its journal AR debit';
END $$;

-- Line items must add up to the restated header, to the cent.
DO $$
DECLARE
  v_bad integer;
  v_detail text;
BEGIN
  SELECT count(*), string_agg(txt, E'\n')
  INTO   v_bad, v_detail
  FROM  (
    SELECT format('%s: lines %s vs total %s',
                  i.invoice_number,
                  round(SUM(l.line_total), 2),
                  i.total_incl) AS txt
    FROM   invoices i
    JOIN   invoice_line_items l ON l.invoice_id = i.id
    WHERE  i.total_incl > 0
    GROUP  BY i.id, i.invoice_number, i.total_incl
    HAVING round(SUM(l.line_total), 2) <> round(i.total_incl, 2)
  ) mismatched;

  IF v_bad > 0 THEN
    RAISE EXCEPTION E'invoice line items do not add up:\n%', v_detail;
  END IF;

  RAISE NOTICE 'OK: every invoice line itemisation adds up to its total';
END $$;

-- credited_amount must agree with the credit notes actually on file, or the app
-- will treat a fully credited invoice as still standing and post it again.
DO $$
DECLARE
  v_bad integer;
  v_detail text;
BEGIN
  SELECT count(*), string_agg(txt, E'\n')
  INTO   v_bad, v_detail
  FROM  (
    SELECT format('%s: credited_amount %s vs credit notes %s',
                  i.invoice_number,
                  i.credited_amount,
                  COALESCE(c.given, 0)) AS txt
    FROM   invoices i
    LEFT JOIN (
      SELECT cn.invoice_id, round(SUM(cn.total_incl), 2) AS given
      FROM   credit_notes cn
      WHERE  cn.status <> 'void'
      GROUP  BY cn.invoice_id
    ) c ON c.invoice_id = i.id
    WHERE  i.status <> 'void'
      AND  round(COALESCE(i.credited_amount, 0), 2)
           <> round(COALESCE(c.given, 0), 2)
  ) mismatched;

  IF v_bad > 0 THEN
    RAISE EXCEPTION E'credited_amount disagrees with the credit notes on file:\n%', v_detail;
  END IF;

  RAISE NOTICE 'OK: credited_amount matches the credit notes on file';
END $$;

-- A live invoice credited beyond its own total is unusual but not wrong: the app
-- treats it as fully credited and declines to post it again, which is the
-- behaviour we want. Reported rather than raised, so the operator can see it.
DO $$
DECLARE
  v_bad integer;
  v_detail text;
BEGIN
  SELECT count(*), string_agg(txt, E'\n')
  INTO   v_bad, v_detail
  FROM  (
    SELECT format('%s: total %s, credited %s',
                  i.invoice_number,
                  i.total_incl,
                  round(COALESCE(SUM(cn.total_incl), 0), 2)) AS txt
    FROM   invoices i
    LEFT JOIN credit_notes cn
           ON cn.invoice_id = i.id AND cn.status <> 'void'
    WHERE  i.status <> 'void'
    GROUP  BY i.id, i.invoice_number, i.total_incl
    HAVING round(COALESCE(SUM(cn.total_incl), 0), 2) > round(i.total_incl, 2)
  ) over_credited;

  IF v_bad > 0 THEN
    RAISE NOTICE 'NOTE: % live invoice(s) are credited beyond their own total and will not re-post: %',
      v_bad, v_detail;
  END IF;
END $$;

COMMIT;
