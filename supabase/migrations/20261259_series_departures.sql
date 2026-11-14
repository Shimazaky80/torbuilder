-- =============================================================================
-- Migration: Series Departures — a fixed-date tour sold seat by seat
--
-- A series departure is not a private trip. The itinerary is fixed, the supplier
-- rooms and seats are contracted in advance, and the tour is sold one place at a
-- time out of that allocation until it is full, guaranteed, or released back to
-- the supplier. Four tables carry that, and three decisions shape them:
--
--   1. The template IS a package. `series_templates.package_id` points at the
--      existing reusable package, which already holds the fixed days, the
--      contracted rates, the seasons and the pax bands. This table adds only
--      what a package deliberately does not have: a schedule, a guarantee
--      minimum, a release period and a selling price per seat. A second
--      itinerary editor would duplicate every pricing rule in the product and
--      then drift from it.
--
--      The reference is RESTRICT, not CASCADE: deleting a package that a series
--      sells would take its departures and its sold seats with it. The Packages
--      page must be told no.
--
--   2. Sold seats are derived, never stored. `series_bookings` is the ledger and
--      the departure's sold count is a SUM over it. Two columns meaning the same
--      number drift, and the ledger is the one that can be audited. The cap is
--      enforced by a trigger here, so the screen's arithmetic is a display and
--      not the boundary.
--
--   3. A booking links to an itinerary. The seat ledger owns the inventory; the
--      party's passenger names, vouchers, invoices, receipts and cost of sales
--      stay on the itinerary machinery that already exists and is tested.
--
-- Vehicle allocation needs no table: `vehicleTypeForPax()` in
-- src/lib/packagePricing.js already chooses the smallest vehicle whose
-- max_capacity fits the confirmed party, from the company's vehicle types. The
-- pax bands in the specification are those capacity rows.
--
-- `guide_bands` and `tour_leader_rule` are stored here so the occupancy and tour
-- leader screens need no further schema; their editors arrive with those screens.
-- =============================================================================

-- ── 1. The template ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.series_templates (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  package_id         UUID NOT NULL REFERENCES public.packages(id) ON DELETE RESTRICT,
  name               TEXT NOT NULL,
  code               TEXT NOT NULL DEFAULT '',
  operates_on        JSONB NOT NULL DEFAULT '[]'::jsonb,
  valid_from         DATE NOT NULL,
  valid_to           DATE NOT NULL,
  min_pax            INTEGER NOT NULL DEFAULT 1 CHECK (min_pax > 0),
  max_pax            INTEGER NOT NULL DEFAULT 20,
  guarantee_min      INTEGER NOT NULL DEFAULT 0 CHECK (guarantee_min >= 0),
  seats_per_departure INTEGER NOT NULL DEFAULT 0 CHECK (seats_per_departure >= 0),
  release_days       INTEGER NOT NULL DEFAULT 30 CHECK (release_days >= 0),
  price_per_seat     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price_per_seat >= 0),
  currency_code      TEXT NOT NULL DEFAULT 'ZAR',
  guide_bands        JSONB NOT NULL DEFAULT '[]'::jsonb,
  tour_leader_rule   JSONB NOT NULL DEFAULT '{}'::jsonb,
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  notes              TEXT NOT NULL DEFAULT '',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CHECK (valid_to >= valid_from),
  CHECK (max_pax >= min_pax),
  -- A guarantee above the ceiling could never be met, so the departure would sit
  -- open for ever while the operator believed it was protected.
  CHECK (guarantee_min <= max_pax)
);

COMMENT ON TABLE public.series_templates IS
  'A reusable package plus the schedule and inventory rules that make it a series: operates-on weekdays, validity, pax limits, guarantee minimum, release period and the selling price per seat.';
COMMENT ON COLUMN public.series_templates.package_id IS
  'The fixed itinerary and its contracted rates. RESTRICT: a package a series sells cannot be deleted out from under its departures and sold seats.';
COMMENT ON COLUMN public.series_templates.operates_on IS
  'ISO weekdays the tour runs, Monday = 1 through Sunday = 7, e.g. [1,4] for Monday and Thursday. Empty means the schedule is unfinished, not daily.';
COMMENT ON COLUMN public.series_templates.guarantee_min IS
  'Paying passengers needed before the departure is guaranteed to run. 0 means no guarantee rule; an operator may still declare one by hand.';
