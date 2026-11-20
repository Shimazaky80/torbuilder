CREATE OR REPLACE FUNCTION public.admin_transfer_consultant_files(
  p_from_user UUID,
  p_to_user UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company UUID := public.get_user_company_id();
  v_from public.profiles%ROWTYPE;
  v_to public.profiles%ROWTYPE;
  v_from_name TEXT;
  v_to_name TEXT;
  v_itineraries INTEGER := 0;
  v_packages INTEGER := 0;
  v_transferred_at TIMESTAMPTZ := now();
BEGIN
  IF NOT COALESCE(public.user_module_access('users') = 'write', false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only an Admin can transfer consultant files.');
  END IF;
  IF p_from_user IS NULL OR p_to_user IS NULL OR p_from_user = p_to_user THEN
    RETURN jsonb_build_object('success', false, 'error', 'Choose two different consultants.');
  END IF;
  IF v_company IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Select a company before transferring files.');
  END IF;

  SELECT * INTO v_from
    FROM public.profiles
   WHERE id = p_from_user AND company_id = v_company AND user_role = 'consultant';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'The source account is not a consultant in this company.');
  END IF;
  SELECT * INTO v_to
    FROM public.profiles
   WHERE id = p_to_user AND company_id = v_company AND user_role = 'consultant' AND is_active = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Choose an active consultant in this company as the recipient.');
  END IF;

  v_from_name := NULLIF(trim(concat_ws(' ', v_from.first_name, v_from.last_name)), '');
  v_to_name := NULLIF(trim(concat_ws(' ', v_to.first_name, v_to.last_name)), '');

  UPDATE public.itineraries
     SET created_by = p_to_user,
         consultant_name = COALESCE(v_to_name, consultant_name),
         transferred_from = p_from_user,
         transferred_from_name = COALESCE(v_from_name, 'Consultant'),
         transferred_to = p_to_user,
         transferred_to_name = COALESCE(v_to_name, 'Consultant'),
         transferred_at = v_transferred_at,
         transferred_by = auth.uid()
   WHERE company_id = v_company
     AND (created_by = p_from_user OR (created_by IS NULL AND consultant_name = v_from_name));
  GET DIAGNOSTICS v_itineraries = ROW_COUNT;

  UPDATE public.packages
     SET created_by = p_to_user,
         created_by_name = COALESCE(v_to_name, created_by_name),
         transferred_from = p_from_user,
         transferred_from_name = COALESCE(v_from_name, 'Consultant'),
         transferred_to = p_to_user,
         transferred_to_name = COALESCE(v_to_name, 'Consultant'),
         transferred_at = v_transferred_at,
         transferred_by = auth.uid()
   WHERE company_id = v_company
     AND (created_by = p_from_user OR (created_by IS NULL AND created_by_name = v_from_name));
  GET DIAGNOSTICS v_packages = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'itineraries', v_itineraries,
    'packages', v_packages,
    'from_name', v_from_name,
    'to_name', v_to_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_transfer_consultant_files(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_transfer_consultant_files(UUID, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
