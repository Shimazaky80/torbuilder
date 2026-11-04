import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, getLoggedInUserName } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { useCurrencies } from '../hooks/useCurrencies';
import { round2 } from '../lib/financeJournal';
import { fmtMoney, effectiveBalance } from '../lib/invoiceDoc';
import { receiptDirection } from '../lib/settlement';
import {
  LayoutDashboard,
  RefreshCw,
  FileText,
  CalendarDays,
  Users,
  UsersRound,
  Building2,
  Package,
  Briefcase,
  Clock,
  ArrowRight,
  Ticket,
  HandCoins,
  UserRound
} from 'lucide-react';

/* ─── Date helpers ───────────────────────────────────────────────────────────
   Every window here is compared against a `date` column, which PostgREST hands
   back as a bare 'YYYY-MM-DD'. Built from local parts, never toISOString(), so
   a tenant west of UTC does not lose the first day of its own month. */

const isoDay = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const dayValue = (raw) => (raw ? String(raw).slice(0, 10) : '');

const inWindow = (raw, from, to) => {
  const v = dayValue(raw);
  return !!v && v >= from && v <= to;
};

const addDays = (d, n) => {
  const copy = new Date(d.getTime());
  copy.setDate(copy.getDate() + n);
  return copy;
};

const toDisplay = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = dayValue(iso).split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
};

/* ─── Booking status ─────────────────────────────────────────────────────────
   The column is CHECK-constrained to these values, so a straight comparison is
   enough. `pending_confirmation` is the same stage as a quotation and wears the
   same badge, because the CSS only knows the canonical set. */

const STATUS_LABELS = {
  quotation: 'Quotation',
  pending_confirmation: 'Pending confirmation',
  provisional: 'Provisional',
  confirmed: 'Confirmed',
  in_progress: 'In Progress',
  cancelled: 'Cancelled',
  completed: 'Completed'
};

const BADGE_MOD = { pending_confirmation: 'quotation' };

const OPEN_QUOTE_STATUSES = ['quotation', 'pending_confirmation'];
const LIVE_BOOKING_STATUSES = ['provisional', 'confirmed', 'in_progress'];
/* Everything still ahead of the client: not called off, not already delivered. */
const FORTHCOMING_STATUSES = ['quotation', 'pending_confirmation', 'provisional', 'confirmed', 'in_progress'];

const paxOf = (it) => {
  const listed = Array.isArray(it.travellers) ? it.travellers.length : 0;
  return listed || (Number(it.num_adults) || 0) + (Number(it.num_children) || 0);
};

const leadTraveller = (travellers) => {
  if (!Array.isArray(travellers) || !travellers.length) return '';
  const t = travellers[0];
  return [t.name, t.surname].filter(Boolean).join(' ');
};

/* ─── Money ──────────────────────────────────────────────────────────────────
   Totals are never added across currencies. Each figure stays keyed by its own
   code and is rendered as one line per code, so a tenant billing in ZAR and USD
   sees both and neither is a lie. */

const sumByCurrency = (rows, valueOf) => {
  const totals = new Map();
  for (const row of rows) {
    const ccy = String(row.currency_code || '').toUpperCase() || 'ZAR';
    const amount = Number(valueOf(row)) || 0;
    totals.set(ccy, round2((totals.get(ccy) || 0) + amount));
  }
  return totals;
};

const moneyRows = (totals) =>
  [...totals.entries()]
    .filter(([, v]) => Math.abs(round2(v)) > 0.004)
    .sort((a, b) => a[0].localeCompare(b[0]));

