-- =============================================================================
-- Migration: Driver trigger on Activities / Tours and Transfers
-- Suppliers do not charge separately for a driver — the vehicle rate already
-- includes the driver. This option therefore stores ONLY triggers for the
-- itinerary builder:
--   - driver_required     : whether a dedicated driver is provided (14+ seat vehicles)
--   - driver_meals        : comma list of meals the operator covers for the driver
--                           ('lunch', 'dinner' — e.g. dinner transfer -> dinner,
--                            full-day tour -> lunch, overland -> lunch,dinner)
--   - driver_accommodation: overnight accommodation for the driver (overland/overnight)
-- Driver meal and accommodation COSTS are not captured here — the itinerary
-- builder pulls them from the Meals module (meal item driver_rate) and the
-- Accommodation module (room driver_rate / single-rate fallback).
-- =============================================================================

-- 1. Driver trigger configuration on library_items (Activities / Tours + Transfers).
ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS driver_required BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS driver_meals TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS driver_accommodation BOOLEAN DEFAULT false;

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';