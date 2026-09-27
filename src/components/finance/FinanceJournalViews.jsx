import { BookOpen, ChevronDown, ChevronRight, FileText, Landmark, TrendingDown, TrendingUp } from 'lucide-react';
import { computeCostOfSales } from '../../lib/financeJournal';

const money = (n, symbol) => `${symbol || ''}${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_STYLE = {
  proforma: { bg: '#f1f5f9', fg: '#475569', label: 'Proforma' },
  validated: { bg: '#eff6ff', fg: '#1d4ed8', label: 'Validated' },
  paid: { bg: '#f0fdf4', fg: '#15803d', label: 'Paid' },
  void: { bg: '#fef2f2', fg: '#b91c1c', label: 'Void' }
};

const SOURCE_LABEL = {
  invoice: 'Invoice',
  receipt: 'Receipt',
  credit_note: 'Credit note',
  cost_of_sales: 'Cost of sales',
  manual: 'Manual'
};

/* One journal entry: every line on its own side of the entry, with the two
   totals side by side so an imbalance would be visible at a glance rather than
   something the reader has to add up. */
export function JournalEntryCard({ entry, symbol }) {
  const lines = entry.lines || [];
  const isBalanced = Number(entry.total_debit || 0) === Number(entry.total_credit || 0);
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', background: '#fff', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', padding: '0.5rem 0.75rem', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', fontWeight: 800, color: '#334155' }}>
          <BookOpen size={13} />
          {entry.reference || 'Entry'}
          <span style={{ fontWeight: 600, color: '#94a3b8' }}>· {SOURCE_LABEL[entry.source_type] || entry.source_type}</span>
        </span>
        <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700 }}>{entry.entry_date}</span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
        <thead>
          <tr style={{ color: '#94a3b8', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            <th style={{ textAlign: 'left', padding: '0.4rem 0.75rem', fontWeight: 800 }}>Account</th>
            <th style={{ textAlign: 'right', padding: '0.4rem 0.75rem', fontWeight: 800, width: '9.5rem' }}>Debit</th>
            <th style={{ textAlign: 'right', padding: '0.4rem 0.75rem', fontWeight: 800, width: '9.5rem' }}>Credit</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} style={{ borderTop: '1px solid #f1f5f9' }}>
              <td style={{ padding: '0.45rem 0.75rem' }}>
                <span style={{ fontWeight: 800, color: '#1e293b' }}>{l.account_name}</span>
                <span style={{ color: '#94a3b8', fontSize: '0.72rem', marginLeft: '0.4rem' }}>{l.account_code}</span>
                {l.description && (
                  <div style={{ color: '#64748b', fontSize: '0.74rem' }}>{l.description}</div>
                )}
              </td>
              <td style={{ padding: '0.45rem 0.75rem', textAlign: 'right', fontWeight: 700, color: l.line_type === 'debit' ? '#0f172a' : '#cbd5e1' }}>
                {l.line_type === 'debit' ? money(l.amount, symbol) : ''}
              </td>
              <td style={{ padding: '0.45rem 0.75rem', textAlign: 'right', fontWeight: 700, color: l.line_type === 'credit' ? '#0f172a' : '#cbd5e1' }}>
                {l.line_type === 'credit' ? money(l.amount, symbol) : ''}
              </td>
            </tr>
          ))}
          <tr style={{ borderTop: '2px solid #e2e8f0', background: '#f8fafc' }}>
            <td style={{ padding: '0.5rem 0.75rem', fontWeight: 800, color: isBalanced ? '#15803d' : '#b91c1c', fontSize: '0.76rem' }}>
              {isBalanced ? 'Balanced' : 'OUT OF BALANCE'}
            </td>
            <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 900, color: '#0f172a' }}>{money(entry.total_debit, symbol)}</td>
            <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontWeight: 900, color: '#0f172a' }}>{money(entry.total_credit, symbol)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* An invoice, with the journal it posted and the receipts raised against it.
   Receipts sit under their invoice rather than in a separate list so the
   invoice → journal → receipt chain reads as one record. */
export function InvoiceFinanceRow({ invoice, entries, receipts, symbol, open, onToggle, onViewReceipt }) {
  const badge = STATUS_STYLE[invoice.status] || { bg: '#f1f5f9', fg: '#475569', label: invoice.status };
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: '14px', background: '#fff', marginBottom: '0.6rem', overflow: 'hidden' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%', padding: '0.75rem 0.9rem', background: open ? '#f8fafc' : '#fff', border: 'none', cursor: 'pointer', textAlign: 'left', font: 'inherit', flexWrap: 'wrap' }}
      >
        {open ? <ChevronDown size={16} style={{ color: '#64748b' }} /> : <ChevronRight size={16} style={{ color: '#64748b' }} />}
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <FileText size={15} style={{ color: '#0d7478' }} />
          <strong style={{ fontSize: '0.9rem', color: '#1a202c' }}>{invoice.invoice_number}</strong>
        </span>
        <span style={{ fontSize: '0.74rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.03em', color: '#94a3b8' }}>
          {invoice.invoice_type}
        </span>
        <span style={{ background: badge.bg, color: badge.fg, fontSize: '0.7rem', fontWeight: 800, padding: '0.15rem 0.5rem', borderRadius: '999px' }}>
          {badge.label}
        </span>
        <span style={{ marginLeft: 'auto', fontWeight: 900, fontSize: '0.95rem', color: '#1a202c' }}>
          {money(invoice.total_incl, symbol)}
        </span>
      </button>

      {open && (
        <div style={{ padding: '0.9rem', borderTop: '1px solid #e2e8f0', display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.8rem', color: '#334155' }}>
            <span>Net: <strong>{money(invoice.subtotal_excl, symbol)}</strong></span>
            {Number(invoice.tax_total) > 0 && (
              <span>{invoice.tax_label || 'Tax'}: <strong>{money(invoice.tax_total, symbol)}</strong></span>
            )}
            <span>Balance due: <strong>{money(invoice.balance_due, symbol)}</strong></span>
          </div>

          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94a3b8', marginBottom: '0.4rem' }}>
              Journal
            </div>
            {entries.length === 0 ? (
              <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0 }}>
                No journal yet — a proforma deposit is recognised once it is validated or paid.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                {entries.map((e) => <JournalEntryCard key={e.id} entry={e} symbol={symbol} />)}
              </div>
            )}
          </div>

          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94a3b8', marginBottom: '0.4rem' }}>
              Receipts
            </div>
            {receipts.length === 0 ? (
              <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0 }}>No payments received against this invoice yet.</p>
            ) : (
              <div style={{ display: 'grid', gap: '0.3rem' }}>
                {receipts.map((r) => (
                  <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', fontSize: '0.82rem', color: '#334155', padding: '0.3rem 0', borderBottom: '1px solid #f1f5f9' }}>
                    <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <Landmark size={13} style={{ color: '#0d7478' }} />
                      {r.receipt_number} · {r.received_date || '—'} · {r.payment_method || 'payment'}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <strong style={{ fontWeight: 800 }}>{money(r.amount, symbol)}</strong>
                      {onViewReceipt && (
                        <button type="button" onClick={() => onViewReceipt(r)} style={{ background: 'none', border: 'none', padding: 0, color: '#0d7478', fontWeight: 800, cursor: 'pointer', textDecoration: 'underline', font: 'inherit', fontSize: '0.78rem' }}>
                          View
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* Per-itinerary profitability: contracted supplier cost against the net sale.
   Net deliberately EXCLUDES tax — tax collected is payable to SARS, not the
   agency's margin, so including it would overstate profit on every invoice. */
export function CostOfSalesPanel({ groups }) {
  const rows = computeCostOfSales(groups);
  if (rows.length === 0) {
    return (
      <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: 0 }}>
        No services priced yet — add services on the Itinerary tab to see profitability.
      </p>
    );
  }
  return (
    <div style={{ display: 'grid', gap: '0.6rem' }}>
      {rows.map((g) => {
        const { profitable } = g;
        return (
          <div key={g.code} style={{ border: '1px solid #e2e8f0', borderRadius: '14px', padding: '0.85rem 1rem', background: profitable ? '#f0fdf4' : '#fef2f2', borderColor: profitable ? '#bbf7d0' : '#fecaca' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#475569' }}>
                {g.name || g.code} {g.symbol ? `(${g.symbol})` : ''}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '1.1rem', fontWeight: 900, color: profitable ? '#15803d' : '#b91c1c' }}>
                {profitable ? <TrendingUp size={17} /> : <TrendingDown size={17} />}
                {g.symbol}{g.profit.toFixed(2)}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginTop: '0.4rem', fontSize: '0.8rem', color: '#334155' }}>
              <span>Net sale: <strong>{g.symbol}{g.netSale.toFixed(2)}</strong></span>
              <span>Contracted cost: <strong>{g.symbol}{g.cost.toFixed(2)}</strong></span>
              <span style={{ fontWeight: 800, color: profitable ? '#15803d' : '#b91c1c' }}>
                {profitable ? 'Profit' : 'Loss'}{g.margin === null ? '' : ` · ${g.margin.toFixed(1)}%`}
              </span>
            </div>
            {g.tax > 0 && (
              <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.25rem' }}>
                Tax of {g.symbol}{g.tax.toFixed(2)} is excluded from the net sale.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
