-- =============================================================================
-- Migration: Itineraries (patch-style, idempotent)
-- Safe to run on any database state — mirrors the suppliers/clients patch pattern.
-- Company-scoped itinerary header rows. Each itinerary is created from the
-- "Client & Tour" form and later expanded by the itinerary builder (days + items).
-- Traveller names/surnames/ages are stored in `travellers` (JSONB) so child ages
-- are preserved for correct per-supplier child pricing.
--
-- Reference numbers: uniquely generated per company as IT-YYYY-NNNNNN via a
-- per-company counter so concurrent creations never collide. The reference is
-- the stable public identifier used on invoices and throughout the itinerary's
-- life.
-- Run in Supabase Dashboard -> SQL Editor (one block, one run)
-- =============================================================================

-- ─── STEP 1: Create table if missing ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.itineraries (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    client_id           UUID REFERENCES public.clients(id),
    reference_number    TEXT,
    itinerary_name      TEXT NOT NULL,
    travel_start_date   DATE,
    travel_end_date     DATE,
    num_adults          INTEGER NOT NULL DEFAULT 0,
    num_children        INTEGER NOT NULL DEFAULT 0,
    travellers          JSONB NOT NULL DEFAULT '[]'::jsonb,
    agency_reference    TEXT,
    destination_country TEXT,
    destination_province TEXT,
    destination_region  TEXT,
    currency_code       TEXT NOT NULL DEFAULT 'ZAR',
    status              TEXT NOT NULL DEFAULT 'quotation',
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ─── STEP 2: Patch table — add any missing columns (safe on existing tables) ─
ALTER TABLE public.itineraries
  ADD COLUMN IF NOT EXISTS company_id          UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS client_id           UUID REFERENCES public.clients(id),
  ADD COLUMN IF NOT EXISTS reference_number    TEXT,
  ADD COLUMN IF NOT EXISTS itinerary_name      TEXT NOT NULL DEFAULT 'Untitled Itinerary',
  ADD COLUMN IF NOT EXISTS travel_start_date   DATE,
  ADD COLUMN IF NOT EXISTS travel_end_date     DATE,
  ADD COLUMN IF NOT EXISTS num_adults          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS num_children        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS travellers          JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS agency_reference    TEXT,
  ADD COLUMN IF NOT EXISTS destination_country TEXT,
  ADD COLUMN IF NOT EXISTS destination_province TEXT,
  ADD COLUMN IF NOT EXISTS destination_region  TEXT,
  ADD COLUMN IF NOT EXISTS currency_code       TEXT NOT NULL DEFAULT 'ZAR',
  ADD COLUMN IF NOT EXISTS status              TEXT NOT NULL DEFAULT 'quotation',
  ADD COLUMN IF NOT EXISTS created_at          TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;

-- ─── STEP 3: Indexes ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS itineraries_company_id_idx ON public.itineraries (company_id);
CREATE INDEX IF NOT EXISTS itineraries_client_id_idx  ON public.itineraries (client_id);

-- ─── STEP 4: Reference number counters ────────────────────────────────────────
-- A lock-safe per-company counter. Each call to get_next_itinerary_reference()
-- atomically increments last_value (INSERT ... ON CONFLICT serializes on the
-- company_id row) and returns IT-YYYY-NNNNNN. Unique per company, forever.
CREATE TABLE IF NOT EXISTS public.itinerary_ref_counters (
    company_id  UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
    last_value  INTEGER NOT NULL DEFAULT 0,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.itinerary_ref_counters
  ADD COLUMN IF NOT EXISTS last_value  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;

CREATE OR REPLACE FUNCTION public.get_next_itinerary_reference(p_company_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_next     INTEGER;
  v_year     TEXT;
  v_reference TEXT;
BEGIN
  INSERT INTO public.itinerary_ref_counters (company_id, last_value)
  VALUES (p_company_id, 1)
  ON CONFLICT (company_id)
  DO UPDATE SET last_value = public.itinerary_ref_counters.last_value + 1,
                updated_at = timezone('utc'::text, now())
  RETURNING last_value INTO v_next;

  v_year := to_char(timezone('utc'::text, now()), 'YYYY');
  v_reference := 'IT-' || v_year || '-' || lpad(v_next::text, 6, '0');
  RETURN v_reference;
END;
$$;

-- Reference is the stable public identifier — unique within each company.
CREATE UNIQUE INDEX IF NOT EXISTS itineraries_company_reference_idx
  ON public.itineraries (company_id, reference_number);

-- ─── STEP 5: RLS — company-scoped via the parent company ─────────────────────
ALTER TABLE public.itineraries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='itineraries' AND policyname='Users can view company itineraries') THEN
    CREATE POLICY "Users can view company itineraries" ON public.itineraries
      FOR SELECT USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='itineraries' AND policyname='Users can insert company itineraries') THEN
    CREATE POLICY "Users can insert company itineraries" ON public.itineraries
      FOR INSERT WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='itineraries' AND policyname='Users can update company itineraries') THEN
    CREATE POLICY "Users can update company itineraries" ON public.itineraries
      FOR UPDATE USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='itineraries' AND policyname='Users can delete company itineraries') THEN
    CREATE POLICY "Users can delete company itineraries" ON public.itineraries
      FOR DELETE USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
END $$;

-- ─── STEP 6: Auto-refresh updated_at on row changes ──────────────────────────
DROP TRIGGER IF EXISTS itineraries_set_updated_at ON public.itineraries;
CREATE TRIGGER itineraries_set_updated_at
  BEFORE UPDATE ON public.itineraries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── STEP 7: Force PostgREST schema cache reload ─────────────────────────────
NOTIFY pgrst, 'reload schema';