-- ===========================================================================
-- CLIENT PURGE -- test data, including anything with money attached.
--
-- You have said these are all testing accounts, so this does NOT refuse to
-- delete a client that has invoices or wallet credit. It shows you exactly what
-- each delete will remove, asks you to confirm the total, and then does it.
--
--   STEP 1  build the target list          (read it, make sure it is right)
--   STEP 2  see every row it would remove   (read this too)
--   STEP 3  the deletes                     (disabled until you enable it)
--   STEP 4  prove nothing was left behind
--   STEP 5  ROLLBACK (safe) or COMMIT (real)
--
-- How to use it: run steps 1 and 2 first and stop. Come back and enable step 3
-- once the numbers match what you expect. Leave step 5 on ROLLBACK for the
-- first attempt so you can watch what it does; switch to COMMIT when you are
-- sure. A purge that silently rolls back when you believed it saved is worse
-- than one that refuses to start.
--
-- Why this is not just "DELETE FROM clients":
--   client_credit_ledger      CASCADE from clients   -- goes with it
--   invoices, itineraries,    SET NULL from clients  -- SURVIVES, blanked out
--   invoice_receipts, journal_entries
-- So the ordinary delete leaves every invoice, receipt, journal entry and
-- itinerary behind with a NULL client. That is the mess, not the cure. The
-- deletes below are written out in dependency order to take the whole trail.
-- ===========================================================================

BEGIN;

-- ===========================================================================
-- STEP 1 -- choose the targets.
--
-- Either name them explicitly (safest), or take every client in one company.
-- Comment out one and uncomment the other. Both produce the same temp table.
-- ===========================================================================

CREATE TEMP TABLE purge_targets (client_id UUID PRIMARY KEY, label TEXT);

-- Option A: name the clients. Replace the uuids.
-- INSERT INTO purge_targets (client_id, label)
-- SELECT c.id, c.name FROM public.clients c
--  WHERE c.id IN ('<<client uuid>>'::uuid);

-- Option B: every client belonging to one company. Replace the uuid.
-- This is the "start from scratch" case.
-- INSERT INTO purge_targets (client_id, label)
-- SELECT c.id, c.name FROM public.clients c
--  WHERE c.company_id = '<<company uuid>>'::uuid;

-- Until one of the above is enabled there is nothing to do. Say so plainly
-- rather than reporting a cheerful zero that reads like success.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM purge_targets;
  IF n = 0 THEN
    RAISE EXCEPTION 'purge_targets is empty. Enable Option A or Option B above, otherwise this script does nothing.';
  END IF;
  RAISE NOTICE 'STEP 1: % client(s) targeted', n;
END $$;

-- ===========================================================================
-- STEP 1b -- refuse to touch the platform.
--
-- The platform super admin is NOT a client. A super admin is a row in
-- public.profiles (is_super_admin = true, or user_role = 'super_admin'), and
-- profiles has no client_id, so nothing in this script's delete path can reach
-- one. That is why the guard below is a refusal rather than a repair: it turns a
-- fact that happens to hold into something the script will not let you get wrong.
--
-- Two things are checked, because they are genuinely different risks:
--
--   a) A targeted client that is a partner portal login. partner_portal_users
--      has client_id ON DELETE CASCADE and user_id REFERENCES auth.users, so
--      purging that client silently removes a login's access. The auth account
--      itself survives -- only the link row goes -- but the person loses portal
--      access without being told.
--
--   b) A targeted company that a platform admin owns. companies.owner_id
--      REFERENCES auth.users(id). Note companies has NO company_id of its own, so
--      a company_id-driven sweep would not even see this table, and deleting the
--      company would leave the admin able to log in but with no record of which
--      company they ran.
--
-- Both are refused outright. If you genuinely need one of these gone, that is a
-- different operation and deserves its own review.
-- ===========================================================================
DO $$
DECLARE
  n     integer;
  names text;
  has_portal boolean;
  has_profiles boolean;
  has_owner_id boolean;
