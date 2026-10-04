import { useMemo, useState } from 'react';
import SearchableSelect from '../SearchableSelect';
import { AlertTriangle, Download, Landmark, Link2, RefreshCw, ScrollText } from 'lucide-react';
import { JournalEntryCard, CostOfSalesPanel } from './FinanceJournalViews';
import { buildGeneralLedger, COST_OF_SALES_STATUSES } from '../../lib/financeJournal';

const money = (n, symbol) => `${symbol || ''}${Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PROVIDERS = [
  { id: 'xero', label: 'Xero' },
  { id: 'quickbooks', label: 'QuickBooks' },
  { id: 'sage', label: 'Sage' }
];

/* A booking is "committed" once the client is actually going away: the deposit
   is secured and the services are locked in. Everything before that is a quote. */
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

/* ── Journal / general ledger, scoped to selected itineraries ────────────── */
export function JournalPanel({
  entries,
  itineraries,
  onExport,
  onLoadStatus,
  onSearchReference,
  loading = false,
  error = ''
}) {
  const [sourceFilter, setSourceFilter] = useState('all');
  const [showLedger, setShowLedger] = useState(false);
  const [statusScope, setStatusScope] = useState('');
  const [referenceSearch, setReferenceSearch] = useState('');
  const [searchSubmitted, setSearchSubmitted] = useState(false);

  const itinName = useMemo(() => {
    const m = new Map();
    for (const i of itineraries || []) m.set(i.id, i.reference_number || i.id.slice(0, 8));
    return (id) => m.get(id) || '—';
  }, [itineraries]);

  const filtered = useMemo(
    () => (sourceFilter === 'all' ? entries : entries.filter((e) => e.source_type === sourceFilter)),
    [entries, sourceFilter]
  );
  const searchByReference = (event) => {
    event.preventDefault();
    const reference = referenceSearch.trim();
    if (!reference || loading) return;
    setStatusScope('');
    setSearchSubmitted(true);
    onSearchReference?.(reference);
  };
  const selectStatus = (event) => {
    const status = event.target.value;
    setStatusScope(status);
    setReferenceSearch('');
    setSearchSubmitted(false);
    if (status) onLoadStatus?.(status);
  };

  const totals = useMemo(() => {
    const byAcc = new Map();
    for (const e of filtered) {
      const currencyCode = String(e.currency_code || 'ZAR').toUpperCase();
      for (const l of e.lines || []) {
        const key = `${currencyCode}|${l.account_code}`;
        if (!byAcc.has(key)) byAcc.set(key, { code: l.account_code, name: l.account_name, ccy: currencyCode, debit: 0, credit: 0 });
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
        <SearchableSelect className="sidebar-select" style={{ width: 'auto', marginLeft: '0.5rem' }} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          <option value="all">All sources</option>
          <option value="invoice">Invoices</option>
          <option value="receipt">Receipts</option>
          <option value="credit_note">Credit notes</option>
          <option value="cost_of_sales">Cost of sales</option>
        </SearchableSelect>
        <SearchableSelect
          className="sidebar-select"
          style={{ width: 'auto' }}
          value={statusScope}
          onChange={selectStatus}
          disabled={loading}
          title="Load journal entries for one itinerary stage"
        >
          <option value="">Select a booking status...</option>
          <option value="confirmed">Confirmed only</option>
          <option value="in_progress">In progress only</option>
          <option value="completed">Completed only</option>
        </SearchableSelect>
        <form onSubmit={searchByReference} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <input
            type="search"
            className="sidebar-select"
            aria-label="Exact itinerary reference"
            placeholder="Exact itinerary reference"
            value={referenceSearch}
            disabled={loading}
            onChange={(event) => setReferenceSearch(event.target.value)}
            style={{ width: '13rem', margin: 0 }}
          />
          <button type="submit" className="icon-btn outline" disabled={loading || !referenceSearch.trim()}>
            Search
          </button>
        </form>
        <button type="button" className={`icon-btn outline ${showLedger ? 'active' : ''}`} title="Toggle general ledger view" onClick={() => setShowLedger((v) => !v)}>
          General ledger
        </button>
        {onExport && (
          <button type="button" className="secondary-btn" title="Exports the full company journal, regardless of the current view filter" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }} onClick={onExport}>
            <Download size={14} /> Export full ledger
          </button>
        )}
      </div>

      {error && (
        <div role="alert" style={{ marginBottom: '0.85rem', padding: '0.65rem 0.8rem', borderRadius: '9px', border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', fontSize: '0.82rem', fontWeight: 700 }}>
          Journal entries could not be loaded: {error}
        </div>
      )}

      {!loading && !error && unbalanced.length > 0 && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '0.6rem 0.8rem', marginBottom: '1rem', color: '#b91c1c', fontSize: '0.82rem', fontWeight: 700 }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          {unbalanced.length} entr{unbalanced.length === 1 ? 'y' : 'ies'} out of balance. These should not exist — please report them.
        </div>
      )}

      {error ? (
        <div style={{ padding: '1rem 0', color: '#64748b', fontSize: '0.85rem' }}>
          Fix the data access issue above and try again.
        </div>
      ) : loading ? (
        <div role="status" style={{ padding: '2rem 0', textAlign: 'center', color: '#64748b' }}>
          Loading journal entries...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '2rem 0', textAlign: 'center', color: '#94a3b8' }}>
          {!statusScope && !searchSubmitted
            ? 'Select a booking status or enter an exact itinerary reference to view its journal.'
            : searchSubmitted && itineraries.length === 0
              ? 'No itinerary matches that exact reference.'
              : statusScope && itineraries.length === 0
                ? 'No itineraries match this booking status.'
              : entries.length > 0
                ? 'No journal entries match this source filter.'
                : 'No journal entries have been posted for this selection yet.'}
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
                <span style={{ fontWeight: 700, color: '#334155' }}>
                  {a.name} <span style={{ color: '#94a3b8' }}>{a.code}</span>
                  <span style={{ marginLeft: '0.4rem', color: '#64748b', fontWeight: 600 }}>{a.ccy}</span>
                </span>
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
export function TenantCostOfSalesPanel({
  rows,
  itineraries,
  onPost,
  onLoadStatus,
  onSearchReference,
  loading = false,
  error = ''
}) {
  const [onlyLosses, setOnlyLosses] = useState(false);
  const [statusScope, setStatusScope] = useState('');
  const [referenceSearch, setReferenceSearch] = useState('');
  const [searchSubmitted, setSearchSubmitted] = useState(false);
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const itinName = useMemo(() => {
    const m = new Map();
    for (const i of itineraries || []) m.set(i.id, { ref: i.reference_number || i.id.slice(0, 8), client: i.client_name || '' });
    return (id) => m.get(id) || { ref: '—', client: '' };
  }, [itineraries]);

  const statusOf = useMemo(() => {
    const m = new Map();
    for (const i of itineraries || []) m.set(i.id, i.status);
    return (id) => m.get(id) || 'unknown';
  }, [itineraries]);

  /* Only committed itineraries are eligible for cost-of-sales reporting. */
  const scoped = useMemo(
    () =>
    rows.filter((r) => {
      if (!COST_OF_SALES_STATUSES.includes(statusOf(r.itinerary_id))) return false;
      if (!statusScope) return true;
      return statusOf(r.itinerary_id) === statusScope;
    }),
    [rows, statusScope, statusOf]
  );
  const shown = useMemo(() => (onlyLosses ? scoped.filter((r) => !r.profitable) : scoped), [scoped, onlyLosses]);
  const summary = useMemo(() => {
    const profit = scoped.filter((r) => r.profitable).length;
    return { total: scoped.length, profit, loss: scoped.length - profit, hidden: rows.length - scoped.length };
  }, [scoped, rows]);
  const searchByReference = (event) => {
    event.preventDefault();
    const reference = referenceSearch.trim();
    if (!reference || loading) return;
    setStatusScope('');
    setSearchSubmitted(true);
    setExpandedRows(new Set());
    onSearchReference?.(reference);
  };
  const selectStatus = (event) => {
    const status = event.target.value;
    setStatusScope(status);
    setReferenceSearch('');
    setSearchSubmitted(false);
    setExpandedRows(new Set());
    if (status) onLoadStatus?.(status);
  };
  const toggleExpanded = (key) => {
    setExpandedRows((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="admin-card" style={{ marginTop: '1.5rem' }}>
      {error && (
        <div role="alert" style={{ marginBottom: '0.85rem', padding: '0.65rem 0.8rem', borderRadius: '9px', border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', fontSize: '0.82rem', fontWeight: 700 }}>
          Cost of sales could not be loaded: {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Cost of sales</h2>
        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
          {summary.total} priced · <strong style={{ color: '#15803d' }}>{summary.profit} profitable</strong> ·{' '}
          <strong style={{ color: '#b91c1c' }}>{summary.loss} at a loss</strong>
        </span>
        <SearchableSelect
          className="sidebar-select"
          style={{ width: 'auto', marginLeft: 'auto' }}
          value={statusScope}
          onChange={selectStatus}
          disabled={loading}
          title="Load cost of sales for one itinerary stage"
        >
          <option value="">Select a booking status...</option>
          <option value="confirmed">Confirmed only</option>
          <option value="in_progress">In progress only</option>
          <option value="completed">Completed only</option>
        </SearchableSelect>
        <form onSubmit={searchByReference} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <input
            type="search"
            className="sidebar-select"
            aria-label="Exact itinerary reference"
            placeholder="Exact itinerary reference"
            value={referenceSearch}
            disabled={loading}
            onChange={(event) => setReferenceSearch(event.target.value)}
            style={{ width: '13rem', margin: 0 }}
          />
          <button type="submit" className="icon-btn outline" disabled={loading || !referenceSearch.trim()}>
            Search
          </button>
        </form>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>
          <input type="checkbox" checked={onlyLosses} onChange={(e) => setOnlyLosses(e.target.checked)} /> Loss-making only
        </label>
      </div>
      <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0 0 1rem', maxWidth: '760px' }}>
        Contracted supplier cost against the net sale, shown separately for each confirmed, in-progress, or
        completed itinerary and currency. The net sale excludes tax, because tax collected is payable to SARS
        rather than kept as margin.
      </p>

      {error ? (
        <div style={{ padding: '1rem 0', color: '#64748b', fontSize: '0.85rem' }}>
          Fix the data access issue above and refresh Finance to view itinerary costs.
        </div>
      ) : loading ? (
        <div role="status" style={{ padding: '2rem 0', textAlign: 'center', color: '#64748b' }}>
          Loading cost-of-sales data...
        </div>
      ) : shown.length === 0 ? (
        <div style={{ padding: '2rem 0', textAlign: 'center', color: '#94a3b8' }}>
          {!statusScope && !searchSubmitted
            ? 'Select a booking status or enter an exact itinerary reference to view cost of sales.'
            : searchSubmitted && itineraries.length === 0
              ? 'No confirmed, in-progress, or completed itinerary matches that exact reference.'
            : rows.length === 0
            ? 'No priced services found for this selection.'
            : onlyLosses && scoped.length > 0
              ? 'No loss-making itinerary currencies in this selection — everything is profitable.'
              : 'No itinerary cost-of-sales rows match this selection.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {shown.map((r) => {
            const info = itinName(r.itinerary_id);
            const postable = COST_OF_SALES_STATUSES.includes(statusOf(r.itinerary_id));
            const rowKey = `${r.itinerary_id}-${r.code}`;
            const expanded = expandedRows.has(rowKey);
            return (
              <div key={rowKey} style={{ border: `1px solid ${r.profitable ? '#bbf7d0' : '#fecaca'}`, background: r.profitable ? '#f0fdf4' : '#fef2f2', borderRadius: '12px', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', padding: '0.6rem 0.85rem' }}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => toggleExpanded(rowKey)}
                    style={{ display: 'flex', alignItems: 'center', flex: '1 1 36rem', gap: '1rem', flexWrap: 'wrap', border: 0, padding: 0, background: 'transparent', textAlign: 'left', cursor: 'pointer', color: 'inherit' }}
                    title={expanded ? 'Hide contracted items' : 'Show contracted items'}
                  >
                    <span style={{ minWidth: '11rem' }}>
                      <span style={{ display: 'block', fontWeight: 800, fontSize: '0.88rem', color: '#1a202c' }}>{info.ref}</span>
                      {info.client && <span style={{ display: 'block', fontSize: '0.76rem', color: '#64748b' }}>{info.client}</span>}
                    </span>
                    <span style={{ fontSize: '0.74rem', fontWeight: 800, color: '#94a3b8' }}>{r.code}</span>
                    <span style={{ fontSize: '0.8rem', color: '#334155' }}>Net {money(r.netSale)}</span>
                    <span style={{ fontSize: '0.8rem', color: '#334155' }}>Cost {money(r.cost)}</span>
                    <span style={{ marginLeft: 'auto', fontSize: '1rem', fontWeight: 900, color: r.profitable ? '#15803d' : '#b91c1c' }}>
                      {r.profit >= 0 ? '+' : ''}{money(r.profit)}{r.margin === null ? '' : ` (${r.margin.toFixed(1)}%)`}
                    </span>
                  </button>
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
                {expanded && (
                  <div style={{ overflowX: 'auto', padding: '0 0.85rem 0.75rem' }}>
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Contracted item</th>
                          <th>Supplier</th>
                          <th className="num">Total buy</th>
                          <th className="num">Total sell (incl. tax)</th>
                          <th className="num">Net sale</th>
                          <th className="num">Profit / (loss)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(r.items || []).map((item) => (
                          <tr key={`${rowKey}-${item.id}`}>
                            <td>
                              <strong>{item.name}</strong>
                              {item.category && <div style={{ color: '#64748b', fontSize: '0.75rem' }}>{item.category}</div>}
                            </td>
                            <td>{item.supplier || '—'}</td>
                            <td className="num">{money(item.cost)}</td>
                            <td className="num">{money(item.grossSale)}</td>
                            <td className="num">{money(item.netSale)}</td>
                            <td className="num" style={{ fontWeight: 800, color: item.profitable ? '#15803d' : '#b91c1c' }}>
                              {item.profit >= 0 ? '+' : ''}{money(item.profit)}
                            </td>
                          </tr>
                        ))}
                        {!r.items?.length && (
                          <tr><td colSpan="6" style={{ color: '#64748b' }}>No contracted item details were returned.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
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
              <SearchableSelect className="sidebar-select" style={{ width: 'auto' }} value={conn?.mode || 'push'} onChange={(e) => onSetMode?.(id, e.target.value)}>
                <option value="push">Push (export a file)</option>
                <option value="live">Live (two-way API sync)</option>
              </SearchableSelect>
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
