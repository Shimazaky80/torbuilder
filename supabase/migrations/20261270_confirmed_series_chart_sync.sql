CREATE UNIQUE INDEX IF NOT EXISTS series_chart_itinerary_unique_idx
  ON public.series_chart_bookings (itinerary_id)
  WHERE itinerary_id IS NOT NULL;

DROP POLICY IF EXISTS "Users can insert company series bookings" ON public.series_chart_bookings;
DROP POLICY IF EXISTS "Users can update company series bookings" ON public.series_chart_bookings;
DROP POLICY IF EXISTS "Users can delete company series bookings" ON public.series_chart_bookings;

CREATE OR REPLACE FUNCTION public.sync_confirmed_series_chart_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract TEXT;
  v_pickup TEXT;
  v_dropoff TEXT;
  v_consultant TEXT;
BEGIN
  SELECT COALESCE(NULLIF(lower(rate_type), ''), lower(name))
    INTO v_contract
    FROM public.company_tour_types
   WHERE company_id = NEW.company_id
     AND lower(name) = lower(COALESCE(NEW.itinerary_tour_type, ''))
   LIMIT 1;

  v_contract := COALESCE(v_contract, lower(COALESCE(NEW.itinerary_tour_type, '')));
  IF NEW.status <> 'confirmed' OR v_contract <> 'series' THEN
    DELETE FROM public.series_chart_bookings WHERE itinerary_id = NEW.id;
    RETURN NEW;
  END IF;

  SELECT item_name INTO v_pickup
    FROM public.itinerary_days d
    JOIN public.itinerary_day_items i ON i.itinerary_day_id = d.id
   WHERE d.itinerary_id = NEW.id
     AND lower(COALESCE(i.category, '')) LIKE '%accommodation%'
     AND i.is_included IS DISTINCT FROM false
   ORDER BY d.day_number, i.sort_order
   LIMIT 1;

  SELECT item_name INTO v_dropoff
    FROM public.itinerary_days d
    JOIN public.itinerary_day_items i ON i.itinerary_day_id = d.id
   WHERE d.itinerary_id = NEW.id
     AND lower(COALESCE(i.category, '')) LIKE '%accommodation%'
     AND i.is_included IS DISTINCT FROM false
   ORDER BY d.day_number DESC, i.sort_order DESC
   LIMIT 1;

  SELECT COALESCE(NULLIF(trim(concat_ws(' ', first_name, last_name)), ''), email)
    INTO v_consultant
    FROM public.profiles
   WHERE id = NEW.created_by;
  v_consultant := COALESCE(NULLIF(NEW.consultant_name, ''), v_consultant, 'Unassigned');

  INSERT INTO public.series_chart_bookings (
    company_id, itinerary_id, itinerary_ref, consultant_id, consultant_name,
    series_name, series_code, departure_date, return_date, pickup_hotel,
    dropoff_hotel, num_adults, num_children, status
  ) VALUES (
    NEW.company_id, NEW.id, COALESCE(NEW.reference_number, ''), NEW.created_by, v_consultant,
    COALESCE(NULLIF(NEW.itinerary_name, ''), 'Series booking'), NEW.itinerary_tour_type,
    NEW.travel_start_date, NEW.travel_end_date, v_pickup, v_dropoff,
    COALESCE(NEW.num_adults, 0), COALESCE(NEW.num_children, 0), NEW.status
  )
  ON CONFLICT (itinerary_id) WHERE itinerary_id IS NOT NULL DO UPDATE SET
    company_id = EXCLUDED.company_id,
    itinerary_ref = EXCLUDED.itinerary_ref,
    consultant_id = EXCLUDED.consultant_id,
    consultant_name = EXCLUDED.consultant_name,
    series_name = EXCLUDED.series_name,
    series_code = EXCLUDED.series_code,
    departure_date = EXCLUDED.departure_date,
    return_date = EXCLUDED.return_date,
    pickup_hotel = EXCLUDED.pickup_hotel,
    dropoff_hotel = EXCLUDED.dropoff_hotel,
    num_adults = EXCLUDED.num_adults,
    num_children = EXCLUDED.num_children,
    status = EXCLUDED.status,
    updated_at = timezone('utc', now());

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS itineraries_sync_series_chart ON public.itineraries;
CREATE TRIGGER itineraries_sync_series_chart
  AFTER INSERT OR UPDATE OF status, itinerary_tour_type, itinerary_name,
    travel_start_date, travel_end_date, consultant_name, created_by,
    num_adults, num_children
  ON public.itineraries
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_confirmed_series_chart_booking();

NOTIFY pgrst, 'reload schema';