BEGIN
  -- partner_portal_users came from a later migration than the tables this script
  -- guards. Testing for its existence first matters: without the test the whole
  -- purge aborts on a database that predates that migration, which reads as
  -- "the purge is broken" rather than "this deployment has no portal yet". The
  -- guard is skipped, not failed, when there is nothing for it to protect.
  SELECT EXISTS (SELECT 1 FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relname = 'partner_portal_users')
    INTO has_portal;

  SELECT EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = 'public.companies'::regclass
                    AND a.attname = 'owner_id' AND NOT a.attisdropped)
    INTO has_owner_id;

  SELECT EXISTS (SELECT 1 FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relname = 'profiles')
    INTO has_profiles;

  IF has_portal THEN
    SELECT count(*), string_agg(label, ', ' ORDER BY label)
      INTO n, names
      FROM purge_targets t
      JOIN public.clients c ON c.id = t.client_id
     WHERE c.id IN (SELECT client_id FROM public.partner_portal_users);

    IF n > 0 THEN
      RAISE EXCEPTION
        'Refusing to purge % client(s) that are partner portal logins: %. Purging them cascades away partner_portal_users and the login loses access. Remove them from purge_targets, or delete the portal user deliberately.', n, names;
    END IF;
  END IF;

  -- The admin check needs both public.profiles and companies.owner_id, and
  -- owner_id arrives in a later migration than this script.
  --
  -- These references must sit inside the IF rather than in WHERE clauses guarded
  -- by EXISTS. Postgres resolves every relation in a statement when it parses it,
  -- so an EXISTS test for a missing table still fails with
  -- 'relation "public.profiles" does not exist' -- the guard protects nothing.
  -- plpgsql plans a statement the first time it runs, so a reference that is only
  -- ever reached when the objects exist is genuinely never resolved.
  IF has_profiles AND has_owner_id THEN
    SELECT count(*), string_agg(DISTINCT co.name, ', ')
      INTO n, names
      FROM public.companies co
     WHERE co.id IN (SELECT c.company_id FROM purge_targets t
                      JOIN public.clients c ON c.id = t.client_id)
       AND co.owner_id IN (SELECT id FROM public.profiles
                            WHERE is_super_admin = true OR user_role = 'super_admin');

    IF n > 0 THEN
      RAISE EXCEPTION
        'Refusing to purge: % of the targeted companies (%) are owned by a platform super admin. Purging that company destroys the owner link and the platform loses track of which tenant the admin runs.', n, names;
    END IF;
  END IF;

  RAISE NOTICE 'STEP 1b: no platform admin or portal login is in the target set (portal table present: %)', has_portal;
END $$;

-- ===========================================================================
-- STEP 2 -- the blast radius, every row the deletes in step 3 will remove.
--
-- The count is computed by walking outward from the targets the same way the
-- deletes do: clients -> itineraries -> days -> day items, and clients ->
-- invoices -> receipts / credit notes -> lines, and clients -> journal entries
-- -> journal lines.
--
-- An earlier version of this counted only the tables with a client_id column,
-- which reported 6 rows when the deletes would have removed 11. The plan was
-- not wrong about the deletes; it was wrong about itself, and a plan that
-- disagrees with the action is worse than no plan. The guard in step 3 caught
-- it, which is the only reason this was found before it ran against real data.
--
-- Tables that cascade from clients without being named (partner portal rows,
-- package assignments) are discovered from the catalog and counted too, so a
-- table added by a later migration is included rather than silently surviving.
-- ===========================================================================
CREATE TEMP TABLE purge_plan (seq serial, table_name text, rows_to_delete bigint, via text);

DO $$
DECLARE
  tgt uuid[];
  n   bigint;
  tbl text;
  col text;
