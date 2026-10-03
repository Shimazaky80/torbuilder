-- Keep platform-admin checks compatible with both profile fields.
-- Some existing profiles use user_role='super_admin' without the boolean flag.
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND (is_super_admin = true OR user_role = 'super_admin')
  );
$$;
