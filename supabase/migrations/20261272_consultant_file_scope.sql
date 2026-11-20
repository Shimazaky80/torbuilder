CREATE OR REPLACE FUNCTION public.user_can_view_all_itineraries()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p.user_role <> 'consultant' THEN true
    ELSE COALESCE(
      (p.access_overrides #>> '{flags,view_all_itineraries}')::boolean,
      (r.flags ->> 'view_all_itineraries')::boolean,
      false
    )
  END
  FROM public.profiles p
  LEFT JOIN public.roles r ON r.key = p.user_role
  WHERE p.id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.user_can_read_itinerary(p_itinerary UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.itineraries i
     WHERE i.id = p_itinerary
       AND (i.company_id = public.get_user_company_id() OR public.is_super_admin())
       AND public.user_module_access('itineraries') IN ('read', 'write')
       AND (
         public.user_can_view_all_itineraries()
         OR i.created_by = auth.uid()
         OR (i.created_by IS NULL AND i.consultant_name = (
           SELECT NULLIF(trim(concat_ws(' ', first_name, last_name)), '')
             FROM public.profiles WHERE id = auth.uid()
         ))
       )
  )
$$;

CREATE OR REPLACE FUNCTION public.user_can_edit_itinerary(p_itinerary UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.user_module_access('itineraries') = 'write', false)
     AND public.user_can_read_itinerary(p_itinerary)
     AND (
       NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND user_role = 'consultant')
       OR EXISTS (
         SELECT 1 FROM public.itineraries i
          WHERE i.id = p_itinerary
            AND (i.created_by = auth.uid() OR (
              i.created_by IS NULL
              AND i.consultant_name = (SELECT NULLIF(trim(concat_ws(' ', first_name, last_name)), '') FROM public.profiles WHERE id = auth.uid())
            ))
       )
     )
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_access(p_user_id UUID, p_overrides JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_key TEXT;
  v_level TEXT;
  v_clean JSONB := '{"modules":{},"flags":{}}'::jsonb;
BEGIN
  SELECT * INTO v_caller FROM public.profiles WHERE id = auth.uid();
  IF NOT FOUND OR public.user_module_access('users') <> 'write' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your account cannot change access.');
  END IF;
  SELECT * INTO v_target FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND OR v_target.company_id IS DISTINCT FROM v_caller.company_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'You can only change access inside your own company.');
  END IF;
  IF v_target.is_super_admin OR v_target.user_role = 'super_admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'A platform admin account cannot be changed from here.');
  END IF;
  IF jsonb_typeof(p_overrides) <> 'object' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access exceptions must be sent as a list of modules and flags.');
  END IF;

  IF jsonb_typeof(p_overrides -> 'modules') = 'object' THEN
    FOR v_key, v_level IN
      SELECT k, v FROM jsonb_each_text(p_overrides -> 'modules') AS x(k, v)
    LOOP
      IF v_level NOT IN ('none', 'read', 'write') THEN
        RETURN jsonb_build_object('success', false, 'error', 'An access level must be none, read or write.');
      END IF;
      IF NOT (COALESCE(v_caller.is_super_admin, false) OR v_caller.user_role = 'super_admin')
         AND v_level = 'write'
         AND public.user_module_access(v_key) <> 'write' THEN
        RETURN jsonb_build_object('success', false, 'error', 'You cannot grant write access to ' || v_key || ' because you cannot write there yourself.');
      END IF;
      v_clean := jsonb_set(v_clean, ARRAY['modules', v_key], to_jsonb(v_level), true);
    END LOOP;
  END IF;

  IF jsonb_typeof(p_overrides -> 'flags' -> 'view_costs') = 'boolean' THEN
    v_clean := jsonb_set(v_clean, ARRAY['flags', 'view_costs'], p_overrides -> 'flags' -> 'view_costs', true);
  END IF;
  IF jsonb_typeof(p_overrides -> 'flags' -> 'view_all_itineraries') = 'boolean' THEN
    IF v_target.user_role <> 'consultant' AND (p_overrides -> 'flags' -> 'view_all_itineraries') = 'true'::jsonb THEN
      RETURN jsonb_build_object('success', false, 'error', 'Itinerary sharing exceptions only apply to consultants.');
    END IF;
    IF (p_overrides -> 'flags' -> 'view_all_itineraries') = 'true'::jsonb
       AND v_caller.user_role <> 'admin'
       AND NOT COALESCE(public.is_super_admin(), false) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Only an Admin can grant access to other consultants’ itineraries.');
    END IF;
    v_clean := jsonb_set(v_clean, ARRAY['flags', 'view_all_itineraries'], p_overrides -> 'flags' -> 'view_all_itineraries', true);
  END IF;

  UPDATE public.profiles SET access_overrides = v_clean WHERE id = p_user_id;
  INSERT INTO public.role_changes (company_id, changed_by, target_user, change_type, from_value, to_value)
  VALUES (v_target.company_id, auth.uid(), p_user_id, 'access', v_target.access_overrides::text, v_clean::text);
  RETURN jsonb_build_object('success', true, 'overrides', v_clean);
