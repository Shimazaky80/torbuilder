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
export const num = (n) => Number(n) || 0;

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

/* What a single invoice document is worth in the ledger.

   One rule, and only one: an invoice is worth what it says it is. Every
   invoice bills a specific amount, that amount is total_incl, and the receipt
   raised against it credits that same figure.

   There used to be a second rule layered on top, because a booking was billed
   as a PAIR of documents that each carried the whole trip total: the deposit
   invoice billed deposit_amount and the final billed total_incl minus the
   deposit, so that the pair summed to the trip exactly once. That made
   total_incl mean two different things depending on the document's type, and
   every caller had to know which. A trip is now invoiced one document at a
   time, each carrying its own balance, so a document's total is the amount it
   bills and nothing has to be inferred from its type. */
export const invoicePostingAmount = (invoice) => Math.max(0, round2(num(invoice.total_incl)));

/* Sale on credit, for the slice of the sale this document represents.
     Debit  Accounts Receivable   amount receivable from this document
     Credit Sales                 its share of the net sale
     Credit VAT Payable           its share of the tax
   Net and tax are taken in proportion to the amount being posted, with tax as
   the balancing figure so the entry always balances: a 1c skew in VAT is a far
   smaller evil than an entry that does not balance at all. */
export const buildInvoiceEntry = (invoice) => {
  const total = round2(num(invoice.total_incl));
  const ref = invoice.invoice_number || '';
  /* A voided invoice, or one that has been credited in full, has already been
     reversed by its credit note. Posting it would put the sale back, so this is
     a quiet no-op rather than a second recognition. */
  if (invoice.status === 'void' || round2(num(invoice.credited_amount)) >= total - 0.009) {
    return {
      source_type: 'invoice',
      reference: ref,
      narration: `Invoice ${ref} — ${invoice.bill_to_name || ''}`.trim(),
      itinerary_id: invoice.itinerary_id || null,
      client_id: invoice.client_id || null,
      currency_code: invoice.currency_code || 'ZAR',
      nothing_to_post: true,
      lines: []
    };
  }
  const gross = invoicePostingAmount(invoice);
  const ratio = total > 0 ? gross / total : 0;
  const net = round2(num(invoice.subtotal_excl) * ratio);
  const tax = round2(gross - net);
  const label = invoice.tax_label || 'Tax';
  return {
    source_type: 'invoice',
    reference: ref,
    narration: `Invoice ${ref} — ${invoice.bill_to_name || ''}`.trim(),
    itinerary_id: invoice.itinerary_id || null,
    client_id: invoice.client_id || null,
    currency_code: invoice.currency_code || 'ZAR',
    lines: [
      { code: 'AR', line_type: 'debit', amount: gross, description: `Amount receivable — ${ref}` },
      { code: 'SALES', line_type: 'credit', amount: net, description: `Net sale — ${ref}` },
      ...(tax > 0 ? [{ code: 'VAT', line_type: 'credit', amount: tax, description: `${label} — ${ref}` }] : [])
    ]
  };
};

/* Customer pays.
     Debit  Bank / Cash            amount received
     Credit Accounts Receivable   amount applied to the invoice
   Any shortfall is left on the receivable rather than written off, so the
   ledger always reflects what is still owed. */
/* Scale a set of invoice line items so they add up to exactly `target`.

   An invoice does not always bill the whole trip: it may be the balance after a
   part payment, or the movement on a repriced booking. The document still has
   to show lines that add up to the figure it is asking for, or the client is
   handed a total their own itemisation does not reach.

   Lines are scaled in proportion, and the rounding drift is pushed onto the
   largest one so the sum is exact rather than a cent or two adrift. */
export const scaleInvoiceLines = (lines, target) => {
  const src = (lines || []).filter((l) => round2(num(l.line_total)) > 0.009);
  const want = round2(num(target));
  if (!src.length || want <= 0) return lines || [];
  const basis = round2(src.reduce((a, l) => a + num(l.line_total), 0));
  /* Already at or above the target: the lines describe it, do not touch them. */
  if (basis <= 0 || want >= basis) return lines || [];

  const factor = want / basis;
  const out = src.map((l) => {
    const lineTotal = round2(num(l.line_total) * factor);
    const net = round2(num(l.subtotal_excl) * factor);
    return {
      ...l,
      unit_price: round2(num(l.unit_price) * factor),
      subtotal_excl: net,
      tax_amount: round2(lineTotal - net),
      line_total: lineTotal
    };
  });

  const drift = round2(want - out.reduce((a, l) => a + l.line_total, 0));
  if (drift !== 0) {
    let big = 0;
    for (let k = 1; k < out.length; k++) if (out[k].line_total > out[big].line_total) big = k;
    out[big] = {
      ...out[big],
      line_total: round2(out[big].line_total + drift),
      tax_amount: round2(out[big].tax_amount + drift)
    };
  }
  return out;
};

