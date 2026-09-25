-- Per-person pricing breakdown snapshot.
--
-- When the Presentation preference is "per person", the Itinerary Builder and
-- invoice documents show three price classes: Per person sharing, Single
-- supplement and Per child. The breakdown is computed at invoice issue time by
-- the shared lib/perPersonPricing helper (from the itinerary's room
-- allocations and the contracted Library rates) and stored here as an
-- immutable JSON snapshot, mirroring how the invoice line items themselves are
-- a pure snapshot of the itinerary services.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS per_person_breakdown JSONB;