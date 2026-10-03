-- =============================================================================
-- Migration: Library Items destination + generated identifier (idempotent)
-- Run in Supabase Dashboard -> SQL Editor (one block, one run). Safe to re-run.
--
-- Symptom this fixes:
--   Could not find the 'destination_region' column of 'library_items' in the
--   schema cache
--
-- Why it happens:
--   src/pages/LibraryItems.jsx writes destination_region (and reads
--   identifier_code) on every item save. The columns are defined in
--   20260929_library_item_destination_identifier.sql, which has not been
--   applied to every database, so PostgREST rejects the whole insert.
--
-- This converges the schema on that migration, and differs from it in two ways:
--   * the backfill only reads columns that actually exist on the target
--     database, so it cannot abort on a missing location/supplier column;
--   * identifier backfill skips rows without a company, which the identifier
--     trigger refuses to generate for.
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public.library_items') IS NULL THEN
    RAISE NOTICE 'library_items does not exist — nothing to migrate';
    RETURN;
  END IF;

  -- ─── STEP 1: the columns the app writes ─────────────────────────────────────
  ALTER TABLE public.library_items
    ADD COLUMN IF NOT EXISTS destination_region TEXT,
    ADD COLUMN IF NOT EXISTS identifier_code    TEXT;

  -- ─── STEP 2: the per-company, per-destination identifier counter ────────────
  CREATE TABLE IF NOT EXISTS public.library_item_identifier_counters (
    company_id        UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    destination_prefix TEXT NOT NULL,
    last_number       INTEGER NOT NULL DEFAULT 0,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (company_id, destination_prefix)
  );

  ALTER TABLE public.library_item_identifier_counters
    ADD COLUMN IF NOT EXISTS destination_prefix TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS last_number INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());

  ALTER TABLE public.library_item_identifier_counters ENABLE ROW LEVEL SECURITY;

  -- The trigger below runs as SECURITY DEFINER, so the counter table needs no
  -- policy of its own; RLS stays on so tenants cannot read each other's
  -- sequences.

  -- ─── STEP 3: carry a previous location over as the initial destination ──────
  -- Each source is probed and applied on its own, so a database without one of
  -- these columns cannot abort the backfill. Precedence: what the item already
  -- carries, its own location, then the supplier's city.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'library_items' AND column_name = 'location'
  ) THEN
    EXECUTE 'UPDATE public.library_items
             SET destination_region = nullif(btrim(location), '''')
             WHERE destination_region IS NULL OR btrim(destination_region) = ''''';
  END IF;

  IF to_regclass('public.suppliers') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'library_items' AND column_name = 'supplier_id'
     )
  THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'suppliers' AND column_name = 'city_location'
    ) THEN
      EXECUTE 'UPDATE public.library_items li
               SET destination_region = nullif(btrim(s.city_location), '''')
               FROM public.suppliers s
               WHERE s.id = li.supplier_id
                 AND (li.destination_region IS NULL OR btrim(li.destination_region) = '''')';
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'suppliers' AND column_name = 'city'
    ) THEN
      EXECUTE 'UPDATE public.library_items li
               SET destination_region = nullif(btrim(s.city), '''')
               FROM public.suppliers s
               WHERE s.id = li.supplier_id
                 AND (li.destination_region IS NULL OR btrim(li.destination_region) = '''')';
    END IF;
  END IF;

  EXECUTE 'UPDATE public.library_items
           SET destination_region = ''Unknown''
           WHERE destination_region IS NULL OR btrim(destination_region) = ''''';

  -- ─── STEP 4: generated, destination-prefixed identifier ─────────────────────
  CREATE OR REPLACE FUNCTION public.generate_library_item_identifier()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $fn$
  DECLARE
    v_prefix TEXT;
    v_number INTEGER;
    v_destination TEXT;
    v_generate BOOLEAN;
  BEGIN
    IF NEW.company_id IS NULL THEN
      RAISE EXCEPTION 'A company is required to generate a Library Item identifier';
    END IF;

    IF TG_OP = 'INSERT' THEN
      v_generate := true;
    ELSE
      v_generate := NEW.destination_region IS DISTINCT FROM OLD.destination_region
        OR NEW.identifier_code IS DISTINCT FROM OLD.identifier_code
        OR NEW.identifier_code IS NULL OR btrim(NEW.identifier_code) = '';
    END IF;

    IF v_generate THEN
      v_destination := regexp_replace(upper(coalesce(NEW.destination_region, '')), '[^A-Z]', '', 'g');
      IF v_destination = '' THEN
        v_prefix := 'UNK';
      ELSE
        v_prefix := rpad(left(v_destination, 3), 3, 'X');
      END IF;

      INSERT INTO public.library_item_identifier_counters (company_id, destination_prefix, last_number)
      VALUES (NEW.company_id, v_prefix, 0)
      ON CONFLICT (company_id, destination_prefix)
      DO UPDATE SET
        last_number = public.library_item_identifier_counters.last_number + 1,
        updated_at = timezone('utc'::text, now())
      RETURNING last_number INTO v_number;

      IF v_number > 9999 THEN
        RAISE EXCEPTION 'Identifier limit reached for destination prefix %', v_prefix;
      END IF;
      NEW.identifier_code := v_prefix || lpad(v_number::text, 4, '0');
    END IF;

    RETURN NEW;
  END;
  $fn$;

  DROP TRIGGER IF EXISTS library_items_generate_identifier ON public.library_items;
  CREATE TRIGGER library_items_generate_identifier
    BEFORE INSERT OR UPDATE OF destination_region, identifier_code
    ON public.library_items
    FOR EACH ROW EXECUTE FUNCTION public.generate_library_item_identifier();

  -- Assign identifiers to the rows that do not have one yet. Rows with no
  -- company are skipped: the trigger refuses to generate for them, and the
  -- update below would abort the whole statement.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'library_items' AND column_name = 'company_id'
  ) THEN
    UPDATE public.library_items
    SET identifier_code = NULL
    WHERE company_id IS NOT NULL
      AND (identifier_code IS NULL OR btrim(identifier_code) = '');
  ELSE
    UPDATE public.library_items
    SET identifier_code = NULL
    WHERE identifier_code IS NULL OR btrim(identifier_code) = '';
  END IF;

  -- Guarded: duplicate identifiers on a half-migrated database must not stop
  -- the columns and the trigger above from being installed.
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS library_items_company_identifier_idx
      ON public.library_items (company_id, identifier_code)
      WHERE identifier_code IS NOT NULL;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'Skipped library_items_company_identifier_idx: %', SQLERRM;
  END;
END;
$$;

NOTIFY pgrst, 'reload schema';