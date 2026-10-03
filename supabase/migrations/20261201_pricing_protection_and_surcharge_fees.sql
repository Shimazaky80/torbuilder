-- =============================================================================
-- Migration: Pricing Protection, flat-rate single-room price, Surcharge Fees
-- Run in Supabase Dashboard -> SQL Editor (one block, one run). Idempotent.
--
-- This reverses the bundled-fee design from 20260829_surcharge_fees.sql, where
-- entrance fees and conservation levies were per-season columns hanging off an
-- Accommodation / Transfers item. Those columns were never read by the
-- itinerary, so the fee was invisible on the quote. Entrance fees and
-- conservation levies are now independent library items under their own
-- category, and each becomes a normal service line that can be priced,
-- marked up (or deliberately not marked up) and printed like anything else.
--
-- 1. library_items - the surcharge attributes
--      surcharge_type            Entrance Fees | Conservation Levy
--      surcharge_charge_basis    once_off | per_night
--      surcharge_unit_basis      what the fee is charged on
--      surcharge_chargeable      false = supplier figure shown for reference
--                                only; no markup, nothing added to the total
--      linked_item_id            the accommodation this fee belongs to, so the
--                                two arrive together and a per-night fee knows
--                                how many nights to repeat for
--
-- 2. item_rates - surcharge prices on the fee's own rate rows
--      entrance_fee_per_person / _per_vehicle / conservation_levy_per_adult /
--      _per_child already exist from 20260829 and are reused as-is.
--
-- 3. company_billing_settings - price_protection_percent
--      The tenant-wide Pricing Protection uplift applied when no season in the
--      pricing matrix covers the travel dates. 0 disables it.
--
-- 4. itinerary_day_items - the same surcharge attributes on the line, so a
--      surcharged service survives a reload and still knows whether it was
--      chargeable, how many times it repeated and what it was linked to.
--
-- 5. A flat Room / Unit Rate per Night already stores two figures in
--    single_room_rate / effective_single_rate, so no new column is needed -
--    the backfill below just makes sure existing flat rows that never had a
--    single-room figure fall back to the room rate.
--
-- Legacy backfill: any Accommodation / Transfers item carrying bundled fees
-- gets a standalone surcharge item per fee, linked back to the source item,
-- with the per-season fee figures copied onto its rate rows. The bundled
-- columns are left in place (harmless, and still read by the old code) but are
-- no longer written by the app.
-- =============================================================================

