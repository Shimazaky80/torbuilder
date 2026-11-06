-- ─────────────────────────────────────────────────────────────────────────────
-- 20261258  The platform acts on a tenant it names
--
-- 20261257 gave the platform a role but no reach: get_company_team,
-- admin_create_invitation, admin_revoke_invitation and the three admin_set_*
-- functions all resolve the company from the CALLER's own profile. A platform
-- account has no company of its own, which is the correct shape for the owner
-- of the app, so every one of them answered with nothing, or with "You can only
-- change access inside your own company".
--
-- The read and invite functions now take an optional company. Left out, or set
-- to the caller's own, nothing changes for a tenant. Named for a neighbour, it
-- is honoured only when the caller is the platform, so a company Admin cannot
-- reach a rival by typing its id into a request.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. The roster of a company the platform names ────────────────────────────
-- The old zero-parameter form is dropped rather than left beside the new one:
-- two overloads of the same name make PostgREST refuse to choose.
DROP FUNCTION IF EXISTS public.get_company_team();

CREATE OR REPLACE FUNCTION public.get_company_team(p_company UUID DEFAULT NULL)
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

  -- IS DISTINCT FROM, not <>: the platform's own company is NULL, and
  -- 'some-uuid' <> NULL answers NULL rather than true, which would skip this
  -- branch and leave the platform reading a company it does not have.
  IF p_company IS NOT NULL AND p_company IS DISTINCT FROM v_company THEN
    IF NOT public.is_super_admin() THEN
      RAISE EXCEPTION 'Access Denied: only the platform may read another company team';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = p_company) THEN
      RAISE EXCEPTION 'That company does not exist';
    END IF;
    v_company := p_company;
  END IF;

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

REVOKE ALL ON FUNCTION public.get_company_team(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_company_team(UUID) TO authenticated;

-- ── 2. Inviting into a company the platform names ────────────────────────────
-- Everything below the p_company clause is the body 20261257 shipped, so a
-- tenant inviting its own staff behaves exactly as it did.
DROP FUNCTION IF EXISTS public.admin_create_invitation(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.admin_create_invitation(
  p_email TEXT,
  p_role_key TEXT,
  p_company UUID DEFAULT NULL
)
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

  IF p_company IS NOT NULL AND p_company IS DISTINCT FROM v_company THEN
    IF NOT public.is_super_admin() THEN
      RETURN jsonb_build_object('success', false, 'error', 'Only the platform may invite into another company.');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = p_company) THEN
      RETURN jsonb_build_object('success', false, 'error', 'That company does not exist.');
    END IF;
    v_company := p_company;
  END IF;

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

REVOKE ALL ON FUNCTION public.admin_create_invitation(TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_invitation(TEXT, TEXT, UUID) TO authenticated;

-- ── 3. Withdrawing another company's invitation ─────────────────────────────
-- The row is already found by id, so this needs one clause rather than a new
-- parameter: the platform is not confined to a company it does not belong to.
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
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'That invitation is not here.');
  END IF;
  IF v_inv.company_id IS DISTINCT FROM public.get_user_company_id()
     AND NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'That invitation is not in your company.');
  END IF;
  UPDATE invitations SET status = 'expired' WHERE id = p_invitation_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ── 4. Changing a tenant's people from the platform ──────────────────────────
-- The three admin_set_* functions each confine the caller to its own company
-- with the same clause, and a platform account has no company to be confined
-- to. Each body is otherwise 20261257's, with the confinement tested only when
-- the caller is not the platform. The role write also keeps is_super_admin and
-- user_role in step with each other. The rules an operator must not be walked
-- around — the last Admin in a company, your own account, a company handing out
-- the platform role — are untouched and still bind the platform. The one thing
-- the platform gains is the power to undo that flag on someone else: a tenant
-- wrongly marked as the owner can be demoted from the Users page instead of
-- needing SQL, but never by editing the account you are signed in as.
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
  v_caller_is_platform BOOLEAN;
