import {
  calculatePackageTravellerBreakdown,
  childBandForRange,
  normaliseChildAgeRange,
  PACKAGE_MAX_CHILD_AGE,
  packageChildAgeRange,
  packageSeasonCoverage,
  packageSeasonResolution,
  packageItemCapacityError,
  roomsForPax
} from '../src/lib/packagePricing.js';

const check = (label, actual, expected) => {
  const passed = Object.is(actual, expected);
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  if (!passed) process.exitCode = 1;
};

const transfer = {
  id: 'transfer',
  name: '6-seat transfer',
  category: 'Transfers',
  max_occupancy: 4,
  item_rates: [{ id: 'transfer-rate', currency: 'ZAR', rate_basis: 'per_vehicle', unit_cost: 1400 }]
};
const accommodation = {
  id: 'hotel',
  name: 'Contract hotel',
  category: 'Accommodation',
  max_occupancy: 2,
  child_age_ranges: [],
  item_rates: [{
    id: 'hotel-rate', currency: 'ZAR', rate_basis: 'per_person_sharing',
    price_1_adult: 810, price_2_adults: 540,
    child_rates_breakdown: { child: 330 }
  }]
};
const packageDays = [{
  services: [
    {
      item_id: 'transfer', rate_id: 'transfer-rate', item_name: '6-seat transfer',
      currency_code: 'ZAR', rate_basis: 'per_vehicle', unit_cost: 1400,
      quantity: 1, is_included: true
    },
    {
      item_id: 'hotel', rate_id: 'hotel-rate', item_name: 'Contract hotel',
      category: 'Accommodation', currency_code: 'ZAR', rate_basis: 'per_person_sharing',
      unit_cost: 810, quantity: 1, is_included: true
    }
  ]
}];

const childRange = { ageFrom: 0, ageTo: PACKAGE_MAX_CHILD_AGE };
const price = calculatePackageTravellerBreakdown({
  days: packageDays,
  pattern: { pax: 4 },
  library: [transfer, accommodation],
  childRange
})[0];

check('vehicle capacity warns when a traveller pattern exceeds it', Boolean(packageItemCapacityError(transfer, transfer.item_rates[0], [{ pax: 5 }])), true);
check('vehicle capacity allows a pattern that fits', packageItemCapacityError(transfer, transfer.item_rates[0], [{ pax: 4 }]), '');
check('vehicle capacity cannot be skipped without a traveller pattern', Boolean(packageItemCapacityError(transfer, transfer.item_rates[0], [])), true);
check('pax are split into rooms within capacity', roomsForPax(5, 2).every((room) => room.occupants <= 2), true);
check('pax fill whole rooms before a partial one', roomsForPax(5, 2).map((room) => room.occupants).join(','), '2,2,1');
check('a legacy adults/children row still reads as its party size', calculatePackageTravellerBreakdown({ days: packageDays, pattern: { adults: 2, children: 2 }, library: [transfer, accommodation] })[0].pax, 4);

check('shared unit price is divided across the pax', price.unitPerPerson, 350);
check('accommodation sharing is the adult share', price.accommodationSharing, 540);
check('total per adult sharing includes the unit share and hotel share', price.adultSharingTotal, 890);
check('single supplement is separately itemised', price.singleSupplement, 270);
check('the single-supplement card includes the unit share', price.singleSupplementTotal, 350 + 270);
check('child price uses the contracted child rate on the same unit share', price.childTotal, 680);
check('accommodation indicates the required room count', price.accommodationRows[0].roomCount, 2);

/* Every column has to carry a figure: a blank reads as "not worked out yet". */
check('a unit row reports a real zero for the accommodation columns',
  [price.unitRows[0].sharingPerAdult, price.unitRows[0].singleSupplement, price.unitRows[0].childAccommodation].join(','), '0,0,0');
check('the accommodation row is not counted as a unit row', price.unitRows.length, 1);
check('the unit total is the unit share times the pax', price.unitTotal, 350 * 4);

const noChildRateHotel = {
  ...accommodation,
  id: 'adults-only-lodge',
  name: 'Adults-only lodge',
  item_rates: [{
    id: 'hotel-no-child-rate', currency: 'ZAR', rate_basis: 'per_person_sharing',
    price_1_adult: 810, price_2_adults: 540
  }]
};
const childFallback = calculatePackageTravellerBreakdown({
  days: [{
    services: [{
      item_id: noChildRateHotel.id, rate_id: 'hotel-no-child-rate',
      item_name: noChildRateHotel.name, category: 'Accommodation',
      currency_code: 'ZAR', rate_basis: 'per_person_sharing',
      unit_cost: 810, quantity: 1, is_included: true
    }]
  }],
  pattern: { pax: 2 },
  library: [noChildRateHotel],
  childRange
})[0];
check('a child an accommodation will not take is quoted at the single supplement', childFallback.childTotal, 270);
check('the refused accommodation is named so the operator can see why', childFallback.childNotAllowed.join(','), noChildRateHotel.name);
check('adult sharing baseline is unchanged by the child fallback', childFallback.adultSharingTotal, 540);
check('the adult single supplement card is the unit share plus the supplement', childFallback.singleSupplementTotal, 270);

