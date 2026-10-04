/* What is owed, derived from the documents rather than remembered on the invoice.

   The old pair could get away with a stored `balance_due` because every receipt
   settled its invoice outright and nothing else moved the number. That no longer
   holds: an invoice can be paid in instalments, and a credit note reduces what
   is owed without any money moving at all. Credit notes now create client wallet
   credit instead, so only cash receipts and credit applied from that wallet
   settle this invoice. The stored column is only ever a cache of this balance.

   Pure functions, no database. Every caller passes the documents it has. */

import { round2, num } from './financeJournal';

/* A credit note only counts while it stands: a voided one is not a credit. */
const liveCredit = (cn) => (cn.status || 'issued') !== 'void';

export const sameCurrency = (a, b) =>
  (a || '').toString().toUpperCase() === (b || '').toString().toUpperCase();

/* A receipt row is one of four things: money in, money handed back out, a
   settlement drawn from the client's credit wallet, or credit paid back out of
   that wallet.

   The fourth is not an adjustment to the invoice it is filed against. Say a
   10,000 invoice is paid in full and then 3,000 is credited because a tour was
   withdrawn; the client then asks for that 3,000 back in cash. The invoice is
   still completely settled -- it was billed once and paid once. Counting the
   payout as a refund would report 3,000 outstanding that the client does not
   owe. It is real money that left, so it is kept out of every figure below
   rather than netted against a balance it never touched.

   Rows written before the column existed have no value on it, so anything not
   explicitly recognised is treated as money in. */
export const receiptDirection = (receipt) => {
  const d = (receipt && receipt.direction) || 'in';
  return d === 'out' || d === 'apply' || d === 'wallet_out' ? d : 'in';
};

export const isRefund = (receipt) => receiptDirection(receipt) === 'out';
export const isCreditApplied = (receipt) => receiptDirection(receipt) === 'apply';
/* Credit paid to the client out of their wallet. Real cash, but not against
   this invoice's balance. */
export const isWalletPayout = (receipt) => receiptDirection(receipt) === 'wallet_out';

export const receiptsFor = (invoiceId, receipts = []) =>
  receipts.filter((r) => r.invoice_id === invoiceId);

export const creditNotesFor = (invoiceId, creditNotes = []) =>
  creditNotes.filter((c) => c.invoice_id === invoiceId && liveCredit(c));

/* The three movements against an invoice, kept apart because they mean different
   things and only two of them are cash. */
export const receivedTotal = (invoiceId, receipts = []) =>
  round2(receiptsFor(invoiceId, receipts)
    .filter((r) => receiptDirection(r) === 'in')
    .reduce((a, r) => a + num(r.amount), 0));

export const refundedTotal = (invoiceId, receipts = []) =>
  round2(receiptsFor(invoiceId, receipts).filter(isRefund)
    .reduce((a, r) => a + num(r.amount), 0));

/* Credit spent on this invoice. It settles the invoice in the same way cash
   does, so it counts towards the balance, but it is not money that arrived --
   it was already the client's, held on their wallet. */
export const creditAppliedTotal = (invoiceId, receipts = []) =>
  round2(receiptsFor(invoiceId, receipts).filter(isCreditApplied)
    .reduce((a, r) => a + num(r.amount), 0));

/* Money actually held for the invoice: cash received less cash refunded. What
   the overpayment figure is measured against. Credit drawn from the wallet is
   deliberately excluded, because it was never this invoice's cash. */
export const netReceivedTotal = (invoiceId, receipts = []) =>
  round2(receivedTotal(invoiceId, receipts) - refundedTotal(invoiceId, receipts));

/* Cash given back against this invoice: money received, less what has already
   been refunded. This is the ceiling for a cash refund of the invoice's own
   payments -- a refund returns the client's cash, so it can never exceed the
   cash that arrived.

   Credit paid out of the wallet is excluded on both sides. It was never this
   invoice's cash, and refund_client_credit caps that against the wallet balance
   instead. */
export const refundableTotal = (invoiceId, receipts = []) =>
  round2(Math.max(0, netReceivedTotal(invoiceId, receipts)));

/* Everything that has settled the invoice: cash, and credit spent from the
   wallet. This is what the outstanding balance is measured against. */
export const settledTotal = (invoiceId, receipts = []) =>
  round2(netReceivedTotal(invoiceId, receipts) + creditAppliedTotal(invoiceId, receipts));

/* Money given back against an invoice by credit note.

   Reported for information, but NOT subtracted from the balance. A credit note
   credits the client's wallet; it does not settle the invoice it points at. If
   it did both, the same money could close the old invoice and then be spent
   again on a new booking. See clientCreditBalance for where the credit lives. */
export const creditedTotal = (invoiceId, creditNotes = []) =>
  round2(creditNotesFor(invoiceId, creditNotes).reduce((a, c) => a + num(c.total_incl), 0));

