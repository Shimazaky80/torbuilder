import {
  applyPackageMarkup,
  calculatePackageTravellerBreakdown,
  childBandForRange,
  normaliseChildAgeRange,
  PACKAGE_MAX_CHILD_AGE,
  packageBandCapacityError,
  packageBandForPax,
packageBandLabel,
  packageBandPax,
  packageBandSuggestions,
  packageCurrencyFor,
  packageChildAgeRange,
  packageItemsForTier,
  packageSeasonCoverage,
  packageMarkupPercent,
  packageSeasonResolution,
  packageItemCapacitySetupError,
  packageServicesForTier,
  packageTierDays,
  packageTransportSummary,
  roomsForPax,
  packageAutoBandKey
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
});
/* This check is only ever about whether the library item itself is usable. Whether a
   vehicle is big enough for a band is answered per band by packageBandCapacityError: a
   package is loaded one vehicle at a time, so a single vehicle must never be measured
   against the bands while the rest of the set is still missing. That is exactly what used
   to block the smallest vehicle of the set while letting the larger ones through. */
check('a transport with a contracted capacity is fit to be added',
  packageItemCapacitySetupError(transfer, transfer.item_rates[0]), '');
check('a transport with no capacity set is refused, because it can never price a band',
  packageItemCapacitySetupError({ ...transfer, max_occupancy: 0 }, transfer.item_rates[0]).includes('no maximum occupancy set'), true);
check('a transport is not blocked for being smaller than a band',
  packageItemCapacitySetupError(transfer, transfer.item_rates[0], [{ pax: 50 }]), '');
check('an item that is not capacity-limited is never blocked',
  packageItemCapacitySetupError({ ...transfer, category: 'Meals' }, transfer.item_rates[0]), '');
check('pax are split into rooms within capacity', roomsForPax(5, 2).every((room) => room.occupants <= 2), true);
check('pax fill whole rooms before a partial one', roomsForPax(5, 2).map((room) => room.occupants).join(','), '2,2,1');
check('a legacy adults/children row still reads as its party size', calculatePackageTravellerBreakdown({ days: packageDays, pattern: { adults: 2, children: 2 }, library: [transfer, accommodation] }).pax, 4);

check('shared unit price is divided across the pax', price.unitPerPerson, 350);
check('accommodation sharing is the adult share', price.accommodationSharing, 540);
check('total per adult sharing includes the unit share and hotel share', price.adultSharingTotal, 890);
check('single supplement is separately itemised', price.singleSupplement, 270);
/* The supplement card is labelled as being added to the sharing price, so it has to be that
   price plus the supplement. Building it on the unit share alone left the "single supplement"
   card quoting LESS than the "adult sharing" card beside it, which read as the supplement
   being a discount. */
check('the single-supplement card is the sharing price plus the supplement',
  price.singleSupplementTotal, price.adultSharingTotal + price.singleSupplement);
check('child price uses the contracted child rate on the same unit share', price.childTotal, 680);
check('accommodation indicates the required room count', price.accommodationRows[0].roomCount, 2);

/* Every column has to carry a figure: a blank reads as "not worked out yet". */
check('a unit row reports a real zero for the accommodation columns',
  [price.unitRows[0].sharingPerAdult, price.unitRows[0].singleSupplement, price.unitRows[0].childAccommodation].join(','), '0,0,0');
check('the accommodation row is not counted as a unit row', price.unitRows.length, 1);
check('the unit total is the unit share times the pax', price.unitTotal, 350 * 4);

/* A package assigned to a partner carries that client's default markup. The contract
   figures must stay untouched underneath, because the internal STO sheet and the
   reconciliation against supplier invoices are both priced off them. */
const markedUp = calculatePackageTravellerBreakdown({
  days: packageDays,
  pattern: { pax: 4 },
  library: [transfer, accommodation],
  childRange,
  markupPercent: 20
});
check('the markup is reported back so the builder can label the price', markedUp.markupPercent, 20);
check('the marked-up adult price is the contract total plus the markup', markedUp.sell.adultSharingTotal, 890 * 1.2);
check('the marked-up unit share is marked up too', markedUp.sell.unitPerPerson, 350 * 1.2);
check('the marked-up sharing amount is marked up too', markedUp.sell.accommodationSharing, 540 * 1.2);
check('the marked-up single supplement card is marked up too', markedUp.sell.singleSupplementTotal, 1160 * 1.2);
check('the child price is marked up, so a child is not the discount it looks like', markedUp.sell.childTotal, 680 * 1.2);
check('a marked-up price never erases the contract figure it came from',
  [markedUp.adultSharingTotal, markedUp.singleSupplementTotal, markedUp.childTotal].join(','), '890,1160,680');
check('the whole adult card adds up at the marked-up figures',
  markedUp.sell.unitPerPerson + markedUp.sell.accommodationSharing, markedUp.sell.adultSharingTotal);
check('no markup means the partner figures equal the contract figures',
  calculatePackageTravellerBreakdown({ days: packageDays, pattern: { pax: 4 }, library: [transfer, accommodation], childRange })
    .sell.adultSharingTotal, 890);
