/* Shared invoice / receipt / credit-note helpers.
   Used by the Invoices module and the Itinerary Builder so both produce
   identical documents, emails and accounting exports. */

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const vatOfInclusive = (amount, rate) => (Number(amount) || 0) * (Number(rate) || 0) / (100 + (Number(rate) || 0));
export const numOr = (v, fallback) => (v === null || v === undefined || v === '' ? fallback : Number(v));

export const fmtMoney = (n, symbol) => `${symbol || ''}${round2(n).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* Balance still owed on an invoice. A final invoice that has been paid is
   cleared to 0.00 (it showed the amount to pay before the receipt). */
export const effectiveBalance = (inv) => {
  if (!inv) return 0;
  if (inv.invoice_type === 'final' && inv.status === 'paid') return 0;
  return Number(inv.balance_due) || 0;
};

export const htmlEscape = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export const TYPE_LABEL = { deposit: 'Deposit Invoice', final: 'Final Invoice' };
export const STATUS_META = {
  proforma: { label: 'Proforma', color: '#b45309', bg: '#fffbeb' },
  validated: { label: 'Validated', color: '#0d7478', bg: '#ecfeff' },
  paid: { label: 'Paid', color: '#047857', bg: '#ecfdf5' },
  void: { label: 'Void', color: '#b91c1c', bg: '#fef2f2' }
};

/* Display width of the company logo on printed documents. 160px is the typical
   industry standard for a header logo on an A4 document. */
export const LOGO_WIDTHS = { sm: 110, md: 160, lg: 220 };

const logoOf = (opts) => {
  const { logo, logoSize } = opts || {};
  if (!logo) return '';
  const width = LOGO_WIDTHS[logoSize] || LOGO_WIDTHS.md;
  return `<img src="${htmlEscape(logo)}" alt="Company logo" style="display:block;max-width:${width}px;height:auto;margin:0 0 10px">`;
};

export const mailTo = (email, subject, body) => `mailto:${(email || '').trim()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

export const clipboardCopy = (text) => {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } finally { ta.remove(); }
  return Promise.resolve();
};

export const downloadBlob = (content, filename, type) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const openPrintWindow = (html, tag) => {
  const w = window.open('', '_blank', 'width=900,height=760');
  if (!w) return null;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch { /* pop-up closed */ } }, tag || 350);
  return w;
};

/* Aggregate itinerary-day items into one invoice's line set for a currency. */
export const buildCurrencyLines = (itinerary, currencyCode, paxCount) => {
  const lines = [];
  const taxByLabel = {};
  let subtotalExcl = 0;
  let taxTotal = 0;
  let totalIncl = 0;
  let sort = 0;
  (itinerary.itinerary_days || [])
    .slice()
    .sort((a, b) => (a.day_number || 0) - (b.day_number || 0))
    .forEach((day) => {
      (day.itinerary_day_items || [])
        .filter((it) => it.is_included !== false)
        .filter((it) => (it.currency_code || itinerary.currency_code || 'ZAR').toUpperCase() === currencyCode.toUpperCase())
        .forEach((it) => {
          const rate = numOr(it.tax_rate, 15);
          const label = it.tax_label || 'VAT';
          const gross = round2(numOr(it.total_sell, 0));
          const vat = round2(vatOfInclusive(gross, rate));
          const net = round2(gross - vat);
          const pax = numOr(it.pax, paxCount) || paxCount || 1;
          lines.push({
            day_number: day.day_number || 1,
            service_date: day.day_date || null,
            item_name: it.description_override || it.item_name || 'Service',
            category: it.category || '',
            supplier_name: it.supplier_name || '',
            quantity: pax,
            unit_price: round2(gross / (pax || 1)),
            subtotal_excl: net,
            tax_amount: vat,
            line_total: gross,
            tax_label: label,
            tax_rate: rate,
            currency_code: currencyCode,
            sort_order: sort++
          });
          subtotalExcl += net;
          taxTotal += vat;
          totalIncl += gross;
          if (!taxByLabel[label]) taxByLabel[label] = { rate, amount: 0 };
          taxByLabel[label].amount += vat;
        });
    });
  return {
    lines,
    subtotalExcl: round2(subtotalExcl),
    taxTotal: round2(taxTotal),
    totalIncl: round2(totalIncl),
    taxEntries: Object.entries(taxByLabel).map(([label, info]) => ({ label, rate: info.rate, amount: round2(info.amount) }))
  };
};

