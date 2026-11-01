-- Transport: a new library item category for suppliers that only sell the vehicle.
--
-- A Transfer is a point-to-point move tied to a flight or a hotel. A Transport
-- item is the vehicle itself, hired for whatever the day needs: a tour or
-- activity shuttle, a transfer, a long overland leg, or the vehicle standing by
-- at the client's disposal. These are predominantly bigger vehicles and buses,
-- so the vehicle is the product and it is priced whole.
--
-- Like every other space-selling line, a child pays the adult share: a seat is a
-- seat. See chargesChildRate in src/lib/servicePricing.js, which excludes this
-- category by never listing it.

ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS transport_type TEXT;

ALTER TABLE public.library_items
  DROP CONSTRAINT IF EXISTS library_items_transport_type_check;

ALTER TABLE public.library_items
  ADD CONSTRAINT library_items_transport_type_check
  CHECK (transport_type IS NULL OR transport_type IN ('tour_activity', 'transfer', 'overland', 'at_disposal'));

COMMENT ON COLUMN public.library_items.transport_type IS
  'What a Transport item is hired for: tour_activity, transfer, overland or at_disposal. Decides the driver meals and overnight the itinerary has to allow for.';

-- The category list drives the Library Items dropdown, so the new category has to
-- be seeded as well as added to the built-in fallback list in the editor.
DO $$
BEGIN
  IF to_regclass('public.library_categories') IS NOT NULL THEN
    INSERT INTO public.library_categories (name, icon, color, sort_order)
    VALUES ('Transport', 'BusFront', '#0ea5e9', 11)
    ON CONFLICT (name) DO NOTHING;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
