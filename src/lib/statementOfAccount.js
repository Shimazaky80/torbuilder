/* A statement of account for one itinerary: everything the client has been
   charged, everything they have paid, and what is left, in date order with a
   running balance so the figure can be checked line by line.

   Built as a pure function over the documents, so it can be tested without a
   database and always tells the same story as the balances on the invoice tab.
   The closing balance it reports is the same `invoiceBalance` sum the rest of the
   app uses, so the statement cannot disagree with the screen.

   A booking may be priced in more than one currency. Currencies are never added
   together, so the statement is built per currency and each gets its own
   closing balance. */

import { round2, num } from './financeJournal';
import { invoiceBalance, creditNotesFor, sameCurrency } from './settlement';
import { fmtMoney, htmlEscape, docStyles, logoOf, alignStyle, companyContactHtml } from './invoiceDoc';

const dateOf = (d) => (d || '').slice(0, 10) || '—';
const isVoid = (doc) => (doc?.status || '') === 'void';

/* Money owed by the client is a debit; money received or given back is a
   credit. Both move the balance in opposite directions, which is what makes a
   running balance readable. */
const DEBIT = 'debit';
const CREDIT = 'credit';

/* Build one currency's statement. Every amount is positive here; the direction
   is carried separately, so the rows read as a normal account statement. */
export const statementLinesFor = (currency, invoices = [], receipts = [], creditNotes = []) => {
  const rows = [];
  const ids = new Set(invoices.map((i) => i.id));
  const creditsOf = (id) => creditNotesFor(id, creditNotes)
    .filter((c) => sameCurrency(c.currency_code, currency));

  for (const inv of invoices.filter((i) => sameCurrency(i.currency_code, currency))) {
    /* A voided invoice and the credit note that reverses it are a matched pair
       that nets to zero. They are shown, because the client may hold the paper
       and the statement should match it, but they are excluded from the totals:
       money the client was never actually charged for is not a charge, and a
       reversal is not money paid back. */
    if (isVoid(inv)) {
      rows.push({
        date: dateOf(inv.issued_date),
        kind: 'void',
        reference: inv.invoice_number,
        description: `Invoice voided${inv.void_reason ? ` — ${inv.void_reason}` : ''}`,
        debit: round2(num(inv.total_incl)),
        credit: 0,
        voided: true
      });
      for (const c of creditsOf(inv.id)) {
        rows.push({
          date: dateOf(c.issued_date),
          kind: 'credit_note',
          reference: c.credit_note_number,
          description: `Reversal of voided invoice ${inv.invoice_number}`,
          debit: 0,
          credit: round2(num(c.total_incl)),
          voided: true
        });
      }
      continue;
    }

    rows.push({
      date: dateOf(inv.issued_date),
      kind: inv.status === 'proforma' ? 'proforma' : 'invoice',
      reference: inv.invoice_number,
      description: inv.status === 'proforma' ? 'Proforma request for payment' : 'Invoice raised',
      debit: round2(num(inv.total_incl)),
      credit: 0
    });

    for (const c of creditsOf(inv.id)) {
      const overpaymentAdjustment = c.accounting_export?.purpose === 'overpayment';
      rows.push({
        date: dateOf(c.issued_date),
        kind: 'credit_note',
        reference: c.credit_note_number,
        description: overpaymentAdjustment
          ? `Overpayment credit note${c.reason ? ` — ${c.reason}` : ''}`
          : `Credit note against ${inv.invoice_number}${c.reason ? ` — ${c.reason}` : ''}`,
        debit: 0,
        credit: overpaymentAdjustment ? 0 : round2(num(c.total_incl))
      });
    }
  }

  /* Receipts and refunds are both cash movements against an invoice, and they
     run in opposite directions on the statement. A refund is money coming back
     out, so it debits the balance again: the client owes it once more. Showing
     it as a credit would overstate what has been paid.

     Credit paid out of the wallet is the same shape of event -- money leaving,
     on this client's account -- so it is shown as a debit for the same reason and
     described as what it is. It is filed against the invoice that produced the
     credit, but it is not a clawback of that invoice's payment, which is why it
     is worded differently and why invoiceBalance ignores it.

     'apply' is the one direction with no row at all. Spending credit the client
     already holds moved no money and no receivable, only which document settled
     which, so there is nothing to show. */
  for (const r of receipts.filter((r) => sameCurrency(r.currency_code, currency))) {
    if (!ids.has(r.invoice_id)) continue;
    const dir = r.direction || 'in';
    if (dir === 'apply') continue;
    const isPayout = dir === 'wallet_out';
    const isRefund = dir === 'out' || isPayout;
    rows.push({
      date: dateOf(r.received_date),
      kind: isRefund ? 'refund' : 'receipt',
      reference: r.receipt_number,
      description: isPayout
        ? `Credit paid back from the client's credit balance${r.notes ? ` - ${r.notes}` : ''}`
        : isRefund
          ? `Refund paid back${r.notes ? ` - ${r.notes}` : ''}`
          : `Payment received${r.payment_method ? ` by ${r.payment_method}` : ''}${r.payment_reference ? ` (${r.payment_reference})` : ''}`,
      debit: isRefund ? round2(num(r.amount)) : 0,
      credit: isRefund ? 0 : round2(num(r.amount)),
      invoiceId: r.invoice_id
    });
  }

  /* Date order, oldest first, so the running balance reads as a history. Rows
     sharing a date keep their natural order: the charge before its payments. */
  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  /* Only real money moves the balance. A void and its reversal are shown for
     the client's paper but carry no balance, so an unmatched void can never
     invent an amount the client does not owe. */
  let balance = 0;
  for (const row of rows) {
    if (row.voided) { row.balance = null; continue; }
    balance = round2(balance + row.debit - row.credit);
    row.balance = balance;
  }
  return rows;
};