/* Adapter for the builder's working `days` (services) → invoice line set. */
export const buildLinesFromDays = (days, paxCount, currencyCode) => buildCurrencyLines({
  currency_code: currencyCode,
  itinerary_days: (days || []).map((d) => ({
    day_number: d.dayNumber,
    day_date: d.date || null,
    itinerary_day_items: (d.services || []).map((s) => ({
      item_name: s.name,
      description_override: s.descOverride,
      category: s.category,
      supplier_name: s.supplierName,
      currency_code: s.currencyCode || currencyCode,
      pax: s.pax || paxCount,
      total_sell: round2((Number(s.sellPP) || 0) * paxCount),
      tax_rate: s.taxRate,
      tax_label: s.taxLabel,
      is_included: true
    }))
  }))
}, currencyCode, paxCount);

export const accountingPayload = (invoice, lines) => ({
  schema: 'torbuilder.invoice/v1',
  provider_agnostic: true,
  invoice_number: invoice.invoice_number,
  invoice_type: invoice.invoice_type,
  status: invoice.status,
  issue_date: invoice.issued_date,
  due_date: invoice.due_date,
  currency: invoice.currency_code,
  supplier: {
    name: invoice.supplier_name,
    tax_number: invoice.supplier_tax_number,
    address: invoice.supplier_address
  },
  customer: {
    name: invoice.bill_to_name,
    email: invoice.bill_to_email,
    address: invoice.bill_to_address
  },
  lines: (lines || []).map((l) => ({
    description: l.item_name,
    day: l.day_number,
    service_date: l.service_date,
    quantity: l.quantity,
    unit_price: l.unit_price,
    subtotal_excl: l.subtotal_excl,
    tax_code: l.tax_label,
    tax_rate: l.tax_rate,
    tax_amount: l.tax_amount,
    line_total: l.line_total
  })),
  totals: {
    subtotal_excl: invoice.subtotal_excl,
    tax_total: invoice.tax_total,
    total_incl: invoice.total_incl,
    deposit_percentage: invoice.deposit_percentage,
    deposit_amount: invoice.deposit_amount,
    credited_amount: invoice.credited_amount || 0,
    balance_due: invoice.balance_due
  },
  credits: invoice.credited_invoice_number
    ? [{ against_invoice: invoice.credited_invoice_number, amount: invoice.credited_amount || 0 }]
    : [],
  payment: invoice.bank_details
});

export const creditNotePayload = (cn, lines) => ({
  schema: 'torbuilder.credit_note/v1',
  provider_agnostic: true,
  credit_note_number: cn.credit_note_number,
  against_invoice: cn.invoice_number,
  invoice_type: cn.invoice_type,
  status: cn.status,
  issue_date: cn.issued_date,
  currency: cn.currency_code,
  reason: cn.reason,
  supplier: { name: cn.supplier_name, tax_number: cn.supplier_tax_number, address: cn.supplier_address },
  customer: { name: cn.bill_to_name, email: cn.bill_to_email, address: cn.bill_to_address },
  lines: (lines || []).map((l) => ({
    description: l.item_name,
    day: l.day_number,
    service_date: l.service_date,
    quantity: l.quantity,
    unit_price: l.unit_price,
    subtotal_excl: l.subtotal_excl,
    tax_code: l.tax_label,
    tax_rate: l.tax_rate,
    tax_amount: l.tax_amount,
    line_total: l.line_total
  })),
  totals: { subtotal_excl: cn.subtotal_excl, tax_total: cn.tax_total, total_incl: cn.total_incl }
});

