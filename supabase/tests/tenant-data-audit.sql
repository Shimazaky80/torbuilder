-- ===========================================================================
-- TENANT DATA AUDIT -- read only, changes nothing.
--
-- Which tables are intact, and which still hold tenant data, answered from the
-- live database rather than the repo. The two can disagree: a table can be
-- missing entirely, exist and be empty, or exist and hold rows for a company
-- nobody has looked at.
--
--   TENANT   carries company_id. Rows belong to one company. Purge candidates.
--   SHARED   no company_id. Currencies, countries, library categories: read by
--            every tenant, owned by none. NEVER purge.
--
-- ---------------------------------------------------------------------------
-- RUN THESE THREE SEPARATELY, AND READ EACH RESULT BEFORE MOVING ON.
--
-- The SQL editor shows only the LAST result set of a multi-statement paste, and
-- it does not display RAISE NOTICE at all. An earlier version of this file used
-- notices for the row counts, so that section printed nothing and the audit came
-- back looking like "there is no tenant data" when it had really only said
-- nothing. Each query below is now self-contained and returns real rows.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- QUERY 1 -- every public table, exact row count, tenant or shared.
--
-- This answers two questions at once: which tables still exist, and which hold
-- rows.
--
-- The count is exact, not the planner's estimate. pg_class.reltuples reports the
-- last ANALYZE, so a table emptied earlier can keep reporting its old row count
-- until something analyzes it -- an estimate that can be wrong in the dangerous
-- direction, where it claims rows that no longer exist.
-- ===========================================================================
SELECT
  c.relname AS table_name,
  CASE WHEN EXISTS (SELECT 1 FROM pg_attribute a
                     WHERE a.attrelid = c.oid AND a.attname = 'company_id'
                       AND NOT a.attisdropped)
       THEN 'tenant' ELSE 'shared' END AS kind,
  (xpath('//row/n/text()',
         query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname)::text,
                      false, true, '')))[1]::text::bigint AS exact_rows,
  c.reltuples::bigint AS planner_estimate
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
ORDER BY exact_rows DESC, kind DESC, c.relname;

-- ===========================================================================
-- QUERY 2 -- the companies, who owns them, and what each one holds.
--
-- companies is the tenant table itself and has no company_id, so it cannot appear
-- in query 1. This is the list a purge target is chosen from.
--
-- owner_id is the link to the platform: whoever appears here controls that
-- tenant, and client-purge.sql refuses to purge a company whose owner is a
-- platform super admin.
--
-- Only columns that are certain to exist are selected. No migration creates
-- public.companies at all -- it comes from schema.sql -- so status, is_active and
-- created_at may or may not be present depending on how this database was built.
-- Selecting them made this query fail outright with "column co.status does not
-- exist" on a database that is otherwise fine, which costs the whole audit to
-- learn one optional column is missing.
-- ===========================================================================
SELECT
  co.id AS company_id,
  co.name,
  co.owner_id,
  p.user_role,
  p.is_super_admin,
  (SELECT count(*)::int FROM public.clients     c WHERE c.company_id = co.id) AS clients,
  (SELECT count(*)::int FROM public.itineraries i WHERE i.company_id = co.id) AS itineraries,
  (SELECT count(*)::int FROM public.invoices    v WHERE v.company_id = co.id) AS invoices
FROM public.companies co
LEFT JOIN public.profiles p ON p.id = co.owner_id
ORDER BY co.name;

-- ===========================================================================
-- QUERY 3 -- every client, with what hangs off it.
--
-- This is the row-level view needed to pick client-purge.sql Option A, and it is
-- what decides whether a purge is needed at all. If clients is 0 everywhere then
-- the purge has nothing to do and the correct action is to leave it alone.
--
-- credit_balance comes from the wallet. Anything other than zero is real money
-- owed and should be settled or written off deliberately, not cascaded away.
--
-- The sign comes from direction, not from amount. client_credit_ledger stores
-- amount always positive and carries credit/debit in a separate column, so
-- sum(amount) would add debits to credits and report a number that looks like a
-- balance but is not one -- a client who was credited 100 and spent it 100 would
-- show 200. The CASE is the whole calculation.
-- ===========================================================================
SELECT
  c.company_id,
  c.id AS client_id,
  c.name,
  c.email,
  (SELECT count(*)::int FROM public.itineraries i WHERE i.client_id = c.id) AS itineraries,
  (SELECT count(*)::int FROM public.invoices    v WHERE v.client_id = c.id) AS invoices,
  (SELECT coalesce(sum(CASE WHEN l.direction = 'credit'
                            THEN l.amount ELSE -l.amount END), 0)::numeric(12,2)
     FROM public.client_credit_ledger l WHERE l.client_id = c.id)              AS credit_balance
FROM public.clients c
ORDER BY c.company_id, c.name;

-- ===========================================================================
-- QUERY 4 (optional) -- the platform admins, so you can see what must not break.
-- ===========================================================================
SELECT
  p.id,
  p.company_id,
  p.user_role,
  p.is_super_admin,
  (SELECT count(*)::int FROM public.companies co WHERE co.owner_id = p.id) AS companies_owned
FROM public.profiles p
WHERE p.is_super_admin = true OR p.user_role = 'super_admin';

-- ===========================================================================
-- Nothing here is modified. Read the output, then run client-purge.sql.
-- ===========================================================================