/* The whole statement for one itinerary, one currency.

   Totals are computed from the rows rather than the documents, so the printed
   arithmetic is guaranteed to be the arithmetic on the page. Voided documents
   and their reversals are shown but excluded from every total, so `charges`
   and `payments` always describe real money. */
export const statementFor = (itinerary, currency, invoices = [], receipts = [], creditNotes = []) => {
  const ccy = (currency || 'ZAR').toUpperCase();
  const rows = statementLinesFor(ccy, invoices, receipts, creditNotes);
  const real = rows.filter((r) => !r.voided);
  const lastReal = [...real].reverse().find((r) => r.balance !== null);

  /* Charges are what was billed. A refund is not a charge -- it is money handed
     back -- so it is totalled on its own rather than inflating the figure the
     client is shown as having been billed. */
  const charges = round2(real.filter((r) => r.kind !== 'refund').reduce((a, r) => a + r.debit, 0));
  const payments = round2(real.filter((r) => r.kind !== 'refund').reduce((a, r) => a + r.credit, 0));
  const refunded = round2(real.filter((r) => r.kind === 'refund').reduce((a, r) => a + r.debit, 0));
  const running = lastReal ? lastReal.balance : 0;

  /* Cross-check against the documents, computed independently of the rows, so a
     document the statement failed to pick up shows up as a failed reconciliation
     rather than as a confidently wrong balance.

     Deliberately arithmetic and not `invoiceBalance`: that function is clamped at
     zero per invoice, so an overpaid invoice reads as nil there but as a credit
     here. A statement must be able to say "you are in credit", and it must be
     able to net off an overpayment on one invoice against an arrear on another. */
  const invoicesHere = invoices.filter((i) => sameCurrency(i.currency_code, ccy));
  const live = invoicesHere.filter((i) => !isVoid(i));
  const expected = round2(
    live.reduce((a, i) => a + num(i.total_incl), 0)
    /* Receipts reduce what is owed, refunds put it back, and credit notes
       reduce it. Netting all three is what makes this agree with the running
       balance above. */
    - rows.filter((r) => r.kind === 'receipt').reduce((a, r) => a + r.credit, 0)
    + rows.filter((r) => r.kind === 'refund').reduce((a, r) => a + r.debit, 0)
    - real.filter((r) => r.kind === 'credit_note').reduce((a, r) => a + r.credit, 0)
  );

  return {
    currency: ccy,
    rows,
    charges,
    payments,
    /* Positive: the client owes this. Negative: they are in credit. */
    closing: running,
    /* What the screen calls outstanding, which clamps each invoice at zero. The
       two differ when an overpayment is outstanding against an arrear. */
    screenOutstanding: round2(live.reduce((a, i) => a + invoiceBalance(i, receipts, creditNotes), 0)),
    voidedAmount: round2(rows.filter((r) => r.voided).reduce((a, r) => a + r.debit - r.credit, 0)),
    invoiceCount: live.length,
    voidCount: invoicesHere.filter(isVoid).length,
    refunded,
    receiptCount: rows.filter((r) => r.kind === 'receipt').length,
    refundCount: rows.filter((r) => r.kind === 'refund').length,
    creditNoteCount: real.filter((r) => r.kind === 'credit_note').length,
    reconciles: Math.abs(running - expected) < 0.009
  };
};

