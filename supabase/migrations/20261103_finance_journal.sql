-- Finance: double-entry journal, general ledger and accounting connections
--
-- The Invoices module is now Finance. It owns not only invoices but the
-- accounting record behind them: a balanced double-entry journal for every
-- financial event, a general ledger the accounts team can port into Xero /
-- QuickBooks / Sage, and the connection settings for pushing or syncing that
-- ledger out.
--
-- Design notes
--   * Accounts are a per-company chart, seeded on first use by the app
--     (ensureChartOfAccounts) rather than here, because companies are created
--     at runtime and this migration must not assume any exist.
--   * Every journal entry must balance: total debits = total credits. A partial
--     unique index guarantees at most ONE entry per source document, so
--     re-posting an invoice is idempotent rather than duplicating the ledger.
--   * account_code / account_name are denormalised onto each line. The ledger
--     has to stay readable (and exportable) even if an account is later
--     renamed, and exports must not require a live join.
--
-- Idempotent: safe to re-run.

-- ─── Chart of accounts ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.finance_accounts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id        UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    code              TEXT NOT NULL,
    name              TEXT NOT NULL,
    /* revenue | receivable | payable | expense | asset | liability | equity | cash */
    account_type      TEXT NOT NULL,
    /* debit | credit — the side that increases the account. */
    normal_balance    TEXT NOT NULL,
    is_system         BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order        INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at        TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT finance_accounts_code_unique UNIQUE (company_id, code)
);

COMMENT ON TABLE public.finance_accounts IS
  'Per-company chart of accounts. Seeded on first use of the Finance module.';

