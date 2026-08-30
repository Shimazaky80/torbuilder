-- Transfers category: tiered pricing support
-- Run in Supabase Dashboard -> SQL Editor (one block, one run)

ALTER TABLE public.item_rates ADD COLUMN IF NOT EXISTS tiered_pricing JSONB;

NOTIFY pgrst, 'reload schema';