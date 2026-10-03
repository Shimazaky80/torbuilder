-- Keep invoice line writes tenant-scoped while allowing the authenticated
-- invoice RPC to insert the rows that belong to its newly-created invoice.
ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.invoice_line_items
  TO authenticated;

DO $$
DECLARE
  existing_policy RECORD;
BEGIN
  FOR existing_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoice_line_items'
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON public.invoice_line_items',
      existing_policy.policyname
    );
  END LOOP;

  CREATE POLICY "Tenant CRUD invoice_line_items"
    ON public.invoice_line_items
    FOR ALL
    TO authenticated
    USING (
      company_id = public.get_user_company_id()
      OR public.is_super_admin()
    )
    WITH CHECK (
      company_id = public.get_user_company_id()
      OR public.is_super_admin()
    );
END;
$$;

NOTIFY pgrst, 'reload schema';
