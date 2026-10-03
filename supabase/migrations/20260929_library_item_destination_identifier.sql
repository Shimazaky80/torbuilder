-- Add a dedicated destination field and generated, destination-prefixed
-- identifier for each tenant's Library Items.

ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS destination_region TEXT,
  ADD COLUMN IF NOT EXISTS identifier_code TEXT;

CREATE TABLE IF NOT EXISTS public.library_item_identifier_counters (
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  destination_prefix TEXT NOT NULL,
  last_number INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  PRIMARY KEY (company_id, destination_prefix)
);

ALTER TABLE public.library_item_identifier_counters ENABLE ROW LEVEL SECURITY;

-- Preserve a previous location as the best available initial destination.
UPDATE public.library_items li
SET destination_region = coalesce(
  nullif(btrim(li.destination_region), ''),
  nullif(btrim(li.location), ''),
  nullif(btrim(s.city_location), ''),
  nullif(btrim(s.city), ''),
  'Unknown'
)
FROM public.suppliers s
WHERE s.id = li.supplier_id
  AND (li.destination_region IS NULL OR btrim(li.destination_region) = '');

UPDATE public.library_items
SET destination_region = 'Unknown'
WHERE destination_region IS NULL OR btrim(destination_region) = '';

CREATE OR REPLACE FUNCTION public.generate_library_item_identifier()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

DROP TRIGGER IF EXISTS library_items_generate_identifier ON public.library_items;
CREATE TRIGGER library_items_generate_identifier
BEFORE INSERT OR UPDATE OF destination_region, identifier_code
ON public.library_items
FOR EACH ROW EXECUTE FUNCTION public.generate_library_item_identifier();

-- Trigger assigns identifiers to existing rows that do not have one yet.
UPDATE public.library_items
SET identifier_code = NULL
WHERE identifier_code IS NULL OR btrim(identifier_code) = '';

CREATE UNIQUE INDEX IF NOT EXISTS library_items_company_identifier_idx
  ON public.library_items (company_id, identifier_code)
  WHERE identifier_code IS NOT NULL;

NOTIFY pgrst, 'reload schema';