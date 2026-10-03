-- Allow one reusable package to be assigned to multiple tenant clients or
-- travel agency partners. Each assignment remains within the same tenant.
CREATE TABLE IF NOT EXISTS public.package_client_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (package_id, client_id)
);

CREATE INDEX IF NOT EXISTS package_client_assignments_company_idx
  ON public.package_client_assignments(company_id, client_id);

ALTER TABLE public.package_client_assignments ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.package_client_assignments TO authenticated;

DROP POLICY IF EXISTS package_client_assignments_company_access
  ON public.package_client_assignments;
CREATE POLICY package_client_assignments_company_access
  ON public.package_client_assignments
  FOR ALL
  TO authenticated
  USING (
    company_id = public.get_user_company_id()
    OR public.is_super_admin()
  )
  WITH CHECK (
    (company_id = public.get_user_company_id() OR public.is_super_admin())
    AND EXISTS (
      SELECT 1 FROM public.packages p
      WHERE p.id = package_client_assignments.package_id
        AND p.company_id = package_client_assignments.company_id
    )
    AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = package_client_assignments.client_id
        AND c.company_id = package_client_assignments.company_id
    )
  );

NOTIFY pgrst, 'reload schema';
