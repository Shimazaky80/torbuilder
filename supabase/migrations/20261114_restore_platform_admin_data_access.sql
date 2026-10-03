-- Restore the named platform owner's profile and provide an explicitly
-- super-admin-authorized company listing that does not depend on client-side
-- table joins or company-scoped RLS visibility.
DO $$
DECLARE
  platform_owner_id UUID;
BEGIN
  SELECT id
  INTO platform_owner_id
  FROM auth.users
  WHERE lower(email) = lower('info.olaafricatravel@gmail.com')
  LIMIT 1;

  IF platform_owner_id IS NULL THEN
    RAISE EXCEPTION 'Platform owner auth account was not found';
  END IF;

  INSERT INTO public.profiles (id, first_name, last_name, user_role, is_super_admin)
  VALUES (platform_owner_id, 'Shim', 'Zaky', 'super_admin', true)
  ON CONFLICT (id) DO UPDATE
    SET first_name = COALESCE(NULLIF(profiles.first_name, ''), 'Shim'),
        last_name = COALESCE(NULLIF(profiles.last_name, ''), 'Zaky'),
        user_role = 'super_admin',
        is_super_admin = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_platform_companies()
RETURNS SETOF JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(COALESCE(auth.jwt() ->> 'email', '')) <> lower('info.olaafricatravel@gmail.com')
     AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Access Denied: Super Admin privilege required';
  END IF;

  RETURN QUERY
  SELECT to_jsonb(c) || jsonb_build_object(
    'profiles', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'first_name', p.first_name,
        'last_name', p.last_name
      ))
      FROM public.profiles p
      WHERE p.company_id = c.id
    ), '[]'::jsonb)
  )
  FROM public.companies c
  ORDER BY c.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_platform_companies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_platform_companies() TO authenticated;

NOTIFY pgrst, 'reload schema';
