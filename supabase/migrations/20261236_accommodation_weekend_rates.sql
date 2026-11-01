-- =============================================================================
-- Migration: Accommodation weekend rates
--
-- Properties often charge a higher nightly figure on the nights the supplier
-- treats as weekend, and which nights those are is part of the contract - some
-- quote Friday and Saturday, others Thursday to Saturday, some only Saturday.
-- The weekend is never assumed: the operator picks the days and states the
-- weekend nightly price beside the normal one on the same rate row:
--
--   weekend_days   ISO weekdays the contract treats as weekend (1 = Monday,
--                  7 = Sunday). NULL/empty = no weekend pricing.
--   weekend_price  the nightly price charged instead of the row's normal
--                  figure on those nights.
--
-- It is a per-night price, not a charge type: one stay can contain both a
-- weekday and a weekend night, so the itinerary charges each night from its
-- own date. The room stays one library item with one charge type.
-- =============================================================================

ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS weekend_days SMALLINT[];

ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS weekend_price NUMERIC(12, 2);

NOTIFY pgrst, 'reload schema';
