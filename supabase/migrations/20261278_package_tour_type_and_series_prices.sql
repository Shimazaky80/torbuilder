-- Packages carry the tour type that decides which contract prices their lines, and
-- a series sells one of three figures rather than a single "seat price".
--
-- Tour types are configurable tenant vocabulary, so packages.tour_type is plain
-- TEXT with no check constraint: a company may call its series product anything.
-- The series pages read the contract off the linked company_tour_types row (with
-- the old name-reading fallback), which is why the name is stored and not a code.
--
-- The three prices are snapshots. The template derives them from the package's
-- own smallest priced pax band; generating departures copies them onto each
-- departure; a booking created from a departure copies them again. price_per_seat
-- stays in step with sharing_price so older screens keep reading the same figure
-- they always did, while the two other figures become available where needed.

-- ── 1. Tour type on the package ───────────────────────────────────────────────
ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS tour_type TEXT;

COMMENT ON COLUMN public.packages.tour_type IS
  'The company''s tour type for this package. A name from company_tour_types, not a fixed enum: its rate_type mapping decides which contract prices the package.';

CREATE INDEX IF NOT EXISTS packages_company_tour_type_idx
  ON public.packages (company_id, tour_type);

-- ── 2. The three derived prices ───────────────────────────────────────────────
ALTER TABLE public.series_templates
  ADD COLUMN IF NOT EXISTS sharing_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS single_supplement_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS child_price NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.series_departures
  ADD COLUMN IF NOT EXISTS sharing_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS single_supplement_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS child_price NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.series_bookings
  ADD COLUMN IF NOT EXISTS sharing_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS single_supplement_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS child_price NUMERIC(12,2) NOT NULL DEFAULT 0;

DO $$
DECLARE
  t TEXT;
  c TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['series_templates', 'series_departures', 'series_bookings']
  LOOP
    FOREACH c IN ARRAY ARRAY['sharing_price', 'single_supplement_price', 'child_price']
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_' || c || '_check');
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%I >= 0)', t, t || '_' || c || '_check', c);
    END LOOP;
  END LOOP;
END $$;

COMMENT ON COLUMN public.series_templates.sharing_price IS
  'Per-person sharing price derived from the package''s smallest priced pax band, first active validity period.';
COMMENT ON COLUMN public.series_templates.single_supplement_price IS
  'Supplement for a traveller in their own room, derived from the package. 0 means the package does not define that price point.';
COMMENT ON COLUMN public.series_templates.child_price IS
  'Child price derived from the package. 0 means the package does not define that price point.';
COMMENT ON COLUMN public.series_departures.sharing_price IS
  'Snapshot of the template''s sharing price on the day the departures were generated.';
COMMENT ON COLUMN public.series_bookings.sharing_price IS
  'Snapshot of the departure''s sharing price at sale, so a later price change cannot rewrite a sold seat.';

-- ── 3. Backfill ───────────────────────────────────────────────────────────────
-- Only the sharing figure has a legacy equivalent. A re-run leaves a price that
-- has since been derived alone; only zeros are filled from the old column.
UPDATE public.series_templates
   SET sharing_price = COALESCE(price_per_seat, 0)
 WHERE COALESCE(sharing_price, 0) = 0
   AND COALESCE(price_per_seat, 0) <> 0;

UPDATE public.series_departures
   SET sharing_price = COALESCE(price_per_seat, 0)
 WHERE COALESCE(sharing_price, 0) = 0
   AND COALESCE(price_per_seat, 0) <> 0;

UPDATE public.series_bookings b
   SET sharing_price = CASE WHEN COALESCE(b.sharing_price, 0) = 0 THEN COALESCE(b.price_per_seat, 0) ELSE b.sharing_price END,
       single_supplement_price = CASE WHEN COALESCE(b.single_supplement_price, 0) = 0 THEN COALESCE(d.single_supplement_price, 0) ELSE b.single_supplement_price END,
       child_price = CASE WHEN COALESCE(b.child_price, 0) = 0 THEN COALESCE(d.child_price, 0) ELSE b.child_price END
  FROM public.series_departures d
 WHERE d.id = b.departure_id
   AND (COALESCE(b.sharing_price, 0) = 0
     OR COALESCE(b.single_supplement_price, 0) = 0
     OR COALESCE(b.child_price, 0) = 0);

-- ── 4. price_per_seat stays the sharing figure ────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_series_sharing_price()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.sharing_price, 0) = 0 AND COALESCE(NEW.price_per_seat, 0) > 0 THEN
      NEW.sharing_price := NEW.price_per_seat;
    ELSE
      NEW.price_per_seat := COALESCE(NEW.sharing_price, 0);
    END IF;
  ELSIF NEW.sharing_price IS DISTINCT FROM OLD.sharing_price THEN
    NEW.price_per_seat := COALESCE(NEW.sharing_price, 0);
  ELSIF NEW.price_per_seat IS DISTINCT FROM OLD.price_per_seat THEN
    -- A caller still writing the legacy column is honoured rather than ignored.
    NEW.sharing_price := COALESCE(NEW.price_per_seat, 0);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS series_templates_sharing_price_sync ON public.series_templates;
CREATE TRIGGER series_templates_sharing_price_sync
  BEFORE INSERT OR UPDATE ON public.series_templates
  FOR EACH ROW EXECUTE FUNCTION public.sync_series_sharing_price();

DROP TRIGGER IF EXISTS series_departures_sharing_price_sync ON public.series_departures;
CREATE TRIGGER series_departures_sharing_price_sync
  BEFORE INSERT OR UPDATE ON public.series_departures
  FOR EACH ROW EXECUTE FUNCTION public.sync_series_sharing_price();

-- Any booking path that reads the departure's seat price picks up all three
-- figures here, so the ledger does not need its own pricing engine.
CREATE OR REPLACE FUNCTION public.snapshot_series_booking_prices()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_departure series_departures%ROWTYPE;
BEGIN
  SELECT * INTO v_departure FROM public.series_departures WHERE id = NEW.departure_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.sharing_price, 0) = 0 THEN
    NEW.sharing_price := COALESCE(v_departure.sharing_price, 0);
  END IF;
  IF COALESCE(NEW.single_supplement_price, 0) = 0 THEN
    NEW.single_supplement_price := COALESCE(v_departure.single_supplement_price, 0);
  END IF;
  IF COALESCE(NEW.child_price, 0) = 0 THEN
    NEW.child_price := COALESCE(v_departure.child_price, 0);
  END IF;
  IF COALESCE(NEW.price_per_seat, 0) = 0 THEN
    NEW.price_per_seat := NEW.sharing_price;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS series_bookings_price_snapshot ON public.series_bookings;
CREATE TRIGGER series_bookings_price_snapshot
  BEFORE INSERT ON public.series_bookings
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_series_booking_prices();

NOTIFY pgrst, 'reload schema';
