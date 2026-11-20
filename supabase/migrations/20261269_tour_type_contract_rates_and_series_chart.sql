-- =============================================================================
-- Migration: 20261269_tour_type_contract_rates_and_series_chart.sql
-- 1. Expands rate_type constraints to allow any Tour Type as contract type.
-- 2. Adds room-level child policy & child age ranges to library_item_room_types.
-- 3. Adds file transfer & consultant tracking columns to itineraries & packages.
-- 4. Creates series_chart_bookings table for confirmed series bookings.
-- =============================================================================

-- 1. Relax rate_type constraints to allow any tour type
ALTER TABLE public.item_rates
  DROP CONSTRAINT IF EXISTS item_rates_rate_type_check;

ALTER TABLE public.packages
  DROP CONSTRAINT IF EXISTS packages_rate_type_check;

ALTER TABLE public.company_tour_types
  DROP CONSTRAINT IF EXISTS company_tour_types_rate_type_check;

-- 2. Room-level child policies and child age ranges
ALTER TABLE public.library_item_room_types
  ADD COLUMN IF NOT EXISTS child_policy TEXT DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS child_age_ranges JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.library_item_room_types.child_policy IS
  'Child policy for this room type: standard (follows property), flat_rate (children included in unit room rate), adults_only (0 children allowed), or custom.';

-- 3. Consultant file transfer tracking on itineraries
ALTER TABLE public.itineraries
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS transferred_from UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS transferred_from_name TEXT,
  ADD COLUMN IF NOT EXISTS transferred_to UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS transferred_to_name TEXT,
  ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS transferred_by UUID REFERENCES auth.users(id);

-- Consultant file transfer tracking on packages
ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS created_by_name TEXT,
  ADD COLUMN IF NOT EXISTS transferred_from UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS transferred_from_name TEXT,
  ADD COLUMN IF NOT EXISTS transferred_to UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS transferred_to_name TEXT,
  ADD COLUMN IF NOT EXISTS transferred_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS transferred_by UUID REFERENCES auth.users(id);

-- 4. Series Chart Bookings table
CREATE TABLE IF NOT EXISTS public.series_chart_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  itinerary_id UUID REFERENCES public.itineraries(id) ON DELETE CASCADE,
  itinerary_ref TEXT NOT NULL,
  consultant_id UUID REFERENCES auth.users(id),
  consultant_name TEXT NOT NULL,
  series_name TEXT NOT NULL,
  series_code TEXT,
  departure_date DATE,
  return_date DATE,
  pickup_hotel TEXT,
  dropoff_hotel TEXT,
  num_adults INTEGER DEFAULT 0,
  num_children INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'confirmed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS series_chart_company_idx ON public.series_chart_bookings (company_id, departure_date);
CREATE INDEX IF NOT EXISTS series_chart_itinerary_idx ON public.series_chart_bookings (itinerary_id);

ALTER TABLE public.series_chart_bookings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='series_chart_bookings' AND policyname='Users can view company series bookings') THEN
    CREATE POLICY "Users can view company series bookings" ON public.series_chart_bookings
      FOR SELECT USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='series_chart_bookings' AND policyname='Users can insert company series bookings') THEN
    CREATE POLICY "Users can insert company series bookings" ON public.series_chart_bookings
      FOR INSERT WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='series_chart_bookings' AND policyname='Users can update company series bookings') THEN
    CREATE POLICY "Users can update company series bookings" ON public.series_chart_bookings
      FOR UPDATE USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='series_chart_bookings' AND policyname='Users can delete company series bookings') THEN
    CREATE POLICY "Users can delete company series bookings" ON public.series_chart_bookings
      FOR DELETE USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
