import { buildServiceCostRows } from '../src/lib/itineraryCostBreakdown.js';
import {
  exportSectionsForView,
  isInternalCostBreakdown
} from '../src/lib/itineraryExportOptions.js';

let failures = 0;
const check = (label, actual, expected) => {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};

const rows = buildServiceCostRows({
  paxCount: 2,
  categoryLabel: (value) => value.toUpperCase(),
  days: [
    {
      day: 1,
      date: '2027-02-01',
      services: [
        { category: 'Transfers', name: 'Airport transfer', buy: 200, tax: 20, sell: 260 },
        { category: 'Accommodation', name: 'Harbour Hotel', roomType: 'Standard', mealPlan: 'Breakfast', supplierName: 'Harbour Group', buy: 1000, tax: 100, sell: 1200 }
      ],
      optionalServices: [
        { category: 'Excursions', name: 'Harbour cruise', buy: 40, tax: 4, sell: 50 }
      ]
    },
    {
      day: 2,
      date: '2027-02-02',
      services: [
        { category: 'Transfers', name: 'City transfer', buy: 80, tax: 8, sell: 100 }
      ]
    }
  ]
});

check('each transfer is its own day-specific row',
  rows.filter((row) => row.category === 'TRANSFERS' && !row.isSubtotal).map(({ service, day, date }) => ({ service, day, date })),
  [
    { service: 'Airport transfer', day: 'Day 1', date: '2027-02-01' },
    { service: 'City transfer', day: 'Day 2', date: '2027-02-02' }
  ]);
check('accommodation rows identify the room, board, and supplier',
  rows.find((row) => row.category === 'ACCOMMODATION').service,
  'Harbour Hotel — Standard · Breakfast · Harbour Group');
check('optional services remain explicitly identified',
  rows.find((row) => row.category === 'Optional — EXCURSIONS').service,
  'Harbour cruise');
check('category subtotals preserve their service rows',
  rows.find((row) => row.isSubtotal && row.category === 'TRANSFERS'),
  {
    category: 'TRANSFERS',
    service: 'Category total',
    day: '',
    date: '',
    buy: 140,
    tax: 14,
    markup: 40,
    sellWithoutMarkup: 140,
    sellWithMarkup: 180,
    isSubtotal: true
  });
check('cost metrics are per person',
  rows[0] && [rows[0].buy, rows[0].tax, rows[0].markup, rows[0].sellWithoutMarkup, rows[0].sellWithMarkup],
  [100, 10, 30, 100, 130]);
check('grand total includes included and optional services',
  rows[rows.length - 1],
  {
    category: 'Grand total',
    service: 'All services',
    day: '',
    date: '',
    buy: 660,
    tax: 66,
    markup: 145,
    sellWithoutMarkup: 660,
    sellWithMarkup: 805
  });
check('service-level cost breakdown is marked internal',
  isInternalCostBreakdown({ pricing: true, perPersonView: 'categorySummary' }), true);
check('internal cost reports omit itinerary, inclusions, and exclusions',
  exportSectionsForView({
    pricing: true,
    perPersonView: 'categorySummary',
    itinerary: true,
    inclusions: true,
    exclusions: true,
    terms: true,
    travellers: true
  }),
  {
    pricing: true,
    perPersonView: 'categorySummary',
    itinerary: false,
    inclusions: false,
    exclusions: false,
    terms: true,
    travellers: true
  });
check('other export views preserve the selected sections',
  exportSectionsForView({ pricing: true, perPersonView: 'detailed', itinerary: true }),
  { pricing: true, perPersonView: 'detailed', itinerary: true });

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nItinerary cost breakdown: all checks passed');
