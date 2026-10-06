-- PAX BANDS, and an itinerary that can differ per band.
--
-- A traveller pattern was a single party size, so a package that sells "up to 3" and
-- "from 4" had to be duplicated: one copy with a saloon and 3 pax, a second copy with a
-- microbus and 6 pax, and so on. With forty party sizes that is forty copies to keep in
-- step with each other, which is why it was being done by hand.
--
-- A pattern is now a BAND: min_pax..max_pax. A package carries one band per vehicle it
-- sells with (up to 3, from 4 to 10, from 11 to 22), the bands are derived from the
-- contracted vehicle capacities, and a band is priced at its ceiling so it can never be
-- under-quoted at the bottom of its range. A band whose min and max are equal is exactly
-- the old single party size, so every existing pattern backfills to a width-1 band and
-- existing packages keep their current prices.
--
-- Bands sometimes need a different itinerary, not just a different vehicle, so a day item
-- can belong to one band only:
--   tier_key NULL          -> the item is in every band (the shared base itinerary)
--   tier_key = <band>      -> the item exists for that band alone
--   replaces_item_key      -> that band item stands in for a base item, or, with
--                              is_included = false, drops the base item from that band
--
-- WHY item_key/tier_key AND NOT FOREIGN KEYS:
-- persist() in PackageBuilder rewrites the whole package on every save - it DELETEs the
-- package_days rows (cascading to package_day_items) and re-inserts everything, and it
-- does the same for package_pax_options. Every id is therefore recreated on each save,
-- so a foreign key pointing at a band or at a sibling item would dangle immediately after
-- the save that wrote it. The keys below are generated once on the client and carried in
-- the saved rows, so the links survive. Nothing here is enforced by the database; the
-- resolver in packagePricing.js ignores a key that no longer resolves.
ALTER TABLE public.package_pax_options
  ADD COLUMN IF NOT EXISTS item_key UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS min_pax INTEGER,
  ADD COLUMN IF NOT EXISTS max_pax INTEGER,
  ADD COLUMN IF NOT EXISTS is_auto_generated BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.package_pax_options
   SET min_pax = COALESCE(pax, 1),
       max_pax = COALESCE(pax, 1)
 WHERE min_pax IS NULL OR max_pax IS NULL;

ALTER TABLE public.package_pax_options
  ALTER COLUMN min_pax SET NOT NULL,
  ALTER COLUMN max_pax SET NOT NULL;

ALTER TABLE public.package_pax_options
  DROP CONSTRAINT IF EXISTS package_pax_options_band_check;

ALTER TABLE public.package_pax_options
  ADD CONSTRAINT package_pax_options_band_check CHECK (min_pax >= 1 AND max_pax >= min_pax);

COMMENT ON COLUMN public.package_pax_options.pax IS
  'The ceiling of this band: a band is priced at max_pax so it is never under-quoted at the bottom of its range. Kept equal to max_pax so existing pricing and UNIQUE (package_id, adults, children) keep working.';
COMMENT ON COLUMN public.package_pax_options.min_pax IS
  'Smallest party size this band covers. Equal to pax for a width-1 band.';
COMMENT ON COLUMN public.package_pax_options.max_pax IS
  'Largest party size this band covers, and the party size the band is priced at.';
COMMENT ON COLUMN public.package_pax_options.is_auto_generated IS
  'TRUE when the band was derived from a vehicle capacity and is rebuilt when services change. A band the operator edited by hand is FALSE and is never overwritten by the rebuild.';
COMMENT ON COLUMN public.package_pax_options.item_key IS
  'Stable client-generated band identifier. persist() recreates row ids on every save, so band membership is linked by this key rather than by id.';

CREATE UNIQUE INDEX IF NOT EXISTS package_pax_options_band_uniq
  ON public.package_pax_options(package_id, min_pax, max_pax);

CREATE INDEX IF NOT EXISTS package_pax_options_package_band_idx
  ON public.package_pax_options(package_id, min_pax);

ALTER TABLE public.package_day_items
  ADD COLUMN IF NOT EXISTS item_key UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS tier_key UUID,
  ADD COLUMN IF NOT EXISTS replaces_item_key UUID;

CREATE INDEX IF NOT EXISTS package_day_items_tier_key_idx
  ON public.package_day_items(tier_key);

COMMENT ON COLUMN public.package_day_items.item_key IS
  'Stable client-generated item identifier, used as the target of replaces_item_key.';
COMMENT ON COLUMN public.package_day_items.tier_key IS
  'package_pax_options.item_key this item belongs to. NULL means the item is part of the shared base itinerary and is priced in every band. Not a foreign key: ids are recreated on every save.';
COMMENT ON COLUMN public.package_day_items.replaces_item_key IS
  'item_key of the base item this one stands in for within its band. With is_included = false it means the band drops that base item instead. Not a foreign key, for the same reason as tier_key.';

NOTIFY pgrst, 'reload schema';
