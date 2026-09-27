-- ─── Backfill: post pre-migration invoices and receipts into the journal ─────
-- The journal was introduced after these documents were issued, so the ledger
-- was missing them entirely. This walks the unposted documents and posts what
-- is missing, under the SAME rules the app now uses, so the ledger and the app
-- can never disagree about what was recognised.
--
-- Two things make this safe to run against a live ledger:
--
--   1. It is idempotent. Every document is checked against the source index on
--      (company_id, source_type, source_id, currency_code) before anything is
--      written, so re-running posts nothing twice.
--   2. It defaults to a dry run. p_dry_run defaults to TRUE, so the only way
--      to write anything is to ask for it explicitly. Read the returned rows
--      first, then re-run with p_dry_run = FALSE.
--
-- The deposit/final split is the substance of the fix. Both documents of one
-- booking carry the same total_incl, because the final records what the
-- deposit covered in credited_amount rather than re-stating a lower total.
-- Posting each for its full total_incl therefore recognises the same sale
-- twice, which is precisely the defect the posting rule in financeJournal.js
-- was corrected for. So:
--
--     deposit invoice  ->  deposit_amount
--     final invoice    ->  total_incl - credited_amount
--
-- which sums to total_incl exactly once per booking.
--
-- ─── Run the real thing only after the duplicates are cleared ──────────────
-- This posts what it finds, and it has no way to know that one document is an
-- accidental duplicate of another on the same booking. If a duplicate invoice
-- is still standing when the backfill runs, the duplicate is faithfully
-- recognised too, and the overstatement is now in the ledger rather than just
-- in the invoice list. Void the duplicate first — the void raises a credit
-- note and the app's reversal mirrors the original entry, so the ledger ends up
-- right. Then run this.
--
-- Related: voiding an invoice reverses the invoice but not the cash taken
-- against it. A receipt posted against a document that is later voided leaves
-- the receipt standing, which is correct — the money really was received — but
-- it means the booking shows a credit balance that is a real refund or
-- client-credit decision, not a ledger fault.

-- ─── Chart of accounts ──────────────────────────────────────────────────────
-- The app seeds these on first use of the Finance module, but a backfill may
-- run for a company that has not opened it yet, so seed here too. Codes match
-- CHART_OF_ACCOUNTS in src/lib/financeJournal.js exactly, because these codes
-- are what the accounting exports emit.
CREATE OR REPLACE FUNCTION public.finance_backfill_accounts(p_company_id UUID)
RETURNS INTEGER AS $$
DECLARE
  n INTEGER := 0;
BEGIN
  INSERT INTO public.finance_accounts
    (company_id, code, name, account_type, normal_balance, sort_order)
  SELECT p_company_id, v.code, v.name, v.account_type, v.normal_balance, v.sort_order
  FROM (VALUES
    ('AR',       'Accounts Receivable', 'receivable',     'debit',  100),
    ('AP',       'Accounts Payable',    'payable',        'credit', 200),
    ('SALES',    'Sales',               'revenue',        'credit', 300),
    ('COS',      'Cost of Sales',       'expense',        'debit',  400),
    ('VAT',      'VAT Payable',         'liability',      'credit', 500),
    ('VATIN',    'VAT Input',           'asset',          'debit',  600),
    ('BANK',     'Bank / Cash',         'cash',           'debit',  700),
    ('DISCOUNT', 'Discounts Allowed',   'contra_revenue', 'debit',  800)
  ) AS v(code, name, account_type, normal_balance, sort_order)
  ON CONFLICT (company_id, code) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.finance_backfill_accounts(UUID) IS
  'Seeds the standard chart of accounts for a company. Inserts only what is absent.';

-- ─── The backfill ───────────────────────────────────────────────────────────
-- Posts every non-void invoice and every receipt that has no journal entry.
-- Returns one row per document considered, saying what happened to it.
CREATE OR REPLACE FUNCTION public.finance_backfill(
  p_company_id UUID    DEFAULT NULL,
  p_dry_run    BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  out_kind     TEXT,     -- invoice | receipt
  out_reference TEXT,    -- INV-000123 | RCT-000007
  out_action   TEXT,     -- posted | skipped
  out_amount   NUMERIC,  -- amount recognised, in the document's own currency
  out_note     TEXT      -- why it was skipped, or the net/tax split
)
LANGUAGE plpgsql AS $$
DECLARE
  r       RECORD;   -- the document being considered
  l       RECORD;   -- one intended journal line
  co      RECORD;   -- one company
  v_entry UUID;
  v_gross NUMERIC;
  v_total NUMERIC;
  v_net   NUMERIC;
  v_tax   NUMERIC;
  v_ratio NUMERIC;
  v_ord   INTEGER;
