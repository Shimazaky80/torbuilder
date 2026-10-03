-- ===========================================================================
-- ORPHAN AUDIT -- read this first. It deletes nothing.
--
-- You said clients were deleted in another session and you want the leftovers
-- cleaned up. Run this before any purge. It tells you what is actually stranded
-- and, more importantly, whether it is money.
--
-- Paste the whole thing and run it. Every statement is a SELECT.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The headline. One row per client with something still attached.
--
-- Detached is the state worth looking at: invoices, itineraries, receipts and
-- journal entries keep their rows but lose client_id, so the money is intact
-- and the name is not. Stranded is worse: the client's name is still on the
-- booking but it belongs to a company row that no longer exists, which should
-- not be possible while company_id is ON DELETE CASCADE.
-- ---------------------------------------------------------------------------
/* One row per client that still has something attached.

   Written as independent scalar subqueries rather than a chain of LEFT JOINs on
   the client. The join version looks tidier and is wrong: with four child
   tables joined at once, one client with 3 itineraries and 2 invoices produces
   6 rows, so count(*) multiplies and sum(total_incl) invoices the same money
   three times over. The joins are still there, just each in its own subquery,
   where a row can only be counted once. */
SELECT
  c.id AS client_id,
  c.name,
  c.company_id,
  c.email,
  c.is_active,
  (SELECT count(*) FROM public.itineraries i      WHERE i.client_id = c.id) AS itineraries,
  (SELECT count(*) FROM public.invoices v         WHERE v.client_id = c.id) AS invoices,
  (SELECT coalesce(sum(v.total_incl), 0) FROM public.invoices v
                                            WHERE v.client_id = c.id)      AS invoiced_value,
  (SELECT count(*) FROM public.invoice_receipts r WHERE r.client_id = c.id) AS receipts,
  (SELECT count(*) FROM public.client_credit_ledger w WHERE w.client_id = c.id) AS wallet_entries,
  /* What the wallet still owes this client. A credit balance is money you are
     holding for them, so it decides whether deleting is safe, not merely tidy. */
  (SELECT coalesce(sum(w.amount) FILTER (WHERE w.direction = 'credit'), 0)
     - coalesce(sum(w.amount) FILTER (WHERE w.direction = 'debit'), 0)
   FROM public.client_credit_ledger w WHERE w.client_id = c.id)              AS wallet_balance
FROM public.clients c
WHERE EXISTS (SELECT 1 FROM public.itineraries i        WHERE i.client_id = c.id)
   OR EXISTS (SELECT 1 FROM public.invoices v           WHERE v.client_id = c.id)
   OR EXISTS (SELECT 1 FROM public.invoice_receipts r    WHERE r.client_id = c.id)
   OR EXISTS (SELECT 1 FROM public.client_credit_ledger w WHERE w.client_id = c.id)
ORDER BY invoiced_value DESC;

-- ---------------------------------------------------------------------------
-- 2. Rows pointing at a client_id that no longer exists.
--
-- Should be zero. If it is not, the client row was removed by something that
-- did not go through the constraints -- a migration with the triggers dropped,
-- or rows copied in from a restore. These are the true orphans.
-- ---------------------------------------------------------------------------
SELECT 'itineraries' AS table_name, count(*) AS orphan_rows
  FROM public.itineraries i
 WHERE i.client_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = i.client_id)
UNION ALL
SELECT 'invoices', count(*)
  FROM public.invoices v
 WHERE v.client_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = v.client_id)
UNION ALL
SELECT 'invoice_receipts', count(*)
  FROM public.invoice_receipts r
 WHERE r.client_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = r.client_id)
UNION ALL
SELECT 'journal_entries', count(*)
  FROM public.journal_entries j
 WHERE j.client_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = j.client_id)
UNION ALL
SELECT 'client_credit_ledger', count(*)
  FROM public.client_credit_ledger w
 WHERE w.client_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = w.client_id);

-- ---------------------------------------------------------------------------
-- 3. Money sitting in a wallet whose client is gone or gone-and-detached.
--
-- Read this one carefully before purging anything. A credit balance is a
-- liability: someone is owed it. If the client was deleted by accident, the
-- refund is still owed even though the name is not there any more.
-- ---------------------------------------------------------------------------
SELECT
  w.company_id,
  w.client_id,
  w.currency_code,
  count(*) FILTER (WHERE w.direction = 'credit')   AS credits,
  count(*) FILTER (WHERE w.direction = 'debit')    AS debits,
  sum(w.amount) FILTER (WHERE w.direction = 'credit') - coalesce(
    sum(w.amount) FILTER (WHERE w.direction = 'debit'), 0) AS balance,
  min(w.created_at) AS first_movement,
  max(w.created_at) AS last_movement
FROM public.client_credit_ledger w
WHERE NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = w.client_id)
GROUP BY w.company_id, w.client_id, w.currency_code
HAVING sum(w.amount) FILTER (WHERE w.direction = 'credit')
     - coalesce(sum(w.amount) FILTER (WHERE w.direction = 'debit'), 0) <> 0
ORDER BY balance DESC;

-- ---------------------------------------------------------------------------
-- 4. Clients belonging to a company that is not there.
--
-- company_id is ON DELETE CASCADE, so this should be impossible. Worth
-- confirming rather than assuming, because a restore from another project is a
-- normal way for it to stop being true.
-- ---------------------------------------------------------------------------
SELECT c.id AS client_id, c.name, c.company_id, c.email, c.created_at
FROM public.clients c
WHERE NOT EXISTS (SELECT 1 FROM public.companies co WHERE co.id = c.company_id)
ORDER BY c.created_at;

-- ---------------------------------------------------------------------------
-- 5. Invoices and itineraries whose client_id is NULL.
--
-- This is the expected shape of a deleted client, per the foreign keys:
-- itineraries and invoices are ON DELETE SET NULL, so the rows survive with
-- client_id blanked. The bill_to snapshot on the invoice is why the name still
-- prints on the PDF. These are not broken, just nameless in the database.
-- ---------------------------------------------------------------------------
SELECT
  v.id AS invoice_id,
  v.invoice_number,
  v.bill_to_name        AS snapshot_name,
  v.bill_to_email       AS snapshot_email,
  v.client_id           AS current_client_id,
  v.status,
  v.total_incl,
  coalesce((SELECT sum(r.amount) FROM public.invoice_receipts r
             WHERE r.invoice_id = v.id AND r.direction <> 'wallet_out'), 0) AS received,
  v.total_incl - coalesce((SELECT sum(r.amount) FROM public.invoice_receipts r
             WHERE r.invoice_id = v.id AND r.direction <> 'wallet_out'), 0) AS outstanding
FROM public.invoices v
WHERE v.client_id IS NULL
ORDER BY v.total_incl DESC;

-- ---------------------------------------------------------------------------
-- 6. The two clients you created from the frontend, for reference.
-- ---------------------------------------------------------------------------
SELECT id, name, email, client_type, is_active, company_id, created_at
FROM public.clients
ORDER BY created_at DESC
LIMIT 10;
