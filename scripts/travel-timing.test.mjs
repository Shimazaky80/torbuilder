/* Month-only travel timing, against the SHIPPED modules.

   A quotation requested as "travels in November 2026" prices against
   2026-11-01..2026-11-30. Two promises are pinned here:

     1. when one season covers the whole month, confirming exact dates inside
        it must not move the price;
     2. when the month straddles two seasons, the line is priced provisionally
        for the sub-window the chosen season covers, and confirming dates in
        the other season must re-evaluate the line.

   The source uses Vite-style extensionless imports, so this is bundled before
   it runs:  npm run test:travel-timing
*/
import {
  PRECISION_MONTH,
  daysInMonthRange,
  isMonthTiming,
  monthTimingError,
  monthWindow,
  travelTiming,
  travelTimingLabel,
  travelWindowFor
} from '../src/lib/travelTiming.js';
import { resolveSeasonForTravel, seasonLineStatus } from '../src/lib/priceValidity.js';
import { repriceServicesForPax, revalidateServicesForWindow } from '../src/lib/servicePricing.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = Object.is(actual, expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};

const NOV_2026 = { start: '2026-11-01', end: '2026-11-30' };
const monthMeta = {
  travelDatePrecision: PRECISION_MONTH,
  travelStart: NOV_2026.start,
  travelEnd: NOV_2026.end,
  durationDays: 10
};

/* 1. The month window, its validation and its label. */
const november = monthWindow('2026-11', '2026-11');
check('November 2026 starts on the 1st', november.start, '2026-11-01');
check('November 2026 ends on the 30th', november.end, '2026-11-30');
check('November is 30 days', daysInMonthRange('2026-11', '2026-11'), 30);
check('November-December spans 61 days', daysInMonthRange('2026-11', '2026-12'), 61);
check('an inverted month range has no window', monthWindow('2026-12', '2026-11').start, '');
check('month metadata is recognised', isMonthTiming(monthMeta), true);
check('the pricing window is the whole month', travelWindowFor(monthMeta).end, '2026-11-30');
check('month label says dates are pending', travelTiming(monthMeta).label, 'November 2026 (dates to be confirmed) · 10 days');
check('month label helper matches', travelTimingLabel(monthMeta), 'November 2026 (dates to be confirmed) · 10 days');

check('no month selected is rejected', monthTimingError({}), 'Select the travel month(s)');
check('an inverted month range is rejected', monthTimingError({ monthFrom: '2026-12', monthTo: '2026-11', durationDays: 5 }), 'The last travel month cannot be before the first');
check('a missing duration is rejected', monthTimingError({ monthFrom: '2026-11', monthTo: '2026-11', durationDays: 0 }), 'Enter how many days the tour runs');
check('a tour longer than the month range is rejected', monthTimingError({ monthFrom: '2026-11', monthTo: '2026-11', durationDays: 31 }).includes('does not fit'), true);
check('a valid month tour passes validation', monthTimingError({ monthFrom: '2026-11', monthTo: '2026-11', durationDays: 10 }), '');

/* 2. One season covers the whole month: matched, and exact dates inside it
      change nothing. */
const novemberRate = {
  id: 'r-nov', currency: 'ZAR', season_name: 'November',
  valid_from: '2026-11-01', valid_to: '2026-11-30',
  price_1_adult: 300, rate_basis: 'per_person'
};
const novemberItem = { id: 'activity-nov', category: 'Activities / Tours', item_rates: [novemberRate] };

const coveredMonth = resolveSeasonForTravel({
  rates: novemberItem.item_rates, currencyCode: 'ZAR',
  startDate: NOV_2026.start, endDate: NOV_2026.end, allowPartial: true
});
check('a whole-month season is an exact match, not a provisional one', coveredMonth.status, 'ok');
check('a whole-month season names itself', coveredMonth.seasonName, 'November');
check('a whole-month season records a matched line', seasonLineStatus(coveredMonth), 'matched');

const novemberLine = {
  itemId: novemberItem.id,
  name: 'November activity',
  category: 'Activities / Tours',
  currencyCode: 'ZAR',
  buyPP: 300,
  sellPP: 360,
  markup: 20,
  pax: 2,
  seasonName: 'November',
  seasonValidFrom: '2026-11-01',
  seasonValidTo: '2026-11-30',
  rateSeasonStatus: 'matched'
};
const confirmedInside = revalidateServicesForWindow({
  days: [{ services: [novemberLine] }],
  libraryItems: [novemberItem],
  paxCount: 2,
  travelWindow: { start: '2026-11-14', end: '2026-11-23' }
});
const confirmedLine = confirmedInside.days[0].services[0];
check('confirming dates inside the covered month reprices nothing', confirmedInside.repriced, 0);
check('confirming dates inside the covered month keeps the price', confirmedLine.buyPP, 300);
check('confirming dates inside the covered month keeps the status', confirmedLine.rateSeasonStatus, 'matched');
check('confirming dates inside the covered month raises no issue', confirmedInside.issues.length, 0);

