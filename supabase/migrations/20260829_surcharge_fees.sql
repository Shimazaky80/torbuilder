-- ==========================================
-- Surcharge Fees: Entrance Fees + Conservation Levy as sub-features
-- Removes standalone 'Entrance fees' / 'Conservation Levies' categories;
-- they become selectable options on Accommodation (both) and Transfers
-- (entrance fees) items.
-- ==========================================

-- 1. Item-level fee type: whether the item charges entrance fees and/or a
--    conservation levy on top of its base rates.
ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS fee_type TEXT NOT NULL DEFAULT 'none'
  CHECK (fee_type IN ('none', 'entrance', 'conservation'));

-- 2. Conservation levy charging basis (per night or per stay).
ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS conservation_levy_basis TEXT NOT NULL DEFAULT 'per_night'
  CHECK (conservation_levy_basis IN ('per_night', 'per_stay'));

-- 3. Per-season surcharge columns on item_rates.
ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS entrance_fee_per_person NUMERIC(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS entrance_fee_per_vehicle NUMERIC(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conservation_levy_per_adult NUMERIC(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conservation_levy_per_child NUMERIC(12, 2) DEFAULT 0;

-- 4. Re-map standalone category rows into their parent categories.
--    Entrance fees are mostly charged by accommodation (park/lodge entry) and
--    some transfers; remap existing rows to Accommodation with fee_type set.
UPDATE public.library_items
   SET category = 'Accommodation', fee_type = 'entrance'
 WHERE category = 'Entrance fees';

UPDATE public.library_items
   SET category = 'Accommodation', fee_type = 'conservation'
 WHERE category = 'Conservation Levies';

-- 5. Migrate the per-season rates into the new surcharge columns.
UPDATE public.item_rates ir
   SET entrance_fee_per_person = COALESCE(ir.price_1_adult, 0),
       entrance_fee_per_vehicle = COALESCE(ir.unit_price, 0)
  FROM public.library_items li
 WHERE li.id = ir.item_id AND li.fee_type = 'entrance';

UPDATE public.item_rates ir
   SET conservation_levy_per_adult = COALESCE(ir.price_1_adult, 0),
       conservation_levy_per_child = COALESCE((ir.child_rates_breakdown ->> 'child')::numeric, 0)
  FROM public.library_items li
 WHERE li.id = ir.item_id AND li.fee_type = 'conservation';

-- 6. Remove the standalone categories from the catalog (guarded in case the
--    library_categories migration has not been applied yet).
DO $$
BEGIN
  IF to_regclass('public.library_categories') IS NOT NULL THEN
    DELETE FROM public.library_categories
     WHERE name IN ('Entrance fees', 'Conservation Levies');
  END IF;
END $$;