COMMENT ON COLUMN public.series_templates.seats_per_departure IS
  'Seats offered on each generated departure. 0 means no cap has been stated yet, which is not the same as no seats: the allotments decide it.';
COMMENT ON COLUMN public.series_templates.release_days IS
  'Unsold allocations return to the supplier this many days before arrival. 0 means no release control.';
COMMENT ON COLUMN public.series_templates.price_per_seat IS
  'The selling price of one place, copied onto each departure when it is generated. The package lines carry contract COST; this is what the seat is sold for.';
COMMENT ON COLUMN public.series_templates.guide_bands IS
  '[{minPax, maxPax, guides, assistants}] — how many guides the confirmed party size requires. Edited by the occupancy screen.';
COMMENT ON COLUMN public.series_templates.tour_leader_rule IS
  '{mode: fixed|foc|sharing, amount, focPer, sharesWithGuide, singleSupplement} — a fixed cost, one free place per N paying passengers, or a bed shared with the guide. Edited by the tour leader screen.';

CREATE INDEX IF NOT EXISTS series_templates_company_idx ON public.series_templates (company_id, status);
CREATE INDEX IF NOT EXISTS series_templates_package_idx ON public.series_templates (package_id);

-- ── 2. The departure ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.series_departures (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  template_id     UUID NOT NULL REFERENCES public.series_templates(id) ON DELETE CASCADE,
  departure_date  DATE NOT NULL,
  departure_code  TEXT NOT NULL,
  return_date     DATE,
  status          TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'guaranteed', 'waitlist', 'closed', 'cancelled', 'completed')),
  seat_capacity   INTEGER NOT NULL DEFAULT 0 CHECK (seat_capacity >= 0),
  guarantee_min   INTEGER NOT NULL DEFAULT 0 CHECK (guarantee_min >= 0),
  price_per_seat  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price_per_seat >= 0),
  currency_code   TEXT NOT NULL DEFAULT 'ZAR',
  release_date    DATE,
  notes           TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CHECK (return_date IS NULL OR return_date >= departure_date),
  UNIQUE (template_id, departure_date)
);

COMMENT ON TABLE public.series_departures IS
  'One dated running of a series template: its own booking container, seat cap, guarantee minimum, price and release date. Sold seats are summed from series_bookings, never stored here.';
COMMENT ON COLUMN public.series_departures.status IS
  'open / guaranteed / waitlist are proposed from the seat count; closed / cancelled / completed are operator decisions the arithmetic never overrules. Guaranteed is sticky: a later cancellation does not un-run a tour promised to the supplier.';
COMMENT ON COLUMN public.series_departures.seat_capacity IS
  'Seats offered on this running, snapshotted from the template and editable per departure. 0 means no cap stated, so the over-sale guard does not refuse.';
COMMENT ON COLUMN public.series_departures.release_date IS
  'departure_date minus the template release period: the day unsold allocations go back to the supplier.';

CREATE INDEX IF NOT EXISTS series_departures_company_date_idx ON public.series_departures (company_id, departure_date);
CREATE INDEX IF NOT EXISTS series_departures_template_date_idx ON public.series_departures (template_id, departure_date);
CREATE INDEX IF NOT EXISTS series_departures_release_idx ON public.series_departures (company_id, release_date)
  WHERE status IN ('open', 'guaranteed', 'waitlist');

