-- Role-based access control.
--
-- The shape every tour operator and DMC works in: a handful of named jobs, each
-- holding a level (none / read / write) per module, one person being the Admin
-- who can see and change everything, and a per-person exception so one senior
-- consultant can be given costs without inventing a whole new job for them.
--
-- Built-in roles are platform rows (company_id IS NULL) so a tenant that needs
-- its own job description can add one later without a migration. `profiles.user_role`
-- stays the single answer to "what is this person" and now points at this catalogue,
-- which is why every role that already exists in data is seeded below before the
-- foreign key is added.
--
-- Enforcement is in two places on purpose:
--   * SECURITY DEFINER functions, so a consultant's own row cannot be used to read
--     a colleague's profile or to hand out roles, and so the last-admin rule cannot
--     be walked around from the browser;
--   * the RLS policies at the bottom, so the row boundary is the database's and not
--     a menu the user cannot see.

-- ── 1. The role catalogue ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.roles (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  -- module id -> 'none' | 'read' | 'write'
  access JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- cross-cutting booleans; 'view_costs' is the supplier buy price and margin
  flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_builtin BOOLEAN NOT NULL DEFAULT false,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS roles_company_idx ON public.roles (company_id) WHERE company_id IS NOT NULL;

-- Seeded once. A role row that already exists is never overwritten here, because
-- an operator's own tuning of a job description outranks this file.
INSERT INTO public.roles (key, name, description, access, flags, is_builtin, sort_order)
VALUES
  ('admin', 'Admin',
   'Full access to everything, including the money the supplier charges and the people who may hold it.',
   '{"dashboard":"write","clients":"write","suppliers":"write","guide_team":"write","library":"write","packages":"write","itineraries":"write","tariffs":"write","finance":"write","analytics":"write","users":"write","settings":"write"}'::jsonb,
   '{"view_costs":true}'::jsonb, true, 10),

  ('consultant', 'Consultant',
   'Sells the trip: clients, itineraries and packages. Quotes are priced for the client, not for the margin.',
   '{"dashboard":"read","clients":"write","suppliers":"read","guide_team":"read","library":"read","packages":"write","itineraries":"write","tariffs":"read","finance":"none","analytics":"none","users":"none","settings":"none"}'::jsonb,
   '{"view_costs":false}'::jsonb, true, 20),

  ('operations', 'Operations',
   'Runs the trip once it is sold: suppliers, guide team, hire and the confirmations on every service.',
   '{"dashboard":"read","clients":"read","suppliers":"write","guide_team":"write","library":"read","packages":"read","itineraries":"write","tariffs":"write","finance":"read","analytics":"read","users":"none","settings":"none"}'::jsonb,
   '{"view_costs":true}'::jsonb, true, 30),

  ('finance', 'Finance',
   'Bills and collects: invoices, receipts, payments and the margin reports that go with them.',
   '{"dashboard":"read","clients":"read","suppliers":"read","guide_team":"none","library":"none","packages":"none","itineraries":"read","tariffs":"read","finance":"write","analytics":"write","users":"none","settings":"none"}'::jsonb,
   '{"view_costs":true}'::jsonb, true, 40),

  ('guide', 'Guide / Field Staff',
   'Reads the trip they are on the day before: the itinerary, the crew roster and nothing else.',
   '{"dashboard":"read","clients":"none","suppliers":"none","guide_team":"read","library":"none","packages":"none","itineraries":"read","tariffs":"none","finance":"none","analytics":"none","users":"none","settings":"none"}'::jsonb,
   '{"view_costs":false}'::jsonb, true, 50),

  ('viewer', 'View Only',
   'Reads everything the company sells and books, changes nothing, and is not shown the cost price.',
   '{"dashboard":"read","clients":"read","suppliers":"read","guide_team":"read","library":"read","packages":"read","itineraries":"read","tariffs":"read","finance":"read","analytics":"read","users":"none","settings":"none"}'::jsonb,
   '{"view_costs":false}'::jsonb, true, 60),

  ('super_admin', 'Platform Admin',
   'The platform owner. Sees every company; not assignable by a tenant admin.',
   '{"dashboard":"write","clients":"write","suppliers":"write","guide_team":"write","library":"write","packages":"write","itineraries":"write","tariffs":"write","finance":"write","analytics":"write","users":"write","settings":"write"}'::jsonb,
   '{"view_costs":true}'::jsonb, true, 100)
ON CONFLICT (key) DO NOTHING;

-- ── 2. The person ────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  -- per-person exceptions: { "modules": { "finance": "read" }, "flags": { "view_costs": true } }
  ADD COLUMN IF NOT EXISTS access_overrides JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Any role text that is not in the catalogue is a legacy or hand-typed value; it
-- answers as a consultant rather than breaking the foreign key below.
UPDATE public.profiles
   SET user_role = 'consultant'
 WHERE user_role IS NULL
    OR user_role NOT IN (SELECT key FROM public.roles);

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_user_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_user_role_fkey FOREIGN KEY (user_role) REFERENCES public.roles(key);

CREATE INDEX IF NOT EXISTS profiles_company_role_idx ON public.profiles (company_id, user_role);

-- ── 3. The invitation carries the job ────────────────────────────────────────
-- An invitation is how a team member arrives: creating an auth user needs the
-- service role, so the Admin issues a code and the person signs up with it.
ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'consultant',
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS redeemed_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS redeemed_at TIMESTAMPTZ;

UPDATE public.invitations
   SET role = 'consultant'
 WHERE role NOT IN (SELECT key FROM public.roles);

ALTER TABLE public.invitations DROP CONSTRAINT IF EXISTS invitations_role_fkey;
ALTER TABLE public.invitations
  ADD CONSTRAINT invitations_role_fkey FOREIGN KEY (role) REFERENCES public.roles(key);

-- ── 4. Reading one's own access ──────────────────────────────────────────────
-- SECURITY DEFINER because the caller may not be able to read the role row, the
-- colleague's profile or the audit trail directly; the answer about their own
-- access is safe to give, and nothing else is.
CREATE OR REPLACE FUNCTION public.user_module_access(p_module TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile profiles%ROWTYPE;
  v_level TEXT;
BEGIN
  SELECT * INTO v_profile FROM profiles WHERE id = auth.uid();
  IF NOT FOUND THEN
    RETURN 'none';
  END IF;
  IF v_profile.is_super_admin OR v_profile.user_role = 'super_admin' THEN
    RETURN 'write';
  END IF;
  IF NOT v_profile.is_active THEN
    RETURN 'none';
  END IF;

  SELECT (r.access ->> p_module) INTO v_level FROM roles r WHERE r.key = v_profile.user_role;

  -- A person's exception outranks the job description, in both directions.
  IF jsonb_typeof(v_profile.access_overrides -> 'modules' -> p_module) = 'string' THEN
    v_level := v_profile.access_overrides -> 'modules' ->> p_module;
  END IF;

  IF v_level IS NULL OR v_level NOT IN ('none', 'read', 'write') THEN
    RETURN 'none';
  END IF;
  RETURN v_level;
END;
$$;

CREATE OR REPLACE FUNCTION public.user_can_see_costs()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile profiles%ROWTYPE;
  v_allowed BOOLEAN;
BEGIN
  SELECT * INTO v_profile FROM profiles WHERE id = auth.uid();
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_profile.is_super_admin OR v_profile.user_role = 'super_admin' THEN
    RETURN true;
  END IF;
  IF NOT v_profile.is_active THEN
    RETURN false;
  END IF;

  SELECT (r.flags ->> 'view_costs') = 'true' INTO v_allowed FROM roles r WHERE r.key = v_profile.user_role;
  IF jsonb_typeof(v_profile.access_overrides -> 'flags' -> 'view_costs') = 'boolean' THEN
    v_allowed := (v_profile.access_overrides -> 'flags' ->> 'view_costs')::boolean;
  END IF;
  RETURN COALESCE(v_allowed, false);
END;
$$;

REVOKE ALL ON FUNCTION public.user_module_access(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_can_see_costs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_module_access(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_see_costs() TO authenticated;

-- ── 5. Who changed whose access ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.role_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  changed_by UUID NOT NULL REFERENCES auth.users(id),
  target_user UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  change_type TEXT NOT NULL CHECK (change_type IN ('role', 'access', 'status')),
  from_value TEXT,
  to_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS role_changes_company_idx ON public.role_changes (company_id, created_at DESC);

ALTER TABLE public.role_changes ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.role_changes TO authenticated;

DROP POLICY IF EXISTS "Access changes visible to a users manager" ON public.role_changes;
CREATE POLICY "Access changes visible to a users manager"
  ON public.role_changes
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_user_company_id()
    AND public.user_module_access('users') IN ('read', 'write')
  );

-- ── 6. The Admin's hand ─────────────────────────────────────────────────────
-- Every rule an operator would be angry about being walked around lives here,
-- not in the page: the last Admin cannot be demoted, a tenant admin cannot hand
-- out the platform role, and nobody may grant an exception they do not hold
-- themselves.
CREATE OR REPLACE FUNCTION public.admin_set_user_role(p_user_id UUID, p_role_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller profiles%ROWTYPE;
  v_target profiles%ROWTYPE;
  v_old TEXT;
  v_other_admins INT;
BEGIN
  SELECT * INTO v_caller FROM profiles WHERE id = auth.uid();
  IF NOT FOUND OR public.user_module_access('users') <> 'write' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your account cannot change access.');
  END IF;
  SELECT * INTO v_target FROM profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'That person is not in your team list.');
  END IF;
  IF v_target.company_id IS DISTINCT FROM v_caller.company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'You can only change access inside your own company.');
  END IF;
  IF v_target.is_super_admin OR v_target.user_role = 'super_admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'A platform admin account cannot be changed from here.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM roles r WHERE r.key = p_role_key) THEN
    RETURN jsonb_build_object('success', false, 'error', 'That role does not exist.');
  END IF;
  -- Only the platform may hand out its own role.
  IF p_role_key = 'super_admin' AND NOT (v_caller.is_super_admin OR v_caller.user_role = 'super_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'The platform admin role cannot be assigned by a company admin.');
  END IF;

  IF v_target.user_role = 'admin' AND p_role_key <> 'admin' THEN
    SELECT count(*) INTO v_other_admins
      FROM profiles
     WHERE company_id = v_target.company_id
       AND user_role = 'admin'
       AND is_active
       AND id <> v_target.id;
    IF v_other_admins = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'This is the last Admin in the company. Give another person the Admin role first, so the company cannot lock itself out.');
    END IF;
  END IF;

  v_old := v_target.user_role;
  UPDATE profiles SET user_role = p_role_key WHERE id = p_user_id;

  INSERT INTO role_changes (company_id, changed_by, target_user, change_type, from_value, to_value)
  VALUES (v_target.company_id, auth.uid(), p_user_id, 'role', v_old, p_role_key);

  RETURN jsonb_build_object('success', true, 'role', p_role_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_access(p_user_id UUID, p_overrides JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller profiles%ROWTYPE;
  v_target profiles%ROWTYPE;
  v_key TEXT;
  v_level TEXT;
  v_clean JSONB := '{"modules":{},"flags":{}}'::jsonb;
BEGIN
  SELECT * INTO v_caller FROM profiles WHERE id = auth.uid();
  IF NOT FOUND OR public.user_module_access('users') <> 'write' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your account cannot change access.');
  END IF;
  SELECT * INTO v_target FROM profiles WHERE id = p_user_id;
  IF NOT FOUND OR v_target.company_id IS DISTINCT FROM v_caller.company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'You can only change access inside your own company.');
  END IF;
  IF v_target.is_super_admin OR v_target.user_role = 'super_admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'A platform admin account cannot be changed from here.');
  END IF;

  IF jsonb_typeof(p_overrides) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access exceptions must be sent as a list of modules and flags.');
  END IF;

  -- Nobody grants what they do not hold themselves. The platform is exempt: it
  -- owns the structure.
  IF jsonb_typeof(p_overrides -> 'modules') = 'object' THEN
    FOR v_key, v_level IN
      SELECT k, v FROM jsonb_each_text(p_overrides -> 'modules') AS x(k, v)
    LOOP
      IF v_level NOT IN ('none', 'read', 'write') THEN
        RETURN jsonb_build_object('success', false, 'error', 'An access level must be none, read or write.');
      END IF;
      IF NOT (v_caller.is_super_admin OR v_caller.user_role = 'super_admin')
         AND v_level = 'write'
         AND public.user_module_access(v_key) <> 'write' THEN
        RETURN jsonb_build_object('success', false, 'error', 'You cannot grant write access to ' || v_key || ' because you cannot write there yourself.');
      END IF;
      v_clean := jsonb_set(v_clean, ARRAY['modules', v_key], to_jsonb(v_level), true);
    END LOOP;
  END IF;

  IF jsonb_typeof(p_overrides -> 'flags' -> 'view_costs') = 'boolean' THEN
    v_clean := jsonb_set(v_clean, ARRAY['flags', 'view_costs'],
      (p_overrides -> 'flags' -> 'view_costs'), true);
  END IF;

  UPDATE profiles SET access_overrides = v_clean WHERE id = p_user_id;

  INSERT INTO role_changes (company_id, changed_by, target_user, change_type, from_value, to_value)
  VALUES (v_target.company_id, auth.uid(), p_user_id, 'access',
          v_target.access_overrides::text, v_clean::text);

  RETURN jsonb_build_object('success', true, 'overrides', v_clean);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_active(p_user_id UUID, p_is_active BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller profiles%ROWTYPE;
  v_target profiles%ROWTYPE;
  v_other_admins INT;
BEGIN
  SELECT * INTO v_caller FROM profiles WHERE id = auth.uid();
  IF NOT FOUND OR public.user_module_access('users') <> 'write' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your account cannot change access.');
  END IF;
  IF p_user_id = auth.uid() AND p_is_active = false THEN
    RETURN jsonb_build_object('success', false, 'error', 'You cannot disable your own account.');
  END IF;
  SELECT * INTO v_target FROM profiles WHERE id = p_user_id;
  IF NOT FOUND OR v_target.company_id IS DISTINCT FROM v_caller.company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'You can only change access inside your own company.');
  END IF;
  IF v_target.is_super_admin OR v_target.user_role = 'super_admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'A platform admin account cannot be changed from here.');
  END IF;

  IF v_target.user_role = 'admin' AND p_is_active = false THEN
    SELECT count(*) INTO v_other_admins
      FROM profiles
     WHERE company_id = v_target.company_id
       AND user_role = 'admin'
       AND is_active
       AND id <> v_target.id;
    IF v_other_admins = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'This is the last active Admin in the company. Another person must hold the Admin role before this account is disabled.');
    END IF;
  END IF;

  UPDATE profiles SET is_active = p_is_active WHERE id = p_user_id;

  INSERT INTO role_changes (company_id, changed_by, target_user, change_type, from_value, to_value)
  VALUES (v_target.company_id, auth.uid(), p_user_id, 'status',
          CASE WHEN v_target.is_active THEN 'active' ELSE 'disabled' END,
          CASE WHEN p_is_active THEN 'active' ELSE 'disabled' END);

  RETURN jsonb_build_object('success', true, 'is_active', p_is_active);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_invitation(p_email TEXT, p_role_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company UUID;
  v_code TEXT;
  v_existing INT;
BEGIN
  IF public.user_module_access('users') <> 'write' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your account cannot invite team members.');
  END IF;
  v_company := public.get_user_company_id();
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your account is not linked to a company.');
  END IF;
  IF p_email IS NULL OR position('@' IN p_email) < 2 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Enter a valid email address.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM roles r WHERE r.key = p_role_key) THEN
    RETURN jsonb_build_object('success', false, 'error', 'That role does not exist.');
  END IF;
  IF p_role_key = 'super_admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'The platform admin role cannot be invited by a company.');
  END IF;

  SELECT count(*) INTO v_existing
    FROM invitations i
   WHERE i.company_id = v_company
     AND lower(i.email) = lower(p_email)
     AND i.status = 'pending'
     AND (i.expires_at IS NULL OR i.expires_at > timezone('utc'::text, now()));
  IF v_existing > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'That person already has an invitation waiting.');
  END IF;

  v_code := replace(gen_random_uuid()::text, '-', '');
  INSERT INTO invitations (company_id, code, email, status, role, created_by, expires_at)
  VALUES (v_company, v_code, lower(p_email), 'pending', p_role_key, auth.uid(),
          timezone('utc'::text, now()) + INTERVAL '14 days');

  RETURN jsonb_build_object('success', true, 'code', v_code, 'email', lower(p_email), 'role', p_role_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_invitation(p_invitation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv invitations%ROWTYPE;
BEGIN
  IF public.user_module_access('users') <> 'write' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your account cannot change invitations.');
  END IF;
  SELECT * INTO v_inv FROM invitations WHERE id = p_invitation_id;
  IF NOT FOUND OR v_inv.company_id IS DISTINCT FROM public.get_user_company_id() THEN
    RETURN jsonb_build_object('success', false, 'error', 'That invitation is not in your company.');
  END IF;
  UPDATE invitations SET status = 'expired' WHERE id = p_invitation_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- The invitation is the only way a person joins a company, and it must put them
-- in the company that invited them, in the job that was written on the invitation.
CREATE OR REPLACE FUNCTION public.join_company_by_invitation(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv invitations%ROWTYPE;
  v_profile profiles%ROWTYPE;
  v_email TEXT;
  v_name TEXT;
BEGIN
  SELECT * INTO v_inv
    FROM invitations
   WHERE code = p_code
     AND status = 'pending'
     AND (expires_at IS NULL OR expires_at > timezone('utc'::text, now()));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'That invitation code is not waiting for anyone.');
  END IF;

  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  IF v_email = '' OR v_email <> lower(v_inv.email) THEN
    RETURN jsonb_build_object('success', false, 'error', 'This invitation was issued to ' || v_inv.email || '. Sign in with that address to accept it.');
  END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = auth.uid();
  IF FOUND AND v_profile.company_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'This account already belongs to a company. Ask your administrator to move it rather than using the invitation.');
  END IF;

  v_name := coalesce(
    (SELECT u.raw_user_meta_data ->> 'full_name' FROM auth.users u WHERE u.id = auth.uid()),
    split_part(v_email, '@', 1));

  IF FOUND THEN
    UPDATE profiles
       SET company_id = v_inv.company_id,
           user_role = v_inv.role,
           is_active = true,
           first_name = coalesce(first_name, split_part(v_name, ' ', 1)),
           last_name = coalesce(last_name, NULLIF(array_to_string((string_to_array(v_name, ' '))[2:], ' '), ''))
     WHERE id = auth.uid();
  ELSE
    INSERT INTO profiles (id, company_id, first_name, last_name, user_role)
    VALUES (auth.uid(), v_inv.company_id, split_part(v_name, ' ', 1),
            NULLIF(array_to_string((string_to_array(v_name, ' '))[2:], ' '), ''), v_inv.role);
  END IF;

  UPDATE invitations
     SET status = 'redeemed', redeemed_by = auth.uid(), redeemed_at = timezone('utc'::text, now())
   WHERE id = v_inv.id;

  RETURN jsonb_build_object('success', true, 'company_id', v_inv.company_id, 'role', v_inv.role);
END;
$$;

REVOKE ALL ON FUNCTION
  public.admin_set_user_role(UUID, TEXT),
  public.admin_set_user_access(UUID, JSONB),
  public.admin_set_user_active(UUID, BOOLEAN),
  public.admin_create_invitation(TEXT, TEXT),
  public.admin_revoke_invitation(UUID),
  public.join_company_by_invitation(TEXT)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  public.admin_set_user_role(UUID, TEXT),
  public.admin_set_user_access(UUID, JSONB),
  public.admin_set_user_active(UUID, BOOLEAN),
  public.admin_create_invitation(TEXT, TEXT),
  public.admin_revoke_invitation(UUID),
  public.join_company_by_invitation(TEXT)
TO authenticated;

-- ── 7. The roster ───────────────────────────────────────────────────────────
-- An email lives in auth.users, which PostgREST will never expose, so the team
-- list is one function rather than a join the browser cannot make. The caller
-- must hold Users access, and the answer is their own company only.
CREATE OR REPLACE FUNCTION public.get_company_team()
RETURNS TABLE (
  user_id UUID,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  user_role TEXT,
  role_name TEXT,
  is_active BOOLEAN,
  is_super_admin BOOLEAN,
  access_overrides JSONB,
  joined_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_company UUID;
BEGIN
  IF public.user_module_access('users') NOT IN ('read', 'write') THEN
    RAISE EXCEPTION 'Access Denied: your account cannot read the team list';
  END IF;
  v_company := public.get_user_company_id();
  IF v_company IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.id,
         p.first_name,
         p.last_name,
         u.email::TEXT,
         p.user_role,
         r.name,
         p.is_active,
         p.is_super_admin,
         p.access_overrides,
         p.created_at
    FROM profiles p
    LEFT JOIN roles r ON r.key = p.user_role
    LEFT JOIN auth.users u ON u.id = p.id
   WHERE p.company_id = v_company
   ORDER BY (p.is_super_admin OR p.user_role = 'super_admin') DESC,
            COALESCE(r.sort_order, 999),
            lower(COALESCE(p.first_name, u.email::TEXT, ''));
END;
$$;

REVOKE ALL ON FUNCTION public.get_company_team() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_company_team() TO authenticated;

-- ── 8. Row policies ─────────────────────────────────────────────────────────
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.roles TO authenticated;

DROP POLICY IF EXISTS "Roles are readable by every signed-in user" ON public.roles;
CREATE POLICY "Roles are readable by every signed-in user"
  ON public.roles
  FOR SELECT
  TO authenticated
  USING (company_id IS NULL OR company_id = public.get_user_company_id() OR public.is_super_admin());

-- A team roster is readable by whoever holds Users access, and always by the
-- person's own row. Nobody else reads profiles, and no profile is writable
-- through PostgREST at all: the RPCs above are the only hand on it.
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS "Team roster is readable through Users access" ON public.profiles;
CREATE POLICY "Team roster is readable through Users access"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_user_company_id()
    AND public.user_module_access('users') IN ('read', 'write')
  );

-- Writes are not revoked at the privilege level: the platform admin's own FOR ALL
-- policy still needs to reach the table. There is simply no permissive policy
-- letting a tenant account write profiles, so the RPCs above are the only hand on
-- a colleague's role.

-- The Admin's invitations, and nothing else: a pending code is not a secret the
-- whole company should read.
DROP POLICY IF EXISTS "Super admins can manage invitations" ON public.invitations;
CREATE POLICY "Super admins can manage invitations"
  ON public.invitations
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Users managers read their company invitations" ON public.invitations;
CREATE POLICY "Users managers read their company invitations"
  ON public.invitations
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_user_company_id()
    AND public.user_module_access('users') IN ('read', 'write')
  );

NOTIFY pgrst, 'reload schema';
