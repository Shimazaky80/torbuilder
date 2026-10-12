-- Step 5: validity periods become the season header (D13/D14).
--
-- A season is { name, from, to, accommodation, single_supplement }: a header over
-- the package's annual service grid, never a copy of the package (D13). Trip dates
-- resolve the season (D15); the grid keeps the same prices whatever season is shown,
-- and only the amber/pink overlay figures -- accommodation and single supplement --
-- change with it (D14).
--
-- This is additive on purpose: Packages, PackageView and the builder all read and
-- write package_validity_periods today, so renaming the table now would break them
-- before the Pricing and Seasons tab (step 6) switches the readers over. The table
-- keeps its name for now; a cleanup migration in step 6/7 can rename it to
-- package_seasons once no old reader references it.
--
-- Existing rows are real seasons too: each is given a stable ordinal label, and the
-- new overlay columns default to "not set" until the operator prices them (or the
-- accommodation line resolves them by travel date).

ALTER TABLE public.package_validity_periods
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS accommodation_per_person NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS single_supplement NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Give every saved validity row a deterministic, human label. Names are nullable for
-- now because the current builder still inserts rows with dates only; step 6 tightens
-- this when the tab always writes a name.
UPDATE public.package_validity_periods AS p
SET name = COALESCE(p.name, 'Season ' || numbered.ordinal)
FROM (
  SELECT id, row_number() OVER (PARTITION BY package_id ORDER BY valid_from, valid_to) AS ordinal
  FROM public.package_validity_periods
) AS numbered
WHERE p.id = numbered.id;

ALTER TABLE public.package_validity_periods
  DROP CONSTRAINT IF EXISTS package_validity_name_blank;
ALTER TABLE public.package_validity_periods
  ADD CONSTRAINT package_validity_name_blank CHECK (name IS NULL OR length(trim(name)) > 0);

-- Season resolution reads by date, so the index orders a package's seasons by their
-- window; it also keeps the Packages list and PackageView reads cheap (they already
-- order by valid_from).
DROP INDEX IF EXISTS package_validity_season_resolve_idx;
CREATE INDEX package_validity_season_resolve_idx
  ON public.package_validity_periods (package_id, valid_from, valid_to, name);

-- Keep the existing company RLS policy on this table exactly as it is: it already
-- scopes rows through the owning package, and nothing above changes who can read or
-- write a season.

NOTIFY pgrst, 'reload schema';