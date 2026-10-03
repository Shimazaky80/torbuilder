-- =============================================================================
-- Migration: group-split identity + supplier payment confirmation per service
-- Run in Supabase Dashboard -> SQL Editor (one block, one run). Idempotent.
--
-- What this adds to itinerary_day_items:
--
--   split_group_id     Properties that together house ONE party on ONE night.
--                       A group split (e.g. 6 pax in a lodge + 4 pax in a camp)
--                       stores the same id on each property, so the split can be
--                       recognised later as one arrangement instead of two
--                       unrelated rooms. Alternatives keep a NULL id: they are
--                       options the client may not take, so they are never part
--                       of the party.
--
--   supplier_paid      The checkbox on the Operations tab: this service has been
--                       paid to the supplier. One checkbox per service, because
--                       suppliers are paid per booking, not per itinerary.
--
--   supplier_paid_at   When it was ticked (audit trail).
--
--   supplier_paid_ref  The supplier's invoice / POP reference, printed on the
--                       proof-of-payment document.
--
-- Notes:
--   * Columns are added with IF NOT EXISTS so re-running is safe.
--   * No backfill: existing rows simply read as not-yet-paid, which is the
--     truth for a booking whose payments were never confirmed here.
--   * itinerary_day_items already carries company-scoped ALL policies (see
--     20261130_itinerary_days_write_access.sql), so the builder can update a
--     single row when a checkbox is ticked.
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public.itinerary_day_items') IS NULL THEN
    RAISE NOTICE 'itinerary_day_items does not exist — apply the itinerary builder migration first';
    RETURN;
  END IF;

  ALTER TABLE public.itinerary_day_items
    ADD COLUMN IF NOT EXISTS split_group_id TEXT,
    ADD COLUMN IF NOT EXISTS supplier_paid BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS supplier_paid_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS supplier_paid_ref TEXT;
END;
$$;

-- Operations reports "who is still unpaid" across every service in a trip.
CREATE INDEX IF NOT EXISTS itinerary_day_items_supplier_paid_idx
  ON public.itinerary_day_items (company_id, supplier_paid)
  WHERE supplier_paid = false;

NOTIFY pgrst, 'reload schema';