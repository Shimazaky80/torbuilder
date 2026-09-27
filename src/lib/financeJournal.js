import { supabase } from './supabase';

/* ── Finance journal ─────────────────────────────────────────────────────────
   Double-entry postings behind the Finance module.

   Every posting is built from pure functions (buildInvoiceEntry,
   buildReceiptEntry, ...) so the arithmetic can be tested without a database.
   The Supabase calls only persist an already-balanced entry.

   Two invariants the whole module exists to protect:
     1. An entry balances: total debits === total credits. buildEntry throws
        rather than posting an unbalanced one, because an unbalanced ledger is
        worse than a missing posting — it silently misstates the accounts.
     2. A source document posts at most once. The database enforces this with a
        partial unique index on (company_id, source_type, source_id); postEntry
        additionally skips an existing posting so re-running is a no-op.        */

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (n) => Number(n) || 0;

/* Chart of accounts, seeded per company on first use. Codes are stable and are
   what the accounting exports emit, so they must not be renumbered casually. */
export const CHART_OF_ACCOUNTS = [
  { code: 'AR',      name: 'Accounts Receivable', account_type: 'receivable', normal_balance: 'debit',  sort_order: 100 },
  { code: 'AP',      name: 'Accounts Payable',    account_type: 'payable',    normal_balance: 'credit', sort_order: 200 },
  { code: 'SALES',   name: 'Sales',               account_type: 'revenue',    normal_balance: 'credit', sort_order: 300 },
  { code: 'COS',     name: 'Cost of Sales',       account_type: 'expense',    normal_balance: 'debit',  sort_order: 400 },
  { code: 'VAT',     name: 'VAT Payable',         account_type: 'liability',  normal_balance: 'credit', sort_order: 500 },
  { code: 'VATIN',   name: 'VAT Input',           account_type: 'asset',      normal_balance: 'debit',  sort_order: 600 },
  { code: 'BANK',    name: 'Bank / Cash',         account_type: 'cash',       normal_balance: 'debit',  sort_order: 700 },
  { code: 'DISCOUNT',name: 'Discounts Allowed',   account_type: 'contra_revenue', normal_balance: 'debit', sort_order: 800 }
];

export const ACCOUNT_CODES = CHART_OF_ACCOUNTS.map((a) => a.code);

/* Create any missing system accounts for the company. Safe to call on every
   page load: it only inserts what is absent. */
export const ensureChartOfAccounts = async (companyId) => {
  if (!companyId) return [];
  const { data, error } = await supabase
    .from('finance_accounts')
    .select('id, code, name, account_type, normal_balance, sort_order')
    .eq('company_id', companyId)
    .order('sort_order', { ascending: true });
  if (error) throw error;

  const have = new Set((data || []).map((a) => a.code));
  const missing = CHART_OF_ACCOUNTS.filter((a) => !have.has(a.code));
  if (missing.length) {
    const { data: inserted, error: insErr } = await supabase
      .from('finance_accounts')
      .insert(missing.map((a) => ({ ...a, company_id: companyId, is_system: true })))
      .select('id, code, name, account_type, normal_balance, sort_order');
    if (insErr) throw insErr;
    return [...(data || []), ...(inserted || [])].sort((a, b) => a.sort_order - b.sort_order);
  }
  return data || [];
};

/* ── Entry builders (pure) ──────────────────────────────────────────────────
   Each returns { reference, source_type, source_id, narration, itinerary_id,
   client_id, currency_code, lines: [{ code, line_type, amount, description }] }
   Zero-amount lines are dropped: a rounding artefact must not become a line,
   and journal_lines.amount is constrained to > 0.                             */

/* What a single invoice document is actually worth in the ledger.

   An itinerary is billed as a PAIR: a deposit invoice to secure the booking,
   then a final invoice for what is left. Both documents carry the same
   total_incl — the final one records the deposit in credited_amount rather
   than re-stating a lower total — so posting each document for its full
   total_incl would recognise the same sale twice.

   So the trip is split:
     deposit invoice  ->  the deposit
     final invoice    ->  total_incl - credited_amount
   which sums to total_incl exactly once, and gives the deposit receipt a real
   AR debit to credit against at the moment the money actually arrives. */
