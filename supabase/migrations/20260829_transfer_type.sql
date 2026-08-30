-- Transfers category: transfer type support (Airport/City, Dinner, Overland)
-- Run in Supabase Dashboard -> SQL Editor (one block, one run)

ALTER TABLE public.library_items ADD COLUMN IF NOT EXISTS transfer_type TEXT;

NOTIFY pgrst, 'reload schema';