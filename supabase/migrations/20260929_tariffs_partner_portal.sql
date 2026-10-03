-- Partner tariffs and quotation portal.
-- Partner accounts are deliberately not stored in profiles.company_id: all
-- existing tenant policies use that column as the tenant security boundary.

CREATE TABLE IF NOT EXISTS public.partner_portal_users (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'partner_user' CHECK (role IN ('partner_admin', 'partner_user')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (user_id, company_id, client_id)
);

CREATE INDEX IF NOT EXISTS partner_portal_users_client_idx
  ON public.partner_portal_users (company_id, client_id, is_active);

CREATE TABLE IF NOT EXISTS public.partner_portal_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'partner_user' CHECK (role IN ('partner_admin', 'partner_user')),
  invite_code UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'redeemed', 'revoked')),
  invited_by UUID REFERENCES auth.users(id),
  redeemed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  redeemed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.partner_tariffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  valid_from DATE NOT NULL,
  valid_to DATE NOT NULL,
  all_services BOOLEAN NOT NULL DEFAULT false,
  categories TEXT[] NOT NULL DEFAULT '{}',
  partner_markup_snapshot NUMERIC(8,4) NOT NULL DEFAULT 0,
  tenant_profile_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'expired', 'archived')),
  created_by UUID REFERENCES auth.users(id),
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  CHECK (valid_to >= valid_from),
  CHECK (all_services OR cardinality(categories) > 0)
);

ALTER TABLE public.partner_tariffs
  ADD COLUMN IF NOT EXISTS created_by_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tenant_profile_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS partner_tariffs_client_idx
  ON public.partner_tariffs (company_id, client_id, status, valid_from, valid_to);