/* Money moving against an invoice, in whichever direction.
     direction 'in'          Debit  Bank / Cash            amount received
                           Credit Accounts Receivable   amount applied
     direction 'out'         Debit  Accounts Receivable   amount handed back
                           Credit Bank / Cash            amount refunded
     direction 'wallet_out'  Debit  Accounts Receivable   credit paid to client
                           Credit Bank / Cash            from their wallet
     direction 'apply'       no entry

   A refund is the mirror image of a receipt. The charge it sits against stands,
   so the receivable goes back up by exactly what left the bank: a client who is
   refunded R2 000 on an invoice owing R5 000 genuinely owes R7 000 afterwards.
   Modelling it as a reversal of the receipt keeps that true without a
   special case anywhere in the balance arithmetic.

   'apply' posts nothing on purpose. Spending credit the client already holds is
   not a new economic event: the credit note left that money sitting on
   receivables, and settling a new invoice with it moves nothing between
   accounts. Posting it would credit receivables a second time and inflate the
   ledger against a transaction that changed no cash.

   'wallet_out' uses the same accounts as 'out' but for the opposite reason. The
   credit note already credited receivables, which is what made the client's
   credit real; paying it out debits receivables to clear that credit and credits
   bank for the cash that left. Same pair of lines, opposite meaning from a
   refund -- which is why the direction has to be read rather than assumed. */