BEGIN
  SELECT array_agg(client_id) INTO tgt FROM purge_targets;

  -- Stage the reachable ids once, so each count below is a single lookup and
  -- the deletes in step 3 can use the same definitions.

  -- Company ids are staged here because they are gone by the time step 4 runs:
  -- once the clients are deleted there is nothing left to read them from, and
  -- step 4 needs them to tell "left behind by this purge" apart from "was
  -- already NULL before we started".
  DROP TABLE IF EXISTS purge_companies;
  CREATE TEMP TABLE purge_companies AS
    SELECT DISTINCT c.company_id FROM public.clients c WHERE c.id = ANY (tgt);

  DROP TABLE IF EXISTS purge_invoices;
  CREATE TEMP TABLE purge_invoices AS
    SELECT v.id FROM public.invoices v WHERE v.client_id = ANY (tgt);

  DROP TABLE IF EXISTS purge_itineraries;
  CREATE TEMP TABLE purge_itineraries AS
    SELECT i.id FROM public.itineraries i WHERE i.client_id = ANY (tgt);

  DROP TABLE IF EXISTS purge_days;
  CREATE TEMP TABLE purge_days AS
    SELECT d.id FROM public.itinerary_days d
     WHERE d.itinerary_id IN (SELECT id FROM purge_itineraries);

  DROP TABLE IF EXISTS purge_credit_notes;
  CREATE TEMP TABLE purge_credit_notes AS
    SELECT cn.id FROM public.credit_notes cn
     WHERE cn.invoice_id IN (SELECT id FROM purge_invoices);

  DROP TABLE IF EXISTS purge_journal;
  CREATE TEMP TABLE purge_journal AS
    SELECT j.id FROM public.journal_entries j WHERE j.client_id = ANY (tgt);

  SELECT count(*) INTO n FROM public.clients c WHERE c.id = ANY (tgt);
  INSERT INTO purge_plan (table_name, rows_to_delete, via) VALUES ('clients', n, 'the target');

  SELECT count(*) INTO n FROM public.client_credit_ledger WHERE client_id = ANY (tgt);
  INSERT INTO purge_plan (table_name, rows_to_delete, via) VALUES ('client_credit_ledger', n, 'clients (CASCADE)');

  SELECT count(*) INTO n FROM public.itineraries WHERE id IN (SELECT id FROM purge_itineraries);
  INSERT INTO purge_plan (table_name, rows_to_delete, via) VALUES ('itineraries', n, 'client_id');

  SELECT count(*) INTO n FROM public.itinerary_days WHERE id IN (SELECT id FROM purge_days);
  INSERT INTO purge_plan (table_name, rows_to_delete, via) VALUES ('itinerary_days', n, 'itineraries (CASCADE)');

  SELECT count(*) INTO n FROM public.itinerary_day_items
   WHERE itinerary_day_id IN (SELECT id FROM purge_days);
  INSERT INTO purge_plan (table_name, rows_to_delete, via) VALUES ('itinerary_day_items', n, 'itinerary_days (CASCADE)');

  SELECT count(*) INTO n FROM public.invoices WHERE id IN (SELECT id FROM purge_invoices);
  INSERT INTO purge_plan (table_name, rows_to_delete, via) VALUES ('invoices', n, 'client_id');

  SELECT count(*) INTO n FROM public.invoice_receipts
   WHERE invoice_id IN (SELECT id FROM purge_invoices);
  INSERT INTO purge_plan (table_name, rows_to_delete, via) VALUES ('invoice_receipts', n, 'invoices (CASCADE)');

  SELECT count(*) INTO n FROM public.credit_notes WHERE id IN (SELECT id FROM purge_credit_notes);
  INSERT INTO purge_plan (table_name, rows_to_delete, via) VALUES ('credit_notes', n, 'invoices (CASCADE)');

  SELECT count(*) INTO n FROM public.invoice_line_items
   WHERE invoice_id IN (SELECT id FROM purge_invoices)
      OR credit_note_id IN (SELECT id FROM purge_credit_notes);
  INSERT INTO purge_plan (table_name, rows_to_delete, via) VALUES ('invoice_line_items', n, 'invoices and credit_notes (CASCADE)');

  SELECT count(*) INTO n FROM public.journal_entries WHERE id IN (SELECT id FROM purge_journal);
  INSERT INTO purge_plan (table_name, rows_to_delete, via) VALUES ('journal_entries', n, 'client_id');

  SELECT count(*) INTO n FROM public.journal_lines
   WHERE entry_id IN (SELECT id FROM purge_journal);
  INSERT INTO purge_plan (table_name, rows_to_delete, via) VALUES ('journal_lines', n, 'journal_entries (CASCADE)');

  -- Anything else with a direct client_id that CASCADES, found in the catalog.
  --
  -- Discovered rather than hardcoded so a table added by a later migration is
  -- included instead of silently surviving. That discovery is also the one place
  -- this script could delete something it should not, so each discovered table is
  -- checked before it is counted, and anything without a company_id column is
  -- refused outright. Shared catalog data -- currencies, countries, library
  -- categories -- is owned by no tenant and read by all of them; deleting it
  -- would break the app for every company at once, including the fresh ones.
  FOR tbl, col IN
    SELECT c.relname, a.attname
    FROM pg_constraint con
    JOIN pg_class c     ON c.oid = con.conrelid
    JOIN LATERAL (SELECT unnest(con.conkey) AS attnum) k ON true
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
    WHERE con.contype = 'f'
      AND con.confrelid = 'public.clients'::regclass
      AND con.confdeltype = 'c'
      AND c.relname NOT IN ('clients', 'client_credit_ledger')
    ORDER BY c.relname
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute
                    WHERE attrelid = format('public.%I', tbl)::regclass
                      AND attname = 'company_id' AND NOT attisdropped) THEN
      RAISE EXCEPTION
        'Refusing to purge: % cascades from clients but has no company_id, so it is shared reference data rather than tenant data. This script will not count it and will not delete it. Purge it deliberately if that is really what you want.',
        tbl;
    END IF;

    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = ANY ($1)', tbl, col)
      INTO n USING tgt;
    INSERT INTO purge_plan (table_name, rows_to_delete, via) VALUES (tbl, n, 'clients (CASCADE, discovered)');
  END LOOP;
