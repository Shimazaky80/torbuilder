-- =============================================================================
-- Migration: Support for Dual Pricing Models (Per-Person vs Flat Room Rate)
-- Adds pricing_model column to public.library_items ('per_person' | 'per_room')
-- =============================================================================

ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS pricing_model TEXT DEFAULT 'per_person';

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
