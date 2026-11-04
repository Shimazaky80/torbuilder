-- =============================================================================
-- Migration: repair the write access a Car Rental contract has never had
--
-- The app has never once managed to save a car hire contract. Every save of a
-- Car Rental library item creates the item, then dies on the rate rows with:
--
--   new row violates row-level security policy for table "car_rental_rates"
--
-- The live database says so plainly: car_rental_rates holds all the columns
-- 20260903_car_rental.sql defines and exactly zero rows, while item_rates — whose
-- policies are word for word the same parent-ownership shape — holds 58 rows and
-- saves without complaint. The table exists; its policies do not. The CREATE
-- POLICY statements in 20260903 were written behind an "IF NOT EXISTS" guard, so
-- a database where the table arrived without them never gets them on a re-run
-- either, because the guard looks at the policy names and finds nothing to do.
--
-- This migration therefore drops whatever is on the table and re-asserts the
-- four policies, rather than adding only the missing ones. The rule is the one
-- every other rate table already lives by: a rate row belongs to whoever owns
-- the library item it prices, and a super admin reaches through.
--
-- No data changes. The items already saved with no rates are left as they are
-- for the operator to re-save once the write path works.
-- =============================================================================

ALTER TABLE IF EXISTS public.car_rental_rates ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  policy_row RECORD;
BEGIN
  IF to_regclass('public.car_rental_rates') IS NULL THEN
    RETURN;
  END IF;

  FOR policy_row IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'car_rental_rates'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.car_rental_rates', policy_row.policyname);
  END LOOP;

  -- Same shape as the working "Users can ... item rates" policies.
  CREATE POLICY "Users can view car rental rates" ON public.car_rental_rates
    FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM public.library_items
        WHERE library_items.id = car_rental_rates.item_id
          AND (library_items.company_id = public.get_user_company_id() OR public.is_super_admin())
      )
    );

  CREATE POLICY "Users can insert car rental rates" ON public.car_rental_rates
    FOR INSERT WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.library_items
        WHERE library_items.id = car_rental_rates.item_id
          AND (library_items.company_id = public.get_user_company_id() OR public.is_super_admin())
      )
    );

  CREATE POLICY "Users can update car rental rates" ON public.car_rental_rates
    FOR UPDATE USING (
      EXISTS (
        SELECT 1 FROM public.library_items
        WHERE library_items.id = car_rental_rates.item_id
          AND (library_items.company_id = public.get_user_company_id() OR public.is_super_admin())
      )
    );

  CREATE POLICY "Users can delete car rental rates" ON public.car_rental_rates
    FOR DELETE USING (
      EXISTS (
        SELECT 1 FROM public.library_items
        WHERE library_items.id = car_rental_rates.item_id
          AND (library_items.company_id = public.get_user_company_id() OR public.is_super_admin())
      )
    );

  -- Privileges are checked before the policy, and a table created outside the
  -- migration may never have been granted to the app role at all.
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.car_rental_rates TO authenticated';
END;
$$;

NOTIFY pgrst, 'reload schema';
