-- =============================================================================
-- Migration: Link an itinerary line to the guide it was priced for
--
-- guide_member_id is the link. guide_snapshot is the reason the link is not
-- enough on its own.
--
-- A tax record cannot depend on a row that somebody might edit next month. The
-- operator renames a guide, changes their ID number, moves them off a supplier,
-- or sets their uplift to 15% instead of 10 — and an invoice already issued must
-- still say what was true on the day it was raised. So the line freezes the
-- identity it charged and the two figures behind the money: the destination's
-- contract rate and the uplift that turned it into what this person was paid.
--
-- It is the same pattern packages already use with rate_snapshot, and it is why
-- the reference is ON DELETE SET NULL rather than a cascade guard: even a
-- deleted person leaves an honest, self-describing line behind.
-- =============================================================================

ALTER TABLE public.itinerary_day_items
  ADD COLUMN IF NOT EXISTS guide_member_id UUID REFERENCES public.guide_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS guide_snapshot JSONB;

COMMENT ON COLUMN public.itinerary_day_items.guide_member_id IS
  'The guide_member this line was priced for, when the operator named one. Only a line that carries a guide fee can point at a person — a driver''s bed and meal belong to the transport supplier.';

COMMENT ON COLUMN public.itinerary_day_items.guide_snapshot IS
  '{name, nationalId, passportNumber, taxNumber, licenceNumber, supplierName, baseCharge, upliftPercent, charged} as they stood when the line was written. Deliberately a copy: a later edit to the person must not rewrite an issued invoice.';

CREATE INDEX IF NOT EXISTS itinerary_day_items_guide_member_id_idx
  ON public.itinerary_day_items (guide_member_id);

NOTIFY pgrst, 'reload schema';
