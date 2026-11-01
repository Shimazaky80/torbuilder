-- =============================================================================
-- Migration: Month-level travel timing for itineraries
--
-- Some quotations are requested as "travels in November 2026" without exact
-- dates. The itinerary keeps its pricing window in travel_start_date /
-- travel_end_date (first day of the first month to last day of the last month)
-- so the season engine, list filters and finance keep working on real bounds.
--
--   travel_date_precision  'exact' (default) - the bounds are confirmed dates
--                          'month'           - the bounds are the requested
--                                              month window; day rows carry no
--                                              day_date and duration_days says
--                                              how many days the tour runs
--   duration_days          number of tour days for a month-timed itinerary
--
-- No dates are fabricated: in 'month' mode itinerary_days.day_date stays NULL
-- until the client confirms exact travel dates, and only then are the days
-- re-dated from travel_start_date.
--
-- A month window can straddle two seasons. When the chosen season covers only
-- part of the requested months, the line is priced provisionally for that
-- part only, and the covered sub-window is recorded on the line:
--   rate_provisional_from / rate_provisional_to   the part of the month window
--                                                 the priced season actually
--                                                 covers. NULL on every other
--                                                 line, including estimates
--                                                 where the whole window is the
--                                                 season's own.
-- =============================================================================

ALTER TABLE public.itineraries
  ADD COLUMN IF NOT EXISTS travel_date_precision TEXT NOT NULL DEFAULT 'exact',
  ADD COLUMN IF NOT EXISTS duration_days INTEGER;

ALTER TABLE public.itinerary_day_items
  ADD COLUMN IF NOT EXISTS rate_provisional_from DATE,
  ADD COLUMN IF NOT EXISTS rate_provisional_to DATE;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'itineraries_travel_date_precision_check'
      AND conrelid = 'public.itineraries'::regclass
  ) THEN
    ALTER TABLE public.itineraries
      ADD CONSTRAINT itineraries_travel_date_precision_check
      CHECK (travel_date_precision IN ('exact', 'month'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'itineraries_duration_days_check'
      AND conrelid = 'public.itineraries'::regclass
  ) THEN
    ALTER TABLE public.itineraries
      ADD CONSTRAINT itineraries_duration_days_check
      CHECK (duration_days IS NULL OR duration_days > 0);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