check('a zero markup still reports zero rather than blank', calculatePackageTravellerBreakdown({
  days: packageDays, pattern: { pax: 4 }, library: [transfer, accommodation], childRange
}).markupPercent, 0);

check('a partner markup is read from the client record', packageMarkupPercent([{ markup_percentage: 12.5 }]), 12.5);
check('a partner on a zero markup does not discount the package', packageMarkupPercent([{ markup_percentage: 0 }]), 0);
check('with several partners the highest markup is used so nobody is under-quoted',
  packageMarkupPercent([{ markup_percentage: 10 }, { markup_percentage: 18.25 }]), 18.25);
check('a client with no markup recorded counts as zero', packageMarkupPercent([{ id: 'a' }, { markup_percentage: null }]), 0);
check('no assigned partner means no markup', packageMarkupPercent([]), 0);
check('a negative markup is never used to cut a price', packageMarkupPercent([{ markup_percentage: -20 }]), 0);
check('a missing markup leaves the amount untouched', applyPackageMarkup(890, undefined), 890);
check('a markup is a multiplier on the finished total', applyPackageMarkup(890, 20), 1068);
check('a negative markup is treated as no markup', applyPackageMarkup(890, -5), 890);
check('marked-up money is rounded to cents, not carried at full precision', applyPackageMarkup(333.33, 15), 383.33);

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
});
check('a child an accommodation will not take is quoted at the single supplement', childFallback.childTotal, 270);
check('the refused accommodation is named so the operator can see why', childFallback.childNotAllowed.join(','), noChildRateHotel.name);
check('adult sharing baseline is unchanged by the child fallback', childFallback.adultSharingTotal, 540);
check('the adult single supplement card adds to the sharing price, never undercuts it',
  childFallback.singleSupplementTotal, childFallback.adultSharingTotal + childFallback.singleSupplement);

/* A property that publishes one price for the room and nothing for a single occupant
   has no supplement to take, which used to quote the child at R0.00. The room costs
   the same either way, so the child carries the room price itself. */
const flatRateLodge = {
  id: 'lodge-flat-rate', name: 'Flat Rate Lodge', category: 'Accommodation',
  item_rates: [{ id: 'lodge-flat-rate-rate', currency: 'ZAR', rate_basis: 'per_person_sharing', unit_price: 640 }]
};
const flatOnlyChild = calculatePackageTravellerBreakdown({
  days: [{
    services: [{
      item_id: flatRateLodge.id, rate_id: 'lodge-flat-rate-rate',
      item_name: flatRateLodge.name, category: 'Accommodation',
      supplier_name: 'Flat Rate Lodge Inns',
      currency_code: 'ZAR', rate_basis: 'per_person_sharing',
      unit_cost: 640, quantity: 1, is_included: true
    }]
  }],
  pattern: { pax: 2 },
  library: [flatRateLodge],
  childRange
});
check('a child is never quoted R0.00 where no single rate is published', flatOnlyChild.accommodationRows[0].childAccommodation, 640);
check('the flat-rate property is still reported as refusing the child', flatOnlyChild.childNotAllowed.join(','), flatRateLodge.name);
check('each accommodation carries its supplier for the Children tab', flatOnlyChild.accommodationRows[0].supplierName, 'Flat Rate Lodge Inns');
check('adult sharing at a flat rate is the room price', flatOnlyChild.adultSharingTotal, 640);

/* A property states its single supplement outright. Reading it as the single rate minus
   the sharing rate looks equivalent, but a contract where both resolve to the same
   figure produced a difference of zero, and the buyer then saw a child quoted R0.00
   for a room the property charges single occupancy for. The published figure wins. */
const statedSupplementHotel = {
  id: 'hotel-stated-supp', name: 'Stated Supplement Hotel', category: 'Accommodation',
  item_rates: [{
    id: 'hotel-stated-supp-rate', currency: 'ZAR', rate_basis: 'per_person_sharing',
    price_1_adult: 1845, price_2_adults: 1845, single_supplement: 1435
  }]
};
const statedSupplement = calculatePackageTravellerBreakdown({
  days: [{
    services: [{
      item_id: statedSupplementHotel.id, rate_id: 'hotel-stated-supp-rate',
      item_name: statedSupplementHotel.name, category: 'Accommodation',
      supplier_name: 'Stated Supplement Lodge',
      currency_code: 'ZAR', rate_basis: 'per_person_sharing',
      unit_cost: 1845, quantity: 1, is_included: true
    }]
  }],
  pattern: { pax: 2 },
  library: [statedSupplementHotel],
  childRange
});
check('the published single supplement is read rather than derived as zero', statedSupplement.singleSupplement, 1435);
check('a child the property will not take is charged that single supplement', statedSupplement.accommodationRows[0].childAccommodation, 1435);
check('the child basis is named as the single supplement', statedSupplement.accommodationRows[0].childBasis, 'Single supplement');
check('the refusing property contributes its supplement to the child total', statedSupplement.childSupplement, 1435);
check('the child total is the unit share plus the supplement', statedSupplement.childTotal, 1435);