/* Currencies this itinerary actually has documents in. A booking with no
   invoicing yet still gets an empty statement rather than nothing to show. */
export const statementCurrencies = (invoices = [], receipts = [], creditNotes = [], fallback = 'ZAR') => {
  const codes = new Set();
  for (const i of invoices) if (i.currency_code) codes.add(String(i.currency_code).toUpperCase());
  for (const r of receipts) if (r.currency_code) codes.add(String(r.currency_code).toUpperCase());
  for (const c of creditNotes) if (c.currency_code) codes.add(String(c.currency_code).toUpperCase());
  codes.add(String(fallback || 'ZAR').toUpperCase());
  return [...codes].sort();
};

const currencySymbol = (ccy) => (String(ccy).toUpperCase() === 'ZAR' ? 'R' : String(ccy).toUpperCase() + ' ');

const rowHtml = (r, sym) => `<tr${r.voided ? ' class="memo"' : ''}>
  <td>${htmlEscape(r.date)}</td>
  <td>${htmlEscape(r.reference)}</td>
  <td>${htmlEscape(r.description)}</td>
  <td class="num">${r.debit ? fmtMoney(r.debit, sym) : ''}</td>
  <td class="num">${r.credit ? fmtMoney(r.credit, sym) : ''}</td>
  <td class="num">${r.balance === null ? '—' : fmtMoney(r.balance, sym)}</td>
</tr>`;

const closingText = (st, sym) => {
  if (st.rows.length === 0) return 'No invoices have been raised for this itinerary yet.';
  if (st.closing > 0.009) return `${fmtMoney(st.closing, sym)} outstanding.`;
  if (st.closing < -0.009) return `${fmtMoney(Math.abs(st.closing), sym)} held in credit.`;
  return 'Account settled in full. Nothing outstanding.';
};

