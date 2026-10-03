-- Run the overpayment credit-note transaction with controlled RLS bypass.
-- The wrapper verifies tenant access before invoking the existing validated
-- transaction, which may otherwise be denied by table-level RLS policies.

CREATE OR REPLACE FUNCTION public.issue_itinerary_overpayment_credit_note_authorized(
  p_company_id     UUID,
  p_invoice_id     UUID,
  p_amount         NUMERIC,
  p_reason         TEXT,
  p_submission_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_company_id IS NULL
     OR (
       public.get_user_company_id() IS DISTINCT FROM p_company_id
       AND NOT public.is_super_admin()
     ) THEN
    RAISE EXCEPTION 'You are not authorized to issue a credit note for this company'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN public.issue_itinerary_overpayment_credit_note(
    p_company_id,
    p_invoice_id,
    p_amount,
    p_reason,
    p_submission_key
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_itinerary_overpayment_credit_note_authorized(UUID, UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_itinerary_overpayment_credit_note_authorized(UUID, UUID, NUMERIC, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.issue_itinerary_overpayment_credit_note_authorized(UUID, UUID, NUMERIC, TEXT, TEXT) IS
  'Authorize the caller for the target tenant, then run the atomic overpayment credit-note transaction under controlled SECURITY DEFINER privileges.';
