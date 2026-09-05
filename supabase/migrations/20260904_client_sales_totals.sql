-- =============================================================================
-- Migration: Client 12-month sales totals
-- Adds an RPC used by the Clients list to show "Sold (12 mo)" per client for
-- quick markup / discount decisions.
--
-- Definition of a "sold" itinerary:
--   - status IN ('confirmed', 'completed')          (quotes/cancelled excluded)
--   - created_at within the last rolling 12 months
-- Total per itinerary:
--   SUM over included day items of the *effective per-person selling price*
--     (selling_price_per_person_override
--      -> custom_item_selling_price_pp
--      -> item_price_per_person)
--   multiplied by pax (num_adults + num_children)
--
-- NOTE: itineraries carry their own currency_code; if a client has quotes in
-- multiple currencies the sum is a naive per-currency aggregate for now. When a
-- receipts/payments table exists, base the window on the receipt date instead
-- of created_at and aggregate in a single reporting currency.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_client_sales_totals()
RETURNS TABLE (client_id UUID, total_sold NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    c.id AS client_id,
    COALESCE(SUM(
      COALESCE(
        idi.selling_price_per_person_override,
        idi.custom_item_selling_price_pp,
        idi.item_price_per_person
      )
      * (COALESCE(i.num_adults, 0) + COALESCE(i.num_children, 0))
    ), 0) AS total_sold
  FROM public.clients c
  LEFT JOIN public.itineraries i
    ON i.client_id = c.id
   AND i.status IN ('confirmed', 'completed')
   AND i.created_at >= (timezone('utc'::text, now()) - interval '12 months')
  LEFT JOIN public.itinerary_days id
    ON id.itinerary_id = i.id
  LEFT JOIN public.itinerary_day_items idi
    ON idi.itinerary_day_id = id.id
   AND idi.is_included = true
  WHERE c.company_id = public.get_user_company_id()
  GROUP BY c.id;
$$;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';