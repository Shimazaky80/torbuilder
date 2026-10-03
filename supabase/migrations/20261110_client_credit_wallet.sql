-- 20261110_client_credit_wallet.sql
--
-- CREDIT IS THE CLIENT'S, NOT THE INVOICE'S
--
-- A credit note used to mean one thing only: knock money off the invoice it
-- pointed at. That models the paperwork but not the reality. A client who has
-- had a service cancelled, or who overpaid, holds money. That money belongs to
-- the client, it does not expire with the invoice that produced it, and it can
-- be spent on a booking raised six months later.
--
-- So credit is now a per-client, per-currency wallet. A credit note credits the
-- wallet and remembers which invoice it came from for the audit trail. Spending
-- it draws the wallet down. Refunding it pays cash out and zeroes the wallet.
--
--     credit note   wallet +      client is owed money
--     applied to    wallet -      spent on a booking
--     an invoice
--     refund        wallet -      paid out in cash
--
-- Two things this deliberately does NOT do:
--
--   1. A credit note no longer reduces the balance of the invoice it points at.
--      If it did both, the same money could settle the old invoice and then be
--      spent again on a new one. The wallet is the single place credit lives;
--      the invoice keeps the link only as history.
--
--   2. Credit is never negative. A client cannot owe us a credit. If applying
--      credit would overdraw the wallet, the call is refused.
--
-- THE MONEY IS ALREADY ACCOUNTED FOR ELSEWHERE
--
-- A credit note reverses the sale (credit note: debit sales/VAT, credit AR), and
-- a refund moves the cash (debit AR, credit bank). Neither touches this wallet.
-- The wallet tracks entitlement, not money, so it posts no journal entry of its
-- own. Applying credit to an invoice is a settlement, not a sale, and is
-- recorded as a receipt row with direction 'apply' for the same reason.
--
-- PER CURRENCY, ALWAYS
--
-- Credit in ZAR cannot pay a USD invoice. Every balance, every cap and every
-- application is scoped to one currency, so this can never be got wrong by
-- arithmetic on mixed units.
--
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------
-- Booking attribution on receipts.
--
-- A receipt row links only to its invoice, so it carries no booking of its own.
-- That was survivable while receipts only ever settled the invoice in front of
-- you. It is not survivable now that credit can be spent on a *different*
-- booking: the per-itinerary journal view reads receipts through
-- itinerary_id, and a credit applied to a new booking would be invisible on the
-- booking that actually used it.
--
-- Backfilled from the invoice each receipt settles, which is the same source the
-- posting path already uses. Null-safe and idempotent, so rows that are already
-- attributed are never moved.
-- ---------------------------------------------------------------------------
ALTER TABLE public.invoice_receipts
  ADD COLUMN IF NOT EXISTS itinerary_id UUID REFERENCES public.itineraries(id) ON DELETE RESTRICT;

ALTER TABLE public.invoice_receipts
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL;

UPDATE public.invoice_receipts r
SET    itinerary_id = i.itinerary_id,
       client_id    = i.client_id
FROM   public.invoices i
WHERE  i.id = r.invoice_id
  AND  r.itinerary_id IS NULL
  AND  i.itinerary_id IS NOT NULL;

COMMENT ON COLUMN public.invoice_receipts.itinerary_id IS
  'The booking this receipt settled. Taken from the invoice. Needed because credit can be spent on a different booking than the one that produced it.';

-- ---------------------------------------------------------------------------
-- Direction.
--
-- A receipt row is one of four things:
--
--   'in'          a payment received in cash
--   'out'         cash refunded against this invoice, which reopens it
--   'apply'       settled from the client's credit wallet
--   'wallet_out'  credit paid out to the client from the wallet
--
-- The fourth is separate on purpose, and the distinction is the whole reason
-- the wallet works.
--
-- Say a 10,000 invoice is paid in full, then 3,000 of it is credited because a
-- tour was withdrawn. The credit note reverses 3,000 of the sale and the client
-- asks for that 3,000 back in cash. The invoice itself is still completely
-- settled -- it was billed once and paid once. If that payout were written as
-- 'out' it would look like 3,000 of the original payment had been handed back,
-- and the invoice would report 3,000 outstanding that the client does not owe.
--
-- The money is real and the document trail matters, so the row is still written
-- and still filed against the invoice. It is simply not an adjustment to this
-- invoice's balance. It posts to the same accounts as a refund -- debit
-- receivables, credit bank -- because the credit note already left the client's
-- credit sitting on receivables and paying it out clears that.
--
-- Existing rows are all money in, which is what they are, so the backfill is a
-- constant rather than a calculation.
-- ---------------------------------------------------------------------------
ALTER TABLE public.invoice_receipts
  ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'in';

ALTER TABLE public.invoice_receipts
  DROP CONSTRAINT IF EXISTS invoice_receipts_direction_check;

ALTER TABLE public.invoice_receipts
  ADD CONSTRAINT invoice_receipts_direction_check
  CHECK (direction IN ('in', 'out', 'apply', 'wallet_out')) NOT VALID;

ALTER TABLE public.invoice_receipts
  VALIDATE CONSTRAINT invoice_receipts_direction_check;

