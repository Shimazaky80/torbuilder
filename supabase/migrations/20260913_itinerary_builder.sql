-- =============================================================================
-- Migration: Itinerary Builder — day planning tables (patch-style, idempotent)
-- Run in Supabase Dashboard -> SQL Editor (one block, one run)
--
-- The original (legacy) app shipped its own empty `itinerary_days` and
-- `itinerary_day_items` tables. They carry no data (verified 0 rows) and their
-- schema is incompatible with the rebuild, so they are dropped and recreated
-- here. `get_client_sales_totals()` keeps working because every column it reads
-- (selling_price_per_person_override, custom_item_selling_price_pp,
-- item_price_per_person, is_included) is recreated below.
--
-- Column semantics:
--   unit_cost  = STO (buy)   price per person from the supplier
--   unit_price = Net (sell)  price per person charged to the client
--   markup_percentage = per-service markup applied on top of unit_cost to
--   derive unit_price (editable inline in the builder). Falls back to the
--   client's markup_percentage when a service is first added.
--   rate_basis = how the contract charges ('per_person' | 'per_vehicle' |
--   'per_trip' | 'per_room' | 'tiered' | 'per_person_sharing'). Flat /
--   per-vehicle / per-trip rates are charged once per booking, so their unit_cost
--   is the contract total divided by traveller count (per-pax × pax reproduces
--   the contract amount). Accommodation uses 'per_person_sharing': 1 traveller
--   pays the single rate, 2+ travellers the per-person sharing rate — never the
--   single rate multiplied by pax.
-- =============================================================================

-- ─── STEP 1: Drop legacy (empty) day tables ──────────────────────────────────
DROP TABLE IF EXISTS public.itinerary_day_items CASCADE;
DROP TABLE IF EXISTS public.itinerary_days CASCADE;

