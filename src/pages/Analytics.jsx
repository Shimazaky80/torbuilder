import { useState, useEffect, useCallback, useMemo } from 'react';
import SearchableSelect from '../components/SearchableSelect';
import StatCard from '../components/StatCard';
import { supabase, getLoggedInUserName } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import { vocabularyNames, vocabularyReadFilter } from '../lib/companyVocabulary';
import { scopeCompanyId } from '../lib/tenantScope';
import { useSession } from '../hooks/useSession';
import { useCurrencies } from '../hooks/useCurrencies';
import SortableTabs, { readStoredTab, writeStoredTab } from '../components/SortableTabs';
import { fmtMoney } from '../lib/invoiceDoc';
import {
  buildAnalyticsReports,
  inReportRange,
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
  FileText,
  AlertTriangle,
  Truck,
  ChevronDown
} from 'lucide-react';

/* ─── Sections ─────────────────────────────────────────────────────────────── */

const ANALYTICS_TABS_KEY = 'torbuilder.analytics.tabs.v1';
const ANALYTICS_TABS = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'consultants', label: 'Consultants', icon: Users, adminOnly: true },
  { id: 'clients', label: 'Clients', icon: Building2, adminOnly: true },
  { id: 'suppliers', label: 'Suppliers', icon: Truck, adminOnly: true },
  { id: 'financials', label: 'Financials', icon: CircleDollarSign },
  { id: 'checklist', label: 'Checklist', icon: FileText }
];
const REPORT_TAB_IDS = ['overview', 'consultants', 'clients', 'suppliers', 'financials'];

const EMPTY_REPORT_FILTERS = {
  consultant: '',
  dateBasis: 'travel',
  from: '',
  to: '',
  status: '',
  tourType: '',
  clientId: '',
  financialBasis: 'all',
  lossFilter: 'all',
  minRevenue: ''
};
const makeFiltersByTab = () => Object.fromEntries(
  REPORT_TAB_IDS.map((id) => [id, { ...EMPTY_REPORT_FILTERS }])
);

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

const htmlEscape = (v) =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

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

const PREVIEW_ROWS = 10;

