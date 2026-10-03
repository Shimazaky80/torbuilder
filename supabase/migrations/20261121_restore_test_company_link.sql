-- Restore the missing tenant parent/profile for the existing Test Company
-- account. The UUID is retained by its existing clients.company_id rows, and
-- the auth account already exists; this does not change auth credentials or
-- delete tenant data.
DO $$
DECLARE
  tenant_company_id CONSTANT UUID := 'f17508b1-7ed9-45a0-8635-8998aa2d67d4';
  tenant_admin_id UUID;
BEGIN
  SELECT id
  INTO tenant_admin_id
  FROM auth.users
  WHERE lower(email) = lower('test.acc2026@yahoo.com')
  LIMIT 1;

  IF tenant_admin_id IS NULL THEN
    RAISE EXCEPTION 'Existing Test Company auth account was not found';
  END IF;

  INSERT INTO public.companies (id, name, status, owner_id)
  VALUES (tenant_company_id, 'Test Company (Pty) Ltd', 'approved', tenant_admin_id)
  ON CONFLICT (id) DO UPDATE
    SET name = COALESCE(NULLIF(public.companies.name, ''), EXCLUDED.name),
        owner_id = COALESCE(public.companies.owner_id, EXCLUDED.owner_id);

  INSERT INTO public.profiles (
    id,
    company_id,
    first_name,
    last_name,
    user_role,
    is_super_admin
  )
  VALUES (
    tenant_admin_id,
    tenant_company_id,
    'Test',
    'Company',
    'admin',
    false
  )
  ON CONFLICT (id) DO UPDATE
    SET company_id = COALESCE(public.profiles.company_id, EXCLUDED.company_id),
        first_name = COALESCE(NULLIF(public.profiles.first_name, ''), EXCLUDED.first_name),
        last_name = COALESCE(NULLIF(public.profiles.last_name, ''), EXCLUDED.last_name),
        user_role = 'admin',
        is_super_admin = false;
END;
$$;

NOTIFY pgrst, 'reload schema';
