-- Allow cash receipts to exceed an invoice while keeping that excess visible as
-- a receivable credit until the user refunds or credits it.

CREATE OR REPLACE FUNCTION public.guard_itinerary_invoice_receipt_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_itinerary_id UUID;
  v_currency TEXT;
BEGIN
  IF COALESCE(NEW.direction, 'in') <> 'in' THEN
    RETURN NEW;
  END IF;

  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RAISE EXCEPTION 'A payment receipt must be greater than zero'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT i.* INTO v_invoice
  FROM public.invoices i
  WHERE i.id = NEW.invoice_id
    AND i.company_id = NEW.company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The receipt invoice does not belong to this company'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_invoice.status = 'void' THEN
    RAISE EXCEPTION 'A voided invoice cannot receive a payment'
      USING ERRCODE = 'check_violation';
  END IF;

  v_currency := UPPER(COALESCE(v_invoice.currency_code, ''));
  IF UPPER(COALESCE(NEW.currency_code, '')) <> v_currency THEN
    RAISE EXCEPTION 'Receipt currency must match the invoice currency'
      USING ERRCODE = 'check_violation';
  END IF;

  v_itinerary_id := v_invoice.itinerary_id;
  IF v_itinerary_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('invoice-receipt:' || v_invoice.id::TEXT, 0));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(v_itinerary_id::TEXT, 0));
  END IF;

  -- The receipt records the cash actually received. Settlement calculations
  -- cap the invoice balance at zero and expose any excess for later resolution.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoice_receipts_balance_guard ON public.invoice_receipts;
CREATE TRIGGER invoice_receipts_balance_guard
  BEFORE INSERT ON public.invoice_receipts
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_itinerary_invoice_receipt_balance();

CREATE OR REPLACE FUNCTION public.booking_net_billed(
  p_company_id   UUID,
  p_itinerary_id UUID,
  p_currency     TEXT
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT ROUND(
    COALESCE((
      SELECT SUM(i.total_incl)
      FROM public.invoices i
      WHERE i.company_id = p_company_id
        AND i.itinerary_id = p_itinerary_id
        AND UPPER(i.currency_code) = UPPER(p_currency)
        AND i.status <> 'void'
    ), 0)
    -
    COALESCE((
      SELECT SUM(c.total_incl)
      FROM public.credit_notes c
      JOIN public.invoices i ON i.id = c.invoice_id
      WHERE c.company_id = p_company_id
        AND i.itinerary_id = p_itinerary_id
        AND UPPER(c.currency_code) = UPPER(p_currency)
        AND UPPER(i.currency_code) = UPPER(p_currency)
        AND c.status <> 'void'
        AND i.status <> 'void'
        AND COALESCE(c.accounting_export->>'purpose', '') <> 'overpayment'
    ), 0)
  , 2);
$$;

GRANT EXECUTE ON FUNCTION public.booking_net_billed(UUID, UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.tag_overpayment_credit_note()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.reason ILIKE 'Overpayment correction:%' THEN
    NEW.accounting_export := COALESCE(NEW.accounting_export, '{}'::JSONB)
      || jsonb_build_object('purpose', 'overpayment');
    NEW.subtotal_excl := NEW.total_incl;
    NEW.tax_total := 0;
    NEW.tax_label := 'Overpayment adjustment';
    NEW.tax_rate := 0;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS credit_notes_tag_overpayment ON public.credit_notes;
CREATE TRIGGER credit_notes_tag_overpayment
  BEFORE INSERT OR UPDATE OF reason ON public.credit_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.tag_overpayment_credit_note();

-- Existing overpayment adjustment notes must not reduce future invoice
-- allowance or be counted as a second payment on the client statement.
UPDATE public.credit_notes
SET accounting_export = COALESCE(accounting_export, '{}'::JSONB)
      || jsonb_build_object('purpose', 'overpayment'),
    subtotal_excl = total_incl,
    tax_total = 0,
    tax_label = 'Overpayment adjustment',
    tax_rate = 0
WHERE reason ILIKE 'Overpayment correction:%'
  AND COALESCE(accounting_export->>'purpose', '') <> 'overpayment';

UPDATE public.invoice_line_items li
SET item_name = 'Overpayment correction',
    category = 'Financial adjustment',
    item_id = NULL,
    subtotal_excl = li.line_total,
    tax_amount = 0,
    tax_label = 'Overpayment adjustment',
    tax_rate = 0
FROM public.credit_notes c
WHERE li.credit_note_id = c.id
  AND c.accounting_export->>'purpose' = 'overpayment';

CREATE OR REPLACE FUNCTION public.tag_overpayment_credit_note_line()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.credit_note_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.credit_notes c
       WHERE c.id = NEW.credit_note_id
         AND c.accounting_export->>'purpose' = 'overpayment'
     ) THEN
    NEW.item_name := 'Overpayment correction';
    NEW.category := 'Financial adjustment';
    NEW.item_id := NULL;
    NEW.subtotal_excl := NEW.line_total;
    NEW.tax_amount := 0;
    NEW.tax_label := 'Overpayment adjustment';
    NEW.tax_rate := 0;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoice_line_items_tag_overpayment_credit_note ON public.invoice_line_items;
CREATE TRIGGER invoice_line_items_tag_overpayment_credit_note
  BEFORE INSERT OR UPDATE ON public.invoice_line_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tag_overpayment_credit_note_line();

NOTIFY pgrst, 'reload schema';
