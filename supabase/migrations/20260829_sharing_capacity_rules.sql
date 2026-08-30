-- =============================================================================
-- Migration: Conditional Room Sharing Capacity Rules by Adult Count
-- Adds sharing_capacity_rules JSONB to support per-adult-count child sharing limits
-- =============================================================================

ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS sharing_capacity_rules JSONB DEFAULT '[]'::jsonb;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
