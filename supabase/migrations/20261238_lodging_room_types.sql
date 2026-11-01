-- Lodging model: supplier -> property (accommodation library item) -> room type -> rate plan.
--
-- An accommodation library item used to stand for one room type, which forced the
-- property's destination, region and occupancy to be repeated on every room. The
-- item is now the property; rooms are children of it and every rate row belongs to
-- one room. Non-accommodation items are unchanged.

CREATE TABLE IF NOT EXISTS public.library_item_room_types (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  item_id        UUID NOT NULL REFERENCES public.library_items(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  max_occupancy  INTEGER NOT NULL DEFAULT 2,
  max_adults     INTEGER NOT NULL DEFAULT 2,
  max_children   INTEGER NOT NULL DEFAULT 0,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS library_item_room_types_item_idx
  ON public.library_item_room_types (item_id, sort_order);

ALTER TABLE public.library_item_room_types ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='library_item_room_types' AND policyname='Users can view company room types') THEN
    CREATE POLICY "Users can view company room types" ON public.library_item_room_types
      FOR SELECT USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='library_item_room_types' AND policyname='Users can insert company room types') THEN
    CREATE POLICY "Users can insert company room types" ON public.library_item_room_types
      FOR INSERT WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='library_item_room_types' AND policyname='Users can update company room types') THEN
    CREATE POLICY "Users can update company room types" ON public.library_item_room_types
      FOR UPDATE USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='library_item_room_types' AND policyname='Users can delete company room types') THEN
    CREATE POLICY "Users can delete company room types" ON public.library_item_room_types
      FOR DELETE USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
END $$;

-- A rate row names the room it prices. The room's capacity is copied onto the row
-- so a snapshot (rate card, package line, partner export) carries everything it
-- needs without a second lookup.
ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS room_type          TEXT,
  ADD COLUMN IF NOT EXISTS room_type_id       UUID REFERENCES public.library_item_room_types(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS room_max_occupancy INTEGER,
  ADD COLUMN IF NOT EXISTS room_max_adults    INTEGER,
  ADD COLUMN IF NOT EXISTS room_max_children  INTEGER;

CREATE INDEX IF NOT EXISTS item_rates_room_type_idx
  ON public.item_rates (room_type_id);

-- The line remembers which room was sold, so a reload, a copied line and a
-- re-opened allocation dialog all read the same room.
ALTER TABLE public.itinerary_day_items
  ADD COLUMN IF NOT EXISTS room_type_id UUID REFERENCES public.library_item_room_types(id) ON DELETE SET NULL;

ALTER TABLE public.package_day_items
  ADD COLUMN IF NOT EXISTS room_type_id UUID REFERENCES public.library_item_room_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS room_type    TEXT;

-- Backfill: every existing accommodation item becomes a property with one room
-- type named after it, and its rates are attached to that room. Nothing is
-- renamed or deleted; legacy test rows keep working as one-room properties.
INSERT INTO public.library_item_room_types
  (company_id, item_id, name, max_occupancy, max_adults, max_children, sort_order)
SELECT
  li.company_id,
  li.id,
  COALESCE(NULLIF(trim(li.name), ''), 'Room'),
  GREATEST(1, COALESCE(li.max_occupancy, 2)),
  GREATEST(1, COALESCE(li.max_adults, 2)),
  GREATEST(0, COALESCE(li.max_children, 0)),
  0
FROM public.library_items li
WHERE lower(COALESCE(li.category, '')) = 'accommodation'
  AND NOT EXISTS (
    SELECT 1 FROM public.library_item_room_types rt WHERE rt.item_id = li.id
  );

UPDATE public.item_rates r
SET
  room_type_id       = rt.id,
  room_type          = COALESCE(NULLIF(r.room_type, ''), rt.name),
  room_max_occupancy = COALESCE(r.room_max_occupancy, rt.max_occupancy),
  room_max_adults    = COALESCE(r.room_max_adults, rt.max_adults),
  room_max_children  = COALESCE(r.room_max_children, rt.max_children)
FROM public.library_item_room_types rt
WHERE r.room_type_id IS NULL
  AND rt.item_id = r.item_id
  AND rt.sort_order = 0;

COMMENT ON TABLE public.library_item_room_types IS
  'Room types sold at an accommodation library item (the property).';
COMMENT ON COLUMN public.item_rates.room_type_id IS
  'The room type this rate plan prices. NULL on non-accommodation rates.';

NOTIFY pgrst, 'reload schema';