COMMENT ON COLUMN public.invoice_receipts.direction IS
  '''in'' for a payment received, ''out'' for cash refunded against the invoice, ''apply'' for a settlement drawn from the client''s credit wallet, ''wallet_out'' for credit paid out of the wallet. ''out'' and ''apply'' reduce what the invoice is owed. ''wallet_out'' is real cash that leaves but is not an adjustment to this invoice, because the credit note already reversed the sale -- counting it would make a settled invoice look unpaid.';

-- ---------------------------------------------------------------------------
-- Itemised credit notes.
--
-- A credit note used to exist only as a header: an amount and a reason, with no
-- record of which services it was for. That is not good enough, because a
-- credit has to be traceable to the itinerary items that caused it, and because
-- the next invoice for that booking diffs against what was billed, item by
-- item. Without itemised credit lines there is nothing to diff against.
--
-- `credit_note_id` marks a row as belonging to a credit note rather than to the
-- invoice. `invoice_id` stays populated on both, since a credit note only ever
-- exists against an invoice, and it is what makes the reversal findable.
--
-- `item_id` is the itinerary library item the line is for. Nullable, because a
-- credit can also be raised for a manual adjustment, but every line raised
-- against a service carries it -- which is what lets a later repricing see that
-- the item was already credited and not credit it twice.
-- ---------------------------------------------------------------------------
ALTER TABLE public.invoice_line_items
  ADD COLUMN IF NOT EXISTS credit_note_id UUID REFERENCES public.credit_notes(id) ON DELETE CASCADE;

ALTER TABLE public.invoice_line_items
  ADD COLUMN IF NOT EXISTS item_id UUID;

-- A credit note's lines are fetched by credit_note_id, and an invoice's own
-- lines are everything else. Without this, an invoice view would list its credit
-- note lines as though they were charges.
CREATE INDEX IF NOT EXISTS invoice_line_items_credit_note_idx
  ON public.invoice_line_items (credit_note_id)
  WHERE credit_note_id IS NOT NULL;

COMMENT ON COLUMN public.invoice_line_items.credit_note_id IS
  'Set when this line belongs to a credit note rather than to the invoice itself. NULL for the invoice''s own charge lines.';
COMMENT ON COLUMN public.invoice_line_items.item_id IS
  'The itinerary library item this line prices, where there is one. Lets a credit be traced to the service that caused it and stops the same item being credited twice.';

-- ---------------------------------------------------------------------------
-- More than one credit note per invoice.
--
-- 20260918 created credit_notes_invoice_idx as a UNIQUE index on invoice_id,
-- which caps a client at exactly one credit note per invoice, forever. That was
-- defensible when a credit note was the only way to reduce an invoice, because
-- there was never a reason for a second one.
--
-- There is now. A tour is withdrawn, and a fortnight later the hotel is
-- downgraded. Two separate events, two separate notes, each naming the service
-- that caused it and each crediting the wallet. Under the old index the second
-- is rejected with a unique violation on an index whose name says nothing about
-- what went wrong.
--
-- The number is what has to be unique, and that is already covered by
-- credit_notes_company_number_idx from 20260918. This index was never protecting
-- the number -- it was only ever stopping a second note. So it becomes a plain
-- lookup, and every lookup by invoice still works.
--
-- Done before the backfill below, so existing duplicates cannot make the
-- unique index fail to build.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.credit_notes_invoice_idx;

CREATE INDEX IF NOT EXISTS credit_notes_invoice_idx
  ON public.credit_notes (invoice_id);

COMMENT ON INDEX public.credit_notes_invoice_idx IS
  'Every credit note raised against one invoice, newest included. Not unique: a booking can be repriced more than once, and each change gets its own note against the wallet.';

-- ---------------------------------------------------------------------------
-- The wallet.
--
-- A ledger rather than a running balance column. A stored balance is one that
-- eventually disagrees with the documents that produced it, and the only way to
-- find out is to audit every row. A ledger can be summed at any time and the
-- answer is derived, so it cannot drift.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_credit_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  currency_code   TEXT NOT NULL,

  /* Always positive. `direction` carries the sign, so a sum is never ambiguous
     about what a negative row would have meant. */
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  direction       TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),

  /* Why the movement happened, in the words of the thing that caused it:
     'credit_note' for one raised, 'applied' for one spent on an invoice,
     'refund' for one paid out in cash. */
  reason          TEXT NOT NULL DEFAULT 'credit_note' CHECK (reason IN ('credit_note', 'applied', 'refund')),

  /* The document that caused the movement. Kept for the audit trail and so a
     movement can always be traced back; NULL for a manual adjustment. */
  source_type     TEXT,
  source_id       UUID,
  source_ref      TEXT NOT NULL DEFAULT '',

  /* The booking the credit came from, or was spent on. Kept so a statement can
     show where credit went without walking the whole ledger. */
  itinerary_id    UUID,

  note            TEXT NOT NULL DEFAULT '',

  /* A total order over movements, which created_at cannot provide.

     now() is the *transaction* timestamp, so every row written by one
     issue/apply/refund shares it exactly. Ordering the ledger by created_at
     therefore leaves all same-transaction rows tied, and any running balance
     or audit walk over them is arbitrary. Two movements written in the same
     transaction can come out in either order, and on a wallet the difference
     matters: a debit that lands before the credit it spends goes negative,
     and the statement shows it that way.

     This is a plain gap, so it is the thing to order by. */
  seq             BIGINT GENERATED ALWAYS AS IDENTITY,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- seq is declared in CREATE TABLE above, which covers a fresh install. It is
-- repeated here as an ALTER because the column list of CREATE TABLE IF NOT
-- EXISTS is skipped wholesale for a table that already exists, and this
-- migration has already been run in at least one database. Without this, anyone
-- who applied the earlier version gets a no-op re-run, no error, and a wallet
-- with no ordering column -- which looks like it worked.
--
-- Existing rows are backfilled from the sequence in insertion order, so the
-- audit trail of a wallet that is already live stays in the order it happened.
ALTER TABLE public.client_credit_ledger
  ADD COLUMN IF NOT EXISTS seq BIGINT GENERATED ALWAYS AS IDENTITY;

CREATE UNIQUE INDEX IF NOT EXISTS client_credit_ledger_seq_idx
  ON public.client_credit_ledger (seq);

COMMENT ON TABLE public.client_credit_ledger IS
  'Client credit wallet. A credit note credits it, spending it on an invoice or refunding it debits it. Balance is the sum, derived, so it cannot drift from the documents. Never negative: a client is never owed a negative credit.';

CREATE INDEX IF NOT EXISTS client_credit_ledger_balance_idx
  ON public.client_credit_ledger (company_id, client_id, currency_code);

-- The wallet is a ledger, so the same source document must not post twice. A
-- partial unique index because a manual adjustment has no source.
CREATE UNIQUE INDEX IF NOT EXISTS client_credit_ledger_source_unique
  ON public.client_credit_ledger (company_id, source_type, source_id, currency_code)
  WHERE source_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- The balance.
--
-- Credits less debits, clamped at zero. The clamp is not cosmetic: the ledger
-- is only ever written under a lock by the functions below, so a negative total
-- would mean the clamp is hiding a real bug rather than absorbing one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_credit_balance(
  p_company_id UUID,
  p_client_id  UUID,
  p_currency   TEXT
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT GREATEST(ROUND(COALESCE(SUM(
    CASE WHEN l.direction = 'credit' THEN l.amount ELSE -l.amount END
  ), 0)::NUMERIC, 2), 0)
  FROM public.client_credit_ledger l
  WHERE l.company_id = p_company_id
    AND l.client_id  = p_client_id
    AND UPPER(l.currency_code) = UPPER(p_currency);
$$;

COMMENT ON FUNCTION public.client_credit_balance(UUID, UUID, TEXT) IS
  'Credit the client is owed in one currency. Credits less debits, never negative. Derived from the ledger, so it cannot drift.';

-- Credit across every currency, for the UI that shows a client what they hold.
CREATE OR REPLACE FUNCTION public.client_credit_summary(p_company_id UUID, p_client_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'currency',     ccy,
             'balance',      bal,
             'has_credit',   bal > 0
           ) ORDER BY ccy
         ), '[]'::jsonb)
  FROM (
    SELECT UPPER(l.currency_code) AS ccy,
           ROUND(SUM(CASE WHEN l.direction = 'credit' THEN l.amount ELSE -l.amount END)::NUMERIC, 2) AS bal
    FROM public.client_credit_ledger l
    WHERE l.company_id = p_company_id
      AND l.client_id  = p_client_id
    GROUP BY UPPER(l.currency_code)
    HAVING ROUND(SUM(CASE WHEN l.direction = 'credit' THEN l.amount ELSE -l.amount END)::NUMERIC, 2) <> 0
  ) s;
$$;

COMMENT ON FUNCTION public.client_credit_summary(UUID, UUID) IS
  'Client credit held in each currency, omitting any currency that nets to zero.';

-- ---------------------------------------------------------------------------
-- Backfill: credit notes that already exist become wallet credit.
--
-- Without this every existing client starts at a balance of zero, and the credit
-- they are already owed disappears from the screen. The credit notes are real
-- documents that were issued and posted; they simply used to sit against an
-- invoice instead of a wallet. Moving them is a relabelling, not a new event, so
-- each is copied in as an opening credit tagged with its own note number.
--
-- Deliberately narrow:
--   * only live notes, since a void note was never a credit;
--   * only notes on an invoice that still has a client, since that is the only
--     way to know whose wallet it belongs to;
--   * NOT EXISTS, so re-running the migration cannot double a balance. The
--     unique index on (company, source_type, source_id, currency) is the second
--     line of defence, but an idempotent backfill should not depend on it.
-- ---------------------------------------------------------------------------
INSERT INTO public.client_credit_ledger (
  company_id, client_id, currency_code, amount, direction, reason,
  source_type, source_id, source_ref, itinerary_id, note, created_at
)
SELECT
  i.company_id,
  i.client_id,
  UPPER(i.currency_code),
  ROUND(c.total_incl, 2),
  'credit',
  'credit_note',
  'credit_note',
  c.id,
  COALESCE(c.credit_note_number, ''),
  i.itinerary_id,
  'Opening balance from an earlier credit note',
  COALESCE(c.created_at, timezone('utc'::text, now()))
FROM   public.credit_notes c
JOIN   public.invoices i ON i.id = c.invoice_id
WHERE  c.status <> 'void'
  AND  i.status <> 'void'
  AND  i.client_id IS NOT NULL
  AND  ROUND(COALESCE(c.total_incl, 0), 2) > 0
  AND  NOT EXISTS (
    SELECT 1 FROM public.client_credit_ledger l
    WHERE  l.source_type = 'credit_note'
      AND  l.source_id   = c.id
  );

-- ---------------------------------------------------------------------------
-- Internal: write one movement.
--
-- Deliberately not granted to `authenticated`. Every path into the wallet goes
-- through the checked functions below, so a credit can never appear from
-- nowhere or be spent without the cap being enforced.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_credit_post(
  p_company_id   UUID,
  p_client_id    UUID,
  p_currency     TEXT,
  p_amount       NUMERIC,
  p_direction    TEXT,
  p_reason       TEXT,
  p_source_type  TEXT DEFAULT NULL,
  p_source_id    UUID DEFAULT NULL,
  p_source_ref   TEXT DEFAULT '',
  p_itinerary_id UUID DEFAULT NULL,
  p_note         TEXT DEFAULT ''
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_amount NUMERIC(12,2);
  v_id     UUID;
BEGIN
  v_amount := ROUND(COALESCE(p_amount, 0), 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Credit amount must be greater than zero'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_direction NOT IN ('credit', 'debit') THEN
    RAISE EXCEPTION 'Credit direction must be credit or debit'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO public.client_credit_ledger (
    company_id, client_id, currency_code, amount, direction, reason,
    source_type, source_id, source_ref, itinerary_id, note
  )
  VALUES (
    p_company_id, p_client_id, UPPER(p_currency), v_amount, p_direction, p_reason,
    p_source_type, p_source_id, COALESCE(p_source_ref, ''), p_itinerary_id, COALESCE(p_note, '')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Issue a credit note.
--
-- The credit goes to the wallet, not to the invoice's balance. `p_allocate`
-- chooses the disposition the user picked:
--
--   'keep'     credit stays on the wallet for a future booking
--   'refund'   pay it out in cash now, and the wallet goes to zero
--
-- A credit note against a void invoice is refused: there is nothing live to
-- credit, and the reversal already happened when it was voided.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_client_credit_note(
  p_company_id UUID,
  p_invoice_id UUID,
  p_amount     NUMERIC,
  p_reason     TEXT,
  p_allocate   TEXT DEFAULT 'keep',
  p_lines      JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice    RECORD;
  v_amount     NUMERIC(12,2);
  v_number     TEXT;
  v_credit_id  UUID;
  v_balance    NUMERIC(12,2);
  v_credited   NUMERIC(12,2);
  v_remaining  NUMERIC(12,2);
  v_client     UUID;
  v_ratio      NUMERIC;
  v_refund     JSONB;
  v_lines_total NUMERIC(12,2);
  v_bad_items  JSONB;
  v_dupe_items JSONB;
  v_malformed  JSONB;
BEGIN
  IF p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'No invoice supplied'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_amount := ROUND(COALESCE(p_amount, 0), 2);
  IF v_amount <= 0.009 THEN
    RAISE EXCEPTION 'Enter an amount to credit'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_allocate IS NULL OR p_allocate NOT IN ('keep', 'refund') THEN
    RAISE EXCEPTION 'Choose whether to keep the credit or refund it'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF (p_reason IS NULL) OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Give a reason for the credit note'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT i.* INTO v_invoice
  FROM   public.invoices i
  WHERE  i.id = p_invoice_id
    AND  i.company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That invoice does not belong to this company'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_invoice.status = 'void' THEN
    RAISE EXCEPTION 'A voided invoice cannot be credited again'
      USING ERRCODE = 'check_violation',
            DETAIL = json_build_object('reason', 'void', 'currency', UPPER(v_invoice.currency_code))::TEXT;
  END IF;

  v_client := v_invoice.client_id;
  IF v_client IS NULL THEN
    RAISE EXCEPTION 'This invoice has no client, so its credit cannot be held for future bookings'
      USING ERRCODE = 'check_violation',
            DETAIL = json_build_object('reason', 'no_client', 'currency', UPPER(v_invoice.currency_code))::TEXT;
  END IF;

  /* Locked on the client and currency, for the same reason apply and refund are:
     this is one wallet, and a credit raised against one booking can be spent on
     another. Locking the invoice here would let a raise and a spend on a
     different booking interleave and read the same balance twice.

     The invoice row itself is still pinned by the SELECT below under READ
     COMMITTED, so the ceiling computed from credit notes is read after any
     concurrent raise on the same invoice commits. */
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_company_id::text || ':credit:' || v_client::text || ':' || UPPER(v_invoice.currency_code), 0));

  /* What has already been credited against this invoice. A credit note is a
     reversal of part of the sale, so crediting more than the invoice billed
     would create credit out of nothing. */
  v_credited := ROUND(COALESCE((
    SELECT SUM(c.total_incl)
    FROM   public.credit_notes c
    WHERE  c.invoice_id = p_invoice_id
      AND  c.status <> 'void'
  ), 0)::NUMERIC, 2);

  IF v_amount > ROUND(v_invoice.total_incl, 2) - v_credited + 0.009 THEN
    RAISE EXCEPTION 'That is more than is left to credit on this invoice'
      USING ERRCODE = 'check_violation',
            DETAIL = json_build_object(
              'reason',          'exceeds_invoice',
              'requested',       v_amount,
              'creditable',      GREATEST(ROUND(v_invoice.total_incl, 2) - v_credited, 0),
              'already_credited', v_credited,
              'invoice_number',  v_invoice.invoice_number,
              'currency',        UPPER(v_invoice.currency_code)
            )::TEXT;
  END IF;

  v_number := public.get_next_credit_note_reference(p_company_id);
  IF v_number IS NULL THEN
    RAISE EXCEPTION 'Could not allocate a credit note number'
      USING ERRCODE = 'internal_error';
  END IF;

  /* The note itself. Net and tax in proportion to the invoice's own figures,
     with tax as the remainder so the three reconcile. Lines are the items this
     credit is for -- always itinerary items, never free text. */
  /* Tax is the remainder, not zero and not the invoice's rate applied again.
     The invoice's own net and tax are scaled by the same ratio, so a credit that
     is not a round fraction still reconciles: net + tax = total, exactly. */
  v_ratio := CASE WHEN ROUND(v_invoice.total_incl, 2) > 0
                  THEN v_amount / ROUND(v_invoice.total_incl, 2)
                  ELSE 0 END;

  INSERT INTO public.credit_notes (
    company_id, invoice_id, invoice_number, invoice_type, credit_note_number,
    status, currency_code, subtotal_excl, tax_total, total_incl, tax_label,
    tax_rate, reason, issued_date, bill_to_name, bill_to_email, bill_to_address,
    supplier_name, supplier_tax_number, supplier_address, accounting_export
  )
  VALUES (
    p_company_id, p_invoice_id, v_invoice.invoice_number, v_invoice.invoice_type, v_number,
    'issued', v_invoice.currency_code,
    ROUND(COALESCE(v_invoice.subtotal_excl, 0) * v_ratio, 2),
    ROUND(v_amount - (COALESCE(v_invoice.subtotal_excl, 0) * v_ratio), 2),
    v_amount,
    COALESCE(v_invoice.tax_label, 'Tax'),
    COALESCE(v_invoice.tax_rate, 0),
    btrim(p_reason),
    CURRENT_DATE,
    v_invoice.bill_to_name, v_invoice.bill_to_email, v_invoice.bill_to_address,
    v_invoice.supplier_name, v_invoice.supplier_tax_number, v_invoice.supplier_address,
    jsonb_build_object(
      'schema', 'torbuilder.credit_note/v1',
      'provider_agnostic', true,
      'credit_note_number', v_number,
      'invoice_number', v_invoice.invoice_number,
      'status', 'issued',
      'date', CURRENT_DATE,
      'currency', v_invoice.currency_code,
      'customer', jsonb_build_object('name', v_invoice.bill_to_name, 'email', v_invoice.bill_to_email),
      'amount', v_amount,
      'reason', btrim(p_reason),
      'allocation', p_allocate
    )
  )
  RETURNING id INTO v_credit_id;

  /* A credit note is always itemised. There is no "misc" line and no free text,
     because a credit that cannot be traced to a service that came off the
     itinerary cannot be checked against the booking, and cannot be told apart
     from a discount later.

     Every line has to name an item that is genuinely on this booking, so the
     credit can never be raised against something that was never sold, and the
     lines have to add up to the credited total so the note reconciles on its
     own terms. Each service may appear once. All of this is checked before
     anything is written. */
  IF jsonb_typeof(COALESCE(p_lines, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_lines, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'A credit note must list the itinerary services it is for'
      USING ERRCODE = 'invalid_parameter_value',
            DETAIL = json_build_object('reason', 'no_lines')::TEXT;
  END IF;

  /* One line per service. Listing the same itinerary item twice is the one shape
     the other checks cannot catch: each line is a genuine service on the
     itinerary, and the two together still add up to the credited total, so
     everything else passes while the credit is really for a single service
     that is now credited double. Two lines for the same service also make the
     itemised note disagree with the booking it came off, and leave the
     "already credited" check below unable to tell which line was which. */
  SELECT jsonb_agg(d.item_id)
  INTO   v_dupe_items
  FROM (
    SELECT l->>'item_id' AS item_id
      FROM jsonb_array_elements(p_lines) AS l
     WHERE NULLIF(l->>'item_id', '') IS NOT NULL
     GROUP BY l->>'item_id'
    HAVING count(*) > 1
  ) d;

  IF v_dupe_items IS NOT NULL THEN
    RAISE EXCEPTION 'A credit note cannot credit the same itinerary service twice'
      USING ERRCODE = 'check_violation',
            DETAIL = json_build_object('reason', 'duplicate_item', 'items', v_dupe_items)::TEXT;
  END IF;

  /* Validate the shape of each item_id before using it in a UUID cast below.
     Casting first turns a malformed id into "invalid input syntax for type
     uuid", which is a database error rather than anything the caller can act
     on, and it aborts before the friendly checks that would have explained the
     actual problem.

     This is a regex rather than pg_input_is_valid(), which is a deliberate
     downgrade. pg_input_is_valid() only exists in PostgreSQL 16+, so the guard
     compiled and passed here on a PostgreSQL 18 harness but failed on the target
     with:

       ERROR: 42883: function pg_input_is_valid(text, unknown) does not exist

     which aborted the entire function at the guard, before any validation could
     run. A check that cannot compile on the database it is meant to protect is
     not a check. The regex behaves identically on every version from PostgreSQL
     12 onwards, and the two were compared directly against a battery of
     malformed inputs to confirm nothing slips through.

     Anchored and case-insensitive, so a well-formed id in either case passes and
     anything else -- wrong length, missing hyphens, non-hex characters,
     surrounding braces -- is reported instead of reaching the cast. */
  SELECT jsonb_agg(d.item_id)
  INTO   v_malformed
  FROM (
    SELECT DISTINCT l->>'item_id' AS item_id
      FROM jsonb_array_elements(p_lines) AS l
     WHERE NULLIF(l->>'item_id', '') IS NOT NULL
       AND (l->>'item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) d;

  IF v_malformed IS NOT NULL THEN
    RAISE EXCEPTION 'A credit note line has an invalid service reference'
      USING ERRCODE = 'invalid_parameter_value',
            DETAIL = json_build_object('reason', 'malformed_item_id', 'items', v_malformed)::TEXT;
  END IF;

  SELECT COALESCE(ROUND(SUM(COALESCE((l->>'line_total')::NUMERIC, 0)), 2), 0)
  INTO   v_lines_total
  FROM   jsonb_array_elements(p_lines) AS l;

  IF ABS(v_lines_total - v_amount) > 0.009 THEN
    RAISE EXCEPTION 'The credit note lines do not add up to the credit amount'
      USING ERRCODE = 'check_violation',
            DETAIL = json_build_object(
              'reason', 'lines_mismatch', 'lines', v_lines_total, 'amount', v_amount
            )::TEXT;
  END IF;

  SELECT jsonb_agg(l->>'item_id')
  INTO   v_bad_items
  FROM   jsonb_array_elements(p_lines) AS l
  WHERE  NULLIF(l->>'item_id', '') IS NULL
     OR  NOT EXISTS (
           SELECT 1
           FROM   public.itinerary_day_items di
           JOIN   public.itinerary_days d ON d.id = di.itinerary_day_id
           WHERE  di.id = NULLIF(l->>'item_id', '')::UUID
             AND  d.itinerary_id = v_invoice.itinerary_id
             AND  di.company_id = p_company_id
         );

  IF v_bad_items IS NOT NULL THEN
    RAISE EXCEPTION 'A credit note line is not a service on this itinerary'
      USING ERRCODE = 'check_violation',
            DETAIL = json_build_object(
              'reason', 'unknown_item', 'items', v_bad_items,
              'invoice_number', v_invoice.invoice_number
            )::TEXT;
  END IF;

  /* The credit note's own lines, so the credit is itemised against the
     itinerary services that caused it. `item_id` is what makes the credit
     traceable, and what stops a later repricing from crediting the same item
     again. Item names are taken from the itinerary rather than from the caller,
     so the note cannot disagree with the booking about what was sold. */
  INSERT INTO public.invoice_line_items (
    company_id, invoice_id, credit_note_id, day_number, item_name, item_id,
    quantity, unit_price, subtotal_excl, tax_amount, line_total,
    tax_label, tax_rate, currency_code, sort_order
  )
  SELECT
    p_company_id, p_invoice_id, v_credit_id,
    COALESCE(d.day_number, 0),
    COALESCE(di.item_name, l->>'item_name', ''),
    di.id,
    COALESCE((l->>'quantity')::INT, 1),
    COALESCE((l->>'unit_price')::NUMERIC, 0),
    COALESCE((l->>'subtotal_excl')::NUMERIC, 0),
    0,
    COALESCE((l->>'line_total')::NUMERIC, 0),
    COALESCE(v_invoice.tax_label, 'Tax'),
    COALESCE(v_invoice.tax_rate, 0),
    v_invoice.currency_code,
    COALESCE((l->>'sort_order')::INT, 0)
  FROM jsonb_array_elements(p_lines) AS l
  JOIN public.itinerary_day_items di ON di.id = NULLIF(l->>'item_id', '')::UUID
  JOIN public.itinerary_days d      ON d.id = di.itinerary_day_id;

  /* Credit the wallet. This is the whole point of the exercise: the money is
     now the client's, available for any future booking. */
  PERFORM public.client_credit_post(
    p_company_id, v_client, v_invoice.currency_code, v_amount, 'credit',
    'credit_note', 'credit_note', v_credit_id, v_number, v_invoice.itinerary_id,
    btrim(p_reason)
  );

  /* Refund on request: pay the credit straight out.

     Delegated to refund_client_credit so there is exactly one place that debits
     the wallet and writes the cash-out document. It runs inside this
     transaction and under the same client-and-currency lock, so the credit can
     neither be spent on a booking nor refunded twice while this note is being
     written. The advisory lock is re-entrant, so taking it again costs nothing
     and guarantees the two paths can never drift apart. */
  IF p_allocate = 'refund' THEN
    v_refund := public.refund_client_credit(
      p_company_id, v_client, v_invoice.currency_code, v_amount, btrim(p_reason), p_invoice_id);
  END IF;

  v_balance := public.client_credit_balance(p_company_id, v_client, v_invoice.currency_code);

  RETURN json_build_object(
    'id',              v_credit_id,
    'number',          v_number,
    'amount',          v_amount,
    'invoice_number',  v_invoice.invoice_number,
    'currency',        UPPER(v_invoice.currency_code),
    'client_id',       v_client,
    'allocation',      p_allocate,
    'refund_id',       COALESCE(v_refund->>'id', ''),
    'refund_number',   COALESCE(v_refund->>'number', ''),
    'credit_balance',  v_balance,
    'credit_remaining', v_balance
  );
END;
$$;

COMMENT ON FUNCTION public.issue_client_credit_note(UUID, UUID, NUMERIC, TEXT, TEXT, JSONB) IS
  'Raise a credit note against an invoice. The credit is posted to the client''s wallet rather than settling the invoice, so it can be spent on any future booking. ''keep'' leaves it on the wallet; ''refund'' also pays it out in cash. Lines are always the itinerary items the credit is for.';

-- ---------------------------------------------------------------------------
-- Spend credit on an invoice.
--
-- This is the automatic pick-up: a new invoice for a client who holds credit
-- offers to settle it from the wallet, and the user confirms. The wallet is
-- debited and the invoice's receivable is reduced by the same amount, so the
-- two can never disagree.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_client_credit(
  p_company_id UUID,
  p_invoice_id UUID,
  p_amount     NUMERIC DEFAULT NULL,
  p_confirmed  BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice    RECORD;
  v_amount     NUMERIC(12,2);
  v_balance    NUMERIC(12,2);
  v_outstanding NUMERIC(12,2);
  v_credited   NUMERIC(12,2);
  v_applied    NUMERIC(12,2);
  v_client     UUID;
  v_number     TEXT;
  v_receipt_id UUID;
  v_remaining  NUMERIC(12,2);
BEGIN
  IF p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'No invoice supplied'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  /* The prompt is not decoration. If the user declined, nothing is spent and
     the credit stays on the wallet for another booking. */
  IF p_confirmed IS NOT TRUE THEN
    SELECT i.client_id, i.currency_code INTO v_client, v_number
    FROM public.invoices i WHERE i.id = p_invoice_id AND i.company_id = p_company_id;

    IF v_client IS NULL THEN
      RAISE EXCEPTION 'That invoice does not belong to this company'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    RETURN json_build_object(
      'applied',        0,
      'declined',       true,
      'credit_available', public.client_credit_balance(p_company_id, v_client, v_number),
      'currency',       UPPER(v_number)
    );
  END IF;

  SELECT i.* INTO v_invoice
  FROM   public.invoices i
  WHERE  i.id = p_invoice_id
    AND  i.company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That invoice does not belong to this company'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_invoice.status = 'void' THEN
    RAISE EXCEPTION 'A voided invoice cannot be settled with credit'
      USING ERRCODE = 'check_violation',
            DETAIL = json_build_object('reason', 'void', 'currency', UPPER(v_invoice.currency_code))::TEXT;
  END IF;

  v_client := v_invoice.client_id;
  IF v_client IS NULL THEN
    RAISE EXCEPTION 'This invoice has no client, so there is no credit to apply'
      USING ERRCODE = 'check_violation',
            DETAIL = json_build_object('reason', 'no_client', 'currency', UPPER(v_invoice.currency_code))::TEXT;
  END IF;

  /* Locked on the CLIENT, not the invoice.

     Five invoices can be offered the same credit at the same moment, and each
     has a different invoice id -- so an invoice lock would not make them wait
     for each other. All five would read the same balance, each believe it was
     the one spending it, and together hand out far more credit than the client
     ever had. The client is the thing being debited, so the client is the lock.
     Held to the end of the transaction, so the debit and the balance it was
     measured against commit together. */
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_company_id::text || ':credit:' || v_client::text || ':' || UPPER(v_invoice.currency_code), 0));

  /* What the invoice still owes, from the documents.

     Credit notes are NOT subtracted here. They credit the client's wallet, not
     this invoice, so counting them would settle the invoice with money that is
     still available to spend on a future booking -- and the wallet debit below
     would then take that money a second time. This is the single place credit
     is spent, so the balance has to be measured the same way the browser
     measures it. */
  v_outstanding := GREATEST(ROUND(
    ROUND(v_invoice.total_incl, 2)
    - COALESCE((
        SELECT SUM(CASE WHEN r.direction = 'out' THEN -r.amount ELSE r.amount END)
        FROM   public.invoice_receipts r
        WHERE  r.invoice_id = p_invoice_id
          AND  r.direction <> 'wallet_out'
      ), 0)
  , 2), 0);

  v_balance := public.client_credit_balance(p_company_id, v_client, v_invoice.currency_code);

  /* Null means "as much as can be spent", which is what the automatic pick-up
     wants: take the credit off, up to what is owed. */
  IF p_amount IS NULL THEN
    v_amount := LEAST(v_balance, v_outstanding);
  ELSE
    v_amount := ROUND(COALESCE(p_amount, 0), 2);
  END IF;

  IF v_amount <= 0.009 THEN
    RETURN json_build_object(
      'applied', 0, 'declined', false,
      'credit_available', v_balance, 'outstanding', v_outstanding,
      'currency', UPPER(v_invoice.currency_code)
    );
  END IF;

  IF v_amount > v_outstanding + 0.009 THEN
    RAISE EXCEPTION 'That is more than is still owed on this invoice'
      USING ERRCODE = 'check_violation',
            DETAIL = json_build_object(
              'reason', 'exceeds_outstanding', 'requested', v_amount, 'outstanding', v_outstanding,
              'invoice_number', v_invoice.invoice_number, 'currency', UPPER(v_invoice.currency_code)
            )::TEXT;
  END IF;

  /* The cap. A client can never spend credit they do not hold, and because this
     runs under the same lock as the credit note, two bookings raised at once
     cannot between them spend the same credit twice. */
  IF v_amount > v_balance + 0.009 THEN
    RAISE EXCEPTION 'That is more credit than this client holds'
      USING ERRCODE = 'check_violation',
            DETAIL = json_build_object(
              'reason', 'exceeds_credit', 'requested', v_amount, 'available', v_balance,
              'currency', UPPER(v_invoice.currency_code)
            )::TEXT;
  END IF;

  v_number := public.get_next_receipt_reference(p_company_id);
  IF v_number IS NULL THEN
    RAISE EXCEPTION 'Could not allocate a receipt number'
      USING ERRCODE = 'internal_error';
  END IF;

  /* Recorded as a receipt row with direction 'apply'. It is a settlement in the
     same sense a cash receipt is, just not in cash, so the invoice's documents
     tell one story. */
  INSERT INTO public.invoice_receipts (
    company_id, invoice_id, receipt_number, invoice_number, invoice_type,
    currency_code, amount, balance_remaining, direction, received_date,
    payment_method, payment_reference, bill_to_name, bill_to_email,
    itinerary_id, client_id, accounting_export, notes
  )
  VALUES (
    p_company_id, p_invoice_id, v_number, v_invoice.invoice_number, v_invoice.invoice_type,
    v_invoice.currency_code, v_amount, 0, 'apply', CURRENT_DATE,
    'CREDIT', '', v_invoice.bill_to_name, v_invoice.bill_to_email,
    v_invoice.itinerary_id, v_client,
    jsonb_build_object(
      'schema', 'torbuilder.credit_application/v1',
      'provider_agnostic', true,
      'receipt_number', v_number,
      'invoice_number', v_invoice.invoice_number,
      'status', 'settled_by_credit',
      'date', CURRENT_DATE,
      'currency', v_invoice.currency_code,
      'amount', v_amount,
      'from', 'client_credit_wallet'
    ),
    'Applied from client credit'
  )
  RETURNING id INTO v_receipt_id;

  PERFORM public.client_credit_post(
    p_company_id, v_client, v_invoice.currency_code, v_amount, 'debit',
    'applied', 'invoice', p_invoice_id, v_invoice.invoice_number,
    v_invoice.itinerary_id, 'Applied to ' || v_invoice.invoice_number
  );

  v_remaining := GREATEST(ROUND(v_outstanding - v_amount, 2), 0);

  UPDATE public.invoices
  SET    status = CASE WHEN v_remaining <= 0.009 THEN 'paid' ELSE 'validated' END,
         balance_due = v_remaining,
         paid_at = CASE WHEN v_remaining <= 0.009 THEN now() ELSE NULL END,
         updated_at = now()
  WHERE  id = p_invoice_id;

  RETURN json_build_object(
    'id',               v_receipt_id,
    'number',           v_number,
    'applied',          v_amount,
    'declined',         false,
    'outstanding',      v_remaining,
    'credit_available', ROUND(v_balance - v_amount, 2),
    'currency',         UPPER(v_invoice.currency_code)
  );
END;
$$;

COMMENT ON FUNCTION public.apply_client_credit(UUID, UUID, NUMERIC, BOOLEAN) IS
  'Spend client credit on an invoice, debiting the wallet by exactly what the invoice''s receivable falls by. Passing p_confirmed = false spends nothing, which is how a declined prompt is honoured. Amount null means "as much as can be spent".';

-- ---------------------------------------------------------------------------
-- Pay credit out in cash.
--
-- The second disposition of the same entitlement. Capped by the wallet, so
-- this can never pay out more than the client is owed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_client_credit(
  p_company_id UUID,
  p_client_id  UUID,
  p_currency   TEXT,
  p_amount     NUMERIC,
  p_reason     TEXT DEFAULT '',
  p_invoice_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_amount   NUMERIC(12,2);
  v_balance  NUMERIC(12,2);
  v_number   TEXT;
  v_receipt_id UUID;
  v_invoice  RECORD;
BEGIN
  v_amount := ROUND(COALESCE(p_amount, 0), 2);
  IF v_amount <= 0.009 THEN
    RAISE EXCEPTION 'Enter an amount to refund'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  /* Locked on the same client-and-currency key as raise and apply. Refunding
     and spending race for the same balance, so they have to queue behind each
     other; an invoice id here would not do that, because a refund is about the
     wallet, not the document it is filed against. */
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_company_id::text || ':credit:' || p_client_id::text || ':' || UPPER(p_currency), 0));

  /* A receipt row has to hang off an invoice, so the document trail needs one.
     When the caller does not name an invoice the credit is traced back to the
     booking it came from: the most recent live credit note for this client in
     this currency. That keeps the payout attached to something real instead of
     either inventing a link or leaving the row orphaned. */
  IF p_invoice_id IS NULL THEN
    SELECT c.invoice_id INTO p_invoice_id
    FROM   public.credit_notes c
    JOIN   public.invoices i ON i.id = c.invoice_id
    WHERE  i.company_id = p_company_id
      AND  i.client_id  = p_client_id
      AND  UPPER(i.currency_code) = UPPER(p_currency)
      AND  c.status <> 'void'
      AND  i.status <> 'void'
    ORDER  BY c.issued_date DESC, c.created_at DESC
    LIMIT  1;

    IF p_invoice_id IS NULL THEN
      RAISE EXCEPTION 'There is no live invoice to file this refund against'
        USING ERRCODE = 'check_violation',
              DETAIL = json_build_object('reason', 'no_invoice', 'currency', UPPER(p_currency))::TEXT;
    END IF;
  END IF;

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

  v_balance := public.client_credit_balance(p_company_id, p_client_id, p_currency);

  IF v_amount > v_balance + 0.009 THEN
    RAISE EXCEPTION 'That is more credit than this client holds'
      USING ERRCODE = 'check_violation',
            DETAIL = json_build_object(
              'reason', 'exceeds_credit', 'requested', v_amount, 'available', v_balance,
              'currency', UPPER(p_currency)
            )::TEXT;
  END IF;

  v_number := public.get_next_receipt_reference(p_company_id);
  IF v_number IS NULL THEN
    RAISE EXCEPTION 'Could not allocate a receipt number'
      USING ERRCODE = 'internal_error';
  END IF;

  /* Filed against the invoice so the document trail shows where the cash went,
     written as 'wallet_out' so it is not mistaken for a clawback against the
     original payment. */
  INSERT INTO public.invoice_receipts (
    company_id, invoice_id, receipt_number, invoice_number, invoice_type,
    currency_code, amount, balance_remaining, direction, received_date,
    payment_method, payment_reference, itinerary_id, client_id, accounting_export, notes
  )
  VALUES (
    p_company_id, p_invoice_id, v_number,
    COALESCE(v_invoice.invoice_number, ''), COALESCE(v_invoice.invoice_type, 'invoice'),
    UPPER(p_currency), v_amount, 0, 'wallet_out', CURRENT_DATE,
    'REFUND', '',
    COALESCE(v_invoice.itinerary_id, NULL), p_client_id,
    jsonb_build_object(
      'schema', 'torbuilder.refund/v1',
      'provider_agnostic', true,
      'receipt_number', v_number,
      'status', 'refunded',
      'date', CURRENT_DATE,
      'currency', UPPER(p_currency),
      'amount', v_amount,
      'reason', COALESCE(p_reason, ''),
      'from', 'client_credit_wallet'
    ),
    NULLIF(p_reason, '')
  )
  RETURNING id INTO v_receipt_id;

  PERFORM public.client_credit_post(
    p_company_id, p_client_id, UPPER(p_currency), v_amount, 'debit',
    'refund', 'refund', v_receipt_id, v_number,
    COALESCE(v_invoice.itinerary_id, NULL), COALESCE(p_reason, '')
  );

  RETURN json_build_object(
    'id',               v_receipt_id,
    'number',           v_number,
    'amount',           v_amount,
    'credit_remaining', ROUND(v_balance - v_amount, 2),
    'currency',         UPPER(p_currency)
  );
END;
$$;

COMMENT ON FUNCTION public.refund_client_credit(UUID, UUID, TEXT, NUMERIC, TEXT, UUID) IS
  'Pay client credit out in cash, capped by the wallet balance under a client-level lock. The second disposition of a credit note, alongside keeping it for a future booking.';

GRANT EXECUTE ON FUNCTION public.client_credit_balance(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.client_credit_summary(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_client_credit_note(UUID, UUID, NUMERIC, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_client_credit(UUID, UUID, NUMERIC, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refund_client_credit(UUID, UUID, TEXT, NUMERIC, TEXT, UUID) TO authenticated;
