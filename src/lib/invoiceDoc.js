/* Shared invoice / receipt / credit-note helpers.
   Used by the Invoices module and the Itinerary Builder so both produce
   identical documents, emails and accounting exports. */

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const vatOfInclusive = (amount, rate) => (Number(amount) || 0) * (Number(rate) || 0) / (100 + (Number(rate) || 0));
export const numOr = (v, fallback) => (v === null || v === undefined || v === '' ? fallback : Number(v));

/* Currency-aware tax wording. ZAR keeps South African VAT / SARS nomenclature
   byte-identical; every other currency uses generic "Tax" wording so no output
   document references VAT or SARS for non-ZAR amounts. */
export const isZar = (ccy) => String(ccy || 'ZAR').toUpperCase() === 'ZAR';
export const taxWordOf = (ccy) => (isZar(ccy) ? 'VAT' : 'Tax');
export const taxWordUpper = (ccy) => (isZar(ccy) ? 'VAT' : 'TAX');
export const taxNoPrefix = (ccy) => (isZar(ccy) ? 'VAT / Tax No:' : 'Tax No:');
export const taxAgencyOf = (ccy, revenueAgency) => (isZar(ccy) ? 'SARS' : (revenueAgency || 'Revenue Service'));
export const taxDisplayLabel = (ccy, label, rate) => {
  if (Number(rate) === 0) return isZar(ccy) ? 'No VAT' : 'No Tax';
  return label || (isZar(ccy) ? 'VAT' : 'Tax');
};

/* `${creditLine}`      → tax row label used inside credit-note documents. */
const taxRowLabel = (ccy, label, rate) =>
  `${taxWordUpper(ccy)} (${taxDisplayLabel(ccy, label, rate)} ${Number(rate)}%)`;

/* TOTAL DUE / TOTAL CREDITED grand-total lines on tax documents. */
const totalDueLabel = (inv) => isZar(inv.currency_code)
  ? `${inv.currency_code} TOTAL DUE (INCL TAX ${inv.tax_label || 'VAT'})`
  : `${inv.currency_code} TOTAL DUE (INCL TAX)`;
const totalCreditedLabel = (cn) => isZar(cn.currency_code)
  ? `TOTAL CREDITED (INCL TAX ${cn.tax_label || 'VAT'})`
  : 'TOTAL CREDITED (INCL TAX)';

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

/* Single summary line showing the total price of all services per person.
   Used when the Presentation preference is set to "per person". `inv` only
   needs the three totals (subtotal_excl / tax_total / total_incl). */
export const perPersonSummary = (inv, pax) => {
  const count = Number(pax) > 0 ? Number(pax) : 1;
  return {
    day_number: 'All',
    item_name: 'Total price per person — all services',
    supplier_name: '',
    quantity: 1,
    unit_price: round2(Number(inv.total_incl) / count),
    subtotal_excl: round2(Number(inv.subtotal_excl) / count),
    tax_amount: round2(Number(inv.tax_total) / count),
    line_total: round2(Number(inv.total_incl) / count),
    service_date: null,
    category: ''
  };
};

/* Per-person breakdown rows stored on an invoice at issue time (JSON snapshot
   written by the shared perPersonPricing helper). Used when the Presentation
   preference is "per person" so the document shows the same Per person sharing
   / Single supplement / Per child rows the itinerary exports produce. Falls
   back to the single total-per-person line when no snapshot exists (older
   invoices). */
export const perPersonBreakdownRows = (inv, pax) => {
  const bd = inv?.per_person_breakdown;
  if (bd && Array.isArray(bd.rows) && bd.rows.length) {
    return bd.rows.map((r) => ({
      day_number: 'All',
      item_name: r.label || 'Per person',
      supplier_name: '',
      quantity: 1,
      unit_price: round2(Number(r.sell) || 0),
      subtotal_excl: round2(Number(r.subExcl) || 0),
      tax_amount: round2(Number(r.tax) || 0),
      line_total: round2(Number(r.sell) || 0),
      service_date: null,
      category: ''
    }));
  }
  return [perPersonSummary(inv, pax)];
};

/* Resolve which lines to render for a document given the Presentation
   preference:
     - 'daily' keeps the full itemisation; the caller may pass precomputed
       `opts.expandedLines` (accommodation broken into one line per occupied
       room, every other service unchanged) when the presentation asks for it.
     - 'per_person' collapses to the stored per-person breakdown rows (or a
       single total-per-person line). */
