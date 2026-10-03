-- Preserve a package's included services on the itinerary's single package row.
-- Snapshot data remains available if the reusable package is edited or deleted.
ALTER TABLE public.itinerary_day_items
  ADD COLUMN IF NOT EXISTS source_package_id UUID REFERENCES public.packages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS package_snapshot JSONB;

NOTIFY pgrst, 'reload schema';
