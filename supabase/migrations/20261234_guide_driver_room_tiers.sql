-- =============================================================================
-- Migration: Guide & driver room rules
--
-- Hotels use the same deal for the guide and driver as for the tour leader:
-- book enough paying client rooms and the property includes (or discounts)
-- guide / driver rooms. The rule is a ladder on the rate row (season + board
-- basis), one per party, because the offer changes season to season:
--
--   guide_tiers  JSONB, ordered by threshold:
--     { "minClientRooms": 10, "rooms": 1, "rate": 0 }
--
--   driver_tiers JSONB, same shape.
--
--   `rooms` is the TOTAL guide (or driver) rooms included once that many client
--   rooms are booked; `rate` applies to the rooms the tier adds. Rate 0 is a
--   free room. A row without a ladder falls back to the legacy contract:
--   library_items.guide_min_rooms and item_rates.guide_rate / driver_rate.
-- =============================================================================

ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS guide_tiers JSONB;

ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS driver_tiers JSONB;

NOTIFY pgrst, 'reload schema';
