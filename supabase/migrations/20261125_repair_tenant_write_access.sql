-- Ensure the tenant-facing app can write its company-owned records.
--
-- These tables are written directly by the authenticated tenant UI and carry
-- their own company_id. Normalize their RLS rules and table privileges so a
-- stale/missing policy cannot block writes. Child tables without company_id
-- keep their parent-ownership policies, and partner portal tables keep their
-- separate partner identity policies.
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

DO $$
DECLARE
  target_table TEXT;
  policy_row RECORD;
  tenant_tables TEXT[] := ARRAY[
    'clients',
    'suppliers',
    'library_items',
    'itineraries',
    'invoices',
    'company_billing_settings',
    'company_bank_accounts',
    'tax_rates',
    'finance_accounts',
    'journal_entries',
    'accounting_connections',
    'accounting_sync_log',
    'packages'
  ];
  write_tables TEXT[] := ARRAY[
    'clients', 'suppliers', 'library_items', 'item_rates', 'car_rental_rates',
    'itineraries', 'itinerary_days', 'itinerary_day_items',
    'invoices', 'invoice_line_items', 'invoice_receipts', 'credit_notes',
    'company_billing_settings', 'company_bank_accounts', 'tax_rates',
    'finance_accounts', 'journal_entries', 'journal_lines',
    'accounting_connections', 'accounting_sync_log',
    'packages', 'package_days', 'package_day_items',
    'package_validity_periods', 'package_pax_options',
    'partner_tariffs', 'partner_tariff_items', 'partner_quotations',
    'partner_portal_users', 'partner_portal_invitations', 'partner_company_profiles'
  ];
BEGIN
  -- RLS is the row boundary; SQL privileges are still required before the
  -- authenticated role can reach the policy check. Preserve each table's own
  -- RLS conditions, especially the partner portal's separate user identity.
  FOREACH target_table IN ARRAY write_tables LOOP
    IF to_regclass(format('public.%I', target_table)) IS NOT NULL THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated',
        target_table
      );
    END IF;
  END LOOP;

  FOREACH target_table IN ARRAY tenant_tables LOOP
    -- Some app versions may not have optional modules installed yet.
    IF to_regclass(format('public.%I', target_table)) IS NULL THEN
      CONTINUE;
    END IF;

    -- Only normalize tables that explicitly store the tenant key. This avoids
    -- weakening child-table policies that derive ownership through a parent.
    IF NOT EXISTS (
      SELECT 1
      FROM pg_attribute a
      WHERE a.attrelid = to_regclass(format('public.%I', target_table))
        AND a.attname = 'company_id'
        AND a.atttypid = 'uuid'::regtype
        AND a.attnum > 0
        AND NOT a.attisdropped
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target_table);
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
      'Tenant CRUD ' || target_table,
      target_table
    );
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