-- 1. Surcharge attributes on the library item.
DO $$
BEGIN
  IF to_regclass('public.library_items') IS NULL THEN
    RAISE NOTICE 'library_items does not exist — apply the library migrations first';
    RETURN;
  END IF;

  ALTER TABLE public.library_items
    ADD COLUMN IF NOT EXISTS surcharge_type TEXT,
    ADD COLUMN IF NOT EXISTS surcharge_charge_basis TEXT NOT NULL DEFAULT 'once_off',
    ADD COLUMN IF NOT EXISTS surcharge_unit_basis TEXT NOT NULL DEFAULT 'per_person',
    ADD COLUMN IF NOT EXISTS surcharge_chargeable BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS linked_item_id UUID;

  ALTER TABLE public.library_items
    DROP CONSTRAINT IF EXISTS library_items_surcharge_charge_basis_check;
  ALTER TABLE public.library_items
    ADD CONSTRAINT library_items_surcharge_charge_basis_check
    CHECK (surcharge_charge_basis IN ('once_off', 'per_night'));

  ALTER TABLE public.library_items
    DROP CONSTRAINT IF EXISTS library_items_surcharge_unit_basis_check;
  ALTER TABLE public.library_items
    ADD CONSTRAINT library_items_surcharge_unit_basis_check
    CHECK (surcharge_unit_basis IN
      ('per_person', 'per_adult', 'per_child', 'per_unit', 'per_vehicle'));

  ALTER TABLE public.library_items
    DROP CONSTRAINT IF EXISTS library_items_surcharge_type_check;
  ALTER TABLE public.library_items
    ADD CONSTRAINT library_items_surcharge_type_check
    CHECK (surcharge_type IS NULL OR surcharge_type IN ('entrance_fee', 'conservation_levy'));

  -- Self-reference: a surcharge points at its accommodation. ON DELETE SET NULL
  -- because deleting the accommodation must not delete the fee record, which
  -- still has a price and a supplier of its own.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'library_items_linked_item_id_fkey'
  ) THEN
    ALTER TABLE public.library_items
      ADD CONSTRAINT library_items_linked_item_id_fkey
      FOREIGN KEY (linked_item_id) REFERENCES public.library_items(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

-- Looking a surcharge's accommodation up is on the hot path every time the
-- builder adds a property.
CREATE INDEX IF NOT EXISTS library_items_linked_item_id_idx
  ON public.library_items (company_id, linked_item_id)
  WHERE linked_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS library_items_surcharge_type_idx
  ON public.library_items (company_id, category, surcharge_type);

-- 2. The surcharge category, seeded next to Accommodation because that is where
--    most of these fees belong. Only shifts the other categories once, on the
--    run that actually inserts it.
DO $$
BEGIN
  IF to_regclass('public.library_categories') IS NOT NULL THEN
    UPDATE public.library_categories
       SET sort_order = sort_order + 1
     WHERE sort_order >= 4
       AND NOT EXISTS (SELECT 1 FROM public.library_categories WHERE name = 'Surcharge Fees');

    INSERT INTO public.library_categories (name, icon, color, sort_order)
    VALUES ('Surcharge Fees', 'Receipt', '#f43f5e', 4)
    ON CONFLICT (name) DO NOTHING;
  END IF;
END;
$$;

-- 3. Pricing Protection percentage.
DO $$
BEGIN
  IF to_regclass('public.company_billing_settings') IS NOT NULL THEN
    ALTER TABLE public.company_billing_settings
      ADD COLUMN IF NOT EXISTS price_protection_percent NUMERIC(6, 2) NOT NULL DEFAULT 0;

    ALTER TABLE public.company_billing_settings
      DROP CONSTRAINT IF EXISTS company_billing_settings_price_protection_check;
    ALTER TABLE public.company_billing_settings
      ADD CONSTRAINT company_billing_settings_price_protection_check
      CHECK (price_protection_percent >= 0 AND price_protection_percent <= 100);
  END IF;
END;
$$;

-- 4. The same attributes on the itinerary line, so a surcharged service still
--    knows its basis, its repeat count and whether it is chargeable after the
--    page is reloaded.
DO $$
BEGIN
  IF to_regclass('public.itinerary_day_items') IS NULL THEN
    RAISE NOTICE 'itinerary_day_items does not exist — apply the itinerary builder migration first';
    RETURN;
  END IF;

  ALTER TABLE public.itinerary_day_items
    ADD COLUMN IF NOT EXISTS surcharge_type TEXT,
    ADD COLUMN IF NOT EXISTS surcharge_charge_basis TEXT,
    ADD COLUMN IF NOT EXISTS surcharge_unit_basis TEXT,
    ADD COLUMN IF NOT EXISTS surcharge_chargeable BOOLEAN,
    ADD COLUMN IF NOT EXISTS surcharge_repeats INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS surcharge_passed_through BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS surcharge_reference NUMERIC(14, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS linked_item_id UUID,
    ADD COLUMN IF NOT EXISTS price_protection_percent NUMERIC(6, 2) NOT NULL DEFAULT 0;
END;
$$;

-- 5. Legacy backfill: split bundled fees out into standalone surcharge items.
--    One fee per source item, so a property that charged both an entrance fee
--    and a conservation levy produces two linked surcharge items and the
--    itinerary shows two lines.
DO $$
DECLARE
  src RECORD;
BEGIN
  IF to_regclass('public.library_items') IS NULL
     OR to_regclass('public.item_rates') IS NULL THEN
    RETURN;
  END IF;

  FOR src IN
    SELECT id, company_id, supplier_id, location, currency, description,
           fee_type, conservation_levy_basis
      FROM public.library_items
     WHERE fee_type IN ('entrance', 'conservation')
       AND surcharge_type IS NULL
       AND id NOT IN (SELECT linked_item_id FROM public.library_items
                       WHERE linked_item_id IS NOT NULL)
  LOOP
    IF src.fee_type = 'entrance' THEN
      INSERT INTO public.library_items (
        company_id, supplier_id, name, category, description, location,
        currency, pricing_model, surcharge_type, surcharge_charge_basis,
        surcharge_unit_basis, surcharge_chargeable, linked_item_id
      )
      VALUES (
        src.company_id, src.supplier_id,
        'Entrance Fee', 'Surcharge Fees',
        COALESCE(src.description, 'Split out from a bundled entrance fee on ' || src.location),
        src.location, src.currency, 'per_person',
        'entrance_fee', 'once_off', 'per_person', TRUE, src.id
      );

      -- Per person becomes the rate's per-adult price; per vehicle becomes the
      -- unit price, so either basis resolves through the normal rate columns.
      INSERT INTO public.item_rates (
        item_id, option_name, season_name, room_type, currency,
        valid_from, valid_to, price_1_adult, unit_price, child_rates_breakdown
      )
      SELECT item_id, COALESCE(option_name, 'Base Season'), season_name, room_type,
             COALESCE(currency, 'ZAR'), valid_from, valid_to,
             COALESCE(entrance_fee_per_person, 0), COALESCE(entrance_fee_per_vehicle, 0),
             child_rates_breakdown
        FROM public.item_rates
       WHERE item_id = src.id;
    ELSE
      INSERT INTO public.library_items (
        company_id, supplier_id, name, category, description, location,
        currency, pricing_model, surcharge_type, surcharge_charge_basis,
        surcharge_unit_basis, surcharge_chargeable, linked_item_id
      )
      VALUES (
        src.company_id, src.supplier_id,
        'Conservation Levy', 'Surcharge Fees',
        COALESCE(src.description, 'Split out from a bundled conservation levy on ' || src.location),
        src.location, src.currency, 'per_person',
        'conservation_levy',
        CASE WHEN src.conservation_levy_basis = 'per_stay' THEN 'once_off' ELSE 'per_night' END,
        'per_adult', TRUE, src.id
      );

      INSERT INTO public.item_rates (
        item_id, option_name, season_name, room_type, currency,
        valid_from, valid_to, price_1_adult, child_rates_breakdown
      )
      SELECT item_id, COALESCE(option_name, 'Base Season'), season_name, room_type,
             COALESCE(currency, 'ZAR'), valid_from, valid_to,
             COALESCE(conservation_levy_per_adult, 0), child_rates_breakdown
        FROM public.item_rates
       WHERE item_id = src.id;
    END IF;
  END LOOP;
END;
$$;

-- 6. Flat Room / Unit Rate per Night: a lone adult pays the single-room figure
--    when one was ever entered, otherwise the room rate. This is a backfill of
--    the fallback, not a copy - rows that already have a real single-room
--    figure are left alone.
UPDATE public.item_rates
   SET single_room_rate = COALESCE(NULLIF(effective_single_rate, 0), unit_price)
 WHERE COALESCE(unit_price, 0) > 0
   AND COALESCE(single_room_rate, 0) = 0;

NOTIFY pgrst, 'reload schema';
