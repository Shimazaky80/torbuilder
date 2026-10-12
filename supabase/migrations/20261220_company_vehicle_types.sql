-- The vehicle type axis that every package rate row prices along.
--
-- Configured once per company in Settings. A rate row stores one price per type
-- (prices_by_vehicle) rather than one row per vehicle size, and a quote resolves the
-- vehicle as the smallest type that seats the party - so this list is what makes
-- "one row per service" possible instead of re-adding every vehicle to every day.
--
-- `code` is the stable key written into price maps and snapshots; `name` is what a
-- person reads. Keeping them apart means a vehicle can be renamed without silently
-- re-keying every saved rate.
CREATE TABLE IF NOT EXISTS public.company_vehicle_types (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code          TEXT NOT NULL CHECK (length(trim(code)) > 0),
  name          TEXT NOT NULL CHECK (length(trim(name)) > 0),
  max_capacity  INTEGER NOT NULL CHECK (max_capacity > 0),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE UNIQUE INDEX IF NOT EXISTS company_vehicle_types_company_code_idx
  ON public.company_vehicle_types (company_id, code);

CREATE UNIQUE INDEX IF NOT EXISTS company_vehicle_types_company_name_idx
  ON public.company_vehicle_types (company_id, lower(name));

-- The resolution rule reads this on every quote: smallest capacity that seats the party.
CREATE INDEX IF NOT EXISTS company_vehicle_types_company_capacity_idx
  ON public.company_vehicle_types (company_id, max_capacity)
  WHERE is_active;

ALTER TABLE public.company_vehicle_types ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'company_vehicle_types'
      AND policyname = 'Users manage company vehicle types'
  ) THEN
    CREATE POLICY "Users manage company vehicle types"
      ON public.company_vehicle_types
      FOR ALL
      USING (company_id = public.get_user_company_id() OR public.is_super_admin())
      WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
END $$;

-- The five sizes every supplier on file quotes. Companies that price other vehicles
-- add them here; nothing else in the system hardcodes a vehicle name.
INSERT INTO public.company_vehicle_types (company_id, code, name, max_capacity, sort_order)
SELECT c.id, defaults.code, defaults.name, defaults.max_capacity, defaults.sort_order
FROM public.companies c
CROSS JOIN (VALUES
  ('saloon',      'Saloon',         3, 1),
  ('combi',       'Combi',          6, 2),
  ('quantum_10',  'Quantum (10)',  10, 3),
  ('sprinter_16', 'Sprinter (16)', 16, 4),
  ('bus_39',      'Bus (39)',      39, 5)
) AS defaults(code, name, max_capacity, sort_order)
ON CONFLICT (company_id, code) DO NOTHING;
