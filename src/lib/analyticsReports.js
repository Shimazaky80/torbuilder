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

import { COST_OF_SALES_STATUSES, costOfSalesFromDayItems, round2 } from './financeJournal.js';

export const REPORT_DATE_BASES = [
  { id: 'travel', label: 'Travel dates' },
  { id: 'created', label: 'Created date' }
];

export const REPORT_FINANCIAL_BASES = [
  { id: 'all', label: 'All itineraries (quotations included)' },
  { id: 'booked', label: 'Booked trips only (confirmed, in progress, completed)' }
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

const sumByCurrencyField = (byCurrency, field) => Object.values(byCurrency || {}).reduce((s, m) => s + (Number(m[field]) || 0), 0);

const hasProfit = (byCurrency) => Object.values(byCurrency || {}).some((money) => money.revenue > 0 && money.profit >= 0);
const hasLoss = (byCurrency) => Object.values(byCurrency || {}).some((money) => money.loss > 0);
const meetsMinimum = (byCurrency, minimum) => {
  const floor = Number(minimum);
  if (!Number.isFinite(floor) || floor <= 0) return true;
  return Object.values(byCurrency || {}).some((money) => money.revenue >= floor);
};

const vatOfInclusive = (amount, rate) => {
  const r = Number(rate) || 0;
  if (!r) return 0;
  return round2((Number(amount) || 0) * r / (100 + r));
};

const supplierKeyOf = (item) => item?.supplier_id || `name:${nameOf(item?.supplier_name) || 'Unassigned supplier'}`;
const supplierNameOf = (item) => nameOf(item?.supplier_name) || 'Unassigned supplier';

const previousPeriod = (filters = {}) => {
  const from = dayOf(filters.from);
  const to = dayOf(filters.to);
  if (!from || !to) return null;
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null;
  const days = Math.round((end - start) / 86400000) + 1;
  const prevEnd = new Date(start);
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevStart.getUTCDate() - (days - 1));
  return {
    ...filters,
    from: prevStart.toISOString().slice(0, 10),
    to: prevEnd.toISOString().slice(0, 10)
  };
};

const supplierMoneyFromItems = (items, allowedItineraryIds) => {
  const bySupplier = new Map();
  (items || []).forEach((it) => {
    if (it.is_included === false) return;
    if (!it.itinerary_id || !allowedItineraryIds.has(it.itinerary_id)) return;
    const key = supplierKeyOf(it);
    if (!bySupplier.has(key)) {
      bySupplier.set(key, {
        key,
        supplierId: it.supplier_id || '',
        supplier: supplierNameOf(it),
        itineraries: new Set(),
        categories: new Set(),
        services: 0,
        byCurrency: {}
      });
    }
    const row = bySupplier.get(key);
    if (!row.supplierId && it.supplier_id) row.supplierId = it.supplier_id;
    if (row.supplier === 'Unassigned supplier' && nameOf(it.supplier_name)) row.supplier = nameOf(it.supplier_name);
    row.itineraries.add(it.itinerary_id);
    if (nameOf(it.category)) row.categories.add(nameOf(it.category));
    row.services += 1;

    const pax = Math.max(1, Number(it.pax) || 1);
    const buy = Number(it.total_buy) || round2((Number(it.unit_cost) || 0) * pax);
    const grossSale = Number(it.total_sell) || round2((Number(it.unit_price ?? it.item_price_per_person) || 0) * pax);
    const tax = vatOfInclusive(grossSale, it.tax_rate);
    const revenue = round2(grossSale - tax);
    addMoney(row.byCurrency, ccyOf(it.currency_code), { revenue, cost: buy, gross: grossSale, tax, services: 1 });
  });

  return [...bySupplier.values()].map((row) => ({
    key: row.key,
    supplierId: row.supplierId,
    supplier: row.supplier,
    itineraries: row.itineraries.size,
    categories: [...row.categories].sort((a, b) => a.localeCompare(b)),
    services: row.services,
    byCurrency: row.byCurrency,
    money: moneyOf(row.byCurrency)
  })).sort((a, b) => {
    const ar = Object.values(a.byCurrency).reduce((s, m) => s + m.revenue, 0);
    const br = Object.values(b.byCurrency).reduce((s, m) => s + m.revenue, 0);
    return br - ar || a.supplier.localeCompare(b.supplier);
  });
};