-- ─── Journal ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.journal_entries (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id        UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    entry_date        DATE NOT NULL DEFAULT CURRENT_DATE,
    /* Human reference of the source document, e.g. INV-000123. */
    reference         TEXT NOT NULL DEFAULT '',
    /* invoice | receipt | credit_note | cost_of_sales | manual */
    source_type       TEXT NOT NULL,
    /* Id of the originating document. NULL for manual entries. */
    source_id         UUID,
    narration         TEXT NOT NULL DEFAULT '',
    itinerary_id      UUID REFERENCES public.itineraries(id) ON DELETE SET NULL,
    client_id         UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    currency_code     TEXT NOT NULL DEFAULT 'ZAR',
    total_debit       NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_credit      NUMERIC(14,2) NOT NULL DEFAULT 0,
    is_posted         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at        TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

COMMENT ON TABLE public.journal_entries IS
  'One balanced double-entry posting per financial event. source_type + source_id make re-posting idempotent.';

CREATE TABLE IF NOT EXISTS public.journal_lines (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id        UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    entry_id          UUID NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
    account_id        UUID NOT NULL REFERENCES public.finance_accounts(id),
    account_code      TEXT NOT NULL,
    account_name      TEXT NOT NULL,
    line_type         TEXT NOT NULL,
    amount            NUMERIC(14,2) NOT NULL DEFAULT 0,
    description       TEXT NOT NULL DEFAULT '',
    itinerary_id      UUID REFERENCES public.itineraries(id) ON DELETE SET NULL,
    sort_order        INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT journal_lines_type_check CHECK (line_type IN ('debit', 'credit')),
    -- A line is either a debit or a credit and never both, and never zero:
    -- a zero line is a rounding artefact that only hides a broken entry.
    CONSTRAINT journal_lines_amount_check CHECK (amount > 0)
);

COMMENT ON TABLE public.journal_lines IS
  'Individual debit / credit lines. Exactly one side per line, amount strictly positive.';

CREATE INDEX IF NOT EXISTS journal_entries_company_date_idx
  ON public.journal_entries (company_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS journal_entries_itinerary_idx
  ON public.journal_entries (itinerary_id);
CREATE INDEX IF NOT EXISTS journal_lines_entry_idx
  ON public.journal_lines (entry_id);
CREATE INDEX IF NOT EXISTS journal_lines_account_idx
  ON public.journal_lines (company_id, account_code);

-- At most one entry per source document, so re-posting is idempotent.
-- Manual entries (source_id IS NULL) are exempt and may be many.
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_source_unique
  ON public.journal_entries (company_id, source_type, source_id)
  WHERE source_id IS NOT NULL;

-- A journal entry must balance. Enforced in the database, not just the app, so
-- a bug or a manual insert can never leave the ledger out of balance.
CREATE OR REPLACE FUNCTION public.journal_entry_is_balanced(p_entry_id UUID)
RETURNS BOOLEAN AS $$
  SELECT NOT EXISTS (
    SELECT 1
      FROM public.journal_entries e
     WHERE e.id = p_entry_id
       AND e.total_debit <> e.total_credit
  );
$$ LANGUAGE sql STABLE;

-- ─── Accounting connections (Xero / QuickBooks / Sage) ──────────────────────
CREATE TABLE IF NOT EXISTS public.accounting_connections (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id        UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    /* xero | quickbooks | sage */
    provider          TEXT NOT NULL,
    /* push = export a file the accounts team imports; live = two-way API sync. */
    mode              TEXT NOT NULL DEFAULT 'push',
    /* disconnected | connected | error */
    status            TEXT NOT NULL DEFAULT 'disconnected',
    -- Oauth tokens / client secrets. Never selected into the browser; the
    -- accounts team pastes a credential reference here and a server-side
    -- integration owns the actual secret.
    credentials       JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_sync_at      TIMESTAMP WITH TIME ZONE,
    last_error        TEXT,
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at        TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT accounting_connections_provider_unique UNIQUE (company_id, provider),
    CONSTRAINT accounting_connections_mode_check CHECK (mode IN ('push', 'live')),
    CONSTRAINT accounting_connections_status_check
      CHECK (status IN ('disconnected', 'connected', 'error'))
);

COMMENT ON TABLE public.accounting_connections IS
  'Per-company accounting integration. Push exports a ledger file; live mode needs a server-side OAuth integration.';

CREATE TABLE IF NOT EXISTS public.accounting_sync_log (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id        UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    connection_id     UUID REFERENCES public.accounting_connections(id) ON DELETE SET NULL,
    provider          TEXT NOT NULL,
    direction         TEXT NOT NULL,
    status            TEXT NOT NULL,
    records_count     INTEGER NOT NULL DEFAULT 0,
    message           TEXT NOT NULL DEFAULT '',
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

COMMENT ON TABLE public.accounting_sync_log IS
  'Audit trail of every push / sync attempt, successful or not.';

CREATE INDEX IF NOT EXISTS accounting_sync_log_company_idx
  ON public.accounting_sync_log (company_id, created_at DESC);

-- ─── RLS — company-scoped like every other table ────────────────────────────
ALTER TABLE public.finance_accounts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_lines           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_connections  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_sync_log     ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='finance_accounts') THEN
    CREATE POLICY "Users manage company finance accounts" ON public.finance_accounts
      FOR ALL USING (company_id = public.get_user_company_id() OR public.is_super_admin())
      WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='journal_entries') THEN
    CREATE POLICY "Users manage company journal entries" ON public.journal_entries
      FOR ALL USING (company_id = public.get_user_company_id() OR public.is_super_admin())
      WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='journal_lines') THEN
    CREATE POLICY "Users manage company journal lines" ON public.journal_lines
      FOR ALL USING (company_id = public.get_user_company_id() OR public.is_super_admin())
      WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='accounting_connections') THEN
    CREATE POLICY "Users manage company accounting connections" ON public.accounting_connections
      FOR ALL USING (company_id = public.get_user_company_id() OR public.is_super_admin())
      WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='accounting_sync_log') THEN
    CREATE POLICY "Users view company accounting sync log" ON public.accounting_sync_log
      FOR ALL USING (company_id = public.get_user_company_id() OR public.is_super_admin())
      WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
END $$;

-- Refresh the PostgREST schema cache so the new tables are queryable from the
-- app immediately, without waiting for the next automatic reload.
NOTIFY pgrst, 'reload schema';
