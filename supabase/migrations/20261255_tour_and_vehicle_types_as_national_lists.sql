-- =============================================================================
-- Migration: Tour types and vehicle types as national lists
--
-- Every company on the platform was seeded the same four tour types and the same
-- five vehicle sizes, row for row. That copy is not tenant data — it is the
-- platform's vocabulary, and it went wrong in the way a duplicated vocabulary
-- always does: a tenant who wants to rename "Combi" to "16-seater Combi" or to
-- drop "Incentives" edits their own row and loses whatever the national list
-- decides to add next year, while a tenant who never touched anything carries a
-- private copy of a list nobody maintains.
--
-- This is the pattern the shared reference data already uses (app_countries,
-- app_places, library_categories): the platform owns the list, every
-- authenticated session reads it, only a super admin writes it. Here it is one
-- step further, because unlike a country these two lists a tenant genuinely may
-- need to differ on. A row with company_id IS NULL is the national answer. A row
-- carrying the tenant's own company_id is that tenant's override, and it wins.
-- The tenant's list is the national rows plus their own, minus any national row
-- they have overridden with the same key.
--
-- The keys stay exactly as they were. A rate row's prices_by_vehicle map is
-- keyed on `code` and an itinerary's tour type is stored as text, so existing
-- quotes resolve against a national row the same way they resolved against their
-- own copy; no snapshot is rewritten and nothing saved changes price.
--
-- Existing tenant rows are deleted only where the copy is untouched: same code,
-- same name, same capacity, same active flag as the national row. A rename, a
-- resized vehicle or a deliberately deactivated type survives as the override it
-- already is. A tenant who added a type the platform does not have keeps it.
--
-- The unique constraints split to match. A single (company_id, code) index would
-- treat every NULL company as distinct and let the national list be seeded twice,
-- so each table gets a partial index on the national rows and a partial index per
-- company, and the read path is the only thing that has to know about both.
-- =============================================================================

-- ─── STEP 1: company_id becomes nullable on both tables ──────────────────────
ALTER TABLE public.company_tour_types
  ALTER COLUMN company_id DROP NOT NULL;

ALTER TABLE public.company_vehicle_types
  ALTER COLUMN company_id DROP NOT NULL;

-- ─── STEP 2: paired unique keys ──────────────────────────────────────────────
-- One national row per name/code, one per company. The old plain indexes are
-- dropped because a btree cannot enforce either half while company_id is nullable
-- (NULLs never collide), and leaving them would let a second "Saloon" be seeded.
DROP INDEX IF EXISTS public.company_tour_types_company_name_idx;
CREATE UNIQUE INDEX IF NOT EXISTS company_tour_types_national_name_key
  ON public.company_tour_types (lower(name))
  WHERE company_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS company_tour_types_company_name_key
  ON public.company_tour_types (company_id, lower(name))
  WHERE company_id IS NOT NULL;

DROP INDEX IF EXISTS public.company_vehicle_types_company_code_idx;
DROP INDEX IF EXISTS public.company_vehicle_types_company_name_idx;
CREATE UNIQUE INDEX IF NOT EXISTS company_vehicle_types_national_code_key
  ON public.company_vehicle_types (code)
  WHERE company_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS company_vehicle_types_national_name_key
  ON public.company_vehicle_types (lower(name))
  WHERE company_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS company_vehicle_types_company_code_key
  ON public.company_vehicle_types (company_id, code)
  WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS company_vehicle_types_company_name_key
  ON public.company_vehicle_types (company_id, lower(name))
  WHERE company_id IS NOT NULL;

-- The capacity resolution (smallest vehicle that seats the party) reads the
-- merged list, so the index has to serve national and tenant rows alike.
CREATE INDEX IF NOT EXISTS company_vehicle_types_capacity_idx
  ON public.company_vehicle_types (max_capacity)
  WHERE is_active;

