-- Migration: Admin-only itinerary deletion, blocked when invoices exist.
--
-- Deleting a file with invoices would either break the accounting trail or fail
-- on the ON DELETE RESTRICT foreign key. The check below is deliberately inside
-- a SECURITY DEFINER helper so the invoice lookup cannot be narrowed by the
-- caller's finance-module permissions, and the RLS policy makes it the single
-- server-side answer rather than a UI-only courtesy.

CREATE OR REPLACE FUNCTION public.user_can_delete_itinerary(p_itinerary UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.user_module_access('users') = 'write', false)
     AND EXISTS (
       SELECT 1
         FROM public.itineraries i
        WHERE i.id = p_itinerary
          AND (
            i.company_id = public.get_user_company_id()
            OR public.is_super_admin()
            OR EXISTS (
              SELECT 1
                FROM public.profiles p
               WHERE p.id = auth.uid()
                 AND p.user_role = 'super_admin'
            )
          )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public.invoices inv
        WHERE inv.itinerary_id = p_itinerary
     )
     -- A receipt can outlive the invoice it settled; its own RESTRICT key must
     -- be honoured too, otherwise the delete would fail late with a raw FK error.
     AND NOT EXISTS (
       SELECT 1
         FROM public.invoice_receipts r
        WHERE r.itinerary_id = p_itinerary
     );
$$;

REVOKE ALL ON FUNCTION public.user_can_delete_itinerary(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_delete_itinerary(UUID) TO authenticated;

DROP POLICY IF EXISTS "Users can delete company itineraries" ON public.itineraries;
DROP POLICY IF EXISTS itinerary_company_delete ON public.itineraries;
CREATE POLICY itinerary_company_delete ON public.itineraries
  FOR DELETE USING (public.user_can_delete_itinerary(id));

NOTIFY pgrst, 'reload schema';
