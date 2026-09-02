-- ==========================================
-- Flight Details: airline, flight number, route
-- Extends the Flights / Charter category with specific fields.
-- ==========================================

-- 1. Flight identification and route on library_items.
ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS flight_number TEXT,
  ADD COLUMN IF NOT EXISTS airline_name   TEXT,
  ADD COLUMN IF NOT EXISTS departure_city  TEXT,
  ADD COLUMN IF NOT EXISTS arrival_city    TEXT;

-- 2. Taxes/surcharges per season on item_rates.
ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS taxes_and_surcharges NUMERIC(12, 2) DEFAULT 0;

NOTIFY pgrst, 'reload schema';
