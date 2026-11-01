-- =============================================================================
-- Migration: pre-season estimates on itinerary lines
--
-- A library item can be contracted for a season that starts after the trip
-- (travel 2027-02-16..28 against a season opening 2027-03-03). The line can be
-- added as an explicit estimate, but the line has to say which season priced it,
-- how its window sat against the travel dates, and whether the figure is still
-- provisional. Without these columns a reload loses that context and the line
-- looks like an ordinary matched price.
--   rate_season_name    item_rates season_name that priced the line
--   rate_season_status  matched | protected | undated | estimate
--   rate_valid_from     start of the window that priced the line
--   rate_valid_to       end of the window that priced the line
-- =============================================================================

ALTER TABLE public.itinerary_day_items
  ADD COLUMN IF NOT EXISTS rate_season_name TEXT,
  ADD COLUMN IF NOT EXISTS rate_season_status TEXT,
  ADD COLUMN IF NOT EXISTS rate_valid_from DATE,
  ADD COLUMN IF NOT EXISTS rate_valid_to DATE;

NOTIFY pgrst, 'reload schema';