export const docLines = (inv, lines, opts = {}) => {
  const rendered = lines || [];
  if (opts.pricingBreakdownMode === 'per_person' && rendered.length > 0) {
    return perPersonBreakdownRows(inv, rendered[0].quantity);
  }
  if (Array.isArray(opts.expandedLines) && opts.expandedLines.length > 0) {
    return opts.expandedLines;
  }
  return rendered;
};

/* Whether the supplier should appear under / beside the service description.
   Accommodation is always shown (the client must see who quotes the room);
   every other category follows the Presentation preference. */
export const showSupplierIn = (l, opts = {}) => {
  if (!l?.supplier_name) return false;
  if (/accommodation/i.test(l.category || '')) return true;
  return opts.showSupplierInDescription !== false;
};

/* Industry-standard meal plan abbreviation (e.g. "Bed & Breakfast" -> "B&B").
   The client itinerary document always includes the accommodation meal plan;
   on the pricing breakdown it is shown only when the Presentation toggle is on. */
export const abbrevMealPlan = (mp) => {
  const s = String(mp || '').trim().toUpperCase();
  const table = {
    'ROOM ONLY': 'RO',
    'BED & BREAKFAST': 'B&B',
    'BED AND BREAKFAST': 'B&B',
    'HALF BOARD': 'HB',
    'HALF-BOARD': 'HB',
    'FULL BOARD': 'FB',
    'FULL-BOARD': 'FB',
    'ALL INCLUSIVE': 'AI',
    'ALL-INCLUSIVE': 'AI',
    'SELF CATERING': 'SC',
    'SELF-CATERING': 'SC'
  };
  if (table[s]) return table[s];
  const norm = s.replace(/[^A-Z0-9]/g, '');
  const fuzzy = {
    ROOMONLY: 'RO', BEDBREAKFAST: 'B&B', BEDANDBREAKFAST: 'B&B',
    HALFBOARD: 'HB', FULLBOARD: 'FB', ALLINCLUSIVE: 'AI', SELFCATERING: 'SC'
  };
  return fuzzy[norm] || (String(mp || '').trim() || '');
};

/* Whether the accommodation meal plan abbreviation should appear under the
   service description in the pricing breakdown. */
export const showMealPlanOn = (l, opts = {}) =>
  /accommodation/i.test(l.category || '') && showMealPlanOnHelp(l, opts);
const showMealPlanOnHelp = (l, opts = {}) => {
  const mp = String(l?.meal_plan || '').trim();
  if (!mp) return false;
  return opts.showMealPlanOnAccommodation !== false;
};

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
  const { logo, logoSize, logoPosition } = opts || {};
  if (!logo) return '';
  const width = LOGO_WIDTHS[logoSize] || LOGO_WIDTHS.md;
  const align = logoPosition === 'center' ? 'margin:0 auto 10px' : (logoPosition === 'right' ? 'margin:0 0 10px auto' : 'margin:0 0 10px');
  return `<img src="${htmlEscape(logo)}" alt="Company logo" style="display:block;max-width:${width}px;height:auto;${align}">`;
};

/* text-align style for a document header/footer block given its alignment pref. */
const alignStyle = (pos) => (pos === 'center' ? 'text-align:center' : (pos === 'right' ? 'text-align:right' : 'text-align:left'));

/* Optional client logo inside the Bill To block, sized/positioned per tenant prefs. */
const clientLogoOf = (record, opts = {}) => {
  const logo = record?.bill_to_logo_data_url || '';
  if (!logo) return '';
  const width = LOGO_WIDTHS[opts?.clientLogoSize] || LOGO_WIDTHS.md;
  const pos = opts?.clientLogoPosition || 'left';
  const align = pos === 'center' ? 'margin:0 auto 10px' : (pos === 'right' ? 'margin:0 0 10px auto' : 'margin:0 0 10px');
  return `<img src="${htmlEscape(logo)}" alt="Client logo" style="display:block;max-width:${width}px;height:auto;${align}">`;
};

/* Tenant (Bill From) contact lines, shown under the company details on
   invoices, receipts and credit notes. Values come from the company billing
   profile via the shared branding options. */
