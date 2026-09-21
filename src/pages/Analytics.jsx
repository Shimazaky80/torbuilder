import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase, getLoggedInUserName } from '../lib/supabase';
import { useToast } from '../context/ToastContext';
import {
  BarChart3,
  Users,
  FileSpreadsheet,
  Search,
  Building2,
  User,
  Calendar,
  RefreshCw,
  TrendingUp
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

/* ─── Stat Card ────────────────────────────────────────────────────────────── */

const StatCard = ({ icon: Icon, label, value, sub, color = '#0d7478' }) => (
  <div className="stat-card" style={{ position: 'relative', overflow: 'hidden' }}>
    <div style={{ width: '4px', position: 'absolute', left: 0, top: 0, bottom: 0, background: color, borderRadius: '4px 0 0 4px' }} />
    <div style={{ paddingLeft: '0.5rem', display: 'flex', alignItems: 'center', gap: '1rem', width: '100%' }}>
      <div style={{ background: `${color}18`, borderRadius: '12px', padding: '10px', flexShrink: 0 }}>
        <Icon size={22} style={{ color }} />
      </div>
      <div className="stat-info">
        <div className="stat-value" style={{ color: '#1a202c' }}>{value}</div>
        <div className="stat-label">{label}</div>
        {sub && <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.1rem' }}>{sub}</div>}
      </div>
    </div>
  </div>
);

/* ─── Main Analytics Page ──────────────────────────────────────────────────── */

export const Analytics = () => {
  const { showToast } = useToast();
  const [itineraries, setItineraries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [tourTypeFilter, setTourTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [currentUserName, setCurrentUserName] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
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

      if (!profile?.company_id) { setLoading(false); return; }

      const { data, error } = await supabase
        .from('itineraries')
        .select('id, reference_number, itinerary_name, itinerary_tour_type, consultant_name, travel_start_date, travel_end_date, travellers, num_adults, num_children, status, clients(name, client_type)')
        .eq('company_id', profile.company_id)
        .order('travel_start_date', { ascending: true, nullsFirst: false });

      if (error) throw error;
      setItineraries(data || []);
    } catch (err) {
      showToast(err.message || 'Failed to load analytics data', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* ─── Stats ─────────────────────────────────────────────────────────────── */

  const stats = useMemo(() => {
    const totalTravellers = itineraries.reduce((sum, it) => {
      const trav = Array.isArray(it.travellers) ? it.travellers : [];
      return sum + (trav.length || 0);
    }, 0);

    const active = itineraries.filter((it) =>
      !['cancelled', 'completed'].includes(it.status)
    ).length;

    const cancelled = itineraries.filter((it) => it.status === 'cancelled').length;
    const completed = itineraries.filter((it) => it.status === 'completed').length;

    return { totalTravellers, active, cancelled, completed, total: itineraries.length };
  }, [itineraries]);

  /* ─── Filtered list ─────────────────────────────────────────────────────── */

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return itineraries.filter((it) => {
      if (statusFilter && it.status !== statusFilter) return false;
      if (tourTypeFilter && it.itinerary_tour_type !== tourTypeFilter) return false;
      if (q) {
        const trav = Array.isArray(it.travellers) ? it.travellers : [];
        const haystack = [
          it.reference_number,
          it.clients?.name,
          it.itinerary_name,
          it.consultant_name || currentUserName,
          leadTraveller(trav)
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [itineraries, searchQuery, statusFilter, tourTypeFilter, currentUserName]);

  /* ─── Export ────────────────────────────────────────────────────────────── */

  const handleExport = () => {
    if (!filtered.length) {
      showToast('No records to export', 'warning');
      return;
    }
    const xls = buildChecklistXls(filtered, currentUserName);
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
            <p>Travelers checklist — all itineraries sorted by arrival date</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            type="button"
            className="icon-btn outline"
            onClick={fetchData}
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

      {/* Stats Grid */}
      <div className="admin-stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: '2rem' }}>
        <StatCard
          icon={Users}
          label="Total Travelers Managed"
          value={stats.totalTravellers.toLocaleString()}
          sub="Across all itineraries including cancelled"
          color="#0d7478"
        />
        <StatCard
          icon={TrendingUp}
          label="Total Itineraries"
          value={stats.total.toLocaleString()}
          sub={`${stats.active} active · ${stats.completed} completed`}
          color="#6366f1"
        />
        <StatCard
          icon={Calendar}
          label="Active Itineraries"
          value={stats.active.toLocaleString()}
          sub="Quotation, provisional, confirmed, in progress"
          color="#16a34a"
        />
        <StatCard
          icon={BarChart3}
          label="Cancelled"
          value={stats.cancelled.toLocaleString()}
          sub="Shown in red with XX prefix"
          color="#dc2626"
        />
      </div>

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
            {/* Tour type filter */}
            <select
              className="pricing-select"
              style={{ width: 'auto', minWidth: '140px', padding: '0.55rem 0.75rem', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#334155', background: '#f8fafc' }}
              value={tourTypeFilter}
              onChange={(e) => setTourTypeFilter(e.target.value)}
            >
              <option value="">All tour types</option>
              <option value="FIT">FIT</option>
              <option value="Series Departure">Series Departure</option>
            </select>
            {/* Status filter */}
            <select
              className="pricing-select"
              style={{ width: 'auto', minWidth: '140px', padding: '0.55rem 0.75rem', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#334155', background: '#f8fafc' }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="quotation">Quotation</option>
              <option value="provisional">Provisional</option>
              <option value="confirmed">Confirmed</option>
              <option value="in_progress">In Progress</option>
              <option value="cancelled">Cancelled</option>
              <option value="completed">Completed</option>
            </select>
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
