import { useState, useEffect, useCallback, useMemo } from 'react';
import SearchableSelect from '../components/SearchableSelect';
import StatCard from '../components/StatCard';
import { supabase, getLoggedInUserName } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { vocabularyNames, vocabularyReadFilter } from '../lib/companyVocabulary';
import { scopeCompanyId } from '../lib/tenantScope';
import { useSession } from '../hooks/useSession';
import { useCurrencies } from '../hooks/useCurrencies';
import { fmtMoney } from '../lib/invoiceDoc';
import {
  buildAnalyticsReports,
  moneyOf,
  statusLabel,
  REPORT_DATE_BASES,
  REPORT_FINANCIAL_BASES,
  REPORT_LOSS_FILTERS
} from '../lib/analyticsReports';
import {
  BarChart3,
  Users,
  FileSpreadsheet,
  Search,
  Building2,
  User,
  Calendar,
  RefreshCw,
  TrendingUp,
  Calculator,
  CircleDollarSign,
  TrendingDown,
  FilterX,
  FileText
} from 'lucide-react';

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

const htmlEscape = (v) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const downloadBlob = (content, filename, mimeType) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const toDisplay = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
};

const leadTraveller = (travellers) => {
  if (!Array.isArray(travellers) || !travellers.length) return '—';
  const t = travellers[0];
  return [t.name, t.surname].filter(Boolean).join(' ') || '—';
};

const clientTypeLabel = (clientType) => {
  if (!clientType) return 'Direct';
  if (clientType.toLowerCase().includes('agency')) return 'Agency';
  return 'Direct';
};

const STATUS_LABELS = {
  quotation: 'Quotation',
  provisional: 'Provisional',
  confirmed: 'Confirmed',
  in_progress: 'In Progress',
  cancelled: 'Cancelled',
  completed: 'Completed'
};

/* ─── Report building blocks ───────────────────────────────────────────────── */

const filterSelectStyle = {
  width: 'auto',
  minWidth: '150px',
  padding: '0.55rem 0.75rem',
  borderRadius: '10px',
  border: '1px solid #e2e8f0',
  fontSize: '0.85rem',
  color: '#334155',
  background: '#f8fafc'
};

const filterInputStyle = {
  ...filterSelectStyle,
  minWidth: '140px',
  width: '140px'
};

const FilterField = ({ label, children }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
    {label}
    {children}
  </label>
);