export const buildReceiptEntry = (receipt) => {
  const amount = round2(receipt.amount);
  const direction = receipt.direction || 'in';
  const ref = receipt.receipt_number || '';
  const invoice = receipt.invoice_number || 'invoice';

  /* Credit spent settling an invoice: documented, but not posted. */
  if (direction === 'apply') return null;

  const isRefund = direction === 'out';
  const isPayout = direction === 'wallet_out';
  const isOutflow = isRefund || isPayout;
  const label = isPayout ? 'Credit refunded' : isRefund ? 'Refund' : 'Receipt';

  return {
    source_type: isPayout ? 'credit_payout' : isRefund ? 'refund' : 'receipt',
    reference: ref,
    narration: `${label} ${ref} - ${receipt.bill_to_name || ''}`.trim(),
    itinerary_id: receipt.itinerary_id || null,
    client_id: receipt.client_id || null,
    currency_code: receipt.currency_code || 'ZAR',
    lines: isOutflow
      ? [
          { code: 'AR', line_type: 'debit', amount, description: isPayout ? `Credit paid to client - ${invoice}` : `Refunded to client - ${invoice}` },
          { code: 'BANK', line_type: 'credit', amount, description: isPayout ? 'Credit paid from wallet' : `Refund paid - ${receipt.payment_method || 'refund'}` }
        ]
      : [
          { code: 'BANK', line_type: 'debit', amount, description: `Payment received - ${receipt.payment_method || 'receipt'}` },
          { code: 'AR', line_type: 'credit', amount, description: `Applied to ${invoice}` }
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

/* Scale a set of amounts so the side they represent sums to exactly `target`.
   Rounding each line independently leaves a residual, and that residual has to
   land somewhere. It goes on the largest line of the side, which is the line
   least distorted by a fraction of a cent. */
const scaleSide = (side, factor, target) => {
  const amounts = side.map((l) => round2(num(l.amount) * factor));
  const sum = round2(amounts.reduce((s, a) => s + a, 0));
  const residual = round2(target - sum);
  if (residual !== 0 && amounts.length) {
    let idx = 0;
    for (let i = 1; i < amounts.length; i += 1) if (amounts[i] > amounts[idx]) idx = i;
    amounts[idx] = round2(amounts[idx] + residual);
  }
  return amounts;
};

/* Reverse PART of a posting — a credit note for less than the invoice it
   settles, which is what a price decrease on an already-settled booking is.

   Same accounts, same flipped sides as a full reversal, scaled to the amount
   actually credited. Each side is driven to the target on its own, because the
   original's debits and credits round separately: scaling them by one shared
   factor and hoping they agree leaves the entry out by a cent, and a ledger
   that does not balance cannot be relied on at all.

   A credit for the whole invoice is a plain mirror, so the common case is
   untouched. */
export const scaleLinesForPartialReversal = (origLines, targetTotal, originalTotal) => {
  const lines = (origLines || []).filter((l) => round2(l.amount) > 0);
  if (!lines.length) return [];

  const target = round2(targetTotal);
  /* The original entry's own total is the scaling basis, so a balanced entry
     stays balanced. Falls back to the largest line if it was not supplied. */
  const basis = round2(originalTotal) > 0
    ? round2(originalTotal)
    : round2(Math.max(...lines.map((l) => num(l.amount))));

  if (target >= basis) return mirrorLinesForReversal(lines);
  if (target <= 0) return [];

  const factor = target / basis;
  const debitSide = lines.filter((l) => l.line_type === 'debit');
  const creditSide = lines.filter((l) => l.line_type !== 'debit');
  const dr = scaleSide(debitSide, factor, target);
  const cr = scaleSide(creditSide, factor, target);

  /* Original debits become credits, and vice versa. */
  const flippedDebits = debitSide.map((l, i) => ({
    code: l.account_code || l.code,
    line_type: 'credit',
    amount: dr[i],
    description: l.description || ''
  }));
  const flippedCredits = creditSide.map((l, i) => ({
    code: l.account_code || l.code,
    line_type: 'debit',
    amount: cr[i],
    description: l.description || ''
  }));

  /* A line can round away to nothing at small credit amounts. The table forbids
     a zero amount, and a zero line is only ever a rounding artefact anyway. */
  return [...flippedDebits, ...flippedCredits].filter((l) => l.amount > 0);
};

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
        /* How much is actually being credited. A credit note may be for less
           than the invoice — a price decrease on a settled booking — in which
           case only that much is reversed and the rest of the invoice stands. */
        const creditTotal = round2(creditNote.total_incl ?? creditNote.total ?? 0);
        const reversing = creditTotal > 0 && creditTotal < round2(original.total_debit || 0);

        return {
          source_type: 'credit_note',
          source_id: creditNote.id || null,
          reference: creditNote.credit_note_number || '',
          narration: reversing
            ? `Partial reversal of ${original.reference || 'invoice'}`
            : `Reversal of ${original.reference || 'invoice'}`,
          itinerary_id: original.itinerary_id || null,
          client_id: original.client_id || null,
          currency_code: original.currency_code || 'ZAR',
          lines: reversing
            ? scaleLinesForPartialReversal(origLines, creditTotal, original.total_debit)
            : mirrorLinesForReversal(origLines)
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

/* Settling an invoice from client credit produces no journal entry, so a null
   draft here is expected rather than a fault. */
export const postReceipt = (companyId, receipt) => {
  const draft = buildReceiptEntry(receipt);
  if (!draft) return Promise.resolve(null);
  return postEntry(companyId, { ...draft, source_id: receipt.id });
};

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

/* Identity of a priced line. `item_id` is the stable handle; older invoices
   predate it, so fall back to day + description.

   The two shapes being compared use different field names — a settled
   invoice's accounting_export lines carry `day`/`description`, while the
   itinerary's own lines carry `day_number`/`item_name` — so both spellings are
   accepted. Without that, every current line would key to an empty string and
   the comparison would report the whole itinerary as newly added. */
export const lineKey = (l) => {
  const id = l.item_id || l.itemId;
  if (id) return String(id);
  const day = l.day ?? l.day_number ?? '';
  const desc = String(l.description || l.item_name || '').trim().toLowerCase();
  return desc ? `${day}|${desc}` : '';
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
    .filter((l) => l.key);

/* Compare what was billed against what the itinerary now says. Returns the
   changed lines with their before/after values, plus the movement both net of
   tax and gross. `unchanged` is true when nothing moved at all, which is the
   signal that a further invoice would be a duplicate.

   Documents are always gross — an invoice's total_incl and a credit note's
   total_incl include the tax — so callers billing a change must use the gross
   figures. The net figures are what belongs in the ledger. */
export const diffAgainstBilledLines = (billedLines, currentLines) => {
  const billed = new Map(fingerprintBilledLines(billedLines).map((l) => [l.key, l]));
  const current = new Map(fingerprintBilledLines(currentLines).map((l) => [l.key, l]));

  const changed = [];
  let increase = 0;
  let decrease = 0;
  let increaseGross = 0;
  let decreaseGross = 0;

  const record = (entry) => {
    changed.push(entry);
    if (entry.netDelta > 0) {
      increase = round2(increase + entry.netDelta);
      increaseGross = round2(increaseGross + entry.grossDelta);
    } else if (entry.netDelta < 0) {
      decrease = round2(decrease + entry.netDelta);
      decreaseGross = round2(decreaseGross + entry.grossDelta);
    }
  };

  for (const [key, now] of current) {
    const was = billed.get(key);
    if (!was) {
      /* Newly priced line: the whole amount is new billable work. */
      record({
        key, description: now.description, status: 'added',
        before: 0, after: now.line_total,
        netDelta: round2(now.line_total - now.tax_amount),
        grossDelta: round2(now.line_total)
      });
      continue;
    }
    if (round2(was.line_total) === round2(now.line_total) && round2(was.tax_amount) === round2(now.tax_amount)) continue;
    /* Repriced line: only the movement is billable, never the whole amount
       again — re-billing the unchanged part is the double-count this guards. */
    record({
      key, description: now.description, status: 'repriced',
      before: was.line_total, after: now.line_total,
      netDelta: round2((now.line_total - now.tax_amount) - (was.line_total - was.tax_amount)),
      grossDelta: round2(now.line_total - was.line_total)
    });
  }

  for (const [key, was] of billed) {
    if (current.has(key)) continue;
    /* Priced line that has been taken off the itinerary: a credit. */
    record({
      key, description: was.description, status: 'removed',
      before: was.line_total, after: 0,
      netDelta: -round2(was.line_total - was.tax_amount),
      grossDelta: -round2(was.line_total)
    });
  }

  return {
    changed,
    increase: round2(increase),
    decrease: round2(decrease),
    increaseGross: round2(increaseGross),
    decreaseGross: round2(decreaseGross),
    unchanged: !changed.length
  };
};

const fmtDelta = (n) => new Intl.NumberFormat('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(round2(n));

/* Decide what may be done about a booking that has already been billed.

   outstanding > 0   -> nothing settled yet, the normal deposit/final flow runs
   outstanding <= 0  -> the booking is settled. A further invoice is only
                        legitimate if the client reopened it (status back to
                        Quotation) or a priced service actually moved. Then the
                        honest options are an invoice for what went UP, a credit
                        note for what came DOWN, or both.

   Returns { blocked, reason, options } where options is a list of
   { kind: 'invoice' | 'credit_note', amount, label } the user may choose from.
   An empty options list means "raise nothing". */
export const decideReissue = ({ outstanding, diff, itineraryStatus, currencyCode = '' }) => {
  const owed = round2(outstanding || 0);
  if (owed > 0.009) return { blocked: false, settled: false, reason: '', options: [] };

  const settled = true;
  const reopened = String(itineraryStatus || '').toLowerCase() === 'quotation';
  const d = diff || { changed: [], increase: 0, decrease: 0, increaseGross: 0, decreaseGross: 0, unchanged: true };
  /* Documents are gross, so the amounts offered to the user are the gross
     movements. Older callers may pass a diff with only the net figures, in
     which case those stand in. */
  const increase = round2(d.increaseGross ?? d.increase ?? 0);
  const decrease = round2(Math.abs(d.decreaseGross ?? d.decrease ?? 0));
  const ccy = currencyCode ? ` ${currencyCode}` : '';

  /* Reopened with no repricing: the trip is unchanged, so the only way to bill
     again is to cancel what was already issued and start the document afresh. */
  if (reopened && d.unchanged) {
    return {
      blocked: true,
      settled,
      reason: `This booking was reopened but nothing has been repriced. Cancel the settled invoice with a credit note before issuing a new one${ccy}.`,
      options: [{ kind: 'credit_note', amount: 0, label: 'Credit note to cancel the settled invoice' }]
    };
  }

  if (d.unchanged) {
    return {
      blocked: true,
      settled,
      reason: `Already settled in full. Repricing a service, or moving the booking back to Quotation, is what allows a further invoice${ccy}.`,
      options: []
    };
  }

  const options = [];
  if (increase > 0.009) {
    options.push({ kind: 'invoice', amount: increase, label: `Invoice the ${fmtDelta(increase)}${ccy} increase` });
  }
  if (decrease > 0.009) {
    options.push({ kind: 'credit_note', amount: decrease, label: `Credit note for the ${fmtDelta(decrease)}${ccy} decrease` });
  }
  if (!options.length) {
    return {
      blocked: true,
      settled,
      reason: `Services moved but the net amount did not change${ccy}. Nothing to bill.`,
      options: []
    };
  }
  return {
    blocked: false,
    settled,
    reopened,
    reason: `This booking is settled. ${d.changed.length} priced service${d.changed.length === 1 ? '' : 's'} changed since it was issued.`,
    options
  };
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
