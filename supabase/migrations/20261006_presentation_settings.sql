-- =============================================================================
-- Migration: Document presentation preferences (idempotent)
-- Run in Supabase Dashboard -> SQL Editor (one block, one run)
--
-- Adds three tenant-wide controls to company_billing_settings, controlling how
-- the pricing breakdown is presented on exported documents and invoices:
--   * show_supplier_in_description      BOOLEAN - controls whether each service
--                                                line also shows the supplier
--                                                under / beside its description
--                                                (invoices and itinerary exports)
--   * pricing_breakdown_mode            TEXT    - 'daily'     (default, detailed
--                                                 service-per-day breakdown)
--                                               - 'per_person' (one summary row:
--                                                 total price of all services
--                                                 per person; applies to all
--                                                 documents and invoices)
--   * show_meal_plan_on_accommodation   BOOLEAN - whether accommodation lines
--                                                show the meal plan (industry
--                                                abbreviation, e.g. B&B, FB)
--                                                under the description. The
--                                                client itinerary document
--                                                always includes the meal plan
--                                                regardless of this toggle.
--   * logo_position                     TEXT    - 'left', 'center' or 'right':
--                                                horizontal alignment of the
--                                                company logo on exported docs
--   * billing_address_position          TEXT    - 'left', 'center' or 'right':
--                                                horizontal alignment of the
--                                                billing address on exported docs
-- =============================================================================

ALTER TABLE public.company_billing_settings
  ADD COLUMN IF NOT EXISTS show_supplier_in_description      BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS pricing_breakdown_mode            TEXT    NOT NULL DEFAULT 'daily',
  ADD COLUMN IF NOT EXISTS show_meal_plan_on_accommodation   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS logo_position                     TEXT    NOT NULL DEFAULT 'left',
  ADD COLUMN IF NOT EXISTS billing_address_position          TEXT    NOT NULL DEFAULT 'left';

ALTER TABLE public.company_billing_settings DROP CONSTRAINT IF EXISTS company_billing_settings_pricing_breakdown_mode_check;
ALTER TABLE public.company_billing_settings
  ADD CONSTRAINT company_billing_settings_pricing_breakdown_mode_check
  CHECK (pricing_breakdown_mode IN ('daily', 'per_person'));

ALTER TABLE public.company_billing_settings
  DROP CONSTRAINT IF EXISTS company_billing_settings_logo_position_check,
  DROP CONSTRAINT IF EXISTS company_billing_settings_billing_address_position_check;
ALTER TABLE public.company_billing_settings
  ADD CONSTRAINT company_billing_settings_logo_position_check
  CHECK (logo_position IN ('left', 'center', 'right')),
  ADD CONSTRAINT company_billing_settings_billing_address_position_check
  CHECK (billing_address_position IN ('left', 'center', 'right'));

-- Snapshot the meal plan on invoice line items so issued invoices can show the
-- accommodation meal plan (abbreviated) in the pricing breakdown.
ALTER TABLE public.invoice_line_items
  ADD COLUMN IF NOT EXISTS meal_plan TEXT;

-- Force PostgREST schema cache reload so the new columns are visible.
NOTIFY pgrst, 'reload schema';