CREATE TABLE IF NOT EXISTS public.partner_tariff_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tariff_id UUID NOT NULL REFERENCES public.partner_tariffs(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  item_id UUID REFERENCES public.library_items(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  item_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (tariff_id, item_id)
);

CREATE INDEX IF NOT EXISTS partner_tariff_items_tariff_idx
  ON public.partner_tariff_items (tariff_id, category);

CREATE TABLE IF NOT EXISTS public.partner_quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  tariff_id UUID REFERENCES public.partner_tariffs(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  reference_number TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT 'Untitled quotation',
  travel_start_date DATE,
  travel_end_date DATE,
  num_adults INTEGER NOT NULL DEFAULT 0,
  num_children INTEGER NOT NULL DEFAULT 0,
  travellers JSONB NOT NULL DEFAULT '[]'::jsonb,
  quotation_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  partner_profile_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  currency_code TEXT NOT NULL DEFAULT 'ZAR',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'booking_requested', 'reviewing', 'accepted', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  submitted_at TIMESTAMPTZ,
  CHECK (travel_end_date IS NULL OR travel_start_date IS NULL OR travel_end_date >= travel_start_date)
);

CREATE INDEX IF NOT EXISTS partner_quotations_company_idx
  ON public.partner_quotations (company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS partner_quotations_client_idx
  ON public.partner_quotations (client_id, created_by, created_at DESC);

CREATE TABLE IF NOT EXISTS public.partner_company_profiles (
  client_id UUID PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  legal_name TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  tax_number TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  telephone TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  logo_data_url TEXT NOT NULL DEFAULT '',
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE OR REPLACE FUNCTION public.current_partner_company_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT company_id FROM public.partner_portal_users
  WHERE user_id = auth.uid() AND is_active = true LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_partner_client_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT client_id FROM public.partner_portal_users
  WHERE user_id = auth.uid() AND is_active = true LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_partner_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.partner_portal_users
  WHERE user_id = auth.uid() AND is_active = true LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_partner_portal_context()
RETURNS TABLE (company_id UUID, client_id UUID, partner_name TEXT, tenant_name TEXT, role TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.company_id, p.client_id, c.name, co.name, p.role
  FROM public.partner_portal_users p
  JOIN public.clients c ON c.id = p.client_id
  JOIN public.companies co ON co.id = p.company_id
  WHERE p.user_id = auth.uid() AND p.is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_partner_invitation_info(p_invite_code UUID)
RETURNS TABLE (email TEXT, partner_name TEXT, tenant_name TEXT, role TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.email, c.name, co.name, i.role
  FROM public.partner_portal_invitations i
  JOIN public.clients c ON c.id = i.client_id
  JOIN public.companies co ON co.id = i.company_id
  WHERE i.invite_code = p_invite_code AND i.status = 'pending'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.accept_partner_invitation(p_invite_code UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invitation public.partner_portal_invitations%ROWTYPE;
  v_email TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = auth.uid();
  SELECT * INTO v_invitation FROM public.partner_portal_invitations
  WHERE invite_code = p_invite_code AND status = 'pending'
    AND lower(email) = v_email FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation is invalid, expired, or does not match this account'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()) THEN
    RAISE EXCEPTION 'This account is already registered as a tenant user';
  END IF;
  IF EXISTS (SELECT 1 FROM public.partner_portal_users WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'This account is already linked to a partner';
  END IF;
  INSERT INTO public.partner_portal_users
    (user_id, company_id, client_id, role, created_by)
  VALUES
    (auth.uid(), v_invitation.company_id, v_invitation.client_id, v_invitation.role, v_invitation.invited_by);
  UPDATE public.partner_portal_invitations
  SET status = 'redeemed', redeemed_by = auth.uid(), redeemed_at = timezone('utc'::text, now())
  WHERE id = v_invitation.id;
  RETURN v_invitation.client_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_partner_quotation_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.current_partner_client_id() IS NOT NULL THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Only draft quotations can be edited';
    END IF;
    IF NEW.company_id <> OLD.company_id OR NEW.client_id <> OLD.client_id
      OR NEW.tariff_id IS DISTINCT FROM OLD.tariff_id
      OR NEW.created_by <> OLD.created_by
      OR NEW.reference_number <> OLD.reference_number
      OR NEW.travel_start_date IS DISTINCT FROM OLD.travel_start_date
      OR NEW.travel_end_date IS DISTINCT FROM OLD.travel_end_date
      OR NEW.num_adults <> OLD.num_adults OR NEW.num_children <> OLD.num_children
      OR NEW.travellers IS DISTINCT FROM OLD.travellers
      OR NEW.quotation_data IS DISTINCT FROM OLD.quotation_data
      OR NEW.partner_profile_snapshot IS DISTINCT FROM OLD.partner_profile_snapshot
      OR NEW.currency_code <> OLD.currency_code THEN
      RAISE EXCEPTION 'Submitted quotation details cannot be changed';
    END IF;
    IF NEW.status NOT IN ('draft', 'submitted', 'booking_requested') THEN
      RAISE EXCEPTION 'Partner users cannot set tenant review statuses';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.partner_tariffs t
      WHERE t.id = NEW.tariff_id AND t.company_id = NEW.company_id AND t.client_id = NEW.client_id
        AND t.status = 'active' AND CURRENT_DATE BETWEEN t.valid_from AND t.valid_to
        AND NEW.travel_start_date >= t.valid_from AND NEW.travel_end_date <= t.valid_to
    ) THEN
      RAISE EXCEPTION 'The tariff is not active for these travel dates';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE public.partner_portal_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_portal_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_tariffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_tariff_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_company_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS partner_users_read_self_or_tenant ON public.partner_portal_users;
CREATE POLICY partner_users_read_self_or_tenant ON public.partner_portal_users FOR SELECT
USING (user_id = auth.uid() OR company_id = public.get_user_company_id() OR public.is_super_admin());
DROP POLICY IF EXISTS partner_users_manage_tenant ON public.partner_portal_users;
CREATE POLICY partner_users_manage_tenant ON public.partner_portal_users FOR ALL
USING (company_id = public.get_user_company_id() OR public.is_super_admin())
WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());

DROP POLICY IF EXISTS partner_invitations_read_manage ON public.partner_portal_invitations;
CREATE POLICY partner_invitations_read_manage ON public.partner_portal_invitations FOR SELECT
USING (
  company_id = public.get_user_company_id() OR public.is_super_admin()
  OR (client_id = public.current_partner_client_id() AND public.current_partner_role() = 'partner_admin')
);
DROP POLICY IF EXISTS partner_invitations_tenant_insert ON public.partner_portal_invitations;
CREATE POLICY partner_invitations_tenant_insert ON public.partner_portal_invitations FOR INSERT
WITH CHECK (
  (company_id = public.get_user_company_id() AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = partner_portal_invitations.client_id
      AND c.company_id = partner_portal_invitations.company_id
      AND c.client_type = 'Travel Agency'
  ) AND role = 'partner_admin') OR public.is_super_admin()
);
DROP POLICY IF EXISTS partner_invitations_partner_admin_insert ON public.partner_portal_invitations;
CREATE POLICY partner_invitations_partner_admin_insert ON public.partner_portal_invitations FOR INSERT
WITH CHECK (
  company_id = public.current_partner_company_id()
  AND client_id = public.current_partner_client_id()
  AND role = 'partner_user'
  AND public.current_partner_role() = 'partner_admin'
);
DROP POLICY IF EXISTS partner_invitations_manage ON public.partner_portal_invitations;
CREATE POLICY partner_invitations_manage ON public.partner_portal_invitations FOR UPDATE
USING (company_id = public.get_user_company_id() OR public.is_super_admin())
WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());

DROP POLICY IF EXISTS partner_tariffs_tenant_all ON public.partner_tariffs;
CREATE POLICY partner_tariffs_tenant_all ON public.partner_tariffs FOR ALL
USING (company_id = public.get_user_company_id() OR public.is_super_admin())
WITH CHECK (
  (company_id = public.get_user_company_id() AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = partner_tariffs.client_id
      AND c.company_id = partner_tariffs.company_id
      AND c.client_type = 'Travel Agency'
  )) OR public.is_super_admin()
);
DROP POLICY IF EXISTS partner_tariffs_partner_read ON public.partner_tariffs;
CREATE POLICY partner_tariffs_partner_read ON public.partner_tariffs FOR SELECT
USING (
  client_id = public.current_partner_client_id()
  AND status = 'active'
);

DROP POLICY IF EXISTS partner_tariff_items_tenant_all ON public.partner_tariff_items;
CREATE POLICY partner_tariff_items_tenant_all ON public.partner_tariff_items FOR ALL
USING (company_id = public.get_user_company_id() OR public.is_super_admin())
WITH CHECK (
  (company_id = public.get_user_company_id() AND EXISTS (
    SELECT 1 FROM public.partner_tariffs t
    WHERE t.id = partner_tariff_items.tariff_id
      AND t.company_id = partner_tariff_items.company_id
      AND t.client_id = partner_tariff_items.client_id
  )) OR public.is_super_admin()
);
DROP POLICY IF EXISTS partner_tariff_items_partner_read ON public.partner_tariff_items;
CREATE POLICY partner_tariff_items_partner_read ON public.partner_tariff_items FOR SELECT
USING (
  client_id = public.current_partner_client_id()
  AND EXISTS (SELECT 1 FROM public.partner_tariffs t WHERE t.id = tariff_id
    AND t.status = 'active')
);

DROP POLICY IF EXISTS partner_quotes_tenant_read ON public.partner_quotations;
CREATE POLICY partner_quotes_tenant_read ON public.partner_quotations FOR SELECT
USING (company_id = public.get_user_company_id() OR public.is_super_admin());
DROP POLICY IF EXISTS partner_quotes_tenant_update ON public.partner_quotations;
CREATE POLICY partner_quotes_tenant_update ON public.partner_quotations FOR UPDATE
USING (company_id = public.get_user_company_id() OR public.is_super_admin())
WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
DROP POLICY IF EXISTS partner_quotes_partner_read ON public.partner_quotations;
CREATE POLICY partner_quotes_partner_read ON public.partner_quotations FOR SELECT
USING (client_id = public.current_partner_client_id());
DROP POLICY IF EXISTS partner_quotes_partner_insert ON public.partner_quotations;
CREATE POLICY partner_quotes_partner_insert ON public.partner_quotations FOR INSERT
WITH CHECK (company_id = public.current_partner_company_id()
  AND client_id = public.current_partner_client_id() AND created_by = auth.uid()
  AND status IN ('draft', 'submitted', 'booking_requested')
  AND travel_start_date IS NOT NULL AND travel_end_date IS NOT NULL
  AND travel_start_date <= travel_end_date
  AND EXISTS (SELECT 1 FROM public.partner_tariffs t
    WHERE t.id = partner_quotations.tariff_id
      AND t.company_id = partner_quotations.company_id AND t.client_id = partner_quotations.client_id
      AND t.status = 'active' AND CURRENT_DATE BETWEEN t.valid_from AND t.valid_to
      AND partner_quotations.travel_start_date >= t.valid_from
      AND partner_quotations.travel_end_date <= t.valid_to));
DROP POLICY IF EXISTS partner_quotes_partner_update ON public.partner_quotations;
CREATE POLICY partner_quotes_partner_update ON public.partner_quotations FOR UPDATE
USING (client_id = public.current_partner_client_id() AND created_by = auth.uid() AND status = 'draft')
WITH CHECK (client_id = public.current_partner_client_id()
  AND company_id = public.current_partner_company_id()
  AND created_by = auth.uid()
  AND status IN ('draft', 'submitted', 'booking_requested')
  AND travel_start_date IS NOT NULL AND travel_end_date IS NOT NULL
  AND travel_start_date <= travel_end_date
  AND EXISTS (SELECT 1 FROM public.partner_tariffs t
    WHERE t.id = partner_quotations.tariff_id
      AND t.company_id = partner_quotations.company_id AND t.client_id = partner_quotations.client_id
      AND t.status = 'active' AND CURRENT_DATE BETWEEN t.valid_from AND t.valid_to
      AND partner_quotations.travel_start_date >= t.valid_from
      AND partner_quotations.travel_end_date <= t.valid_to));

    DROP TRIGGER IF EXISTS partner_quotation_update_guard ON public.partner_quotations;
    CREATE TRIGGER partner_quotation_update_guard BEFORE UPDATE ON public.partner_quotations
    FOR EACH ROW EXECUTE FUNCTION public.guard_partner_quotation_update();

DROP POLICY IF EXISTS partner_company_profile_tenant_all ON public.partner_company_profiles;
CREATE POLICY partner_company_profile_tenant_all ON public.partner_company_profiles FOR ALL
USING (company_id = public.get_user_company_id() OR public.is_super_admin())
WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
DROP POLICY IF EXISTS partner_company_profile_partner_read ON public.partner_company_profiles;
CREATE POLICY partner_company_profile_partner_read ON public.partner_company_profiles FOR SELECT
USING (client_id = public.current_partner_client_id());
DROP POLICY IF EXISTS partner_company_profile_partner_all ON public.partner_company_profiles;
CREATE POLICY partner_company_profile_partner_all ON public.partner_company_profiles FOR INSERT
WITH CHECK (client_id = public.current_partner_client_id()
  AND company_id = public.current_partner_company_id());
DROP POLICY IF EXISTS partner_company_profile_partner_update ON public.partner_company_profiles;
CREATE POLICY partner_company_profile_partner_update ON public.partner_company_profiles FOR UPDATE
USING (client_id = public.current_partner_client_id())
WITH CHECK (client_id = public.current_partner_client_id()
  AND company_id = public.current_partner_company_id());

DROP TRIGGER IF EXISTS partner_tariffs_set_updated_at ON public.partner_tariffs;
CREATE TRIGGER partner_tariffs_set_updated_at BEFORE UPDATE ON public.partner_tariffs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS partner_quotations_set_updated_at ON public.partner_quotations;
CREATE TRIGGER partner_quotations_set_updated_at BEFORE UPDATE ON public.partner_quotations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

NOTIFY pgrst, 'reload schema';