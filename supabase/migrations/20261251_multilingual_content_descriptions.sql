-- =============================================================================
-- Migration: content descriptions in the operator's own languages
--
-- A tenant operating in Brazil writes its item descriptions in Portuguese, and
-- the document it sends a client must read in Portuguese. Until now every word
-- the app printed came from one English column, so a translated quotation meant
-- retyping the whole document outside the app.
--
-- The shape chosen is a sibling JSONB copy, not extra text columns:
--
--   description            'A stay at the falls, with transfer included'
--   text_i18n              { "pt-BR": { "description": "..." },
--                            "fr":    { "description": "..." } }
--
-- One column per language would need a migration every time a language is
-- added; one column per translatable field would need one every time a field
-- joins the set. The key is a BCP 47 tag because that is what the app formats
-- money and dates with, and `pt-BR` and `pt-PT` are not the same language as far
-- as a buyer is concerned.
--
-- English is the source and is never stored in text_i18n: it is what the plain
-- column holds, and what a document falls back to when a line has no version in
-- the requested language. That is why no row is updated or moved here — an
-- untranslated tenant's documents come out exactly as they did before this file
-- ran, and an operator who translates nothing loses nothing.
--
-- The columns are the ones whose words reach a client-facing document. Internal
-- boxes that are never printed (a CRM note on a client, the guide roster's
-- notes, the whole-itinerary notes tab) deliberately have no text_i18n: a
-- translation nobody reads is a field the operator has to fill for nothing.
--
-- company_billing_settings.document_languages is the list of languages this
-- tenant has switched on. It stays ['en'] for everyone until Settings adds a
-- language, and an English-only tenant is shown no language control anywhere.
-- =============================================================================

ALTER TABLE public.library_items
  ADD COLUMN IF NOT EXISTS text_i18n JSONB;

COMMENT ON COLUMN public.library_items.text_i18n IS
  'Translatable prose for this item, keyed language -> field -> text. Covers: description. English is never stored here - it is the plain column and the fallback.';

ALTER TABLE public.itinerary_days
  ADD COLUMN IF NOT EXISTS text_i18n JSONB;

COMMENT ON COLUMN public.itinerary_days.text_i18n IS
  'Translatable prose for this day, keyed language -> field -> text. Covers: notes. Day notes print in the client itinerary, so they travel with the line they describe.';

ALTER TABLE public.itinerary_day_items
  ADD COLUMN IF NOT EXISTS text_i18n JSONB;

COMMENT ON COLUMN public.itinerary_day_items.text_i18n IS
  'Translatable prose for this line, keyed language -> field -> text. Covers: description_override, notes. An override is the operator rewriting the item on this itinerary, so its translation belongs to the line and not to the library item.';

ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS text_i18n JSONB;

COMMENT ON COLUMN public.packages.text_i18n IS
  'Translatable prose for this package, keyed language -> field -> text. Covers: description, inclusions, exclusions, terms_and_conditions.';

ALTER TABLE public.package_days
  ADD COLUMN IF NOT EXISTS text_i18n JSONB;

COMMENT ON COLUMN public.package_days.text_i18n IS
  'Translatable prose for this package day, keyed language -> field -> text. Covers: notes.';

ALTER TABLE public.company_billing_settings
  ADD COLUMN IF NOT EXISTS text_i18n JSONB;

COMMENT ON COLUMN public.company_billing_settings.text_i18n IS
  'Translatable prose for the company defaults every itinerary and package falls back to, keyed language -> field -> text. Covers: itinerary_terms, itinerary_inclusions, itinerary_exclusions.';

ALTER TABLE public.company_billing_settings
  ADD COLUMN IF NOT EXISTS document_languages JSONB;

COMMENT ON COLUMN public.company_billing_settings.document_languages IS
  'The languages this tenant can export documents in, as a JSON array of BCP 47 tags, e.g. ["en","pt-BR"]. ["en"] or NULL means English only - and an English-only tenant is offered no language control anywhere.';

UPDATE public.company_billing_settings
  SET document_languages = '["en"]'::jsonb
  WHERE document_languages IS NULL;

NOTIFY pgrst, 'reload schema';