/* A property whose child band is published as 0 has no child price for that band. The
   itinerary builder honours that as a free child, but a package publishes to a buyer,
   and R0.00 for the accommodation reads as "the child is free". It must fall through to
   the single supplement instead. */
const zeroChildBandHotel = {
  id: 'hotel-zero-child-band', name: 'Zero Band Hotel', category: 'Accommodation',
  child_age_ranges: [{ id: 'zcb-1', name: 'Infant', ageFrom: 0, ageTo: 2 }, { id: 'zcb-2', name: 'Child', ageFrom: 3, ageTo: 12 }],
  item_rates: [{
    id: 'hotel-zero-child-band-rate', currency: 'ZAR', rate_basis: 'per_person_sharing',
    price_1_adult: 1200, price_2_adults: 900, single_supplement: 620,
    child_rates_breakdown: { 'zcb-1': 0, 'zcb-2': 0 }
  }]
};
const zeroBand = calculatePackageTravellerBreakdown({
  days: [{
    services: [{
      item_id: zeroChildBandHotel.id, rate_id: 'hotel-zero-child-band-rate',
      item_name: zeroChildBandHotel.name, category: 'Accommodation',
      supplier_name: 'Zero Band Property',
      currency_code: 'ZAR', rate_basis: 'per_person_sharing',
      unit_cost: 900, quantity: 1, is_included: true
    }]
  }],
  pattern: { pax: 2 },
  library: [zeroChildBandHotel],
  childRange
});
check('a zero child rate is not published as a free child', zeroBand.accommodationRows[0].childAccommodation, 620);
check('a zero child rate is charged the single supplement instead', zeroBand.accommodationRows[0].childBasis, 'Single supplement (no child rate published)');
check('a zero child rate is reported as refusing the child', zeroBand.childNotAllowed.join(','), zeroChildBandHotel.name);
check('the child total adds the supplement to the unit share', zeroBand.childTotal, 620);
check('childSupplement reports the supplement actually charged to a child', zeroBand.childSupplement, 620);

/* A property with a real child band keeps its child rate and is not charged a supplement. */
const realChildBandHotel = {
  id: 'hotel-real-child-band', name: 'Real Band Hotel', category: 'Accommodation',
  child_age_ranges: [{ id: 'rcb-1', name: 'Child', ageFrom: 3, ageTo: 12 }],
  item_rates: [{
    id: 'hotel-real-child-band-rate', currency: 'ZAR', rate_basis: 'per_person_sharing',
    price_1_adult: 1200, price_2_adults: 900, single_supplement: 620,
    child_rates_breakdown: { 'rcb-1': 450 }
  }]
};
const realBand = calculatePackageTravellerBreakdown({
  days: [{
    services: [{
      item_id: realChildBandHotel.id, rate_id: 'hotel-real-child-band-rate',
      item_name: realChildBandHotel.name, category: 'Accommodation',
      supplier_name: 'Real Band Property',
      currency_code: 'ZAR', rate_basis: 'per_person_sharing',
      unit_cost: 900, quantity: 1, is_included: true
    }]
  }],
  pattern: { pax: 2 },
  library: [realChildBandHotel],
  childRange
});
check('a real child rate is still used as the child accommodation price', realBand.accommodationRows[0].childAccommodation, 450);
check('a real child rate is not replaced by the supplement', realBand.accommodationRows[0].childBasis, 'Property child rate');
check('a real child rate is not reported as refusing the child', realBand.childNotAllowed.length, 0);
check('a real child rate contributes nothing to childSupplement', realBand.childSupplement, 0);

/* The room count is already baked into adultTotal, so multiplying the per-traveller
   figures by it again is what inflated a 4-room package to four times the contract
   rate (R7380 instead of R1845). */
const multiRoom = calculatePackageTravellerBreakdown({
  days: packageDays.map((day) => ({ ...day, services: [day.services[1]] })),
  pattern: { pax: 8 },
  library: [accommodation],
  childRange
});
check('eight pax over four rooms still quotes the per-traveller share', multiRoom.accommodationRows[0].sharingPerAdult, 540);
check('the single supplement is per traveller, not per room', multiRoom.singleSupplement, 270);
check('the four allocated rooms are still reported', multiRoom.accommodationRows[0].roomCount, 4);
check('adult sharing stays at the contract rate for the whole party', multiRoom.adultSharingTotal, 540);

const sixTravellerTransfer = calculatePackageTravellerBreakdown({
  days: packageDays.map((day) => ({ ...day, services: [day.services[0]] })),
  pattern: { pax: 6 },
  library: [transfer],
  childRange
});
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
});
check('the child price is the unit share plus the band the property charges',
  wideChild.childTotal, 420);
check('the accommodation row names the band it used', wideChild.accommodationRows[0].childBandName, 'Teen');
check('an allowed property is not reported as refusing the child', wideChild.childNotAllowed.length, 0);
check('a child never gets its own room in the quote', wideChild.accommodationRows[0].roomCount, 1);

