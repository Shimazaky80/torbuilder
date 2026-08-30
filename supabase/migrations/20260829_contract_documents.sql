-- =============================================================================
-- Migration: Contract Documents for Library Items
-- Adds:
--   - library_items.contract_url  : public URL of the uploaded contract document
--   - library_items.contract_name : original file name (PDF / Word / Excel)
-- The document itself is stored in the public "contracts" storage bucket.
-- =============================================================================

ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS contract_url TEXT,
  ADD COLUMN IF NOT EXISTS contract_name TEXT;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';