const buildSupplierComparison = (current, previous) => {
  const prevMap = new Map((previous || []).map((r) => [r.key, r]));
  const keys = new Set([...(current || []).map((r) => r.key), ...prevMap.keys()]);
  const pct = (cur, prev) => prev > 0 ? round2(((cur - prev) / prev) * 100) : (cur > 0 ? 100 : null);
  return [...keys].map((key) => {
    const cur = (current || []).find((r) => r.key === key);
    const prev = prevMap.get(key);
    const codes = new Set([...Object.keys(cur?.byCurrency || {}), ...Object.keys(prev?.byCurrency || {})]);
    const deltaByCurrency = {};
    [...codes].forEach((code) => {
      const c = cur?.byCurrency?.[code] || emptyMoney();
      const p = prev?.byCurrency?.[code] || emptyMoney();
      deltaByCurrency[code] = {
        code,
        revenue: { current: c.revenue, previous: p.revenue, delta: round2(c.revenue - p.revenue), pct: pct(c.revenue, p.revenue) },
        cost: { current: c.cost, previous: p.cost, delta: round2(c.cost - p.cost), pct: pct(c.cost, p.cost) },
        profit: { current: c.profit, previous: p.profit, delta: round2(c.profit - p.profit), pct: pct(c.profit, p.profit) },
        loss: { current: c.loss, previous: p.loss, delta: round2(c.loss - p.loss), pct: pct(c.loss, p.loss) }
      };
    });
    return {
      key,
      supplierId: cur?.supplierId || prev?.supplierId || '',
      supplier: cur?.supplier || prev?.supplier || 'Unassigned supplier',
      current: cur || null,
      previous: prev || null,
      deltaByCurrency,
      servicesDelta: (cur?.services || 0) - (prev?.services || 0),
      itinerariesDelta: (cur?.itineraries || 0) - (prev?.itineraries || 0)
    };
  }).sort((a, b) => {
    const ar = Object.values(a.current?.byCurrency || {}).reduce((s, m) => s + m.revenue, 0);
    const br = Object.values(b.current?.byCurrency || {}).reduce((s, m) => s + m.revenue, 0);
    return br - ar || a.supplier.localeCompare(b.supplier);
  });
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
export const buildAnalyticsReports = ({ itineraries = [], items = [], filters = {}, suppliers = [] } = {}) => {
  const financials = financialsForItems(items);
  /* Quotations carry quoted sell and buy figures too. Hiding them by default
     was why a company whose files are all still quotations saw no money at all. */
  const basis = filters.financialBasis || 'all';

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

  const supplierAllowed = new Set(scoped.map((r) => r.id));
  const bySupplier = supplierMoneyFromItems(items, supplierAllowed);
  const prevFilters = previousPeriod(filters);
  let bySupplierPrevious = [];
  let supplierComparison = [];
  if (prevFilters) {
    const prevCommon = rows.filter((row) => {
      if (filters.consultant && row.consultant !== filters.consultant) return false;
      if (filters.clientId && row.clientId !== filters.clientId) return false;
      if (filters.client && row.client !== filters.client) return false;
      if (filters.status && row.status !== filters.status) return false;
      if (filters.tourType && row.tourType !== filters.tourType) return false;
      if (!inReportRange(row.itinerary, prevFilters)) return false;
      if (!meetsMinimum(row.financials, filters.minRevenue)) return false;
      if (filters.lossFilter === 'loss' && !hasLoss(row.financials)) return false;
      if (filters.lossFilter === 'profit' && !hasProfit(row.financials)) return false;
      return true;
    });
    const prevScoped = financialStatuses
      ? prevCommon.filter((row) => financialStatuses.includes(row.status))
      : prevCommon;
    bySupplierPrevious = supplierMoneyFromItems(items, new Set(prevScoped.map((r) => r.id)));
    supplierComparison = buildSupplierComparison(bySupplier, bySupplierPrevious);
  }

  const bySupplierCategory = (() => {
    const map = new Map();
    (items || []).forEach((it) => {
      if (it.is_included === false) return;
      if (!it.itinerary_id || !supplierAllowed.has(it.itinerary_id)) return;
      const supplier = supplierNameOf(it);
      const category = nameOf(it.category) || 'Uncategorized';
      const key = `${supplierKeyOf(it)}|${category}`;
      if (!map.has(key)) map.set(key, { key, supplier, category, services: 0, itineraries: new Set(), byCurrency: {} });
      const row = map.get(key);
      row.itineraries.add(it.itinerary_id);
      row.services += 1;
      const pax = Math.max(1, Number(it.pax) || 1);
      const buy = Number(it.total_buy) || round2((Number(it.unit_cost) || 0) * pax);
      const grossSale = Number(it.total_sell) || round2((Number(it.unit_price ?? it.item_price_per_person) || 0) * pax);
      const tax = vatOfInclusive(grossSale, it.tax_rate);
      addMoney(row.byCurrency, ccyOf(it.currency_code), { revenue: round2(grossSale - tax), cost: buy, gross: grossSale, tax, services: 1 });
    });
    return [...map.values()].map((row) => ({
      ...row,
      itineraries: row.itineraries.size,
      money: moneyOf(row.byCurrency)
    })).sort((a, b) => {
      const ar = Object.values(a.byCurrency).reduce((s, m) => s + m.revenue, 0);
      const br = Object.values(b.byCurrency).reduce((s, m) => s + m.revenue, 0);
      return br - ar || a.supplier.localeCompare(b.supplier) || a.category.localeCompare(b.category);
    });
  })();

  const topSuppliersByRevenue = [...bySupplier].sort((a, b) => sumByCurrencyField(a.byCurrency, 'revenue') - sumByCurrencyField(b.byCurrency, 'revenue')).reverse().slice(0, 10);
  const topSuppliersByProfit = [...bySupplier].sort((a, b) => sumByCurrencyField(a.byCurrency, 'profit') - sumByCurrencyField(b.byCurrency, 'profit')).reverse().slice(0, 10);
  const highestMarginSuppliers = [...bySupplier]
    .map((r) => {
      const moneys = moneyOf(r.byCurrency);
      const best = moneys.reduce((acc, m) => (m.margin != null && m.margin > acc ? m.margin : acc), -Infinity);
      return { ...r, bestMargin: Number.isFinite(best) ? best : null };
    })
    .filter((r) => r.bestMargin != null)
    .sort((a, b) => b.bestMargin - a.bestMargin || sumByCurrencyField(b.byCurrency, 'revenue') - sumByCurrencyField(a.byCurrency, 'revenue'))
    .slice(0, 10);

  const now = filters.now ? new Date(filters.now) : new Date();
  const last12Months = new Date(now);
  last12Months.setMonth(last12Months.getMonth() - 12);
  const last12Cutoff = last12Months.toISOString().slice(0, 10);

  const bookedSet = new Set((itineraries || []).filter((it) => {
    const day = dayOf(it.travel_start_date) || dayOf(it.created_at);
    return day && day >= last12Cutoff;
  }).map((it) => it.id));

  const suppliersBooked12 = new Set();
  (items || []).forEach((it) => {
    if (it.is_included === false) return;
    if (!it.itinerary_id || !bookedSet.has(it.itinerary_id)) return;
    suppliersBooked12.add(supplierKeyOf(it));
  });

  const suppliersNoBookingsLast12Months = (suppliers || [])
    .filter((s) => s && s.is_active !== false)
    .filter((s) => !suppliersBooked12.has(s.id) && !suppliersBooked12.has(`name:${nameOf(s.name)}`))
    .map((s) => ({
      key: s.id,
      supplierId: s.id,
      supplier: s.name || 'Unnamed supplier',
      category: s.category || '',
      contactPerson: s.contact_person || '',
      email: s.email || '',
      phone: s.phone || ''
    }))
    .sort((a, b) => a.supplier.localeCompare(b.supplier));

  const cancelledItineraryIds = new Set((itineraries || []).filter((it) => it.status === 'cancelled').map((it) => it.id));
  const mostCancelledSuppliers = (() => {
    const map = new Map();
    (items || []).forEach((it) => {
      if (it.is_included === false) return;
      if (!it.itinerary_id || !cancelledItineraryIds.has(it.itinerary_id)) return;
      const key = supplierKeyOf(it);
      if (!map.has(key)) map.set(key, { key, supplierId: it.supplier_id || '', supplier: supplierNameOf(it), cancelledItineraries: new Set(), services: 0, byCurrency: {} });
      const row = map.get(key);
      row.cancelledItineraries.add(it.itinerary_id);
      row.services += 1;
      const pax = Math.max(1, Number(it.pax) || 1);
      const buy = Number(it.total_buy) || round2((Number(it.unit_cost) || 0) * pax);
      const grossSale = Number(it.total_sell) || round2((Number(it.unit_price ?? it.item_price_per_person) || 0) * pax);
      const tax = vatOfInclusive(grossSale, it.tax_rate);
      addMoney(row.byCurrency, ccyOf(it.currency_code), { revenue: round2(grossSale - tax), cost: buy, gross: grossSale, tax, services: 1 });
    });
    return [...map.values()].map((row) => ({ ...row, cancelledItineraries: row.cancelledItineraries.size, money: moneyOf(row.byCurrency) }))
      .sort((a, b) => b.cancelledItineraries - a.cancelledItineraries || b.services - a.services || a.supplier.localeCompare(b.supplier));
  })();

  const outstandingSupplierPayments = (() => {
    const confirmedIds = new Set((itineraries || []).filter((it) => it.status === 'confirmed').map((it) => it.id));
    const map = new Map();
    (items || []).forEach((it) => {
      if (it.is_included === false) return;
      if (!it.itinerary_id || !confirmedIds.has(it.itinerary_id)) return;
      if (it.supplier_paid === true) return;
      const key = supplierKeyOf(it);
      if (!map.has(key)) map.set(key, { key, supplierId: it.supplier_id || '', supplier: supplierNameOf(it), itineraries: new Set(), services: 0, byCurrency: {} });
      const row = map.get(key);
      row.itineraries.add(it.itinerary_id);
      row.services += 1;
      const pax = Math.max(1, Number(it.pax) || 1);
      const buy = Number(it.total_buy) || round2((Number(it.unit_cost) || 0) * pax);
      addMoney(row.byCurrency, ccyOf(it.currency_code), { revenue: 0, cost: buy, gross: 0, tax: 0, services: 1 });
    });
    return [...map.values()].map((row) => ({ ...row, itineraries: row.itineraries.size, money: moneyOf(row.byCurrency) }))
      .sort((a, b) => sumByCurrencyField(b.byCurrency, 'cost') - sumByCurrencyField(a.byCurrency, 'cost') || a.supplier.localeCompare(b.supplier));
  })();

  const suppliersOnCredit = (suppliers || []).filter((s) => {
    if (!s) return false;
    const terms = String(s.payment_terms || s.account_terms || s.credit_terms || '').toLowerCase();
    const accountType = String(s.account_type || '').toLowerCase();
    const onCredit = s.on_credit === true || s.is_credit === true || s.credit_account === true;
    const hasAccount = !!(s.account_number || s.account_holder_name || s.bank_account_number);
    return onCredit || /credit|account|30 days|60 days|90 days/.test(terms) || /credit|account/.test(accountType) || (hasAccount && /credit|account/.test(terms));
  }).map((s) => ({
    key: s.id,
    supplierId: s.id,
    supplier: s.name || 'Unnamed supplier',
    category: s.category || '',
    paymentTerms: s.payment_terms || s.account_terms || s.credit_terms || '',
    accountType: s.account_type || '',
    email: s.email || '',
    phone: s.phone || ''
  })).sort((a, b) => a.supplier.localeCompare(b.supplier));

  const contractsExpiringNext90Days = (() => {
    const today = dayOf(now.toISOString());
    const in90 = new Date(now);
    in90.setDate(in90.getDate() + 90);
    const in90Day = dayOf(in90.toISOString());
    const fields = ['contract_expiry', 'contract_end_date', 'contract_end', 'expiry_date', 'expires_at', 'contract_expires_at'];
    return (suppliers || []).flatMap((s) => {
      if (!s) return [];
      const field = fields.find((f) => dayOf(s[f]));
      const expiry = field ? dayOf(s[field]) : '';
      if (!expiry || expiry < today || expiry > in90Day) return [];
      const daysLeft = Math.round((new Date(`${expiry}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);
      return [{
        key: s.id,
        supplierId: s.id,
        supplier: s.name || 'Unnamed supplier',
        category: s.category || '',
        expiryDate: expiry,
        daysLeft,
        email: s.email || '',
        phone: s.phone || ''
      }];
    }).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate) || a.supplier.localeCompare(b.supplier));
  })();

  const supplierMonthly = (() => {
    const map = new Map();
    (items || []).forEach((it) => {
      if (it.is_included === false) return;
      if (!it.itinerary_id || !supplierAllowed.has(it.itinerary_id)) return;
      const itn = (itineraries || []).find((x) => x.id === it.itinerary_id);
      const month = monthOf(itn || { travel_start_date: '' }, filters.dateBasis);
      if (!month) return;
      const key = `${supplierKeyOf(it)}|${month}`;
      if (!map.has(key)) map.set(key, { key, supplier: supplierNameOf(it), supplierId: it.supplier_id || '', month, services: 0, itineraries: new Set(), byCurrency: {} });
      const row = map.get(key);
      row.itineraries.add(it.itinerary_id);
      row.services += 1;
      const pax = Math.max(1, Number(it.pax) || 1);
      const buy = Number(it.total_buy) || round2((Number(it.unit_cost) || 0) * pax);
      const grossSale = Number(it.total_sell) || round2((Number(it.unit_price ?? it.item_price_per_person) || 0) * pax);
      const tax = vatOfInclusive(grossSale, it.tax_rate);
      addMoney(row.byCurrency, ccyOf(it.currency_code), { revenue: round2(grossSale - tax), cost: buy, gross: grossSale, tax, services: 1 });
    });
    return [...map.values()].map((row) => ({ ...row, itineraries: row.itineraries.size, money: moneyOf(row.byCurrency) }))
      .sort((a, b) => a.month.localeCompare(b.month) || sumByCurrencyField(b.byCurrency, 'revenue') - sumByCurrencyField(a.byCurrency, 'revenue'));
  })();

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
        - Object.values(a.financials).reduce((s, m) => s + m.loss, 0)),
    bySupplier,
    bySupplierPrevious,
    supplierComparison,
    bySupplierCategory,
    supplierPeriod: prevFilters ? { from: filters.from, to: filters.to, previousFrom: prevFilters.from, previousTo: prevFilters.to } : null,
    topSuppliersByRevenue,
    topSuppliersByProfit,
    highestMarginSuppliers,
    suppliersNoBookingsLast12Months,
    mostCancelledSuppliers,
    outstandingSupplierPayments,
    suppliersOnCredit,
    contractsExpiringNext90Days,
    supplierMonthly
  };
};

/* One display string per currency, so a mixed-currency total never pretends to
   be a single number. */
export const formatByCurrency = (byCurrency, formatter) => {
  const rows = moneyOf(byCurrency);
  if (!rows.length) return '—';
  return rows.map((row) => formatter(row)).join(' · ');
};