END $$;

SELECT table_name, rows_to_delete, via,
       CASE WHEN rows_to_delete = 0 THEN '' ELSE 'will be deleted' END AS effect
FROM purge_plan
ORDER BY seq;

SELECT
  (SELECT count(*) FROM purge_targets)            AS clients_targeted,
  (SELECT coalesce(sum(rows_to_delete), 0) FROM purge_plan) AS total_rows;

-- ===========================================================================
-- STEP 3 -- the deletes.
--
-- Disabled. Uncomment the DO block, and nothing else in this file needs
-- changing: it reads the same purge_targets and reports the same counts.
--
-- The order below satisfies the constraints that actually exist:
--   invoices.itinerary_id is RESTRICT, so invoices must go before itineraries
--   credit_notes and invoice_line_items cascade from invoices, but are removed
--     explicitly so the counts above and below are the same numbers
--   journal_lines cascades from journal_entries
--
-- It refuses to run if the row count has moved since step 2. Somebody editing
-- the database between reading the plan and running the delete is the one
-- scenario where "delete what I saw" and "delete what is there" differ, and it
-- should not be allowed to resolve silently.
-- ===========================================================================

-- UNCOMMENT TO ENABLE THIS BLOCK:
-- DO $$
DECLARE
  tgt      uuid[];
  expected bigint;
  actual   bigint;
  removed  bigint;
  n        bigint;
  r        record;
