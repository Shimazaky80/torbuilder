-- Activities / Tours and Fees & Tickets: what a tour needs to run, and the two
-- heads a fee is billed on separately from the client's price.

-- Two things the library could not say about an activity.
--
-- First, whether the supplier needs a crowd. A game drive that will not depart
-- under four guests is a different product from a boat hop that runs whatever
-- walks up, but the item carried no minimum at all, so the operator learned about
-- it by being turned away at the gate. min_pax_to_run is deliberately nullable:
-- NULL means the supplier set no floor, and 0 means the same thing in the
-- operator's words. A blank is a real answer, not a missing one.
--
-- Second, the guide. The guide_rate column has been on item_rates since the
-- guide & driver rooms arrived, and the Meals and Flights editors already use it.
-- An activity or a park fee bills the same way - the operator's guide joins the
-- tour and the supplier charges a place for them - but nothing wrote or read the
-- figure there, so the number in the supplier's tariff had nowhere to live.

-- Entrance fees are the last fee type with no child figure. A conservation levy
-- has carried conservation_levy_per_child from the start because parks publish a
-- citizen / SADC / visitor-child ladder; a park entrance fee was quoted per head
-- and every child was billed the adult amount. Properties charge children
-- differently on both, so the entrance fee gets the column the levy already had.
-- Nullable on purpose: no column at all means the property does not split the
-- price by age, and the child pays the adult figure.

ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS min_pax_to_run INTEGER;

COMMENT ON COLUMN public.library_items.min_pax_to_run IS
  'The smallest party the supplier will run this activity for. NULL or 0 means there is no minimum.';

ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS entrance_fee_per_child NUMERIC(12, 2);

COMMENT ON COLUMN public.item_rates.entrance_fee_per_child IS
  'What one child pays for this park / entrance fee. NULL means the property does not price children differently and a child pays entrance_fee_per_person.';

NOTIFY pgrst, 'reload schema';
