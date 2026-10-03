-- =============================================================================
-- Migration: converge itineraries.status on the 7-stage lifecycle
-- Run in Supabase Dashboard -> SQL Editor (one block, one run). Idempotent.
--
-- Symptom this fixes:
--   new row for relation "itineraries" violates check constraint
--   "itineraries_status_check"
--
-- Why it happens:
--   The builder writes the lifecycle from STATUS_OPTIONS in
--   src/pages/ItineraryBuilder.jsx (quotation, provisional, confirmed,
--   in_progress, completed, cancelled). The live constraint can be an older,
--   narrower list — or a legacy build's Title Case list ('Quotation',
--   'Confirmed Booking') — so a perfectly valid write is refused.
--
-- What this does, in order:
--   1. drops every check constraint on the status column, whatever it is called;
--   2. rewrites legacy / case-variant values onto the canonical lowercase keys,
--      keeping the lifecycle stage wherever one can be recognised;
--   3. re-adds the authoritative constraint from 20260913_itinerary_builder.sql
--      and the default.
--
-- Nothing is deleted: an unrecognised value falls back to 'quotation', the
-- stage that gates the most closed.
-- =============================================================================

DO $$
DECLARE
  constraint_row RECORD;
  has_status BOOLEAN;
BEGIN
  IF to_regclass('public.itineraries') IS NULL THEN
    RAISE NOTICE 'itineraries does not exist — nothing to migrate';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'itineraries' AND column_name = 'status'
  ) INTO has_status;

  IF NOT has_status THEN
    RAISE NOTICE 'itineraries.status does not exist — nothing to migrate';
    RETURN;
  END IF;

  -- Drop the guard before rewriting, so a value the old list rejected can be
  -- normalised. \m matches a whole word, so a check on confirmation_status or
  -- any other column is left alone.
  FOR constraint_row IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.itineraries'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ~ '\mstatus\M'
  LOOP
    EXECUTE format('ALTER TABLE public.itineraries DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;

  WITH normalised AS (
    SELECT
      i.id,
      CASE regexp_replace(lower(btrim(COALESCE(i.status, ''))), '[^a-z]+', '_', 'g')
        -- canonical lifecycle values, kept as they are
        WHEN 'quotation'           THEN 'quotation'
        WHEN 'pending_confirmation' THEN 'pending_confirmation'
        WHEN 'provisional'         THEN 'provisional'
        WHEN 'confirmed'           THEN 'confirmed'
        WHEN 'in_progress'         THEN 'in_progress'
        WHEN 'cancelled'           THEN 'cancelled'
        WHEN 'completed'           THEN 'completed'
        -- legacy / Title Case / shortened forms
        WHEN 'quote'               THEN 'quotation'
        WHEN 'quoted'              THEN 'quotation'
        WHEN 'draft'               THEN 'quotation'
        WHEN 'pending'             THEN 'pending_confirmation'
        WHEN 'awaiting_confirmation' THEN 'pending_confirmation'
        WHEN 'booked'              THEN 'provisional'
        WHEN 'provisional_booking' THEN 'provisional'
        WHEN 'confirmed_booking'   THEN 'confirmed'
        WHEN 'travelling'          THEN 'in_progress'
        WHEN 'traveling'           THEN 'in_progress'
        WHEN 'complete'            THEN 'completed'
        WHEN 'canceled'            THEN 'cancelled'
        ELSE 'quotation'
      END AS target_status
    FROM public.itineraries i
  )
  UPDATE public.itineraries i
  SET status = n.target_status
  FROM normalised n
  WHERE i.id = n.id
    AND i.status IS DISTINCT FROM n.target_status;

  ALTER TABLE public.itineraries
    ALTER COLUMN status SET DEFAULT 'quotation',
    ALTER COLUMN status SET NOT NULL;

  ALTER TABLE public.itineraries
    ADD CONSTRAINT itineraries_status_check
    CHECK (status IN (
      'quotation', 'pending_confirmation', 'provisional', 'confirmed',
      'in_progress', 'cancelled', 'completed'
    ));
END;
$$;

NOTIFY pgrst, 'reload schema';