-- ─── STEP 3: RLS — read the shared rows, write only your own ─────────────────
-- The single FOR ALL policy each table had cannot express this: its predicate is
-- NULL for a shared row, which silently hides the national list instead of
-- refusing a write to it. SELECT is widened, the write path is left exactly as
-- strict as it was, and a tenant insert of a shared row stays impossible because
-- WITH CHECK compares their company id against NULL.
DO $$ BEGIN
  DROP POLICY IF EXISTS "Users manage company tour types" ON public.company_tour_types;
  DROP POLICY IF EXISTS "Users manage company vehicle types" ON public.company_vehicle_types;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_tour_types' AND policyname='Tour types are read shared or own') THEN
    CREATE POLICY "Tour types are read shared or own" ON public.company_tour_types
      FOR SELECT USING (company_id IS NULL OR company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_tour_types' AND policyname='Tour types are written by their company') THEN
    CREATE POLICY "Tour types are written by their company" ON public.company_tour_types
      FOR INSERT WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_tour_types' AND policyname='Tour types are updated by their company') THEN
    CREATE POLICY "Tour types are updated by their company" ON public.company_tour_types
      FOR UPDATE USING (company_id = public.get_user_company_id() OR public.is_super_admin())
      WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_tour_types' AND policyname='Tour types are deleted by their company') THEN
    CREATE POLICY "Tour types are deleted by their company" ON public.company_tour_types
      FOR DELETE USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_vehicle_types' AND policyname='Vehicle types are read shared or own') THEN
    CREATE POLICY "Vehicle types are read shared or own" ON public.company_vehicle_types
      FOR SELECT USING (company_id IS NULL OR company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_vehicle_types' AND policyname='Vehicle types are written by their company') THEN
    CREATE POLICY "Vehicle types are written by their company" ON public.company_vehicle_types
      FOR INSERT WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_vehicle_types' AND policyname='Vehicle types are updated by their company') THEN
    CREATE POLICY "Vehicle types are updated by their company" ON public.company_vehicle_types
      FOR UPDATE USING (company_id = public.get_user_company_id() OR public.is_super_admin())
      WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_vehicle_types' AND policyname='Vehicle types are deleted by their company') THEN
    CREATE POLICY "Vehicle types are deleted by their company" ON public.company_vehicle_types
      FOR DELETE USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
END $$;

GRANT SELECT ON TABLE public.company_tour_types TO authenticated;
GRANT SELECT ON TABLE public.company_vehicle_types TO authenticated;

COMMENT ON COLUMN public.company_tour_types.company_id IS
  'NULL for a national tour type every tenant reads; a company id is that tenant''s own type, or its override of a national one.';
COMMENT ON COLUMN public.company_vehicle_types.company_id IS
  'NULL for a national vehicle size every tenant prices along; a company id is that tenant''s own size, or its override of a national one.';

-- ─── STEP 4: seed the national lists ─────────────────────────────────────────
-- Idempotent against the partial unique keys, so a re-run cannot duplicate a
-- name or a code. These are the rows every company was already given.
INSERT INTO public.company_tour_types (company_id, name)
SELECT NULL::uuid, defaults.name
FROM (VALUES
  ('FIT'),
  ('Series Departure'),
  ('Groups'),
  ('Incentives')
) AS defaults(name)
ON CONFLICT (lower(name)) WHERE company_id IS NULL DO NOTHING;

INSERT INTO public.company_vehicle_types (company_id, code, name, max_capacity, sort_order)
SELECT NULL::uuid, defaults.code, defaults.name, defaults.max_capacity, defaults.sort_order
FROM (VALUES
  ('saloon',      'Saloon',         3, 1),
  ('combi',       'Combi',          6, 2),
  ('quantum_10',  'Quantum (10)',  10, 3),
  ('sprinter_16', 'Sprinter (16)', 16, 4),
  ('bus_39',      'Bus (39)',      39, 5)
) AS defaults(code, name, max_capacity, sort_order)
ON CONFLICT (code) WHERE company_id IS NULL DO NOTHING;

-- ─── STEP 5: drop the untouched private copies ───────────────────────────────
-- Only a copy that still equals the national row in every field a tenant can
-- change. Anything renamed, resized or switched off is left as the override it
-- has become, and a type with no national counterpart is not touched at all.
DELETE FROM public.company_tour_types tenant
USING public.company_tour_types national
WHERE tenant.company_id IS NOT NULL
  AND national.company_id IS NULL
  AND lower(tenant.name) = lower(national.name)
  AND tenant.is_active = national.is_active;

DELETE FROM public.company_vehicle_types tenant
USING public.company_vehicle_types national
WHERE tenant.company_id IS NOT NULL
  AND national.company_id IS NULL
  AND tenant.code = national.code
  AND lower(tenant.name) = lower(national.name)
  AND tenant.max_capacity = national.max_capacity
  AND tenant.is_active = national.is_active;