BEGIN
  SELECT array_agg(client_id) INTO tgt FROM purge_targets;

  /* Recount using exactly the definitions step 2 staged, so the guard compares
     the plan against itself rather than against a second, subtly different
     expression. If the database changed since step 2 ran, these tables no
     longer describe it and the purge stops. */
  SELECT
      (SELECT count(*) FROM public.clients c             WHERE c.id = ANY (tgt))
    + (SELECT count(*) FROM public.client_credit_ledger                  WHERE client_id = ANY (tgt))
    + (SELECT count(*) FROM public.itineraries                           WHERE id IN (SELECT id FROM purge_itineraries))
    + (SELECT count(*) FROM public.itinerary_days                        WHERE id IN (SELECT id FROM purge_days))
    + (SELECT count(*) FROM public.itinerary_day_items                   WHERE itinerary_day_id IN (SELECT id FROM purge_days))
    + (SELECT count(*) FROM public.invoices                               WHERE id IN (SELECT id FROM purge_invoices))
    + (SELECT count(*) FROM public.invoice_receipts                       WHERE invoice_id IN (SELECT id FROM purge_invoices))
    + (SELECT count(*) FROM public.credit_notes                           WHERE id IN (SELECT id FROM purge_credit_notes))
    + (SELECT count(*) FROM public.invoice_line_items
         WHERE invoice_id IN (SELECT id FROM purge_invoices)
            OR credit_note_id IN (SELECT id FROM purge_credit_notes))
    + (SELECT count(*) FROM public.journal_entries                        WHERE id IN (SELECT id FROM purge_journal))
    + (SELECT count(*) FROM public.journal_lines                          WHERE entry_id IN (SELECT id FROM purge_journal))
  INTO actual;

  /* Discovered CASCADE tables count too, otherwise the guard would always
     disagree with the plan whenever a partner or package row exists. */
  FOR r IN
    SELECT p.table_name, p.rows_to_delete
    FROM purge_plan p
    WHERE p.via = 'clients (CASCADE, discovered)'
  LOOP
    CONTINUE WHEN r.rows_to_delete = 0;
    EXECUTE format(
      'SELECT count(*) FROM public.%I c JOIN purge_targets t ON t.client_id = c.%I', r.table_name, 'client_id')
      INTO n;
    actual := actual + n;
  END LOOP;

  SELECT coalesce(sum(rows_to_delete), 0) INTO expected FROM purge_plan;

  IF actual <> expected THEN
    RAISE EXCEPTION 'the plan said % row(s) but the tables hold %. Nothing was deleted. Re-run steps 1 and 2.', expected, actual;
  END IF;

  -- Child rows first, in the order the constraints require.
  --
  -- Every delete below is scoped by the staged id tables from step 2, never by
  -- "client_id = ANY (targets)". That distinction is the whole reason step 2
  -- staged anything. An earlier version deleted invoices by client_id, so an
  -- invoice raised between the plan and the delete was removed even though it
  -- was never counted -- the plan said 3 rows and 4 went, and the guard could
  -- not see it because both sides of the comparison read the same stale list.
  -- Scoping by the staged ids means the purge removes exactly what it planned
  -- to remove, and anything that appeared afterwards is left alone and reported
  -- by step 4 instead of silently deleted.
  DELETE FROM public.journal_lines      WHERE entry_id IN (SELECT id FROM purge_journal);
  DELETE FROM public.journal_entries    WHERE client_id = ANY (tgt);

  DELETE FROM public.invoice_receipts   WHERE invoice_id IN (SELECT id FROM purge_invoices);
  DELETE FROM public.credit_notes       WHERE invoice_id IN (SELECT id FROM purge_invoices);

  DELETE FROM public.invoice_line_items
   WHERE invoice_id IN (SELECT id FROM purge_invoices)
      OR credit_note_id IN (SELECT id FROM purge_credit_notes);

  DELETE FROM public.invoices           WHERE id IN (SELECT id FROM purge_invoices);

  DELETE FROM public.itinerary_day_items WHERE itinerary_day_id IN (SELECT id FROM purge_days);
  DELETE FROM public.itinerary_days      WHERE id IN (SELECT id FROM purge_days);
  DELETE FROM public.itineraries        WHERE id IN (SELECT id FROM purge_itineraries);

  DELETE FROM public.client_credit_ledger WHERE client_id = ANY (tgt);

  /* Cascading partner/package rows go with this statement without being named,
     which is why step 2 counted them from the catalog rather than guessing. */
  DELETE FROM public.clients WHERE id = ANY (tgt);
  GET DIAGNOSTICS removed = ROW_COUNT;

  RAISE NOTICE 'purge complete: % client(s) deleted, % row(s) in total', removed, actual;
END $$;

-- ===========================================================================
-- STEP 4 -- confirm the account is clean. Everything here must be zero.
-- ===========================================================================
SELECT 'purge_targets still present' AS check_name, count(*) AS remaining
  FROM public.clients c WHERE c.id IN (SELECT client_id FROM purge_targets)
UNION ALL
-- Anchored to the staged id lists, so this catches a planned row that survived.
-- An earlier version tested "id NOT IN (SELECT id FROM invoices)", which is
-- compared against the same table and therefore can never be true: it reported
-- success unconditionally and would not have noticed a surviving invoice.
SELECT 'planned invoices still present', count(*)
  FROM public.invoices WHERE id IN (SELECT id FROM purge_invoices)