const ReportPanel = ({ title, subtitle, columns, rows, empty = 'No records match the selected filters.' }) => (
  <section className="admin-table-container" style={{ marginBottom: '1.5rem', overflow: 'hidden' }}>
    <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>{title}</h2>
      {subtitle && <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{subtitle}</span>}
    </div>
    <div style={{ overflowX: 'auto' }}>
      <table className="admin-table" style={{ minWidth: '760px' }}>
        <thead>
          <tr>{columns.map((column) => <th key={column.key} style={column.align ? { textAlign: column.align } : undefined}>{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={{ padding: '2.5rem', textAlign: 'center', color: '#94a3b8' }}>{empty}</td>
            </tr>
          ) : rows.map((row, index) => (
            <tr key={row.key || row.id || index}>
              {columns.map((column) => (
                <td key={column.key} style={column.align ? { textAlign: column.align } : undefined}>
                  {column.render ? column.render(row) : (row[column.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
);

/* ─── Excel Export ─────────────────────────────────────────────────────────── */

const buildChecklistXls = (itineraries, defaultConsultant = '') => {
  const esc = htmlEscape;
  const cols = [
    'Reference #',
    'Client',
    'Client Type',
    'Lead Traveler',
    '# Travelers',
    'Tour Name',
    'Tour Type',
    'Arrival Date',
    'Departure Date',
    'Consultant',
    'Status'
  ];

  const headerRow = `<tr>${cols.map((c) => `<th style="background:#0d7478;color:#fff;font-weight:700;padding:8px 12px;white-space:nowrap;border:1px solid #0a5c60;">${esc(c)}</th>`).join('')}</tr>`;

  const rows = itineraries.map((it) => {
    const isCancelled = it.status === 'cancelled';
    const trav = Array.isArray(it.travellers) ? it.travellers : [];
    const ref = isCancelled ? `XX ${it.reference_number || ''}` : (it.reference_number || '—');

    const cellStyle = isCancelled
      ? 'color:#dc2626;text-decoration:line-through;background:#fff5f5;border:1px solid #fecaca;padding:7px 10px;'
      : 'border:1px solid #e2e8f0;padding:7px 10px;';

    const cells = [
      ref,
      it.clients?.name || '—',
      clientTypeLabel(it.clients?.client_type),
      leadTraveller(trav),
      String(trav.length || 0),
      it.itinerary_name || '—',
      it.itinerary_tour_type || '—',
      toDisplay(it.travel_start_date),
      toDisplay(it.travel_end_date),
      it.consultant_name || defaultConsultant || '—',
      STATUS_LABELS[it.status] || it.status || '—'
    ];

    return `<tr>${cells.map((v) => `<td style="${cellStyle}">${esc(v)}</td>`).join('')}</tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><meta name="ProgId" content="Excel.Sheet">
<style>
  body { font-family: Calibri, Arial, sans-serif; font-size: 12px; }
  table { border-collapse: collapse; width: 100%; }
  .cancelled { color: #dc2626; text-decoration: line-through; background: #fff5f5; }
</style>
</head>
<body>
<h3 style="color:#0d7478;font-family:Calibri,Arial,sans-serif;">Travelers Checklist</h3>
<p style="color:#64748b;font-size:11px;font-family:Calibri,Arial,sans-serif;">Generated: ${new Date().toLocaleDateString('en-GB')} — ${itineraries.length} itineraries</p>
<table>
  <thead>${headerRow}</thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`;
};

/* PostgREST caps a single response. Books with thousands of services still need
   their full financials, so page each chunk of parent ids to completion. */
const fetchInBatches = async (table, select, column, ids) => {
  const rows = [];
  const chunkSize = 100;
  const pageSize = 500;
  for (let start = 0; start < ids.length; start += chunkSize) {
    const chunk = ids.slice(start, start + chunkSize);
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from(table)
        .select(select)
        .in(column, chunk)
        .range(from, from + pageSize - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < pageSize) break;
      from += pageSize;
    }
  }
  return rows;
};

/* ─── Main Analytics Page ──────────────────────────────────────────────────── */

export const Analytics = () => {
  const { showToast } = useToast();
  const { userId, roleKey, name: sessionName } = useSession();
  const isConsultant = roleKey === 'consultant';
  const [itineraries, setItineraries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [tourTypeFilter, setTourTypeFilter] = useState('');
  const [tourTypes, setTourTypes] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [currentUserName, setCurrentUserName] = useState('');
  const [dayItems, setDayItems] = useState([]);
  const [clientOptions, setClientOptions] = useState([]);
  const [consultantOptions, setConsultantOptions] = useState([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [dateBasis, setDateBasis] = useState('travel');
  const [consultantFilter, setConsultantFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [financialBasis, setFinancialBasis] = useState('booked');
  const [lossFilter, setLossFilter] = useState('all');
  const [minRevenue, setMinRevenue] = useState('');
  const { currencies } = useCurrencies();

  const fetchData = useCallback(async () => {
    const username = await getLoggedInUserName();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { username, itineraries: [], tourTypes: [] };

    const { data: profile } = await supabase
      .from('profiles')
      .select('company_id')
      .eq('id', user.id)
      .single();

    const companyId = scopeCompanyId(profile?.company_id);
    if (!companyId) return { username, itineraries: [], tourTypes: [] };

    const [
      { data, error },
      { data: tourTypeRows, error: tourTypeError },
      { data: clientRows, error: clientError }
    ] = await Promise.all([
      supabase
        .from('itineraries')
        .select('id, client_id, reference_number, itinerary_name, itinerary_tour_type, consultant_name, created_by, created_at, travel_start_date, travel_end_date, travellers, num_adults, num_children, status, clients(id, name, client_type)')
        .eq('company_id', companyId)
        .order('travel_start_date', { ascending: true, nullsFirst: false }),
      supabase
        .from('company_tour_types')
        .select('name, company_id, is_active')
        .or(vocabularyReadFilter(companyId))
        .order('name', { ascending: true }),
      supabase
        .from('clients')
        .select('id, name')
        .eq('company_id', companyId)
        .order('name', { ascending: true })
    ]);

    if (error) throw error;
    if (tourTypeError) throw tourTypeError;
    if (clientError) throw clientError;
    const visibleItineraries = isConsultant
      ? (data || []).filter((it) => it.created_by === userId
        || (!it.created_by && it.consultant_name === (username || sessionName)))
      : data || [];

    /* Money lives on the day items, which store a day id rather than an
       itinerary id. Resolve that link here so the report engine only sees rows
       belonging to itineraries this user is allowed to see. */
    let items = [];
    const itineraryIds = visibleItineraries.map((it) => it.id);
    if (itineraryIds.length) {
      const days = await fetchInBatches('itinerary_days', 'id, itinerary_id', 'itinerary_id', itineraryIds);
      const itineraryOfDay = new Map((days || []).map((day) => [day.id, day.itinerary_id]));
      const dayIds = [...itineraryOfDay.keys()];
      if (dayIds.length) {
        const rawItems = await fetchInBatches(
          'itinerary_day_items',
          'itinerary_day_id, item_name, currency_code, total_buy, total_sell, unit_cost, unit_price, item_price_per_person, pax, tax_rate, is_included',
          'itinerary_day_id',
          dayIds
        );
        items = (rawItems || [])
          .map((item) => ({ ...item, itinerary_id: itineraryOfDay.get(item.itinerary_day_id) }))
          .filter((item) => item.itinerary_id);
      }
    }

    const configuredTypes = vocabularyNames(tourTypeRows);
    const previouslyUsedTypes = visibleItineraries.map((itinerary) => itinerary.itinerary_tour_type).filter(Boolean);
    return {
      username,
      itineraries: visibleItineraries,
      tourTypes: [...new Set([...configuredTypes, ...previouslyUsedTypes])].sort((a, b) => a.localeCompare(b)),
      dayItems: items,
      clients: clientRows || [],
      consultants: [...new Set(visibleItineraries.map((it) => it.consultant_name).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b))
    };
  }, [isConsultant, sessionName, userId]);

  const applyResult = useCallback((result) => {
    setCurrentUserName(result.username || '');
    setItineraries(result.itineraries);
    setTourTypes(result.tourTypes);
    setDayItems(result.dayItems || []);
    setClientOptions(result.clients || []);
    setConsultantOptions(result.consultants || []);
  }, []);

  useEffect(() => {
    let active = true;
    fetchData()
      .then((result) => { if (active) applyResult(result); })
      .catch((err) => {
        if (active) showToast(err.message || 'Failed to load analytics data', 'error');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [fetchData, showToast, applyResult]);

  /* The Refresh button used to call fetchData directly, which returned the rows
     but never put them on screen. It now runs the same load as the first render
     and applies the result, so a consultant sees newly confirmed work. */
  const handleRefresh = useCallback(async () => {
    setLoading(true);
    try {
      applyResult(await fetchData());
      showToast('Analytics refreshed', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to refresh analytics', 'error');
    } finally {
      setLoading(false);
    }
  }, [fetchData, showToast, applyResult]);

  /* ─── Money display ─────────────────────────────────────────────────────── */

  const symbolOf = useCallback((code) => {
    const upper = String(code || '').toUpperCase();
    return currencies.find((currency) => currency.code === upper)?.symbol || `${upper} `;
  }, [currencies]);

  const formatAmount = useCallback((amount, code) => fmtMoney(amount, symbolOf(code)), [symbolOf]);

  /* A mixed-currency company never gets a single fake total: every figure is
     printed once per currency, with the code alongside it. */
  const moneyText = useCallback((byCurrency, field = 'revenue') => {
    const rows = moneyOf(byCurrency);
    if (!rows.length) return '—';
    return rows.map((row) => `${row.code} ${formatAmount(row[field], row.code)}`).join('  ·  ');
  }, [formatAmount]);

  const marginCell = useCallback((byCurrency) => {
    const rows = moneyOf(byCurrency);
    if (!rows.length) return <span style={{ color: '#cbd5e1' }}>—</span>;
    return rows.map((row) => (
      <div key={row.code} style={{ whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94a3b8', marginRight: '0.25rem' }}>{row.code}</span>
        {row.margin == null ? '—' : `${row.margin}%`}
      </div>
    ));
  }, []);

  const moneyCell = useCallback((byCurrency, field = 'revenue') => {
    const rows = moneyOf(byCurrency);
    if (!rows.length) return <span style={{ color: '#cbd5e1' }}>—</span>;
    return rows.map((row) => {
      const isBad = field === 'loss' && row.loss > 0;
      return (
        <div key={row.code} style={{ whiteSpace: 'nowrap', color: isBad ? '#dc2626' : '#1e293b', fontWeight: isBad ? 700 : 500 }}>
          <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94a3b8', marginRight: '0.25rem' }}>{row.code}</span>
          {formatAmount(row[field], row.code)}
        </div>
      );
    });
  }, [formatAmount]);

  /* ─── Reports ───────────────────────────────────────────────────────────── */

  const reportFilters = useMemo(() => ({
    from: dateFrom,
    to: dateTo,
    dateBasis,
    consultant: isConsultant ? '' : consultantFilter,
    clientId: clientFilter,
    status: statusFilter,
    tourType: tourTypeFilter,
    financialBasis,
    lossFilter,
    minRevenue
  }), [dateFrom, dateTo, dateBasis, isConsultant, consultantFilter, clientFilter, statusFilter, tourTypeFilter, financialBasis, lossFilter, minRevenue]);

  const report = useMemo(
    () => buildAnalyticsReports({ itineraries, items: dayItems, filters: reportFilters }),
    [itineraries, dayItems, reportFilters]
  );

  const clearFilters = () => {
    setDateFrom('');
    setDateTo('');
    setDateBasis('travel');
    setConsultantFilter('');
    setClientFilter('');
    setStatusFilter('');
    setTourTypeFilter('');
    setFinancialBasis('booked');
    setLossFilter('all');
    setMinRevenue('');
  };

  const stats = useMemo(() => ({
    total: report.totals.itineraries,
    travellers: report.totals.travellers,
    revenue: moneyText(report.totals.byCurrency, 'revenue'),
    loss: moneyText(report.totals.byCurrency, 'loss'),
    quotations: report.quotationsByClient.reduce((sum, group) => sum + group.itineraries, 0)
  }), [report, moneyText]);

  /* ─── Filtered list ─────────────────────────────────────────────────────── */

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return report.rows.filter((row) => {
      if (!q) return true;
      const it = row.itinerary;
      const trav = Array.isArray(it.travellers) ? it.travellers : [];
      const haystack = [
        it.reference_number,
        it.clients?.name,
        it.itinerary_name,
        it.consultant_name || currentUserName,
        leadTraveller(trav)
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [report.rows, searchQuery, currentUserName]);

  const statusColumns = report.statusColumns;

  const consultantRows = useMemo(() => report.byConsultant.map((group) => ({
    ...group,
    statuses: Object.fromEntries(statusColumns.map((status) => [
      status,
      report.rows.filter((row) => row.consultant === group.key && row.status === status).length
    ]))
  })), [report, statusColumns]);

  const clientRows = useMemo(() => report.byClient.map((group) => ({
    ...group,
    quotations: report.quotationsByClient.find((row) => row.key === group.key)?.itineraries || 0
  })), [report]);

  const statusRows = useMemo(() => report.byStatus
    .filter((row) => row.itineraries > 0)
    .map((row) => ({
      ...row,
      share: report.totals.itineraries ? Math.round((row.itineraries / report.totals.itineraries) * 100) : 0
    })), [report]);

  const itineraryRows = useMemo(() => filtered.map((row) => ({ ...row, key: row.id })), [filtered]);

  /* ─── Export ────────────────────────────────────────────────────────────── */

  const handleExport = () => {
    if (!filtered.length) {
      showToast('No records to export', 'warning');
      return;
    }
    const xls = buildChecklistXls(filtered.map((row) => row.itinerary), currentUserName);
    const date = new Date().toISOString().slice(0, 10);
    downloadBlob(xls, `travelers-checklist-${date}.xls`, 'application/vnd.ms-excel');
    showToast('Travelers checklist exported as Excel', 'success');
  };

  return (
    <div className="super-admin-page" style={{ paddingBottom: '4rem' }}>
      {/* Page Header */}
      <header className="page-header" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
        <div className="header-title">
          <BarChart3 className="header-icon" />
          <div>
            <h1>Analytics</h1>
            <p>{isConsultant ? 'Your itineraries, revenue and loss' : 'Consultant, client and financial reporting across the company'}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            type="button"
            className="icon-btn outline"
            onClick={handleRefresh}
            disabled={loading}
            title="Refresh"
            style={{ padding: '0.55rem 0.9rem', display: 'flex', alignItems: 'center', gap: '0.4rem', border: '1px solid #e2e8f0', borderRadius: '10px', background: '#fff', color: '#475569', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' }}
          >
            <RefreshCw size={15} /> Refresh
          </button>
          <button
            type="button"
            className="primary-btn"
            style={{ width: 'auto', padding: '0.6rem 1.25rem', background: '#0d7478', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            onClick={handleExport}
          >
            <FileSpreadsheet size={17} /> Export Excel
          </button>
        </div>
      </header>

      {/* Report filters */}
      <div className="admin-table-container" style={{ padding: '1.15rem 1.25rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Calculator size={18} color="#0d7478" /> Report filters
          </h2>
          <button
            type="button"
            className="icon-btn outline"
            onClick={clearFilters}
            style={{ padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem', border: '1px solid #e2e8f0', borderRadius: '9px', background: '#fff', color: '#64748b', fontSize: '0.8rem', cursor: 'pointer' }}
          >
            <FilterX size={14} /> Clear filters
          </button>
        </div>
        <div style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {!isConsultant && (
            <FilterField label="Consultant">
              <SearchableSelect className="pricing-select" style={filterSelectStyle} value={consultantFilter} onChange={(e) => setConsultantFilter(e.target.value)}>
                <option value="">All consultants</option>
                {consultantOptions.map((name) => <option key={name} value={name}>{name}</option>)}
              </SearchableSelect>
            </FilterField>
          )}
          <FilterField label="Date basis">
            <SearchableSelect className="pricing-select" style={filterSelectStyle} value={dateBasis} onChange={(e) => setDateBasis(e.target.value)}>
              {REPORT_DATE_BASES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </SearchableSelect>
          </FilterField>
          <FilterField label="From">
            <input type="date" style={filterInputStyle} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </FilterField>
          <FilterField label="To">
            <input type="date" style={filterInputStyle} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </FilterField>
          <FilterField label="Status">
            <SearchableSelect className="pricing-select" style={filterSelectStyle} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              <option value="pending_confirmation">Pending Confirmation</option>
            </SearchableSelect>
          </FilterField>
          <FilterField label="Tour type">
            <SearchableSelect className="pricing-select" style={filterSelectStyle} value={tourTypeFilter} onChange={(e) => setTourTypeFilter(e.target.value)}>
              <option value="">All tour types</option>
              {tourTypes.map((tourType) => <option key={tourType} value={tourType}>{tourType}</option>)}
            </SearchableSelect>
          </FilterField>
          <FilterField label="Client">
            <SearchableSelect className="pricing-select" style={{ ...filterSelectStyle, minWidth: '180px' }} value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
              <option value="">All clients</option>
              {clientOptions.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </SearchableSelect>
          </FilterField>
          <FilterField label="Trip scope">
            <SearchableSelect className="pricing-select" style={{ ...filterSelectStyle, minWidth: '210px' }} value={financialBasis} onChange={(e) => setFinancialBasis(e.target.value)}>
              {REPORT_FINANCIAL_BASES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </SearchableSelect>
          </FilterField>
          <FilterField label="Profit / loss">
            <SearchableSelect className="pricing-select" style={filterSelectStyle} value={lossFilter} onChange={(e) => setLossFilter(e.target.value)}>
              {REPORT_LOSS_FILTERS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </SearchableSelect>
          </FilterField>
          <FilterField label="Min revenue">
            <input type="number" min="0" step="0.01" style={filterInputStyle} placeholder="Any" value={minRevenue} onChange={(e) => setMinRevenue(e.target.value)} />
          </FilterField>
        </div>
        {isConsultant && (
          <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0.8rem 0 0' }}>
            Consultant reports are limited to itineraries you created.
          </p>
        )}
      </div>

      {/* Stats Grid */}
      <div className="admin-stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', marginBottom: '1.5rem' }}>
        <StatCard
          icon={Users}
          label="Total Travelers"
          value={stats.travellers.toLocaleString()}
          sub="Within the selected filters"
          color="#0d7478"
        />
        <StatCard
          icon={TrendingUp}
          label="Total Itineraries"
          value={stats.total.toLocaleString()}
          sub="Matching the selected filters"
          color="#6366f1"
        />
        <StatCard
          icon={CircleDollarSign}
          label="Revenue"
          value={stats.revenue}
          sub="Tax excluded · per currency"
          color="#16a34a"
        />
        <StatCard
          icon={TrendingDown}
          label="Loss"
          value={stats.loss}
          sub="Sum of loss-making trips"
          color="#dc2626"
        />
        <StatCard
          icon={FileText}
          label="Quotations"
          value={stats.quotations.toLocaleString()}
          sub="Counted separately from bookings"
          color="#f59e0b"
        />
      </div>

      {/* Admin-only management reports */}
      {!isConsultant && (
        <>
          <ReportPanel
            title="Revenue & loss by consultant"
            subtitle="Itineraries, revenue and loss follow every filter above"
            rows={consultantRows}
            columns={[
              { key: 'consultant', label: 'Consultant', render: (row) => <strong>{row.key}</strong> },
              { key: 'itineraries', label: 'Trips', align: 'center' },
              { key: 'travellers', label: 'Travellers', align: 'center' },
              ...statusColumns.map((status) => ({
                key: `status_${status}`,
                label: statusLabel(status),
                align: 'center',
                render: (row) => row.statuses[status] || 0
              })),
              { key: 'revenue', label: 'Revenue', render: (row) => moneyCell(row.byCurrency, 'revenue') },
              { key: 'cost', label: 'Cost', render: (row) => moneyCell(row.byCurrency, 'cost') },
              { key: 'profit', label: 'Net profit', render: (row) => moneyCell(row.byCurrency, 'profit') },
              { key: 'loss', label: 'Loss', render: (row) => moneyCell(row.byCurrency, 'loss') },
              { key: 'margin', label: 'Margin', render: (row) => marginCell(row.byCurrency) }
            ]}
          />

          <ReportPanel
            title="Itineraries per client and status"
            subtitle="Every client with its status breakdown"
            rows={clientRows}
            columns={[
              { key: 'client', label: 'Client', render: (row) => <strong>{row.key}</strong> },
              { key: 'itineraries', label: 'Total trips', align: 'center' },
              ...statusColumns.map((status) => ({
                key: `status_${status}`,
                label: statusLabel(status),
                align: 'center',
                render: (row) => row.statuses?.[status] || 0
              })),
              { key: 'travellers', label: 'Travellers', align: 'center' },
              { key: 'revenue', label: 'Revenue', render: (row) => moneyCell(row.byCurrency, 'revenue') }
            ]}
          />

          <ReportPanel
            title="Revenue & quotations per client"
            subtitle="Quotations are counted even when the trip scope is set to booked only"
            rows={clientRows}
            columns={[
              { key: 'client', label: 'Client', render: (row) => <strong>{row.key}</strong> },
              { key: 'itineraries', label: 'Booked trips', align: 'center' },
              { key: 'quotations', label: 'Quotations', align: 'center' },
              { key: 'revenue', label: 'Revenue', render: (row) => moneyCell(row.byCurrency, 'revenue') },
              { key: 'cost', label: 'Cost', render: (row) => moneyCell(row.byCurrency, 'cost') },
              { key: 'profit', label: 'Net profit', render: (row) => moneyCell(row.byCurrency, 'profit') },
              { key: 'loss', label: 'Loss', render: (row) => moneyCell(row.byCurrency, 'loss') },
              { key: 'margin', label: 'Margin', render: (row) => marginCell(row.byCurrency) }
            ]}
          />
        </>
      )}

      {/* Reports useful to both management and consultants */}
      <ReportPanel
        title="Monthly trend"
        subtitle={dateBasis === 'created' ? 'Grouped by itinerary creation month' : 'Grouped by travel start month'}
        rows={report.monthly}
        columns={[
          { key: 'month', label: 'Month', render: (row) => <strong>{row.key}</strong> },
          { key: 'itineraries', label: 'Trips', align: 'center' },
          { key: 'travellers', label: 'Travellers', align: 'center' },
          { key: 'revenue', label: 'Revenue', render: (row) => moneyCell(row.byCurrency, 'revenue') },
          { key: 'profit', label: 'Net profit', render: (row) => moneyCell(row.byCurrency, 'profit') },
          { key: 'loss', label: 'Loss', render: (row) => moneyCell(row.byCurrency, 'loss') }
        ]}
      />

      <ReportPanel
        title="Status mix"
        subtitle="Where the current bookings sit in the pipeline"
        rows={statusRows}
        columns={[
          { key: 'status', label: 'Status', render: (row) => <span className={`status-badge ${row.status}`}>{row.label}</span> },
          { key: 'itineraries', label: 'Itineraries', align: 'center' },
          { key: 'share', label: 'Share', align: 'center', render: (row) => `${row.share}%` }
        ]}
      />

      <ReportPanel
        title="Tour type mix"
        rows={report.byTourType}
        columns={[
          { key: 'tourType', label: 'Tour type', render: (row) => <strong>{row.key}</strong> },
          { key: 'itineraries', label: 'Itineraries', align: 'center' },
          { key: 'travellers', label: 'Travellers', align: 'center' },
          { key: 'revenue', label: 'Revenue', render: (row) => moneyCell(row.byCurrency, 'revenue') },
          { key: 'loss', label: 'Loss', render: (row) => moneyCell(row.byCurrency, 'loss') }
        ]}
      />

      <ReportPanel
        title="Loss-making itineraries"
        subtitle="Trips sold below their buy cost — a profitable month can hide these"
        rows={report.lossMaking}
        empty="No loss-making itineraries in this period."
        columns={[
          { key: 'reference', label: 'Reference', render: (row) => <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0d7478' }}>{row.reference}</span> },
          { key: 'client', label: 'Client' },
          ...(isConsultant ? [] : [{ key: 'consultant', label: 'Consultant' }]),
          { key: 'dates', label: 'Travel dates', render: (row) => `${toDisplay(row.start)} – ${toDisplay(row.end)}` },
          { key: 'revenue', label: 'Revenue', render: (row) => moneyCell(row.financials, 'revenue') },
          { key: 'cost', label: 'Cost', render: (row) => moneyCell(row.financials, 'cost') },
          { key: 'loss', label: 'Loss', render: (row) => moneyCell(row.financials, 'loss') }
        ]}
      />

      <ReportPanel
        title={isConsultant ? 'Your itineraries — financials' : 'Itinerary financials'}
        subtitle="Per-itinerary figures behind the totals"
        rows={itineraryRows}
        columns={[
          { key: 'reference', label: 'Reference', render: (row) => <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0d7478' }}>{row.reference}</span> },
          { key: 'client', label: 'Client' },
          { key: 'name', label: 'Tour name' },
          { key: 'dates', label: 'Travel dates', render: (row) => `${toDisplay(row.start)} – ${toDisplay(row.end)}` },
          ...(isConsultant ? [] : [{ key: 'consultant', label: 'Consultant' }]),
          { key: 'status', label: 'Status', render: (row) => <span className={`status-badge ${row.status}`}>{statusLabel(row.status)}</span> },
          { key: 'travellers', label: 'Travellers', align: 'center' },
          { key: 'revenue', label: 'Revenue', render: (row) => moneyCell(row.financials, 'revenue') },
          { key: 'cost', label: 'Cost', render: (row) => moneyCell(row.financials, 'cost') },
          { key: 'profit', label: 'Net profit', render: (row) => moneyCell(row.financials, 'profit') },
          { key: 'loss', label: 'Loss', render: (row) => moneyCell(row.financials, 'loss') }
        ]}
      />

      {/* Checklist Table */}
      <div className="admin-table-container">
        {/* Table toolbar */}
        <div className="table-header-actions" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Users size={18} color="#0d7478" /> Travelers Checklist
            {filtered.length !== itineraries.length && (
              <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#64748b', marginLeft: '0.25rem' }}>
                ({filtered.length} of {itineraries.length})
              </span>
            )}
          </h2>
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', flex: 1, justifyContent: 'flex-end' }}>
            {/* Search */}
            <div className="search-box" style={{ flex: '1 1 240px', maxWidth: '340px' }}>
              <Search size={15} />
              <input
                type="text"
                placeholder="Search reference, client, tour, consultant…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table className="admin-table" style={{ minWidth: '1100px' }}>
            <thead>
              <tr>
                <th>Reference #</th>
                <th>Client</th>
                <th>Type</th>
                <th>Lead Traveler</th>
                <th style={{ textAlign: 'center' }}># Travelers</th>
                <th>Tour Name</th>
                <th>Tour Type</th>
                <th>Arrival Date</th>
                <th>Departure Date</th>
                <th>Consultant</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="11" style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>
                    Loading checklist…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan="11" style={{ padding: '3.5rem', textAlign: 'center', color: '#64748b' }}>
                    <BarChart3 size={48} style={{ marginBottom: '1rem', opacity: 0.3, display: 'block', margin: '0 auto 1rem' }} />
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.4rem' }}>
                      {itineraries.length === 0 ? 'No itineraries yet' : 'No results match your filters'}
                    </h3>
                    <p style={{ margin: 0 }}>
                      {itineraries.length === 0
                        ? 'Create your first itinerary to start tracking travelers.'
                        : 'Try adjusting your search or filter.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((it) => {
                  const isCancelled = it.status === 'cancelled';
                  const trav = Array.isArray(it.travellers) ? it.travellers : [];
                  const ref = isCancelled
                    ? `XX ${it.reference_number || ''}`
                    : (it.reference_number || '—');

                  return (
                    <tr
                      key={it.id}
                      className={isCancelled ? 'cancelled-row' : ''}
                    >
                      {/* Reference */}
                      <td>
                        <span style={{
                          fontFamily: 'monospace',
                          fontSize: '0.85rem',
                          fontWeight: 700,
                          color: isCancelled ? '#dc2626' : '#0d7478'
                        }}>
                          {ref}
                        </span>
                      </td>

                      {/* Client */}
                      <td>
                        <div className="company-cell">
                          <span className="company-name" style={isCancelled ? { color: '#dc2626' } : {}}>
                            {it.clients?.name || '—'}
                          </span>
                        </div>
                      </td>

                      {/* Client type badge */}
                      <td>
                        {it.clients?.client_type ? (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            padding: '0.2rem 0.55rem',
                            borderRadius: '9999px',
                            background: isCancelled ? '#fee2e2' : (clientTypeLabel(it.clients.client_type) === 'Agency' ? '#eff6ff' : '#f0fdf4'),
                            color: isCancelled ? '#dc2626' : (clientTypeLabel(it.clients.client_type) === 'Agency' ? '#1e40af' : '#166534')
                          }}>
                            {clientTypeLabel(it.clients.client_type) === 'Agency'
                              ? <Building2 size={11} />
                              : <User size={11} />}
                            {clientTypeLabel(it.clients.client_type)}
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Direct</span>
                        )}
                      </td>

                      {/* Lead Traveler */}
                      <td style={{ fontSize: '0.875rem', color: isCancelled ? '#dc2626' : '#334155' }}>
                        {leadTraveller(trav)}
                      </td>

                      {/* # Travelers */}
                      <td style={{ textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '32px',
                          height: '32px',
                          borderRadius: '50%',
                          background: isCancelled ? '#fee2e2' : 'rgba(13,116,120,0.1)',
                          color: isCancelled ? '#dc2626' : '#0d7478',
                          fontWeight: 800,
                          fontSize: '0.85rem'
                        }}>
                          {trav.length || 0}
                        </span>
                      </td>

                      {/* Tour Name */}
                      <td style={{ fontWeight: 600, color: isCancelled ? '#dc2626' : '#1e293b', maxWidth: '200px' }}>
                        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {it.itinerary_name || '—'}
                        </span>
                      </td>

                      {/* Tour Type */}
                      <td>
                        {it.itinerary_tour_type ? (
                          <span style={{
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            padding: '0.2rem 0.6rem',
                            borderRadius: '9999px',
                            background: isCancelled ? '#fee2e2' : (it.itinerary_tour_type === 'FIT' ? '#fef9c3' : '#f0fdfa'),
                            color: isCancelled ? '#dc2626' : (it.itinerary_tour_type === 'FIT' ? '#854d0e' : '#0f766e'),
                            border: `1px solid ${isCancelled ? '#fecaca' : (it.itinerary_tour_type === 'FIT' ? '#fde68a' : '#99f6e4')}`
                          }}>
                            {it.itinerary_tour_type}
                          </span>
                        ) : (
                          <span style={{ color: '#cbd5e1', fontSize: '0.8rem' }}>—</span>
                        )}
                      </td>

                      {/* Arrival Date */}
                      <td style={{ fontSize: '0.85rem', color: isCancelled ? '#dc2626' : '#475569', whiteSpace: 'nowrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                          <Calendar size={13} style={{ opacity: 0.6 }} />
                          {toDisplay(it.travel_start_date)}
                        </span>
                      </td>

                      {/* Departure Date */}
                      <td style={{ fontSize: '0.85rem', color: isCancelled ? '#dc2626' : '#475569', whiteSpace: 'nowrap' }}>
                        {toDisplay(it.travel_end_date)}
                      </td>

                      {/* Consultant */}
                      <td style={{ fontSize: '0.85rem', color: isCancelled ? '#dc2626' : '#334155' }}>
                        {it.consultant_name || currentUserName || <span style={{ color: '#cbd5e1' }}>—</span>}
                      </td>

                      {/* Status */}
                      <td>
                        <span className={`status-badge ${it.status || ''}`}>
                          {STATUS_LABELS[it.status] || it.status || '—'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer summary */}
        {!loading && filtered.length > 0 && (
          <div style={{ padding: '0.85rem 1.5rem', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: '#64748b', background: '#fafbfc' }}>
            <span>
              {filtered.length} itinerar{filtered.length === 1 ? 'y' : 'ies'} · {filtered.reduce((s, it) => s + (Array.isArray(it.travellers) ? it.travellers.length : 0), 0)} travelers
            </span>
            <span>
              Sorted by arrival date (ascending) · Cancelled itineraries shown in red
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default Analytics;
