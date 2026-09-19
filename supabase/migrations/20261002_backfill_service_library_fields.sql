-- =============================================================================
-- Migration: Backfill library-sourced service fields on existing itinerary rows
-- Run in Supabase Dashboard -> SQL Editor (one block, one run). Idempotent.
--
-- Fixes historical itinerary_day_items rows that were saved before the builder
-- started sourcing these values from the library item:
--   * vehicle_type   -> library_items.sub_category  (Transfers / Activities)
--   * capacity       -> library_items.max_occupancy (Transfers)
--   * max_occupancy  -> library_items.max_occupancy (Accommodation etc.)
--   * meal_plan      -> item_rates.meal_plan, default 'Bed & Breakfast'
--                      (Accommodation only)
-- Only NULL / empty target cells are filled; non-null persisted values win.
-- =============================================================================

-- 1. Vehicle type sourced from the library item's sub_category for transfer /
--    tour / activity style items.
UPDATE public.itinerary_day_items di
SET vehicle_type = li.sub_category
FROM public.library_items li
WHERE di.item_id = li.id
  AND (di.vehicle_type IS NULL OR di.vehicle_type = '')
  AND (di.category ~* 'transfer|tour|activity|excursion'
       OR li.category ~* 'transfer|tour|activity|excursion');

-- 2. Capacity and max occupancy sourced from the library item's max_occupancy.
UPDATE public.itinerary_day_items di
SET capacity       = COALESCE(di.capacity, li.max_occupancy),
    max_occupancy  = COALESCE(di.max_occupancy, li.max_occupancy)
FROM public.library_items li
WHERE di.item_id = li.id
  AND (di.capacity IS NULL OR di.max_occupancy IS NULL
       OR di.max_occupancy IS NULL);

-- 3. Meal plan sourced from the first item_rates row that carries one, with the
--    accommodation default 'Bed & Breakfast' as final fallback.
UPDATE public.itinerary_day_items di
SET meal_plan = COALESCE(
    (SELECT ir.meal_plan
       FROM public.item_rates ir
      WHERE ir.item_id = di.item_id
        AND ir.meal_plan IS NOT NULL
        AND ir.meal_plan <> ''
      ORDER BY ir.created_at
      LIMIT 1),
    'Bed & Breakfast'
  )
FROM public.library_items li
WHERE di.item_id = li.id
  AND (di.meal_plan IS NULL OR di.meal_plan = '')
  AND (di.category ~* 'accommodation' OR li.category ~* 'accommodation');

-- Force PostgREST schema cache reload so nothing is cached against stale views.
NOTIFY pgrst, 'reload schema';