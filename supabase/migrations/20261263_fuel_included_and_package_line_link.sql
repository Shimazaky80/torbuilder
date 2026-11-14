-- =============================================================================
-- Migration: Fuel-included vehicle tariffs and package line links
--
-- Whether a vehicle's price already covers fuel is a fact about the SUPPLIER
-- CONTRACT, not about the vehicle: the same group can be hired on a
-- fuel-included tariff in one season and a fuel-excluded one in another. The
-- flag therefore lives on the tariff row, next to the price it qualifies:
--
--   item_rates.fuel_included        BOOLEAN NULL   (Transfers / Transport)
--   car_rental_rates.fuel_included  BOOLEAN NULL   (Car Rental seasons)
--
-- Three states, deliberately:
--   true   fuel included  - a fuel allowance on top would bill twice; refused
--   false  fuel excluded  - dropping the vehicle offers to add an allowance
--   NULL   not stated     - nothing is assumed, no prompt either way
--
-- NULL is the default so every contract written before this feature keeps
-- behaving exactly as it did.
--
-- The allowance itself is an Extras library item with a fuel charge type,
-- priced in the library like any other charge. When it is dropped the
-- operator says which vehicle it fuels, and the line records that link:
--
--   itinerary_day_items.linked_item_id  (already exists - fees use it)
--   package_day_items.linked_item_id    UUID NULL   (added here)
--
-- The link stores the vehicle's LIBRARY ITEM id, never a line key: itinerary
-- line keys are rebuilt on every load, and a vehicle hired across several days
-- is one product the allowance belongs to. Removing the vehicle's last line
-- removes its allowance; Copy to Days never carries one.
-- =============================================================================

ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS fuel_included BOOLEAN NULL;

ALTER TABLE public.car_rental_rates
  ADD COLUMN IF NOT EXISTS fuel_included BOOLEAN NULL;

ALTER TABLE public.package_day_items
  ADD COLUMN IF NOT EXISTS linked_item_id UUID NULL;

COMMENT ON COLUMN public.item_rates.fuel_included IS
  'True when this tariff''s price includes fuel (a fuel allowance on top would double-bill); false when fuel is excluded and an allowance is expected; NULL when the contract does not say.';

COMMENT ON COLUMN public.car_rental_rates.fuel_included IS
  'True when this hire tariff''s price includes fuel; false when fuel is excluded; NULL when not stated. Stamped onto the hire line''s rental_details snapshot.';

COMMENT ON COLUMN public.package_day_items.linked_item_id IS
  'Library item id this line belongs to: a fuel allowance points at the vehicle it fuels. Removed with the vehicle''s last line; never copied to other days.';

NOTIFY pgrst, 'reload schema';