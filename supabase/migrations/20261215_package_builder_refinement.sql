ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS inclusions TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS exclusions TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS terms_and_conditions TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_available_in_library BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.package_day_items
  ADD COLUMN IF NOT EXISTS vehicle_capacity INTEGER,
  ADD COLUMN IF NOT EXISTS rate_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.packages SET default_markup_percentage = 0
WHERE default_markup_percentage <> 0;

CREATE INDEX IF NOT EXISTS packages_published_library_idx
  ON public.packages(company_id, name)
  WHERE is_available_in_library = TRUE;

NOTIFY pgrst, 'reload schema';
