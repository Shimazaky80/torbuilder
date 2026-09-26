-- Link itinerary day items to their supplier
--
-- Problem: itinerary_day_items stored only supplier_name. Supplier email (and
-- phone / website / address) could therefore only be resolved by walking
-- item_id -> library_items -> suppliers. Any service saved without an item_id
-- (custom / manually entered service) or whose library item was later removed
-- resolved to no supplier at all, so the Provisional Booking service requests
-- and the Confirmed Booking reconfirmations showed
-- "No email on file - add one in Suppliers" even when the supplier had an
-- email on file.
--
-- Fix: persist the supplier FK on the day item itself, and backfill existing
-- rows from library_items by item_id, then by an unambiguous supplier_name
-- match within the same company.
--
-- Idempotent: safe to re-run.

ALTER TABLE public.itinerary_day_items
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.itinerary_day_items.supplier_id IS
  'Supplier this service is booked with. Resolves the supplier contact (email/phone) for service requests, reconfirmations and vouchers.';

-- Backfill 1: services that still point at a library item.
UPDATE public.itinerary_day_items di
   SET supplier_id = li.supplier_id
  FROM public.library_items li
 WHERE di.supplier_id IS NULL
   AND di.item_id IS NOT NULL
   AND li.id = di.item_id
   AND li.supplier_id IS NOT NULL;

-- Backfill 2: custom services with no library item. Only link a name when
-- exactly ONE supplier in the same company carries that name, so an ambiguous
-- name is left NULL rather than silently pointed at the wrong supplier.
UPDATE public.itinerary_day_items di
   SET supplier_id = u.supplier_id
  FROM (
        SELECT d2.company_id,
               lower(trim(d2.supplier_name)) AS sname,
               min(s.id)                 AS supplier_id
          FROM public.itinerary_day_items d2
          JOIN public.suppliers s
            ON s.company_id = d2.company_id
           AND lower(trim(s.name)) = lower(trim(d2.supplier_name))
         WHERE d2.item_id IS NULL
           AND d2.supplier_name IS NOT NULL
           AND trim(d2.supplier_name) <> ''
         GROUP BY d2.company_id, lower(trim(d2.supplier_name))
        HAVING count(DISTINCT s.id) = 1
       ) u
 WHERE di.supplier_id IS NULL
   AND di.item_id IS NULL
   AND di.company_id = u.company_id
   AND lower(trim(di.supplier_name)) = u.sname;

CREATE INDEX IF NOT EXISTS itinerary_day_items_supplier_id_idx
  ON public.itinerary_day_items (supplier_id);
