-- Company-managed itinerary tour types.
CREATE TABLE IF NOT EXISTS public.company_tour_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE UNIQUE INDEX IF NOT EXISTS company_tour_types_company_name_idx
  ON public.company_tour_types (company_id, lower(name));

ALTER TABLE public.company_tour_types ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'company_tour_types'
      AND policyname = 'Users manage company tour types'
  ) THEN
    CREATE POLICY "Users manage company tour types"
      ON public.company_tour_types
      FOR ALL
      USING (company_id = public.get_user_company_id() OR public.is_super_admin())
      WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
END $$;

INSERT INTO public.company_tour_types (company_id, name)
SELECT c.id, defaults.name
FROM public.companies c
CROSS JOIN (VALUES
  ('FIT'),
  ('Series Departure'),
  ('Groups'),
  ('Incentives')
) AS defaults(name)
ON CONFLICT (company_id, lower(name)) DO NOTHING;
