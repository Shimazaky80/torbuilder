-- Rebuild receipt access rules around the invoice being settled. A receipt can
-- only be written for an invoice owned by the authenticated user's company.
ALTER TABLE public.invoice_receipts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.invoice_receipts
  TO authenticated;

DO $$
DECLARE
  existing_policy RECORD;
BEGIN
  FOR existing_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invoice_receipts'
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON public.invoice_receipts',
      existing_policy.policyname
    );
  END LOOP;

  CREATE POLICY "Tenant CRUD invoice_receipts"
    ON public.invoice_receipts
    FOR ALL
    TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM public.invoices i
        WHERE i.id = invoice_receipts.invoice_id
          AND i.company_id = invoice_receipts.company_id
          AND (
            i.company_id = public.get_user_company_id()
            OR public.is_super_admin()
          )
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM public.invoices i
        WHERE i.id = invoice_receipts.invoice_id
          AND i.company_id = invoice_receipts.company_id
          AND (
            i.company_id = public.get_user_company_id()
            OR public.is_super_admin()
          )
      )
    );
END;
$$;

NOTIFY pgrst, 'reload schema';