export const statementDocHtml = (itinerary, st, opts = {}) => {
  const sym = currencySymbol(st.currency);
  const ref = itinerary?.reference_number || itinerary?.reference || '';
  const client = itinerary?.client_name || itinerary?.clients?.name || '';
  const title = `Statement of Account${ref ? ` — ${ref}` : ''}`;
  const opening = st.rows.length ? st.rows[0].balance - st.rows[0].debit + st.rows[0].credit : 0;

  return `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(title)}</title>    <style>${docStyles}
  .credit{color:#047857} .memo td{color:#666;font-style:italic} .foot{margin-top:24px;font-size:12px;color:#555}
  </style></head><body>
    ${logoOf(opts)}
    <div style="${alignStyle(opts?.billingAddressPosition)}">
      <h1>${htmlEscape(opts?.supplierName || 'Statement of Account')}</h1>
      ${opts?.supplierTaxNumber ? `<p class="muted">Tax No: ${htmlEscape(opts.supplierTaxNumber)}</p>` : ''}
      ${opts?.supplierAddress ? `<p class="muted">${htmlEscape(opts.supplierAddress).replace(/\n/g, '<br>')}</p>` : ''}
      ${companyContactHtml(opts) ? `<p class="muted">${companyContactHtml(opts)}</p>` : ''}
    </div>
    <hr/>
    <h2>${htmlEscape(title)}</h2>
    <p class="muted">
      ${ref ? `Booking: ${htmlEscape(ref)} · ` : ''}${client ? `Client: ${htmlEscape(client)} · ` : ''}
      Currency: ${htmlEscape(st.currency)}
      ${itinerary?.start_date ? ` · Travel: ${htmlEscape(dateOf(itinerary.start_date))}${itinerary?.end_date ? ` to ${htmlEscape(dateOf(itinerary.end_date))}` : ''}` : ''}
    </p>
    <table>
      <tr>
        <th>Date</th><th>Document</th><th>Description</th>
        <th class="num">Charged</th><th class="num">Paid / Credited</th><th class="num">Balance</th>
      </tr>
      <tr><td colspan="5" class="num">Opening balance</td><td class="num">${fmtMoney(opening, sym)}</td></tr>
      ${st.rows.map((r) => rowHtml(r, sym)).join('')}
      <tr class="grand"><td colspan="3" class="num">Total charged</td><td class="num">${fmtMoney(st.charges, sym)}</td><td></td><td></td></tr>
      <tr class="grand"><td colspan="4" class="num">Total paid and credited</td><td class="num">${fmtMoney(st.payments, sym)}</td><td></td></tr>
      <tr class="grand"><td colspan="5" class="num">CLOSING BALANCE</td><td class="num">${fmtMoney(st.closing, sym)}</td></tr>
    </table>
    <div class="box"><b>${htmlEscape(closingText(st, sym))}</b></div>
    <p class="foot">
      ${st.invoiceCount} invoice${st.invoiceCount === 1 ? '' : 's'}${st.voidCount ? `, ${st.voidCount} voided` : ''}
      ${st.receiptCount ? ` · ${st.receiptCount} receipt${st.receiptCount === 1 ? '' : 's'}` : ''}
      ${st.creditNoteCount ? ` · ${st.creditNoteCount} credit note${st.creditNoteCount === 1 ? '' : 's'}` : ''}.
      ${st.closing > 0.009 ? ' Please settle the closing balance at your earliest convenience.' : ''}
    </p>
    ${!st.reconciles ? '<p style="color:#b91c1c"><b>Warning:</b> this statement does not reconcile to the invoice balances on file. Please contact us.</p>' : ''}
  </body></html>`;
};

/* Plain-text body for the email, same figures in a readable order. The columns
   are padded to fixed widths so the amounts line up — a statement the client
   cannot scan column-by-column is not much use in an email. */
export const statementEmail = (itinerary, st, opts = {}) => {
  const sym = currencySymbol(st.currency);
  const ref = itinerary?.reference_number || itinerary?.reference || '';
  const client = itinerary?.client_name || itinerary?.clients?.name || '';
  const pad = (s, n) => String(s ?? '').padEnd(n);
  const lpad = (s, n) => String(s ?? '').padStart(n);
  const money = (v) => (v ? fmtMoney(v, sym) : '');

  const head = [pad('Date', 11), pad('Document', 19), pad('Description', 44), lpad('Charged', 13), lpad('Paid/Credited', 13), lpad('Balance', 13)].join(' ');
  const rows = st.rows.map((r) => [
    pad(r.date, 11),
    pad(r.reference, 19),
    pad(r.description, 44),
    lpad(money(r.debit), 13),
    lpad(money(r.credit), 13),
    lpad(r.balance === null ? '—' : fmtMoney(r.balance, sym), 13)
  ].join(' '));

  return [
    `Statement of Account${ref ? ` — ${ref}` : ''}`,
    client ? `Client: ${client}` : '',
    `Currency: ${st.currency}`,
    '',
    head,
    '-'.repeat(head.length),
    ...rows,
    '',
    `${'Total charged:'.padEnd(54)}${fmtMoney(st.charges, sym)}`,
    `${'Total paid and credited:'.padEnd(54)}${fmtMoney(st.payments, sym)}`,
    `${'CLOSING BALANCE:'.padEnd(54)}${fmtMoney(st.closing, sym)}`,
    '',
    closingText(st, sym),
    opts?.companyContactTel ? `Tel: ${opts.companyContactTel}` : '',
    opts?.companyContactEmail ? `Email: ${opts.companyContactEmail}` : ''
  ].join('\n');
};

