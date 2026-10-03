-- =============================================================================
-- Migration: reconcile the Library schema with what the app writes
-- Run in Supabase Dashboard -> SQL Editor (one block, one run). Idempotent.
--
-- Symptom this fixes:
--   Could not find the 'guide_driver_room_offer(ed)' column of 'library_items'
--   in the schema cache
--
-- Why one migration instead of one column per error:
--   The live database was compared column-by-column against every migration in
--   this folder (and against the payload src/pages/LibraryItems.jsx actually
--   writes). Every table the migrations create exists live, but 21 columns on
--   library_items and 17 on item_rates were never applied. PostgREST refuses
--   the whole insert when any one of them is missing, so each feature surfaced
--   only when it was first used. This adds all of them at once.
--
-- Note on the column name: the app, the field list and every migration use
-- guide_driver_room_offered (with the -ed ending). That is the column added
-- below. The truncated name in the error is what PostgREST prints for an
-- embedded resource reference that does not resolve.
-- =============================================================================

-- ─── library_items ───────────────────────────────────────────────────────────
-- Contracts
ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS contract_url                TEXT,
  ADD COLUMN IF NOT EXISTS contract_name               TEXT;

-- Flights / charter
ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS flight_number               TEXT,
  ADD COLUMN IF NOT EXISTS airline_name                TEXT,
  ADD COLUMN IF NOT EXISTS departure_city              TEXT,
  ADD COLUMN IF NOT EXISTS arrival_city                TEXT;

-- Accommodation guide/driver room offer
ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS guide_driver_room_offered   BOOLEAN DEFAULT false;

-- Transfers
ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS transfer_type               TEXT;

-- Meals
ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS meal_type                   TEXT DEFAULT 'Breakfast',
  ADD COLUMN IF NOT EXISTS menu_type                   TEXT DEFAULT 'a_la_carte',
  ADD COLUMN IF NOT EXISTS meal_gratuity_percent       NUMERIC(5,2) DEFAULT 0;

-- Driver service (Activities / Tours + Transfers)
ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS driver_required             BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS driver_meals                TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS driver_accommodation        BOOLEAN DEFAULT false;

-- Guide service (Guide category)
ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS guide_meals                 TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS guide_accommodation         BOOLEAN DEFAULT false;

-- Tickets
ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS ticket_type                 TEXT DEFAULT 'standard';

-- Trains
ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS train_departure_date        DATE,
  ADD COLUMN IF NOT EXISTS train_journey_nights        INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS train_cabin_name            TEXT DEFAULT '';

-- Activities / Tours
ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS tour_type                   TEXT;

-- ─── item_rates ──────────────────────────────────────────────────────────────
-- Written in the same save as the item above.
ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS taxes_and_surcharges            NUMERIC(12,2) DEFAULT 0;

-- Guide / driver accommodation rates
ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS guide_rate                  NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS driver_rate                 NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guide_meal_plan             TEXT,
  ADD COLUMN IF NOT EXISTS driver_meal_plan            TEXT;

-- Entrance fees and conservation levies
ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS entrance_fee_per_person     NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS entrance_fee_per_vehicle    NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conservation_levy_per_adult NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conservation_levy_per_child  NUMERIC(12,2) DEFAULT 0;

-- Tiered transfer pricing
ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS tiered_pricing              JSONB;

-- Guide service pricing
ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS guide_transfer_rate         NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guide_half_day_rate         NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guide_full_day_rate         NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guide_overland_rate         NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guide_dinner_rate           NUMERIC(12,2) DEFAULT 0;

-- Tickets
ALTER TABLE public.item_rates
  ADD COLUMN IF NOT EXISTS fast_track_adult_rate            NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fast_track_child_rates_breakdown JSONB DEFAULT '{}'::jsonb;

-- ─── Carry over per-season rates into the surcharge columns ──────────────────
-- Same backfill as 20260829_surcharge_fees.sql, which could not run while these
-- columns did not exist. Only fills rows still sitting at zero, so re-running
-- never overwrites a figure that has since been edited in the app.
UPDATE public.item_rates ir
   SET entrance_fee_per_person = COALESCE(ir.price_1_adult, 0),
       entrance_fee_per_vehicle = COALESCE(ir.unit_price, 0)
  FROM public.library_items li
 WHERE li.id = ir.item_id
   AND li.fee_type = 'entrance'
   AND COALESCE(ir.entrance_fee_per_person, 0) = 0
   AND COALESCE(ir.entrance_fee_per_vehicle, 0) = 0;

UPDATE public.item_rates ir
   SET conservation_levy_per_adult = COALESCE(ir.price_1_adult, 0),
       conservation_levy_per_child = COALESCE((ir.child_rates_breakdown ->> 'child')::numeric, 0)
  FROM public.library_items li
 WHERE li.id = ir.item_id
   AND li.fee_type = 'conservation'
   AND COALESCE(ir.conservation_levy_per_adult, 0) = 0
   AND COALESCE(ir.conservation_levy_per_child, 0) = 0;

-- ─── clients: legacy phone column ────────────────────────────────────────────
-- Defined by 20260904_clients.sql, absent live. The Clients screens currently
-- use contact_tel / contact_cell, but selecting it can never fail later.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS phone TEXT;

NOTIFY pgrst, 'reload schema';