-- ── 3. The allotment ledger ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.series_departure_inventory (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  departure_id   UUID NOT NULL REFERENCES public.series_departures(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL DEFAULT 'hotel_room'
                 CHECK (kind IN ('hotel_room', 'vehicle', 'guide', 'tour_leader', 'meal', 'activity', 'other')),
  item_id        UUID REFERENCES public.library_items(id) ON DELETE SET NULL,
  room_type_id   UUID REFERENCES public.library_item_room_types(id) ON DELETE SET NULL,
  supplier_name  TEXT NOT NULL DEFAULT '',
  label          TEXT NOT NULL DEFAULT '',
  allocated      INTEGER NOT NULL DEFAULT 0 CHECK (allocated >= 0),
  unit_cost      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  currency_code  TEXT NOT NULL DEFAULT 'ZAR',
  release_date   DATE,
  notes          TEXT NOT NULL DEFAULT '',
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE public.series_departure_inventory IS
  'What the operator holds from the supplier on one departure: rooms by type, vehicles, guides, crew beds, meals and activities. `allocated` is the allotment; sold and remaining are derived from the bookings that consume it, so no second number can drift.';
COMMENT ON COLUMN public.series_departure_inventory.release_date IS
  'This allotment''s own release day, where the supplier contract differs from the departure default.';

CREATE INDEX IF NOT EXISTS series_inventory_departure_idx ON public.series_departure_inventory (departure_id, sort_order);
CREATE INDEX IF NOT EXISTS series_inventory_release_idx ON public.series_departure_inventory (company_id, release_date);

-- ── 4. The seat ledger ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.series_bookings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  departure_id      UUID NOT NULL REFERENCES public.series_departures(id) ON DELETE CASCADE,
  client_id         UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  itinerary_id      UUID REFERENCES public.itineraries(id) ON DELETE SET NULL,
  reference         TEXT NOT NULL DEFAULT '',
  seats             INTEGER NOT NULL CHECK (seats > 0),
  status            TEXT NOT NULL DEFAULT 'provisional'
                    CHECK (status IN ('provisional', 'confirmed', 'waitlist', 'cancelled', 'completed')),
  price_per_seat    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price_per_seat >= 0),
  total             NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency_code     TEXT NOT NULL DEFAULT 'ZAR',
  option_expires_on DATE,
  notes             TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE public.series_bookings IS
  'One party''s places on one departure. This is the authority on sold seats. The linked itinerary carries the party''s names, documents, invoices and cost of sales.';
COMMENT ON COLUMN public.series_bookings.status IS
  'confirmed and completed hold seats against the cap; provisional is an option reported beside the sold count; waitlist is a place asked for beyond the cap; cancelled gives its seats back.';
COMMENT ON COLUMN public.series_bookings.itinerary_id IS
  'The party''s itinerary, so passenger names, vouchers, invoices and receipts come from the machinery that already exists. SET NULL: cancelling a booking must not delete the paperwork.';
COMMENT ON COLUMN public.series_bookings.option_expires_on IS
  'When a provisional hold lapses. An option with no expiry holds seats for ever.';
COMMENT ON COLUMN public.series_bookings.total IS
  'What this party is charged, snapshotted at sale. A later price change on the departure must not rewrite a sold booking.';

CREATE INDEX IF NOT EXISTS series_bookings_departure_status_idx ON public.series_bookings (departure_id, status);
CREATE INDEX IF NOT EXISTS series_bookings_company_idx ON public.series_bookings (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS series_bookings_client_idx ON public.series_bookings (client_id);
CREATE INDEX IF NOT EXISTS series_bookings_itinerary_idx ON public.series_bookings (itinerary_id);

-- ── 5. Row level security ────────────────────────────────────────────────────
-- The same boundary every tenant table uses, including the platform clause: the
-- platform holds no company of its own and acts on the tenant it has picked.
ALTER TABLE public.series_templates          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.series_departures         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.series_departure_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.series_bookings           ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['series_templates', 'series_departures', 'series_departure_inventory', 'series_bookings']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='Series rows are readable in the company') THEN
      EXECUTE format('CREATE POLICY "Series rows are readable in the company" ON public.%I FOR SELECT USING (company_id = public.get_user_company_id() OR public.is_super_admin())', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='Series rows are insertable in the company') THEN
      EXECUTE format('CREATE POLICY "Series rows are insertable in the company" ON public.%I FOR INSERT WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin())', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='Series rows are updatable in the company') THEN
      EXECUTE format('CREATE POLICY "Series rows are updatable in the company" ON public.%I FOR UPDATE USING (company_id = public.get_user_company_id() OR public.is_super_admin())', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='Series rows are deletable in the company') THEN
      EXECUTE format('CREATE POLICY "Series rows are deletable in the company" ON public.%I FOR DELETE USING (company_id = public.get_user_company_id() OR public.is_super_admin())', t);
    END IF;
  END LOOP;
END $$;

-- ── 6. A child row belongs to its departure's company ────────────────────────
-- RLS on the child tables only tests the row's own company_id, so a tenant who
-- knew a neighbour's departure UUID could insert a booking or an allotment
-- against it while stamping their own company on the row. The parent decides.
CREATE OR REPLACE FUNCTION public.guard_series_departure_child()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company UUID;
BEGIN
  SELECT company_id INTO v_company FROM series_departures WHERE id = NEW.departure_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That departure no longer exists.';
  END IF;
  IF NEW.company_id IS DISTINCT FROM v_company THEN
    RAISE EXCEPTION 'Access Denied: this row belongs to the company of its departure.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS series_inventory_company_guard ON public.series_departure_inventory;
CREATE TRIGGER series_inventory_company_guard
  BEFORE INSERT OR UPDATE ON public.series_departure_inventory
  FOR EACH ROW EXECUTE FUNCTION public.guard_series_departure_child();

DROP TRIGGER IF EXISTS series_bookings_company_guard ON public.series_bookings;
CREATE TRIGGER series_bookings_company_guard
  BEFORE INSERT OR UPDATE ON public.series_bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_series_departure_child();

-- ── 7. The allocation cannot be over-sold ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_series_booking_seats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_departure series_departures%ROWTYPE;
  v_held      INTEGER;
  v_remaining INTEGER;
BEGIN
  SELECT * INTO v_departure FROM series_departures WHERE id = NEW.departure_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That departure no longer exists.';
  END IF;
  IF v_departure.status IN ('closed', 'cancelled', 'completed') THEN
    RAISE EXCEPTION 'This departure is % — no further seats can be sold on it.', v_departure.status;
  END IF;
  -- A waitlist place is a request beyond the cap, and an option is not a sale.
  -- Neither consumes the allocation, so neither is held against it here.
  IF NEW.status NOT IN ('confirmed', 'completed') THEN
    RETURN NEW;
  END IF;
  -- 0 is "no cap stated", not "no seats": the allotments have not been loaded.
  IF COALESCE(v_departure.seat_capacity, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(seats), 0) INTO v_held
    FROM series_bookings
   WHERE departure_id = NEW.departure_id
     AND status IN ('confirmed', 'completed')
     AND id IS DISTINCT FROM NEW.id;

  v_remaining := v_departure.seat_capacity - v_held;
  IF NEW.seats > v_remaining THEN
    RAISE EXCEPTION 'Only % seat(s) remain on % (% of % sold). This booking asks for %. Record it as a waitlist place, or raise the departure''s seat capacity.',
      GREATEST(v_remaining, 0), v_departure.departure_code, v_held, v_departure.seat_capacity, NEW.seats;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS series_bookings_seat_guard ON public.series_bookings;
CREATE TRIGGER series_bookings_seat_guard
  BEFORE INSERT OR UPDATE ON public.series_bookings
  FOR EACH ROW EXECUTE FUNCTION public.guard_series_booking_seats();

-- ── 8. updated_at ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS series_templates_set_updated_at ON public.series_templates;
CREATE TRIGGER series_templates_set_updated_at
  BEFORE UPDATE ON public.series_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS series_departures_set_updated_at ON public.series_departures;
CREATE TRIGGER series_departures_set_updated_at
  BEFORE UPDATE ON public.series_departures
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS series_inventory_set_updated_at ON public.series_departure_inventory;
CREATE TRIGGER series_inventory_set_updated_at
  BEFORE UPDATE ON public.series_departure_inventory
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS series_bookings_set_updated_at ON public.series_bookings;
CREATE TRIGGER series_bookings_set_updated_at
  BEFORE UPDATE ON public.series_bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 9. The new module reaches the built-in jobs ──────────────────────────────
-- `series` is the thirteenth module in src/lib/rbac.js. A role row without the
-- key answers 'none', so every built-in job is granted it here: the people who
-- sell and run departures write it, the people who bill or read them read it.
-- A company's own custom roles are deliberately untouched — a new module is
-- granted by its Admin on the Users page, not inherited by accident.
UPDATE public.roles SET access = access || '{"series":"write"}'::jsonb
 WHERE is_builtin AND key IN ('admin', 'consultant', 'operations', 'super_admin');

UPDATE public.roles SET access = access || '{"series":"read"}'::jsonb
 WHERE is_builtin AND key IN ('finance', 'guide', 'viewer');

NOTIFY pgrst, 'reload schema';