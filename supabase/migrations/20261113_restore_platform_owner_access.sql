-- Restore the existing platform owner's admin profile without changing auth
-- credentials or modifying any company/tenant records.
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

  INSERT INTO public.profiles (id, user_role, is_super_admin)
  VALUES (platform_owner_id, 'super_admin', true)
  ON CONFLICT (id) DO UPDATE
    SET user_role = 'super_admin',
        is_super_admin = true;
END;
$$;