BEGIN
  -- Accounts first, so the line inserts below always resolve.
  FOR co IN
    SELECT c.id FROM public.companies c
     WHERE p_company_id IS NULL OR c.id = p_company_id
  LOOP
    PERFORM public.finance_backfill_accounts(co.id);
  END LOOP;

  -- ── Invoices ──────────────────────────────────────────────────────────────
  FOR r IN
    SELECT i.*
      FROM public.invoices i
     WHERE (p_company_id IS NULL OR i.company_id = p_company_id)
       AND i.status IS DISTINCT FROM 'void'
       AND NOT EXISTS (
         SELECT 1 FROM public.journal_entries e
          WHERE e.company_id = i.company_id
            AND e.source_type = 'invoice'
            AND e.source_id = i.id
            AND e.currency_code = COALESCE(i.currency_code, 'ZAR'))
  LOOP
    v_total := round(COALESCE(r.total_incl, 0)::numeric, 2);

    IF r.invoice_type = 'deposit' THEN
      v_gross := LEAST(round(COALESCE(r.deposit_amount, 0)::numeric, 2), v_total);
      -- A deposit document with no deposit recorded is treated as billing the
      -- booking in full, matching invoicePostingAmount in financeJournal.js.
      IF v_gross <= 0 THEN v_gross := v_total; END IF;
    ELSE
      v_gross := round(v_total - COALESCE(r.credited_amount, 0)::numeric, 2);
    END IF;
    v_gross := GREATEST(v_gross, 0);

    IF v_gross <= 0 THEN
      out_kind := 'invoice'; out_reference := r.invoice_number;
      out_action := 'skipped'; out_amount := 0;
      out_note := 'nothing left to recognise (fully credited, or nil)';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Net and tax are taken in proportion to what is being posted, with tax as
    -- the balancing figure so the entry can never fail to balance. Because
    -- v_tax is defined as the remainder, net + tax is exactly v_gross by
    -- construction rather than by rounding luck.
    v_ratio := CASE WHEN v_total > 0 THEN v_gross / v_total ELSE 0 END;
    v_net   := round(COALESCE(r.subtotal_excl, 0)::numeric * v_ratio, 2);
    v_tax   := round(v_gross - v_net, 2);

    IF NOT p_dry_run THEN
      INSERT INTO public.journal_entries
        (company_id, entry_date, reference, source_type, source_id, narration,
         itinerary_id, client_id, currency_code, total_debit, total_credit, is_posted)
      VALUES
        (r.company_id, COALESCE(r.issued_date, CURRENT_DATE), r.invoice_number,
         'invoice', r.id,
         (CASE WHEN r.invoice_type = 'deposit'
               THEN 'Deposit invoice ' ELSE 'Sales invoice ' END)
           || r.invoice_number || ' — ' || COALESCE(r.bill_to_name, ''),
         r.itinerary_id, r.client_id, COALESCE(r.currency_code, 'ZAR'),
         v_gross, v_gross, TRUE)
      RETURNING id INTO v_entry;
    END IF;

    v_ord := 0;
    FOR l IN
      -- One row per intended line. A zero line is dropped, because the table
      -- forbids a zero amount and one is only ever a rounding artefact.
      SELECT 'AR' AS code, 'debit' AS lt, v_gross AS amt,
             'Amount receivable — ' || r.invoice_number AS descr
      UNION ALL
      SELECT 'SALES', 'credit', v_net, 'Net sale — ' || r.invoice_number
      UNION ALL
      SELECT 'VAT', 'credit', v_tax,
             COALESCE(NULLIF(r.tax_label, ''), 'Tax') || ' — ' || r.invoice_number
    LOOP
      CONTINUE WHEN l.amt IS NULL OR l.amt <= 0;
      IF NOT p_dry_run THEN
        INSERT INTO public.journal_lines
          (company_id, entry_id, account_id, account_code, account_name, account_type,
           line_type, amount, description, itinerary_id, sort_order)
        SELECT v_entry, a.id, a.code, a.name, a.account_type,
               l.lt, l.amt, l.descr, r.itinerary_id, v_ord
          FROM public.finance_accounts a
         WHERE a.company_id = r.company_id AND a.code = l.code;
      END IF;
      v_ord := v_ord + 1;
    END LOOP;

    out_kind := 'invoice'; out_reference := r.invoice_number;
    out_action := CASE WHEN p_dry_run THEN 'would post' ELSE 'posted' END;
    out_amount := v_gross;
    out_note := 'net ' || v_net || ' + tax ' || v_tax;
    RETURN NEXT;
  END LOOP;

  -- ── Receipts ──────────────────────────────────────────────────────────────
  -- A receipt row links to its invoice but carries no itinerary or client of
  -- its own, so both are taken from the invoice it settles. Without that the
  -- cash cannot be attributed to the booking in the per-itinerary view.
  --
  -- Note there is no `invoice is void` filter here, and that is deliberate. Cash
  -- that was genuinely received is posted even when the invoice it settled has
  -- since been withdrawn, which leaves the booking showing a credit balance.
  -- That balance is a real refund or client-credit decision for a human to make,
  -- not a posting error to be netted away here.
  FOR r IN
    SELECT rc.*, i.itinerary_id AS inv_itinerary_id, i.client_id AS inv_client_id
      FROM public.invoice_receipts rc
      LEFT JOIN public.invoices i ON i.id = rc.invoice_id
     WHERE (p_company_id IS NULL OR rc.company_id = p_company_id)
       AND NOT EXISTS (
         SELECT 1 FROM public.journal_entries e
          WHERE e.company_id = rc.company_id
            AND e.source_type = 'receipt'
            AND e.source_id = rc.id
            AND e.currency_code = COALESCE(rc.currency_code, 'ZAR'))
  LOOP
    v_gross := round(COALESCE(r.amount, 0)::numeric, 2);

    IF v_gross <= 0 THEN
      out_kind := 'receipt'; out_reference := r.receipt_number;
      out_action := 'skipped'; out_amount := 0;
      out_note := 'nil amount';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF NOT p_dry_run THEN
      INSERT INTO public.journal_entries
        (company_id, entry_date, reference, source_type, source_id, narration,
         itinerary_id, client_id, currency_code, total_debit, total_credit, is_posted)
      VALUES
        (r.company_id, COALESCE(r.received_date, CURRENT_DATE), r.receipt_number,
         'receipt', r.id,
         'Receipt ' || r.receipt_number || ' — ' || COALESCE(r.bill_to_name, ''),
         r.inv_itinerary_id, r.inv_client_id, COALESCE(r.currency_code, 'ZAR'),
         v_gross, v_gross, TRUE)
      RETURNING id INTO v_entry;
    END IF;

    v_ord := 0;
    FOR l IN
      SELECT 'BANK' AS code, 'debit' AS lt, v_gross AS amt,
             'Payment received' AS descr
      UNION ALL
      SELECT 'AR', 'credit', v_gross,
             'Applied to ' || COALESCE(NULLIF(r.invoice_number, ''), 'invoice')
    LOOP
      IF NOT p_dry_run THEN
        INSERT INTO public.journal_lines
          (company_id, entry_id, account_id, account_code, account_name, account_type,
           line_type, amount, description, itinerary_id, sort_order)
        SELECT v_entry, a.id, a.code, a.name, a.account_type,
               l.lt, l.amt, l.descr, r.inv_itinerary_id, v_ord
          FROM public.finance_accounts a
         WHERE a.company_id = r.company_id AND a.code = l.code;
      END IF;
      v_ord := v_ord + 1;
    END LOOP;

    out_kind := 'receipt'; out_reference := r.receipt_number;
    out_action := CASE WHEN p_dry_run THEN 'would post' ELSE 'posted' END;
    out_amount := v_gross;
    out_note := 'bank in, receivable out';
    RETURN NEXT;
  END LOOP;

  RETURN;
END $$;

COMMENT ON FUNCTION public.finance_backfill(UUID, BOOLEAN) IS
  'Posts unposted invoices and receipts into the journal. p_dry_run defaults to TRUE; pass FALSE to write. Idempotent.';
