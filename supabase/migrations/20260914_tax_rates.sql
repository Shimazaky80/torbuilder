-- =============================================================================
-- Migration: Tax rates (VAT / sales tax configuration) (patch-style, idempotent)
-- Run in Supabase Dashboard -> SQL Editor (one block, one run)
--
-- VAT is destination-based: tenants are charged tax by their local authority for
-- services rendered. The app ships with a default 15% VAT (South Africa) for every
-- tenant, and the tenant admin manages their own tax types under Settings -> Taxes,
-- so tenants outside South Africa can add the tax rules for their own region.
--
-- How tax is applied in the itinerary costing:
--   Sell (Net) = buy × (1 + markup%)   -- markup is baked into sell first
--   VAT        = Sell line × (rate/100) -- tax layered on top of the marked-up price
--   Total      = Sell + VAT
--
-- Each itinerary day item snapshots the tax label + rate that applied when the
-- quote was created (tax_label, tax_rate). A saved quote therefore keeps its
-- original rate even if the tenant later changes tax_rates — critical because a
-- quote exported months later must reflect the rate at quote time, not today.
-- =============================================================================

-- ─── STEP 1: tax_rates — the tax types configured per tenant ─────────────────
-- `country` is the jurisdiction the tax applies to. Every tenant in South
-- Africa ships with VAT (Value Added Tax) as the default tax type.
CREATE TABLE IF NOT EXISTS public.tax_rates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    code        TEXT NOT NULL DEFAULT 'VAT',
    rate        NUMERIC(5,2) NOT NULL DEFAULT 15,
    country     TEXT NOT NULL DEFAULT 'South Africa',
    applies_to  TEXT NOT NULL DEFAULT 'all',
    is_default  BOOLEAN NOT NULL DEFAULT false,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.tax_rates
  ADD COLUMN IF NOT EXISTS company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS name        TEXT NOT NULL DEFAULT 'Value Added Tax (VAT)',
  ADD COLUMN IF NOT EXISTS code        TEXT NOT NULL DEFAULT 'VAT',
  ADD COLUMN IF NOT EXISTS rate        NUMERIC(5,2) NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS country     TEXT NOT NULL DEFAULT 'South Africa',
  ADD COLUMN IF NOT EXISTS applies_to  TEXT NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS is_default  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at  TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;

CREATE INDEX IF NOT EXISTS tax_rates_company_id_idx ON public.tax_rates (company_id);

-- ─── STEP 2: Day items gain a per-line tax snapshot ──────────────────────────
-- `tax_rate`  = the percentage applied to this service's Sell line (15.00 = 15%)
-- `tax_label` = human label captured at quote time, e.g. 'VAT' or 'Sales Tax'
CREATE TABLE IF NOT EXISTS public.itinerary_day_items (
    id                               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    itinerary_day_id                 UUID NOT NULL REFERENCES public.itinerary_days(id) ON DELETE CASCADE,
    company_id                       UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    item_id                          UUID REFERENCES public.library_items(id) ON DELETE SET NULL,
    item_name                        TEXT NOT NULL DEFAULT '',
    description_override             TEXT,
    category                         TEXT,
    supplier_name                    TEXT,
    currency_code                    TEXT NOT NULL DEFAULT 'ZAR',
    unit_cost                        NUMERIC(12,2) NOT NULL DEFAULT 0,
    unit_price                       NUMERIC(12,2) NOT NULL DEFAULT 0,
    markup_percentage                NUMERIC(12,2) NOT NULL DEFAULT 0,
    rate_basis                       TEXT NOT NULL DEFAULT 'per_person',
    item_price_per_person            NUMERIC(12,2) NOT NULL DEFAULT 0,
    selling_price_per_person_override NUMERIC(12,2),
    custom_item_selling_price_pp     NUMERIC(12,2),
    quantity                         INTEGER NOT NULL DEFAULT 1,
    pax                              INTEGER NOT NULL DEFAULT 1,
    total_buy                        NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_sell                       NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax_rate                         NUMERIC(5,2) NOT NULL DEFAULT 15,
    tax_label                        TEXT NOT NULL DEFAULT 'VAT',
    is_included                      BOOLEAN NOT NULL DEFAULT true,
    notes                            TEXT,
    sort_order                       INTEGER NOT NULL DEFAULT 0,
    created_at                       TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at                       TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.itinerary_day_items
  ADD COLUMN IF NOT EXISTS itinerary_day_id                 UUID REFERENCES public.itinerary_days(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS company_id                       UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS item_id                          UUID REFERENCES public.library_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS item_name                        TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS description_override             TEXT,
  ADD COLUMN IF NOT EXISTS category                         TEXT,
  ADD COLUMN IF NOT EXISTS supplier_name                    TEXT,
  ADD COLUMN IF NOT EXISTS currency_code                    TEXT NOT NULL DEFAULT 'ZAR',
  ADD COLUMN IF NOT EXISTS unit_cost                        NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_price                       NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS markup_percentage                NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rate_basis                       TEXT NOT NULL DEFAULT 'per_person',
  ADD COLUMN IF NOT EXISTS item_price_per_person            NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS selling_price_per_person_override NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS custom_item_selling_price_pp     NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS quantity                         INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pax                              INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS total_buy                        NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_sell                       NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_rate                         NUMERIC(5,2) NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS tax_label                        TEXT NOT NULL DEFAULT 'VAT',
  ADD COLUMN IF NOT EXISTS is_included                      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notes                            TEXT,
  ADD COLUMN IF NOT EXISTS sort_order                       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at                       TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  ADD COLUMN IF NOT EXISTS updated_at                       TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;

-- ─── STEP 3: Seed the default tax for every tenant ───────────────────────────
-- Ships as 15% VAT (South Africa) so each tenant has a working default out of the
-- box. Admin can edit it or add their own region's tax types in Settings -> Taxes.
INSERT INTO public.tax_rates (company_id, name, code, rate, country, applies_to, is_default, is_active)
SELECT
    c.id,
    'Value Added Tax (VAT)',
    'VAT',
    15,
    'South Africa',
    'all',
    true,
    true
FROM public.companies c
WHERE NOT EXISTS (
    SELECT 1 FROM public.tax_rates t WHERE t.company_id = c.id
);

-- ─── STEP 4: RLS — company-scoped like every other table ─────────────────────
ALTER TABLE public.tax_rates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tax_rates' AND policyname='Users can view company tax rates') THEN
    CREATE POLICY "Users can view company tax rates" ON public.tax_rates
      FOR SELECT USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tax_rates' AND policyname='Users can insert company tax rates') THEN
    CREATE POLICY "Users can insert company tax rates" ON public.tax_rates
      FOR INSERT WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tax_rates' AND policyname='Users can update company tax rates') THEN
    CREATE POLICY "Users can update company tax rates" ON public.tax_rates
      FOR UPDATE USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tax_rates' AND policyname='Users can delete company tax rates') THEN
    CREATE POLICY "Users can delete company tax rates" ON public.tax_rates
      FOR DELETE USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
END $$;

-- ─── STEP 5: Auto-refresh updated_at on row changes ──────────────────────────
DROP TRIGGER IF EXISTS tax_rates_set_updated_at ON public.tax_rates;
CREATE TRIGGER tax_rates_set_updated_at
  BEFORE UPDATE ON public.tax_rates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── STEP 6: Force PostgREST schema cache reload ─────────────────────────────
NOTIFY pgrst, 'reload schema';