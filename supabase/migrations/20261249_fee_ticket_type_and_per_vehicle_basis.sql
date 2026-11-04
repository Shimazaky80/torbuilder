-- =============================================================================
-- Migration: a ticket as a fee type, and Per Vehicle on every fee type
--
-- Fees & Tickets stores its figures in item_rates columns that already exist —
-- entrance_fee_per_person / _per_child / _per_vehicle, conservation_levy_per_adult
-- / _per_child, guide_rate — so this migration adds no columns. What it changes
-- is one check constraint that would refuse the new value, plus the comments that
-- say what each answer now means.
--
--   * 'ticket' is a THIRD fee type. A ticket is bought at the same gate as an
--     entrance fee and is priced from the same columns: the type decides what the
--     editor, the rate card and the documents call the line, not where the money
--     is stored. No ticket-specific columns are added, so an item that already
--     carries a figure keeps it when its type is retyped.
--   * 'per_vehicle' is the flat basis a park gate actually uses — it bills the
--     car, not the heads — and is now offered on every type, a levy included. It
--     reads and writes entrance_fee_per_vehicle whatever the type, because there
--     is one vehicle column and a vehicle is a vehicle whoever quotes it.
--   * 'per_unit' is retired. It was the same idea under an ambiguous name, so the
--     app no longer offers it; it stays legal, and stays priced from unit_price,
--     because rows saved on it must keep their figures rather than read back zero.
--     An item's basis is only ever widened by the operator picking another one.
--
-- itinerary_day_items.surcharge_type carries no check constraint, so a line
-- quoted before this migration reads back its stored type untouched and needs no
-- data change.
-- =============================================================================

ALTER TABLE public.library_items
  DROP CONSTRAINT IF EXISTS library_items_surcharge_type_check;

ALTER TABLE public.library_items
  ADD CONSTRAINT library_items_surcharge_type_check
  CHECK (surcharge_type IS NULL
    OR surcharge_type IN ('entrance_fee', 'conservation_levy', 'ticket'));

ALTER TABLE public.library_items
  DROP CONSTRAINT IF EXISTS library_items_surcharge_unit_basis_check;

ALTER TABLE public.library_items
  ADD CONSTRAINT library_items_surcharge_unit_basis_check
  CHECK (surcharge_unit_basis IN
    ('per_person', 'per_adult', 'per_child', 'per_unit', 'per_vehicle'));

COMMENT ON COLUMN public.library_items.surcharge_type IS
  '''entrance_fee'' | ''conservation_levy'' | ''ticket''. A ticket is admitted on the entrance columns — the type names the line, it does not change where the figure is stored. Only a levy quotes its own adult/child ladder, and only a levy offers a basis that bills children alone. NULL reads as entrance_fee.';

COMMENT ON COLUMN public.library_items.surcharge_unit_basis IS
  '''per_person'' | ''per_adult'' | ''per_child'' | ''per_vehicle'' | ''per_unit''. Per vehicle is the flat basis on every type and stores its figure in item_rates.entrance_fee_per_vehicle. Per unit — the same idea before it was named — is retired from the editor but still priced from unit_price, so a row saved on it keeps its amount.';

NOTIFY pgrst, 'reload schema';
