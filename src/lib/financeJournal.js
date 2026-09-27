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

/* Sale on credit.
     Debit  Accounts Receivable   total incl. tax
     Credit Sales                 net of tax
     Credit VAT Payable           tax
   With no tax this collapses to exactly the Sales / AR pair. */
export const buildInvoiceEntry = (invoice) => {
  const gross = round2(invoice.total_incl);
  const net = round2(invoice.subtotal_excl);
  const tax = round2(num(invoice.tax_total) || round2(gross - net));
  const label = invoice.tax_label || 'Tax';
  const credit = invoice.invoice_type === 'deposit' ? 'Deposit invoice' : 'Sales invoice';
  return {
    source_type: 'invoice',
    reference: invoice.invoice_number || '',
    narration: `${credit} ${invoice.invoice_number || ''} — ${invoice.bill_to_name || ''}`.trim(),
    itinerary_id: invoice.itinerary_id || null,
    client_id: invoice.client_id || null,
    currency_code: invoice.currency_code || 'ZAR',
    lines: [
      { code: 'AR', line_type: 'debit', amount: gross, description: `Amount receivable — ${invoice.invoice_number || ''}` },
      { code: 'SALES', line_type: 'credit', amount: net, description: `Net sale — ${invoice.invoice_number || ''}` },
      ...(tax > 0 ? [{ code: 'VAT', line_type: 'credit', amount: tax, description: `${label} — ${invoice.invoice_number || ''}` }] : [])
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

/* Reverse of an invoice.
     Debit  Sales                 net
     Debit  VAT Payable           tax
     Credit Accounts Receivable  gross */
export const buildCreditNoteEntry = (creditNote) => {
  const gross = round2(creditNote.total_incl);
  const net = round2(creditNote.subtotal_excl);
  const tax = round2(num(creditNote.tax_total) || round2(gross - net));
  return {
    source_type: 'credit_note',
    reference: creditNote.credit_note_number || creditNote.invoice_number || '',
    narration: `Credit note ${creditNote.credit_note_number || ''} — reversal`.trim(),
    itinerary_id: creditNote.itinerary_id || null,
    client_id: creditNote.client_id || null,
    currency_code: creditNote.currency_code || 'ZAR',
    lines: [
      { code: 'SALES', line_type: 'debit', amount: net, description: 'Reversal of net sale' },
      ...(tax > 0 ? [{ code: 'VAT', line_type: 'debit', amount: tax, description: 'Reversal of VAT' }] : []),
      { code: 'AR', line_type: 'credit', amount: gross, description: 'Receivable reversed' }
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
   broken posting can never reach the ledger. */
export const buildEntry = (draft) => {
  const lines = (draft.lines || [])
    .map((l) => ({ ...l, amount: round2(l.amount) }))
    .filter((l) => l.amount > 0);

  const totalDebit = round2(lines.filter((l) => l.line_type === 'debit').reduce((a, l) => a + l.amount, 0));
  const totalCredit = round2(lines.filter((l) => l.line_type === 'credit').reduce((a, l) => a + l.amount, 0));

  if (!lines.length) throw new Error('Journal entry has no lines');
  if (totalDebit !== totalCredit) {
    throw new Error(`Journal entry does not balance: debits ${totalDebit} vs credits ${totalCredit}`);
  }
  return {
    source_type: draft.source_type,
    source_id: draft.source_id || null,
    reference: draft.reference || '',
    narration: draft.narration || '',
    itinerary_id: draft.itinerary_id || null,
    client_id: draft.client_id || null,
    currency_code: draft.currency_code || 'ZAR',
    total_debit: totalDebit,
    total_credit: totalCredit,
    lines
  };
};

/* Persist an entry. Skips when the source document is already posted, so this
   is safe to call on every invoice view, receipt or sync. */
export const postEntry = async (companyId, draft) => {
  if (!companyId) throw new Error('postEntry requires a company');
  const entry = buildEntry(draft);

  if (entry.source_id) {
    const { data: existing } = await supabase
      .from('journal_entries')
      .select('id')
      .eq('company_id', companyId)
      .eq('source_type', entry.source_type)
      .eq('source_id', entry.source_id)
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

/* Convenience wrappers for the document types Finance posts. */
export const postInvoice = (companyId, invoice) =>
  postEntry(companyId, { ...buildInvoiceEntry(invoice), source_id: invoice.id });

export const postReceipt = (companyId, receipt) =>
  postEntry(companyId, { ...buildReceiptEntry(receipt), source_id: receipt.id });

export const postCreditNote = (companyId, creditNote) =>
  postEntry(companyId, { ...buildCreditNoteEntry(creditNote), source_id: creditNote.id });

export const postCostOfSales = (companyId, args) =>
  postEntry(companyId, { ...buildCostOfSalesEntry(args), source_id: args.itineraryId });

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
      return e ? { ...l, entry_date: e.entry_date, reference: e.reference, narration: e.narration, source_type: e.source_type, itinerary_id: e.itinerary_id } : null;
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
