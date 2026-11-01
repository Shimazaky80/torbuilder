-- =============================================================================
-- Migration: Hotel star grading
--
-- A star grading is a property of the property, not of the room: the hotel is
-- graded once and every room type it sells inherits that grading. The supplier
-- record is that property, so the grade lives there and every accommodation
-- item linked to the supplier carries it into the itinerary, the vouchers and
-- the client documents without being copied onto each room.
--
-- Only accommodation suppliers use it; the column stays NULL for every other
-- supplier category, and NULL also means "not graded" (many lodges are not
-- star graded at all), so no existing row needs a value.
-- =============================================================================

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS star_rating SMALLINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.suppliers'::regclass
      AND conname = 'suppliers_star_rating_range'
  ) THEN
    ALTER TABLE public.suppliers
      ADD CONSTRAINT suppliers_star_rating_range
      CHECK (star_rating IS NULL OR (star_rating BETWEEN 1 AND 5));
  END IF;
END $$;

COMMENT ON COLUMN public.suppliers.star_rating IS
  'Hotel star grading (1-5) for accommodation suppliers. NULL = not graded / not applicable.';

NOTIFY pgrst, 'reload schema';