BEGIN
  SELECT * INTO v_caller FROM profiles WHERE id = auth.uid();
  v_caller_is_platform := COALESCE(v_caller.is_super_admin, false) OR v_caller.user_role = 'super_admin';
  IF NOT FOUND OR public.user_module_access('users') <> 'write' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your account cannot change access.');
  END IF;
  SELECT * INTO v_target FROM profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'That person is not in your team list.');
  END IF;
  IF NOT v_caller_is_platform AND v_target.company_id IS DISTINCT FROM v_caller.company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'You can only change access inside your own company.');
  END IF;
  -- A platform row is out of a tenant's reach. The platform itself may undo the
  -- flag it handed out — someone has to be able to demote a tenant that was
  -- wrongly marked as the owner — but not its own, which would strand the app.
  IF v_target.is_super_admin OR v_target.user_role = 'super_admin' THEN
    IF NOT v_caller_is_platform THEN
      RETURN jsonb_build_object('success', false, 'error', 'A platform admin account cannot be changed from here.');
    END IF;
    IF p_user_id = auth.uid() THEN
      RETURN jsonb_build_object('success', false, 'error', 'You cannot change your own platform role. Another platform account has to do it.');
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM roles r WHERE r.key = p_role_key) THEN
    RETURN jsonb_build_object('success', false, 'error', 'That role does not exist.');
  END IF;
  -- Only the platform may hand out its own role.
  IF p_role_key = 'super_admin' AND NOT v_caller_is_platform THEN
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
  -- The flag and the role are one decision, not two. Setting the role to
  -- anything other than the platform clears the flag, so the Users page cannot
  -- show someone as demoted while the database still treats them as the owner.
  UPDATE profiles
     SET user_role = p_role_key,
         is_super_admin = (p_role_key = 'super_admin')
   WHERE id = p_user_id;

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
  v_caller_is_platform BOOLEAN;
  v_clean JSONB := '{"modules":{},"flags":{}}'::jsonb;
BEGIN
  SELECT * INTO v_caller FROM profiles WHERE id = auth.uid();
  v_caller_is_platform := COALESCE(v_caller.is_super_admin, false) OR v_caller.user_role = 'super_admin';
  IF NOT FOUND OR public.user_module_access('users') <> 'write' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your account cannot change access.');
  END IF;
  SELECT * INTO v_target FROM profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'That person is not in your team list.');
  END IF;
  IF NOT v_caller_is_platform AND v_target.company_id IS DISTINCT FROM v_caller.company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'You can only change access inside your own company.');
  END IF;
  IF (v_target.is_super_admin OR v_target.user_role = 'super_admin') AND NOT v_caller_is_platform THEN
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
      IF NOT v_caller_is_platform
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
  v_caller_is_platform BOOLEAN;
BEGIN
  SELECT * INTO v_caller FROM profiles WHERE id = auth.uid();
  v_caller_is_platform := COALESCE(v_caller.is_super_admin, false) OR v_caller.user_role = 'super_admin';
  IF NOT FOUND OR public.user_module_access('users') <> 'write' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your account cannot change access.');
  END IF;
  IF p_user_id = auth.uid() AND p_is_active = false THEN
    RETURN jsonb_build_object('success', false, 'error', 'You cannot disable your own account.');
  END IF;
  SELECT * INTO v_target FROM profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'That person is not in your team list.');
  END IF;
  IF NOT v_caller_is_platform AND v_target.company_id IS DISTINCT FROM v_caller.company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'You can only change access inside your own company.');
  END IF;
  IF (v_target.is_super_admin OR v_target.user_role = 'super_admin') AND NOT v_caller_is_platform THEN
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

-- ── 5. The audit trail of a tenant the platform is watching ──────────────────
DROP POLICY IF EXISTS "Access changes visible to a users manager" ON public.role_changes;
CREATE POLICY "Access changes visible to a users manager"
  ON public.role_changes
  FOR SELECT
  TO authenticated
  USING (
    (company_id = public.get_user_company_id() OR public.is_super_admin())
    AND public.user_module_access('users') IN ('read', 'write')
  );
