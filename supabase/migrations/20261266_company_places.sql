-- =============================================================================
-- Migration: Tenant destinations alongside the shared place catalogue
--
-- app_places began as a shared reference table: the map of a country is the
-- same for every operator, so only a super admin wrote it and the seed shipped
-- the towns. That works until a tenant needs a place the platform's seed does
-- not carry — a lodge's nearest village, a new border post, a town in a country
-- nobody seeded yet — and the only way to add it is database access.
--
-- This is the same split the national tour types and vehicle sizes use:
--
--   company_id IS NULL   the standard place every tenant reads
--   company_id = <id>    that tenant's own destination, private to them
--
-- A tenant can add, rename, deactivate and delete its own rows. It cannot edit
-- a standard row, and it cannot see another tenant's rows. A saved day keeps
-- its own copy of the destination name and region, so renaming or deleting a
-- catalogue row never rewrites an itinerary or a traveller document.
--
-- The single (country, province, place) unique constraint splits into a partial
-- index for the national rows and one per company. A btree treats every NULL
-- company as distinct, so a plain (company_id, ...) index would let the national
-- seed be inserted twice; the partial indexes keep each half honest.
-- =============================================================================

-- ─── STEP 1: company ownership and an edit stamp ─────────────────────────────
ALTER TABLE public.app_places
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

ALTER TABLE public.app_places
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());

COMMENT ON COLUMN public.app_places.company_id IS
  'NULL for a standard place every tenant reads; a company id is that tenant''s own destination.';

-- ─── STEP 2: paired unique keys ──────────────────────────────────────────────
-- The national half keeps the exact case-sensitive key the seed and its
-- ON CONFLICT clauses already use. The tenant half folds case, because a person
-- typing "windhoek" should not create a second Windhoek next to the one they
-- already added.
ALTER TABLE public.app_places DROP CONSTRAINT IF EXISTS app_places_place_key;

CREATE UNIQUE INDEX IF NOT EXISTS app_places_national_place_key
  ON public.app_places (country, province, place)
  WHERE company_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS app_places_company_place_key
  ON public.app_places (company_id, lower(country), lower(province), lower(place))
  WHERE company_id IS NOT NULL;

-- The picker reads one country at a time, and the Settings card lists a
-- company's own rows first.
CREATE INDEX IF NOT EXISTS app_places_company_country_idx
  ON public.app_places (company_id, country)
  WHERE company_id IS NOT NULL;

-- ─── STEP 3: RLS — read the shared rows, write only your own ─────────────────
-- The old SELECT policy let every authenticated session read every row. That is
-- no longer true once a row can belong to one tenant: it would expose another
-- company's private destinations. The new read policy keeps the standard list
-- public to signed-in users and narrows the rest to the caller's company.
--
-- Writes stay tenant-only and require settings write, so a consultant or a
-- viewer cannot add a destination. A super admin keeps the platform half.
DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can view app places" ON public.app_places;
  DROP POLICY IF EXISTS "Super admins can manage app places" ON public.app_places;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='app_places' AND policyname='Places are read shared or own') THEN
    CREATE POLICY "Places are read shared or own" ON public.app_places
      FOR SELECT USING (
        company_id IS NULL
        OR company_id = public.get_user_company_id()
        OR public.is_super_admin()
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='app_places' AND policyname='Places are written by their company') THEN
    CREATE POLICY "Places are written by their company" ON public.app_places
      FOR INSERT WITH CHECK (
        public.is_super_admin()
        OR (
          company_id = public.get_user_company_id()
          AND public.user_module_access('settings') = 'write'
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='app_places' AND policyname='Places are updated by their company') THEN
    CREATE POLICY "Places are updated by their company" ON public.app_places
      FOR UPDATE USING (
        public.is_super_admin()
        OR (
          company_id = public.get_user_company_id()
          AND public.user_module_access('settings') = 'write'
        )
      )
      WITH CHECK (
        public.is_super_admin()
        OR (
          company_id = public.get_user_company_id()
          AND public.user_module_access('settings') = 'write'
        )
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='app_places' AND policyname='Places are deleted by their company') THEN
    CREATE POLICY "Places are deleted by their company" ON public.app_places
      FOR DELETE USING (
        public.is_super_admin()
        OR (
          company_id = public.get_user_company_id()
          AND public.user_module_access('settings') = 'write'
        )
      );
  END IF;
END $$;

-- The grants from 20261253 already cover SELECT/INSERT/UPDATE/DELETE for
-- authenticated sessions; RLS is what decides which rows each one may touch.
