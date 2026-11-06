-- =============================================================================
-- Migration: Seed the standard VAT row, inactive, for every new company
--
-- A tenant registered after the original tax work shipped gets no tax row at
-- all: 20260914_tax_rates.sql back-filled VAT once, over the companies that
-- existed the day it ran, and `register_new_company` never inserted one. The
-- costing engine reads "no active rate" as 0%, which is the right answer for a
-- company that has not configured tax, but it is the wrong way to discover it:
-- the Settings -> Taxes list is empty, the help text promises a 15% default the
-- tenant does not have, and the first quote goes out untaxed by accident rather
-- than by decision.
--
-- So a new company now starts with the standard South African VAT row already
-- in the list — but switched OFF. The rate is on screen and editable the moment
-- the tenant opens Settings, and switching it on is a deliberate click. Nothing
-- is charged to anybody's money by a trigger.
--
-- This is the same reason tax rates stayed tenant-owned while countries,
-- currencies, categories and places went shared: not every tenant on the
-- platform is VAT registered, so a default is an offer, never an assumption.
--
-- Existing companies are deliberately untouched. They already carry their own
-- VAT row, switched on with the tenant's rate, and a quote saved against it
-- keeps the label and rate it was priced with. Re-running this migration cannot
-- change that: the trigger fires only on INSERT into companies, and the seed is
-- guarded by NOT EXISTS rather than a unique index, because tax_rates has never
-- had one.
-- =============================================================================

-- ─── STEP 1: the seed function ───────────────────────────────────────────────
-- SECURITY DEFINER because a brand-new admin has no profile row yet while
-- registration is running: `get_user_company_id()` cannot answer their own
-- company, so the tenant-only INSERT policy would refuse the row this trigger
-- exists to create. The function runs as its owner, which bypasses RLS.
CREATE OR REPLACE FUNCTION public.seed_company_default_tax_rate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.tax_rates (
    company_id, name, code, rate, country, applies_to, is_default, is_active
  )
  VALUES (
    NEW.id,
    'Value Added Tax (VAT)',
    'VAT',
    15,
    'South Africa',
    'all',
    false,
    false
  )
  WHERE NOT EXISTS (
    SELECT 1 FROM public.tax_rates WHERE company_id = NEW.id
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_company_default_tax_rate() FROM PUBLIC;
-- The trigger fires inside whoever's transaction created the company: the
-- registration RPC (definer, owned by the dashboard role), a super admin
-- creating a tenant from the console, or a migration backfilling one.
GRANT EXECUTE ON FUNCTION public.seed_company_default_tax_rate() TO authenticated, anon, service_role;

COMMENT ON FUNCTION public.seed_company_default_tax_rate() IS
  'Adds the standard inactive 15% VAT row to a newly created company. Offer, not assumption: is_active = false, so the tenant prices at 0% until they deliberately switch tax on in Settings.';

-- ─── STEP 2: fire it on every company creation path ──────────────────────────
-- An AFTER INSERT row trigger, so the company row exists and its id is final
-- before the tax row is written. Every creation path goes through the same
-- table, so `register_new_company`, a super-admin insert and any future path
-- are covered by this one statement.
DROP TRIGGER IF EXISTS company_seed_default_tax_rate ON public.companies;
CREATE TRIGGER company_seed_default_tax_rate
  AFTER INSERT ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_company_default_tax_rate();
