-- Reusable, date-free tour packages. Package days and items are separate from
-- booked itineraries so templates cannot enter booking or finance workflows.
CREATE TABLE IF NOT EXISTS public.packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover_image_url TEXT,
  gallery_image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_markup_percentage NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (default_markup_percentage >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.package_validity_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  valid_from DATE NOT NULL,
  valid_to DATE NOT NULL,
  CHECK (valid_to >= valid_from)
);

CREATE TABLE IF NOT EXISTS public.package_pax_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  adults INTEGER NOT NULL CHECK (adults > 0),
  children INTEGER NOT NULL DEFAULT 0 CHECK (children >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (package_id, adults, children)
);

CREATE TABLE IF NOT EXISTS public.package_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  day_number INTEGER NOT NULL CHECK (day_number > 0),
  notes TEXT,
  UNIQUE (package_id, day_number)
);

CREATE TABLE IF NOT EXISTS public.package_day_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_day_id UUID NOT NULL REFERENCES public.package_days(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  item_id UUID REFERENCES public.library_items(id) ON DELETE SET NULL,
  rate_id UUID REFERENCES public.item_rates(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  category TEXT,
  supplier_name TEXT,
  currency_code TEXT NOT NULL DEFAULT 'ZAR',
  rate_basis TEXT NOT NULL DEFAULT 'per_person',
  unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  markup_percentage NUMERIC(8,2) NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  is_included BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS packages_company_created_idx ON public.packages(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS package_days_package_idx ON public.package_days(package_id, day_number);
CREATE INDEX IF NOT EXISTS package_items_day_idx ON public.package_day_items(package_day_id, sort_order);
CREATE INDEX IF NOT EXISTS package_validity_package_idx ON public.package_validity_periods(package_id, valid_from, valid_to);

ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_validity_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_pax_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_day_items ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.packages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.package_validity_periods TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.package_pax_options TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.package_days TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.package_day_items TO authenticated;

DROP POLICY IF EXISTS packages_company_access ON public.packages;
CREATE POLICY packages_company_access ON public.packages FOR ALL
  USING (company_id = public.get_user_company_id() OR public.is_super_admin())
  WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());

DROP POLICY IF EXISTS package_validity_company_access ON public.package_validity_periods;
CREATE POLICY package_validity_company_access ON public.package_validity_periods FOR ALL
  USING (EXISTS (SELECT 1 FROM public.packages p WHERE p.id = package_id AND (p.company_id = public.get_user_company_id() OR public.is_super_admin())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.packages p WHERE p.id = package_id AND (p.company_id = public.get_user_company_id() OR public.is_super_admin())));

DROP POLICY IF EXISTS package_pax_company_access ON public.package_pax_options;
CREATE POLICY package_pax_company_access ON public.package_pax_options FOR ALL
  USING (EXISTS (SELECT 1 FROM public.packages p WHERE p.id = package_id AND (p.company_id = public.get_user_company_id() OR public.is_super_admin())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.packages p WHERE p.id = package_id AND (p.company_id = public.get_user_company_id() OR public.is_super_admin())));

DROP POLICY IF EXISTS package_days_company_access ON public.package_days;
CREATE POLICY package_days_company_access ON public.package_days FOR ALL
  USING (EXISTS (SELECT 1 FROM public.packages p WHERE p.id = package_id AND (p.company_id = public.get_user_company_id() OR public.is_super_admin())))
  WITH CHECK (company_id = public.get_user_company_id() AND EXISTS (SELECT 1 FROM public.packages p WHERE p.id = package_id AND (p.company_id = public.get_user_company_id() OR public.is_super_admin())));

DROP POLICY IF EXISTS package_items_company_access ON public.package_day_items;
CREATE POLICY package_items_company_access ON public.package_day_items FOR ALL
  USING (EXISTS (SELECT 1 FROM public.package_days d JOIN public.packages p ON p.id = d.package_id WHERE d.id = package_day_id AND (p.company_id = public.get_user_company_id() OR public.is_super_admin())))
  WITH CHECK (company_id = public.get_user_company_id()
    AND EXISTS (SELECT 1 FROM public.package_days d JOIN public.packages p ON p.id = d.package_id WHERE d.id = package_day_id AND (p.company_id = public.get_user_company_id() OR public.is_super_admin()))
    AND (item_id IS NULL OR EXISTS (SELECT 1 FROM public.library_items i WHERE i.id = item_id AND (i.company_id = public.get_user_company_id() OR public.is_super_admin()))));

DROP TRIGGER IF EXISTS packages_set_updated_at ON public.packages;
CREATE TRIGGER packages_set_updated_at BEFORE UPDATE ON public.packages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

NOTIFY pgrst, 'reload schema';
