/* Reporting for Analytics.

   Itineraries have no stored revenue or loss column. Money comes from the
   included day items, the same source the builder and Finance's cost-of-sales
   panel use: a sale is tax-inclusive, revenue is the tax-exclusive figure, cost
   is the buy row, and a negative profit is a loss. Nothing here invents an
   exchange rate: a multi-currency company reports per currency, because adding
   ZAR to USD would produce a number nobody can act on.

   Everything in this file is pure. The page owns the Supabase reads and the
   filters; the rules for a date window, a consultant's row and a loss live here
   so they can be tested without a browser or a database. */

import { COST_OF_SALES_STATUSES, costOfSalesFromDayItems, round2 } from './financeJournal';

export const REPORT_DATE_BASES = [
  { id: 'travel', label: 'Travel dates' },
  { id: 'created', label: 'Created date' }
];

export const REPORT_FINANCIAL_BASES = [
  { id: 'booked', label: 'Booked trips only (confirmed, in progress, completed)' },
  { id: 'all', label: 'All itineraries, including quotations' }
];

export const REPORT_LOSS_FILTERS = [
  { id: 'all', label: 'Profit and loss' },
  { id: 'loss', label: 'Loss-making only' },
  { id: 'profit', label: 'Profitable only' }
];

export const STATUS_ORDER = [
  'quotation', 'pending_confirmation', 'provisional', 'confirmed',
  'in_progress', 'completed', 'cancelled'
];

export const STATUS_LABELS = {
  quotation: 'Quotation',
  pending_confirmation: 'Pending Confirmation',
  provisional: 'Provisional Booking',
  confirmed: 'Confirmed',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled'
};

export const statusLabel = (status) => STATUS_LABELS[status] || status || 'Unstated';

const dayOf = (value) => String(value ?? '').slice(0, 10);
const ccyOf = (value) => String(value || 'ZAR').toUpperCase();
const nameOf = (value) => String(value || '').trim();

export const consultantOf = (itinerary) => nameOf(itinerary?.consultant_name) || 'Unassigned';
export const clientNameOf = (itinerary) => nameOf(itinerary?.clients?.name) || 'Unassigned';

/* A travel-date window is an overlap, not a containment: a trip that started
   before the first day and ends after the last still travelled in the period.
   A created-date window reads one day, so both bounds are compared against it.
   Undated trips are only shown when no window is set - they cannot honestly be
   assigned to a period. */
export const inReportRange = (itinerary, filters = {}) => {
  const from = dayOf(filters.from);
  const to = dayOf(filters.to);
  if (!from && !to) return true;
  if (filters.dateBasis === 'created') {
    const day = dayOf(itinerary?.created_at);
    if (!day) return false;
    return (!from || day >= from) && (!to || day <= to);
  }
  const start = dayOf(itinerary?.travel_start_date);
  const end = dayOf(itinerary?.travel_end_date) || start;
  if (!start || !end) return false;
  return (!from || end >= from) && (!to || start <= to);
};

const emptyMoney = () => ({ revenue: 0, cost: 0, profit: 0, loss: 0, gross: 0, tax: 0, services: 0 });

const accumulate = (row, money) => {
  row.revenue = round2(row.revenue + (Number(money.revenue) || 0));
  row.cost = round2(row.cost + (Number(money.cost) || 0));
  row.gross = round2(row.gross + (Number(money.gross) || 0));
  row.tax = round2(row.tax + (Number(money.tax) || 0));
  row.services += Number(money.services) || 0;
  return row;
};

/* A loss is a property of a trip, not of a service. Summing the losses of
   loss-making itineraries (rather than taking the negative side of a group's
   net profit) is what stops a profitable month from hiding the trip that went
   sideways. Profit stays the net figure, so the two columns answer different
   questions. */
const addMoney = (bucket, code, money) => {
  if (!bucket[code]) bucket[code] = emptyMoney();
  const row = accumulate(bucket[code], money);
  const ownLoss = money.loss == null
    ? Math.max(0, (Number(money.cost) || 0) - (Number(money.revenue) || 0))
    : Number(money.loss) || 0;
  row.loss = round2(row.loss + ownLoss);
  row.profit = round2(row.revenue - row.cost);
  return row;
};

