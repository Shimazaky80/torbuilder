-- =============================================================================
-- Migration: Car rental priced by the 24-hour block, and its contract fee
--
-- The car rental module (20260829_car_rental.sql) already stores a vehicle group,
-- a vehicle, a rate code, the rental-length ranges and the six physical facts
-- about the car. What it never had was the money the hire company adds to every
-- contract, and nothing in the application read these rows for pricing at all.
--
-- Two things change in meaning here, so they are stated on the columns rather
-- than left to the editor's labels:
--
--   * A range price is a PER DAY figure. Car hire is charged in 24-hour blocks,
--     so the number of blocks decides the cost: collect at 08:00 on the 18th and
--     return at 08:00 on the 19th and that is one day; return at 08:05 and it is
--     two. The band the block count lands in then supplies the daily rate.
--   * valid_from / valid_to is Rental Price Validity — the window the HIRE falls
--     in, tested against the pick-up date. It is not a reservation deadline;
--     an operator who reads it as one will price a December hire off a tariff
--     that expires before the car is collected.
--
-- rate_code carries the Contract Type ("Classic Max", "CM"). It is a liability
-- term of the hire agreement, not a discount code, which is why it prints on
-- every document that mentions the car alongside the vehicle group.
--
-- The contract fee sits on the item because the item IS the contract: one row
-- per vehicle group would let two groups of the same agreement disagree about
-- what the paperwork costs. It is folded into the vehicle line rather than sold
-- as a line of its own — one car, one line — but it is broken out on the line and
-- in the documents, because a fee that is invisible is a fee nobody can query.
--
-- rental_details freezes what was hired rather than pointing at the library row.
-- A supplier retunes its tariff next month; an itinerary already sent to a client
-- must still say Toyota Corolla Quest or similar, 5 seats, manual, and the two
-- dates the car was actually out. Same reason guide_snapshot exists.
-- =============================================================================

ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS rental_contract_fee NUMERIC(12,2);

COMMENT ON COLUMN public.library_items.rental_contract_fee IS
  'The admin / contract fee every car hire company adds to a rental agreement, in the item currency. Charged once per vehicle hired and folded into that vehicle line. NULL means the contract states none.';

ALTER TABLE public.itinerary_day_items
  ADD COLUMN IF NOT EXISTS rental_details JSONB;

ALTER TABLE public.package_day_items
  ADD COLUMN IF NOT EXISTS rental_details JSONB;

COMMENT ON COLUMN public.itinerary_day_items.rental_details IS
  '{contractType, vehicleGroup, vehicleModel, gear, luggage, doors, passengers, aircon, fuel, pickupLocation, returnLocation, sameReturn, pickupAt, returnAt, rentalDays, dailyRate, contractFee, hireTotal, total} as the operator answered at the drop. A copy on purpose: a later tariff change must not rewrite a quoted hire.';

COMMENT ON COLUMN public.package_day_items.rental_details IS
  'The same snapshot a package band carries, so a package document and the itinerary built from it describe the identical vehicle and dates.';

COMMENT ON COLUMN public.car_rental_rates.rate_code IS
  'Contract Type as the hire company names it, e.g. "Classic Max (CM)". A liability term printed on every document that mentions the car.';

COMMENT ON COLUMN public.car_rental_rates.min_days IS
  'Lower bound of this rental-length band, in 24-hour blocks. The band price is a per-day rate, so the block count decides both which band applies and the hire total.';

COMMENT ON COLUMN public.car_rental_rates.valid_from IS
  'Rental Price Validity, start. The hire must be COLLECTED on or after this date — it is not a reservation deadline.';

COMMENT ON COLUMN public.car_rental_rates.valid_to IS
  'Rental Price Validity, end. Tested against the pick-up date.';

NOTIFY pgrst, 'reload schema';