/* ── Client credit wallet ────────────────────────────────────────────────────
   The credit a client holds, from their ledger. Kept per client and per
   currency, because credit in one currency cannot pay a booking priced in
   another. Derived from the ledger rather than stored, so it cannot drift. */
export const clientCreditBalance = (clientId, currency, ledger = []) => {
  const rows = ledger.filter((l) => l.client_id === clientId && sameCurrency(l.currency_code, currency));
  const net = rows.reduce((a, l) => a + (l.direction === 'credit' ? num(l.amount) : -num(l.amount)), 0);
  /* Never negative: a client is never owed a negative credit. */
  return round2(Math.max(0, net));
};

/* What a new invoice for this client could take off itself with the credit it
   holds -- the balance, or what is owed, whichever is smaller. This is what the
   prompt offers. */
export const creditApplicableTo = (outstanding, creditBalance) =>
  round2(Math.max(0, Math.min(num(outstanding), Math.max(0, num(creditBalance)))));

/* What an invoice still owes, from the documents rather than the cached column.

   A void invoice owes nothing by definition; its credit note stands on its own.
   Overpayment is reported as a positive credit rather than a negative balance,
   so a client who has paid too much never shows as being in arrears. A refund
   raises the balance by exactly what went back out, which falls out of netting
   the receipts rather than being special-cased here. */
export const invoiceBalance = (invoice, receipts = []) => {
  const total = round2(num(invoice.total_incl));
  if ((invoice.status || '') === 'void') return 0;
  /* Credit notes are deliberately not subtracted here. They credit the client's
     wallet, not this invoice, so counting them here would settle the invoice
     with money that is still available to spend on another booking. */
  const settled = settledTotal(invoice.id, receipts);
  return round2(Math.max(0, total - settled));
};

/* Whether the money is in. Derived, never read off the status, so a part-paid
   invoice stays open instead of being declared settled by a stale flag. */
export const isInvoiceSettled = (invoice, receipts = []) =>
  (invoice.status || '') === 'void'
  || invoiceBalance(invoice, receipts) <= 0.009;

/* Paid more in cash than the invoice asked for. That difference is now client
   credit: it sits on their wallet to be spent on a future booking, or refunded.
   It is deliberately measured from cash alone, because credit already drawn from
   the wallet was theirs to begin with. */
export const invoiceOverpayment = (invoice, receipts = []) => {
  if ((invoice.status || '') === 'void') return 0;
  return round2(Math.max(0, netReceivedTotal(invoice.id, receipts) - round2(num(invoice.total_incl))));
};

/* Cash that may be returned without reopening the invoice. Wallet credit also
   settles the invoice, but a refund still cannot exceed the cash held. */
export const refundableOverpayment = (invoice, receipts = []) => {
  if ((invoice.status || '') === 'void') return 0;
  return round2(Math.min(
    refundableTotal(invoice.id, receipts),
    Math.max(0, settledTotal(invoice.id, receipts) - round2(num(invoice.total_incl)))
  ));
};

/* The balance after returning cash. Returning only the overpayment leaves the
   inclusive invoice total settled; a larger refund correctly reopens the
   remaining amount owed. */
export const invoiceBalanceAfterRefund = (invoice, amount, receipts = []) => {
  if (!invoice || (invoice.status || '') === 'void') return 0;
  return round2(Math.max(
    0,
    round2(num(invoice.total_incl))
      - settledTotal(invoice.id, receipts)
      + round2(num(amount))
  ));
};

/* The status an invoice should carry, given what has actually been paid.
   Kept separate from the write so the rule is testable on its own.

   A proforma is a request for money rather than an invoice for the supply, so it
   only becomes a real paid invoice once the money actually turns up. A void one
   stays void whatever was attached to it. */
export const settledStatus = (invoice, receipts = []) => {
  const status = invoice.status || '';
  if (status === 'void') return 'void';
  if (isInvoiceSettled(invoice, receipts)) return 'paid';
  return status === 'proforma' ? 'proforma' : 'validated';
};

/* ── Booking level ─────────────────────────────────────────────────────────
   What a whole itinerary in one currency has been billed, and what is left to
   bill. This is what stops a booking being invoiced twice over. */

/* Every invoice on the booking that actually stands. A void one was billed and
   then undone, so it contributes nothing. */
export const liveInvoices = (invoices = [], currency) =>
  invoices.filter((i) => (i.status || '') !== 'void' && (!currency || sameCurrency(i.currency_code, currency)));

/* What the booking has billed: every live invoice, less every credit note.
   Deliberately blind to receipts — what a booking has been *charged* is a
   question about documents, and money received against them is settled
   separately by `receivedTotal`.

   Credit notes are subtracted here, and this is not in tension with credit
   living on the client's wallet. The two answer different questions: a credit
   note says "this much of what we charged is no longer chargeable", which is
   what stops the booking being re-billed for a service that was withdrawn; the
   wallet says "this much money belongs to the client". Both are true at once,
   and both have to hold, or the same money would either be re-billed or spent
   twice. */
