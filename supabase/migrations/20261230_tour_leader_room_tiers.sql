-- Tiered tour leader room pricing.
--
-- Some properties give away (or discount) more than one tour leader room once
-- enough paying rooms are booked: e.g. one TL room free from 10 client rooms,
-- two TL rooms free from 20. The ladder sits on the rate row (season + board
-- basis) because the offer changes season to season:
--
--   tour_leader_tiers JSONB, ordered by threshold:
--     { "minClientRooms": 10, "rooms": 1, "rate": 0 }
--
--   rate 0 is a free room. A row without a ladder falls back to the legacy
--   single threshold: library_items.tour_leader_min_rooms and item_rates.
--   tour_leader_rate.
--
-- tour_leader_rate used to default to 0, which is indistinguishable from a
-- deliberate "free" once 0 became enterable. The editor never exposed a TL rate
-- field, so any 0 written before this migration means "not configured", and is
-- normalised to NULL (the engine then charges the normal single rate). New
-- saves write NULL for a blank box and keep a typed 0.

ALTER TABLE item_rates
  ADD COLUMN IF NOT EXISTS tour_leader_tiers JSONB;

ALTER TABLE item_rates
  ALTER COLUMN tour_leader_rate DROP DEFAULT;

UPDATE item_rates
   SET tour_leader_rate = NULL
 WHERE tour_leader_rate = 0;
