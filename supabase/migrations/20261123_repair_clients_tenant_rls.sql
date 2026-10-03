-- Normalize client access after the tenant/profile repairs. A tenant may read
-- and manage client/agency records only when their company_id matches their
-- own profile. Platform super admins retain platform-wide access.
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

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.clients TO authenticated;

-- Remove conflicting legacy client policies (including any restrictive policy)
-- and replace them with one explicit tenant boundary per operation.
DO $$
DECLARE
  policy_row RECORD;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'clients'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.clients', policy_row.policyname);
  END LOOP;
END;
$$;

CREATE POLICY "Tenant users can view company clients"
  ON public.clients
  FOR SELECT
  TO authenticated
  USING (company_id = public.get_user_company_id() OR public.is_super_admin());

CREATE POLICY "Tenant users can insert company clients"
  ON public.clients
  FOR INSERT
  TO authenticated
  WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());

CREATE POLICY "Tenant users can update company clients"
  ON public.clients
  FOR UPDATE
  TO authenticated
  USING (company_id = public.get_user_company_id() OR public.is_super_admin())
  WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());

CREATE POLICY "Tenant users can delete company clients"
  ON public.clients
  FOR DELETE
  TO authenticated
  USING (company_id = public.get_user_company_id() OR public.is_super_admin());

NOTIFY pgrst, 'reload schema';
