-- Let the platform owner list the companies referenced by tenant data without
-- requiring the browser session to pass company-scoped RLS for each row.
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
