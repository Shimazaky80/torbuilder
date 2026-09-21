ALTER TABLE public.itinerary_day_items
  ADD COLUMN IF NOT EXISTS room_allocations JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS repeat_group_id TEXT;

CREATE INDEX IF NOT EXISTS itinerary_day_items_repeat_group_id_idx
  ON public.itinerary_day_items (repeat_group_id)
  WHERE repeat_group_id IS NOT NULL;