export const invoicePostingAmount = (invoice) => {
  const total = round2(num(invoice.total_incl));
  if (invoice.invoice_type === 'deposit') {
    /* A deposit invoice with no deposit percentage is not a deposit at all;
       fall back to the full total rather than posting nothing. */
    const dep = round2(num(invoice.deposit_amount));
    return dep > 0 ? Math.min(dep, total) : total;
  }
  const credited = round2(num(invoice.credited_amount));
  return Math.max(0, round2(total - credited));
};

/* Sale on credit, for the slice of the sale this document represents.
     Debit  Accounts Receivable   amount receivable from this document
     Credit Sales                 its share of the net sale
     Credit VAT Payable           its share of the tax
   Net and tax are taken in proportion to the amount being posted, with tax as
   the balancing figure so the entry always balances: a 1c skew in VAT is a far
   smaller evil than an entry that does not balance at all. */
export const buildInvoiceEntry = (invoice) => {
  const total = round2(num(invoice.total_incl));
  const gross = invoicePostingAmount(invoice);
  const ratio = total > 0 ? gross / total : 0;
  const net = round2(num(invoice.subtotal_excl) * ratio);
  const tax = round2(gross - net);
  const label = invoice.tax_label || 'Tax';
  const ref = invoice.invoice_number || '';
  const isDeposit = invoice.invoice_type === 'deposit';
  const credit = isDeposit ? 'Deposit invoice' : 'Sales invoice';
  const share = isDeposit ? 'deposit' : 'balance';
  return {
    source_type: 'invoice',
    reference: ref,
    narration: `${credit} ${ref} — ${invoice.bill_to_name || ''}`.trim(),
    itinerary_id: invoice.itinerary_id || null,
    client_id: invoice.client_id || null,
    currency_code: invoice.currency_code || 'ZAR',
    lines: [
      { code: 'AR', line_type: 'debit', amount: gross, description: `Amount receivable (${share}) — ${ref}` },
      { code: 'SALES', line_type: 'credit', amount: net, description: `Net sale (${share}) — ${ref}` },
      ...(tax > 0 ? [{ code: 'VAT', line_type: 'credit', amount: tax, description: `${label} (${share}) — ${ref}` }] : [])
    ]
  };
};

/* Customer pays.
     Debit  Bank / Cash            amount received
     Credit Accounts Receivable   amount applied to the invoice
   Any shortfall is left on the receivable rather than written off, so the
   ledger always reflects what is still owed. */
export const buildReceiptEntry = (receipt) => {
  const amount = round2(receipt.amount);
  return {
    source_type: 'receipt',
    reference: receipt.receipt_number || '',
    narration: `Receipt ${receipt.receipt_number || ''} — ${receipt.bill_to_name || ''}`.trim(),
    itinerary_id: receipt.itinerary_id || null,
    client_id: receipt.client_id || null,
    currency_code: receipt.currency_code || 'ZAR',
    lines: [
      { code: 'BANK', line_type: 'debit', amount, description: `Payment received — ${receipt.payment_method || 'receipt'}` },
      { code: 'AR', line_type: 'credit', amount, description: `Applied to ${receipt.invoice_number || 'invoice'}` }
    ]
  };
};

/* Accrued cost of a confirmed itinerary, from the contracted supplier rates.
     Debit  Cost of Sales         contracted (buy) total
     Credit Accounts Payable      what the agency owes suppliers
   Recognising the expense and the liability together keeps the purchase side
   of the ledger complete; the cash happens later, when suppliers are paid. */
export const buildCostOfSalesEntry = ({ itineraryId, reference, narration, currencyCode, cost }) => {
  const amount = round2(cost);
  return {
    source_type: 'cost_of_sales',
    reference: reference || '',
    narration: narration || 'Cost of sales',
    itinerary_id: itineraryId || null,
    client_id: null,
    currency_code: currencyCode || 'ZAR',
    lines: [
      { code: 'COS', line_type: 'debit', amount, description: 'Contracted supplier cost' },
      { code: 'AP', line_type: 'credit', amount, description: 'Owed to suppliers' }
    ]
  };
};