/* CSV, for anyone who wants it in a spreadsheet.

   A cell starting with =, +, - or @ is executed as a formula by Excel and
   Sheets, so a document number or a credit note reason typed by a user could
   otherwise smuggle a formula onto the finance team when they open the file.
   Prefixing with an apostrophe forces it to be treated as text.

   Money columns bypass the guard: a genuine negative balance also starts with
   "-", and that one has to stay a number. */
const csvCell = (v) => {
  const s = String(v ?? '');
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};
const csvNum = (v) => (v === null || v === undefined || v === '' ? '""' : String(Number(v).toFixed(2)));

export const statementCsv = (itinerary, st) => {
  const ref = itinerary?.reference_number || itinerary?.reference || '';
  const lines = [
    ['Date', 'Document', 'Description', 'Charged', 'Paid or Credited', 'Balance', 'Currency'].map(csvCell).join(','),
    ...st.rows.map((r) => [
      csvCell(r.date), csvCell(r.reference), csvCell(r.description),
      csvNum(r.debit), csvNum(r.credit), r.balance === null ? '""' : csvNum(r.balance),
      csvCell(st.currency)
    ].join(',')),
    ['""', '""', csvCell('TOTAL'), csvNum(st.charges), csvNum(st.payments), csvNum(st.closing), csvCell(st.currency)].join(',')
  ];
  return ref ? `# Statement of Account ${ref}\n${lines.join('\n')}` : lines.join('\n');
};

/* Excel workbook (HTML-table .xls), matching the invoice export style. Amounts
   are bare numbers so the columns stay usable for formulas. */
export const statementExcelHtml = (itinerary, st, opts = {}) => {
  const ref = itinerary?.reference_number || itinerary?.reference || '';
  const client = itinerary?.client_name || itinerary?.clients?.name || '';
  return `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Statement</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--><style>
    table{border-collapse:collapse} th,td{border:1px solid #999;padding:4px 8px;font-family:Arial,sans-serif;font-size:12px} th{background:#eee;font-weight:700} .num{text-align:right} .grand{font-weight:700;background:#f5f5f5}
  </style></head><body>
    <table>
      <tr><td colspan="6" style="font-size:15px;font-weight:900">${htmlEscape(opts?.supplierName || 'Statement of Account')}</td></tr>
      <tr><td colspan="6">${ref ? `Booking: ${htmlEscape(ref)}` : ''}${client ? ` · Client: ${htmlEscape(client)}` : ''} · Currency: ${htmlEscape(st.currency)}</td></tr>
      <tr></tr>
      <tr><th>Date</th><th>Document</th><th>Description</th><th class="num">Charged</th><th class="num">Paid or Credited</th><th class="num">Balance</th></tr>
      ${st.rows.map((r) => `<tr><td>${htmlEscape(r.date)}</td><td>${htmlEscape(r.reference)}</td><td>${htmlEscape(r.description)}</td><td class="num">${r.debit ? r.debit.toFixed(2) : ''}</td><td class="num">${r.credit ? r.credit.toFixed(2) : ''}</td><td class="num">${r.balance === null ? '' : r.balance.toFixed(2)}</td></tr>`).join('')}
      <tr class="grand"><td colspan="3" class="num">Total charged</td><td class="num">${st.charges.toFixed(2)}</td><td></td><td></td></tr>
      <tr class="grand"><td colspan="4" class="num">Total paid and credited</td><td class="num">${st.payments.toFixed(2)}</td><td></td></tr>
      <tr class="grand"><td colspan="5" class="num">CLOSING BALANCE</td><td class="num">${st.closing.toFixed(2)}</td></tr>
    </table>
  </body></html>`;
};
