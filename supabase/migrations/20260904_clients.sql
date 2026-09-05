-- =============================================================================
-- Migration: Clients (patch-style, idempotent)
-- Safe to run on any database state — mirrors the suppliers patch pattern.
-- Company-scoped client records. Two client types are supported:
--   - 'Direct'            : individual / company buying directly from us
--   - 'Travel Agency'     : a tour operator / travel agency reselling to
--                           their own clients
-- Direct clients and agencies carry a different markup_percentage (used by the
-- itinerary pricing engine) and can later have type-specific terms & conditions.
-- =============================================================================

-- ─── STEP 1: Create table if missing ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.clients (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id        UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    email             TEXT,
    phone             TEXT,
    client_type       TEXT NOT NULL DEFAULT 'Direct'
                      CHECK (client_type IN ('Direct', 'Travel Agency')),
    country           TEXT,
    markup_percentage NUMERIC(8,4) NOT NULL DEFAULT 0,
    address           TEXT,
    notes             TEXT,
    is_active         BOOLEAN NOT NULL DEFAULT true,
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at        TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ─── STEP 2: Patch table — add any missing columns (safe on existing tables) ─
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS company_id        UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS name              TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS email             TEXT,
  ADD COLUMN IF NOT EXISTS phone             TEXT,
  ADD COLUMN IF NOT EXISTS client_type       TEXT NOT NULL DEFAULT 'Direct'
                                             CHECK (client_type IN ('Direct', 'Travel Agency')),
  ADD COLUMN IF NOT EXISTS country           TEXT,
  ADD COLUMN IF NOT EXISTS markup_percentage NUMERIC(8,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS address           TEXT,
  ADD COLUMN IF NOT EXISTS notes             TEXT,
  ADD COLUMN IF NOT EXISTS is_active         BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at        TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;

-- ─── STEP 3: Index to fetch all clients of a company quickly ─────────────────
CREATE INDEX IF NOT EXISTS clients_company_id_idx ON public.clients (company_id);

-- ─── STEP 4: Enable RLS: clients are company-scoped via the parent company ────
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- ─── STEP 5: RLS policies mirror suppliers (company-scoped) ──────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='clients' AND policyname='Users can view company clients') THEN
    CREATE POLICY "Users can view company clients" ON public.clients
      FOR SELECT USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='clients' AND policyname='Users can insert company clients') THEN
    CREATE POLICY "Users can insert company clients" ON public.clients
      FOR INSERT WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='clients' AND policyname='Users can update company clients') THEN
    CREATE POLICY "Users can update company clients" ON public.clients
      FOR UPDATE USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='clients' AND policyname='Users can delete company clients') THEN
    CREATE POLICY "Users can delete company clients" ON public.clients
      FOR DELETE USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
END $$;

-- ─── STEP 6: Auto-refresh updated_at on row changes ──────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS clients_set_updated_at ON public.clients;
CREATE TRIGGER clients_set_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── STEP 7: Force PostgREST schema cache reload ─────────────────────────────
NOTIFY pgrst, 'reload schema';