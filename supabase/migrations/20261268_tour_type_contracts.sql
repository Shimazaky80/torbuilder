-- A tour type names the contract its work is priced under.
--
-- The app used to read the contract off the tour type's name ("FIT" priced the
-- FIT rows, "Series Departure" the Series rows). That guess is fine for the
-- standard types but wrong for a tenant that calls its series work "STO" or
-- sells a FIT product under a house name. So the mapping is stored on the tour
-- type row itself, in Settings > Tour Types, and the builders read it instead.
--
-- NULL means "not stated": the name is still read, which keeps every existing
-- tour type pricing exactly as it did before this column existed. 'any' is an
-- explicit answer from the operator: no particular contract, use whichever row
-- the season resolver finds. A national row carries no contract because the
-- platform cannot know how a tenant prices it; the obvious ones are seeded
-- below so the standard list behaves as it always has.

ALTER TABLE public.company_tour_types
  ADD COLUMN IF NOT EXISTS rate_type TEXT;

ALTER TABLE public.company_tour_types
  DROP CONSTRAINT IF EXISTS company_tour_types_rate_type_check;

ALTER TABLE public.company_tour_types
  ADD CONSTRAINT company_tour_types_rate_type_check
  CHECK (rate_type IS NULL OR rate_type IN ('fit', 'series', 'any'));

COMMENT ON COLUMN public.company_tour_types.rate_type IS
  'The contract work of this tour type is priced under: fit, series, any for no particular contract, or NULL to read the name.';

-- The two standard types whose meaning is not in doubt. A tenant override that
-- already carries a contract is left alone.
UPDATE public.company_tour_types
SET rate_type = 'fit'
WHERE company_id IS NULL
  AND rate_type IS NULL
  AND lower(name) = 'fit';

UPDATE public.company_tour_types
SET rate_type = 'series'
WHERE company_id IS NULL
  AND rate_type IS NULL
  AND lower(name) IN ('series', 'series departure');

NOTIFY pgrst, 'reload schema';
