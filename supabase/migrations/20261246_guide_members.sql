-- =============================================================================
-- Migration: Guide Members — a guide as a person (patch-style, idempotent)
--
-- A guide has always been priced as a RATE, never recorded as a PERSON. The
-- destination's contract figure sits on the Guide library item's season row
-- (guide_full_day_rate and its four siblings) and one rate legitimately serves a
-- hundred guides, which is exactly how the operator wants to maintain it.
--
-- Two things that rate cannot carry:
--
--   1. A few guides are paid more for their skill. That is a fact about the
--      individual, not about the season, so it is stored here as a percentage
--      uplift on the person. The destination rate stays the single source of
--      truth — edit it once and every guide, premium or standard, moves with it.
--      No guide is ever re-entered as a library item.
--
--   2. Accounts and the tax authority need to know WHO was paid. A line priced
--      at R1,450 for "a guide" is not a record; the name, ID number and tax
--      number are. So the person is a real row, linked from the itinerary line.
--
-- Drivers are deliberately absent. A driver comes with the vehicle and is paid
-- by the transport supplier; the tenant carries only that driver's bed and meal,
-- which already exist as the property's crew rates. There is no driver wage in
-- this system, so a driver has no tax record to hold here.
--
-- Bank details are absent for the same reason: Torbuilder records who was paid
-- and how much, and the paying itself stays in the tenant's accounting system.
-- Columns for money the app never moves would only be data to breach.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.guide_members (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    first_name          TEXT NOT NULL DEFAULT '',
    last_name           TEXT,
    date_of_birth       DATE,
    national_id         TEXT,
    passport_number     TEXT,
    tax_number          TEXT,
    licence_number      TEXT,
    email               TEXT,
    phone               TEXT,
    city                TEXT,
    destination_area    TEXT,
    supplier_id         UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
    rate_uplift_percent NUMERIC(8,4) NOT NULL DEFAULT 0
                        CHECK (rate_uplift_percent >= 0),
    is_active           BOOLEAN NOT NULL DEFAULT true,
    notes               TEXT,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Patch: add any column missing from a table created by an earlier run of this file.
ALTER TABLE public.guide_members
  ADD COLUMN IF NOT EXISTS company_id          UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS first_name          TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_name           TEXT,
  ADD COLUMN IF NOT EXISTS date_of_birth       DATE,
  ADD COLUMN IF NOT EXISTS national_id         TEXT,
  ADD COLUMN IF NOT EXISTS passport_number     TEXT,
  ADD COLUMN IF NOT EXISTS tax_number          TEXT,
  ADD COLUMN IF NOT EXISTS licence_number      TEXT,
  ADD COLUMN IF NOT EXISTS email               TEXT,
  ADD COLUMN IF NOT EXISTS phone               TEXT,
  ADD COLUMN IF NOT EXISTS city                TEXT,
  ADD COLUMN IF NOT EXISTS destination_area    TEXT,
  ADD COLUMN IF NOT EXISTS supplier_id         UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rate_uplift_percent NUMERIC(8,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active           BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notes               TEXT,
  ADD COLUMN IF NOT EXISTS created_at          TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;

COMMENT ON TABLE public.guide_members IS
  'The individuals who guide, per company. Pricing stays on the Guide library item''s season row; this table carries identity and the person''s own uplift.';

COMMENT ON COLUMN public.guide_members.rate_uplift_percent IS
  'What this guide costs above the destination''s contract guide rate, as a percentage. 0 means the standard rate applies unchanged.';

COMMENT ON COLUMN public.guide_members.supplier_id IS
  'The guide company this individual works for, when they are not engaged directly. Nullable: a freelance guide has no supplier, and payment reporting rolls up here when there is one.';

COMMENT ON COLUMN public.guide_members.licence_number IS
  'The guide council / professional body registration number, where the guide is registered.';

COMMENT ON COLUMN public.guide_members.is_active IS
  'A guide is retired, never deleted: itinerary lines keep pointing at the person they were invoiced for.';

CREATE INDEX IF NOT EXISTS guide_members_company_id_idx ON public.guide_members (company_id);
CREATE INDEX IF NOT EXISTS guide_members_company_active_idx ON public.guide_members (company_id, is_active);
CREATE INDEX IF NOT EXISTS guide_members_supplier_id_idx ON public.guide_members (supplier_id);

ALTER TABLE public.guide_members ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='guide_members' AND policyname='Users can view company guide members') THEN
    CREATE POLICY "Users can view company guide members" ON public.guide_members
      FOR SELECT USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='guide_members' AND policyname='Users can insert company guide members') THEN
    CREATE POLICY "Users can insert company guide members" ON public.guide_members
      FOR INSERT WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='guide_members' AND policyname='Users can update company guide members') THEN
    CREATE POLICY "Users can update company guide members" ON public.guide_members
      FOR UPDATE USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='guide_members' AND policyname='Users can delete company guide members') THEN
    CREATE POLICY "Users can delete company guide members" ON public.guide_members
      FOR DELETE USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
END $$;

DROP TRIGGER IF EXISTS guide_members_set_updated_at ON public.guide_members;
CREATE TRIGGER guide_members_set_updated_at
  BEFORE UPDATE ON public.guide_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

NOTIFY pgrst, 'reload schema';
