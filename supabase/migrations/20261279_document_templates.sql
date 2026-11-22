-- =============================================================================
-- Migration: Document Templates
--
-- A company can keep a branded source document per document type and mark one
-- of them as the default. The file itself lives in the existing public
-- "contracts" bucket under <company_id>/document-templates/... - the tenant
-- storage policy already allows a signed-in user to manage only their own
-- first path segment, so no new bucket policy is needed here.
--
-- This migration stores and governs the templates. The document layout engine
-- that reads the default is a later release; uploaded files are not silently
-- applied to generated documents by this schema change.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.document_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'itinerary'
    CHECK (document_type IN ('itinerary', 'voucher', 'invoice', 'travel_document')),
  file_url      TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  file_size     BIGINT NOT NULL DEFAULT 0 CHECK (file_size >= 0),
  mime_type     TEXT,
  is_default    BOOLEAN NOT NULL DEFAULT false,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.document_templates DROP CONSTRAINT IF EXISTS document_templates_name_not_blank_check;
ALTER TABLE public.document_templates ADD CONSTRAINT document_templates_name_not_blank_check CHECK (btrim(name) <> '');

-- One default per document type, per company. The partial index is the final
-- guard; the trigger below makes the ordinary "set as default" action replace
-- the previous default without asking the caller to issue two writes.
CREATE UNIQUE INDEX IF NOT EXISTS document_templates_one_default_per_type
  ON public.document_templates (company_id, document_type)
  WHERE is_default;

CREATE INDEX IF NOT EXISTS document_templates_company_type_idx
  ON public.document_templates (company_id, document_type, is_active);

-- A default must be active, and deactivating a template removes its default
-- flag. Naming the triggers with numeric prefixes keeps this normalisation
-- ahead of the single-default replacement and the updated_at touch.
CREATE OR REPLACE FUNCTION public.document_templates_normalize_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_default THEN
    NEW.is_active := true;
  END IF;
  IF NOT NEW.is_active THEN
    NEW.is_default := false;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.document_templates_single_default()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_default THEN
    UPDATE public.document_templates
       SET is_default = false,
           updated_at = now()
     WHERE company_id = NEW.company_id
       AND document_type = NEW.document_type
       AND id <> NEW.id
       AND is_default;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS document_templates_01_state ON public.document_templates;
CREATE TRIGGER document_templates_01_state
  BEFORE INSERT OR UPDATE ON public.document_templates
  FOR EACH ROW EXECUTE FUNCTION public.document_templates_normalize_state();

DROP TRIGGER IF EXISTS document_templates_02_single_default ON public.document_templates;
CREATE TRIGGER document_templates_02_single_default
  BEFORE INSERT OR UPDATE OF is_default, company_id, document_type ON public.document_templates
  FOR EACH ROW EXECUTE FUNCTION public.document_templates_single_default();

DROP TRIGGER IF EXISTS document_templates_set_updated_at ON public.document_templates;
CREATE TRIGGER document_templates_set_updated_at
  BEFORE UPDATE ON public.document_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- The same tenant boundary every company-scoped table uses, including the
-- platform clause: a platform admin with no company of its own still has to
-- pick the tenant it is managing.
ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Document templates are readable in the company" ON public.document_templates;
CREATE POLICY "Document templates are readable in the company"
  ON public.document_templates FOR SELECT
  USING (company_id = public.get_user_company_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "Document templates are insertable in the company" ON public.document_templates;
CREATE POLICY "Document templates are insertable in the company"
  ON public.document_templates FOR INSERT
  WITH CHECK (company_id = public.get_user_company_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "Document templates are updatable in the company" ON public.document_templates;
CREATE POLICY "Document templates are updatable in the company"
  ON public.document_templates FOR UPDATE
  USING (company_id = public.get_user_company_id() OR public.is_super_admin());

DROP POLICY IF EXISTS "Document templates are deletable in the company" ON public.document_templates;
CREATE POLICY "Document templates are deletable in the company"
  ON public.document_templates FOR DELETE
  USING (company_id = public.get_user_company_id() OR public.is_super_admin());

COMMENT ON TABLE public.document_templates IS
  'Tenant-owned template documents. The default per type is selected for a future document layout engine.';

NOTIFY pgrst, 'reload schema';