const addAllMoney = (bucket, byCurrency) => {
  Object.entries(byCurrency || {}).forEach(([code, money]) => addMoney(bucket, code, money));
  return bucket;
};

export const moneyOf = (byCurrency) => Object.entries(byCurrency || {}).map(([code, money]) => ({
  code,
  ...money,
  margin: money.revenue > 0 ? round2((money.profit / money.revenue) * 100) : null
})).sort((a, b) => a.code.localeCompare(b.code));

const hasProfit = (byCurrency) => Object.values(byCurrency || {}).some((money) => money.revenue > 0 && money.profit >= 0);
const hasLoss = (byCurrency) => Object.values(byCurrency || {}).some((money) => money.loss > 0);
const meetsMinimum = (byCurrency, minimum) => {
  const floor = Number(minimum);
  if (!Number.isFinite(floor) || floor <= 0) return true;
  return Object.values(byCurrency || {}).some((money) => money.revenue >= floor);
};

/* Tax-free revenue, buy cost and loss per itinerary and currency, derived from
   the same cost-of-sales rows Finance posts. An itinerary with no services has
   no money row at all: a quotation is still an itinerary, but it is not a sale. */
export const financialsForItems = (items) => {
  const byItinerary = new Map();
  costOfSalesFromDayItems(items).forEach((row) => {
    if (!byItinerary.has(row.itinerary_id)) byItinerary.set(row.itinerary_id, {});
    const currencies = byItinerary.get(row.itinerary_id);
    const code = ccyOf(row.code);
    if (!currencies[code]) currencies[code] = emptyMoney();
    accumulate(currencies[code], {
      revenue: row.netSale,
      cost: row.cost,
      gross: row.grossSale,
      tax: row.tax,
      services: row.serviceCount
    });
  });
  byItinerary.forEach((currencies) => Object.values(currencies).forEach((money) => {
    money.profit = round2(money.revenue - money.cost);
    money.loss = round2(Math.max(0, -money.profit));
  }));
  return byItinerary;
};

const newGroup = (key, extra = {}) => ({
  key,
  itineraries: 0,
  travellers: 0,
  byCurrency: {},
  ...extra
});

const countTravellers = (itinerary) => {
  const roster = Array.isArray(itinerary?.travellers) ? itinerary.travellers.length : 0;
  return roster || Number(itinerary?.num_adults || 0) + Number(itinerary?.num_children || 0) || 0;
};

const groupBy = (rows, keyOf, extra = () => ({})) => {
  const groups = new Map();
  rows.forEach((row) => {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, newGroup(key, extra(key)));
    const group = groups.get(key);
    group.itineraries += 1;
    group.travellers += countTravellers(row.itinerary);
    addAllMoney(group.byCurrency, row.financials);
  });
  return [...groups.values()];
};

const monthOf = (itinerary, basis) => dayOf(basis === 'created' ? itinerary?.created_at : itinerary?.travel_start_date).slice(0, 7);

/* The one call the page makes. `items` are day items with `itinerary_id`
   attached by the caller (the table stores the day id, not the itinerary id). */
