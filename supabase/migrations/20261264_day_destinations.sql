BEGIN;

ALTER TABLE public.itinerary_days
  ADD COLUMN IF NOT EXISTS destination_country TEXT,
  ADD COLUMN IF NOT EXISTS destination_place_id UUID REFERENCES public.app_places(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS destination_name TEXT,
  ADD COLUMN IF NOT EXISTS destination_region TEXT,
  ADD COLUMN IF NOT EXISTS end_of_day TEXT;

ALTER TABLE public.package_days
  ADD COLUMN IF NOT EXISTS destination_country TEXT,
  ADD COLUMN IF NOT EXISTS destination_place_id UUID REFERENCES public.app_places(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS destination_name TEXT,
  ADD COLUMN IF NOT EXISTS destination_region TEXT,
  ADD COLUMN IF NOT EXISTS end_of_day TEXT;

DO $$
DECLARE
  target TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY['itinerary_days', 'package_days'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = format('public.%I', target)::regclass AND conname = target || '_end_of_day_check'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (end_of_day IS NULL OR end_of_day IN (''overnight'', ''visit'', ''departure'', ''transit''))', target, target || '_end_of_day_check');
    END IF;
  END LOOP;
END $$;

COMMENT ON COLUMN public.itinerary_days.destination_name IS 'Day destination as selected; retained when the shared place is renamed or removed.';
COMMENT ON COLUMN public.package_days.destination_name IS 'Day destination as selected; retained when the shared place is renamed or removed.';

COMMIT;
NOTIFY pgrst, 'reload schema';
