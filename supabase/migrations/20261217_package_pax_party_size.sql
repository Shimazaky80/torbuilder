-- A traveller pattern is a single party size. It used to be adults + children, but a
-- child is only priced because of the accommodation, so the child is priced once in
-- the child price and must not also be counted in the pattern. Counting it twice is
-- what makes the unit contribution per pax come out too low.
--
-- adults/children are kept as a mirror (adults = pax, children = 0) so anything still
-- reading the old columns sees the same party, and so the existing UNIQUE
-- (package_id, adults, children) constraint keeps doing its job.
ALTER TABLE public.package_pax_options
  ADD COLUMN IF NOT EXISTS pax INTEGER;

UPDATE public.package_pax_options
   SET pax = COALESCE(children, 0) + adults
 WHERE pax IS NULL;

ALTER TABLE public.package_pax_options
  ALTER COLUMN pax SET NOT NULL;

ALTER TABLE public.package_pax_options
  DROP CONSTRAINT IF EXISTS package_pax_options_pax_check;

ALTER TABLE public.package_pax_options
  ADD CONSTRAINT package_pax_options_pax_check CHECK (pax > 0);

COMMENT ON COLUMN public.package_pax_options.pax IS
  'Party size for this traveller pattern. A child is not counted here: it is priced once, against the accommodation, in the package child price.';

NOTIFY pgrst, 'reload schema';