const MoneyCell = ({ totals, symOf }) => {
  const rows = moneyRows(totals);
  if (!rows.length) return <span style={{ color: '#94a3b8' }}>—</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
      {rows.map(([ccy, value]) => (
        <span key={ccy} style={{ fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap' }}>
          {fmtMoney(value, symOf(ccy))}
        </span>
      ))}
    </div>
  );
};

/* ─── Stat card ──────────────────────────────────────────────────────────────
   Takes the icon as a node, not a component, so the tinted box sets `color` and
   lucide's currentColor stroke picks it up. */

const StatCard = ({ icon, label, value, sub, color = '#0d7478', onClick }) => (
  <div
    className="stat-card"
    onClick={onClick}
    style={{
      position: 'relative',
      overflow: 'hidden',
      cursor: onClick ? 'pointer' : 'default'
    }}
  >
    <div style={{ width: '4px', position: 'absolute', left: 0, top: 0, bottom: 0, background: color, borderRadius: '4px 0 0 4px' }} />
    <div style={{ paddingLeft: '0.5rem', display: 'flex', alignItems: 'center', gap: '1rem', width: '100%' }}>
      <div style={{ background: `${color}18`, borderRadius: '12px', padding: '10px', flexShrink: 0, color }}>
        {icon}
      </div>
      <div className="stat-info">
        <div className="stat-value" style={{ color: '#1a202c' }}>{value}</div>
        <div className="stat-label">{label}</div>
        {sub && <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.1rem' }}>{sub}</div>}
      </div>
    </div>
  </div>
);

/* ─── Panel shell ──────────────────────────────────────────────────────────── */

const PanelTitle = ({ icon, children, action, onAction }) => (
  <div className="table-header-actions" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
    <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      {icon} {children}
    </h2>
    {action && (
      <button
        type="button"
        onClick={onAction}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.3rem', background: 'none', border: 'none',
          color: '#0d7478', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer', padding: 0
        }}
      >
        {action} <ArrowRight size={14} />
      </button>
    )}
  </div>
);

const EMPTY_ROW = (colSpan, text) => (
  <tr>
    <td colSpan={colSpan} style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
      {text}
    </td>
  </tr>
);

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
  gap: '1.5rem',
  marginBottom: '1.5rem'
};

const MONTH_NAME = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });

/* ─── Dashboard ────────────────────────────────────────────────────────────── */

