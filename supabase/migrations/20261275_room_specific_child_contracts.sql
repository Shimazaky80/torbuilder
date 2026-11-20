-- Keep accommodation child capacities and age bands on each contracted room.
ALTER TABLE public.library_item_room_types
  ADD COLUMN IF NOT EXISTS child_policy TEXT DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS child_age_ranges JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sharing_capacity_rules JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Existing properties used one child contract for every room. Copy that
-- contract to each room so applying this migration does not change current
-- pricing or room-allocation behavior; rooms can then be edited independently.
UPDATE public.library_item_room_types AS room
SET
  child_age_ranges = COALESCE(
    NULLIF(room.child_age_ranges, '[]'::jsonb),
    NULLIF(item.child_age_ranges, '[]'::jsonb),
    '[]'::jsonb
  ),
  sharing_capacity_rules = COALESCE(
    NULLIF(room.sharing_capacity_rules, '[]'::jsonb),
    NULLIF(item.sharing_capacity_rules, '[]'::jsonb),
    '[]'::jsonb
  )
FROM public.library_items AS item
WHERE item.id = room.item_id
  AND (
    room.child_age_ranges IS NULL
    OR room.child_age_ranges = '[]'::jsonb
    OR room.sharing_capacity_rules IS NULL
    OR room.sharing_capacity_rules = '[]'::jsonb
  );

COMMENT ON COLUMN public.library_item_room_types.sharing_capacity_rules IS
  'Per-room child sharing limits, keyed by adult count.';
COMMENT ON COLUMN public.library_item_room_types.child_age_ranges IS
  'Child age bands contracted for this room type.';

NOTIFY pgrst, 'reload schema';