const noRangeAtAll = calculatePackageTravellerBreakdown({
  days: bandedDays, pattern: { pax: 2 }, library: bandedLibrary
});
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
});
check('a mixed package charges the band on one property and the supplement on the other',
  mixed.childAccommodation, 330 + 270);
check('only the property that refuses the child is named', mixed.childNotAllowed.join(','), adultsOnly.name);
check('the adult price still shares both properties', mixed.adultSharingTotal, 1080);

/* Without a declared child range nothing is being priced for a child, so no
   accommodation can be said to be "refusing" one. Reporting them as refusals made the
   Children tab read a null age range off the result and threw on render. */
const noRangeMixed = calculatePackageTravellerBreakdown({
  days: mixedDays, pattern: { pax: 2 }, library: mixedLibrary
});
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
});
check('a protected line prices from its uplifted snapshot, not the live 400 row', protectedPrice.unitPerPerson, 440);

/* A package is priced in one currency. Offering a total per currency meant a buyer
   read three amounts as alternatives for the same holiday, and summing them produced
   a meaningless figure, so the foreign lines are reported instead of being totalled. */
const mixedCurrencyDays = [{
  services: [
    {
      item_id: 'zar-tour', item_name: 'ZAR Day tour', category: 'Activities',
      currency_code: 'ZAR', rate_basis: 'per_person', unit_cost: 400, quantity: 1, is_included: true
    },
    {
      item_id: 'usd-lodge', item_name: 'USD Lodge', category: 'Accommodation',
      supplier_name: 'Dollar Lodge',
      currency_code: 'USD', rate_basis: 'per_person_sharing', unit_cost: 300, quantity: 1, is_included: true
    }
  ]
}];
check('the package currency comes from the first included service', packageCurrencyFor(mixedCurrencyDays), 'ZAR');
const mixedCurrency = calculatePackageTravellerBreakdown({
  days: mixedCurrencyDays, pattern: { pax: 2 }, library: [], childRange
});
check('the breakdown reports a single currency, not one total per currency', mixedCurrency.currency, 'ZAR');
check('the total counts only the lines in the package currency', mixedCurrency.unitPerPerson, 400);
check('the foreign-currency line is reported rather than dropped', mixedCurrency.foreignCurrencyItems.map((entry) => entry.name).join(','), 'USD Lodge');
check('the foreign-currency line reports its own currency', mixedCurrency.foreignCurrencyItems[0].currency, 'USD');
check('a package with nothing in it still resolves a currency', packageCurrencyFor([]), 'ZAR');

/* ---------------------------------------------------------------------------
   PAX BANDS
   ---------------------------------------------------------------------------
   One package sells "up to 3" in a saloon and "from 4 to 10" in a microbus. Both vehicles
   sit on day 1 as alternatives, the bands are derived from their capacities, and each band
   is charged for one vehicle rather than for both. */
const saloon = {
  id: 'saloon', name: 'Saloon', category: 'Transfers', max_occupancy: 3,
  item_rates: [{ id: 'saloon-rate', currency: 'ZAR', rate_basis: 'per_vehicle', unit_price: 900 }]
};
const microbus = {
  id: 'microbus', name: 'Microbus', category: 'Transfers', max_occupancy: 10,
  item_rates: [{ id: 'microbus-rate', currency: 'ZAR', rate_basis: 'per_vehicle', unit_price: 3000 }]
};
const tour = {
  id: 'tour', name: 'Island tour', category: 'Activities', max_occupancy: 0,
  item_rates: [{ id: 'tour-rate', currency: 'ZAR', rate_basis: 'per_person', unit_price: 200 }]
};
const saloonService = {
  item_key: 'k-saloon', item_id: 'saloon', rate_id: 'saloon-rate', item_name: 'Saloon',
  category: 'Transfers', currency_code: 'ZAR', rate_basis: 'per_vehicle', unit_price: 900,
  vehicle_capacity: 3, quantity: 1, is_included: true, sort_order: 1
};
const microbusService = {
  item_key: 'k-microbus', item_id: 'microbus', rate_id: 'microbus-rate', item_name: 'Microbus',
  category: 'Transfers', currency_code: 'ZAR', rate_basis: 'per_vehicle', unit_price: 3000,
  vehicle_capacity: 10, quantity: 1, is_included: true, sort_order: 3
};
const tourService = {
  item_key: 'k-tour', item_id: 'tour', rate_id: 'tour-rate', item_name: 'Island tour',
  currency_code: 'ZAR', rate_basis: 'per_person', unit_price: 200,
  vehicle_capacity: null, quantity: 1, is_included: true, sort_order: 2
};
const bothVehicles = [{ day_number: 1, services: [saloonService, tourService, microbusService] }];
const vehicleLibrary = [saloon, microbus, tour];
const suggestions = packageBandSuggestions(bothVehicles, vehicleLibrary);

