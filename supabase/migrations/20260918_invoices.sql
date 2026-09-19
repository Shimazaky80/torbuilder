-- =============================================================================
-- Migration: Invoices (patch-style, idempotent)
-- Run in Supabase Dashboard -> SQL Editor (one block, one run)
--
-- An invoice is ALWAYS derived from an itinerary — services can never be typed
-- in by hand. Issuing an invoice:
--   * is gated by itinerary status: Provisional -> Deposit invoice,
--     Confirmed -> Final invoice;
--   * covers exactly ONE currency (a multi-currency itinerary yields several
--     invoices — one per currency — and each currency's services only ever load
--     onto that currency's invoice);
--   * snapshots every line (name, qty=pax, unit sell, tax, totals) so the
--     document is immutable even if the itinerary is edited afterwards.
--
-- Lifecycle: proforma (deposit request) -> paid -> void; final invoices are
-- validated -> paid -> void. A receipt is issued against a paid invoice once the
-- money has landed in the bank. Every void is ALWAYS reversed by a credit note so
-- the client account balances and the itinerary/currency slot is freed for a
-- replacement invoice. Invoice / receipt / credit-note numbers are minted from
-- lock-safe per-tenant counters, exactly like itinerary references, which the
-- future Sage / QuickBooks / Xero connectors rely on as stable keys.
--
-- Client-facing breakdown is intentionally minimal:
--   Subtotal (Excl VAT) + Tax (VAT x%) = [CUR] TOTAL DUE (INCL TAX)
-- Input VAT / net VAT are NEVER stored on the invoice and never sent to a client.
-- =============================================================================

-- ─── STEP 1: Tenant billing profile (invoice header + deposit policy) ────────
CREATE TABLE IF NOT EXISTS public.company_billing_settings (
    company_id                  UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
    legal_name                  TEXT NOT NULL DEFAULT '',
    tax_number                  TEXT NOT NULL DEFAULT '',
    billing_address             TEXT NOT NULL DEFAULT '',
    default_deposit_percentage  NUMERIC(5,2) NOT NULL DEFAULT 30,
    invoice_prefix              TEXT NOT NULL DEFAULT 'INV',
    receipt_prefix              TEXT NOT NULL DEFAULT 'RCT',
    credit_note_prefix          TEXT NOT NULL DEFAULT 'CRN',
    created_at                  TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at                  TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.company_billing_settings
  ADD COLUMN IF NOT EXISTS legal_name                 TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tax_number                 TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS billing_address            TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS default_deposit_percentage NUMERIC(5,2) NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS invoice_prefix             TEXT NOT NULL DEFAULT 'INV',
  ADD COLUMN IF NOT EXISTS receipt_prefix             TEXT NOT NULL DEFAULT 'RCT',
  ADD COLUMN IF NOT EXISTS credit_note_prefix         TEXT NOT NULL DEFAULT 'CRN',
  ADD COLUMN IF NOT EXISTS created_at                 TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  ADD COLUMN IF NOT EXISTS updated_at                 TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;

-- ─── STEP 2: Bank accounts — a tenant may hold one per currency ──────────────
CREATE TABLE IF NOT EXISTS public.company_bank_accounts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    label               TEXT NOT NULL DEFAULT '',
    currency_code       TEXT NOT NULL DEFAULT 'ZAR',
    bank_name           TEXT NOT NULL DEFAULT '',
    account_holder_name TEXT NOT NULL DEFAULT '',
    account_number      TEXT NOT NULL DEFAULT '',
    branch_code         TEXT NOT NULL DEFAULT '',
    swift_code          TEXT NOT NULL DEFAULT '',
    is_default          BOOLEAN NOT NULL DEFAULT false,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.company_bank_accounts
  ADD COLUMN IF NOT EXISTS label               TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS currency_code       TEXT NOT NULL DEFAULT 'ZAR',
  ADD COLUMN IF NOT EXISTS bank_name           TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS account_holder_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS account_number      TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS branch_code         TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS swift_code          TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_default          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active           BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at          TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;

CREATE INDEX IF NOT EXISTS company_bank_accounts_company_idx ON public.company_bank_accounts (company_id);
-- At most one default account per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS company_bank_accounts_one_default_idx
  ON public.company_bank_accounts (company_id) WHERE is_default;

-- ─── STEP 3: Per-client deposit override (tenant default lives in settings) ──
-- NULL = use company_billing_settings.default_deposit_percentage.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS deposit_percentage NUMERIC(5,2);

-- ─── STEP 4: Invoice number counters + lock-safe generator ───────────────────
CREATE TABLE IF NOT EXISTS public.invoice_ref_counters (
    company_id  UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
    last_value  INTEGER NOT NULL DEFAULT 0,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.invoice_ref_counters
  ADD COLUMN IF NOT EXISTS last_value INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;

CREATE OR REPLACE FUNCTION public.get_next_invoice_reference(p_company_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_next      INTEGER;
  v_year      TEXT;
  v_reference TEXT;
  v_prefix    TEXT;
BEGIN
  INSERT INTO public.invoice_ref_counters (company_id, last_value)
  VALUES (p_company_id, 1)
  ON CONFLICT (company_id)
  DO UPDATE SET last_value = public.invoice_ref_counters.last_value + 1,
                updated_at = timezone('utc'::text, now())
  RETURNING last_value INTO v_next;

  SELECT COALESCE(NULLIF(invoice_prefix, ''), 'INV') INTO v_prefix
  FROM public.company_billing_settings WHERE company_id = p_company_id;
  IF v_prefix IS NULL THEN v_prefix := 'INV'; END IF;

  v_year := to_char(timezone('utc'::text, now()), 'YYYY');
  v_reference := v_prefix || '-' || v_year || '-' || lpad(v_next::text, 6, '0');
  RETURN v_reference;
END;
$$;

-- ─── STEP 4b: Receipt number counters + lock-safe generator ──────────────────
CREATE TABLE IF NOT EXISTS public.receipt_ref_counters (
    company_id  UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
    last_value  INTEGER NOT NULL DEFAULT 0,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.receipt_ref_counters
  ADD COLUMN IF NOT EXISTS last_value INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;

CREATE OR REPLACE FUNCTION public.get_next_receipt_reference(p_company_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_next      INTEGER;
  v_year      TEXT;
  v_reference TEXT;
  v_prefix    TEXT;
BEGIN
  INSERT INTO public.receipt_ref_counters (company_id, last_value)
  VALUES (p_company_id, 1)
  ON CONFLICT (company_id)
  DO UPDATE SET last_value = public.receipt_ref_counters.last_value + 1,
                updated_at = timezone('utc'::text, now())
  RETURNING last_value INTO v_next;

  SELECT COALESCE(NULLIF(receipt_prefix, ''), 'RCT') INTO v_prefix
  FROM public.company_billing_settings WHERE company_id = p_company_id;
  IF v_prefix IS NULL THEN v_prefix := 'RCT'; END IF;

  v_year := to_char(timezone('utc'::text, now()), 'YYYY');
  v_reference := v_prefix || '-' || v_year || '-' || lpad(v_next::text, 6, '0');
  RETURN v_reference;
END;
$$;

-- ─── STEP 5: invoices — immutable, one currency, itinerary-derived ───────────
CREATE TABLE IF NOT EXISTS public.invoices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    itinerary_id        UUID NOT NULL REFERENCES public.itineraries(id) ON DELETE RESTRICT,
    client_id           UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    invoice_number      TEXT NOT NULL,
    invoice_type        TEXT NOT NULL DEFAULT 'final' CHECK (invoice_type IN ('deposit', 'final')),
    status              TEXT NOT NULL DEFAULT 'validated' CHECK (status IN ('proforma', 'validated', 'paid', 'void')),
    currency_code       TEXT NOT NULL,
    subtotal_excl       NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax_total           NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_incl          NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax_label           TEXT NOT NULL DEFAULT 'VAT',
    tax_rate            NUMERIC(5,2) NOT NULL DEFAULT 15,
    deposit_percentage  NUMERIC(5,2) NOT NULL DEFAULT 30,
    deposit_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
    balance_due         NUMERIC(12,2) NOT NULL DEFAULT 0,
    credited_invoice_id     UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
    credited_invoice_number TEXT NOT NULL DEFAULT '',
    credited_amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
    credit_note_id          UUID,
    credit_note_number      TEXT NOT NULL DEFAULT '',
    payment_reference       TEXT NOT NULL DEFAULT '',
    issued_date         DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date            DATE,
    bill_to_name        TEXT NOT NULL DEFAULT '',
    bill_to_email       TEXT NOT NULL DEFAULT '',
    bill_to_address     TEXT NOT NULL DEFAULT '',
    supplier_name       TEXT NOT NULL DEFAULT '',
    supplier_tax_number TEXT NOT NULL DEFAULT '',
    supplier_address    TEXT NOT NULL DEFAULT '',
    bank_details        JSONB NOT NULL DEFAULT '{}'::jsonb,
    accounting_export   JSONB NOT NULL DEFAULT '{}'::jsonb,
    notes               TEXT,
    void_reason         TEXT,
    paid_at             TIMESTAMP WITH TIME ZONE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS itinerary_id        UUID REFERENCES public.itineraries(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS client_id           UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invoice_number      TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS invoice_type        TEXT NOT NULL DEFAULT 'final',
  ADD COLUMN IF NOT EXISTS status              TEXT NOT NULL DEFAULT 'validated',
  ADD COLUMN IF NOT EXISTS currency_code       TEXT NOT NULL DEFAULT 'ZAR',
  ADD COLUMN IF NOT EXISTS subtotal_excl       NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_total           NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_incl          NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_label           TEXT NOT NULL DEFAULT 'VAT',
  ADD COLUMN IF NOT EXISTS tax_rate            NUMERIC(5,2) NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS deposit_percentage  NUMERIC(5,2) NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS deposit_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_due         NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credited_invoice_id     UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS credited_invoice_number TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS credited_amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_note_id          UUID,
  ADD COLUMN IF NOT EXISTS credit_note_number      TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS payment_reference       TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS issued_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS due_date            DATE,
  ADD COLUMN IF NOT EXISTS bill_to_name        TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bill_to_email       TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bill_to_address     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS supplier_name       TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS supplier_tax_number TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS supplier_address    TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bank_details        JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS accounting_export   JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS notes               TEXT,
  ADD COLUMN IF NOT EXISTS void_reason         TEXT,
  ADD COLUMN IF NOT EXISTS paid_at             TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS created_at          TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;

-- Status also allows 'proforma' (a deposit request raised before payment lands).
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_status_check CHECK (status IN ('proforma', 'validated', 'paid', 'void'));

CREATE UNIQUE INDEX IF NOT EXISTS invoices_company_number_idx ON public.invoices (company_id, invoice_number);
-- One live deposit / final invoice per (itinerary, currency); voided rows may be re-issued.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_live_itinerary_currency_idx
  ON public.invoices (itinerary_id, currency_code, invoice_type) WHERE status <> 'void';
CREATE INDEX IF NOT EXISTS invoices_company_idx   ON public.invoices (company_id);
CREATE INDEX IF NOT EXISTS invoices_itinerary_idx ON public.invoices (itinerary_id);
CREATE INDEX IF NOT EXISTS invoices_status_idx    ON public.invoices (status);

-- ─── STEP 6: invoice_line_items — pure snapshot of the itinerary services ────
CREATE TABLE IF NOT EXISTS public.invoice_line_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id      UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
    company_id      UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    day_number      INTEGER NOT NULL DEFAULT 1,
    service_date    DATE,
    item_name       TEXT NOT NULL DEFAULT '',
    category        TEXT,
    supplier_name   TEXT,
    quantity        INTEGER NOT NULL DEFAULT 1,
    unit_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
    subtotal_excl   NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
    line_total      NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax_label       TEXT NOT NULL DEFAULT 'VAT',
    tax_rate        NUMERIC(5,2) NOT NULL DEFAULT 15,
    currency_code   TEXT NOT NULL DEFAULT 'ZAR',
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.invoice_line_items
  ADD COLUMN IF NOT EXISTS company_id    UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS day_number    INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS service_date  DATE,
  ADD COLUMN IF NOT EXISTS item_name     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS category      TEXT,
  ADD COLUMN IF NOT EXISTS supplier_name TEXT,
  ADD COLUMN IF NOT EXISTS quantity      INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS unit_price    NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subtotal_excl NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_total    NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_label     TEXT NOT NULL DEFAULT 'VAT',
  ADD COLUMN IF NOT EXISTS tax_rate      NUMERIC(5,2) NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'ZAR',
  ADD COLUMN IF NOT EXISTS sort_order    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at    TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;

CREATE INDEX IF NOT EXISTS invoice_line_items_invoice_idx ON public.invoice_line_items (invoice_id);

-- ─── STEP 6b: invoice_receipts — proof of payment against a paid invoice ─────
-- A receipt is only ever produced once the payment has been confirmed received
-- in the bank account. It is immutable like the invoice it settles and carries
-- the same stable numbering guarantee for the accounting connectors.
CREATE TABLE IF NOT EXISTS public.invoice_receipts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    invoice_id          UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
    receipt_number      TEXT NOT NULL,
    invoice_number      TEXT NOT NULL DEFAULT '',
    invoice_type        TEXT NOT NULL DEFAULT 'final',
    currency_code       TEXT NOT NULL DEFAULT 'ZAR',
    amount              NUMERIC(12,2) NOT NULL DEFAULT 0,
    balance_remaining   NUMERIC(12,2) NOT NULL DEFAULT 0,
    received_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    payment_method      TEXT NOT NULL DEFAULT '',
    payment_reference   TEXT NOT NULL DEFAULT '',
    bill_to_name        TEXT NOT NULL DEFAULT '',
    bill_to_email       TEXT NOT NULL DEFAULT '',
    supplier_name       TEXT NOT NULL DEFAULT '',
    supplier_tax_number TEXT NOT NULL DEFAULT '',
    supplier_address    TEXT NOT NULL DEFAULT '',
    bank_details        JSONB NOT NULL DEFAULT '{}'::jsonb,
    accounting_export   JSONB NOT NULL DEFAULT '{}'::jsonb,
    notes               TEXT,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.invoice_receipts
  ADD COLUMN IF NOT EXISTS invoice_number      TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS invoice_type        TEXT NOT NULL DEFAULT 'final',
  ADD COLUMN IF NOT EXISTS currency_code       TEXT NOT NULL DEFAULT 'ZAR',
  ADD COLUMN IF NOT EXISTS amount              NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_remaining   NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS received_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS payment_method      TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS payment_reference   TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bill_to_name        TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bill_to_email       TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS supplier_name       TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS supplier_tax_number TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS supplier_address    TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bank_details        JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS accounting_export   JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS notes               TEXT,
  ADD COLUMN IF NOT EXISTS created_at          TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invoice_receipts_company_number_idx ON public.invoice_receipts (company_id, receipt_number);
CREATE INDEX IF NOT EXISTS invoice_receipts_invoice_idx ON public.invoice_receipts (invoice_id);
CREATE INDEX IF NOT EXISTS invoice_receipts_company_idx ON public.invoice_receipts (company_id);

-- ─── STEP 6c: credit notes — every void is reversed so the account balances ──
-- A credit note is immutable and mints its own per-tenant number. Voiding an
-- invoice ALWAYS creates one, so the client account nets to zero and the
-- itinerary/currency slot is freed for a replacement invoice.
CREATE TABLE IF NOT EXISTS public.credit_note_ref_counters (
    company_id  UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
    last_value  INTEGER NOT NULL DEFAULT 0,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.credit_note_ref_counters
  ADD COLUMN IF NOT EXISTS last_value INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;

CREATE OR REPLACE FUNCTION public.get_next_credit_note_reference(p_company_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_next      INTEGER;
  v_year      TEXT;
  v_reference TEXT;
  v_prefix    TEXT;
BEGIN
  INSERT INTO public.credit_note_ref_counters (company_id, last_value)
  VALUES (p_company_id, 1)
  ON CONFLICT (company_id)
  DO UPDATE SET last_value = public.credit_note_ref_counters.last_value + 1,
                updated_at = timezone('utc'::text, now())
  RETURNING last_value INTO v_next;

  SELECT COALESCE(NULLIF(credit_note_prefix, ''), 'CRN') INTO v_prefix
  FROM public.company_billing_settings WHERE company_id = p_company_id;
  IF v_prefix IS NULL THEN v_prefix := 'CRN'; END IF;

  v_year := to_char(timezone('utc'::text, now()), 'YYYY');
  v_reference := v_prefix || '-' || v_year || '-' || lpad(v_next::text, 6, '0');
  RETURN v_reference;
END;
$$;

CREATE TABLE IF NOT EXISTS public.credit_notes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    invoice_id          UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
    invoice_number      TEXT NOT NULL DEFAULT '',
    invoice_type        TEXT NOT NULL DEFAULT 'final',
    credit_note_number  TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'void')),
    currency_code       TEXT NOT NULL DEFAULT 'ZAR',
    subtotal_excl       NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax_total           NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_incl          NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax_label           TEXT NOT NULL DEFAULT 'VAT',
    tax_rate            NUMERIC(5,2) NOT NULL DEFAULT 15,
    reason              TEXT NOT NULL DEFAULT '',
    issued_date         DATE NOT NULL DEFAULT CURRENT_DATE,
    bill_to_name        TEXT NOT NULL DEFAULT '',
    bill_to_email       TEXT NOT NULL DEFAULT '',
    bill_to_address     TEXT NOT NULL DEFAULT '',
    supplier_name       TEXT NOT NULL DEFAULT '',
    supplier_tax_number TEXT NOT NULL DEFAULT '',
    supplier_address    TEXT NOT NULL DEFAULT '',
    accounting_export   JSONB NOT NULL DEFAULT '{}'::jsonb,
    void_reason         TEXT,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.credit_notes
  ADD COLUMN IF NOT EXISTS invoice_number      TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS invoice_type        TEXT NOT NULL DEFAULT 'final',
  ADD COLUMN IF NOT EXISTS status              TEXT NOT NULL DEFAULT 'issued',
  ADD COLUMN IF NOT EXISTS currency_code       TEXT NOT NULL DEFAULT 'ZAR',
  ADD COLUMN IF NOT EXISTS subtotal_excl       NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_total           NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_incl          NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_label           TEXT NOT NULL DEFAULT 'VAT',
  ADD COLUMN IF NOT EXISTS tax_rate            NUMERIC(5,2) NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS reason              TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS issued_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS bill_to_name        TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bill_to_email       TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bill_to_address     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS supplier_name       TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS supplier_tax_number TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS supplier_address    TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS accounting_export   JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS void_reason         TEXT,
  ADD COLUMN IF NOT EXISTS created_at          TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS credit_notes_company_number_idx ON public.credit_notes (company_id, credit_note_number);
-- Exactly one reversal credit note per voided invoice.
CREATE UNIQUE INDEX IF NOT EXISTS credit_notes_invoice_idx ON public.credit_notes (invoice_id);
CREATE INDEX IF NOT EXISTS credit_notes_company_idx ON public.credit_notes (company_id);

-- ─── STEP 7: RLS — company-scoped like every other table ─────────────────────
ALTER TABLE public.company_billing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_bank_accounts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_ref_counters     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_ref_counters     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_line_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_receipts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_note_ref_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_notes             ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_billing_settings' AND policyname='Users manage company billing settings') THEN
    CREATE POLICY "Users manage company billing settings" ON public.company_billing_settings
      FOR ALL USING (company_id = public.get_user_company_id() OR public.is_super_admin())
      WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_bank_accounts' AND policyname='Users manage company bank accounts') THEN
    CREATE POLICY "Users manage company bank accounts" ON public.company_bank_accounts
      FOR ALL USING (company_id = public.get_user_company_id() OR public.is_super_admin())
      WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoices' AND policyname='Users manage company invoices') THEN
    CREATE POLICY "Users manage company invoices" ON public.invoices
      FOR ALL USING (company_id = public.get_user_company_id() OR public.is_super_admin())
      WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoice_line_items' AND policyname='Users manage company invoice lines') THEN
    CREATE POLICY "Users manage company invoice lines" ON public.invoice_line_items
      FOR ALL USING (company_id = public.get_user_company_id() OR public.is_super_admin())
      WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoice_ref_counters' AND policyname='Users view company invoice counters') THEN
    CREATE POLICY "Users view company invoice counters" ON public.invoice_ref_counters
      FOR SELECT USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='receipt_ref_counters' AND policyname='Users view company receipt counters') THEN
    CREATE POLICY "Users view company receipt counters" ON public.receipt_ref_counters
      FOR SELECT USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='invoice_receipts' AND policyname='Users manage company invoice receipts') THEN
    CREATE POLICY "Users manage company invoice receipts" ON public.invoice_receipts
      FOR ALL USING (company_id = public.get_user_company_id() OR public.is_super_admin())
      WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='credit_note_ref_counters' AND policyname='Users view company credit note counters') THEN
    CREATE POLICY "Users view company credit note counters" ON public.credit_note_ref_counters
      FOR SELECT USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='credit_notes' AND policyname='Users manage company credit notes') THEN
    CREATE POLICY "Users manage company credit notes" ON public.credit_notes
      FOR ALL USING (company_id = public.get_user_company_id() OR public.is_super_admin())
      WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
END $$;

-- ─── STEP 8: Auto-refresh updated_at ─────────────────────────────────────────
DROP TRIGGER IF EXISTS company_billing_settings_set_updated_at ON public.company_billing_settings;
CREATE TRIGGER company_billing_settings_set_updated_at
  BEFORE UPDATE ON public.company_billing_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS company_bank_accounts_set_updated_at ON public.company_bank_accounts;
CREATE TRIGGER company_bank_accounts_set_updated_at
  BEFORE UPDATE ON public.company_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS invoices_set_updated_at ON public.invoices;
CREATE TRIGGER invoices_set_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS credit_notes_set_updated_at ON public.credit_notes;
CREATE TRIGGER credit_notes_set_updated_at
  BEFORE UPDATE ON public.credit_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── STEP 9: Force PostgREST schema cache reload ─────────────────────────────
NOTIFY pgrst, 'reload schema';
