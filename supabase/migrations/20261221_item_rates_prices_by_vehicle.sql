-- One price per vehicle type on a rate row, instead of one row per vehicle size.
--
-- Keyed by company_vehicle_types.code. The value is one of:
--   a number            a price
--   {"free":true}       explicitly charged nothing (FOC / Included)
--   {"na":true}         explicitly does not apply to this vehicle
--   absent              never priced, which BLOCKS that vehicle from being sold
--
-- The absent case is deliberately not a zero. Everything is charged unless a library
-- item is genuinely free, so an untouched cell has to read as an error rather than as
-- a gift. See docs/package-architecture.md, decision D12.
ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS prices_by_vehicle JSONB;
