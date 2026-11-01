-- =============================================================================
-- Migration: Accommodation night bands
--
-- Hotels often contract the same room at a different nightly price depending on
-- how long the stay runs: 1-3 nights at one figure, 4+ nights at a lower one.
-- Rather than loading the room several times with a different price each time,
-- the band lives on the rate row beside the charge type:
--
--   min_nights  the shortest stay this row prices (NULL = every stay)
--   max_nights  the longest stay this row prices (NULL = open ended)
--
-- A row with neither bound is the single rate for every stay, which is how every
-- existing accommodation row keeps behaving.
-- =============================================================================

ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS min_nights INTEGER;

ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS max_nights INTEGER;

NOTIFY pgrst, 'reload schema';
