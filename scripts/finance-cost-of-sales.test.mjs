import {
  COST_OF_SALES_STATUSES,
  costOfSalesFromDayItems
} from '../src/lib/financeJournal.js';

const rows = costOfSalesFromDayItems([
  {
    itinerary_id: 'confirmed-itinerary',
    id: 'service-1',
    currency_code: 'ZAR',
    item_name: 'Hotel',
    category: 'Accommodation',
    supplier_name: 'Example supplier',
    unit_cost: 100,
    unit_price: 200,
    total_buy: 0,
    total_sell: 0,
    pax: 2,
    tax_rate: 15
  },
  {
    itinerary_id: 'confirmed-itinerary',
    currency_code: 'ZAR',
    total_buy: 50,
    total_sell: 115,
    tax_rate: 15
  },
  {
    itinerary_id: 'other-itinerary',
    currency_code: 'USD',
    total_buy: 20,
    total_sell: 40,
    tax_rate: 0
  },
  {
    itinerary_id: 'confirmed-itinerary',
    currency_code: 'ZAR',
    total_buy: 500,
    total_sell: 1000,
    is_included: false
  }
]);

const checks = [
  ['only committed booking statuses are eligible', COST_OF_SALES_STATUSES.join(','), 'confirmed,in_progress,completed'],
  ['costs remain separate by itinerary and currency', rows.length, 2],
  ['legacy per-unit amounts supply missing totals', rows.find((row) => row.itinerary_id === 'confirmed-itinerary').cost, 250],
  ['legacy per-unit sales supply missing totals', rows.find((row) => row.itinerary_id === 'confirmed-itinerary').grossSale, 515],
  ['optional services do not enter the cost calculation', rows.find((row) => row.itinerary_id === 'confirmed-itinerary').serviceCount, 2],
  ['contracted items are available for drill-down', rows.find((row) => row.itinerary_id === 'confirmed-itinerary').items.length, 2],
  ['item drill-down retains total buy', rows.find((row) => row.itinerary_id === 'confirmed-itinerary').items[0].cost, 200],
  ['item drill-down retains total sell', rows.find((row) => row.itinerary_id === 'confirmed-itinerary').items[0].grossSale, 400],
  ['item drill-down calculates profit net of tax', rows.find((row) => row.itinerary_id === 'confirmed-itinerary').items[0].profit, 147.83],
  ['item drill-down retains supplier details', rows.find((row) => row.itinerary_id === 'confirmed-itinerary').items[0].supplier, 'Example supplier']
];

let failures = 0;
for (const [label, actual, expected] of checks) {
  const passed = actual === expected;
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}: got ${actual}, expected ${expected}`);
}

if (failures) process.exitCode = 1;