check('a saloon and a microbus suggest two party sizes', suggestions.length, 2);
check('the saloon suggests a 3 pax party', suggestions[0], 3);
check('the microbus suggests a 10 pax party', suggestions[1], 10);
check('a per-person service with no capacity suggests nothing',
  packageBandSuggestions([{ services: [tourService] }], vehicleLibrary).length, 0);
check('a lodge does not suggest a party size',
  packageBandSuggestions([{ services: [{ ...tourService, category: 'Accommodation', vehicle_capacity: 4 }] }], vehicleLibrary).length, 0);
check('two vehicles of the same size still suggest one party size',
  packageBandSuggestions([{ services: [saloonService, { ...saloonService, item_key: 'k-saloon-2' }] }], vehicleLibrary).length, 1);
check('an activity with a capacity is not treated as a swappable vehicle',
  packageBandSuggestions([{ services: [tourService, { ...tourService, item_key: 'k-boat', category: 'Activities', vehicle_capacity: 12 }] }], vehicleLibrary).length, 0);

const threePax = { item_key: 'band-3', pax: 3, min_pax: 3, max_pax: 3 };
const tenPax = { item_key: 'band-10', pax: 10, min_pax: 10, max_pax: 10 };

check('a band is one exact party size', packageBandPax(tenPax), 10);
check('a band that was stored as a range collapses onto the size it was priced at', packageBandPax({ pax: 10, min_pax: 4, max_pax: 10 }), 10);
check('a band label is a single party size', packageBandLabel(tenPax), '10 pax');
check('a legacy range no longer reads as a span', packageBandLabel({ pax: 10, min_pax: 4, max_pax: 10 }), '10 pax');
check('a width-one band reads the same way', packageBandLabel({ pax: 6, min_pax: 6, max_pax: 6 }), '6 pax');
check('a legacy adults/children row reads as a one-traveller band',
  packageBandPax({ adults: 2, children: 1 }), 3);
check('a party of 10 belongs to the 10 pax band', packageBandForPax([threePax, tenPax], 10).item_key, 'band-10');
check('a party of 3 belongs to the 3 pax band', packageBandForPax([threePax, tenPax], 3).item_key, 'band-3');
check('a party of 4 belongs to no band, because nobody set one', packageBandForPax([threePax, tenPax], 4), null);
check('a party beyond every band belongs to none of them', packageBandForPax([threePax, tenPax], 11), null);

/* The whole point: a party of 10 is charged for the microbus, not for the saloon too.
   Pricing both is the double-count that made this a copying problem in the first place. */
check('the saloon band is served by the saloon',
packageItemsForTier(bothVehicles, threePax, vehicleLibrary).map((service) => service.item_name).join(','),
  'Saloon,Island tour');
check('the big band is served by the microbus',
  packageItemsForTier(bothVehicles, tenPax, vehicleLibrary).map((service) => service.item_name).join(','),
  'Island tour,Microbus');

const smallBand = calculatePackageTravellerBreakdown({
  days: packageTierDays(bothVehicles, threePax, vehicleLibrary),
  pattern: threePax,
  library: vehicleLibrary
});
const bigBand = calculatePackageTravellerBreakdown({
  days: packageTierDays(bothVehicles, tenPax, vehicleLibrary),
  library: vehicleLibrary,
  pattern: tenPax
});
/* Saloon 900 for 3 pax -> 300 a head, tour 200 a head. Big band: microbus 3000 for 10 pax
   -> 300 a head, tour 200 a head. Each band recovers exactly one vehicle's cost. */
check('the saloon band is priced for 3 travellers in the saloon',
  [smallBand.pax, smallBand.unitPerPerson, smallBand.partyTotal].join(','), '3,500,1500');
check('the big band is priced for 10 travellers in the microbus',
  [bigBand.pax, bigBand.unitPerPerson, bigBand.partyTotal].join(','), '10,500,5000');
check('each band recovers one vehicle, not the cost of the whole fleet',
  [smallBand.partyTotal, bigBand.partyTotal].join(','), '1500,5000');
check('the microbus is paid for once across the band, not once per traveller',
  Math.round((bigBand.unitPerPerson - 200) * 10), 3000);
check('a party of 4 is never charged for the saloon as well as the microbus',
  packageItemsForTier(bothVehicles, tenPax, vehicleLibrary).some((service) => service.item_name === 'Saloon'), false);

/* Layer 2: an explicit band item, for the cases a capacity cannot describe. */
const extraExcursion = {
  ...tourService, item_key: 'k-extra', item_name: 'Boat excursion',
  tier_key: 'band-10', replaces_item_key: null
};
check('a band can add a service the other bands do not have',
  packageItemsForTier([{ day_number: 1, services: [saloonService, tourService, extraExcursion] }], tenPax, vehicleLibrary)
    .map((service) => service.item_name).join(','),
  'Saloon,Island tour,Boat excursion');

const saloonDropped = {
  ...saloonService, item_key: 'k-drop', tier_key: 'band-10',
  replaces_item_key: 'k-saloon', is_included: false
};
check('a band can drop a base service it does not pay for',
  packageItemsForTier([{ day_number: 1, services: [saloonService, tourService, saloonDropped] }], 'band-10', vehicleLibrary)
    .map((service) => service.item_name).join(','),
  'Island tour');

