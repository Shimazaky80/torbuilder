-- Restore the itinerary-value helpers required by receipt and overpayment RPCs.
-- These definitions match 20261108_server_side_trip_value.sql and are safe to
-- apply when that earlier migration has already been installed.

CREATE OR REPLACE FUNCTION public.booking_trip_value(
  p_company_id   UUID,
  p_itinerary_id UUID,
  p_currency     TEXT
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT ROUND(COALESCE(SUM(di.total_sell), 0)::NUMERIC, 2)
  FROM public.itinerary_day_items di
  JOIN public.itinerary_days d ON d.id = di.itinerary_day_id
  WHERE d.itinerary_id = p_itinerary_id
    AND di.company_id = p_company_id
    AND di.is_included IS TRUE
    AND UPPER(di.currency_code) = UPPER(p_currency)
    AND COALESCE(di.total_sell, 0) <> 0;
$$;

COMMENT ON FUNCTION public.booking_trip_value(UUID, UUID, TEXT) IS
  'What this booking is worth in one currency, summed from its priced day items. The server-side basis for the over-billing guard.';

CREATE OR REPLACE FUNCTION public.booking_trip_value_basis(
  p_company_id   UUID,
  p_itinerary_id UUID,
  p_currency     TEXT
)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT count(*)::INTEGER
  FROM public.itinerary_day_items di
  JOIN public.itinerary_days d ON d.id = di.itinerary_day_id
  WHERE d.itinerary_id = p_itinerary_id
    AND di.company_id = p_company_id
    AND di.is_included IS TRUE
    AND UPPER(di.currency_code) = UPPER(p_currency);
$$;

COMMENT ON FUNCTION public.booking_trip_value_basis(UUID, UUID, TEXT) IS
  'How many included priced lines the trip value for this currency is summed from. Zero means the booking has never been priced in this currency.';

GRANT EXECUTE ON FUNCTION public.booking_trip_value(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.booking_trip_value_basis(UUID, UUID, TEXT) TO authenticated;