/* The room count is already baked into adultTotal, so multiplying the per-traveller
   figures by it again is what inflated a 4-room package to four times the contract
   rate (R7380 instead of R1845). */
const multiRoom = calculatePackageTravellerBreakdown({
  days: packageDays.map((day) => ({ ...day, services: [day.services[1]] })),
  pattern: { pax: 8 },
  library: [accommodation],
  childRange
})[0];
check('eight pax over four rooms still quotes the per-traveller share', multiRoom.accommodationRows[0].sharingPerAdult, 540);
check('the single supplement is per traveller, not per room', multiRoom.singleSupplement, 270);
check('the four allocated rooms are still reported', multiRoom.accommodationRows[0].roomCount, 4);
check('adult sharing stays at the contract rate for the whole party', multiRoom.adultSharingTotal, 540);

const sixTravellerTransfer = calculatePackageTravellerBreakdown({
  days: packageDays.map((day) => ({ ...day, services: [day.services[0]] })),
  pattern: { pax: 6 },
  library: [transfer],
  childRange
})[0];
check('multi-vehicle unit share charges for every vehicle required by capacity', sixTravellerTransfer.unitPerPerson, 466.67);

/* ---- One child age range, capped at 18, priced from each property's own bands ---- */

check('the package child range runs up to 18, not 17', PACKAGE_MAX_CHILD_AGE, 18);
check('an open-ended range closes at 18', normaliseChildAgeRange({ ageFrom: 4, ageTo: null }).ageTo, 18);
check('a range cannot be pushed past 18', normaliseChildAgeRange({ ageFrom: 0, ageTo: 25 }).ageTo, 18);
check('an inverted range is pulled back to its own floor', normaliseChildAgeRange({ ageFrom: 12, ageTo: 4 }).ageTo, 12);
check('no range at all is null, not an empty object', packageChildAgeRange(undefined), null);

const bandedHotel = {
  ...accommodation,
  child_age_ranges: [
    { id: 'infant', name: 'Infant', ageFrom: 0, ageTo: 2 },
    { id: 'child', name: 'Child', ageFrom: 3, ageTo: 17 },
    { id: 'teen', name: 'Teen', ageFrom: 18, ageTo: 18 }
  ],
  item_rates: [{
    id: 'hotel-rate', currency: 'ZAR', rate_basis: 'per_person_sharing',
    price_1_adult: 810, price_2_adults: 540,
    child_rates_breakdown: { infant: 180, child: 330, teen: 420 }
  }]
};
const bandedDays = [{
  services: [{
    item_id: bandedHotel.id, rate_id: 'hotel-rate', item_name: bandedHotel.name,
    category: 'Accommodation', currency_code: 'ZAR', rate_basis: 'per_person_sharing',
    unit_cost: 810, quantity: 1, is_included: true
  }]
}];
const bandedLibrary = [bandedHotel];

check('a narrow range resolves to the only band that spans it',
  childBandForRange(bandedHotel.item_rates[0], bandedHotel.child_age_ranges, { ageFrom: 0, ageTo: 2 }).band.id, 'infant');
check('a narrow range resolves to its own contracted rate',
  childBandForRange(bandedHotel.item_rates[0], bandedHotel.child_age_ranges, { ageFrom: 0, ageTo: 2 }).rate, 180);
check('a wide range is priced off the most expensive band it spans, never the infant one',
  childBandForRange(bandedHotel.item_rates[0], bandedHotel.child_age_ranges, { ageFrom: 0, ageTo: PACKAGE_MAX_CHILD_AGE }).band.id, 'teen');
check('a range reaching 18 picks up a band that treats 18 as a child',
  childBandForRange(bandedHotel.item_rates[0], bandedHotel.child_age_ranges, { ageFrom: 0, ageTo: PACKAGE_MAX_CHILD_AGE }).rate, 420);
check('a band the contract does not price is reported as not allowed',
  childBandForRange(noChildRateHotel.item_rates[0], bandedHotel.child_age_ranges, { ageFrom: 4, ageTo: 12 }).known, false);
check('no declared range means no child price at all',
  childBandForRange(bandedHotel.item_rates[0], bandedHotel.child_age_ranges, null).known, false);

const wideChild = calculatePackageTravellerBreakdown({
  days: bandedDays,
  pattern: { pax: 2 },
  library: bandedLibrary,
  childRange: { ageFrom: 0, ageTo: PACKAGE_MAX_CHILD_AGE }
})[0];
check('the child price is the unit share plus the band the property charges',
  wideChild.childTotal, 420);