const companyContactHtml = (opts = {}) => {
  const tel = String(opts?.companyContactTel || '').trim();
  const cell = String(opts?.companyContactCell || '').trim();
  const email = String(opts?.companyContactEmail || '').trim();
  const website = String(opts?.companyContactWebsite || '').trim();
  const parts = [
    (tel || cell) ? `Tel: ${htmlEscape([tel, cell].filter(Boolean).join(' · '))}` : '',
    email ? `Email: ${htmlEscape(email)}` : '',
    website ? `Web: ${htmlEscape(website)}` : ''
  ].filter(Boolean);
  return parts.length ? parts.join('<br>') : '';
};

/* Same tenant contact block for the plain-text email bodies. */
const companyContactText = (opts = {}) => {
  const tel = String(opts?.companyContactTel || '').trim();
  const cell = String(opts?.companyContactCell || '').trim();
  const email = String(opts?.companyContactEmail || '').trim();
  const website = String(opts?.companyContactWebsite || '').trim();
  return [
    (tel || cell) ? `Tel: ${[tel, cell].filter(Boolean).join(' · ')}` : '',
    email ? `Email: ${email}` : '',
    website ? `Web: ${website}` : ''
  ].filter(Boolean).join('\n');
};

/* Bill To / Received From / Credited To box for invoices, receipts and credit notes. */
const billToBoxOf = (record, opts = {}, label = 'Bill To') => {
  const addr = (record?.bill_to_address || '').replace(/\n/g, '<br>');
  const email = record?.bill_to_email || '';
  const tel = record?.bill_to_tel || '';
  const cell = record?.bill_to_cell || '';
  const website = record?.bill_to_website || '';
  const contactLines = opts?.withContact
    ? [
        (tel || cell) ? `Tel: ${[tel, cell].filter(Boolean).join(' · ')}` : '',
        email ? `Email: ${htmlEscape(email)}` : '',
        website ? `Website: ${htmlEscape(website)}` : ''
      ].filter((l) => l !== '')
    : [];
  const lines = [
    `<b>${label}</b>`,
    clientLogoOf(record, opts),
    htmlEscape(record?.bill_to_name || '—'),
    addr ? htmlEscape(addr) : '',
    ...contactLines,
    opts?.withEmail && email ? htmlEscape(email) : ''
  ].filter((l) => l !== '');
  return `<div class="box" style="${alignStyle(opts?.clientBillingAddressPosition)}">${lines.join('<br>')}</div>`;
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
          const label = taxDisplayLabel(currencyCode, it.tax_label || '', rate);
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
            meal_plan: it.meal_plan || '',
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
      meal_plan: s.mealPlan || '',
      currency_code: s.currencyCode || currencyCode,
      pax: s.pax || paxCount,
      total_sell: round2((Number(s.sellPP) || 0) * paxCount),
      tax_rate: s.taxRate,
      tax_label: s.taxLabel,
      is_included: !s.isOptional
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

export const invoiceEmail = (invoice, lines, opts = {}) => {
  const cur = invoice.currency_code;
  const isProforma = invoice.status === 'proforma';
  const isFinal = invoice.invoice_type === 'final';
  const renderedLines = docLines(invoice, lines, opts);
  const depositPaidLine = isFinal && Number(invoice.credited_amount) > 0
    ? `Less deposit received (${invoice.credited_invoice_number || 'prior invoice'}): ${fmtMoney(invoice.credited_amount, cur)}`
    : `Less deposit received: ${fmtMoney(invoice.deposit_amount || 0, cur)}`;
  const body = [
    `${(isProforma ? 'PROFORMA — ' : '')}${TYPE_LABEL[invoice.invoice_type]?.toUpperCase() || 'INVOICE'} ${invoice.invoice_number}`,
    '',
    invoice.supplier_name || '',
    invoice.supplier_tax_number ? `${taxNoPrefix(cur)} ${invoice.supplier_tax_number}` : '',
    invoice.supplier_address || '',
    companyContactText(opts),
    '',
    `Bill To: ${invoice.bill_to_name || '—'}`,
    invoice.bill_to_address || '',
    `Issued: ${invoice.issued_date || '—'}${invoice.due_date ? `   Due: ${invoice.due_date}` : ''}`,
    '',
    ...(renderedLines || []).map((l) => `Day ${l.day_number}  ${l.item_name}${showMealPlanOn(l, opts) ? ` - ${abbrevMealPlan(l.meal_plan)}` : ''}  x${l.quantity}  ${fmtMoney(l.line_total, cur)}`),
    '',
    `Subtotal (Excl ${taxWordOf(cur)}): ${fmtMoney(invoice.subtotal_excl, cur)}`,
    `${taxRowLabel(cur, invoice.tax_label, invoice.tax_rate)}: ${fmtMoney(invoice.tax_total, cur)}`,
    `${totalDueLabel(invoice)}: ${fmtMoney(invoice.total_incl, cur)}`,
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

export const receiptEmail = (receipt, opts = {}) => {
  const cur = receipt.currency_code;
  const body = [
    `PAYMENT RECEIPT ${receipt.receipt_number}`,
    '',
    receipt.supplier_name || '',
    receipt.supplier_tax_number ? `${taxNoPrefix(receipt.currency_code)} ${receipt.supplier_tax_number}` : '',
    receipt.supplier_address || '',
    companyContactText(opts),
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

export const creditNoteEmail = (cn, opts = {}) => {
  const cur = cn.currency_code;
  const body = [
    `CREDIT NOTE ${cn.credit_note_number}`,
    '',
    cn.supplier_name || '',
    cn.supplier_tax_number ? `${taxNoPrefix(cur)} ${cn.supplier_tax_number}` : '',
    cn.supplier_address || '',
    companyContactText(opts),
    '',
    `Credited to: ${cn.bill_to_name || '—'}`,
    `Date: ${cn.issued_date || '—'}`,
    `Against invoice: ${cn.invoice_number}`,
    cn.reason ? `Reason: ${cn.reason}` : '',
    '',
    `Subtotal (Excl ${taxWordOf(cur)}): ${fmtMoney(cn.subtotal_excl, cur)}`,
    `${taxRowLabel(cur, cn.tax_label, cn.tax_rate)}: ${fmtMoney(cn.tax_total, cur)}`,
    `${totalCreditedLabel(cn)}: ${fmtMoney(cn.total_incl, cur)}`,
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
  const renderedLines = docLines(inv, lines, opts || {});
  const creditLine = isFinal && Number(inv.credited_amount) > 0
    ? `<tr class="grand"><td colspan="6" class="num">Less deposit received${inv.credited_invoice_number ? ` (${htmlEscape(inv.credited_invoice_number)})` : ''}</td><td class="num">-${fmtMoney(inv.credited_amount, sym)}</td></tr>`
    : '';
  const dueLine = isFinal
    ? `<b>BALANCE TO BE PAID:</b> ${fmtMoney(effectiveBalance(inv), sym)}${inv.status === 'paid' ? ' <span style="color:#047857">(PAID — account settled)</span>' : ''}`
    : `<b>Deposit requested (${Number(inv.deposit_percentage)}%):</b> ${fmtMoney(inv.deposit_amount, sym)}<br><b>Balance remaining after deposit:</b> ${fmtMoney(inv.balance_due, sym)}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(inv.invoice_number)}</title><style>${docStyles}</style></head><body>
    ${logoOf(opts)}
    <div style="${alignStyle(opts?.billingAddressPosition)}">
    <h1>${htmlEscape(inv.supplier_name || 'Invoice')}</h1>
    <p class="muted">${inv.supplier_tax_number ? `${taxNoPrefix(inv.currency_code)} ${htmlEscape(inv.supplier_tax_number)}` : ''}</p>
    <p class="muted">${htmlEscape(inv.supplier_address || '').replace(/\n/g, '<br>')}</p>
    ${companyContactHtml(opts) ? `<p class="muted">${companyContactHtml(opts)}</p>` : ''}
    </div>
    <hr/>
    <h2>${inv.status === 'proforma' ? 'PROFORMA — ' : ''}${htmlEscape(TYPE_LABEL[inv.invoice_type] || 'Invoice')} ${htmlEscape(inv.invoice_number)}</h2>
    <p class="muted">Issued: ${htmlEscape(inv.issued_date || '—')}${inv.due_date ? ` · Due: ${htmlEscape(inv.due_date)}` : ''} · Currency: ${htmlEscape(inv.currency_code)}${inv.status === 'paid' ? ' · PAID' : ''}</p>
      ${billToBoxOf(inv, { ...opts, withContact: true })}
    <table>
      <tr><th>Day</th><th>Description</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Subtotal (Excl ${taxWordOf(inv.currency_code)})</th><th class="num">${taxWordUpper(inv.currency_code)}</th><th class="num">Total</th></tr>
      ${renderedLines.map((l) => `<tr><td>${l.day_number}</td><td>${htmlEscape(l.item_name)}${showMealPlanOn(l, opts || {}) ? ` - ${htmlEscape(abbrevMealPlan(l.meal_plan))}` : ''}${showSupplierIn(l, opts || {}) ? `<br><span class="muted">${htmlEscape(l.supplier_name)}</span>` : ''}</td>${l.qty_text ? `<td title="${htmlEscape(l.qty_title || '')}">${htmlEscape(String(l.quantity))}</td>` : `<td class="num">${l.quantity}</td>`}<td class="num">${fmtMoney(l.unit_price, sym)}</td><td class="num">${fmtMoney(l.subtotal_excl, sym)}</td><td class="num">${fmtMoney(l.tax_amount, sym)}</td><td class="num">${fmtMoney(l.line_total, sym)}</td></tr>`).join('')}
      <tr class="grand"><td colspan="6" class="num">Subtotal (Excl ${taxWordOf(inv.currency_code)})</td><td class="num">${fmtMoney(inv.subtotal_excl, sym)}</td></tr>
      <tr class="grand"><td colspan="6" class="num">${htmlEscape(taxDisplayLabel(inv.currency_code, inv.tax_label, inv.tax_rate))} (${Number(inv.tax_rate)}%)</td><td class="num">${fmtMoney(inv.tax_total, sym)}</td></tr>
      <tr class="grand"><td colspan="6" class="num">${htmlEscape(totalDueLabel(inv))}</td><td class="num">${fmtMoney(inv.total_incl, sym)}</td></tr>
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
    <div style="${alignStyle(opts?.billingAddressPosition)}">
    <h1>${htmlEscape(r.supplier_name || 'Payment Receipt')}</h1>
    <p class="muted">${r.supplier_tax_number ? `${taxNoPrefix(r.currency_code)} ${htmlEscape(r.supplier_tax_number)}` : ''}</p>
    <p class="muted">${htmlEscape(r.supplier_address || '').replace(/\n/g, '<br>')}</p>
    ${companyContactHtml(opts) ? `<p class="muted">${companyContactHtml(opts)}</p>` : ''}
    </div>
    <hr/>
    <h2>PAYMENT RECEIPT ${htmlEscape(r.receipt_number)}</h2>
    <p class="muted">Date received: ${htmlEscape(r.received_date || '—')} · Currency: ${htmlEscape(r.currency_code)}</p>
      ${billToBoxOf(r, { ...opts, withEmail: true, withContact: true }, 'Received From')}
    <table>
      <tr><th>Invoice</th><th>Type</th><th>Method</th><th>Reference</th><th class="num">Amount Received</th><th class="num">Balance Remaining</th></tr>
      <tr><td>${htmlEscape(r.invoice_number)}</td><td>${htmlEscape(TYPE_LABEL[r.invoice_type] || r.invoice_type)}</td><td>${htmlEscape(r.payment_method || '—')}</td><td>${htmlEscape(r.payment_reference || '—')}</td><td class="num">${fmtMoney(r.amount, sym)}</td><td class="num">${fmtMoney(r.balance_remaining, sym)}</td></tr>
      <tr class="grand"><td colspan="4" class="num">TOTAL RECEIVED</td><td class="num">${fmtMoney(r.amount, sym)}</td><td class="num">${fmtMoney(r.balance_remaining, sym)}</td></tr>
    </table>
    <div class="box">Payment received with thanks${Number(r.balance_remaining) > 0 ? `<br><b>Outstanding balance:</b> ${fmtMoney(r.balance_remaining, sym)}` : '<br><b>Account settled in full.</b>'}</div>
    </body></html>`;

export const creditNoteDocHtml = (cn, sym, opts) => `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(cn.credit_note_number)}</title><style>${docStyles}</style></head><body>
    ${logoOf(opts)}
    <div style="${alignStyle(opts?.billingAddressPosition)}">
    <h1>${htmlEscape(cn.supplier_name || 'Credit Note')}</h1>
    <p class="muted">${cn.supplier_tax_number ? `${taxNoPrefix(cn.currency_code)} ${htmlEscape(cn.supplier_tax_number)}` : ''}</p>
    <p class="muted">${htmlEscape(cn.supplier_address || '').replace(/\n/g, '<br>')}</p>
    ${companyContactHtml(opts) ? `<p class="muted">${companyContactHtml(opts)}</p>` : ''}
    </div>
    <hr/>
    <h2>CREDIT NOTE ${htmlEscape(cn.credit_note_number)}</h2>
    <p class="muted">Date: ${htmlEscape(cn.issued_date || '—')} · Against invoice: ${htmlEscape(cn.invoice_number)} · Currency: ${htmlEscape(cn.currency_code)}</p>
      ${billToBoxOf(cn, { ...opts, withContact: true }, 'Credited To')}
    ${cn.reason ? `<p class="muted"><b>Reason:</b> ${htmlEscape(cn.reason)}</p>` : ''}
    <table>
      <tr><th>Description</th><th class="num">Amount</th></tr>
      <tr><td>Reversal of ${htmlEscape(TYPE_LABEL[cn.invoice_type] || 'Invoice')} ${htmlEscape(cn.invoice_number)} — Subtotal (Excl ${taxWordOf(cn.currency_code)})</td><td class="num">${fmtMoney(cn.subtotal_excl, sym)}</td></tr>
      <tr><td>${htmlEscape(taxRowLabel(cn.currency_code, cn.tax_label, cn.tax_rate))}</td><td class="num">${fmtMoney(cn.tax_total, sym)}</td></tr>
      <tr class="grand"><td>${htmlEscape(totalCreditedLabel(cn))}</td><td class="num">${fmtMoney(cn.total_incl, sym)}</td></tr>
    </table>
    <div class="box"><b>${fmtMoney(cn.total_incl, sym)} credited</b> to ${htmlEscape(cn.bill_to_name || 'the client')}. This credit note reverses the invoice in full and balances the account.</div>
    </body></html>`;

/* Genuine Excel workbook (HTML-table .xls), mirroring the itinerary export style. */
export const invoiceExcelHtml = (inv, lines, sym, opts = {}) => {
  const isFinal = inv.invoice_type === 'final';
  const renderedLines = docLines(inv, lines, opts);
  const rows = renderedLines.map((l) => `<tr><td>${l.day_number}</td><td>${htmlEscape(l.service_date || '')}</td><td>${htmlEscape(l.category || '')}</td><td>${htmlEscape(l.item_name)}${showMealPlanOn(l, opts) ? ` - ${htmlEscape(abbrevMealPlan(l.meal_plan))}` : ''}${showSupplierIn(l, opts) ? ` — ${htmlEscape(l.supplier_name)}` : ''}</td><td>${l.quantity}</td><td>${fmtMoney(l.unit_price, sym)}</td><td>${fmtMoney(l.subtotal_excl, sym)}</td><td>${fmtMoney(l.tax_amount, sym)}</td><td>${fmtMoney(l.line_total, sym)}</td></tr>`).join('');
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
      <tr><th>Day</th><th>Date</th><th>Category</th><th>Description</th><th>Qty</th><th class="num">Unit Price</th><th class="num">Subtotal (Excl ${taxWordOf(inv.currency_code)})</th><th class="num">${taxWordUpper(inv.currency_code)}</th><th class="num">Total</th></tr>
      ${rows}
      <tr class="grand"><td colspan="8" class="num">Subtotal (Excl ${taxWordOf(inv.currency_code)})</td><td class="num">${fmtMoney(inv.subtotal_excl, sym)}</td></tr>
      <tr class="grand"><td colspan="8" class="num">${htmlEscape(taxDisplayLabel(inv.currency_code, inv.tax_label, inv.tax_rate))} (${Number(inv.tax_rate)}%)</td><td class="num">${fmtMoney(inv.tax_total, sym)}</td></tr>
      <tr class="grand"><td colspan="8" class="num">${htmlEscape(totalDueLabel(inv))}</td><td class="num">${fmtMoney(inv.total_incl, sym)}</td></tr>
      ${credit}
      <tr class="grand"><td colspan="8" class="num">${isFinal ? 'BALANCE TO BE PAID' : 'BALANCE REMAINING AFTER DEPOSIT'}</td><td class="num">${fmtMoney(effectiveBalance(inv), sym)}</td></tr>
    </table>
  </body></html>`;
};
