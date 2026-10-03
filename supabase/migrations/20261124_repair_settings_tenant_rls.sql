-- Keep billing, bank, and tax settings scoped to the authenticated tenant. The
-- helper is redefined against the current auth.uid() so frontend writes and RLS
-- evaluate the same profile/company link.
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

ALTER TABLE public.company_billing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_rates ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.company_billing_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.company_bank_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tax_rates TO authenticated;

-- Replace any stale or overlapping policies with one explicit tenant boundary
-- per table. FOR ALL supplies both USING and WITH CHECK behavior for upserts.
DO $$
DECLARE
  policy_row RECORD;
  target_table TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'company_billing_settings',
    'company_bank_accounts',
    'tax_rates'
  ] LOOP
    FOR policy_row IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = target_table
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', policy_row.policyname, target_table);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (company_id = public.get_user_company_id() OR public.is_super_admin()) WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin())',
      'Tenant access to ' || target_table,
      target_table
    );
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
