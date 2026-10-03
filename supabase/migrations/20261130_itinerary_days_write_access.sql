-- =============================================================================
-- Migration: restore tenant write access to the itinerary day tables
-- Run in Supabase Dashboard -> SQL Editor (one block, one run). Idempotent.
--
-- Symptom this fixes:
--   new row violates row-level security policy for table "itinerary_days"
--
-- Why it happens:
--   itinerary_days / itinerary_day_items carry their own company_id, but they
--   are not part of the 20261125 "repair tenant write access" tenant list. On a
--   database that predates 20260913 the day policies can be missing entirely
--   (RLS enabled, no INSERT policy, so every write is refused with exactly this
--   message), or bound to a company_id that is NULL on the rows themselves.
--
-- What this does:
--   1. re-asserts public.get_user_company_id() (profiles-based, the definition
--      the rest of the app already relies on);
--   2. backfills company_id from the parent row so existing rows are visible;
--   3. converges both tables on the same rule as every other tenant table —
--      company-scoped CRUD for authenticated users, plus super admins;
--   4. restores the SQL privileges the RLS check still needs.
-- =============================================================================

-- ─── STEP 1: the keys the policies resolve through ────────────────────────────
CREATE OR REPLACE FUNCTION public.get_user_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.company_id
  FROM public.profiles p
  WHERE p.id = (SELECT auth.uid())
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_user_company_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_company_id() TO authenticated;

-- Re-asserted so the policy below can never fail on a missing function. The
-- body is only parsed when the function runs, so this is safe on a database
-- whose profiles table predates the flag.
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid()) AND is_super_admin = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── STEP 2: backfill the tenant key before tightening the policies ───────────
-- A day row written before the company_id column existed, or written with a
-- null company_id, would fail its own policy and become invisible to the tenant
-- that owns the itinerary. Parent ownership is authoritative.
DO $$
BEGIN
  IF to_regclass('public.itinerary_days') IS NULL THEN
    RAISE NOTICE 'itinerary_days does not exist — apply 20260913_itinerary_builder.sql first';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'itinerary_days' AND column_name = 'company_id'
  ) THEN
    UPDATE public.itinerary_days d
    SET company_id = i.company_id
    FROM public.itineraries i
    WHERE i.id = d.itinerary_id
      AND (d.company_id IS NULL OR d.company_id <> i.company_id);
  END IF;

  IF to_regclass('public.itinerary_day_items') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'itinerary_day_items' AND column_name = 'company_id'
     ) THEN
    UPDATE public.itinerary_day_items it
    SET company_id = d.company_id
    FROM public.itinerary_days d
    WHERE d.id = it.itinerary_day_id
      AND (it.company_id IS NULL OR it.company_id <> d.company_id);
  END IF;
END;
$$;

-- ─── STEP 3: one company-scoped policy per table, plus the privileges ─────────
DO $$
DECLARE
  target_table TEXT;
  policy_row RECORD;
  day_tables TEXT[] := ARRAY['itinerary_days', 'itinerary_day_items'];
  super_admin_clause TEXT := '';
  predicate TEXT;
BEGIN
  -- A database without the super-admin flag keeps the company rule only, rather
  -- than installing a policy that errors on every row.
  IF to_regclass('public.profiles') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_super_admin'
     )
  THEN
    super_admin_clause := ' OR public.is_super_admin()';
  END IF;

  predicate := 'company_id = public.get_user_company_id()' || super_admin_clause;

  FOREACH target_table IN ARRAY day_tables LOOP
    IF to_regclass(format('public.%I', target_table)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated',
      target_table
    );
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target_table);

    -- Replace whatever is there: a stale policy that only allows SELECT is what
    -- surfaces as "violates row-level security policy" on save.
    FOR policy_row IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = target_table
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', policy_row.policyname, target_table);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (%s) WITH CHECK (%s)',
      'Tenant CRUD ' || target_table,
      target_table,
      predicate,
      predicate
    );
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';