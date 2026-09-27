import { useMemo, useState } from 'react';
import { AlertTriangle, Download, Landmark, Link2, RefreshCw, ScrollText } from 'lucide-react';
import { JournalEntryCard, CostOfSalesPanel } from './FinanceJournalViews';
import { buildGeneralLedger } from '../../lib/financeJournal';

const money = (n, symbol) => `${symbol || ''}${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PROVIDERS = [
  { id: 'xero', label: 'Xero' },
  { id: 'quickbooks', label: 'QuickBooks' },
  { id: 'sage', label: 'Sage' }
];

/* A booking is "committed" once the client is actually going away: the deposit
   is secured and the services are locked in. Everything before that is a quote. */
const COMMITTED_STATUSES = ['confirmed', 'in_progress', 'completed'];

/* ── Receipts across every itinerary ──────────────────────────────────────── */
export function ReceiptsPanel({ receipts, onViewReceipt }) {
  const [search, setSearch] = useState('');
  const rows = useMemo(() => {
    const t = search.trim().toLowerCase();
    const list = t
      ? receipts.filter((r) => `${r.receipt_number} ${r.invoice_number} ${r.bill_to_name} ${r.payment_reference}`.toLowerCase().includes(t))
      : receipts;
    return [...list].sort((a, b) => String(b.received_date || '').localeCompare(String(a.received_date || '')));
  }, [receipts, search]);
  /* Deliberately no grand total: receipts span currencies and summing ZAR with
     USD would produce a meaningless number. */

  return (
    <div className="admin-card" style={{ marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '1.1rem', margin: 0 }}>
          <Landmark size={17} color="#0d7478" /> Receipts
        </h2>
        <span style={{ marginLeft: 'auto', fontWeight: 800, color: '#15803d' }}>{rows.length} receipts</span>
      </div>
      <input
        className="sidebar-select"
        style={{ width: '100%', padding: '0.55rem 0.75rem', fontSize: '0.9rem', marginBottom: '0.9rem' }}
        placeholder="Search receipt, invoice, client or reference…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {rows.length === 0 ? (
        <div style={{ padding: '2rem 0', textAlign: 'center', color: '#94a3b8' }}>
          {search.trim() ? 'No receipts match your search.' : 'No receipts yet. Confirm a payment on an invoice to raise one.'}
        </div>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Receipt #</th><th>Invoice</th><th>Client</th><th>Received</th><th>Method</th>
              <th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 800 }}>{r.receipt_number}</td>
                <td>{r.invoice_number}</td>
                <td>{r.bill_to_name || '—'}</td>
                <td>{r.received_date || '—'}</td>
                <td>{r.payment_method || '—'}</td>
                <td style={{ textAlign: 'right', fontWeight: 800 }}>{money(r.amount, r.currency_code === 'ZAR' ? 'R' : '')} {r.currency_code}</td>
                <td style={{ textAlign: 'right' }}>
                  {onViewReceipt && (
                    <button type="button" className="icon-btn outline" title="View receipt" onClick={() => onViewReceipt(r)}>View</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ── Journal / general ledger across every itinerary ─────────────────────── */
export function JournalPanel({ entries, itineraries, onExport }) {
  const [sourceFilter, setSourceFilter] = useState('all');
  const [showLedger, setShowLedger] = useState(false);

  const itinName = useMemo(() => {
    const m = new Map();
    for (const i of itineraries || []) m.set(i.id, i.reference_number || i.reference || i.id.slice(0, 8));
    return (id) => m.get(id) || '—';
  }, [itineraries]);

  const filtered = useMemo(
    () => (sourceFilter === 'all' ? entries : entries.filter((e) => e.source_type === sourceFilter)),
    [entries, sourceFilter]
  );

  const totals = useMemo(() => {
    const byAcc = new Map();
    for (const e of filtered) {
      for (const l of e.lines || []) {
        const key = `${l.currency_code}|${l.account_code}`;
        if (!byAcc.has(key)) byAcc.set(key, { code: l.account_code, name: l.account_name, ccy: l.currency_code, debit: 0, credit: 0 });
        const a = byAcc.get(key);
        if (l.line_type === 'debit') a.debit += Number(l.amount) || 0; else a.credit += Number(l.amount) || 0;
      }
    }
    return [...byAcc.values()].map((a) => ({ ...a, debit: Math.round(a.debit * 100) / 100, credit: Math.round(a.credit * 100) / 100 }));
  }, [filtered]);

  const unbalanced = useMemo(() => filtered.filter((e) => Number(e.total_debit) !== Number(e.total_credit)), [filtered]);
  const ledger = useMemo(() => (showLedger ? buildGeneralLedger(filtered, filtered.flatMap((e) => (e.lines || []).map((l) => ({ ...l, id: l.id })))) : []), [showLedger, filtered]);

  return (
    <div className="admin-card" style={{ marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '1.1rem', margin: 0 }}>
          <ScrollText size={17} color="#0d7478" /> Journal
        </h2>
        <select className="sidebar-select" style={{ width: 'auto', marginLeft: '0.5rem' }} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          <option value="all">All sources</option>
          <option value="invoice">Invoices</option>
          <option value="receipt">Receipts</option>
          <option value="credit_note">Credit notes</option>
          <option value="cost_of_sales">Cost of sales</option>
        </select>
        <button type="button" className={`icon-btn outline ${showLedger ? 'active' : ''}`} title="Toggle general ledger view" onClick={() => setShowLedger((v) => !v)}>
          General ledger
        </button>
        {onExport && (
          <button type="button" className="secondary-btn" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }} onClick={onExport}>
            <Download size={14} /> Export for accounts
          </button>
        )}
      </div>

      {unbalanced.length > 0 && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '0.6rem 0.8rem', marginBottom: '1rem', color: '#b91c1c', fontSize: '0.82rem', fontWeight: 700 }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          {unbalanced.length} entr{unbalanced.length === 1 ? 'y' : 'ies'} out of balance. These should not exist — please report them.
        </div>
      )}

      {filtered.length === 0 ? (
        <div style={{ padding: '2rem 0', textAlign: 'center', color: '#94a3b8' }}>
          No journal entries yet. A journal is posted when an invoice is validated and when a payment is received.
        </div>
      ) : showLedger ? (
        <table className="admin-table">
          <thead>
            <tr><th>Date</th><th>Ref</th><th>Account</th><th>Itinerary</th><th style={{ textAlign: 'right' }}>Debit</th><th style={{ textAlign: 'right' }}>Credit</th><th style={{ textAlign: 'right' }}>Balance</th></tr>
          </thead>
          <tbody>
            {ledger.map((r, i) => (
              <tr key={`${r.entry_id}-${r.account_code}-${i}`}>
                <td>{r.entry_date}</td>
                <td style={{ fontWeight: 700 }}>{r.reference}</td>
                <td>{r.account_name} <span style={{ color: '#94a3b8' }}>{r.account_code}</span></td>
                <td>{itinName(r.itinerary_id)}</td>
                <td style={{ textAlign: 'right' }}>{r.debit ? money(r.debit) : ''}</td>
                <td style={{ textAlign: 'right' }}>{r.credit ? money(r.credit) : ''}</td>
                <td style={{ textAlign: 'right', fontWeight: 800 }}>{money(r.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          {filtered.map((e) => (
            <div key={e.id}>
              <div style={{ fontSize: '0.76rem', color: '#94a3b8', fontWeight: 700, marginBottom: '0.25rem' }}>
                {itinName(e.itinerary_id)} · {e.narration}
              </div>
              <JournalEntryCard entry={e} symbol={e.currency_code === 'ZAR' ? 'R' : ''} />
            </div>
          ))}
        </div>
      )}

      {totals.length > 0 && (
        <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#94a3b8', marginBottom: '0.5rem' }}>
            Account totals
          </div>
          <div style={{ display: 'grid', gap: '0.3rem' }}>
            {totals.map((a) => (
              <div key={`${a.ccy}-${a.code}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.82rem', padding: '0.25rem 0', borderBottom: '1px solid #f1f5f9' }}>
                <span style={{ fontWeight: 700, color: '#334155' }}>{a.name} <span style={{ color: '#94a3b8' }}>{a.code}</span></span>
                <span style={{ display: 'flex', gap: '1.25rem' }}>
                  <span style={{ color: '#64748b' }}>Dr {money(a.debit)}</span>
                  <span style={{ color: '#64748b' }}>Cr {money(a.credit)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Cost of sales across every itinerary ────────────────────────────────── */
export function TenantCostOfSalesPanel({ rows, itineraries, onPost }) {
  const [onlyLosses, setOnlyLosses] = useState(false);
  const [statusScope, setStatusScope] = useState('committed');
  const itinName = useMemo(() => {
    const m = new Map();
    for (const i of itineraries || []) m.set(i.id, { ref: i.reference_number || i.reference || i.id.slice(0, 8), client: i.client_name || '' });
    return (id) => m.get(id) || { ref: '—', client: '' };
  }, [itineraries]);

  const statusOf = useMemo(() => {
    const m = new Map();
    for (const i of itineraries || []) m.set(i.id, i.status);
    return (id) => m.get(id) || 'unknown';
  }, [itineraries]);

  /* Cost of sales is an ACCRUAL: recognising it means claiming the expense and
     the liability to suppliers. That is only true once the booking is actually
     committed — a quotation still being negotiated is not an obligation, and
     booking its cost would overstate expenses for trips that may never run.
     This is the one place a status gate is correct: it filters which costs get
     recognised, not which documents already exist. */
  const scoped = useMemo(
    () =>
      rows.filter((r) => {
        if (statusScope === 'all') return true;
        if (statusScope === 'committed') return COMMITTED_STATUSES.includes(statusOf(r.itinerary_id));
        return statusOf(r.itinerary_id) === statusScope;
      }),
    [rows, statusScope, statusOf]
  );
  const shown = useMemo(() => (onlyLosses ? scoped.filter((r) => !r.profitable) : scoped), [scoped, onlyLosses]);
  const summary = useMemo(() => {
    const profit = scoped.filter((r) => r.profitable).length;
    return { total: scoped.length, profit, loss: scoped.length - profit, hidden: rows.length - scoped.length };
  }, [scoped, rows]);

  return (
    <div className="admin-card" style={{ marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Cost of sales</h2>
        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
          {summary.total} priced · <strong style={{ color: '#15803d' }}>{summary.profit} profitable</strong> ·{' '}
          <strong style={{ color: '#b91c1c' }}>{summary.loss} at a loss</strong>
        </span>
        <select
          className="sidebar-select"
          style={{ width: 'auto', marginLeft: 'auto' }}
          value={statusScope}
          onChange={(e) => setStatusScope(e.target.value)}
          title="Which booking stages count as committed"
        >
          <option value="committed">Committed (confirmed + in progress)</option>
          <option value="all">All itineraries</option>
          <option value="confirmed">Confirmed only</option>
          <option value="in_progress">In progress only</option>
          <option value="completed">Completed only</option>
          <option value="provisional">Provisional only</option>
          <option value="quotation">Quotation only</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>
          <input type="checkbox" checked={onlyLosses} onChange={(e) => setOnlyLosses(e.target.checked)} /> Loss-making only
        </label>
      </div>
      <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0 0 1rem', maxWidth: '760px' }}>
        Contracted supplier cost against the net sale for every itinerary, per currency. The net sale excludes
        tax, because tax collected is payable to SARS rather than kept as margin. Only committed bookings
        count by default — recognising cost for a quotation still being negotiated would overstate expenses.
        {summary.hidden > 0 && <> <strong>{summary.hidden}</strong> uncommitted itinerar{summary.hidden === 1 ? 'y is' : 'ies are'} hidden.</>}
      </p>

      {shown.length === 0 ? (
        <div style={{ padding: '2rem 0', textAlign: 'center', color: '#94a3b8' }}>
          {rows.length === 0
            ? 'No priced services yet. Price services on an itinerary to see profitability.'
            : onlyLosses && scoped.length > 0
              ? 'No loss-making itineraries in this selection — everything is profitable.'
              : 'No itineraries match this status filter. Try “All itineraries”.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {shown.map((r) => {
            const info = itinName(r.itinerary_id);
            const postable = COMMITTED_STATUSES.includes(statusOf(r.itinerary_id));
            return (
              <div key={`${r.itinerary_id}-${r.code}`} style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', border: `1px solid ${r.profitable ? '#bbf7d0' : '#fecaca'}`, background: r.profitable ? '#f0fdf4' : '#fef2f2', borderRadius: '12px', padding: '0.6rem 0.85rem' }}>
                <div style={{ minWidth: '11rem' }}>
                  <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#1a202c' }}>{info.ref}</div>
                  {info.client && <div style={{ fontSize: '0.76rem', color: '#64748b' }}>{info.client}</div>}
                </div>
                <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#94a3b8' }}>{r.code}</span>
                <span style={{ fontSize: '0.8rem', color: '#334155' }}>Net {money(r.netSale)}</span>
                <span style={{ fontSize: '0.8rem', color: '#334155' }}>Cost {money(r.cost)}</span>
                <span style={{ marginLeft: 'auto', fontSize: '1rem', fontWeight: 900, color: r.profitable ? '#15803d' : '#b91c1c' }}>
                  {r.profit >= 0 ? '+' : ''}{money(r.profit)}{r.margin === null ? '' : ` (${r.margin.toFixed(1)}%)`}
                </span>
                {onPost && (
                  <button
                    type="button"
                    className="icon-btn outline"
                    disabled={!postable}
                    title={postable ? 'Post cost of sales to the journal' : 'Only committed bookings can have cost of sales recognised'}
                    onClick={() => onPost(r)}
                  >
                    Post
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Accounting connections ──────────────────────────────────────────────── */
export function AccountingPanel({ connections, onSetMode, onPush, onSync, busyProvider }) {
  const conns = useMemo(() => {
    const m = new Map((connections || []).map((c) => [c.provider, c]));
    return PROVIDERS.map((p) => ({ ...p, conn: m.get(p.id) || null }));
  }, [connections]);

  return (
    <div className="admin-card" style={{ marginTop: '1.5rem' }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '1.1rem', margin: '0 0 0.5rem' }}>
        <Link2 size={17} color="#0d7478" /> Accounting
      </h2>
      <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0 0 1.25rem', maxWidth: '780px' }}>
        Connect your accounting package to the Finance ledger. <strong>Push</strong> exports a file your
        accounts team imports. <strong>Live</strong> needs a server-side OAuth integration — the browser cannot
        hold provider credentials, so that mode is stored but not yet wired.
      </p>

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {conns.map(({ id, label, conn }) => (
          <div key={id} style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.85rem 1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: '0.95rem', color: '#1a202c' }}>{label}</strong>
              <span style={{ background: conn?.status === 'connected' ? '#f0fdf4' : '#f1f5f9', color: conn?.status === 'connected' ? '#15803d' : '#475569', fontSize: '0.7rem', fontWeight: 800, padding: '0.15rem 0.5rem', borderRadius: '999px' }}>
                {conn?.status === 'connected' ? 'Connected' : 'Not connected'}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: '0.76rem', color: '#94a3b8' }}>
                {conn?.last_sync_at ? `Last sync ${new Date(conn.last_sync_at).toLocaleString('en-ZA')}` : 'Never synced'}
              </span>
            </div>

            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.75rem' }}>
              <select className="sidebar-select" style={{ width: 'auto' }} value={conn?.mode || 'push'} onChange={(e) => onSetMode?.(id, e.target.value)}>
                <option value="push">Push (export a file)</option>
                <option value="live">Live (two-way API sync)</option>
              </select>
              <button type="button" className="primary-btn" disabled={busyProvider === id} onClick={() => onPush?.(id)}>
                <Download size={14} /> Push ledger
              </button>
              <button type="button" className="secondary-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }} disabled={busyProvider === id} onClick={() => onSync?.(id)}>
                <RefreshCw size={14} /> Sync now
              </button>
            </div>
            {conn?.last_error && (
              <div style={{ fontSize: '0.78rem', color: '#b91c1c', marginTop: '0.5rem', fontWeight: 700 }}>{conn.last_error}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
