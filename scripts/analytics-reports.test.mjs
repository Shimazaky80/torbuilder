import {
  buildAnalyticsReports,
  financialsForItems,
  inReportRange,
  moneyOf
} from '../src/lib/analyticsReports.js';

let failures = 0;
const check = (label, actual, expected) => {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};

const itineraries = [
  {
    id: 'it1', reference_number: 'IT-1', status: 'confirmed',
    consultant_name: 'Django', client_id: 'c1',
    clients: { id: 'c1', name: 'Acme', client_type: 'agency' },
    travel_start_date: '2027-01-05', travel_end_date: '2027-01-20',
    created_at: '2026-11-01T10:00:00Z',
    itinerary_tour_type: 'FIT', num_adults: 2, num_children: 0
  },
  {
    id: 'it2', reference_number: 'IT-2', status: 'confirmed',
    consultant_name: 'Django', client_id: 'c1',
    clients: { id: 'c1', name: 'Acme', client_type: 'agency' },
    travel_start_date: '2027-02-05', travel_end_date: '2027-02-10',
    created_at: '2026-12-01T10:00:00Z',
    itinerary_tour_type: 'Series', num_adults: 1, num_children: 1
  },
  {
    id: 'it3', reference_number: 'IT-3', status: 'quotation',
    consultant_name: 'Sara', client_id: 'c2',
    clients: { id: 'c2', name: 'Blue Tours', client_type: 'direct' },
    travel_start_date: '2027-01-10', travel_end_date: '2027-01-12',
    created_at: '2026-12-15T10:00:00Z',
    itinerary_tour_type: 'FIT', num_adults: 1, num_children: 0
  },
  {
    id: 'it4', reference_number: 'IT-4', status: 'completed',
    consultant_name: 'Sara', client_id: 'c1',
    clients: { id: 'c1', name: 'Acme', client_type: 'agency' },
    travel_start_date: '2027-01-25', travel_end_date: '2027-01-28',
    created_at: '2026-10-01T10:00:00Z',
    itinerary_tour_type: 'FIT', num_adults: 2, num_children: 0
  }
];

/* total_sell is tax-inclusive at 15%; revenue is the net figure, cost is the
   buy figure. IT-4 is deliberately sold below cost. */
const item = (itinerary_id, total_buy, total_sell, extra = {}) => ({
  itinerary_id, total_buy, total_sell, tax_rate: 15, currency_code: 'ZAR',
  is_included: true, pax: 1, ...extra
});

const items = [
  item('it1', 600, 1150),
  item('it1', 100, 230),
  item('it2', 500, 575, { currency_code: 'USD' }),
  item('it3', 100, 230),
  item('it4', 500, 400),
  item('it4', 50, 500, { is_included: false })
];

const finances = financialsForItems(items);
const money = (id) => moneyOf(finances.get(id));
check('revenue excludes tax', money('it1').map((m) => m.revenue), [1200]);
check('cost is the buy total', money('it1').map((m) => m.cost), [700]);
check('loss is only the negative side of profit', money('it4').map((m) => [m.profit, m.loss]), [[-152.17, 152.17]]);
check('optional lines are not a sale', money('it4').map((m) => m.gross), [400]);
check('currencies stay apart', money('it2').map((m) => [m.code, m.revenue]), [['USD', 500]]);

check('a trip inside the window is in', inReportRange(itineraries[0], { from: '2027-01-01', to: '2027-01-31' }), true);
check('a trip that spans the window is in', inReportRange(itineraries[0], { from: '2027-01-10', to: '2027-01-12' }), true);
check('a trip after the window is out', inReportRange(itineraries[1], { from: '2027-01-01', to: '2027-01-31' }), false);
check('created date reads the created column', inReportRange(itineraries[0], { from: '2026-11-01', to: '2026-11-30', dateBasis: 'created' }), true);

const filters = { from: '2027-01-01', to: '2027-01-31', financialBasis: 'all' };
const report = buildAnalyticsReports({ itineraries, items, filters });
check('January holds three itineraries', report.totals.itineraries, 3);
check('January revenue is per currency', report.totals.money.map((m) => [m.code, m.revenue]), [['ZAR', 1747.83]]);
check('January loss totals the loss-making trips', report.totals.money.map((m) => m.loss), [152.17]);
check('consultants are counted', report.byConsultant.map((g) => [g.key, g.itineraries]), [['Sara', 2], ['Django', 1]]);
check('clients are counted', report.byClient.map((g) => [g.key, g.itineraries]), [['Acme', 2], ['Blue Tours', 1]]);
check('status columns follow the rows', report.statusColumns, ['quotation', 'confirmed', 'completed']);
check('quotations per client', report.quotationsByClient.map((g) => [g.key, g.itineraries]), [['Blue Tours', 1]]);
check('client/status matrix', report.clientStatus.get('Acme').statuses, { confirmed: 1, completed: 1 });
check('loss-making trips are named', report.lossMaking.map((r) => r.reference), ['IT-4']);
check('monthly buckets', report.monthly.map((m) => [m.key, m.itineraries]), [['2027-01', 3]]);
check('tour type mix', report.byTourType.map((g) => [g.key, g.itineraries]), [['FIT', 3]]);

const consultantReport = buildAnalyticsReports({ itineraries, items, filters: { ...filters, consultant: 'Sara' } });
check('a consultant sees only their own rows', consultantReport.rows.map((r) => r.reference), ['IT-3', 'IT-4']);
check('a consultant cannot see another consultant\'s revenue', consultantReport.totals.money.map((m) => m.revenue), [547.83]);

const lossOnly = buildAnalyticsReports({ itineraries, items, filters: { ...filters, lossFilter: 'loss' } });
check('loss filter keeps only loss-making rows', lossOnly.rows.map((r) => r.reference), ['IT-4']);

const profitOnly = buildAnalyticsReports({ itineraries, items, filters: { ...filters, lossFilter: 'profit' } });
check('profit filter keeps only trips with revenue and no loss', profitOnly.rows.map((r) => r.reference), ['IT-1', 'IT-3']);

const revenueFloor = buildAnalyticsReports({ itineraries, items, filters: { ...filters, minRevenue: 1000 } });
check('revenue floor keeps only the large trip', revenueFloor.rows.map((r) => r.reference), ['IT-1']);

const defaultBasis = buildAnalyticsReports({ itineraries, items, filters: { from: '2027-01-01', to: '2027-01-31' } });
check('default basis includes quotations', defaultBasis.rows.map((r) => r.reference), ['IT-1', 'IT-3', 'IT-4']);

const booked = buildAnalyticsReports({ itineraries, items, filters: { from: '2027-01-01', to: '2027-01-31', financialBasis: 'booked' } });
check('booked basis hides quotations', booked.rows.map((r) => r.reference), ['IT-1', 'IT-4']);
check('quotations still report under the booked basis', booked.quotationsByClient.map((g) => [g.key, g.itineraries]), [['Blue Tours', 1]]);

if (failures) {
  console.error(`\n${failures} analytics report check(s) failed`);
  process.exit(1);
}
console.log('\nAll analytics report checks passed');