export const Dashboard = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { currencies } = useCurrencies();

  const [loading, setLoading] = useState(true);
  const [currentUserName, setCurrentUserName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [itineraries, setItineraries] = useState([]);
  const [unpaidInvoices, setUnpaidInvoices] = useState([]);
  const [monthInvoices, setMonthInvoices] = useState([]);
  const [monthReceipts, setMonthReceipts] = useState([]);
  const [catalogue, setCatalogue] = useState({ clients: 0, suppliers: 0, items: 0, packages: 0, guides: 0 });

  /* The month and the 30-day window are taken once per load, so every card on
     the page answers a question about the same moment. */
  const [windows, setWindows] = useState(() => {
    const now = new Date();
    return {
      today: isoDay(now),
      horizon: isoDay(addDays(now, 30)),
      monthStart: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)),
      monthEnd: isoDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      monthLabel: MONTH_NAME.format(now)
    };
  });

  const symOf = useCallback((code) => {
    const c = currencies.find((x) => (x.code || '').toUpperCase() === (code || '').toUpperCase());
    return c?.symbol || code || '';
  }, [currencies]);

  const load = useCallback(async () => {
    setLoading(true);
    /* The windows are computed here and pushed into state, rather than read
       back out of it. `load` is memoised on the toast alone, so a refresh after
       midnight or on the first of the month would otherwise re-query the window
       the page was first opened with and label it as today's. */
    const now = new Date();
    const win = {
      today: isoDay(now),
      horizon: isoDay(addDays(now, 30)),
      monthStart: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)),
      monthEnd: isoDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      monthLabel: MONTH_NAME.format(now)
    };
    setWindows(win);
    try {
      const username = await getLoggedInUserName();
      if (username) setCurrentUserName(username);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data: profile } = await supabase
        .from('profiles')
        .select('company_id')
        .eq('id', user.id)
        .single();

      const cid = profile?.company_id;
      if (!cid) { setLoading(false); return; }

      const countRows = (table) => supabase
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('company_id', cid);

      /* Each read is narrowed by what it is for rather than by a row cap: the
         pipeline in full, the documents that still owe money, the documents
         billed in this month, the cash that landed in this month, and five
         counters. A figure on this page is either the whole answer or it is not
         shown. */
      const [
        tripRes, companyRes, unpaidRes, monthBillRes, monthCashRes,
        clientRes, supplierRes, itemRes, packageRes, guideRes
      ] = await Promise.all([
        supabase
          .from('itineraries')
          .select('id, reference_number, itinerary_name, itinerary_tour_type, consultant_name, travel_start_date, travel_end_date, travellers, num_adults, num_children, status, updated_at, clients(name)')
          .eq('company_id', cid)
          .order('travel_start_date', { ascending: true, nullsFirst: false }),
        supabase.from('company_billing_settings').select('legal_name').eq('company_id', cid).maybeSingle(),
        supabase
          .from('invoices')
          .select('invoice_number, currency_code, status, issued_date, due_date, balance_due')
          .eq('company_id', cid)
          .in('status', ['proforma', 'validated']),
        supabase
          .from('invoices')
          .select('invoice_number, currency_code, status, issued_date, total_incl')
          .eq('company_id', cid)
          .in('status', ['validated', 'paid'])
          .gte('issued_date', win.monthStart)
          .lte('issued_date', win.monthEnd),
        supabase
          .from('invoice_receipts')
          .select('amount, currency_code, direction, received_date')
          .eq('company_id', cid)
          .gte('received_date', win.monthStart)
          .lte('received_date', win.monthEnd),
        countRows('clients'),
        countRows('suppliers'),
        countRows('library_items'),
        countRows('packages'),
        countRows('guide_members')
      ]);

      for (const res of [tripRes, companyRes, unpaidRes, monthBillRes, monthCashRes,
        clientRes, supplierRes, itemRes, packageRes, guideRes]) {
        if (res.error) throw res.error;
      }

      setItineraries(tripRes.data || []);
      setLegalName(companyRes.data?.legal_name || '');
      setUnpaidInvoices(unpaidRes.data || []);
      setMonthInvoices(monthBillRes.data || []);
      setMonthReceipts(monthCashRes.data || []);
      setCatalogue({
        clients: clientRes.count || 0,
        suppliers: supplierRes.count || 0,
        items: itemRes.count || 0,
        packages: packageRes.count || 0,
        guides: guideRes.count || 0
      });
    } catch (err) {
      showToast(err.message || 'Failed to load dashboard data', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  /* ─── Derived figures ───────────────────────────────────────────────────── */

  const stats = useMemo(() => {
    const quotes = itineraries.filter((it) => OPEN_QUOTE_STATUSES.includes(it.status));
    const live = itineraries.filter((it) => LIVE_BOOKING_STATUSES.includes(it.status));
    const departing = itineraries.filter((it) =>
      FORTHCOMING_STATUSES.includes(it.status) &&
      inWindow(it.travel_start_date, windows.today, windows.horizon)
    );
    const overdue = unpaidInvoices.filter((inv) =>
      effectiveBalance(inv) > 0 && dayValue(inv.due_date) && dayValue(inv.due_date) < windows.today
    );

    return {
      quotes: quotes.length,
      live: live.length,
      confirmed: live.filter((it) => it.status === 'confirmed').length,
      provisional: live.filter((it) => it.status === 'provisional').length,
      inProgress: live.filter((it) => it.status === 'in_progress').length,
      departing: departing.sort((a, b) => dayValue(a.travel_start_date).localeCompare(dayValue(b.travel_start_date))),
      departingPax: departing.reduce((sum, it) => sum + paxOf(it), 0),
      overdueCount: overdue.length,
      overdueTotal: sumByCurrency(overdue, effectiveBalance)
    };
  }, [itineraries, unpaidInvoices, windows]);

  const money = useMemo(() => {
    /* Cash that arrived is `in`; `out` is it handed back as a refund. A wallet
       draw (`apply`) settles an invoice but was never money received, and a
       wallet payout is not this month's income either - both stay out.
       Collected is shown net of what went back out, with the refund spelled out
       underneath, because a month that collected 80,000 and gave 20,000 back did
       not keep 80,000. */
    const isCashIn = (r) => receiptDirection(r) === 'in';
    const isRefund = (r) => receiptDirection(r) === 'out';
    return {
      billed: sumByCurrency(monthInvoices, (inv) => inv.total_incl),
      collected: sumByCurrency(monthReceipts, (r) =>
        (isCashIn(r) ? 1 : isRefund(r) ? -1 : 0) * (Number(r.amount) || 0)),
      refunded: sumByCurrency(monthReceipts.filter(isRefund), (r) => r.amount),
      outstanding: sumByCurrency(unpaidInvoices, effectiveBalance)
    };
  }, [monthInvoices, monthReceipts, unpaidInvoices]);

  const moneyCurrencies = useMemo(() => {
    const set = new Set();
    for (const map of [money.billed, money.collected, money.refunded, money.outstanding]) {
      for (const [ccy, value] of map) {
        if (Math.abs(round2(value)) > 0.004) set.add(ccy);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [money]);

  const recent = useMemo(
    () => [...itineraries]
      .filter((it) => it.updated_at)
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
      .slice(0, 6),
    [itineraries]
  );

  const byConsultant = useMemo(() => {
    const tally = new Map();
    for (const it of itineraries) {
      if (!LIVE_BOOKING_STATUSES.includes(it.status)) continue;
      const name = (it.consultant_name || '').trim() || 'Unassigned';
      const entry = tally.get(name) || { name, bookings: 0, pax: 0 };
      entry.bookings += 1;
      entry.pax += paxOf(it);
      tally.set(name, entry);
    }
    const rows = [...tally.values()].sort((a, b) => b.bookings - a.bookings || a.name.localeCompare(b.name));
    const max = rows.reduce((m, r) => Math.max(m, r.bookings), 0);
    return { rows: rows.slice(0, 6), max };
  }, [itineraries]);

  const firstName = currentUserName ? currentUserName.split(' ')[0] : '';

  /* One currency names the figure; several cannot fit a card, so the count says
     how many are owed and the money table below gives each its own row. */
  const overdueRows = moneyRows(stats.overdueTotal);
  const overdueSub = loading
    ? ''
    : overdueRows.length === 0
      ? 'Nothing past its due date'
      : overdueRows.length === 1
        ? `${fmtMoney(overdueRows[0][1], symOf(overdueRows[0][0]))} past due`
        : `${overdueRows.length} currencies past due`;

  /* ─── Render ────────────────────────────────────────────────────────────── */

  return (
    <div className="super-admin-page" style={{ paddingBottom: '4rem' }}>
      <header className="page-header" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
        <div className="header-title">
          <LayoutDashboard className="header-icon" />
          <div>
            <h1>Dashboard</h1>
            <p>
              {firstName ? `Welcome back, ${firstName}. ` : ''}
              {legalName || 'Your bookings, money and catalogue at a glance.'}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            type="button"
            onClick={load}
            title="Refresh"
            style={{ padding: '0.55rem 0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem', border: '1px solid #e2e8f0', borderRadius: '10px', background: '#fff', color: '#475569', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' }}
          >
            <RefreshCw size={15} /> Refresh
          </button>
          <button
            type="button"
            className="primary-btn"
            style={{ width: 'auto', padding: '0.6rem 1.25rem', background: '#0d7478', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            onClick={() => navigate('/itineraries')}
          >
            <FileText size={17} /> All itineraries
          </button>
        </div>
      </header>

      {/* Pipeline */}
      <div className="admin-stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginBottom: '1.5rem' }}>
        <StatCard
          icon={<Ticket size={22} />}
          label="Open quotes"
          value={loading ? '—' : stats.quotes.toLocaleString()}
          sub="Awaiting a decision"
          color="#b45309"
          onClick={() => navigate('/itineraries')}
        />
        <StatCard
          icon={<Briefcase size={22} />}
          label="Live bookings"
          value={loading ? '—' : stats.live.toLocaleString()}
          sub={loading ? '' : `${stats.confirmed} confirmed · ${stats.provisional} provisional · ${stats.inProgress} in progress`}
          color="#0d7478"
          onClick={() => navigate('/itineraries')}
        />
        <StatCard
          icon={<CalendarDays size={22} />}
          label="Departing in 30 days"
          value={loading ? '—' : stats.departing.length.toLocaleString()}
          sub={loading ? '' : `${stats.departingPax.toLocaleString()} travellers on board`}
          color="#16a34a"
          onClick={() => navigate('/itineraries')}
        />
        <StatCard
          icon={<Clock size={22} />}
          label="Overdue invoices"
          value={loading ? '—' : stats.overdueCount.toLocaleString()}
          sub={overdueSub}
          color="#dc2626"
          onClick={() => navigate('/finance')}
        />
      </div>

      {/* Money */}
      <div className="admin-table-container" style={{ marginBottom: '1.5rem' }}>
        <PanelTitle icon={<HandCoins size={18} color="#0d7478" />} action="Open Finance" onAction={() => navigate('/finance')}>
          Money · {windows.monthLabel}
        </PanelTitle>
        <div style={{ overflowX: 'auto' }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Currency</th>
                <th style={{ textAlign: 'right' }}>Billed this month</th>
                <th style={{ textAlign: 'right' }}>Collected this month</th>
                <th style={{ textAlign: 'right' }}>Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                EMPTY_ROW(4, 'Loading your figures…')
              ) : moneyCurrencies.length === 0 ? (
                EMPTY_ROW(4, 'No invoices or receipts yet — billed and collected totals appear here as soon as you raise one.')
              ) : (
                moneyCurrencies.map((ccy) => {
                  const one = (map) => {
                    const small = new Map();
                    if (Math.abs(round2(map.get(ccy) || 0)) > 0.004) small.set(ccy, map.get(ccy));
                    return small;
                  };
                  const refunded = Math.abs(round2(money.refunded.get(ccy) || 0)) > 0.004 ? round2(money.refunded.get(ccy)) : 0;
                  return (
                    <tr key={ccy}>
                      <td>
                        <span style={{ fontWeight: 700, color: '#0d7478', fontFamily: 'monospace', fontSize: '0.85rem' }}>{ccy}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}><MoneyCell totals={one(money.billed)} symOf={symOf} /></td>
                      <td style={{ textAlign: 'right' }}>
                        <MoneyCell totals={one(money.collected)} symOf={symOf} />
                        {refunded > 0 && (
                          <div style={{ fontSize: '0.7rem', color: '#dc2626' }}>
                            after {fmtMoney(refunded, symOf(ccy))} refunded
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}><MoneyCell totals={one(money.outstanding)} symOf={symOf} /></td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <p style={{ margin: '0.75rem 1rem 0.25rem', fontSize: '0.72rem', color: '#94a3b8' }}>
          Billed counts validated and paid invoices issued this month — a proforma is not billed yet. Collected is cash received, after any refunded out; credit drawn from a client&apos;s wallet settles an invoice but is not new money, so it is not counted. Outstanding covers every unpaid invoice, not only this month&apos;s.
        </p>
      </div>

      {/* Departures + recent activity */}
      <div style={gridStyle}>
        <div className="admin-table-container" style={{ marginBottom: 0 }}>
          <PanelTitle icon={<CalendarDays size={18} color="#0d7478" />} action="All itineraries" onAction={() => navigate('/itineraries')}>
            Next departures
          </PanelTitle>
          <div style={{ overflowX: 'auto' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Client</th>
                  <th>Arrival</th>
                  <th style={{ textAlign: 'center' }}>Pax</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  EMPTY_ROW(5, 'Loading…')
                ) : stats.departing.length === 0 ? (
                  EMPTY_ROW(5, 'Nothing on the calendar for the next 30 days.')
                ) : (
                  stats.departing.slice(0, 6).map((it) => (
                    <tr key={it.id}>
                      <td>
                        <span style={{ fontFamily: 'monospace', fontSize: '0.82rem', fontWeight: 700, color: '#0d7478' }}>
                          {it.reference_number || '—'}
                        </span>
                      </td>
                      <td style={{ maxWidth: '170px' }}>
                        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, color: '#1e293b' }}>
                          {it.clients?.name || leadTraveller(it.travellers) || '—'}
                        </span>
                        <span style={{ display: 'block', fontSize: '0.72rem', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {it.itinerary_name || ''}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.85rem', color: '#475569', whiteSpace: 'nowrap' }}>{toDisplay(it.travel_start_date)}</td>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: '#334155' }}>{paxOf(it)}</td>
                      <td>
                        <span className={`status-badge ${BADGE_MOD[it.status] || it.status || ''}`}>
                          {STATUS_LABELS[it.status] || it.status || 'Quotation'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="admin-table-container" style={{ marginBottom: 0 }}>
          <PanelTitle icon={<Clock size={18} color="#0d7478" />} action="All itineraries" onAction={() => navigate('/itineraries')}>
            Last touched
          </PanelTitle>
          <div style={{ overflowX: 'auto' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Itinerary</th>
                  <th>Consultant</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  EMPTY_ROW(4, 'Loading…')
                ) : recent.length === 0 ? (
                  EMPTY_ROW(4, 'No itineraries yet.')
                ) : (
                  recent.map((it) => (
                    <tr key={it.id}>
                      <td>
                        <span style={{ fontFamily: 'monospace', fontSize: '0.82rem', fontWeight: 700, color: it.status === 'cancelled' ? '#dc2626' : '#0d7478' }}>
                          {it.reference_number || '—'}
                        </span>
                      </td>
                      <td style={{ maxWidth: '190px' }}>
                        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, color: '#1e293b' }}>
                          {it.itinerary_name || '—'}
                        </span>
                        <span style={{ display: 'block', fontSize: '0.72rem', color: '#94a3b8' }}>
                          {toDisplay(it.travel_start_date)} · {it.clients?.name || '—'}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.82rem', color: '#475569' }}>{it.consultant_name || '—'}</td>
                      <td>
                        <span className={`status-badge ${BADGE_MOD[it.status] || it.status || ''}`}>
                          {STATUS_LABELS[it.status] || it.status || 'Quotation'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Catalogue + consultant load */}
      <div style={gridStyle}>
        <div className="admin-table-container" style={{ marginBottom: 0 }}>
          <PanelTitle icon={<Building2 size={18} color="#0d7478" />}>Catalogue</PanelTitle>
          <div style={{ padding: '0.5rem 1rem 1rem' }}>
            {[
              { icon: Users, label: 'Clients', value: catalogue.clients, to: '/clients' },
              { icon: Building2, label: 'Suppliers', value: catalogue.suppliers, to: '/suppliers' },
              { icon: FileText, label: 'Library items', value: catalogue.items, to: '/library-items' },
              { icon: Package, label: 'Packages', value: catalogue.packages, to: '/packages' },
              { icon: UserRound, label: 'Guide team', value: catalogue.guides, to: '/guide-team' }
            ].map((row) => (
              <div
                key={row.label}
                onClick={() => navigate(row.to)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.25rem',
                  borderBottom: '1px solid #f1f5f9', cursor: 'pointer'
                }}
              >
                <row.icon size={16} color="#64748b" />
                <span style={{ flex: 1, fontSize: '0.875rem', fontWeight: 600, color: '#334155' }}>{row.label}</span>
                <span style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0d7478' }}>
                  {loading ? '—' : row.value.toLocaleString()}
                </span>
                <ArrowRight size={14} color="#cbd5e1" />
              </div>
            ))}
          </div>
        </div>

        <div className="admin-table-container" style={{ marginBottom: 0 }}>
          <PanelTitle icon={<UsersRound size={18} color="#0d7478" />}>Bookings by consultant</PanelTitle>
          <div style={{ padding: '0.5rem 1rem 1rem' }}>
            {loading ? (
              <p style={{ padding: '2rem 0', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>Loading…</p>
            ) : byConsultant.rows.length === 0 ? (
              <p style={{ padding: '2rem 0', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
                No live bookings yet — this list fills as soon as a quote is provisionally confirmed.
              </p>
            ) : (
              byConsultant.rows.map((row) => (
                <div key={row.name} style={{ padding: '0.5rem 0.25rem', borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.75rem' }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#334155' }}>{row.name}</span>
                    <span style={{ fontSize: '0.78rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                      <strong style={{ color: '#0d7478' }}>{row.bookings}</strong> bookings · {row.pax} pax
                    </span>
                  </div>
                  <div style={{ height: '5px', background: '#f1f5f9', borderRadius: '9999px', marginTop: '0.4rem', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${byConsultant.max ? Math.max(6, Math.round((row.bookings / byConsultant.max) * 100)) : 0}%`,
                      background: '#0d7478',
                      borderRadius: '9999px'
                    }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
