CREATE OR REPLACE FUNCTION public.refresh_confirmed_series_chart_booking(p_itinerary UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_itinerary public.itineraries%ROWTYPE;
  v_contract TEXT;
  v_pickup TEXT;
  v_dropoff TEXT;
  v_consultant TEXT;
  v_series_name TEXT;
  v_series_code TEXT;
  v_series_departure DATE;
  v_series_return DATE;
BEGIN
  SELECT * INTO v_itinerary
    FROM public.itineraries
   WHERE id = p_itinerary;
  IF NOT FOUND THEN
    DELETE FROM public.series_chart_bookings WHERE itinerary_id = p_itinerary;
    RETURN;
  END IF;

  SELECT COALESCE(NULLIF(lower(rate_type), ''), lower(name))
    INTO v_contract
    FROM public.company_tour_types
   WHERE company_id = v_itinerary.company_id
     AND lower(name) = lower(COALESCE(v_itinerary.itinerary_tour_type, ''))
   LIMIT 1;
  v_contract := COALESCE(v_contract, lower(COALESCE(v_itinerary.itinerary_tour_type, '')));

  IF v_itinerary.status <> 'confirmed' OR v_contract <> 'series' THEN
    DELETE FROM public.series_chart_bookings WHERE itinerary_id = p_itinerary;
    RETURN;
  END IF;

  SELECT t.name, t.code, d.departure_date, d.return_date
    INTO v_series_name, v_series_code, v_series_departure, v_series_return
    FROM public.series_bookings b
    JOIN public.series_departures d ON d.id = b.departure_id
    JOIN public.series_templates t ON t.id = d.template_id
   WHERE b.itinerary_id = p_itinerary
     AND b.status IN ('confirmed', 'completed')
   ORDER BY b.created_at DESC
   LIMIT 1;

  SELECT item_name INTO v_pickup
    FROM public.itinerary_days d
    JOIN public.itinerary_day_items i ON i.itinerary_day_id = d.id
   WHERE d.itinerary_id = p_itinerary
     AND lower(COALESCE(i.category, '')) LIKE '%accommodation%'
     AND i.is_included IS DISTINCT FROM false
   ORDER BY d.day_number, i.sort_order
   LIMIT 1;

  SELECT item_name INTO v_dropoff
    FROM public.itinerary_days d
    JOIN public.itinerary_day_items i ON i.itinerary_day_id = d.id
   WHERE d.itinerary_id = p_itinerary
     AND lower(COALESCE(i.category, '')) LIKE '%accommodation%'
     AND i.is_included IS DISTINCT FROM false
   ORDER BY d.day_number DESC, i.sort_order DESC
   LIMIT 1;

  SELECT COALESCE(NULLIF(trim(concat_ws(' ', first_name, last_name)), ''), email)
    INTO v_consultant
    FROM public.profiles
   WHERE id = v_itinerary.created_by;
  v_consultant := COALESCE(NULLIF(v_itinerary.consultant_name, ''), v_consultant, 'Unassigned');

  INSERT INTO public.series_chart_bookings (
    company_id, itinerary_id, itinerary_ref, consultant_id, consultant_name,
    series_name, series_code, departure_date, return_date, pickup_hotel,
    dropoff_hotel, num_adults, num_children, status
  ) VALUES (
    v_itinerary.company_id, v_itinerary.id, COALESCE(v_itinerary.reference_number, ''),
    v_itinerary.created_by, v_consultant,
    COALESCE(NULLIF(v_series_name, ''), NULLIF(v_itinerary.itinerary_name, ''), 'Series booking'),
    COALESCE(NULLIF(v_series_code, ''), v_itinerary.itinerary_tour_type),
    COALESCE(v_series_departure, v_itinerary.travel_start_date),
    COALESCE(v_series_return, v_itinerary.travel_end_date),
    v_pickup, v_dropoff,
    COALESCE(v_itinerary.num_adults, 0), COALESCE(v_itinerary.num_children, 0), v_itinerary.status
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
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_confirmed_series_chart_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_confirmed_series_chart_booking(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_series_chart_after_itinerary_day_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_confirmed_series_chart_booking(OLD.itinerary_id);
    RETURN OLD;
  END IF;
  PERFORM public.refresh_confirmed_series_chart_booking(NEW.itinerary_id);
  IF TG_OP = 'UPDATE' AND OLD.itinerary_id IS DISTINCT FROM NEW.itinerary_id THEN
    PERFORM public.refresh_confirmed_series_chart_booking(OLD.itinerary_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_series_chart_after_itinerary_item_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day UUID;
  v_itinerary UUID;
BEGIN
  v_day := CASE WHEN TG_OP = 'DELETE' THEN OLD.itinerary_day_id ELSE NEW.itinerary_day_id END;
  SELECT itinerary_id INTO v_itinerary FROM public.itinerary_days WHERE id = v_day;
  IF v_itinerary IS NOT NULL THEN
    PERFORM public.refresh_confirmed_series_chart_booking(v_itinerary);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS itinerary_days_sync_series_chart ON public.itinerary_days;
CREATE TRIGGER itinerary_days_sync_series_chart
  AFTER INSERT OR UPDATE OR DELETE ON public.itinerary_days
  FOR EACH ROW EXECUTE FUNCTION public.sync_series_chart_after_itinerary_day_change();

DROP TRIGGER IF EXISTS itinerary_day_items_sync_series_chart ON public.itinerary_day_items;
CREATE TRIGGER itinerary_day_items_sync_series_chart
  AFTER INSERT OR UPDATE OR DELETE ON public.itinerary_day_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_series_chart_after_itinerary_item_change();

REVOKE ALL ON FUNCTION public.refresh_confirmed_series_chart_booking(UUID) FROM PUBLIC;

NOTIFY pgrst, 'reload schema';
