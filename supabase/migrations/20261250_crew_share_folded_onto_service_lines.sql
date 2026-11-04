-- =============================================================================
-- Migration: the crew figure folded onto a service line
--
-- A guide's seat on a flight and a guide's place on a tour are bought together
-- with the clients' ticket, so they are no longer offered as a second line
-- "for the guide alone". The fare is added to that line's own buy and divided
-- across the travellers, exactly as a Guide fee line already shares its flat
-- per-trip figure.
--
-- The line keeps a copy of what it folded in - which crew place, the fare per
-- head, how many heads, the flat total and the divisor the party shared it over
-- - because a quote must not move when the library does: a party that later
-- grows re-shares the money that was actually bought, and a guide fare revised
-- next month cannot rewrite a seat already sold.
--
-- JSONB for the same reason rental_details is: nothing here is queried on its
-- own today, and a column per field would need a migration for every label the
-- line prints.
--
-- No price column is added or moved. guide_rate on item_rates stays the single
-- source of the crew fare, typed in Library Items.
-- =============================================================================

ALTER TABLE public.itinerary_day_items
  ADD COLUMN IF NOT EXISTS crew_share JSONB;

ALTER TABLE public.package_day_items
  ADD COLUMN IF NOT EXISTS crew_share JSONB;

COMMENT ON COLUMN public.itinerary_day_items.crew_share IS
  'The crew figure folded into this line and shared by the party: kind, fare per head, heads, flat total and the divisor it was shared over.';

COMMENT ON COLUMN public.package_day_items.crew_share IS
  'As itinerary_day_items.crew_share, carried across when an itinerary is converted into a package.';

NOTIFY pgrst, 'reload schema';
