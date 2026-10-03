-- Country and currency catalogs are shared reference data. Authenticated tenant
-- users need SELECT access; without both table grants and RLS policies, PostgREST
-- can return empty lists even when the catalogs contain ISO data.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON TABLE public.app_countries, public.app_currencies TO authenticated;

ALTER TABLE public.app_countries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_currencies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read app countries" ON public.app_countries;
CREATE POLICY "Authenticated users can read app countries"
  ON public.app_countries
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can read app currencies" ON public.app_currencies;
CREATE POLICY "Authenticated users can read app currencies"
  ON public.app_currencies
  FOR SELECT
  TO authenticated
  USING (true);

NOTIFY pgrst, 'reload schema';