check('the accommodation row names the band it used', wideChild.accommodationRows[0].childBandName, 'Teen');
check('an allowed property is not reported as refusing the child', wideChild.childNotAllowed.length, 0);
check('a child never gets its own room in the quote', wideChild.accommodationRows[0].roomCount, 1);

const noRangeAtAll = calculatePackageTravellerBreakdown({
  days: bandedDays, pattern: { pax: 2 }, library: bandedLibrary
})[0];
check('without a declared child range the child card is flagged as unpriced', noRangeAtAll.childPriced, false);

/* A package can mix a property that takes children with one that does not: the child
   pays its own band on the first and the single supplement on the second. */
const adultsOnly = {
  ...noChildRateHotel,
  item_rates: noChildRateHotel.item_rates
};
const mixedDays = [{
  services: [
    bandedDays[0].services[0],
    {
      item_id: adultsOnly.id, rate_id: 'hotel-no-child-rate',
      item_name: adultsOnly.name, category: 'Accommodation',
      currency_code: 'ZAR', rate_basis: 'per_person_sharing',
      unit_cost: 810, quantity: 1, is_included: true
    }
  ]
}];
const mixedLibrary = [...bandedLibrary, adultsOnly];
const mixed = calculatePackageTravellerBreakdown({
  days: mixedDays,
  pattern: { pax: 2 },
  library: mixedLibrary,
  childRange: { ageFrom: 4, ageTo: 12 }
})[0];
check('a mixed package charges the band on one property and the supplement on the other',
  mixed.childAccommodation, 330 + 270);
check('only the property that refuses the child is named', mixed.childNotAllowed.join(','), adultsOnly.name);
check('the adult price still shares both properties', mixed.adultSharingTotal, 1080);

/* Without a declared child range nothing is being priced for a child, so no
   accommodation can be said to be "refusing" one. Reporting them as refusals made the
   Children tab read a null age range off the result and threw on render. */
const noRangeMixed = calculatePackageTravellerBreakdown({
  days: mixedDays, pattern: { pax: 2 }, library: mixedLibrary
})[0];
check('nothing is reported as refusing a child before a range is declared', noRangeMixed.childNotAllowed.length, 0);
check('an unpriced accommodation answers null, not "no"', noRangeMixed.accommodationRows[0].childAllowed, null);

/* ---- Season matrix must span the package validity dates ---- */

const seasonal = {
  id: 'tour',
  name: 'Day tour',
  category: 'Activities',
  pricing_model: 'per_person',
  item_rates: [
    { id: 'summer', season_name: 'Summer', currency: 'ZAR', rate_basis: 'per_person', price_1_adult: 400, valid_from: '2026-11-01', valid_to: '2027-01-31' },
    { id: 'winter', season_name: 'Winter', currency: 'ZAR', rate_basis: 'per_person', price_1_adult: 350, valid_from: '2027-02-01', valid_to: '2027-04-30' }
  ]
};

check('a season spanning the package dates is accepted',
  packageSeasonCoverage(seasonal, seasonal.item_rates[0], [{ valid_from: '2026-12-01', valid_to: '2026-12-10' }]).ok, true);
check('a season that stops before the package dates is refused',
  packageSeasonCoverage(seasonal, seasonal.item_rates[0], [{ valid_from: '2026-12-01', valid_to: '2027-03-01' }]).ok, false);
check('a package with no validity period is left alone',
  packageSeasonCoverage(seasonal, seasonal.item_rates[0], []).ok, true);
check('the refusal names the season so the operator can pick another',
  packageSeasonCoverage(seasonal, seasonal.item_rates[0], [{ valid_from: '2027-03-01', valid_to: '2027-03-05' }]).status, 'swap');
check('the right season for those dates is accepted',
  packageSeasonCoverage(seasonal, seasonal.item_rates[1], [{ valid_from: '2027-03-01', valid_to: '2027-03-05' }]).ok, true);

/* A package can carry several validity ranges, and one day item only carries one
   season - so a single season has to span all of them, not just one. */
const twoRanges = [{ valid_from: '2026-12-01', valid_to: '2026-12-05' }, { valid_from: '2026-12-20', valid_to: '2026-12-28' }];
check('a season spanning every validity range is accepted',
  packageSeasonCoverage(seasonal, seasonal.item_rates[0], twoRanges).ok, true);
check('two ranges the one season only half-covers are refused',
  packageSeasonCoverage(seasonal, seasonal.item_rates[0], [twoRanges[0], { valid_from: '2027-02-10', valid_to: '2027-02-14' }]).ok, false);