END;
$$;

DROP POLICY IF EXISTS "Users can view company itineraries" ON public.itineraries;
DROP POLICY IF EXISTS "Users can insert company itineraries" ON public.itineraries;
DROP POLICY IF EXISTS "Users can update company itineraries" ON public.itineraries;
DROP POLICY IF EXISTS "Users can delete company itineraries" ON public.itineraries;

CREATE POLICY itinerary_company_read ON public.itineraries
  FOR SELECT USING (public.user_can_read_itinerary(id));
CREATE POLICY itinerary_company_insert ON public.itineraries
  FOR INSERT WITH CHECK (
    (company_id = public.get_user_company_id() OR public.is_super_admin())
    AND public.user_module_access('itineraries') = 'write'
    AND (
      NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND user_role = 'consultant')
      OR created_by = auth.uid()
    )
  );
CREATE POLICY itinerary_company_update ON public.itineraries
  FOR UPDATE USING (public.user_can_edit_itinerary(id))
  WITH CHECK (
    (company_id = public.get_user_company_id() OR public.is_super_admin())
    AND (
      NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND user_role = 'consultant')
      OR created_by = auth.uid()
    )
  );
CREATE POLICY itinerary_company_delete ON public.itineraries
  FOR DELETE USING (public.user_can_edit_itinerary(id));

DROP POLICY IF EXISTS "Users can view company itinerary days" ON public.itinerary_days;
DROP POLICY IF EXISTS "Users can insert company itinerary days" ON public.itinerary_days;
DROP POLICY IF EXISTS "Users can update company itinerary days" ON public.itinerary_days;
DROP POLICY IF EXISTS "Users can delete company itinerary days" ON public.itinerary_days;
CREATE POLICY itinerary_days_read ON public.itinerary_days FOR SELECT
  USING (public.user_can_read_itinerary(itinerary_id));
CREATE POLICY itinerary_days_insert ON public.itinerary_days FOR INSERT
  WITH CHECK (public.user_can_edit_itinerary(itinerary_id));
CREATE POLICY itinerary_days_update ON public.itinerary_days FOR UPDATE
  USING (public.user_can_edit_itinerary(itinerary_id))
  WITH CHECK (public.user_can_edit_itinerary(itinerary_id));
CREATE POLICY itinerary_days_delete ON public.itinerary_days FOR DELETE
  USING (public.user_can_edit_itinerary(itinerary_id));

DROP POLICY IF EXISTS "Users can view company itinerary day items" ON public.itinerary_day_items;
DROP POLICY IF EXISTS "Users can insert company itinerary day items" ON public.itinerary_day_items;
DROP POLICY IF EXISTS "Users can update company itinerary day items" ON public.itinerary_day_items;
DROP POLICY IF EXISTS "Users can delete company itinerary day items" ON public.itinerary_day_items;
CREATE POLICY itinerary_day_items_read ON public.itinerary_day_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.itinerary_days d
    WHERE d.id = itinerary_day_items.itinerary_day_id
      AND public.user_can_read_itinerary(d.itinerary_id)
  ));
CREATE POLICY itinerary_day_items_insert ON public.itinerary_day_items FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.itinerary_days d
    WHERE d.id = itinerary_day_items.itinerary_day_id
      AND public.user_can_edit_itinerary(d.itinerary_id)
  ));
