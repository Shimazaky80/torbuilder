-- =============================================================================
-- Migration: Create helper functions + patch tables + RLS policies
-- Safe to run on any database state — idempotent throughout
-- Run this in Supabase SQL Editor
-- =============================================================================

-- ─── STEP 1: Helper functions (must exist before RLS policies) ───────────────

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_super_admin = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_user_company_id()
RETURNS UUID AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ─── STEP 2: Patch suppliers table — add any missing columns ─────────────────
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS company_id           UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS category             TEXT,
  ADD COLUMN IF NOT EXISTS email                TEXT,
  ADD COLUMN IF NOT EXISTS phone                TEXT,
  ADD COLUMN IF NOT EXISTS website              TEXT,
  ADD COLUMN IF NOT EXISTS contact_person       TEXT,
  ADD COLUMN IF NOT EXISTS address              TEXT,
  ADD COLUMN IF NOT EXISTS country              TEXT,
  ADD COLUMN IF NOT EXISTS province_state       TEXT,
  ADD COLUMN IF NOT EXISTS city                 TEXT,
  ADD COLUMN IF NOT EXISTS city_location        TEXT,
  ADD COLUMN IF NOT EXISTS physical_address     TEXT,
  ADD COLUMN IF NOT EXISTS bank_name            TEXT,
  ADD COLUMN IF NOT EXISTS account_holder_name  TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_number  TEXT,
  ADD COLUMN IF NOT EXISTS branch_code          TEXT,
  ADD COLUMN IF NOT EXISTS swift_code           TEXT,
  ADD COLUMN IF NOT EXISTS is_active            BOOLEAN DEFAULT true;

-- ─── STEP 3: Create library_items table if missing ───────────────────────────
CREATE TABLE IF NOT EXISTS public.library_items (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id    UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    supplier_id   UUID REFERENCES public.suppliers(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    category      TEXT NOT NULL DEFAULT 'General',
    sub_category  TEXT,
    description   TEXT,
    location      TEXT,
    currency      TEXT DEFAULT 'ZAR',
    max_occupancy INTEGER DEFAULT 2,
    images        JSONB DEFAULT '[]'::jsonb,
    is_active     BOOLEAN DEFAULT true,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Patch library_items if it existed before (add missing columns)
ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS company_id    UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS supplier_id   UUID REFERENCES public.suppliers(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS description   TEXT,
  ADD COLUMN IF NOT EXISTS currency      TEXT DEFAULT 'ZAR',
  ADD COLUMN IF NOT EXISTS max_occupancy INTEGER DEFAULT 2,
  ADD COLUMN IF NOT EXISTS images        JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sub_category  TEXT,
  ADD COLUMN IF NOT EXISTS location      TEXT,
  ADD COLUMN IF NOT EXISTS is_active     BOOLEAN DEFAULT true;

-- ─── STEP 4: Create item_rates table if missing ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.item_rates (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id           UUID NOT NULL REFERENCES public.library_items(id) ON DELETE CASCADE,
    option_name       TEXT DEFAULT 'Base Season',
    season_name       TEXT DEFAULT 'Base Season',
    valid_from        DATE,
    valid_to          DATE,
    price_1_adult     NUMERIC(10,2) DEFAULT 0,
    price_2_adults    NUMERIC(10,2) DEFAULT 0,
    price_child_0_5   NUMERIC(10,2) DEFAULT 0,
    price_child_6_11  NUMERIC(10,2) DEFAULT 0,
    price_child_12_17 NUMERIC(10,2) DEFAULT 0,
    single_supplement NUMERIC(10,2) DEFAULT 0,
    child_discount    NUMERIC(5,2)  DEFAULT 0,
    notes             TEXT,
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ─── STEP 5: Enable RLS ──────────────────────────────────────────────────────
ALTER TABLE public.suppliers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_rates    ENABLE ROW LEVEL SECURITY;

-- ─── STEP 6: RLS for suppliers ───────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='suppliers' AND policyname='Users can view company suppliers') THEN
    CREATE POLICY "Users can view company suppliers" ON public.suppliers
      FOR SELECT USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='suppliers' AND policyname='Users can insert company suppliers') THEN
    CREATE POLICY "Users can insert company suppliers" ON public.suppliers
      FOR INSERT WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='suppliers' AND policyname='Users can update company suppliers') THEN
    CREATE POLICY "Users can update company suppliers" ON public.suppliers
      FOR UPDATE USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='suppliers' AND policyname='Users can delete company suppliers') THEN
    CREATE POLICY "Users can delete company suppliers" ON public.suppliers
      FOR DELETE USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
END $$;

-- ─── STEP 7: RLS for library_items ───────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='library_items' AND policyname='Users can view company library items') THEN
    CREATE POLICY "Users can view company library items" ON public.library_items
      FOR SELECT USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='library_items' AND policyname='Users can insert company library items') THEN
    CREATE POLICY "Users can insert company library items" ON public.library_items
      FOR INSERT WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='library_items' AND policyname='Users can update company library items') THEN
    CREATE POLICY "Users can update company library items" ON public.library_items
      FOR UPDATE USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='library_items' AND policyname='Users can delete company library items') THEN
    CREATE POLICY "Users can delete company library items" ON public.library_items
      FOR DELETE USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
END $$;

-- ─── STEP 8: RLS for item_rates ──────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='item_rates' AND policyname='Users can view item rates') THEN
    CREATE POLICY "Users can view item rates" ON public.item_rates
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.library_items
          WHERE library_items.id = item_rates.item_id
            AND (library_items.company_id = public.get_user_company_id() OR public.is_super_admin())
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='item_rates' AND policyname='Users can insert item rates') THEN
    CREATE POLICY "Users can insert item rates" ON public.item_rates
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.library_items
          WHERE library_items.id = item_rates.item_id
            AND (library_items.company_id = public.get_user_company_id() OR public.is_super_admin())
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='item_rates' AND policyname='Users can update item rates') THEN
    CREATE POLICY "Users can update item rates" ON public.item_rates
      FOR UPDATE USING (
        EXISTS (
          SELECT 1 FROM public.library_items
          WHERE library_items.id = item_rates.item_id
            AND (library_items.company_id = public.get_user_company_id() OR public.is_super_admin())
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='item_rates' AND policyname='Users can delete item rates') THEN
    CREATE POLICY "Users can delete item rates" ON public.item_rates
      FOR DELETE USING (
        EXISTS (
          SELECT 1 FROM public.library_items
          WHERE library_items.id = item_rates.item_id
            AND (library_items.company_id = public.get_user_company_id() OR public.is_super_admin())
        )
      );
  END IF;
END $$;

-- ─── STEP 9: Force PostgREST schema cache reload ─────────────────────────────
NOTIFY pgrst, 'reload schema';