const ReportPanel = ({ title, subtitle, columns, rows, empty = 'No records match the selected filters.', onExport, headerExtra }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const visibleRows = showAll ? rows : rows.slice(0, PREVIEW_ROWS);
  const hasMore = rows.length > PREVIEW_ROWS;

  return (
    <section className="admin-table-container" style={{ marginBottom: '1.5rem', overflow: 'hidden' }}>
      <div
        style={{ padding: '1rem 1.25rem', borderBottom: collapsed ? 'none' : '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setCollapsed((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCollapsed((v) => !v); } }}
        aria-expanded={!collapsed}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap', minWidth: 0 }}>
          <ChevronDown size={16} color="#64748b" style={{ flexShrink: 0, transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }} />
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>{title}</h2>
          <span style={{ fontSize: '0.72rem', color: '#64748b', background: '#f1f5f9', borderRadius: '999px', padding: '0.1rem 0.5rem', fontWeight: 600 }}>{rows.length}</span>
          {subtitle && <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{subtitle}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
          {headerExtra}
          {onExport && (
            <button
              type="button"
              onClick={onExport}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.35rem 0.7rem', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#fff', color: '#475569', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
              title={`Export ${title}`}
            >
              <FileSpreadsheet size={14} /> Export
            </button>
          )}
        </div>
      </div>
      {!collapsed && (
        <>
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
                ) : visibleRows.map((row, index) => (
                  <tr key={row.key || row.id || index}>
                    {columns.map((column) => (
                      <td key={column.key} style={column.align ? { textAlign: column.align } : undefined}>
                        {column.render ? column.render(row) : (row[column.key] ?? '-')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                style={{ padding: '0.4rem 0.9rem', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#f8fafc', color: '#0d7478', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}
              >
                {showAll ? 'Show less' : `Show all ${rows.length} rows`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
};

/* One card, many owners: each report tab passes its own filter object here, so
   changing a filter in one section cannot leak into another. overflow:visible
   lets the searchable dropdowns sit above the panels below. */
const ReportFilters = ({
  filters,
  onChange,
  onClear,
  isConsultant,
  consultantOptions,
  tourTypes,
  clientOptions
}) => (
  <div className="admin-table-container" style={{ padding: '1.15rem 1.25rem', marginBottom: '1.5rem', overflow: 'visible', position: 'relative', zIndex: 20 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Calculator size={18} color="#0d7478" /> Report filters
      </h2>
      <button
        type="button"
        className="icon-btn outline"
        onClick={onClear}
        style={{ padding: '0.4rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem', border: '1px solid #e2e8f0', borderRadius: '9px', background: '#fff', color: '#64748b', fontSize: '0.8rem', cursor: 'pointer' }}
      >
        <FilterX size={14} /> Clear filters
      </button>
    </div>
    <div style={{ display: 'flex', gap: '0.85rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
      {!isConsultant && (
        <FilterField label="Consultant">
          <SearchableSelect className="pricing-select" style={filterSelectStyle} value={filters.consultant} onChange={(e) => onChange('consultant', e.target.value)}>
            <option value="">All consultants</option>
            {consultantOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </SearchableSelect>
        </FilterField>
      )}
      <FilterField label="Date basis">
        <SearchableSelect className="pricing-select" style={filterSelectStyle} value={filters.dateBasis} onChange={(e) => onChange('dateBasis', e.target.value)}>
          {REPORT_DATE_BASES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </SearchableSelect>
      </FilterField>
      <FilterField label="From">
        <input type="date" style={filterInputStyle} value={filters.from} onChange={(e) => onChange('from', e.target.value)} />
      </FilterField>
      <FilterField label="To">
        <input type="date" style={filterInputStyle} value={filters.to} onChange={(e) => onChange('to', e.target.value)} />
      </FilterField>
      <FilterField label="Status">
        <SearchableSelect className="pricing-select" style={filterSelectStyle} value={filters.status} onChange={(e) => onChange('status', e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          <option value="pending_confirmation">Pending Confirmation</option>
        </SearchableSelect>
      </FilterField>
      <FilterField label="Tour type">
        <SearchableSelect className="pricing-select" style={filterSelectStyle} value={filters.tourType} onChange={(e) => onChange('tourType', e.target.value)}>
          <option value="">All tour types</option>
          {tourTypes.map((tourType) => <option key={tourType} value={tourType}>{tourType}</option>)}
        </SearchableSelect>
      </FilterField>
      <FilterField label="Client">
        <SearchableSelect className="pricing-select" style={{ ...filterSelectStyle, minWidth: '180px' }} value={filters.clientId} onChange={(e) => onChange('clientId', e.target.value)}>
          <option value="">All clients</option>
          {clientOptions.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
        </SearchableSelect>
      </FilterField>
      <FilterField label="Trip scope">
        <SearchableSelect className="pricing-select" style={{ ...filterSelectStyle, minWidth: '210px' }} value={filters.financialBasis} onChange={(e) => onChange('financialBasis', e.target.value)}>
          {REPORT_FINANCIAL_BASES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </SearchableSelect>
      </FilterField>
      <FilterField label="Profit / loss">
        <SearchableSelect className="pricing-select" style={filterSelectStyle} value={filters.lossFilter} onChange={(e) => onChange('lossFilter', e.target.value)}>
          {REPORT_LOSS_FILTERS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </SearchableSelect>
      </FilterField>
      <FilterField label="Min revenue">
        <input type="number" min="0" step="0.01" style={filterInputStyle} placeholder="Any" value={filters.minRevenue} onChange={(e) => onChange('minRevenue', e.target.value)} />
      </FilterField>
    </div>
    <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0.8rem 0 0' }}>
      Filters update the reports immediately — no search button needed. Use Refresh to reload the latest data from the database.
      {isConsultant && ' Reports are limited to itineraries you created.'}
    </p>
  </div>
);

/* ─── Excel Export ─────────────────────────────────────────────────────────── */

const xlsSummaryHtml = (lines = []) => (lines.length
  ? `<p style="color:#64748b;font-size:11px;font-family:Calibri,Arial,sans-serif;line-height:1.5;">${lines.map((line) => htmlEscape(line)).join('<br>')}</p>`
  : '');

const xlsFilename = (label) => String(label || 'analytics')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'analytics';

/* The report tabs render several panels. Exporting one flat list would no longer
   match what is on screen, so every visible panel becomes its own section with
   the same headings and the same plain-text values. */
const buildAnalyticsXls = ({ title, sections = [], filterSummary = [] }) => {
  const esc = htmlEscape;
  const sectionHtml = sections.map((section) => {
    const columns = section.columns || [];
    const header = `<tr>${columns.map((column) => `<th style="background:#0d7478;color:#fff;font-weight:700;padding:8px 12px;white-space:nowrap;border:1px solid #0a5c60;">${esc(column.label)}</th>`).join('')}</tr>`;
    const body = section.rows?.length
      ? section.rows.map((row) => `<tr>${columns.map((column) => {
        const value = column.exportValue ? column.exportValue(row) : (row[column.key] ?? '—');
        return `<td style="border:1px solid #e2e8f0;padding:7px 10px;">${esc(value)}</td>`;
      }).join('')}</tr>`).join('')
      : `<tr><td colspan="${Math.max(columns.length, 1)}" style="border:1px solid #e2e8f0;padding:12px;color:#64748b;text-align:center;">${esc(section.empty || 'No records match the selected filters.')}</td></tr>`;
    return `
      <h3 style="color:#1e293b;font-family:Calibri,Arial,sans-serif;margin:1.5rem 0 0.25rem;">${esc(section.title)}</h3>
      ${section.subtitle ? `<p style="color:#94a3b8;font-size:11px;font-family:Calibri,Arial,sans-serif;margin:0 0 0.5rem;">${esc(section.subtitle)}</p>` : ''}
      <table><thead>${header}</thead><tbody>${body}</tbody></table>`;
  }).join('');

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><meta name="ProgId" content="Excel.Sheet">
<style>
  body { font-family: Calibri, Arial, sans-serif; font-size: 12px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 1.25rem; }
</style>
</head>
<body>
<h2 style="color:#0d7478;font-family:Calibri,Arial,sans-serif;">${esc(title)}</h2>
<p style="color:#64748b;font-size:11px;font-family:Calibri,Arial,sans-serif;">Generated: ${new Date().toLocaleDateString('en-GB')}</p>
${xlsSummaryHtml(filterSummary)}
${sectionHtml}
</body></html>`;
};

const buildChecklistXls = (itineraries, defaultConsultant = '', filterSummary = []) => {
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
${xlsSummaryHtml(filterSummary)}
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
  /* The checklist keeps its own controls: the report filters must never hide a
     traveller from the checklist or stop its search from finding one. */
  const [checklistTourTypeFilter, setChecklistTourTypeFilter] = useState('');
  const [checklistStatusFilter, setChecklistStatusFilter] = useState('');
  const [checklistConsultantFilter, setChecklistConsultantFilter] = useState('');
  const [checklistClientFilter, setChecklistClientFilter] = useState('');
  const [checklistDateFrom, setChecklistDateFrom] = useState('');
  const [checklistDateTo, setChecklistDateTo] = useState('');
  const [tourTypes, setTourTypes] = useState([]);
  const [currentUserName, setCurrentUserName] = useState('');
  const [dayItems, setDayItems] = useState([]);
  const [clientOptions, setClientOptions] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [rateAnalysisRows, setRateAnalysisRows] = useState([]);
  const [topPerformerType, setTopPerformerType] = useState('all');
  const [consultantOptions, setConsultantOptions] = useState([]);
  /* Each report section owns a full filter set. The checklist never reads this
     state — it uses the checklist* controls and searchQuery below. */
  const [filtersByTab, setFiltersByTab] = useState(makeFiltersByTab);
  const visibleTabs = useMemo(
    () => isConsultant ? ANALYTICS_TABS.filter((tab) => !tab.adminOnly) : ANALYTICS_TABS,
    [isConsultant]
  );
  const visibleTabIds = useMemo(() => visibleTabs.map((tab) => tab.id), [visibleTabs]);
  const [storedActiveTab, setStoredActiveTab] = useState(
    () => readStoredTab(ANALYTICS_TABS_KEY, visibleTabIds, 'overview')
  );
  /* A stored admin section must not survive for a consultant: derive a visible
     tab instead of keeping an unreachable one on screen. */
  const activeTab = visibleTabIds.includes(storedActiveTab)
    ? storedActiveTab
    : (visibleTabIds[0] ?? 'overview');
  const setActiveTab = useCallback((id) => {
    const next = visibleTabIds.includes(id) ? id : (visibleTabIds[0] ?? 'overview');
    setStoredActiveTab(next);
  }, [visibleTabIds]);
  useEffect(() => {
    writeStoredTab(ANALYTICS_TABS_KEY, activeTab);
  }, [activeTab]);
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
      { data: clientRows, error: clientError },
      { data: supplierRows, error: supplierError },
      { data: companyRow }
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
        .order('name', { ascending: true }),
      supabase
        .from('suppliers')
        .select('*')
        .eq('company_id', companyId)
        .order('name', { ascending: true }),
      supabase
        .from('companies')
        .select('name')
        .eq('id', companyId)
        .maybeSingle()
    ]);

    if (error) throw error;
    if (tourTypeError) throw tourTypeError;
    if (clientError) throw clientError;
    if (supplierError) throw supplierError;
    const companyName = companyRow?.name || '';
    const normalizeCompanyKey = (value) => String(value || '')
      .toLowerCase()
      .replace(/\(pty\)|\bpty\b|\bltd\b|\blimited\b|\binc\b|\bllc\b|\bcc\b|\bcompany\b|\bco\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    const companyKey = normalizeCompanyKey(companyName);
    const canonicalUsername = String(username || sessionName || '').trim();

    const isCompanyNameConsultant = (value) => {
      const k = normalizeCompanyKey(value);
      return !!k && !!companyKey && k === companyKey;
    };

    const visibleItineraries = (isConsultant
      ? (data || []).filter((it) => it.created_by === userId
        || (!it.created_by && (String(it.consultant_name || '').trim() === canonicalUsername || isCompanyNameConsultant(it.consultant_name))))
      : data || []
    ).map((it) => {
      const rawConsultant = String(it.consultant_name || '').trim();
      const consultantKey = normalizeCompanyKey(rawConsultant);
      const isCompanyName = !!consultantKey && !!companyKey && consultantKey === companyKey;
      if (!isCompanyName) return it;
      const isOwn = it.created_by === userId || (!it.created_by && !!canonicalUsername);
      return { ...it, consultant_name: isOwn ? (canonicalUsername || rawConsultant) : '' };
    });

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
          'itinerary_day_id, item_name, category, supplier_id, supplier_name, currency_code, total_buy, total_sell, unit_cost, unit_price, item_price_per_person, pax, tax_rate, is_included, supplier_paid, supplier_paid_at, supplier_paid_ref',
          'itinerary_day_id',
          dayIds
        );
        items = (rawItems || [])
          .map((item) => ({ ...item, itinerary_id: itineraryOfDay.get(item.itinerary_day_id) }))
          .filter((item) => item.itinerary_id);
      }
    }

    let rateAnalysisRows = [];
    try {
      const { data: libItems } = await supabase
        .from('library_items')
        .select('id, name, supplier_id, category, currency')
        .eq('company_id', companyId);
      const libItemIds = (libItems || []).map((li) => li.id);
      let rateRows = [];
      if (libItemIds.length) {
        rateRows = await fetchInBatches('item_rates', 'id, item_id, option_name, room_type, season_name, valid_from, valid_to, unit_cost, unit_price, currency', 'item_id', libItemIds);
      }
      const supplierNameById = new Map((supplierRows || []).map((s) => [s.id, s.name || '']));
      const libById = new Map((libItems || []).map((li) => [li.id, li]));
      rateAnalysisRows = (rateRows || []).map((r) => {
        const li = libById.get(r.item_id);
        return { ...r, item_name: li?.name || '', supplier_id: li?.supplier_id || '', supplier_name: supplierNameById.get(li?.supplier_id) || '', category: li?.category || '', item_currency: li?.currency || r.currency || 'ZAR' };
      });
    } catch (_) {
      rateAnalysisRows = [];
    }

    const configuredTypes = vocabularyNames(tourTypeRows);
    const previouslyUsedTypes = visibleItineraries.map((itinerary) => itinerary.itinerary_tour_type).filter(Boolean);
    return {
      username,
      itineraries: visibleItineraries,
      tourTypes: [...new Set([...configuredTypes, ...previouslyUsedTypes])].sort((a, b) => a.localeCompare(b)),
      dayItems: items,
      clients: clientRows || [],
      suppliers: supplierRows || [],
      rateAnalysisRows,
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
    setSuppliers(result.suppliers || []);
    setRateAnalysisRows(result.rateAnalysisRows || []);
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

  /* Plain-text twin of marginCell: the grid needs styled per-currency blocks,
     while the exported workbook needs one line per currency. */
  const marginText = useCallback((byCurrency) => {
    const rows = moneyOf(byCurrency);
    if (!rows.length) return '—';
    return rows.map((row) => `${row.code} ${row.margin == null ? '—' : `${row.margin}%`}`).join('  ·  ');
  }, []);

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

  const deltaText = useCallback((deltaByCurrency, field) => {
    const rows = Object.values(deltaByCurrency || {}).sort((a, b) => a.code.localeCompare(b.code));
    if (!rows.length) return '—';
    return rows.map((row) => {
      const d = row[field] || {};
      const delta = Number(d.delta) || 0;
      const pct = d.pct;
      const sign = delta > 0 ? '+' : delta < 0 ? '-' : '';
      const pctText = pct == null ? 'new' : `${sign}${Math.abs(pct)}%`;
      return `${row.code} ${sign}${formatAmount(Math.abs(delta), row.code)} (${pctText})`;
    }).join('  ·  ');
  }, [formatAmount]);

  const deltaCell = useCallback((deltaByCurrency, field, goodWhenUp = true) => {
    const rows = Object.values(deltaByCurrency || {}).sort((a, b) => a.code.localeCompare(b.code));
    if (!rows.length) return <span style={{ color: '#cbd5e1' }}>—</span>;
    return rows.map((row) => {
      const d = row[field] || {};
      const delta = Number(d.delta) || 0;
      const pct = d.pct;
      if (delta === 0 && pct == null) return <div key={row.code} style={{ whiteSpace: 'nowrap', color: '#94a3b8' }}><span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94a3b8', marginRight: '0.25rem' }}>{row.code}</span>—</div>;
      if (delta === 0) return <div key={row.code} style={{ whiteSpace: 'nowrap', color: '#94a3b8' }}><span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94a3b8', marginRight: '0.25rem' }}>{row.code}</span>0%</div>;
      const up = delta > 0;
      const good = goodWhenUp ? up : !up;
      const color = good ? '#16a34a' : '#dc2626';
      const sign = up ? '+' : '-';
      const pctText = pct == null ? 'new' : `${sign}${Math.abs(pct)}%`;
      return (
        <div key={row.code} style={{ whiteSpace: 'nowrap', color, fontWeight: 700 }}>
          <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94a3b8', marginRight: '0.25rem' }}>{row.code}</span>
          {sign}{formatAmount(Math.abs(delta), row.code)} <span style={{ fontWeight: 600 }}>({pctText})</span>
        </div>
      );
    });
  }, [formatAmount]);

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

  const isReportTab = REPORT_TAB_IDS.includes(activeTab);
  const activeFilters = filtersByTab[activeTab] ?? EMPTY_REPORT_FILTERS;

  const updateActiveFilter = useCallback((key, value) => {
    setFiltersByTab((prev) => ({
      ...prev,
      [activeTab]: { ...(prev[activeTab] ?? EMPTY_REPORT_FILTERS), [key]: value }
    }));
  }, [activeTab]);

  const reportFilters = useMemo(() => ({
    from: activeFilters.from,
    to: activeFilters.to,
    dateBasis: activeFilters.dateBasis,
    consultant: isConsultant ? '' : activeFilters.consultant,
    clientId: activeFilters.clientId,
    status: activeFilters.status,
    tourType: activeFilters.tourType,
    financialBasis: activeFilters.financialBasis,
    lossFilter: activeFilters.lossFilter,
    minRevenue: activeFilters.minRevenue
  }), [activeFilters, isConsultant]);

  const report = useMemo(
    () => buildAnalyticsReports({ itineraries, items: dayItems, filters: reportFilters, suppliers }),
    [itineraries, dayItems, reportFilters, suppliers]
  );

  const rateIncreaseAnalysis = useMemo(() => {
    const byKey = new Map();
    (rateAnalysisRows || []).forEach((r) => {
      const year = String(r.valid_from || r.valid_to || '').slice(0, 4);
      if (!/^\d{4}$/.test(year)) return;
      const key = [r.supplier_id || r.supplier_name || '', r.item_id || '', r.option_name || '', r.room_type || '', r.season_name || ''].join('|');
      if (!byKey.has(key)) byKey.set(key, { supplier: r.supplier_name || 'Unassigned supplier', item: r.item_name || '', option: r.option_name || r.season_name || 'Base Season', roomType: r.room_type || '', category: r.category || '', currency: r.item_currency || r.currency || 'ZAR', years: {} });
      const entry = byKey.get(key);
      const y = entry.years[year] || { cost: 0, price: 0, count: 0 };
      y.cost += Number(r.unit_cost) || 0;
      y.price += Number(r.unit_price) || 0;
      y.count += 1;
      entry.years[year] = y;
    });
    const out = [];
    byKey.forEach((entry) => {
      const years = Object.keys(entry.years).sort();
      for (let i = 1; i < years.length; i++) {
        const prevY = years[i - 1];
        const curY = years[i];
        const prev = entry.years[prevY];
        const cur = entry.years[curY];
        const prevCost = prev.count ? prev.cost / prev.count : 0;
        const curCost = cur.count ? cur.cost / cur.count : 0;
        const prevPrice = prev.count ? prev.price / prev.count : 0;
        const curPrice = cur.count ? cur.price / cur.count : 0;
        const costPct = prevCost > 0 ? round2(((curCost - prevCost) / prevCost) * 100) : (curCost > 0 ? 100 : null);
        const pricePct = prevPrice > 0 ? round2(((curPrice - prevPrice) / prevPrice) * 100) : (curPrice > 0 ? 100 : null);
        if (prevCost === 0 && curCost === 0 && prevPrice === 0 && curPrice === 0) continue;
        out.push({
          key: `${entry.supplier}|${entry.item}|${entry.option}|${entry.roomType}|${prevY}-${curY}`,
          supplier: entry.supplier, item: entry.item, category: entry.category, option: entry.option, roomType: entry.roomType,
          currency: entry.currency, previousYear: prevY, currentYear: curY,
          previousCost: round2(prevCost), currentCost: round2(curCost), costIncreasePct: costPct,
          previousPrice: round2(prevPrice), currentPrice: round2(curPrice), priceIncreasePct: pricePct
        });
      }
    });
    return out.sort((a, b) => (b.costIncreasePct ?? -Infinity) - (a.costIncreasePct ?? -Infinity) || a.supplier.localeCompare(b.supplier));
  }, [rateAnalysisRows]);

  /* Only the section on screen is reset; the other three keep their filters. */
  const clearFilters = useCallback(() => {
    setFiltersByTab((prev) => ({ ...prev, [activeTab]: { ...EMPTY_REPORT_FILTERS } }));
  }, [activeTab]);

  const clearChecklistFilters = () => {
    setSearchQuery('');
    setChecklistConsultantFilter('');
    setChecklistClientFilter('');
    setChecklistDateFrom('');
    setChecklistDateTo('');
    setChecklistStatusFilter('');
    setChecklistTourTypeFilter('');
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
    return itineraries.filter((it) => {
      if (checklistStatusFilter && it.status !== checklistStatusFilter) return false;
      if (checklistTourTypeFilter && it.itinerary_tour_type !== checklistTourTypeFilter) return false;
      if (checklistConsultantFilter && (it.consultant_name || currentUserName) !== checklistConsultantFilter) return false;
      if (checklistClientFilter && (it.client_id || it.clients?.id) !== checklistClientFilter) return false;
      if (!inReportRange(it, { from: checklistDateFrom, to: checklistDateTo, dateBasis: 'travel' })) return false;
      if (!q) return true;
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
  }, [itineraries, searchQuery, checklistStatusFilter, checklistTourTypeFilter, checklistConsultantFilter, checklistClientFilter, checklistDateFrom, checklistDateTo, currentUserName]);

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

  const itineraryRows = useMemo(() => report.rows.map((row) => ({ ...row, key: row.id })), [report.rows]);

  const activeTabLabel = ANALYTICS_TABS.find((tab) => tab.id === activeTab)?.label || 'Analytics';

  /* The panels are described once and used twice: the grid renders them and the
     top-right export writes those same sections out. A report can therefore
     never export a different figure from the one on screen. */
  const reportPanels = {
    overview: [
      {
        title: 'Top performers',
        subtitle: topPerformerType === 'all'
          ? 'Top suppliers, consultants and clients by revenue in the selected period'
          : `Top ${topPerformerType === 'consultant' ? 'consultants' : topPerformerType === 'supplier' ? 'suppliers' : 'clients'} by revenue in the selected period`,
        headerExtra: (
          <select
            value={topPerformerType}
            onChange={(e) => setTopPerformerType(e.target.value)}
            style={{ padding: '0.35rem 0.55rem', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#fff', color: '#334155', fontSize: '0.75rem', fontWeight: 600 }}
            title="Filter top performers by type"
          >
            <option value="all">All types</option>
            <option value="supplier">Suppliers</option>
            <option value="consultant">Consultants</option>
            <option value="client">Clients</option>
          </select>
        ),
        rows: (() => {
          const limit = topPerformerType === 'all' ? 5 : 10;
          const supplierRows = (report.bySupplier || []).slice(0, limit).map((r, i) => ({ key: `s-${r.key}`, rank: i + 1, type: 'Supplier', name: r.supplier, itineraries: r.itineraries, byCurrency: r.byCurrency }));
          const consultantRows = (report.byConsultant || []).slice(0, limit).map((r, i) => ({ key: `c-${r.key}`, rank: i + 1, type: 'Consultant', name: r.key, itineraries: r.itineraries, byCurrency: r.byCurrency }));
          const clientRows = (report.byClient || []).slice(0, limit).map((r, i) => ({ key: `cl-${r.key}`, rank: i + 1, type: 'Client', name: r.key, itineraries: r.itineraries, byCurrency: r.byCurrency }));
          if (topPerformerType === 'supplier') return supplierRows;
          if (topPerformerType === 'consultant') return consultantRows;
          if (topPerformerType === 'client') return clientRows;
          return [...supplierRows, ...consultantRows, ...clientRows];
        })(),
        empty: 'No performance data for the selected filters.',
        columns: [
          { key: 'type', label: 'Type' },
          { key: 'rank', label: '#', align: 'center' },
          { key: 'name', label: 'Name', render: (row) => <strong>{row.name}</strong>, exportValue: (row) => row.name },
          { key: 'itineraries', label: 'Itineraries', align: 'center' },
          { key: 'revenue', label: 'Revenue', render: (row) => moneyCell(row.byCurrency, 'revenue'), exportValue: (row) => moneyText(row.byCurrency, 'revenue') },
          { key: 'profit', label: 'Net profit', render: (row) => moneyCell(row.byCurrency, 'profit'), exportValue: (row) => moneyText(row.byCurrency, 'profit') }
        ]
      },
      {
        title: 'Top 10 Suppliers by Revenue',
        rows: report.topSuppliersByRevenue || [],
        empty: 'No supplier revenue data for the selected filters.',
        columns: [
          { key: 'supplier', label: 'Supplier', render: (row) => <strong>{row.supplier}</strong>, exportValue: (row) => row.supplier },
          { key: 'itineraries', label: 'Itineraries', align: 'center' },
          { key: 'services', label: 'Service lines', align: 'center' },
          { key: 'revenue', label: 'Revenue', render: (row) => moneyCell(row.byCurrency, 'revenue'), exportValue: (row) => moneyText(row.byCurrency, 'revenue') },
          { key: 'profit', label: 'Net profit', render: (row) => moneyCell(row.byCurrency, 'profit'), exportValue: (row) => moneyText(row.byCurrency, 'profit') }
        ]
      },
      {
        title: 'Top 10 Suppliers by Profit',
        rows: report.topSuppliersByProfit || [],
        empty: 'No supplier profit data for the selected filters.',
        columns: [
          { key: 'supplier', label: 'Supplier', render: (row) => <strong>{row.supplier}</strong>, exportValue: (row) => row.supplier },
          { key: 'revenue', label: 'Revenue', render: (row) => moneyCell(row.byCurrency, 'revenue'), exportValue: (row) => moneyText(row.byCurrency, 'revenue') },
          { key: 'cost', label: 'Cost', render: (row) => moneyCell(row.byCurrency, 'cost'), exportValue: (row) => moneyText(row.byCurrency, 'cost') },
          { key: 'profit', label: 'Net profit', render: (row) => moneyCell(row.byCurrency, 'profit'), exportValue: (row) => moneyText(row.byCurrency, 'profit') },
          { key: 'margin', label: 'Margin', render: (row) => marginCell(row.byCurrency), exportValue: (row) => marginText(row.byCurrency) }
        ]
      },
      {
        title: 'Suppliers With No Bookings Last 12 Months',
        subtitle: 'Active suppliers with no included service lines in the last 12 months',
        rows: report.suppliersNoBookingsLast12Months || [],
        empty: 'All active suppliers have bookings in the last 12 months.',
        columns: [
          { key: 'supplier', label: 'Supplier', render: (row) => <strong>{row.supplier}</strong>, exportValue: (row) => row.supplier },
          { key: 'category', label: 'Category', exportValue: (row) => row.category || '—' },
          { key: 'contactPerson', label: 'Contact', exportValue: (row) => row.contactPerson || '—' },
          { key: 'email', label: 'Email', exportValue: (row) => row.email || '—' },
          { key: 'phone', label: 'Phone', exportValue: (row) => row.phone || '—' }
        ]
      },
      {
        title: 'Most Cancelled Suppliers',
        subtitle: 'Suppliers appearing on cancelled itineraries (all visible data)',
        rows: report.mostCancelledSuppliers || [],
        empty: 'No cancelled supplier service lines found.',
        columns: [
          { key: 'supplier', label: 'Supplier', render: (row) => <strong>{row.supplier}</strong>, exportValue: (row) => row.supplier },
          { key: 'cancelledItineraries', label: 'Cancelled itineraries', align: 'center' },
          { key: 'services', label: 'Service lines', align: 'center' },
          { key: 'revenue', label: 'Lost revenue', render: (row) => moneyCell(row.byCurrency, 'revenue'), exportValue: (row) => moneyText(row.byCurrency, 'revenue') },
          { key: 'cost', label: 'Cost exposure', render: (row) => moneyCell(row.byCurrency, 'cost'), exportValue: (row) => moneyText(row.byCurrency, 'cost') }
        ]
      },
      {
        title: 'Highest Margin Suppliers',
        rows: report.highestMarginSuppliers || [],
        empty: 'No supplier margin data for the selected filters.',
        columns: [
          { key: 'supplier', label: 'Supplier', render: (row) => <strong>{row.supplier}</strong>, exportValue: (row) => row.supplier },
          { key: 'revenue', label: 'Revenue', render: (row) => moneyCell(row.byCurrency, 'revenue'), exportValue: (row) => moneyText(row.byCurrency, 'revenue') },
          { key: 'cost', label: 'Cost', render: (row) => moneyCell(row.byCurrency, 'cost'), exportValue: (row) => moneyText(row.byCurrency, 'cost') },
          { key: 'profit', label: 'Net profit', render: (row) => moneyCell(row.byCurrency, 'profit'), exportValue: (row) => moneyText(row.byCurrency, 'profit') },
          { key: 'margin', label: 'Margin', render: (row) => marginCell(row.byCurrency), exportValue: (row) => marginText(row.byCurrency) }
        ]
      },
      {
        title: 'Outstanding Supplier Payments',
        subtitle: 'Unpaid included service lines on confirmed bookings only',
        rows: report.outstandingSupplierPayments || [],
        empty: 'No outstanding supplier payments for confirmed bookings.',
        columns: [
          { key: 'supplier', label: 'Supplier', render: (row) => <strong>{row.supplier}</strong>, exportValue: (row) => row.supplier },
          { key: 'itineraries', label: 'Confirmed itineraries', align: 'center' },
          { key: 'services', label: 'Unpaid lines', align: 'center' },
          { key: 'cost', label: 'Outstanding (buy cost)', render: (row) => moneyCell(row.byCurrency, 'cost'), exportValue: (row) => moneyText(row.byCurrency, 'cost') }
        ]
      },
      {
        title: 'All Suppliers on Credit/Account',
        subtitle: 'Suppliers marked with credit/account payment terms or credit flags',
        rows: report.suppliersOnCredit || [],
        empty: 'No suppliers with credit/account terms found.',
        columns: [
          { key: 'supplier', label: 'Supplier', render: (row) => <strong>{row.supplier}</strong>, exportValue: (row) => row.supplier },
          { key: 'category', label: 'Category', exportValue: (row) => row.category || '—' },
          { key: 'paymentTerms', label: 'Payment terms', exportValue: (row) => row.paymentTerms || '—' },
          { key: 'accountType', label: 'Account type', exportValue: (row) => row.accountType || '—' },
          { key: 'email', label: 'Email', exportValue: (row) => row.email || '—' }
        ]
      },
      {
        title: 'Contracts Expiring Next 90 Days',
        subtitle: 'Supplier contracts with expiry dates in the next 90 days (if contract expiry fields are captured)',
        rows: report.contractsExpiringNext90Days || [],
        empty: 'No supplier contracts expiring in the next 90 days, or contract expiry dates are not captured on supplier records.',
        columns: [
          { key: 'supplier', label: 'Supplier', render: (row) => <strong>{row.supplier}</strong>, exportValue: (row) => row.supplier },
          { key: 'category', label: 'Category', exportValue: (row) => row.category || '—' },
          { key: 'expiryDate', label: 'Expiry date', render: (row) => toDisplay(row.expiryDate), exportValue: (row) => toDisplay(row.expiryDate) },
          { key: 'daysLeft', label: 'Days left', align: 'center' },
          { key: 'email', label: 'Email', exportValue: (row) => row.email || '—' }
        ]
      },
      {
        title: 'Monthly trend',
        subtitle: activeFilters.dateBasis === 'created' ? 'Grouped by itinerary creation month' : 'Grouped by travel start month',
        rows: report.monthly,
        columns: [
          { key: 'month', label: 'Month', render: (row) => <strong>{row.key}</strong>, exportValue: (row) => row.key },
          { key: 'itineraries', label: 'Trips', align: 'center' },
          { key: 'travellers', label: 'Travellers', align: 'center' },
          { key: 'revenue', label: 'Revenue', render: (row) => moneyCell(row.byCurrency, 'revenue'), exportValue: (row) => moneyText(row.byCurrency, 'revenue') },
          { key: 'profit', label: 'Net profit', render: (row) => moneyCell(row.byCurrency, 'profit'), exportValue: (row) => moneyText(row.byCurrency, 'profit') },
          { key: 'loss', label: 'Loss', render: (row) => moneyCell(row.byCurrency, 'loss'), exportValue: (row) => moneyText(row.byCurrency, 'loss') }
        ]
      },
      {
        title: 'Status mix',
        subtitle: 'Where the current bookings sit in the pipeline',
        rows: statusRows,
        columns: [
          { key: 'status', label: 'Status', render: (row) => <span className={`status-badge ${row.status}`}>{row.label}</span>, exportValue: (row) => row.label },
          { key: 'itineraries', label: 'Itineraries', align: 'center' },
          { key: 'share', label: 'Share', align: 'center', render: (row) => `${row.share}%`, exportValue: (row) => `${row.share}%` }
        ]
      },
      {
        title: 'Tour type mix',
        rows: report.byTourType,
        columns: [
          { key: 'tourType', label: 'Tour type', render: (row) => <strong>{row.key}</strong>, exportValue: (row) => row.key },
          { key: 'itineraries', label: 'Itineraries', align: 'center' },
          { key: 'travellers', label: 'Travellers', align: 'center' },
          { key: 'revenue', label: 'Revenue', render: (row) => moneyCell(row.byCurrency, 'revenue'), exportValue: (row) => moneyText(row.byCurrency, 'revenue') },
          { key: 'loss', label: 'Loss', render: (row) => moneyCell(row.byCurrency, 'loss'), exportValue: (row) => moneyText(row.byCurrency, 'loss') }
        ]
      }
    ],
    consultants: [{
      title: 'Revenue & loss by consultant',
      subtitle: 'Itineraries, revenue and loss follow every filter above',
      rows: consultantRows,
      columns: [
        { key: 'consultant', label: 'Consultant', render: (row) => <strong>{row.key}</strong>, exportValue: (row) => row.key },
        { key: 'itineraries', label: 'Trips', align: 'center' },
        { key: 'travellers', label: 'Travellers', align: 'center' },
        ...statusColumns.map((status) => ({
          key: `status_${status}`,
          label: statusLabel(status),
          align: 'center',
          render: (row) => row.statuses[status] || 0,
          exportValue: (row) => row.statuses[status] || 0
        })),
        { key: 'revenue', label: 'Revenue', render: (row) => moneyCell(row.byCurrency, 'revenue'), exportValue: (row) => moneyText(row.byCurrency, 'revenue') },
        { key: 'cost', label: 'Cost', render: (row) => moneyCell(row.byCurrency, 'cost'), exportValue: (row) => moneyText(row.byCurrency, 'cost') },
        { key: 'profit', label: 'Net profit', render: (row) => moneyCell(row.byCurrency, 'profit'), exportValue: (row) => moneyText(row.byCurrency, 'profit') },
        { key: 'loss', label: 'Loss', render: (row) => moneyCell(row.byCurrency, 'loss'), exportValue: (row) => moneyText(row.byCurrency, 'loss') },
        { key: 'margin', label: 'Margin', render: (row) => marginCell(row.byCurrency), exportValue: (row) => marginText(row.byCurrency) }
      ]
    }],
    clients: [
      {
        title: 'Itineraries per client and status',
        subtitle: 'Every client with its status breakdown',
        rows: clientRows,
        columns: [
          { key: 'client', label: 'Client', render: (row) => <strong>{row.key}</strong>, exportValue: (row) => row.key },
          { key: 'itineraries', label: 'Total trips', align: 'center' },
          ...statusColumns.map((status) => ({
            key: `status_${status}`,
            label: statusLabel(status),
            align: 'center',
            render: (row) => row.statuses?.[status] || 0,
            exportValue: (row) => row.statuses?.[status] || 0
          })),
          { key: 'travellers', label: 'Travellers', align: 'center' },
          { key: 'revenue', label: 'Revenue', render: (row) => moneyCell(row.byCurrency, 'revenue'), exportValue: (row) => moneyText(row.byCurrency, 'revenue') }
        ]
      },
      {
        title: 'Revenue & quotations per client',
        subtitle: 'Quotations are counted even when the trip scope is set to booked only',
        rows: clientRows,
        columns: [
          { key: 'client', label: 'Client', render: (row) => <strong>{row.key}</strong>, exportValue: (row) => row.key },
          { key: 'itineraries', label: 'Booked trips', align: 'center' },
          { key: 'quotations', label: 'Quotations', align: 'center' },
          { key: 'revenue', label: 'Revenue', render: (row) => moneyCell(row.byCurrency, 'revenue'), exportValue: (row) => moneyText(row.byCurrency, 'revenue') },
          { key: 'cost', label: 'Cost', render: (row) => moneyCell(row.byCurrency, 'cost'), exportValue: (row) => moneyText(row.byCurrency, 'cost') },
          { key: 'profit', label: 'Net profit', render: (row) => moneyCell(row.byCurrency, 'profit'), exportValue: (row) => moneyText(row.byCurrency, 'profit') },
          { key: 'loss', label: 'Loss', render: (row) => moneyCell(row.byCurrency, 'loss'), exportValue: (row) => moneyText(row.byCurrency, 'loss') },
          { key: 'margin', label: 'Margin', render: (row) => marginCell(row.byCurrency), exportValue: (row) => marginText(row.byCurrency) }
        ]
      }
    ],
    suppliers: [
      {
        title: 'Supplier services sold',
        subtitle: report.supplierPeriod
          ? `Selected period: ${toDisplay(report.supplierPeriod.from)} – ${toDisplay(report.supplierPeriod.to)}`
          : 'How much supplier services were sold in the selected period',
        rows: report.bySupplier,
        empty: 'No supplier service lines match the selected filters.',
        columns: [
          { key: 'supplier', label: 'Supplier', render: (row) => <strong>{row.supplier}</strong>, exportValue: (row) => row.supplier },
          { key: 'categories', label: 'Categories', render: (row) => row.categories.length ? row.categories.join(', ') : '—', exportValue: (row) => row.categories.join(', ') || '—' },
          { key: 'itineraries', label: 'Itineraries', align: 'center' },
          { key: 'services', label: 'Service lines', align: 'center' },
          { key: 'revenue', label: 'Revenue (sell)', render: (row) => moneyCell(row.byCurrency, 'revenue'), exportValue: (row) => moneyText(row.byCurrency, 'revenue') },
          { key: 'cost', label: 'Cost (buy)', render: (row) => moneyCell(row.byCurrency, 'cost'), exportValue: (row) => moneyText(row.byCurrency, 'cost') },
          { key: 'profit', label: 'Net profit', render: (row) => moneyCell(row.byCurrency, 'profit'), exportValue: (row) => moneyText(row.byCurrency, 'profit') },
          { key: 'margin', label: 'Margin', render: (row) => marginCell(row.byCurrency), exportValue: (row) => marginText(row.byCurrency) },
          { key: 'loss', label: 'Loss', render: (row) => moneyCell(row.byCurrency, 'loss'), exportValue: (row) => moneyText(row.byCurrency, 'loss') }
        ]
      },
      {
        title: 'Supplier period comparison',
        subtitle: report.supplierPeriod
          ? `Current: ${toDisplay(report.supplierPeriod.from)} – ${toDisplay(report.supplierPeriod.to)} vs Previous: ${toDisplay(report.supplierPeriod.previousFrom)} – ${toDisplay(report.supplierPeriod.previousTo)}`
          : 'Set a From and To date to compare supplier performance against the previous equivalent period.',
        rows: report.supplierPeriod ? report.supplierComparison : [],
        empty: report.supplierPeriod ? 'No supplier comparison data for the selected periods.' : 'Select a date range to see period-over-period supplier changes.',
        columns: [
          { key: 'supplier', label: 'Supplier', render: (row) => <strong>{row.supplier}</strong>, exportValue: (row) => row.supplier },
          { key: 'curRevenue', label: 'Current revenue', render: (row) => moneyCell(row.current?.byCurrency, 'revenue'), exportValue: (row) => moneyText(row.current?.byCurrency, 'revenue') },
          { key: 'prevRevenue', label: 'Previous revenue', render: (row) => moneyCell(row.previous?.byCurrency, 'revenue'), exportValue: (row) => moneyText(row.previous?.byCurrency, 'revenue') },
          { key: 'revenueDelta', label: 'Revenue change', render: (row) => deltaCell(row.deltaByCurrency, 'revenue', true), exportValue: (row) => deltaText(row.deltaByCurrency, 'revenue') },
          { key: 'curCost', label: 'Current cost', render: (row) => moneyCell(row.current?.byCurrency, 'cost'), exportValue: (row) => moneyText(row.current?.byCurrency, 'cost') },
          { key: 'prevCost', label: 'Previous cost', render: (row) => moneyCell(row.previous?.byCurrency, 'cost'), exportValue: (row) => moneyText(row.previous?.byCurrency, 'cost') },
          { key: 'costDelta', label: 'Cost change', render: (row) => deltaCell(row.deltaByCurrency, 'cost', false), exportValue: (row) => deltaText(row.deltaByCurrency, 'cost') },
          { key: 'profitDelta', label: 'Profit change', render: (row) => deltaCell(row.deltaByCurrency, 'profit', true), exportValue: (row) => deltaText(row.deltaByCurrency, 'profit') },
          { key: 'servicesDelta', label: 'Service lines Δ', align: 'center', render: (row) => {
            const d = Number(row.servicesDelta) || 0;
            if (d === 0) return <span style={{ color: '#94a3b8' }}>—</span>;
            const color = d > 0 ? '#16a34a' : '#dc2626';
            return <span style={{ color, fontWeight: 700 }}>{d > 0 ? '+' : ''}{d}</span>;
          }, exportValue: (row) => { const d = Number(row.servicesDelta) || 0; return d === 0 ? '—' : `${d > 0 ? '+' : ''}${d}`; } }
        ]
      },
      {
        title: 'Supplier monthly booking trends',
        subtitle: activeFilters.dateBasis === 'created' ? 'Monthly supplier service activity by creation month — detect seasonality and forecast demand' : 'Monthly supplier service activity by travel month — detect seasonality and forecast demand',
        rows: report.supplierMonthly || [],
        empty: 'No supplier monthly data for the selected filters.',
        columns: [
          { key: 'month', label: 'Month', render: (row) => <strong>{row.month}</strong>, exportValue: (row) => row.month },
          { key: 'supplier', label: 'Supplier', exportValue: (row) => row.supplier },
          { key: 'itineraries', label: 'Itineraries', align: 'center' },
          { key: 'services', label: 'Service lines', align: 'center' },
          { key: 'revenue', label: 'Revenue', render: (row) => moneyCell(row.byCurrency, 'revenue'), exportValue: (row) => moneyText(row.byCurrency, 'revenue') },
          { key: 'cost', label: 'Cost', render: (row) => moneyCell(row.byCurrency, 'cost'), exportValue: (row) => moneyText(row.byCurrency, 'cost') },
          { key: 'profit', label: 'Net profit', render: (row) => moneyCell(row.byCurrency, 'profit'), exportValue: (row) => moneyText(row.byCurrency, 'profit') }
        ]
      },
      {
        title: 'Supplier spend concentration',
        subtitle: 'Share of total supplier buy cost and sell revenue in the selected period — useful for negotiation leverage',
        rows: report.bySupplier.map((row) => {
          const totalRevenue = report.bySupplier.reduce((s, r) => s + Object.values(r.byCurrency || {}).reduce((a, m) => a + (Number(m.revenue) || 0), 0), 0);
          const totalCost = report.bySupplier.reduce((s, r) => s + Object.values(r.byCurrency || {}).reduce((a, m) => a + (Number(m.cost) || 0), 0), 0);
          const rev = Object.values(row.byCurrency || {}).reduce((a, m) => a + (Number(m.revenue) || 0), 0);
          const cost = Object.values(row.byCurrency || {}).reduce((a, m) => a + (Number(m.cost) || 0), 0);
          return {
            ...row,
            revenueShare: totalRevenue > 0 ? round2((rev / totalRevenue) * 100) : 0,
            costShare: totalCost > 0 ? round2((cost / totalCost) * 100) : 0
          };
        }),
        empty: 'No supplier service lines match the selected filters.',
        columns: [
          { key: 'supplier', label: 'Supplier', render: (row) => <strong>{row.supplier}</strong>, exportValue: (row) => row.supplier },
          { key: 'revenue', label: 'Revenue (sell)', render: (row) => moneyCell(row.byCurrency, 'revenue'), exportValue: (row) => moneyText(row.byCurrency, 'revenue') },
          { key: 'revenueShare', label: 'Revenue share', align: 'center', render: (row) => `${row.revenueShare}%`, exportValue: (row) => `${row.revenueShare}%` },
          { key: 'cost', label: 'Cost (buy)', render: (row) => moneyCell(row.byCurrency, 'cost'), exportValue: (row) => moneyText(row.byCurrency, 'cost') },
          { key: 'costShare', label: 'Cost share', align: 'center', render: (row) => `${row.costShare}%`, exportValue: (row) => `${row.costShare}%` },
          { key: 'itineraries', label: 'Itineraries', align: 'center' },
          { key: 'services', label: 'Service lines', align: 'center' }
        ]
      },
      {
        title: 'Supplier services by category',
        subtitle: 'Which supplier service categories drive spend and revenue in the selected period',
        rows: report.bySupplierCategory || [],
        empty: 'No supplier service lines match the selected filters.',
        columns: [
          { key: 'supplier', label: 'Supplier', render: (row) => <strong>{row.supplier}</strong>, exportValue: (row) => row.supplier },
          { key: 'category', label: 'Category', exportValue: (row) => row.category },
          { key: 'itineraries', label: 'Itineraries', align: 'center' },
          { key: 'services', label: 'Service lines', align: 'center' },
          { key: 'revenue', label: 'Revenue (sell)', render: (row) => moneyCell(row.byCurrency, 'revenue'), exportValue: (row) => moneyText(row.byCurrency, 'revenue') },
          { key: 'cost', label: 'Cost (buy)', render: (row) => moneyCell(row.byCurrency, 'cost'), exportValue: (row) => moneyText(row.byCurrency, 'cost') },
          { key: 'profit', label: 'Net profit', render: (row) => moneyCell(row.byCurrency, 'profit'), exportValue: (row) => moneyText(row.byCurrency, 'profit') },
          { key: 'margin', label: 'Margin', render: (row) => marginCell(row.byCurrency), exportValue: (row) => marginText(row.byCurrency) }
        ]
      },
      {
        title: 'Rate increase analysis',
        subtitle: 'Year-to-year supplier rate comparison from library item rates — evaluate if increases are justified',
        rows: rateIncreaseAnalysis,
        empty: 'No year-to-year rate comparison data available.',
        columns: [
          { key: 'supplier', label: 'Supplier', render: (row) => <strong>{row.supplier}</strong>, exportValue: (row) => row.supplier },
          { key: 'item', label: 'Item', exportValue: (row) => row.item },
          { key: 'option', label: 'Season/Option', render: (row) => [row.option, row.roomType].filter(Boolean).join(' · '), exportValue: (row) => [row.option, row.roomType].filter(Boolean).join(' · ') },
          { key: 'previousYear', label: 'Prev year', align: 'center' },
          { key: 'previousCost', label: 'Prev cost', render: (row) => `${row.currency} ${formatAmount(row.previousCost, row.currency)}`, exportValue: (row) => `${row.currency} ${formatAmount(row.previousCost, row.currency)}` },
          { key: 'currentYear', label: 'Curr year', align: 'center' },
          { key: 'currentCost', label: 'Curr cost', render: (row) => `${row.currency} ${formatAmount(row.currentCost, row.currency)}`, exportValue: (row) => `${row.currency} ${formatAmount(row.currentCost, row.currency)}` },
          { key: 'costIncreasePct', label: 'Cost change', align: 'center', render: (row) => {
            const p = row.costIncreasePct;
            if (p == null) return <span style={{ color: '#94a3b8' }}>—</span>;
            const up = p > 0;
            const color = p === 0 ? '#94a3b8' : (up ? '#dc2626' : '#16a34a');
            return <span style={{ color, fontWeight: 700 }}>{up ? '+' : ''}{p}%</span>;
          }, exportValue: (row) => row.costIncreasePct == null ? '—' : `${row.costIncreasePct > 0 ? '+' : ''}${row.costIncreasePct}%` },
          { key: 'priceIncreasePct', label: 'Sell change', align: 'center', render: (row) => {
            const p = row.priceIncreasePct;
            if (p == null) return <span style={{ color: '#94a3b8' }}>—</span>;
            const up = p > 0;
            const color = p === 0 ? '#94a3b8' : (up ? '#16a34a' : '#dc2626');
            return <span style={{ color, fontWeight: 700 }}>{up ? '+' : ''}{p}%</span>;
          }, exportValue: (row) => row.priceIncreasePct == null ? '—' : `${row.priceIncreasePct > 0 ? '+' : ''}${row.priceIncreasePct}%` }
        ]
      }
    ],
    financials: [
      {
        title: 'Loss-making itineraries',
        subtitle: 'Trips sold below their buy cost — a profitable month can hide these',
        rows: report.lossMaking,
        empty: 'No loss-making itineraries in this period.',
        columns: [
          { key: 'reference', label: 'Reference', render: (row) => <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0d7478' }}>{row.reference}</span>, exportValue: (row) => row.reference },
          { key: 'client', label: 'Client' },
          ...(isConsultant ? [] : [{ key: 'consultant', label: 'Consultant' }]),
          { key: 'dates', label: 'Travel dates', render: (row) => `${toDisplay(row.start)} – ${toDisplay(row.end)}`, exportValue: (row) => `${toDisplay(row.start)} – ${toDisplay(row.end)}` },
          { key: 'revenue', label: 'Revenue', render: (row) => moneyCell(row.financials, 'revenue'), exportValue: (row) => moneyText(row.financials, 'revenue') },
          { key: 'cost', label: 'Cost', render: (row) => moneyCell(row.financials, 'cost'), exportValue: (row) => moneyText(row.financials, 'cost') },
          { key: 'loss', label: 'Loss', render: (row) => moneyCell(row.financials, 'loss'), exportValue: (row) => moneyText(row.financials, 'loss') }
        ]
      },
      {
        title: isConsultant ? 'Your itineraries — financials' : 'Itinerary financials',
        subtitle: 'Per-itinerary figures behind the totals',
        rows: itineraryRows,
        columns: [
          { key: 'reference', label: 'Reference', render: (row) => <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0d7478' }}>{row.reference}</span>, exportValue: (row) => row.reference },
          { key: 'client', label: 'Client' },
          { key: 'name', label: 'Tour name' },
          { key: 'dates', label: 'Travel dates', render: (row) => `${toDisplay(row.start)} – ${toDisplay(row.end)}`, exportValue: (row) => `${toDisplay(row.start)} – ${toDisplay(row.end)}` },
          ...(isConsultant ? [] : [{ key: 'consultant', label: 'Consultant' }]),
          { key: 'status', label: 'Status', render: (row) => <span className={`status-badge ${row.status}`}>{statusLabel(row.status)}</span>, exportValue: (row) => statusLabel(row.status) },
          { key: 'travellers', label: 'Travellers', align: 'center' },
          { key: 'revenue', label: 'Revenue', render: (row) => moneyCell(row.financials, 'revenue'), exportValue: (row) => moneyText(row.financials, 'revenue') },
          { key: 'cost', label: 'Cost', render: (row) => moneyCell(row.financials, 'cost'), exportValue: (row) => moneyText(row.financials, 'cost') },
          { key: 'profit', label: 'Net profit', render: (row) => moneyCell(row.financials, 'profit'), exportValue: (row) => moneyText(row.financials, 'profit') },
          { key: 'loss', label: 'Loss', render: (row) => moneyCell(row.financials, 'loss'), exportValue: (row) => moneyText(row.financials, 'loss') }
        ]
      }
    ]
  };

  /* Export the same slice the person is looking at, including the filter values
     that produced it. The checklist uses its own independent controls. */
  const reportFilterSummary = [
    `Section: ${activeTabLabel}`,
    `Date basis: ${REPORT_DATE_BASES.find((option) => option.id === activeFilters.dateBasis)?.label || 'Travel dates'}`,
    activeFilters.from && `From: ${toDisplay(activeFilters.from)}`,
    activeFilters.to && `To: ${toDisplay(activeFilters.to)}`,
    !isConsultant && activeFilters.consultant && `Consultant: ${activeFilters.consultant}`,
    activeFilters.clientId && `Client: ${clientOptions.find((client) => client.id === activeFilters.clientId)?.name || activeFilters.clientId}`,
    activeFilters.status && `Status: ${statusLabel(activeFilters.status)}`,
    activeFilters.tourType && `Tour type: ${activeFilters.tourType}`,
    `Trip scope: ${REPORT_FINANCIAL_BASES.find((option) => option.id === activeFilters.financialBasis)?.label || 'All itineraries'}`,
    activeFilters.lossFilter !== 'all' && `Profit/loss: ${REPORT_LOSS_FILTERS.find((option) => option.id === activeFilters.lossFilter)?.label || activeFilters.lossFilter}`,
    activeFilters.minRevenue && `Minimum revenue: ${activeFilters.minRevenue}`
  ].filter(Boolean);

  const checklistFilterSummary = [
    'Section: Checklist',
    searchQuery.trim() && `Search: ${searchQuery.trim()}`,
    checklistConsultantFilter && `Consultant: ${checklistConsultantFilter}`,
    checklistClientFilter && `Client: ${clientOptions.find((client) => client.id === checklistClientFilter)?.name || checklistClientFilter}`,
    checklistDateFrom && `Travel from: ${toDisplay(checklistDateFrom)}`,
    checklistDateTo && `Travel to: ${toDisplay(checklistDateTo)}`,
    checklistTourTypeFilter && `Tour type: ${checklistTourTypeFilter}`,
    checklistStatusFilter && `Status: ${statusLabel(checklistStatusFilter)}`
  ].filter(Boolean);

  /* ─── Export ────────────────────────────────────────────────────────────── */

  const handleExport = () => {
    const date = new Date().toISOString().slice(0, 10);

    if (activeTab === 'checklist') {
      if (!filtered.length) {
        showToast('No records to export', 'warning');
        return;
      }
      downloadBlob(
        buildChecklistXls(filtered, currentUserName, checklistFilterSummary),
        `travelers-checklist-${date}.xls`,
        'application/vnd.ms-excel'
      );
      showToast('Travelers checklist exported as Excel', 'success');
      return;
    }

    const sections = reportPanels[activeTab] || [];
    if (!sections.some((section) => section.rows?.length)) {
      showToast('No records to export', 'warning');
      return;
    }
    downloadBlob(
      buildAnalyticsXls({
        title: `${activeTabLabel} — Analytics`,
        sections,
        filterSummary: reportFilterSummary
      }),
      `${xlsFilename(activeTabLabel)}-analytics-${date}.xls`,
      'application/vnd.ms-excel'
    );
    showToast(`${activeTabLabel} report exported as Excel`, 'success');
  };

  /* The same control card is mounted for whichever report section is active,
     but it always reads and writes that section's own slice of filtersByTab. */
  const reportFilterControls = (
    <ReportFilters
      filters={activeFilters}
      onChange={updateActiveFilter}
      onClear={clearFilters}
      isConsultant={isConsultant}
      consultantOptions={consultantOptions}
      tourTypes={tourTypes}
      clientOptions={clientOptions}
    />
  );

  const emptyReportNotice = !loading && itineraries.length > 0 && report.rows.length === 0 ? (
    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', padding: '1rem 1.25rem', marginBottom: '1.5rem', border: '1px solid #fde68a', borderRadius: '12px', background: '#fffbeb', color: '#92400e' }}>
      <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
      <div style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>
        <strong>No itineraries match the current report filters.</strong>
        <div>The Travelers Checklist tab is unaffected and still shows all {itineraries.length} itineraries.</div>
        {activeFilters.financialBasis === 'booked' && (
          <div>All visible files are currently quotations — change <strong>Trip scope</strong> to “All itineraries (quotations included)” to see their financials.</div>
        )}
        <button
          type="button"
          onClick={clearFilters}
          style={{ marginTop: '0.5rem', padding: '0.35rem 0.7rem', border: '1px solid #fcd34d', borderRadius: '8px', background: '#fff', color: '#92400e', fontWeight: 700, cursor: 'pointer', fontSize: '0.8rem' }}
        >
          Reset report filters
        </button>
      </div>
    </div>
  ) : null;

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
            title={`Export ${activeTabLabel} data`}
          >
            <FileSpreadsheet size={17} /> Export {activeTabLabel}
          </button>
        </div>
      </header>

      <SortableTabs
        tabs={visibleTabs}
        value={activeTab}
        onChange={setActiveTab}
        storageKey={ANALYTICS_TABS_KEY}
        ariaLabel="Analytics sections"
      />

      {isReportTab && reportFilterControls}
      {isReportTab && emptyReportNotice}

      {/* Stats Grid — overview only */}
      {activeTab === 'overview' && (
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
      )}

      {/* One render path for every report panel, driven by the descriptors the
          export also uses, so the workbook always matches the visible grid. */}
      {isReportTab && (reportPanels[activeTab] || []).map((panel) => (
        <ReportPanel
          key={panel.title}
          {...panel}
          onExport={() => {
            if (!panel.rows?.length) {
              showToast('No records to export', 'warning');
              return;
            }
            const date = new Date().toISOString().slice(0, 10);
            downloadBlob(
              buildAnalyticsXls({
                title: `${panel.title} — ${activeTabLabel}`,
                sections: [panel],
                filterSummary: reportFilterSummary
              }),
              `${xlsFilename(panel.title)}-${date}.xls`,
              'application/vnd.ms-excel'
            );
            showToast(`${panel.title} exported as Excel`, 'success');
          }}
        />
      ))}

      {/* Checklist Table — overflow visible so its own dropdowns are not clipped */}
      {activeTab === 'checklist' && (
      <div className="admin-table-container" style={{ overflow: 'visible', position: 'relative', zIndex: 10 }}>
        {/* Table toolbar — title first, then a full-width filter row that wraps */}
        <div className="table-header-actions" style={{ display: 'block', padding: '1.25rem 1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Users size={18} color="#0d7478" /> Travelers Checklist
            </h2>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#64748b' }}>
              ({filtered.length} of {itineraries.length})
            </span>
            <span style={{ fontSize: '0.7rem', fontWeight: 500, color: '#94a3b8' }}>
              independent filters
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: '0.85rem', alignItems: 'end' }}>
            <FilterField label="Search">
              <div className="search-box" style={{ width: '100%' }}>
                <Search size={15} />
                <input
                  type="text"
                  placeholder="Reference, client, tour, consultant…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </FilterField>
            <FilterField label="Consultant">
              <SearchableSelect
                className="pricing-select"
                style={{ ...filterSelectStyle, width: '100%', minWidth: 0 }}
                value={checklistConsultantFilter}
                onChange={(e) => setChecklistConsultantFilter(e.target.value)}
              >
                <option value="">All consultants</option>
                {consultantOptions.map((name) => <option key={name} value={name}>{name}</option>)}
              </SearchableSelect>
            </FilterField>
            <FilterField label="Client">
              <SearchableSelect
                className="pricing-select"
                style={{ ...filterSelectStyle, width: '100%', minWidth: 0 }}
                value={checklistClientFilter}
                onChange={(e) => setChecklistClientFilter(e.target.value)}
              >
                <option value="">All clients</option>
                {clientOptions.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </SearchableSelect>
            </FilterField>
            <FilterField label="Travel from">
              <input type="date" style={{ ...filterInputStyle, width: '100%' }} value={checklistDateFrom} onChange={(e) => setChecklistDateFrom(e.target.value)} />
            </FilterField>
            <FilterField label="Travel to">
              <input type="date" style={{ ...filterInputStyle, width: '100%' }} value={checklistDateTo} onChange={(e) => setChecklistDateTo(e.target.value)} />
            </FilterField>
            <FilterField label="Tour type">
              <SearchableSelect
                className="pricing-select"
                style={{ ...filterSelectStyle, width: '100%', minWidth: 0 }}
                value={checklistTourTypeFilter}
                onChange={(e) => setChecklistTourTypeFilter(e.target.value)}
              >
                <option value="">All tour types</option>
                {tourTypes.map((tourType) => <option key={tourType} value={tourType}>{tourType}</option>)}
              </SearchableSelect>
            </FilterField>
            <FilterField label="Status">
              <SearchableSelect
                className="pricing-select"
                style={{ ...filterSelectStyle, width: '100%', minWidth: 0 }}
                value={checklistStatusFilter}
                onChange={(e) => setChecklistStatusFilter(e.target.value)}
              >
                <option value="">All statuses</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                <option value="pending_confirmation">Pending Confirmation</option>
              </SearchableSelect>
            </FilterField>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.85rem' }}>
            <button
              type="button"
              className="icon-btn outline"
              onClick={clearChecklistFilters}
              style={{ padding: '0.5rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem', border: '1px solid #e2e8f0', borderRadius: '9px', background: '#fff', color: '#64748b', fontSize: '0.8rem', cursor: 'pointer' }}
            >
              <FilterX size={14} /> Clear
            </button>
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
      )}
    </div>
  );
};

export default Analytics;