export const invoiceEmail = (invoice, lines) => {
  const cur = invoice.currency_code;
  const isProforma = invoice.status === 'proforma';
  const isFinal = invoice.invoice_type === 'final';
  const depositPaidLine = isFinal && Number(invoice.credited_amount) > 0
    ? `Less deposit received (${invoice.credited_invoice_number || 'prior invoice'}): ${fmtMoney(invoice.credited_amount, cur)}`
    : `Less deposit received: ${fmtMoney(invoice.deposit_amount || 0, cur)}`;
  const body = [
    `${(isProforma ? 'PROFORMA — ' : '')}${TYPE_LABEL[invoice.invoice_type]?.toUpperCase() || 'INVOICE'} ${invoice.invoice_number}`,
    '',
    invoice.supplier_name || '',
    invoice.supplier_tax_number ? `VAT / Tax No: ${invoice.supplier_tax_number}` : '',
    invoice.supplier_address || '',
    '',
    `Bill To: ${invoice.bill_to_name || '—'}`,
    invoice.bill_to_address || '',
    `Issued: ${invoice.issued_date || '—'}${invoice.due_date ? `   Due: ${invoice.due_date}` : ''}`,
    '',
    ...(lines || []).map((l) => `Day ${l.day_number}  ${l.item_name}  x${l.quantity}  ${fmtMoney(l.line_total, cur)}`),
    '',
    `Subtotal (Excl VAT): ${fmtMoney(invoice.subtotal_excl, cur)}`,
    `VAT (${invoice.tax_label} ${Number(invoice.tax_rate)}%): ${fmtMoney(invoice.tax_total, cur)}`,
    `${cur} TOTAL DUE (INCL TAX ${invoice.tax_label}): ${fmtMoney(invoice.total_incl, cur)}`,
    '',
    isFinal
      ? `${depositPaidLine}\nBALANCE TO BE PAID: ${fmtMoney(effectiveBalance(invoice), cur)}${invoice.status === 'paid' ? ' (PAID — account settled)' : ''}`
      : `Deposit requested (${Number(invoice.deposit_percentage)}%): ${fmtMoney(invoice.deposit_amount, cur)}\nBALANCE REMAINING after deposit: ${fmtMoney(invoice.balance_due, cur)}`,
    '',
    isProforma ? 'This is a proforma request for payment, not yet a tax invoice.' : '',
    'Banking details:',
    ...Object.entries(invoice.bank_details || {})
      .filter(([, v]) => v)
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`),
    '',
    'Thank you for your business.'
  ].filter((l) => l !== '').join('\n');
  return {
    to: invoice.bill_to_email || '',
    subject: `${isProforma ? 'Proforma ' : ''}${TYPE_LABEL[invoice.invoice_type] || 'Invoice'} ${invoice.invoice_number}${invoice.supplier_name ? ` — ${invoice.supplier_name}` : ''}`,
    body
  };
};

export const receiptEmail = (receipt) => {
  const cur = receipt.currency_code;
  const body = [
    `PAYMENT RECEIPT ${receipt.receipt_number}`,
    '',
    receipt.supplier_name || '',
    receipt.supplier_tax_number ? `VAT / Tax No: ${receipt.supplier_tax_number}` : '',
    receipt.supplier_address || '',
    '',
    `Received from: ${receipt.bill_to_name || '—'}`,
    `Date received: ${receipt.received_date || '—'}`,
    `Amount received: ${fmtMoney(receipt.amount, cur)}`,
    `Payment method: ${receipt.payment_method || '—'}`,
    receipt.payment_reference ? `Payment reference: ${receipt.payment_reference}` : '',
    '',
    `In payment of: ${TYPE_LABEL[receipt.invoice_type] || 'Invoice'} ${receipt.invoice_number}`,
    `Balance remaining: ${fmtMoney(receipt.balance_remaining, cur)}`,
    '',
    'Thank you for your business.'
  ].filter((l) => l !== '').join('\n');
  return {
    to: receipt.bill_to_email || '',
    subject: `Payment Receipt ${receipt.receipt_number}${receipt.supplier_name ? ` — ${receipt.supplier_name}` : ''}`,
    body
  };
};

export const creditNoteEmail = (cn) => {
  const cur = cn.currency_code;
  const body = [
    `CREDIT NOTE ${cn.credit_note_number}`,
    '',
    cn.supplier_name || '',
    cn.supplier_tax_number ? `VAT / Tax No: ${cn.supplier_tax_number}` : '',
    cn.supplier_address || '',
    '',
    `Credited to: ${cn.bill_to_name || '—'}`,
    `Date: ${cn.issued_date || '—'}`,
    `Against invoice: ${cn.invoice_number}`,
    cn.reason ? `Reason: ${cn.reason}` : '',
    '',
    `Subtotal (Excl VAT): ${fmtMoney(cn.subtotal_excl, cur)}`,
    `VAT (${cn.tax_label} ${Number(cn.tax_rate)}%): ${fmtMoney(cn.tax_total, cur)}`,
    `TOTAL CREDITED (INCL TAX ${cn.tax_label}): ${fmtMoney(cn.total_incl, cur)}`,
    '',
    'This credit note reverses the invoice above in full and balances the account.',
    '',
    'Thank you for your business.'
  ].filter((l) => l !== '').join('\n');
  return {
    to: cn.bill_to_email || '',
    subject: `Credit Note ${cn.credit_note_number}${cn.supplier_name ? ` — ${cn.supplier_name}` : ''}`,
    body
  };
};

/* Printable / exportable HTML for invoices, receipts and credit notes. */
export const docStyles = `
  body{font-family:Arial,sans-serif;margin:32px;color:#111}
  h1{margin:0 0 4px} h2{margin:0 0 4px;font-size:16px}
  .muted{color:#666;font-size:13px;margin:2px 0}
  table{border-collapse:collapse;width:100%;margin-top:16px}
  th,td{border:1px solid #ccc;padding:6px 10px;text-align:left;font-size:13px}
  th{background:#eee} td.num,th.num{text-align:right} .grand{font-weight:700}
  .box{border:1px solid #ddd;border-radius:10px;padding:12px 16px;margin-top:16px}
`;

export const invoiceDocHtml = (inv, lines, sym, opts) => {
  const isFinal = inv.invoice_type === 'final';
  const creditLine = isFinal && Number(inv.credited_amount) > 0
    ? `<tr class="grand"><td colspan="6" class="num">Less deposit received${inv.credited_invoice_number ? ` (${htmlEscape(inv.credited_invoice_number)})` : ''}</td><td class="num">-${fmtMoney(inv.credited_amount, sym)}</td></tr>`
    : '';
  const dueLine = isFinal
    ? `<b>BALANCE TO BE PAID:</b> ${fmtMoney(effectiveBalance(inv), sym)}${inv.status === 'paid' ? ' <span style="color:#047857">(PAID — account settled)</span>' : ''}`
    : `<b>Deposit requested (${Number(inv.deposit_percentage)}%):</b> ${fmtMoney(inv.deposit_amount, sym)}<br><b>Balance remaining after deposit:</b> ${fmtMoney(inv.balance_due, sym)}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(inv.invoice_number)}</title><style>${docStyles}</style></head><body>
    ${logoOf(opts)}
    <h1>${htmlEscape(inv.supplier_name || 'Invoice')}</h1>
    <p class="muted">${inv.supplier_tax_number ? `VAT / Tax No: ${htmlEscape(inv.supplier_tax_number)}` : ''}</p>
    <p class="muted">${htmlEscape(inv.supplier_address || '').replace(/\n/g, '<br>')}</p>
    <hr/>
    <h2>${inv.status === 'proforma' ? 'PROFORMA — ' : ''}${htmlEscape(TYPE_LABEL[inv.invoice_type] || 'Invoice')} ${htmlEscape(inv.invoice_number)}</h2>
    <p class="muted">Issued: ${htmlEscape(inv.issued_date || '—')}${inv.due_date ? ` · Due: ${htmlEscape(inv.due_date)}` : ''} · Currency: ${htmlEscape(inv.currency_code)}${inv.status === 'paid' ? ' · PAID' : ''}</p>
    <div class="box"><b>Bill To</b><br>${htmlEscape(inv.bill_to_name || '—')}<br>${htmlEscape(inv.bill_to_address || '').replace(/\n/g, '<br>')}</div>
    <table>
      <tr><th>Day</th><th>Description</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Subtotal (Excl VAT)</th><th class="num">VAT</th><th class="num">Total</th></tr>
      ${(lines || []).map((l) => `<tr><td>${l.day_number}</td><td>${htmlEscape(l.item_name)}${l.supplier_name ? `<br><span class="muted">${htmlEscape(l.supplier_name)}</span>` : ''}</td><td class="num">${l.quantity}</td><td class="num">${fmtMoney(l.unit_price, sym)}</td><td class="num">${fmtMoney(l.subtotal_excl, sym)}</td><td class="num">${fmtMoney(l.tax_amount, sym)}</td><td class="num">${fmtMoney(l.line_total, sym)}</td></tr>`).join('')}
      <tr class="grand"><td colspan="6" class="num">Subtotal (Excl VAT)</td><td class="num">${fmtMoney(inv.subtotal_excl, sym)}</td></tr>
      <tr class="grand"><td colspan="6" class="num">${htmlEscape(inv.tax_label)} (${Number(inv.tax_rate)}%)</td><td class="num">${fmtMoney(inv.tax_total, sym)}</td></tr>
      <tr class="grand"><td colspan="6" class="num">${htmlEscape(inv.currency_code)} TOTAL DUE (INCL TAX ${htmlEscape(inv.tax_label)})</td><td class="num">${fmtMoney(inv.total_incl, sym)}</td></tr>
      ${creditLine}
    </table>
    <div class="box">${dueLine}</div>
    <div class="box"><b>Banking Details</b><br>${Object.entries(inv.bank_details || {}).filter(([, v]) => v).map(([k, v]) => `${htmlEscape(k.replace(/_/g, ' '))}: ${htmlEscape(v)}`).join('<br>') || '—'}</div>
    ${inv.status === 'proforma' ? '<p class="muted">This is a proforma request for payment, not yet a tax invoice.</p>' : ''}
    ${inv.status === 'void' ? `<p style="color:#b91c1c"><b>VOIDED</b>${inv.void_reason ? ` — ${htmlEscape(inv.void_reason)}` : ''}</p>` : ''}
    </body></html>`;
};

export const receiptDocHtml = (r, sym, opts) => `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(r.receipt_number)}</title><style>${docStyles}</style></head><body>
    ${logoOf(opts)}
    <h1>${htmlEscape(r.supplier_name || 'Payment Receipt')}</h1>
    <p class="muted">${r.supplier_tax_number ? `VAT / Tax No: ${htmlEscape(r.supplier_tax_number)}` : ''}</p>
    <p class="muted">${htmlEscape(r.supplier_address || '').replace(/\n/g, '<br>')}</p>
    <hr/>
    <h2>PAYMENT RECEIPT ${htmlEscape(r.receipt_number)}</h2>
    <p class="muted">Date received: ${htmlEscape(r.received_date || '—')} · Currency: ${htmlEscape(r.currency_code)}</p>
    <div class="box"><b>Received From</b><br>${htmlEscape(r.bill_to_name || '—')}<br>${r.bill_to_email ? htmlEscape(r.bill_to_email) : ''}</div>
    <table>
      <tr><th>Invoice</th><th>Type</th><th>Method</th><th>Reference</th><th class="num">Amount Received</th><th class="num">Balance Remaining</th></tr>
      <tr><td>${htmlEscape(r.invoice_number)}</td><td>${htmlEscape(TYPE_LABEL[r.invoice_type] || r.invoice_type)}</td><td>${htmlEscape(r.payment_method || '—')}</td><td>${htmlEscape(r.payment_reference || '—')}</td><td class="num">${fmtMoney(r.amount, sym)}</td><td class="num">${fmtMoney(r.balance_remaining, sym)}</td></tr>
      <tr class="grand"><td colspan="4" class="num">TOTAL RECEIVED</td><td class="num">${fmtMoney(r.amount, sym)}</td><td class="num">${fmtMoney(r.balance_remaining, sym)}</td></tr>
    </table>
    <div class="box">Payment received with thanks${Number(r.balance_remaining) > 0 ? `<br><b>Outstanding balance:</b> ${fmtMoney(r.balance_remaining, sym)}` : '<br><b>Account settled in full.</b>'}</div>
    </body></html>`;

export const creditNoteDocHtml = (cn, sym, opts) => `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(cn.credit_note_number)}</title><style>${docStyles}</style></head><body>
    ${logoOf(opts)}
    <h1>${htmlEscape(cn.supplier_name || 'Credit Note')}</h1>
    <p class="muted">${cn.supplier_tax_number ? `VAT / Tax No: ${htmlEscape(cn.supplier_tax_number)}` : ''}</p>
    <p class="muted">${htmlEscape(cn.supplier_address || '').replace(/\n/g, '<br>')}</p>
    <hr/>
    <h2>CREDIT NOTE ${htmlEscape(cn.credit_note_number)}</h2>
    <p class="muted">Date: ${htmlEscape(cn.issued_date || '—')} · Against invoice: ${htmlEscape(cn.invoice_number)} · Currency: ${htmlEscape(cn.currency_code)}</p>
    <div class="box"><b>Credited To</b><br>${htmlEscape(cn.bill_to_name || '—')}<br>${htmlEscape(cn.bill_to_address || '').replace(/\n/g, '<br>')}</div>
    ${cn.reason ? `<p class="muted"><b>Reason:</b> ${htmlEscape(cn.reason)}</p>` : ''}
    <table>
      <tr><th>Description</th><th class="num">Amount</th></tr>
      <tr><td>Reversal of ${htmlEscape(TYPE_LABEL[cn.invoice_type] || 'Invoice')} ${htmlEscape(cn.invoice_number)} — Subtotal (Excl VAT)</td><td class="num">${fmtMoney(cn.subtotal_excl, sym)}</td></tr>
      <tr><td>${htmlEscape(cn.tax_label)} (${Number(cn.tax_rate)}%)</td><td class="num">${fmtMoney(cn.tax_total, sym)}</td></tr>
      <tr class="grand"><td>${htmlEscape(cn.currency_code)} TOTAL CREDITED (INCL TAX ${htmlEscape(cn.tax_label)})</td><td class="num">${fmtMoney(cn.total_incl, sym)}</td></tr>
    </table>
    <div class="box"><b>${fmtMoney(cn.total_incl, sym)} credited</b> to ${htmlEscape(cn.bill_to_name || 'the client')}. This credit note reverses the invoice in full and balances the account.</div>
    </body></html>`;

/* Genuine Excel workbook (HTML-table .xls), mirroring the itinerary export style. */
export const invoiceExcelHtml = (inv, lines, sym) => {
  const isFinal = inv.invoice_type === 'final';
  const rows = (lines || []).map((l) => `<tr><td>${l.day_number}</td><td>${htmlEscape(l.service_date || '')}</td><td>${htmlEscape(l.category || '')}</td><td>${htmlEscape(l.item_name)}${l.supplier_name ? ` — ${htmlEscape(l.supplier_name)}` : ''}</td><td>${l.quantity}</td><td>${fmtMoney(l.unit_price, sym)}</td><td>${fmtMoney(l.subtotal_excl, sym)}</td><td>${fmtMoney(l.tax_amount, sym)}</td><td>${fmtMoney(l.line_total, sym)}</td></tr>`).join('');
  const credit = isFinal && Number(inv.credited_amount) > 0
    ? `<tr><td colspan="8" class="num">Less deposit received${inv.credited_invoice_number ? ` (${htmlEscape(inv.credited_invoice_number)})` : ''}</td><td class="num">-${fmtMoney(inv.credited_amount, sym)}</td></tr>`
    : '';
  return `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Invoice</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--><style>
    table{border-collapse:collapse} th,td{border:1px solid #999;padding:4px 8px;font-family:Arial,sans-serif;font-size:12px} th{background:#eee;font-weight:700} .num{text-align:right} .grand{font-weight:700;background:#f5f5f5}
  </style></head><body>
    <table>
      <tr><td colspan="9" style="font-size:15px;font-weight:900">${htmlEscape(inv.supplier_name || 'Invoice')}</td></tr>
      <tr><td colspan="9">${inv.status === 'proforma' ? 'PROFORMA — ' : ''}${htmlEscape(TYPE_LABEL[inv.invoice_type] || 'Invoice')} ${htmlEscape(inv.invoice_number)}</td></tr>
      <tr><td colspan="9">Issued: ${htmlEscape(inv.issued_date || '')}${inv.due_date ? ` · Due: ${htmlEscape(inv.due_date)}` : ''} · Currency: ${htmlEscape(inv.currency_code)}</td></tr>
      <tr><td colspan="9">Bill To: ${htmlEscape(inv.bill_to_name || '')}</td></tr>
      <tr></tr>
      <tr><th>Day</th><th>Date</th><th>Category</th><th>Description</th><th>Qty</th><th class="num">Unit Price</th><th class="num">Subtotal (Excl VAT)</th><th class="num">VAT</th><th class="num">Total</th></tr>
      ${rows}
      <tr class="grand"><td colspan="8" class="num">Subtotal (Excl VAT)</td><td class="num">${fmtMoney(inv.subtotal_excl, sym)}</td></tr>
      <tr class="grand"><td colspan="8" class="num">${htmlEscape(inv.tax_label)} (${Number(inv.tax_rate)}%)</td><td class="num">${fmtMoney(inv.tax_total, sym)}</td></tr>
      <tr class="grand"><td colspan="8" class="num">${htmlEscape(inv.currency_code)} TOTAL DUE (INCL TAX ${htmlEscape(inv.tax_label)})</td><td class="num">${fmtMoney(inv.total_incl, sym)}</td></tr>
      ${credit}
      <tr class="grand"><td colspan="8" class="num">${isFinal ? 'BALANCE TO BE PAID' : 'BALANCE REMAINING AFTER DEPOSIT'}</td><td class="num">${fmtMoney(effectiveBalance(inv), sym)}</td></tr>
    </table>
  </body></html>`;
};
