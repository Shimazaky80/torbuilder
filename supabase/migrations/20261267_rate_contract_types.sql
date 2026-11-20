-- FIT and Series contracts on the same room and season.
--
-- A supplier quotes the same room twice: once on its FIT (free independent
-- traveller) contract and once on its Series contract. Both are real prices for
-- the same room, season and board basis, so they belong on two rate rows of the
-- one library item rather than on two library items. An itinerary priced as a
-- Series departure then reads the Series row; a FIT booking reads the FIT one.
--
-- A row with no rate type is a rate that applies to every contract, which is
-- what every row saved before this feature means. Nothing has to be backfilled:
-- an untyped matrix keeps pricing exactly as it does today.
--
-- A package carries the contract it is sold under for the same reason - its
-- lines must pick the FIT or Series row, not whichever row came back first.

ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS rate_type TEXT;

ALTER TABLE public.item_rates
  DROP CONSTRAINT IF EXISTS item_rates_rate_type_check;

ALTER TABLE public.item_rates
  ADD CONSTRAINT item_rates_rate_type_check
  CHECK (rate_type IS NULL OR rate_type IN ('fit', 'series'));

COMMENT ON COLUMN public.item_rates.rate_type IS
  'Which contract this row prices: fit, series, or NULL for a rate that applies to every contract.';

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS rate_type TEXT;

ALTER TABLE public.packages
  DROP CONSTRAINT IF EXISTS packages_rate_type_check;

ALTER TABLE public.packages
  ADD CONSTRAINT packages_rate_type_check
  CHECK (rate_type IS NULL OR rate_type IN ('fit', 'series'));

COMMENT ON COLUMN public.packages.rate_type IS
  'The contract the package is sold under: fit, series, or NULL to read whatever rate the season resolver would have used before rate types existed.';

-- The itinerary already records its tour type; the contract is read from it in
-- the app rather than stored twice, so no itinerary column is added here.

NOTIFY pgrst, 'reload schema';
