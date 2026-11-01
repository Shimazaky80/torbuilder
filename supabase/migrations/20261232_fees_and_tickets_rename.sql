-- ==========================================
-- Rename the "Surcharge Fees" category to "Fees & Tickets"
--
-- A Table Mountain cable-car ticket is a service in its own right, not a
-- surcharge on something else, so the category name now covers park/entrance
-- fees, conservation levies and stand-alone ticket fees alike.
-- ==========================================

-- 1. Catalog row (guarded: the catalog is optional on older databases). If a
--    database already seeded the new name, the stale row is dropped instead of
--    renaming into a unique-name collision.
DO $$
BEGIN
  IF to_regclass('public.library_categories') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.library_categories WHERE name = 'Fees & Tickets') THEN
      DELETE FROM public.library_categories WHERE name = 'Surcharge Fees';
    ELSE
      UPDATE public.library_categories
         SET name = 'Fees & Tickets'
       WHERE name = 'Surcharge Fees';
    END IF;
  END IF;
END $$;

-- 2. Existing items move with the category.
UPDATE public.library_items
   SET category = 'Fees & Tickets'
 WHERE category = 'Surcharge Fees';

-- 3. Keep the sort order alongside the other categories.
DO $$
BEGIN
  IF to_regclass('public.library_categories') IS NOT NULL THEN
    UPDATE public.library_categories
       SET sort_order = 4
     WHERE name = 'Fees & Tickets';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
