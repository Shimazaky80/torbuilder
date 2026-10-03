-- Journal rows are posted by the authenticated app after their journal header
-- is created. Rebuild the policies so each line is authorized through its
-- tenant-owned journal entry, not just a potentially stale line policy.
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.journal_entries, public.journal_lines
  TO authenticated;

DO $$
DECLARE
  existing_policy RECORD;
BEGIN
  FOR existing_policy IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('journal_entries', 'journal_lines')
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON public.%I',
      existing_policy.policyname,
      existing_policy.tablename
    );
  END LOOP;

  CREATE POLICY "Tenant CRUD journal_entries"
    ON public.journal_entries
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

  CREATE POLICY "Tenant CRUD journal_lines"
    ON public.journal_lines
    FOR ALL
    TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM public.journal_entries e
        WHERE e.id = journal_lines.entry_id
          AND e.company_id = journal_lines.company_id
          AND (
            e.company_id = public.get_user_company_id()
            OR public.is_super_admin()
          )
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.journal_entries e
        WHERE e.id = journal_lines.entry_id
          AND e.company_id = journal_lines.company_id
          AND (
            e.company_id = public.get_user_company_id()
            OR public.is_super_admin()
          )
      )
    );
END;
$$;

NOTIFY pgrst, 'reload schema';
