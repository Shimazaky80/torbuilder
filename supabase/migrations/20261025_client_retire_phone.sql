-- Retire the redundant client "phone" field.
-- The Clients module now captures contact numbers as:
--   contact_tel   (Tel # / Landline)
--   contact_cell  (Cell #)
-- so the old generic "phone" column is redundant and was the reason contact
-- numbers were not appearing on documents.

-- 1. Preserve any existing values so nothing is lost.
UPDATE public.clients
SET contact_tel = COALESCE(NULLIF(TRIM(contact_tel), ''), NULLIF(TRIM(phone), ''))
WHERE phone IS NOT NULL
  AND TRIM(phone) <> '';

UPDATE public.clients
SET contact_cell = COALESCE(NULLIF(TRIM(contact_cell), ''), NULLIF(TRIM(phone), ''))
WHERE phone IS NOT NULL
  AND TRIM(phone) <> ''
  AND COALESCE(NULLIF(TRIM(contact_tel), ''), '') = '';

-- 2. Remove the column from the table.
ALTER TABLE public.clients DROP COLUMN IF EXISTS phone;

NOTIFY pgrst, 'reload schema';