const microbusReplacingSaloon = {
  ...microbusService, item_key: 'k-bus-swap', tier_key: 'band-10', replaces_item_key: 'k-saloon'
};
check('a band item can replace a base service by hand',
  packageItemsForTier([{ day_number: 1, services: [saloonService, tourService, microbusReplacingSaloon] }], 'band-10', vehicleLibrary)
    .map((service) => service.item_name).join(','),
  'Island tour,Microbus');

/* A pointer to a base service that has since been deleted must not take the price down. */
const dangling = packageItemsForTier(
  [{ day_number: 1, services: [tourService, { ...saloonService, item_key: 'k-x', tier_key: 'band-10', replaces_item_key: 'k-deleted' }] }],
  'band-10',
  vehicleLibrary
);
check('a band pointer to a deleted service is ignored, not fatal',
  dangling.map((service) => service.item_name).join(','), 'Saloon,Island tour');

check('a package with a single vehicle is left alone, so legacy pricing is unchanged',
  packageItemsForTier(packageDays, threePax, [transfer, accommodation]).map((service) => service.item_name).join(','),
  '6-seat transfer,Contract hotel');

check('the 3 pax band is servable', packageBandCapacityError(bothVehicles, vehicleLibrary, threePax), '');
check('the 10 pax band is servable by the microbus', packageBandCapacityError(bothVehicles, vehicleLibrary, tenPax), '');
check('a band bigger than every vehicle is refused',
  packageBandCapacityError(bothVehicles, vehicleLibrary, { item_key: 'b22', pax: 22 }).includes('holds 10'), true);
check('the refusal names the band that cannot be served',
  packageBandCapacityError(bothVehicles, vehicleLibrary, { item_key: 'b22', pax: 22 }).includes('22 pax'), true);
check('a party of 4 is refused when only a 3-seater is priced for that band',
  packageBandCapacityError([{ day_number: 1, services: [saloonService] }], vehicleLibrary,
    { item_key: 'b4', pax: 4 }).includes('holds 3'), true);
check('a band with no transport at all is not a capacity problem',
  packageBandCapacityError([{ day_number: 1, services: [tourService] }], vehicleLibrary, tenPax), '');

/* Suggestions are not bands. A party size the operator never chose must not turn up in the
   package with a price attached to it, which is what deriving bands from vehicle capacity
   used to do - and it is what put a stray party size in the middle of a hand-set ladder. */
check('a party size already set as a band is not suggested again',
  packageBandSuggestions(bothVehicles, vehicleLibrary, [threePax]).join(','), '10');
check('a suggestion the operator has not accepted is not a band yet',
  packageBandSuggestions(bothVehicles, vehicleLibrary, [threePax])
    .every((pax) => packageBandForPax([threePax], pax) === null), true);
check('a suggestion already set as a band is not offered again',
  packageBandSuggestions(bothVehicles, vehicleLibrary).filter((pax) => pax === 3).length, 1);
check('accepting a party size gives it a band key, not a row id',
  typeof packageAutoBandKey(4), 'string');
check('the band key for a party size is stable, so re-adding it keeps the same services',
  packageAutoBandKey(13), packageAutoBandKey(13));
check('two different party sizes never share a band key',
  packageAutoBandKey(4) === packageAutoBandKey(7), false);
check('a band key still reads as a UUID, because it is saved as one',
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(packageAutoBandKey(4)), true);

/* Two bands at the same party size would leave that price down to whichever happened to be
   listed first, so the builder refuses it and the engine reports only one owner. */
const duplicateSizes = [
  { item_key: 'first', pax: 4 },
  { item_key: 'second', pax: 4 }
];
check('the first band listed wins the price for a party size',
  packageBandForPax(duplicateSizes, 4).item_key, 'first');
check('bands at the same party size are detected by the builder, not by luck',
  duplicateSizes.some((band) => duplicateSizes.some((other) => other !== band && packageBandPax(other) === packageBandPax(band))), true);

/* The currency chosen at creation is the one the package is sold in. Falling back to the
   first included service is what keeps a package created before that choice was possible on
   the currency it was actually priced in, instead of quietly moving it. */
check('the currency chosen at creation is what the package is priced in',
  packageCurrencyFor(mixedCurrencyDays, 'EUR'), 'EUR');
check('a chosen currency wins even before any service exists',
  packageCurrencyFor([], 'KES'), 'KES');
check('a legacy package with no stored currency keeps the currency its services are in',
  packageCurrencyFor(mixedCurrencyDays, ''), 'ZAR');
check('a legacy package with an empty stored currency falls back the same way',
  packageCurrencyFor(mixedCurrencyDays, '   '), 'ZAR');
check('a package with no currency anywhere is read as ZAR',
  packageCurrencyFor([], ''), 'ZAR');
check('a stored currency is matched without caring about case',
  packageCurrencyFor([], 'usd'), 'USD');