export const netBilled = (invoices = [], creditNotes = [], currency) => {
  const live = liveInvoices(invoices, currency);
  const gross = round2(live.reduce((a, i) => a + num(i.total_incl), 0));
  const given = round2(creditNotes
    .filter((c) => liveCredit(c) && (!currency || sameCurrency(c.currency_code, currency))
      && c.accounting_export?.purpose !== 'overpayment'
      && live.some((i) => i.id === c.invoice_id))
    .reduce((a, c) => a + num(c.total_incl), 0));
  return round2(gross - given);
};

/* How much of the booked amount is still unsettled across all invoices in one
   currency. Cash refunds reopen the balance; wallet payouts do not. */
export const bookingReceivableRemaining = (invoices = [], receipts = [], creditNotes = [], currency) => {
  const live = liveInvoices(invoices, currency);
  const settled = round2(live.reduce((total, invoice) =>
    total + settledTotal(invoice.id, receipts), 0));
  return round2(Math.max(0, netBilled(live, creditNotes, currency) - settled));
};

/* Cash payments above the invoiced share of the itinerary. Existing credit
   notes already give the client a wallet balance, so they resolve the same
   amount without issuing a second note or refund. */
export const bookingOverpayment = (tripTotal, invoices = [], receipts = [], creditNotes = [], currency) => {
  const live = liveInvoices(invoices, currency);
  const grossBilled = round2(live.reduce((total, invoice) => total + num(invoice.total_incl), 0));
  const settled = round2(live.reduce((total, invoice) =>
    total + netReceivedTotal(invoice.id, receipts), 0));
  const resolvedByCredit = round2(creditNotes
    .filter((note) => live.some((invoice) => invoice.id === note.invoice_id) && liveCredit(note))
    .reduce((total, note) => total + num(note.total_incl), 0));
  const billedCeiling = Math.min(Math.max(0, num(tripTotal)), grossBilled);
  return round2(Math.max(0, settled - billedCeiling - resolvedByCredit));
};

/* The most that may still be invoiced on this booking, in this currency.
   Never negative: once the trip has been billed in full the answer is zero, and
   if credits have taken it past full, any over-billing is a credit note's job
   rather than a negative invoice's. */
export const billableRemaining = (tripTotal, invoices = [], creditNotes = [], currency) =>
  round2(Math.max(0, num(tripTotal) - netBilled(invoices, creditNotes, currency)));

/* A percentage request is measured against the currency's whole trip value,
   but cannot exceed the amount still available to bill. */
export const billableAtPercentage = (tripTotal, percentage, invoices = [], creditNotes = [], currency) =>
  round2(Math.min(
    Math.max(0, num(tripTotal) * num(percentage) / 100),
    billableRemaining(tripTotal, invoices, creditNotes, currency)
  ));

/* Whether a proposed invoice is safe to raise. `proposed` is what the document
   would bill. This is the over-billing guard: an invoice may only ever bill the
   part of the trip that has not been billed yet. */
export const canBill = (proposed, tripTotal, invoices = [], creditNotes = [], currency) => {
  const amount = round2(num(proposed));
  if (amount <= 0.009) return { ok: false, reason: 'nothing', limit: 0 };
  const limit = billableRemaining(tripTotal, invoices, creditNotes, currency);
  if (amount > limit + 0.009) {
    return { ok: false, reason: 'over', limit };
  }
  return { ok: true, limit };
};

/* The guard also runs inside the database, where it cannot be raced. When it
   refuses, Postgres puts the reason and the figures in the exception DETAIL as
   json. Pull that back out so the caller can explain it in the same words it
   would have used had it caught the problem itself. Anything else — a dropped
   connection, a permissions error — is left alone and reported as itself. */
export const parseGuardRejection = (err) => {
  /* PostgREST surfaces a raised DETAIL as `details`; the singular spelling is
     what Postgres and the supabase-js error type disagree about, so both are
     accepted. A refusal must never be mistaken for an outage, because the two
     need completely different responses from the caller. */
  const detail = err?.details ?? err?.detail;
  if (!detail) return null;
  try {
    const parsed = typeof detail === 'string' ? JSON.parse(detail) : detail;
    if (!parsed || typeof parsed !== 'object' || !parsed.reason) return null;
    return {
      reason: String(parsed.reason),
      limit: round2(num(parsed.limit)),
      billed: round2(num(parsed.billed)),
      proposed: round2(num(parsed.proposed))
    };
  } catch {
    return null;
  }
};

/* One wording for the guard's refusals, so the browser-side check and the
   database-side check read identically to whoever is invoicing. */
export const guardMessage = (rejection, symbol = 'R') => {
  if (!rejection) return 'This booking cannot be billed that much';
  if (rejection.reason === 'nothing') return 'This itinerary is already invoiced in full';
  return `That would bill ${symbol}${rejection.proposed.toFixed(2)}, but only ${symbol}${rejection.limit.toFixed(2)} is still unbilled. Raise a credit note instead if the price has come down.`;
};
