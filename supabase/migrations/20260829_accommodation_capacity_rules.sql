-- =============================================================================
-- Migration: Accommodation Occupancy & Sharing Capacity Limits
-- Adds max_adults and max_children to support granular accommodation rules
-- =============================================================================

ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS max_adults INTEGER DEFAULT 2,
  ADD COLUMN IF NOT EXISTS max_children INTEGER DEFAULT 2;

-- Populate existing rows where max_adults is NULL
UPDATE public.library_items
SET 
  max_adults = COALESCE(max_occupancy, 2),
  max_children = GREATEST(0, COALESCE(max_occupancy, 2) - 1)
WHERE max_adults IS NULL;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
