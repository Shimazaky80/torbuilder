-- Delete a tenant before deleting its auth users. companies.owner_id references
-- auth.users without ON DELETE CASCADE, so deleting those users first blocks the
-- transaction. The company delete cascades tenant records and profiles; saved
-- profile IDs are then used to remove the associated auth accounts.
CREATE OR REPLACE FUNCTION public.admin_delete_company(target_company_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  company_user_ids UUID[];
  deleted_company_count INTEGER;
BEGIN
  IF auth.uid() IS NULL OR (
    lower(COALESCE(auth.jwt() ->> 'email', '')) <> lower('info.olaafricatravel@gmail.com')
    AND NOT public.is_super_admin()
  ) THEN
    RAISE EXCEPTION 'Access Denied: Super Admin privilege required';
  END IF;

  SELECT array_agg(id)
  INTO company_user_ids
  FROM public.profiles
  WHERE company_id = target_company_id;

  DELETE FROM public.companies
  WHERE id = target_company_id;

  GET DIAGNOSTICS deleted_company_count = ROW_COUNT;
  IF deleted_company_count = 0 THEN
    RAISE EXCEPTION 'Company % was not found', target_company_id;
  END IF;

  IF company_user_ids IS NOT NULL THEN
    DELETE FROM auth.users
    WHERE id = ANY(company_user_ids);
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_company(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_company(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