/* Normalise and prove an entry balances. Throws on an unbalanced entry so a
   broken posting can never reach the ledger.

   An entry whose lines all fall away to zero is NOT an error: a final invoice
   that has been credited in full has nothing left to recognise. That is a
   legitimate no-op, flagged with `nothing_to_post` so the caller can skip it
   quietly. Supplying no lines at all IS an error, because that means a bug. */
export const buildEntry = (draft) => {
  const supplied = draft.lines || [];
  const base = {
    source_type: draft.source_type,
    source_id: draft.source_id || null,
    reference: draft.reference || '',
    narration: draft.narration || '',
    itinerary_id: draft.itinerary_id || null,
    client_id: draft.client_id || null,
    currency_code: draft.currency_code || 'ZAR'
  };
  if (draft.nothing_to_post) return { ...base, total_debit: 0, total_credit: 0, nothing_to_post: true, lines: [] };

  const lines = supplied
    .map((l) => ({ ...l, amount: round2(l.amount) }))
    .filter((l) => l.amount > 0);

  const totalDebit = round2(lines.filter((l) => l.line_type === 'debit').reduce((a, l) => a + l.amount, 0));
  const totalCredit = round2(lines.filter((l) => l.line_type === 'credit').reduce((a, l) => a + l.amount, 0));

  if (!supplied.length) throw new Error('Journal entry has no lines');
  if (totalDebit !== totalCredit) {
    throw new Error(`Journal entry does not balance: debits ${totalDebit} vs credits ${totalCredit}`);
  }
  return { ...base, total_debit: totalDebit, total_credit: totalCredit, nothing_to_post: !lines.length, lines };
};

/* Persist an entry. Skips when the source document is already posted, so this
   is safe to call on every invoice view, receipt or sync. */
export const postEntry = async (companyId, draft) => {
  if (!companyId) throw new Error('postEntry requires a company');
  const entry = buildEntry(draft);

  /* Nothing left to recognise (a fully credited final invoice). Skipping is
     correct: the entry would be a 0/0 header with no lines, and the unique
     source index would then block a later genuine posting of that document. */
  if (entry.nothing_to_post) {
    return { entryId: null, created: false, skipped: true };
  }

  if (entry.source_id) {
    /* currency_code is part of the idempotency key: one itinerary can hold
       services in several currencies, and each is a separate accrual. Keying on
       the document alone would make the second currency a silent no-op. */
    const { data: existing } = await supabase
      .from('journal_entries')
      .select('id')
      .eq('company_id', companyId)
      .eq('source_type', entry.source_type)
      .eq('source_id', entry.source_id)
      .eq('currency_code', entry.currency_code)
      .maybeSingle();
    if (existing) return { entryId: existing.id, created: false };
  }

  const accounts = await ensureChartOfAccounts(companyId);
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const missing = [...new Set(entry.lines.map((l) => l.code))].filter((c) => !byCode.has(c));
  if (missing.length) throw new Error(`Unknown ledger account(s): ${missing.join(', ')}`);

  const { data: created, error: headErr } = await supabase
    .from('journal_entries')
    .insert([{
      company_id: companyId,
      entry_date: entry.entry_date || new Date().toISOString().slice(0, 10),
      reference: entry.reference,
      source_type: entry.source_type,
      source_id: entry.source_id,
      narration: entry.narration,
      itinerary_id: entry.itinerary_id,
      client_id: entry.client_id,
      currency_code: entry.currency_code,
      total_debit: entry.total_debit,
      total_credit: entry.total_credit,
      is_posted: true
    }])
    .select('id')
    .single();
  if (headErr) throw headErr;

  const lineRows = entry.lines.map((l, i) => {
    const acct = byCode.get(l.code);
    return {
      company_id: companyId,
      entry_id: created.id,
      account_id: acct.id,
      account_code: acct.code,
      account_name: acct.name,
      account_type: acct.account_type,
      line_type: l.line_type,
      amount: l.amount,
      description: l.description || '',
      itinerary_id: entry.itinerary_id,
      sort_order: i
    };
  });
  const { error: lineErr } = await supabase.from('journal_lines').insert(lineRows);
  if (lineErr) {
    // Never leave a header with no lines: that is an unbalanced entry.
    await supabase.from('journal_entries').delete().eq('id', created.id);
    throw lineErr;
  }
  return { entryId: created.id, created: true };
};

