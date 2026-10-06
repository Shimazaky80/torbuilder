-- The currency a package is sold in, chosen when the package is created.
--
-- A package is priced in exactly one currency: the builder refuses a service priced in
-- anything else, because two currencies in one package make the total meaningless. Until
-- this column the currency was only ever implied by whichever service happened to be added
-- first, which meant the library sidebar could not filter by currency on a package with no
-- services yet, and an operator could not say up front what a package was sold in.

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'ZAR';

-- Existing packages are backfilled from the first included service they were actually
-- priced in, so none of them silently becomes ZAR. A package with no services is not
-- touched and keeps the default. A package that somehow holds more than one currency takes
-- its earliest line: the builder will refuse further additions in anything else anyway.
WITH first_seen AS (
  SELECT DISTINCT ON (d.package_id)
    d.package_id,
    UPPER(BTRIM(di.currency_code)) AS currency_code
  FROM public.package_days AS d
  JOIN public.package_day_items AS di ON di.package_day_id = d.id
  WHERE di.is_included IS DISTINCT FROM false
    AND NULLIF(BTRIM(di.currency_code), '') IS NOT NULL
  ORDER BY d.package_id, d.day_number, di.sort_order, di.id
)
UPDATE public.packages AS p
SET currency_code = fs.currency_code
FROM first_seen AS fs
WHERE p.id = fs.package_id
  AND UPPER(COALESCE(p.currency_code, '')) <> fs.currency_code;

COMMENT ON COLUMN public.packages.currency_code IS
  'The single currency this package is priced in, chosen at creation. The builder refuses services priced in any other currency. Backfilled from the first included day item for packages created before this column.';

NOTIFY pgrst, 'reload schema';