export const buildAnalyticsReports = ({ itineraries = [], items = [], filters = {} } = {}) => {
  const financials = financialsForItems(items);
  const basis = filters.financialBasis || 'booked';

  const rows = (itineraries || []).map((itinerary) => {
    const byCurrency = financials.get(itinerary.id) || {};
    return {
      itinerary,
      id: itinerary.id,
      reference: itinerary.reference_number || '—',
      name: itinerary.itinerary_name || '—',
      consultant: consultantOf(itinerary),
      client: clientNameOf(itinerary),
      clientId: itinerary?.clients?.id || itinerary?.client_id || '',
      clientType: itinerary?.clients?.client_type || '',
      status: itinerary.status || '',
      tourType: itinerary.itinerary_tour_type || '',
      start: dayOf(itinerary.travel_start_date),
      end: dayOf(itinerary.travel_end_date),
      created: dayOf(itinerary.created_at),
      travellers: countTravellers(itinerary),
      financials: byCurrency,
      money: moneyOf(byCurrency)
    };
  });

  /* Report filters are applied to the derived rows so a revenue or loss floor
     can be checked against the same figures the tables print. The "travelling
     trips" scope is kept separate from the other filters: a quotation is not a
     booking, but the quotations-per-client report still has to count it. */
  const financialStatuses = basis === 'all' ? null : COST_OF_SALES_STATUSES;
  const commonRows = rows.filter((row) => {
    if (filters.consultant && row.consultant !== filters.consultant) return false;
    if (filters.clientId && row.clientId !== filters.clientId) return false;
    if (filters.client && row.client !== filters.client) return false;
    if (filters.status && row.status !== filters.status) return false;
    if (filters.tourType && row.tourType !== filters.tourType) return false;
    if (!inReportRange(row.itinerary, filters)) return false;
    if (!meetsMinimum(row.financials, filters.minRevenue)) return false;
    if (filters.lossFilter === 'loss' && !hasLoss(row.financials)) return false;
    if (filters.lossFilter === 'profit' && !hasProfit(row.financials)) return false;
    return true;
  });
  const scoped = financialStatuses
    ? commonRows.filter((row) => financialStatuses.includes(row.status))
    : commonRows;

  const totals = newGroup('all');
  scoped.forEach((row) => {
    totals.itineraries += 1;
    totals.travellers += row.travellers;
    addAllMoney(totals.byCurrency, row.financials);
  });

  const statusCounts = STATUS_ORDER.map((status) => ({
    status,
    label: statusLabel(status),
    itineraries: scoped.filter((row) => row.status === status).length
  })).filter((entry) => entry.itineraries > 0 || entry.status === filters.status);

  const clientStatus = new Map();
  scoped.forEach((row) => {
    if (!clientStatus.has(row.client)) clientStatus.set(row.client, newGroup(row.client));
    const group = clientStatus.get(row.client);
    group.itineraries += 1;
    group.travellers += row.travellers;
    group.statuses = group.statuses || {};
    group.statuses[row.status || 'unstated'] = (group.statuses[row.status || 'unstated'] || 0) + 1;
    addAllMoney(group.byCurrency, row.financials);
  });

  const quotations = commonRows
    .filter((row) => row.status === 'quotation')
    .reduce((map, row) => {
      if (!map.has(row.client)) map.set(row.client, newGroup(row.client));
      const group = map.get(row.client);
      group.itineraries += 1;
      group.travellers += row.travellers;
      addAllMoney(group.byCurrency, row.financials);
      return map;
    }, new Map());

  const monthly = new Map();
  scoped.forEach((row) => {
    const month = monthOf(row.itinerary, filters.dateBasis);
    if (!month) return;
    if (!monthly.has(month)) monthly.set(month, newGroup(month));
    const group = monthly.get(month);
    group.itineraries += 1;
    group.travellers += row.travellers;
    addAllMoney(group.byCurrency, row.financials);
  });

  const byTourType = groupBy(scoped, (row) => row.tourType || 'Unstated');
  const byConsultant = groupBy(scoped, (row) => row.consultant);
  const byClient = [...clientStatus.values()].sort((a, b) => a.key.localeCompare(b.key));

  return {
    rows: scoped,
    totals: { ...totals, money: moneyOf(totals.byCurrency) },
    byConsultant: byConsultant.sort((a, b) => b.itineraries - a.itineraries || a.key.localeCompare(b.key)),
    byClient,
    byStatus: statusCounts,
    statusColumns: STATUS_ORDER.filter((status) => scoped.some((row) => row.status === status)),
    clientStatus,
    quotationsByClient: [...quotations.values()].sort((a, b) => b.itineraries - a.itineraries || a.key.localeCompare(b.key)),
    byTourType: byTourType.sort((a, b) => b.itineraries - a.itineraries),
    monthly: [...monthly.values()].sort((a, b) => a.key.localeCompare(b.key)),
    lossMaking: scoped
      .filter((row) => hasLoss(row.financials))
      .sort((a, b) => Object.values(b.financials).reduce((s, m) => s + m.loss, 0)
        - Object.values(a.financials).reduce((s, m) => s + m.loss, 0))
  };
};

/* One display string per currency, so a mixed-currency total never pretends to
   be a single number. */
export const formatByCurrency = (byCurrency, formatter) => {
  const rows = moneyOf(byCurrency);
  if (!rows.length) return '—';
  return rows.map((row) => formatter(row)).join(' · ');
};