/* Flip the sides of a posted entry: a debit becomes a credit and vice versa.
   Amounts and order are untouched, which is what makes the reversal cancel the
   original exactly rather than approximately. */
export const mirrorLinesForReversal = (origLines) =>
  (origLines || [])
    .filter((l) => round2(l.amount) > 0)
    .map((l) => ({
      code: l.account_code || l.code,
      line_type: l.line_type === 'debit' ? 'credit' : 'debit',
      amount: round2(l.amount),
      description: l.description || ''
    }));

/* Reverse a posting by mirroring the lines that were ACTUALLY posted.

   Recomputing the reversal from the document's own fields is wrong the moment
   the posting rules change under an old entry: voiding an invoice posted under
   the old "every invoice is worth its full total_incl" rule would reverse the
   new, smaller amount and leave the difference stranded in the ledger forever.
   A reversal has to cancel precisely what was booked, so the original entry is
   the only trustworthy source. Falls back to the document fields only when the
   invoice was never posted to the journal at all (it predates the ledger). */
export const buildReversalFromOriginal = async (companyId, creditNote) => {
  const originalId = creditNote.invoice_id || null;
  if (originalId) {
    const { data: original } = await supabase
      .from('journal_entries')
      .select('id, reference, currency_code, itinerary_id, client_id, total_debit')
      .eq('company_id', companyId)
      .eq('source_type', 'invoice')
      .eq('source_id', originalId)
      .maybeSingle();

    if (original) {
      const { data: origLines } = await supabase
        .from('journal_lines')
        .select('account_code, account_name, line_type, amount, description')
        .eq('entry_id', original.id)
        .order('sort_order', { ascending: true });

      if (origLines && origLines.length) {
        return {
          source_type: 'credit_note',
          source_id: creditNote.id || null,
          reference: creditNote.credit_note_number || '',
          narration: `Reversal of ${original.reference || 'invoice'}`,
          itinerary_id: original.itinerary_id || null,
          client_id: original.client_id || null,
          currency_code: original.currency_code || 'ZAR',
          lines: mirrorLinesForReversal(origLines)
        };
      }
    }
  }

  /* The original was never booked (it predates the ledger, or its own posting
     was a no-op). Post nothing: a reversal of nothing is a phantom entry, and
     the unique source index would then block a real posting of that credit
     note later. */
  return {
    source_type: 'credit_note',
    source_id: creditNote.id || null,
    reference: creditNote.credit_note_number || '',
    narration: `Reversal of ${creditNote.invoice_number || 'invoice'} (original was never posted)`,
    itinerary_id: creditNote.itinerary_id || null,
    client_id: creditNote.client_id || null,
    currency_code: creditNote.currency_code || 'ZAR',
    nothing_to_post: true,
    lines: []
  };
};

/* Convenience wrappers for the document types Finance posts. */
export const postInvoice = (companyId, invoice) =>
  postEntry(companyId, { ...buildInvoiceEntry(invoice), source_id: invoice.id });

export const postReceipt = (companyId, receipt) =>
  postEntry(companyId, { ...buildReceiptEntry(receipt), source_id: receipt.id });

export const postCreditNote = (companyId, creditNote) =>
  buildReversalFromOriginal(companyId, creditNote).then((draft) => postEntry(companyId, draft));

export const postCostOfSales = (companyId, args) =>
  postEntry(companyId, { ...buildCostOfSalesEntry(args), source_id: args.itineraryId });

/* ── What changed since a booking was settled ────────────────────────────────
   Once a booking is settled, raising another invoice is only legitimate if
   something actually changed: the client moved it back to Quotation, or a
   service was added, removed or repriced. Without that comparison the app
   happily raises a second invoice for a trip that has already been billed in
   full, which is duplicate billing rather than accounting.

   A settled invoice carries `accounting_export.lines` — a snapshot of what was
   priced at the moment it was issued. Diffing that snapshot against the
   itinerary's current pricing yields the changes, and the increases and
   decreases separately, because an increase is billed and a decrease is
   credited. They are not netted here: a client who adds a day and drops
   another needs an invoice for the addition and a credit note for the
   removal, not a single number that hides both. */