CREATE POLICY itinerary_day_items_update ON public.itinerary_day_items FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.itinerary_days d
    WHERE d.id = itinerary_day_items.itinerary_day_id
      AND public.user_can_edit_itinerary(d.itinerary_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.itinerary_days d
    WHERE d.id = itinerary_day_items.itinerary_day_id
      AND public.user_can_edit_itinerary(d.itinerary_id)
  ));
CREATE POLICY itinerary_day_items_delete ON public.itinerary_day_items FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.itinerary_days d
    WHERE d.id = itinerary_day_items.itinerary_day_id
      AND public.user_can_edit_itinerary(d.itinerary_id)
  ));

CREATE OR REPLACE FUNCTION public.user_can_read_package(p_package UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.packages p
    WHERE p.id = p_package
      AND (p.company_id = public.get_user_company_id() OR public.is_super_admin())
      AND public.user_module_access('packages') IN ('read', 'write')
  )
$$;

CREATE OR REPLACE FUNCTION public.user_can_edit_package(p_package UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.user_module_access('packages') = 'write', false)
     AND EXISTS (
       SELECT 1 FROM public.packages p
       WHERE p.id = p_package
         AND (p.company_id = public.get_user_company_id() OR public.is_super_admin())
         AND (
           NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND user_role = 'consultant')
           OR p.created_by = auth.uid()
         )
     )
$$;

DROP POLICY IF EXISTS packages_company_access ON public.packages;
CREATE POLICY packages_company_read ON public.packages FOR SELECT
  USING (public.user_can_read_package(id));
CREATE POLICY packages_company_insert ON public.packages FOR INSERT
  WITH CHECK (
    (company_id = public.get_user_company_id() OR public.is_super_admin())
    AND public.user_module_access('packages') = 'write'
    AND (
      NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND user_role = 'consultant')
      OR created_by = auth.uid()
    )
  );
CREATE POLICY packages_company_update ON public.packages FOR UPDATE
  USING (public.user_can_edit_package(id))
  WITH CHECK (
    (company_id = public.get_user_company_id() OR public.is_super_admin())
    AND (
      NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND user_role = 'consultant')
      OR created_by = auth.uid()
    )
  );
CREATE POLICY packages_company_delete ON public.packages FOR DELETE
  USING (public.user_can_edit_package(id));

DROP POLICY IF EXISTS package_validity_company_access ON public.package_validity_periods;
CREATE POLICY package_validity_read ON public.package_validity_periods FOR SELECT
  USING (public.user_can_read_package(package_id));
CREATE POLICY package_validity_write ON public.package_validity_periods FOR ALL
  USING (public.user_can_edit_package(package_id))
  WITH CHECK (public.user_can_edit_package(package_id));

DROP POLICY IF EXISTS package_pax_company_access ON public.package_pax_options;
CREATE POLICY package_pax_read ON public.package_pax_options FOR SELECT
  USING (public.user_can_read_package(package_id));
CREATE POLICY package_pax_write ON public.package_pax_options FOR ALL
  USING (public.user_can_edit_package(package_id))
  WITH CHECK (public.user_can_edit_package(package_id));

DROP POLICY IF EXISTS package_days_company_access ON public.package_days;
CREATE POLICY package_days_read ON public.package_days FOR SELECT
  USING (public.user_can_read_package(package_id));
CREATE POLICY package_days_write ON public.package_days FOR ALL
  USING (public.user_can_edit_package(package_id))
  WITH CHECK (public.user_can_edit_package(package_id));

DROP POLICY IF EXISTS package_items_company_access ON public.package_day_items;
CREATE POLICY package_items_read ON public.package_day_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.package_days d
    WHERE d.id = package_day_items.package_day_id
      AND public.user_can_read_package(d.package_id)
  ));
CREATE POLICY package_items_write ON public.package_day_items FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.package_days d
    WHERE d.id = package_day_items.package_day_id
      AND public.user_can_edit_package(d.package_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.package_days d
    WHERE d.id = package_day_items.package_day_id
      AND public.user_can_edit_package(d.package_id)
  ));

NOTIFY pgrst, 'reload schema';
