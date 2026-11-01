-- Meals and flights that the guide & driver are also served on.

-- A tour guide who eats with the group is billed through the guide's own detail
-- lines, and those lines are pulled from the Meals module. Until now the dialog
-- listed EVERY meal in the library, so a crew lunch, a client-only tasting menu
-- and a park restaurant all appeared as candidates for feeding the guide, and
-- the operator had to remember which was which on every single day.
--
-- Rate figures were never the problem: item_rates already carries guide_rate and
-- driver_rate, so a meal can price the two parties differently. What was missing
-- was the supplier's answer to a simpler question - is this meal on the crew
-- manifest at all? That is a fact about the item, not about a season, so it
-- belongs on library_items beside guide_driver_room_offered.
--
-- Flights worked the opposite way. A supplier who flies the group sometimes
-- sells the guide's seat on the same flight, and there was nowhere to say so:
-- the fare columns had no guide figure at all. guide_rate joins them, and the
-- builder offers the guide's own ticket as a companion line beside the flight
-- rather than folding an extra seat into the party's count, which would have
-- charged it to the clients.

ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS guide_meal_offered BOOLEAN;

COMMENT ON COLUMN public.library_items.guide_meal_offered IS
  'This meal is one the guide can be booked on. The guide details dialog only offers flagged meals, and falls back to the whole Meals module while nothing is flagged.';

ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS driver_meal_offered BOOLEAN;

COMMENT ON COLUMN public.library_items.driver_meal_offered IS
  'This meal is one the driver is served too. When the guide is booked on it, the driver is added as a second guide-only line priced at the rate row''s driver_rate.';

ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS guide_flight_offered BOOLEAN;

COMMENT ON COLUMN public.library_items.guide_flight_offered IS
  'The supplier also sells the guide''s seat on this flight. When it is dropped on a day, the builder offers a separate guide-only line priced at the rate row''s guide_rate.';

NOTIFY pgrst, 'reload schema';