const lineKey = (l) => {
  /* item_id is the stable identity of a priced line. Older invoices predate it,
     so fall back to day + description, which is stable for as long as the
     description is. */
  const id = l.item_id || l.itemId;
  if (id) return String(id);
  return `${l.day ?? l.day_number ?? ''}|${String(l.description || l.item_name || '').trim().toLowerCase()}`;
};

export const fingerprintBilledLines = (lines) =>
  (lines || [])
    .map((l) => ({
      key: lineKey(l),
      description: l.description || l.item_name || '',
      quantity: Number(l.quantity) || 0,
      tax_rate: Number(l.tax_rate) || 0,
      tax_amount: round2(l.tax_amount || 0),
      line_total: round2(l.line_total || 0)
    }))
    .filter((l) => l.key && l.key !== '|');

/* Compare what was billed against what the itinerary now says. Returns the
   changed lines with their before/after values, plus the gross increase and
   gross decrease. `unchanged` is true when nothing moved at all, which is the
   signal that a further invoice would be a duplicate. */
export const diffAgainstBilledLines = (billedLines, currentLines) => {
  const billed = new Map(fingerprintBilledLines(billedLines).map((l) => [l.key, l]));
  const current = new Map(fingerprintBilledLines(currentLines).map((l) => [l.key, l]));

  const changed = [];
  let increase = 0;
  let decrease = 0;

  for (const [key, now] of current) {
    const was = billed.get(key);
    if (!was) {
      /* Newly priced line: the whole amount is new billable work. */
      const delta = round2(now.line_total - now.tax_amount);
      changed.push({ key, description: now.description, status: 'added', before: 0, after: now.line_total, delta });
      if (delta > 0) increase = round2(increase + delta);
      else if (delta < 0) decrease = round2(decrease + delta);
      continue;
    }
    if (round2(was.line_total) === round2(now.line_total) && round2(was.tax_amount) === round2(now.tax_amount)) continue;
    /* Repriced line: only the movement is billable, never the whole amount
       again — re-billing the unchanged part is the double-count this guards. */
    const wasNet = round2(was.line_total - was.tax_amount);
    const nowNet = round2(now.line_total - now.tax_amount);
    const delta = round2(nowNet - wasNet);
    changed.push({ key, description: now.description, status: 'repriced', before: was.line_total, after: now.line_total, delta });
    if (delta > 0) increase = round2(increase + delta);
    else if (delta < 0) decrease = round2(decrease + delta);
  }

  for (const [key, was] of billed) {
    if (current.has(key)) continue;
    /* Priced line that has been taken off the itinerary: a credit. */
    const wasNet = round2(was.line_total - was.tax_amount);
    changed.push({ key, description: was.description, status: 'removed', before: was.line_total, after: 0, delta: -wasNet });
    decrease = round2(decrease - wasNet);
  }

  return { changed, increase: round2(increase), decrease: round2(decrease), unchanged: !changed.length };
};

/* ── Cost of sales ──────────────────────────────────────────────────────────
   Profitability per currency, from the pricing groups the builder already
   computes. Reads `totalExcl` (net of tax), NOT `totalSell`: totalSell is
   tax-inclusive, and counting VAT collected as agency margin would overstate
   profit on every single invoice.

   Optional services are excluded because they are not part of what the client
   was actually charged. */
export const computeCostOfSales = (pricingGroups) => (pricingGroups || []).map((g) => {
  const netSale = round2(g.totalExcl);
  const cost = round2(g.totalBuy);
  const grossSale = round2(g.totalInclTax);
  const profit = round2(netSale - cost);
  const tax = round2(grossSale - netSale);
  return {
    code: g.code,
    symbol: g.symbol,
    name: g.name,
    netSale,
    cost,
    profit,
    tax,
    grossSale,
    /* Undefined when there is no sale to take a percentage of; reporting 0%
       there would read as "break even" rather than "nothing to measure". */
    margin: netSale > 0 ? round2((profit / netSale) * 100) : null,
    profitable: profit >= 0
  };
});

