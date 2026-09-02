-- =============================================================================
-- Migration: Car Rental module
-- Library items of the 'Car Rental' category are priced as flat per-vehicle
-- rates bound to a group + vehicle + rental-length range. One library item is
-- one contract holding one or more vehicle groups; each group carries its own
-- vehicle, rate category/code, KMS inclusion policy and a booking-validity
-- (reservation) window, plus a set of rental-length ranges each with a flat
-- per-vehicle price.
--
-- Rows are stored one per (group x range) so the itinerary builder can pick
-- the correct flat per-vehicle price for the rented length, and so editorial
-- changes are a delete-then-insert of the whole group set per item.
--
-- The 'Car Rental' category is already seeded in 20260829_library_categories.sql
-- (sort_order 10), so no category insert is needed here.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.car_rental_rates (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id        UUID NOT NULL REFERENCES public.library_items(id) ON DELETE CASCADE,
    vehicle_group  TEXT NOT NULL,
    vehicle_name   TEXT NOT NULL,
    rate_code      TEXT NOT NULL,
    kms_unlimited  BOOLEAN NOT NULL DEFAULT true,
    kms_included   NUMERIC(12,2),
    rate_basis     TEXT NOT NULL DEFAULT 'per_vehicle',
    luggage        INTEGER DEFAULT 0,
    doors          INTEGER DEFAULT 0,
    max_passengers INTEGER DEFAULT 0,
    has_aircon     BOOLEAN NOT NULL DEFAULT true,
    gear           TEXT NOT NULL DEFAULT 'automatic',
    fuel_type      TEXT NOT NULL DEFAULT 'fuel',
    min_days       INTEGER NOT NULL,
    max_days       INTEGER,
    price          NUMERIC(12,2) NOT NULL DEFAULT 0,
    valid_from     DATE,
    valid_to       DATE,
    currency       TEXT DEFAULT 'ZAR',
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index to fetch all ranges for an item's groups efficiently
CREATE INDEX IF NOT EXISTS car_rental_rates_item_id_idx ON public.car_rental_rates (item_id);

-- Enable RLS (car_rental_rates should be company-scoped via its parent item)
ALTER TABLE public.car_rental_rates ENABLE ROW LEVEL SECURITY;

-- RLS policies mirror item_rates (company-scoped through the parent library item)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='car_rental_rates' AND policyname='Users can view car rental rates') THEN
    CREATE POLICY "Users can view car rental rates" ON public.car_rental_rates
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.library_items
          WHERE library_items.id = car_rental_rates.item_id
            AND (library_items.company_id = public.get_user_company_id() OR public.is_super_admin())
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='car_rental_rates' AND policyname='Users can insert car rental rates') THEN
    CREATE POLICY "Users can insert car rental rates" ON public.car_rental_rates
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.library_items
          WHERE library_items.id = car_rental_rates.item_id
            AND (library_items.company_id = public.get_user_company_id() OR public.is_super_admin())
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='car_rental_rates' AND policyname='Users can update car rental rates') THEN
    CREATE POLICY "Users can update car rental rates" ON public.car_rental_rates
      FOR UPDATE USING (
        EXISTS (
          SELECT 1 FROM public.library_items
          WHERE library_items.id = car_rental_rates.item_id
            AND (library_items.company_id = public.get_user_company_id() OR public.is_super_admin())
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='car_rental_rates' AND policyname='Users can delete car rental rates') THEN
    CREATE POLICY "Users can delete car rental rates" ON public.car_rental_rates
      FOR DELETE USING (
        EXISTS (
          SELECT 1 FROM public.library_items
          WHERE library_items.id = car_rental_rates.item_id
            AND (library_items.company_id = public.get_user_company_id() OR public.is_super_admin())
        )
      );
  END IF;
END $$;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';