-- ─── STEP 2: itinerary_days — one row per day of the tour ────────────────────
CREATE TABLE IF NOT EXISTS public.itinerary_days (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    itinerary_id  UUID NOT NULL REFERENCES public.itineraries(id) ON DELETE CASCADE,
    company_id    UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    day_number    INTEGER NOT NULL DEFAULT 1,
    day_date      DATE,
    notes         TEXT,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at    TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.itinerary_days
  ADD COLUMN IF NOT EXISTS itinerary_id UUID REFERENCES public.itineraries(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS company_id   UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS day_number   INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS day_date     DATE,
  ADD COLUMN IF NOT EXISTS notes        TEXT,
  ADD COLUMN IF NOT EXISTS created_at   TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;

CREATE INDEX IF NOT EXISTS itinerary_days_itinerary_id_idx ON public.itinerary_days (itinerary_id);
CREATE INDEX IF NOT EXISTS itinerary_days_company_id_idx   ON public.itinerary_days (company_id);

-- ─── STEP 3: itinerary_day_items — the services dropped onto each day ────────
CREATE TABLE IF NOT EXISTS public.itinerary_day_items (
    id                               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    itinerary_day_id                 UUID NOT NULL REFERENCES public.itinerary_days(id) ON DELETE CASCADE,
    company_id                       UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    item_id                          UUID REFERENCES public.library_items(id) ON DELETE SET NULL,
    item_name                        TEXT NOT NULL DEFAULT '',
    description_override             TEXT,
    category                         TEXT,
    supplier_name                    TEXT,
    currency_code                    TEXT NOT NULL DEFAULT 'ZAR',
    unit_cost                        NUMERIC(12,2) NOT NULL DEFAULT 0,
    unit_price                       NUMERIC(12,2) NOT NULL DEFAULT 0,
    markup_percentage                NUMERIC(12,2) NOT NULL DEFAULT 0,
    rate_basis                       TEXT NOT NULL DEFAULT 'per_person',
    item_price_per_person            NUMERIC(12,2) NOT NULL DEFAULT 0,
    selling_price_per_person_override NUMERIC(12,2),
    custom_item_selling_price_pp     NUMERIC(12,2),
    quantity                         INTEGER NOT NULL DEFAULT 1,
    pax                              INTEGER NOT NULL DEFAULT 1,
    total_buy                        NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_sell                       NUMERIC(12,2) NOT NULL DEFAULT 0,
    is_included                      BOOLEAN NOT NULL DEFAULT true,
    notes                            TEXT,
    sort_order                       INTEGER NOT NULL DEFAULT 0,
    created_at                       TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at                       TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.itinerary_day_items
  ADD COLUMN IF NOT EXISTS itinerary_day_id                 UUID REFERENCES public.itinerary_days(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS company_id                       UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS item_id                          UUID REFERENCES public.library_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS item_name                        TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS description_override             TEXT,
  ADD COLUMN IF NOT EXISTS category                         TEXT,
  ADD COLUMN IF NOT EXISTS supplier_name                    TEXT,
  ADD COLUMN IF NOT EXISTS currency_code                    TEXT NOT NULL DEFAULT 'ZAR',
  ADD COLUMN IF NOT EXISTS unit_cost                        NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_price                       NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS markup_percentage                NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rate_basis                       TEXT NOT NULL DEFAULT 'per_person',
  ADD COLUMN IF NOT EXISTS item_price_per_person            NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS selling_price_per_person_override NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS custom_item_selling_price_pp     NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS quantity                         INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pax                              INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS total_buy                        NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_sell                       NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_included                      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notes                            TEXT,
  ADD COLUMN IF NOT EXISTS sort_order                       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at                       TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  ADD COLUMN IF NOT EXISTS updated_at                       TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL;

CREATE INDEX IF NOT EXISTS itinerary_day_items_day_id_idx    ON public.itinerary_day_items (itinerary_day_id);
CREATE INDEX IF NOT EXISTS itinerary_day_items_company_id_idx ON public.itinerary_day_items (company_id);

-- ─── STEP 4: itineraries gains a notes column (Notes tab) ────────────────────
ALTER TABLE public.itineraries
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- ─── STEP 4b: itinerary status lifecycle ─────────────────────────────────────
-- The builder lets users move an itinerary through the 7-stage lifecycle:
-- Quotation, Pending Confirmation, Provisional Booking, Confirmed Booking,
-- In Progress, Cancelled and Completed. Normalise any values left over from
-- the prototype phase, then guard the column so only the lifecycle states are
-- stored.
UPDATE public.itineraries
  SET status = 'quotation'
  WHERE status IS NULL OR status NOT IN ('quotation', 'pending_confirmation', 'provisional', 'confirmed', 'in_progress', 'cancelled', 'completed');

-- Drop the previous lifecycle constraint (if any) so the list below is
-- authoritative on re-runs, then re-add it including all lifecycle states.
ALTER TABLE public.itineraries DROP CONSTRAINT IF EXISTS itineraries_status_check;
ALTER TABLE public.itineraries ADD CONSTRAINT itineraries_status_check
  CHECK (status IN ('quotation', 'pending_confirmation', 'provisional', 'confirmed', 'in_progress', 'cancelled', 'completed'));

-- ─── STEP 5: RLS — company-scoped like every other table ─────────────────────
ALTER TABLE public.itinerary_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.itinerary_day_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='itinerary_days' AND policyname='Users can view company itinerary days') THEN
    CREATE POLICY "Users can view company itinerary days" ON public.itinerary_days
      FOR SELECT USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='itinerary_days' AND policyname='Users can insert company itinerary days') THEN
    CREATE POLICY "Users can insert company itinerary days" ON public.itinerary_days
      FOR INSERT WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='itinerary_days' AND policyname='Users can update company itinerary days') THEN
    CREATE POLICY "Users can update company itinerary days" ON public.itinerary_days
      FOR UPDATE USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='itinerary_days' AND policyname='Users can delete company itinerary days') THEN
    CREATE POLICY "Users can delete company itinerary days" ON public.itinerary_days
      FOR DELETE USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='itinerary_day_items' AND policyname='Users can view company itinerary day items') THEN
    CREATE POLICY "Users can view company itinerary day items" ON public.itinerary_day_items
      FOR SELECT USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='itinerary_day_items' AND policyname='Users can insert company itinerary day items') THEN
    CREATE POLICY "Users can insert company itinerary day items" ON public.itinerary_day_items
      FOR INSERT WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='itinerary_day_items' AND policyname='Users can update company itinerary day items') THEN
    CREATE POLICY "Users can update company itinerary day items" ON public.itinerary_day_items
      FOR UPDATE USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='itinerary_day_items' AND policyname='Users can delete company itinerary day items') THEN
    CREATE POLICY "Users can delete company itinerary day items" ON public.itinerary_day_items
      FOR DELETE USING (company_id = public.get_user_company_id() OR public.is_super_admin());
  END IF;
END $$;

-- ─── STEP 6: Auto-refresh updated_at on row changes ──────────────────────────
DROP TRIGGER IF EXISTS itinerary_days_set_updated_at ON public.itinerary_days;
CREATE TRIGGER itinerary_days_set_updated_at
  BEFORE UPDATE ON public.itinerary_days
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS itinerary_day_items_set_updated_at ON public.itinerary_day_items;
CREATE TRIGGER itinerary_day_items_set_updated_at
  BEFORE UPDATE ON public.itinerary_day_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── STEP 7: Force PostgREST schema cache reload ─────────────────────────────
NOTIFY pgrst, 'reload schema';