/* A band worked out from a party size has no stored row to borrow a key from until the
   package is saved, so its key has to be derived. It has to be stable, or the services
   attached to a band come loose on the next render, and it has to be a UUID, because that is
   what gets written to package_pax_options.item_key. */
const autoKey = packageAutoBandKey(13);
check('a derived band key is a real UUID the database will accept',
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(autoKey), true);
check('a derived band key does not change between renders', packageAutoBandKey(13), autoKey);
check('a derived band key is the same given a stored row of that party size',
  packageAutoBandKey({ item_key: 'ignored', pax: 13 }), autoKey);
check('two different party sizes get two different keys', packageAutoBandKey(22) === autoKey, false);
check('a hand-set band and a derived band of the same size still differ',
  packageAutoBandKey({ min: 1, max: 13 }) === packageBandLabel({ min: 1, max: 13 }), false);

check('a party size between two bands belongs to neither',
  packageBandForPax([threePax, tenPax], 5), null);
check('an unlisted party size inside a band does not get picked up',
  packageBandForPax([threePax, tenPax], 9), null);
/* The exact shape an operator hits when a package has six hand-set bands and the vehicles
   are still being loaded one at a time. Every partial vehicle set is incomplete, so none of
   these adds may be refused, and the bands that genuinely cannot be served must be named. */
const ladder = (id, name, cap, cost) => ({ id, name, category: 'Transfers', max_occupancy: cap, item_rates: [{ id: `${id}-r`, currency: 'ZAR', rate_basis: 'per_vehicle', unit_cost: cost }] });
const ladderLibrary = [ladder('v7', 'Up to 7', 7, 1200), ladder('v13', '13-seat', 13, 2600), ladder('v25', '25-seat', 25, 3900), ladder('v50', '50-seat', 50, 6100)];
const ladderBand = (pax) => ({ item_key: `lb${pax}`, pax, min_pax: pax, max_pax: pax, is_auto_generated: false });
const ladderBands = [3, 7, 13, 25, 30, 50].map(ladderBand);
const ladderService = (item) => ({ item_key: item.id, item_id: item.id, item_name: item.name, category: item.category, rate_id: `${item.id}-r`, rate_basis: 'per_vehicle', rate_snapshot: item.item_rates[0], unit_cost: item.item_rates[0].unit_cost, vehicle_capacity: item.max_occupancy, currency_code: 'ZAR', quantity: 1, is_included: true });

const loaded = ladderLibrary.slice(0, 3);
const partialDays = [{ day_number: 1, services: loaded.map(ladderService) }];
const partial = (item) => packageItemCapacitySetupError(item, item.item_rates[0]);
const allDays = [{ day_number: 1, services: ladderLibrary.map(ladderService) }];

check('the smallest vehicle of a ladder is not refused while the set is incomplete',
  partial(ladderLibrary[0]), '');
check('no vehicle in the ladder is refused, smallest first included',
  ladderLibrary.map(partial).join(''), '');
check('the incomplete set serves the bands it covers',
  ladderBands.filter((band) => !packageBandCapacityError(partialDays, ladderLibrary, band)).length, 4);
check('the incomplete set names exactly the bands it cannot serve',
  ladderBands.filter((band) => packageBandCapacityError(partialDays, ladderLibrary, band)).map(packageBandLabel).join(','),
  '30 pax,50 pax');
check('loading the last vehicle makes every band servable',
  ladderBands.filter((band) => packageBandCapacityError(allDays, ladderLibrary, band)).length, 0);
check('the band that could not be served says so rather than being quietly dropped',
  packageBandCapacityError(partialDays, ladderLibrary, ladderBand(50)).includes('holds 25'), true);

/* The rule the whole band model exists to keep: a vehicle is paid for in full by the exact
   number of travellers in it. A lone traveller on a 4-seat vehicle still pays the whole
   vehicle, and a party that fills it pays the same total between them. This is the fleet from
   the real package: 4/7/13/19 seats at 1323/2100/3800/5400. */
const fleet = [
  { cap: 4, cost: 1323 },
  { cap: 7, cost: 2100 },
  { cap: 13, cost: 3800 },
  { cap: 19, cost: 5400 }
];
const fleetLibrary = fleet.map(({ cap, cost }) => ({
  id: `fleet${cap}`,
  name: `${cap}-seat`,
  category: 'Transfers',
  max_occupancy: cap,
  item_rates: [{ id: `fleet${cap}-r`, currency: 'ZAR', rate_basis: 'per_vehicle', unit_cost: cost }]
}));
const fleetDays = [{
  day_number: 1,
  services: fleetLibrary.map((item) => ({
    item_key: item.id,
    item_id: item.id,
    item_name: item.name,
    category: item.category,
    rate_id: item.item_rates[0].id,
    rate_basis: 'per_vehicle',
    rate_snapshot: item.item_rates[0],
    unit_cost: item.item_rates[0].unit_cost,
    vehicle_capacity: item.max_occupancy,
    currency_code: 'ZAR',
    quantity: 1,
    is_included: true
  }))
}];
const quoteFor = (pax) => calculatePackageTravellerBreakdown({
  days: packageTierDays(fleetDays, { item_key: `f${pax}`, pax }, fleetLibrary),
  pattern: { item_key: `f${pax}`, pax },
  library: fleetLibrary
});
const vehicleCostFor = (pax) => fleet.find(({ cap }) => cap >= pax)?.cost ?? 0;