/* VAT extracted from a tax-inclusive amount. Mirrors vatOfInclusive in
   ItineraryBuilder so tenant-wide totals can never drift from the per-itinerary
   figures shown in the builder. */
const vatOfInclusive = (amount, rate) => {
  const r = Number(rate) || 0;
  if (!r) return 0;
  return round2((Number(amount) || 0) * r / (100 + r));
};

/* Tenant-wide cost of sales, aggregated from the raw day items the same way the
   builder aggregates its pricing groups: per itinerary AND per currency, since
   a multi-currency itinerary cannot be summed into a single figure.

   Optional services (is_included = false) are excluded — the client was not
   charged for them, so they are not sale, and booking them is not a cost of
   this sale. */
export const costOfSalesFromDayItems = (items) => {
  const byKey = new Map();
  for (const it of items || []) {
    if (it.is_included === false) continue;
    const itin = it.itinerary_id || 'unknown';
    const ccy = (it.currency_code || 'ZAR').toUpperCase();
    const key = `${itin}|${ccy}`;
    if (!byKey.has(key)) {
      byKey.set(key, { itinerary_id: itin, code: ccy, symbol: ccy, cost: 0, grossSale: 0, tax: 0, serviceCount: 0 });
    }
    const row = byKey.get(key);
    const sell = num(it.total_sell);
    row.cost = round2(row.cost + num(it.total_buy));
    row.grossSale = round2(row.grossSale + sell);
    row.tax = round2(row.tax + vatOfInclusive(sell, it.tax_rate));
    row.serviceCount += 1;
  }
  return [...byKey.values()].map((r) => {
    const netSale = round2(r.grossSale - r.tax);
    const profit = round2(netSale - r.cost);
    return {
      ...r,
      netSale,
      profit,
      margin: netSale > 0 ? round2((profit / netSale) * 100) : null,
      profitable: profit >= 0
    };
  });
};

/* ── General ledger ─────────────────────────────────────────────────────────
   Running balance per account, in date order, derived from the posted lines.
   Derived rather than stored so the ledger can never drift from the journal. */
export const buildGeneralLedger = (entries, lines) => {
  const byEntry = new Map(entries.map((e) => [e.id, e]));
  const rows = [];
  const running = new Map();

  const dated = lines
    .map((l) => {
      const e = byEntry.get(l.entry_id);
      /* currency_code lives on the entry, not the line, so it has to be carried
         across — without it every currency collapses into one running balance.
         account_type is denormalised onto the line, which is what lets the
         ledger present each balance from the account's own natural side. */
      return e
        ? { ...l, entry_date: e.entry_date, currency_code: e.currency_code, reference: e.reference, narration: e.narration, source_type: e.source_type, itinerary_id: e.itinerary_id }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date)) || a.sort_order - b.sort_order);

  for (const l of dated) {
    const key = `${l.currency_code}|${l.account_code}`;
    const debit = l.line_type === 'debit' ? l.amount : 0;
    const credit = l.line_type === 'credit' ? l.amount : 0;
    const prev = running.get(key) || 0;
    /* Presented from the account's own natural side: a revenue account reads
       positive when it has a credit balance, an asset positive on debit. */
    const natural = l.account_type === 'revenue' || l.account_type === 'liability' || l.account_type === 'equity' ? 'credit' : 'debit';
    const delta = natural === 'debit' ? debit - credit : credit - debit;
    const balance = round2(prev + delta);
    running.set(key, balance);
    rows.push({
      entry_id: l.entry_id,
      entry_date: l.entry_date,
      reference: l.reference,
      narration: l.narration,
      source_type: l.source_type,
      itinerary_id: l.itinerary_id,
      currency_code: l.currency_code,
      account_code: l.account_code,
      account_name: l.account_name,
      account_type: l.account_type,
      debit,
      credit,
      balance
    });
  }
  return rows;
};