/* 3. The month straddles two seasons. The one covering more of the month is
      provisional for its own sub-window, never protected. */
const autumnRate = {
  id: 'r-autumn', currency: 'ZAR', season_name: 'Autumn',
  valid_from: '2026-09-01', valid_to: '2026-11-10',
  price_1_adult: 100, rate_basis: 'per_person'
};
const peakRate = {
  id: 'r-peak', currency: 'ZAR', season_name: 'Peak',
  valid_from: '2026-11-11', valid_to: '2027-03-31',
  price_1_adult: 200, rate_basis: 'per_person'
};
const splitItem = { id: 'activity-split', category: 'Activities / Tours', item_rates: [autumnRate, peakRate] };
const splitArgs = {
  rates: splitItem.item_rates, currencyCode: 'ZAR',
  startDate: NOV_2026.start, endDate: NOV_2026.end
};

check('a split month is not silently matched without consent', resolveSeasonForTravel(splitArgs).status, 'no_price');

const provisionalMonth = resolveSeasonForTravel({ ...splitArgs, allowPartial: true, protectionPercent: 10 });
check('a split month resolves to a provisional season', provisionalMonth.status, 'provisional');
check('the season covering most of the month wins', provisionalMonth.seasonName, 'Peak');
check('the provisional price is never protected', provisionalMonth.protectionPercent, 0);
check('the provisional line records the covered sub-window start', provisionalMonth.provisionalFrom, '2026-11-11');
check('the provisional line records the covered sub-window end', provisionalMonth.provisionalTo, '2026-11-30');
check('the provisional line status is provisional', seasonLineStatus(provisionalMonth), 'provisional');

const provisionalLine = {
  itemId: splitItem.id,
  name: 'Split-month activity',
  category: 'Activities / Tours',
  currencyCode: 'ZAR',
  buyPP: 200,
  sellPP: 240,
  markup: 20,
  pax: 2,
  seasonName: 'Peak',
  seasonValidFrom: '2026-11-11',
  seasonValidTo: '2027-03-31',
  rateSeasonStatus: 'provisional',
  provisionalFrom: '2026-11-11',
  provisionalTo: '2026-11-30'
};

const confirmedWithinProvisional = revalidateServicesForWindow({
  days: [{ services: [provisionalLine] }],
  libraryItems: [splitItem],
  paxCount: 2,
  travelWindow: { start: '2026-11-20', end: '2026-11-22' }
});
const stillPeak = confirmedWithinProvisional.days[0].services[0];
check('dates inside the provisional sub-window keep the peak price', stillPeak.buyPP, 200);
check('dates inside the provisional sub-window become an exact match', stillPeak.rateSeasonStatus, 'matched');
check('settling the line clears the provisional sub-window start', stillPeak.provisionalFrom, '');
check('settling the line clears the provisional sub-window end', stillPeak.provisionalTo, '');

const confirmedInOtherSeason = revalidateServicesForWindow({
  days: [{ services: [provisionalLine] }],
  libraryItems: [splitItem],
  paxCount: 2,
  travelWindow: { start: '2026-11-03', end: '2026-11-05' }
});
const repricedLine = confirmedInOtherSeason.days[0].services[0];
check('dates in the other season re-evaluate the line', confirmedInOtherSeason.repriced, 1);
check('dates in the other season adopt its price', repricedLine.buyPP, 100);
check('dates in the other season adopt its name', repricedLine.seasonName, 'Autumn');
check('dates in the other season record an exact match', repricedLine.rateSeasonStatus, 'matched');

/* 4. Party-size repricing keeps the provisional stamp on a month-timed line. */
const repricedForPax = repriceServicesForPax({
  days: [{ services: [{ ...provisionalLine, pax: 2 }] }],
  libraryItems: [splitItem],
  paxCount: 3,
  travelWindow: NOV_2026,
  allowPartial: true
});
const repricedForPaxLine = repricedForPax.days[0].services[0];
check('a party-size change on a month line stays provisional', repricedForPaxLine.rateSeasonStatus, 'provisional');
check('a party-size change keeps the provisional sub-window', repricedForPaxLine.provisionalFrom, '2026-11-11');
check('a party-size change reprices from the provisional season', repricedForPaxLine.buyPP, 200);

/* 5. A new window no season covers is reported, never silently repriced. */
const uncovered = revalidateServicesForWindow({
  days: [{ services: [provisionalLine] }],
  libraryItems: [splitItem],
  paxCount: 2,
  travelWindow: { start: '2026-04-01', end: '2026-04-05' }
});
check('an uncovered window keeps the stored price', uncovered.days[0].services[0].buyPP, 200);
check('an uncovered window reports an issue', uncovered.issues.length, 1);

console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