/* Every party size from a lone traveller up to the largest vehicle, not just the sizes the
   bands happen to be set at, so a gap in the ladder cannot hide a shortfall. */
const everyPax = Array.from({ length: 19 }, (unused, index) => index + 1);
check('every band size is quoted from the smallest vehicle that seats it',
  everyPax.map((pax) => quoteFor(pax).partyTotal).join(','),
  everyPax.map((pax) => vehicleCostFor(pax)).join(','));
check('a lone traveller is charged the whole vehicle, not a share of one',
  [1, 2, 3, 4].map((pax) => quoteFor(pax).partyTotal).join(','), '1323,1323,1323,1323');
check('a party of 1 pays the same total as a party that fills the vehicle',
  quoteFor(1).partyTotal === quoteFor(4).partyTotal, true);
check('the whole party total is the price, not the per-person share',
  [7, 13, 19].map((pax) => quoteFor(pax).partyTotal).join(','), '2100,3800,5400');
check('no party size anywhere in the ladder comes out cheap', everyPax.filter((pax) => (
  quoteFor(pax).partyTotal !== vehicleCostFor(pax)
)).join(','), '');
/* The share each traveller pays falls as the party grows, but they always add back up to the
   same vehicle price - which is the property a per-person price has to keep. */
check('the per-person share falls as the party fills the vehicle',
  [1, 2, 3, 4].map((pax) => Math.round(quoteFor(pax).unitPerPerson * 100) / 100).join(','),
  '1323,661.5,441,330.75');
/* A displayed share is rounded to cents, so the band total must not be rebuilt from it: a
   party of 13 would otherwise pay 3800.03 for a vehicle priced at 3800. */
check('the band total is exact even though the share shown is rounded',
  [9, 11, 13, 17].map((pax) => quoteFor(pax).partyTotal).join(','), '3800,3800,3800,5400');

const lodge = {
  id: 'lodge', name: 'Contract lodge', category: 'Accommodation', max_occupancy: 2, child_age_ranges: [],
  item_rates: [{ id: 'lodge-rate', currency: 'ZAR', rate_basis: 'per_person_sharing', price_1_adult: 810, price_2_adults: 540, child_rates_breakdown: { child: 330 } }]
};
const lodgeService = {
  item_key: 'k-lodge', item_id: 'lodge', item_name: 'Contract lodge', category: 'Accommodation',
  rate_id: 'lodge-rate', rate_basis: 'per_person_sharing', rate_snapshot: lodge.item_rates[0],
  currency_code: 'ZAR', quantity: 1, is_included: true
};

/* A single supplement is a ROOM charge: a property prices a room differently when one person
   occupies it. A package with no accommodation has no rooms, so it has no supplement, and the
   cards must leave it out rather than print a figure that looks like a charge. */
check('a vehicle-only band has no accommodation', quoteFor(3).hasAccommodation, false);
check('a vehicle-only band reports no single supplement', quoteFor(3).singleSupplement, 0);
const withStay = calculatePackageTravellerBreakdown({
  days: packageTierDays([...fleetDays, { day_number: 2, services: [lodgeService] }], { item_key: 'f3', pax: 3 }, [...fleetLibrary, lodge]),
  pattern: { item_key: 'f3', pax: 3 },
  library: [...fleetLibrary, lodge]
});
check('a band with a lodge does report accommodation', withStay.hasAccommodation, true);
check('the lodge contributes a single supplement', withStay.singleSupplement > 0, true);
check('the supplement is a room charge on top of the sharing price, not instead of it',
  withStay.singleSupplementTotal - withStay.adultSharingTotal === withStay.singleSupplement, true);

/* The vehicles on a day are alternatives the party chooses between, so a client-facing
   document must describe one vehicle rather than list the whole ladder as four inclusions. */
/* A client document names the service and stops. A capacity figure turns an itinerary into a
   specification sheet and implies the client must arrive with exactly that many people. */
check('a vehicle ladder reads as one vehicle to a reader',
  packageTransportSummary(fleetDays[0].services, fleetLibrary), 'Private vehicle sized to your party');
check('a single vehicle is named without leaking its capacity',
  packageTransportSummary([service], [transfer, accommodation]), '6-seat transfer');
check('a capacity is still available when a caller explicitly wants it',
  packageTransportSummary([service], [transfer, accommodation], { includeCapacity: true }), '6-seat transfer (up to 6 travellers)');
check('a day with no vehicle has no transport summary',
  packageTransportSummary([tourService], vehicleLibrary), '');
check('the band that uses the biggest vehicle is still served by it',
  packageServicesForTier(fleetDays[0], { item_key: 'f19', pax: 19 }, fleetLibrary)
    .map((entry) => entry.item_name).join(','), '19-seat');