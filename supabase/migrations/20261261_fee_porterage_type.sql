-- =============================================================================
-- Migration: porterage as a fee type
--
-- Porterage reuses the linked-fee machinery a park fee or conservation levy
-- already travels on: its own Fees & Tickets item, its own validity windows,
-- sticky onto the first day the property is dropped. What makes it different
-- is behaviour the app already enforces — once per stay whatever the row
-- stored, per person, guide and driver never billed — so this migration adds
-- no columns. It widens the one check constraint that would refuse the new
-- value, and says what the answer means.
--
--   * 'porterage' is a FOURTH fee type. It is priced from the entrance columns
--     (entrance_fee_per_person, entrance_fee_per_child when the property splits
--     by age), exactly like an entrance fee; the type names the line and forces
--     the once-off, crew-excluded reading.
--   * The charge-basis and unit-basis constraints already admit the answers
--     porterage uses ('once_off', 'per_person'), so they are left alone.
--
-- itinerary_day_items.surcharge_type carries no check constraint, so a line
-- quoted after this migration reads back its stored type untouched.
-- =============================================================================

ALTER TABLE public.library_items
  DROP CONSTRAINT IF EXISTS library_items_surcharge_type_check;

ALTER TABLE public.library_items
  ADD CONSTRAINT library_items_surcharge_type_check
  CHECK (surcharge_type IS NULL
    OR surcharge_type IN ('entrance_fee', 'conservation_levy', 'porterage', 'ticket'));

COMMENT ON COLUMN public.library_items.surcharge_type IS
  '''entrance_fee'' | ''conservation_levy'' | ''porterage'' | ''ticket''. A ticket is admitted on the entrance columns — the type names the line, it does not change where the figure is stored. Porterage is a once-per-stay service on the same entrance columns, charged per person with guide and driver excluded. Only a levy quotes its own adult/child ladder, and only a levy offers a basis that bills children alone. NULL reads as entrance_fee.';

NOTIFY pgrst, 'reload schema';