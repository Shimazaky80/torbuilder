-- Children are conditional in a package: the number of children on a booking is
-- unknown when the package is built, so the package declares a single child age
-- range and the accommodation contract decides the price for it. There is no child
-- head-count in the traveller pattern - a pattern is a party size only.
ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS accepts_children BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS child_age_ranges JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.packages.accepts_children IS
  'Whether a child may travel on this package. When false the package is quoted for adults only.';

COMMENT ON COLUMN public.packages.child_age_ranges IS
  'A single child age range: [{name, ageFrom, ageTo}] with ageTo <= 18, using the same shape as library_items.child_age_ranges. The accommodation contract decides which of its own bands prices that range, so this is a quote range, not a per-band table.';

CREATE INDEX IF NOT EXISTS packages_child_capable_idx
  ON public.packages(company_id, name)
  WHERE accepts_children = TRUE;

-- 2. Pricing Protection on a package line. A package item whose season does not
--    span the package validity dates is priced from the closest prior season with
--    the tenant's protection percentage added, exactly as an itinerary is. The
--    percentage and the season it was taken from are kept on the line so a
--    protected price stays explainable after it is saved and re-read.
ALTER TABLE public.package_day_items
  ADD COLUMN IF NOT EXISTS price_protection_percent NUMERIC(6, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS protected_season_name TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'package_day_items_price_protection_check'
  ) THEN
    ALTER TABLE public.package_day_items
      ADD CONSTRAINT package_day_items_price_protection_check
      CHECK (price_protection_percent >= 0 AND price_protection_percent <= 100);
  END IF;
END;
$$;

COMMENT ON COLUMN public.package_day_items.price_protection_percent IS
  'Pricing Protection applied to this line because no season covers the package validity dates. 0 means the season covers them.';

COMMENT ON COLUMN public.package_day_items.protected_season_name IS
  'Season the protected price was taken from, so the line can explain itself.';

NOTIFY pgrst, 'reload schema';