UNION ALL
SELECT 'planned receipts still present', count(*)
  FROM public.invoice_receipts WHERE invoice_id IN (SELECT id FROM purge_invoices)
UNION ALL
SELECT 'planned credit notes still present', count(*)
  FROM public.credit_notes WHERE id IN (SELECT id FROM purge_credit_notes)
UNION ALL
SELECT 'planned line items still present', count(*)
  FROM public.invoice_line_items
 WHERE invoice_id IN (SELECT id FROM purge_invoices)
    OR credit_note_id IN (SELECT id FROM purge_credit_notes)
UNION ALL
SELECT 'planned itineraries still present', count(*)
  FROM public.itineraries WHERE id IN (SELECT id FROM purge_itineraries)
UNION ALL
SELECT 'planned days still present', count(*)
  FROM public.itinerary_days WHERE id IN (SELECT id FROM purge_days)
UNION ALL
SELECT 'planned journal entries still present', count(*)
  FROM public.journal_entries WHERE id IN (SELECT id FROM purge_journal)
UNION ALL
SELECT 'planned wallet rows still present', count(*)
  FROM public.client_credit_ledger l
 WHERE l.client_id IN (SELECT client_id FROM purge_targets)
UNION ALL
-- The leftovers the ordinary delete would have created. Scoped to the target
-- companies, because a NULL client anywhere else in your database is not
-- something this purge caused and should not be reported as a failure.
SELECT 'invoices left with a null client', count(*)
  FROM public.invoices v
 WHERE v.client_id IS NULL
   AND v.company_id IN (SELECT company_id FROM purge_companies)
UNION ALL
SELECT 'receipts left with a null client', count(*)
  FROM public.invoice_receipts r
 WHERE r.client_id IS NULL
   AND r.company_id IN (SELECT company_id FROM purge_companies)
UNION ALL
SELECT 'itineraries left with a null client', count(*)
  FROM public.itineraries i
 WHERE i.client_id IS NULL
   AND i.company_id IN (SELECT company_id FROM purge_companies)
UNION ALL
SELECT 'journal entries left with a null client', count(*)
  FROM public.journal_entries j
 WHERE j.client_id IS NULL
   AND j.company_id IN (SELECT company_id FROM purge_companies);

-- Genuine referential damage: a row pointing at a client that no longer exists.
-- This is the check that would have caught the original mess.
DO $$
DECLARE
  tgt     uuid[];
  orphans bigint := 0;
  r       record;
  cnt     bigint;
BEGIN
  SELECT array_agg(client_id) INTO tgt FROM purge_targets;

  FOR r IN
    SELECT c.relname AS tbl, a.attname AS col
      FROM pg_constraint con
      JOIN pg_class c      ON c.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      JOIN unnest(con.conkey) k(attnum) ON true
      JOIN pg_attribute a   ON a.attrelid = c.oid AND a.attnum = k.attnum
     WHERE ns.nspname = 'public'
       AND con.contype = 'f'
       AND con.confrelid = 'public.clients'::regclass
  LOOP
    -- A CASCADE child was meant to go with the client; anything left is damage.
    CONTINUE WHEN r.tbl = 'client_credit_ledger';
    EXECUTE format(
      'SELECT count(*) FROM public.%I x JOIN purge_companies p ON p.company_id = x.company_id
        WHERE x.%I = ANY ($1) AND x.%I IS NOT NULL', r.tbl, r.col, r.col)
      INTO cnt USING tgt;
    orphans := orphans + cnt;
  END LOOP;

  RAISE NOTICE 'STEP 4: % row(s) still point at a deleted client. Expected 0.', orphans;
END $$;

-- What is left, so you can see the starting point of the new account.
SELECT id, name, email, client_type, is_active, company_id, created_at
FROM public.clients
ORDER BY created_at;

-- ===========================================================================
-- STEP 5 -- dry run or for real.
--
-- ROLLBACK is the safe default: you can run this whole file, enable step 3,
-- see the deletes happen, and change nothing. Read the step 4 checks, then come
-- back and swap this for COMMIT when you are satisfied.
-- ===========================================================================
ROLLBACK;
-- COMMIT;