check('a season covering one range of two is still refused',
  packageSeasonCoverage(seasonal, seasonal.item_rates[0], [{ valid_from: '2026-12-01', valid_to: '2026-12-05' }, { valid_from: '2027-02-10', valid_to: '2027-02-14' }]).status, 'missing');

/* An inverted or half-typed date pair must not silently disable the check. */
check('an incomplete validity range is ignored, not treated as a whole package',
  packageSeasonCoverage(seasonal, seasonal.item_rates[0], [{ valid_from: '2027-02-10' }]).ok, true);

/* The undated legacy row: no season dates at all, so it cannot be proven to cover. */
const undatedOnly = {
  id: 'legacy', name: 'Legacy tour', category: 'Activities',
  item_rates: [{ id: 'legacy-rate', season_name: 'Base Season', currency: 'ZAR', rate_basis: 'per_person', price_1_adult: 400 }]
};
check('an undated season cannot cover a package that has validity dates',
  packageSeasonCoverage(undatedOnly, undatedOnly.item_rates[0], [{ valid_from: '2027-03-01', valid_to: '2027-03-05' }]).ok, false);

/* ---- Pricing Protection, reused from the itinerary builder ---- */

/* Protection only ever quotes a season from a PRIOR year that shares the period of
   the year, so the trip has to fall in a window the one season behind it also runs.
   A June trip against a Nov-Jan matrix is that shape; a December trip would simply
   be covered by a same-year Nov-Jan season and need no protection at all. */
const futureSeason = {
  id: 'tour', name: 'Day tour', category: 'Activities', pricing_model: 'per_person', currency: 'ZAR',
  item_rates: [
    { id: 'prev', season_name: 'Winter 2025', currency: 'ZAR', rate_basis: 'per_person', price_1_adult: 400, valid_from: '2025-06-01', valid_to: '2025-08-31' },
    { id: 'next', season_name: 'Summer 2027', currency: 'ZAR', rate_basis: 'per_person', price_1_adult: 440, valid_from: '2027-11-01', valid_to: '2028-01-31' }
  ]
};
const ahead = [{ valid_from: '2027-06-10', valid_to: '2027-06-15' }];

check('no season covers the dates, so the item is protected rather than refused',
  packageSeasonResolution({ item: futureSeason, rate: futureSeason.item_rates[0], periods: ahead, protectionPercent: 10 }).status, 'protected');
check('protection says how much was added', packageSeasonResolution({
  item: futureSeason, rate: futureSeason.item_rates[0], periods: ahead, protectionPercent: 10
}).protectionPercent, 10);
check('the returned rate is already uplifted', packageSeasonResolution({
  item: futureSeason, rate: futureSeason.item_rates[0], periods: ahead, protectionPercent: 10
}).rate.price_1_adult, 440);
check('an unprotected package may still join the package',
  packageSeasonResolution({ item: futureSeason, rate: futureSeason.item_rates[0], periods: ahead, protectionPercent: 10 }).canAdd, true);
check('the message tells the operator protection was applied',
  packageSeasonResolution({ item: futureSeason, rate: futureSeason.item_rates[0], periods: ahead, protectionPercent: 10 }).message.includes('Pricing Protection applied'), true);

check('a covering season needs no protection', packageSeasonResolution({
  item: seasonal, rate: seasonal.item_rates[0], periods: [{ valid_from: '2026-12-01', valid_to: '2026-12-10' }], protectionPercent: 10
}).status, 'ok');
check('a package with no validity dates is left open', packageSeasonResolution({
  item: futureSeason, rate: futureSeason.item_rates[0], periods: [], protectionPercent: 10
}).status, 'open');

/* Nothing usable at all is still a hard stop - protection cannot invent a price. */
const onlyFuture = { ...futureSeason, item_rates: [futureSeason.item_rates[1]] };
const blocked = packageSeasonResolution({ item: onlyFuture, rate: onlyFuture.item_rates[0], periods: ahead, protectionPercent: 10 });
check('an item with no prior season cannot be protected and is blocked', blocked.canAdd, false);
check('the block names the item and explains why', blocked.message.includes('Day tour'), true);

/* A protected line stores its uplifted snapshot; the breakdown must price from that
   snapshot (440) and not from the un-uplifted live library row (400). */
const protectedPrice = calculatePackageTravellerBreakdown({
  days: [{
    services: [{
      item_id: 'tour', rate_id: 'prev', item_name: 'Day tour', category: 'Activities',
      currency_code: 'ZAR', rate_basis: 'per_person', unit_cost: 440, quantity: 1, is_included: true,
      rate_snapshot: { id: 'prev', price_1_adult: 440, unit_cost: 440, rate_basis: 'per_person' },
      price_protection_percent: 10
    }]
  }],
  pattern: { pax: 2 },
  library: [futureSeason],
  childRange
})[0];
check('a protected line prices from its uplifted snapshot, not the live 400 row', protectedPrice.unitPerPerson, 440);
