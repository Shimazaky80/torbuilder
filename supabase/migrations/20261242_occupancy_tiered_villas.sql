-- Villas priced per person by how many sleep in them.
--
-- A standard hotel room is contracted as a single rate, a sharing rate and an
-- extra-adult rate, all keyed on how many ADULTS are in the room. A villa is not
-- sold that way: the supplier quotes one per-person-per-night figure per party
-- size, and every head in the villa pays it, adult or child. Two people in a villa
-- pay far more each than six do, because the price is the villa's and the party
-- splits it.
--
-- The adult-keyed columns cannot express that contract. Three travellers made up
-- of one adult and two children read the 1-adult (single) figure, and two adults
-- with two children read the 2-adult figure, so neither landed on the pax band the
-- supplier actually quoted.
--
-- The ladder therefore lives on the rate row, beside the room and the charge type
-- it prices, and the room type carries which basis it sells on so one property can
-- hold standard rooms and tiered villas at the same time.

ALTER TABLE public.library_item_room_types
  ADD COLUMN IF NOT EXISTS pricing_model TEXT;

ALTER TABLE public.library_item_room_types
  DROP CONSTRAINT IF EXISTS library_item_room_types_pricing_model_check;

ALTER TABLE public.library_item_room_types
  ADD CONSTRAINT library_item_room_types_pricing_model_check
  CHECK (pricing_model IS NULL OR pricing_model IN ('per_person_sharing', 'per_room', 'per_person_occupancy'));

COMMENT ON COLUMN public.library_item_room_types.pricing_model IS
  'How this room is sold: per_person_sharing (adult-keyed rates), per_room (a flat price for the whole room), or per_person_occupancy (a per-head ladder keyed on total occupants, villas and apartments). Null means the property default.';

-- [{ min_pax, max_pax, rate }] - rate is per person per night, charged to every
-- head in the room. Only read when the row is priced on the occupancy basis.
ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS occupancy_rates JSONB;

COMMENT ON COLUMN public.item_rates.occupancy_rates IS
  'Per-person-per-night ladder keyed on the room''s total occupants: [{min_pax, max_pax, rate}]. Every head pays the band figure, so no child rate and no single supplement apply. Read only when rate_basis is per_person_occupancy.';

-- A room that has always been priced on the occupancy ladder keeps that basis on
-- its rows; carry it up to the room so a new season inherits it instead of
-- silently reverting the room to per-person-sharing boxes.
DO $$
BEGIN
  UPDATE public.library_item_room_types r
  SET pricing_model = 'per_person_occupancy'
  FROM public.item_rates ir
  WHERE ir.room_type_id = r.id
    AND ir.rate_basis = 'per_person_occupancy'
    AND r.pricing_model IS NULL;
EXCEPTION WHEN undefined_column THEN
  NULL;
END $$;

NOTIFY pgrst, 'reload schema';
