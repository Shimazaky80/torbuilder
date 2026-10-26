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
  packageBandPriceColumns,
  packageBandSuggestions,
  packageCurrencyFor,
  packageChildAgeRange,
  packageItemsForTier,
  packageSeasonCoverage,
  packageMarkupPercent,
  packageExportMarkup,
  packageSeasonResolution,
  packageItemCapacitySetupError,
  packageServicesForTier,
  packageTierDays,
  packageTransportSummary,
  roomsForPax,
  packageAutoBandKey,
  vehicleTypeForPax,
  vehicleVectorPrice,
  vehicleBlockReason,
  seedBandsForSeats,
  presentationPricingColumns,
  vehicleColumnPools,
  accommodationRatesForTrip,
  accommodationPerPersonForSeason,
  singleSupplementForSeason,
  accommodationRoomCapacity
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
/* D6: two independent processes with no path from one into the other. */
check('internal (STO) is always contract cost, whatever markup is in play',
  packageExportMarkup({ audience: 'internal', hasPartner: true, assignedMarkup: 15, typedMarkup: 25 }), 0);
check('an assigned partner locks the export to their markup and ignores the typed figure',
  packageExportMarkup({ audience: 'client', hasPartner: true, assignedMarkup: 15, typedMarkup: 25 }), 15);
check('a zero-markup partner is still a partner, so nothing typed can be used instead',
  packageExportMarkup({ audience: 'client', hasPartner: true, assignedMarkup: 0, typedMarkup: 20 }), 0);
check('an unassigned package takes the markup typed into the modal',
  packageExportMarkup({ audience: 'client', hasPartner: false, assignedMarkup: 0, typedMarkup: 25 }), 25);
check('the typed markup arrives as text from the input',
  packageExportMarkup({ audience: 'client', hasPartner: false, typedMarkup: '12.5' }), 12.5);
check('a blank markup is not a markup',
  packageExportMarkup({ audience: 'client', hasPartner: false, typedMarkup: '' }), 0);
check('a negative typed markup never cuts a price',
  packageExportMarkup({ audience: 'client', hasPartner: false, typedMarkup: -10 }), 0);
/* The three-audience selector: partner (the assigned partner's markup), markup (the typed
   figure for a non-partner) and internal (contract cost). 'client' stays as the legacy alias. */
check('the partner audience uses the assigned partner markup',
  packageExportMarkup({ audience: 'partner', hasPartner: true, assignedMarkup: 15 }), 15);
check('the partner audience never falls through to the typed figure',
  packageExportMarkup({ audience: 'partner', hasPartner: true, assignedMarkup: 15, typedMarkup: 40 }), 15);
check('the partner audience with no partner assigned has no markup to apply',
  packageExportMarkup({ audience: 'partner', hasPartner: false, assignedMarkup: 15 }), 0);
check('the markup audience uses the typed figure',
  packageExportMarkup({ audience: 'markup', hasPartner: false, typedMarkup: 25 }), 25);
check('the markup audience ignores any assigned partner markup',
  packageExportMarkup({ audience: 'markup', hasPartner: true, assignedMarkup: 15, typedMarkup: 25 }), 25);
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

/* A property whose child band is published as R0.00 states plainly that the child is
   allowed and stays free. The published figure wins - unlike a property that
   publishes NO child rate, which falls through to its single supplement (the flat and
   stated-supplement lodges above). */
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
check('a published R0.00 child rate is a free child, not a missing price', zeroBand.accommodationRows[0].childAccommodation, 0);
check('a free child is named as a property child rate', zeroBand.accommodationRows[0].childBasis, 'Property child rate');
check('a free child is not reported as refusing the child', zeroBand.childNotAllowed.length, 0);
check('a free child prices at the unit share alone', zeroBand.childTotal, 0);
check('childSupplement reports nothing is charged for the free child', zeroBand.childSupplement, 0);

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
check('a saved band of one traveller keeps its size: the grid minimum never rewrites it',
  packageBandPax({ item_key: 'band-1', pax: 1, min_pax: 1, max_pax: 1 }), 1);
check('a saved band of one traveller is labelled as one traveller',
  packageBandLabel({ item_key: 'band-1', pax: 1 }), '1 pax');
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
check('a party of one is servable by any vehicle that seats one',
  packageBandCapacityError(bothVehicles, vehicleLibrary, { item_key: 'band-1', pax: 1 }), '');

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

/* A room the allocation leaves with one occupant is billed single occupancy, so an odd
   party pays the supplement for it. The sharing rate itself is untouched - the supplement
   is a party charge that lands in the party total, which is where a missing supplement
   used to under-quote three travellers in rooms that sleep two. */
const lodgeQuote = (pax) => calculatePackageTravellerBreakdown({
  days: [{ services: [lodgeService] }],
  pattern: { pax },
  library: [lodge]
});
check('a room left single is counted as a single room', lodgeQuote(3).accommodationRows[0].singleRooms, 1);
check('an odd party pays the supplement for the room it cannot share', lodgeQuote(3).forcedSingleSupplement, 270);
check('the forced supplement lands in the party total, not the sharing rate',
  [lodgeQuote(3).accommodationSharing, lodgeQuote(3).partyTotal].join(','), '540,1890');
check('an even party fills every room and owes no supplement',
  [lodgeQuote(4).forcedSingleSupplement, lodgeQuote(4).partyTotal].join(','), '0,2160');
check('the own-room card is still the sharing price plus the supplement',
  lodgeQuote(3).singleSupplementTotal, 810);

/* The vehicles on a day are alternatives the party chooses between, so a client-facing
   document must describe one vehicle rather than list the whole ladder as four inclusions. */
/* A client document names the service and stops. A capacity figure turns an itinerary into a
   specification sheet and implies the client must arrive with exactly that many people. */
check('a vehicle ladder reads as one vehicle to a reader',
  packageTransportSummary(fleetDays[0].services, fleetLibrary), 'Private vehicle sized to your party');
/* One real line item, so the summary names that vehicle and nothing else. `service` was never
   defined here - the reference threw before these checks could run and took every test below
   it with it, which is how a passing count kept appearing while half the file was untested. */
const transferService = packageDays[0].services[0];
check('a single vehicle is named without leaking its capacity',
  packageTransportSummary([transferService], [transfer, accommodation]), '6-seat transfer');
check('a capacity is still available when a caller explicitly wants it',
  packageTransportSummary([transferService], [transfer, accommodation], { includeCapacity: true }),
  '6-seat transfer (up to 4 travellers)');
check('a day with no vehicle has no transport summary',
  packageTransportSummary([tourService], vehicleLibrary), '');

/* The price boxes are one column per party size. They have to come back in party order with
   the same figures the detailed table shows, and each column carries whether the package
   sleeps anyone, because that is what decides whether the supplement and child boxes are
   printed at all - a vehicle-only package earns one box, not three with zeros in two of them. */
const bandMatrix = [
  { item_key: 'b7', pax: 7, pricing: quoteFor(7) },
  { item_key: 'b3', pax: 3, pricing: quoteFor(3) },
  { item_key: 'b19', pax: 19, pricing: quoteFor(19) }
];
const boxColumns = packageBandPriceColumns(bandMatrix);
check('price boxes read left to right in party size order', boxColumns.map((column) => column.pax).join(','), '3,7,19');
check('a price box column carries that party size per person figure', boxColumns[0].perPerson, quoteFor(3).adultSharingTotal);
check('a price box column knows whether the package sleeps anyone', boxColumns[0].hasAccommodation, false);

const markedUpBand = [{ item_key: 'b3', pax: 3, pricing: calculatePackageTravellerBreakdown({
  days: packageTierDays(fleetDays, { item_key: 'b3', pax: 3 }, fleetLibrary),
  pattern: { item_key: 'b3', pax: 3 },
  library: fleetLibrary,
  markupPercent: 20
}) }];
check('the contract view of a band stays at contract price',
  packageBandPriceColumns(markedUpBand)[0].perPerson, applyPackageMarkup(quoteFor(3).adultSharingTotal, 0));
/* Markup is applied to the totals, never to the lines underneath them, so the box has to show
   the marked-up figure rather than the contract one it was aggregated from. */
check('a marked-up view marks up the box figure',
  packageBandPriceColumns(markedUpBand, { partnerView: true })[0].perPerson,
  applyPackageMarkup(quoteFor(3).adultSharingTotal, 20));
check('the band that uses the biggest vehicle is still served by it',
  packageServicesForTier(fleetDays[0], { item_key: 'f19', pax: 19 }, fleetLibrary)
    .map((entry) => entry.item_name).join(','), '19-seat');

/* ── Step 3: the pricing engine reads the rate's price vector ───────────────────
   A per_vehicle rate now carries prices_by_vehicle, one number per vehicle type from
   Settings. The quote resolves the smallest type that seats the party and reads that
   column; a party size with no column blocks (D11/D12). Without a vector, or without
   the vehicle list, the legacy single-price figures carry the line as before. */
const typesForVectorTest = [
  { code: 'saloon', name: 'Saloon', max_capacity: 3 },
  { code: 'combi', name: 'Combi', max_capacity: 6 },
  { code: 'quantum_10', name: 'Quantum (10)', max_capacity: 10 },
  { code: 'sprinter_16', name: 'Sprinter (16)', max_capacity: 16 },
  { code: 'bus_39', name: 'Bus (39)', max_capacity: 39 }
];

check('the resolved vehicle is the smallest type that seats the party',
  [1, 3, 4, 6, 7, 10, 11, 39, 40].map((pax) => vehicleTypeForPax(typesForVectorTest, pax)?.code ?? 'none').join(','),
  'saloon,saloon,combi,combi,quantum_10,quantum_10,sprinter_16,bus_39,none');
check('a party bigger than every configured vehicle has no vehicle',
  vehicleTypeForPax(typesForVectorTest, 41), null);
check('a vector cell reads a real number as its price',
  vehicleVectorPrice({ saloon: 750 }, 'saloon'), 750);
check('a vector cell priced literally at zero is still a price',
  vehicleVectorPrice({ saloon: 0 }, 'saloon'), 0);
check('a free or n/a vector cell charges zero, not blocks',
  [vehicleVectorPrice({ saloon: { free: true } }, 'saloon'),
   vehicleVectorPrice({ saloon: { na: true } }, 'saloon')].join(','), '0,0');
check('an unpriced vector cell is not zero - it is blocked',
  vehicleVectorPrice({ combi: 900 }, 'saloon'), null);
check('a missing vector or code is blocked',
  [vehicleVectorPrice({}, 'saloon'), vehicleVectorPrice(null, 'saloon'), vehicleVectorPrice({ saloon: 100 }, 'combi')]
    .map((value) => (value === null ? 'blocked' : String(value))).join(','), 'blocked,blocked,blocked');

const vectorTransfer = {
  id: 'vector-transfer',
  name: 'Park transfer',
  category: 'Transfers',
  max_occupancy: 3,
  item_rates: [{
    id: 'vector-transfer-rate', currency: 'ZAR', rate_basis: 'per_vehicle',
    unit_cost: 900,
    prices_by_vehicle: { saloon: 1500, combi: 2100, quantum_10: 2800 }
  }]
};
const vectorService = {
  item_id: 'vector-transfer', rate_id: 'vector-transfer-rate', item_name: 'Park transfer',
  category: 'Transfers', currency_code: 'ZAR', rate_basis: 'per_vehicle',
  unit_cost: 900, quantity: 1, is_included: true
};
const quoteVector = (pax, vehicleTypes = typesForVectorTest) => calculatePackageTravellerBreakdown({
  days: [{ services: [vectorService] }],
  pattern: { pax },
  library: [vectorTransfer],
  vehicleTypes
});

check('a 2-pax party takes the saloon column and is charged it in full',
  quoteVector(2).partyTotal, 1500);
check('a 6-pax party takes the combi column', quoteVector(6).partyTotal, 2100);
check('a 7-pax party takes the quantum column', quoteVector(7).partyTotal, 2800);
check('a 4-pax party takes the smallest vehicle that seats them (combi)',
  quoteVector(4).partyTotal, 2100);
check('the vector price replaces the legacy single price, not adds to it',
  [quoteVector(2).unitPerPerson, quoteVector(2).unitTotal].join(','), '750,1500');
check('the vector is used per traveller, so the party total recovers the column',
  quoteVector(6).unitTotal, quoteVector(6).partyTotal);
check('a vector free cell prices the line at zero and stays servable',
  calculatePackageTravellerBreakdown({
    days: [{ services: [{
      ...vectorService,
      rate_id: 'vector-transfer-free-rate'
    }] }],
    pattern: { pax: 2 },
    library: [{
      ...vectorTransfer,
      item_rates: [{ ...vectorTransfer.item_rates[0], id: 'vector-transfer-free-rate', prices_by_vehicle: { saloon: { free: true } } }]
    }],
    vehicleTypes: typesForVectorTest
  }).servable, true);

check('a party size with no column for the resolved vehicle is blocked',
  [quoteVector(11).servable, quoteVector(11).blockedVehicleReasons.length].join(','), 'false,1');
check('the block reason names the resolved vehicle and the missing price',
  quoteVector(11).blockedVehicleReasons[0].includes('Sprinter (16)') && quoteVector(11).blockedVehicleReasons[0].includes('11'), true);
check('a party bigger than every configured vehicle is blocked with the sizing reason',
  quoteVector(41).blockedVehicleReasons[0].includes('41'), true);
check('the blocked vehicle row is kept with a zero, not dropped',
  quoteVector(11).unitRows.filter((row) => row.blocked).length, 1);
check('a price is never invented for a blocked party size',
  quoteVector(11).unitPerPerson, 0);

/* Without the vehicle list the engine cannot resolve a column, so it keeps today's
   behaviour: single-price fallback, never a block. */
check('without vehicle types the legacy single price still applies',
  quoteVector(2, []).partyTotal, 900);
check('without vehicle types nothing is falsely blocked',
  quoteVector(11, []).servable, true);

check('vehicleBlockReason names the service and the traveller count',
  String(vehicleBlockReason(vectorService, vectorTransfer, 11, typesForVectorTest)).includes('Park transfer'), true);

/* ── Step 4: locked snapshots (D18) ─────────────────────────────────────────
   A line prices from the rate_snapshot captured when it was added or last refreshed.
   A supplier change in the library does NOT move a saved package: only an explicit
   "Update from library" copies the current rate over the snapshot. A line with no
   snapshot (legacy) keeps living on the current library rate. */
const lockedTransfer = {
  id: 'locked-transfer',
  name: 'Lodge shuttle',
  category: 'Transfers',
  max_occupancy: 3,
  item_rates: [{
    id: 'locked-transfer-rate', currency: 'ZAR', rate_basis: 'per_person', price_1_adult: 800, unit_cost: 800
  }]
};
const lockedService = (snapshot) => ({
  item_id: 'locked-transfer', rate_id: 'locked-transfer-rate', item_name: 'Lodge shuttle',
  category: 'Transfers', currency_code: 'ZAR', rate_basis: 'per_person',
  unit_cost: Number(snapshot?.unit_cost) || 0, quantity: 1, is_included: true,
  rate_snapshot: snapshot || {}
});
const quoteLocked = (snapshot, library = [lockedTransfer]) => calculatePackageTravellerBreakdown({
  days: [{ services: [lockedService(snapshot)] }],
  pattern: { pax: 2 },
  library
});

/* The library row has since moved to 800 while the line was locked at 1500: the package
   keeps quoting 1500 until the operator explicitly refreshes from the library. */
const movedRate = [{ ...lockedTransfer, item_rates: [{
  id: 'locked-transfer-rate', currency: 'ZAR', rate_basis: 'per_person', price_1_adult: 800, unit_cost: 800
}] }];
check('a locked snapshot holds its price even after the library rate moves',
  quoteLocked({ id: 'locked-transfer-rate', price_1_adult: 1500, unit_cost: 1500, rate_basis: 'per_person' }, movedRate).unitPerPerson, 1500);
check('a legacy line with no snapshot prices from the current library rate',
  quoteLocked(null, movedRate).unitPerPerson, 800);

/* A locked snapshot also locks the vehicle price vector: the supplier moved the saloon from
   1500 to 2000 on the library, but this line still quotes its captured 1500 - and a cell
   that was missing when the line was locked stays missing until refreshed. */
const movingVectorLibrary = [{
  ...lockedTransfer,
  item_rates: [{
    id: 'locked-transfer-rate', currency: 'ZAR', rate_basis: 'per_vehicle',
    unit_cost: 900, prices_by_vehicle: { saloon: 2000, combi: 2400 }
  }]
}];
const quoteLockedVector = (snapshot) => calculatePackageTravellerBreakdown({
  days: [{ services: [{
    ...lockedService(snapshot),
    rate_basis: 'per_vehicle',
    unit_cost: 2000
  }] }],
  pattern: { pax: 2 },
  library: movingVectorLibrary,
  vehicleTypes: typesForVectorTest
});
check('a locked snapshot keeps its own price vector after the library vector moves',
  quoteLockedVector({ id: 'locked-transfer-rate', rate_basis: 'per_vehicle', prices_by_vehicle: { saloon: 1500, combi: 2100 } }).partyTotal, 1500);
check('a snapshot whose resolved cell is missing blocks, even though the live library prices it',
  quoteLockedVector({ id: 'locked-transfer-rate', rate_basis: 'per_vehicle', prices_by_vehicle: { combi: 2100 } }).servable, false);
check('a snapshot with an unpriced cell hides a newly-priced live library row',
  quoteLockedVector({ id: 'locked-transfer-rate', rate_basis: 'per_vehicle', prices_by_vehicle: { combi: 2100 } }).blockedVehicleReasons[0].includes('no price'), true);

/* ── Step 6: Pricing and Seasons tab helpers ─────────────────────────────────────
   Three pure helpers feed the tab: the band sizes a vehicle column starts at (D20),
   the annual per-column price pool (D14 - the grid and overlay card read it), and the
   per-accommodation season resolution with the straddle rule (D15/D16). */
check('a six-seat column seeds two, four and six pax bands',
  seedBandsForSeats(6).join(','), '2,4,6');
check('a three-seat column seeds just two bands', seedBandsForSeats(3).join(','), '2,3');
check('a two-seat column seeds a single band', seedBandsForSeats(2).join(','), '2');
check('a ten-seat column seeds rounded thirds of ten', seedBandsForSeats(10).join(','), '3,6,10');
check('a sixteen-seat column seeds five-ten-sixteen', seedBandsForSeats(16).join(','), '5,10,16');
check('a thirty-nine-seat column seeds thirteen-twenty-six-thirty-nine',
  seedBandsForSeats(39).join(','), '13,26,39');
check('bigger bands never exceed the seats', seedBandsForSeats(8).every((pax) => pax <= 8), true);
check('band pax are positive', seedBandsForSeats(4).every((pax) => pax >= 1), true);
check('a band is never smaller than two travellers, so the vehicle keeps its margin',
  seedBandsForSeats(8).every((pax) => pax >= 2), true);
check('a five-seat column seeds two, four and five, never a party of one',
  seedBandsForSeats(5).join(','), '2,4,5');
check('a one-seat column still seeds a single band of one: the guard never invents a party of two',
  seedBandsForSeats(1).join(','), '1');

const poolTransfer = {
  id: 'pool-transfer', name: 'Park transfer', category: 'Transfers', max_occupancy: 3,
  item_rates: [{
    id: 'pool-transfer-rate', currency: 'ZAR', rate_basis: 'per_vehicle', unit_cost: 900,
    prices_by_vehicle: { saloon: 1500, combi: 2100 }
  }]
};
const poolLunch = {
  id: 'pool-lunch', name: 'Lunch', category: 'Meals',
  item_rates: [{ id: 'pool-lunch-rate', currency: 'ZAR', rate_basis: 'per_person', price_1_adult: 300 }]
};
const poolFees = {
  id: 'pool-fees', name: 'Park fees', category: 'Entry Fees',
  item_rates: [{ id: 'pool-fees-rate', currency: 'ZAR', rate_basis: 'flat', unit_price: 500 }]
};
const poolShop = {
  id: 'pool-shop', name: 'Shopping stop', category: 'Transfers', max_occupancy: 4,
  item_rates: [{ id: 'pool-shop-rate', currency: 'ZAR', rate_basis: 'per_vehicle', unit_cost: 900 }]
};
const poolDays = [{ services: [
  { item_id: 'pool-transfer', rate_id: 'pool-transfer-rate', item_name: 'Park transfer', currency_code: 'ZAR', rate_basis: 'per_vehicle', unit_cost: 900, quantity: 1, is_included: true },
  { item_id: 'pool-lunch', rate_id: 'pool-lunch-rate', item_name: 'Lunch', currency_code: 'ZAR', rate_basis: 'per_person', unit_cost: 300, quantity: 1, is_included: true },
  { item_id: 'pool-fees', rate_id: 'pool-fees-rate', item_name: 'Park fees', currency_code: 'ZAR', rate_basis: 'flat', unit_price: 500, quantity: 1, is_included: true },
  { item_id: 'pool-shop', rate_id: 'pool-shop-rate', item_name: 'Shopping stop', currency_code: 'ZAR', rate_basis: 'per_vehicle', unit_cost: 900, quantity: 1, is_included: true },
  { item_id: 'hotel', rate_id: 'hotel-rate', item_name: 'Contract hotel', category: 'Accommodation', currency_code: 'ZAR', rate_basis: 'per_person_sharing', unit_cost: 810, quantity: 1, is_included: true }
] }];
const pools = vehicleColumnPools({
  days: poolDays,
  library: [poolTransfer, poolLunch, poolFees, poolShop, accommodation],
  vehicleTypes: typesForVectorTest
});
check('each vehicle column pools its own vector price plus shared flat and legacy lines',
  [pools.pools.saloon, pools.pools.combi].join(','), '2900,3500');
check('per-person lines stay out of the pool as a single fixed figure',
  [pools.pools.saloon, pools.perPersonFixed].join(','), '2900,300');
check('flat and legacy per-vehicle lines are the shared pool base', pools.flatTotal, 1400);
check('accommodation is never part of the vehicle pool', pools.perPersonFixed, 300);
check('the pool read uses the package currency', pools.currency, 'ZAR');

const seasonalLodge = {
  ...accommodation, id: 'seasonal-lodge', name: 'Seasons lodge',
  item_rates: [
    { id: 'low-rate', currency: 'ZAR', rate_basis: 'per_person_sharing', price_1_adult: 700, price_2_adults: 450, valid_from: '2026-03-16', valid_to: '2026-11-30' },
    { id: 'high-rate', currency: 'ZAR', rate_basis: 'per_person_sharing', price_1_adult: 900, price_2_adults: 600, valid_from: '2026-01-01', valid_to: '2026-03-15' },
    { id: 'xmas-rate', currency: 'ZAR', rate_basis: 'per_person_sharing', price_1_adult: 1200, price_2_adults: 900, valid_from: '2026-12-01', valid_to: '2026-12-31' }
  ]
};
const seasonalService = {
  item_id: 'seasonal-lodge', rate_id: 'low-rate', item_name: 'Seasons lodge',
  category: 'Accommodation', currency_code: 'ZAR', rate_basis: 'per_person_sharing',
  unit_cost: 700, quantity: 1, is_included: true
};
check('a trip inside one season resolves to that season',
  accommodationRatesForTrip(seasonalService, seasonalLodge, '2026-06-01', '2026-06-05').chosen.id, 'low-rate');
check('a trip in another season resolves to that season',
  accommodationRatesForTrip(seasonalService, seasonalLodge, '2026-02-01', '2026-02-05').chosen.id, 'high-rate');
check('a trip inside a third season resolves to that season',
  accommodationRatesForTrip(seasonalService, seasonalLodge, '2026-12-20', '2026-12-25').chosen.id, 'xmas-rate');
check('a straddling trip overlaps both seasons', accommodationRatesForTrip(
  seasonalService, seasonalLodge, '2026-03-10', '2026-03-20').overlapping.length, 2);
check('a straddling trip is charged the higher rate for all nights',
  accommodationRatesForTrip(seasonalService, seasonalLodge, '2026-03-10', '2026-03-20').chosen.sharing, 600);
check('a rate with no windows covers every date',
  accommodationRatesForTrip(seasonalService, {
    ...seasonalLodge,
    item_rates: [...seasonalLodge.item_rates, { id: 'perpetual-rate', currency: 'ZAR', rate_basis: 'per_person_sharing', price_1_adult: 400, price_2_adults: 250 }]
  }, '2026-06-01', '2026-06-05').overlapping.some((rate) => rate.id === 'perpetual-rate'), true);
check('the resolved sharing price comes from the chosen contract window',
  accommodationRatesForTrip(seasonalService, seasonalLodge, '2026-12-20', '2026-12-25').chosen.sharing, 900);
check('a trip with no matching season has no resolution at all',
  accommodationRatesForTrip(seasonalService, seasonalLodge, '2027-01-10', '2027-01-15').chosen, null);

/* The Pricing & seasons tab derives the season's accommodation figure off the itinerary's
   own accommodation lines resolved against the SEASON's dates, so adding an accommodation
   is never a silent no-op (B1): the per-person sharing rate is distributed across every
   column. The stored override, when set, is the caller's to prefer; this helper only
   reads the accommodation lines. */
const seasonLodgeDays = [{ services: [seasonalService] }];
check('a season inside a contract window picks the accommodation up as its per-person figure',
  accommodationPerPersonForSeason({ days: seasonLodgeDays, library: [seasonalLodge], from: '2026-02-01', to: '2026-02-28' }).total, 600);
check('a season inside another window derives that window',
  accommodationPerPersonForSeason({ days: seasonLodgeDays, library: [seasonalLodge], from: '2026-06-01', to: '2026-06-30' }).total, 450);
check('the derived figure names the accommodation line it came from',
  accommodationPerPersonForSeason({ days: seasonLodgeDays, library: [seasonalLodge], from: '2026-02-01', to: '2026-02-28' }).rows[0].name, 'Seasons lodge');
const twoLodgeDays = [{ services: [
  { ...seasonalService },
  { ...seasonalService, item_name: 'Seasons lodge 2' }
] }];
check('two lodges in one season sum to a single per-person figure',
  accommodationPerPersonForSeason({ days: twoLodgeDays, library: [seasonalLodge], from: '2026-06-01', to: '2026-06-30' }).total, 900);
check('a season with no covering window cannot be derived',
  accommodationPerPersonForSeason({ days: seasonLodgeDays, library: [seasonalLodge], from: '2027-01-10', to: '2027-01-15' }).total, null);
check('an unresolvable accommodation is named so the operator can see why',
  accommodationPerPersonForSeason({ days: seasonLodgeDays, library: [seasonalLodge], from: '2027-01-10', to: '2027-01-15' }).unresolved.join(','), 'Seasons lodge');
check('a package with no accommodation derives no figure',
  accommodationPerPersonForSeason({ days: [{ services: [poolDays[0].services[0]] }], library: [poolTransfer], from: '2026-06-01', to: '2026-06-30' }).total, null);
/* A saved package line carries the rate it was added with as a locked snapshot. The
   per-season preview must price the contract window it resolves, NOT that snapshot: a
   line added before the supplier's prices were loaded would otherwise quote its stale
   (0.00) snapshot for every season and the accommodation would read as nothing. */
const snapshotSeasonService = {
  ...seasonalService,
  rate_id: 'high-rate',
  rate_snapshot: { id: 'high-rate', rate_basis: 'per_person_sharing', price_1_adult: 900, price_2_adults: 600 }
};
const snapshotSeasonDays = [{ services: [snapshotSeasonService] }];
check('a locked line still resolves each contract window on its own terms',
  accommodationRatesForTrip(snapshotSeasonService, seasonalLodge, '2026-06-01', '2026-06-05').chosen.sharing, 450);
check('the per-season figure ignores a stale locked snapshot',
  accommodationPerPersonForSeason({ days: snapshotSeasonDays, library: [seasonalLodge], from: '2026-06-01', to: '2026-06-30' }).total, 450);
check('a pre-load snapshot that priced the line at zero no longer blanks the figure',
  singleSupplementForSeason({ days: [{ services: [{ ...snapshotSeasonService, rate_snapshot: { id: 'high-rate', rate_basis: 'per_person_sharing', price_2_adults: 0 } }] }], library: [seasonalLodge], from: '2026-06-01', to: '2026-06-30' }).derived, true);
check('a package with no accommodation names nothing', accommodationPerPersonForSeason({
  days: [{ services: [poolDays[0].services[0]] }], library: [poolTransfer],
  from: '2026-06-01', to: '2026-06-30'
}).rows.length, 0);
const guideOnlySeasonDays = [{ services: [
  { ...seasonalService, guide_only: true }
] }];
check('a guide & driver only overnight does not count as the day client accommodation',
  accommodationPerPersonForSeason({ days: guideOnlySeasonDays, library: [seasonalLodge], from: '2026-06-01', to: '2026-06-30' }).total, null);
check('the guide & driver only overnight is not named as an accommodation',
  accommodationPerPersonForSeason({ days: guideOnlySeasonDays, library: [seasonalLodge], from: '2026-06-01', to: '2026-06-30' }).rows.length, 0);
const guideWithClientDays = [{ services: [
  { ...seasonalService },
  { ...seasonalService, item_name: 'Guide & driver room', guide_only: true }
] }];
check('a guide & driver only overnight never doubles the per-person accommodation figure',
  accommodationPerPersonForSeason({ days: guideWithClientDays, library: [seasonalLodge], from: '2026-06-01', to: '2026-06-30' }).total, 450);

/* The Presentation pricing matrix: one column per PARTY SIZE, not one per vehicle. A vehicle
   column carries a ladder (4/8/12 pax on the same vehicle); the tab stacks those in one cell,
   but a client document must give each party size its own column so its price sits under its
   own "N pax" heading. These checks pin that flattening. */
const ladderColumns = presentationPricingColumns({
  codes: ['saloon'],
  bands: { saloon: [4, 8, 12] },
  pools: { saloon: 9000 },
  perPersonFixed: 300,
  accommodation: 200
});
check('the ladder is spread into one column per party size, not stacked', ladderColumns.length, 3);
check('the columns carry the party sizes in order', ladderColumns.map((column) => column.pax).join(','), '4,8,12');
check('every column still belongs to the vehicle it priced on', ladderColumns.every((column) => column.code === 'saloon'), true);
check('each column price is the vehicle pool split by its own party size',
  ladderColumns.map((column) => column.each).join(','), '2750,1625,1250');

const twoVehicleColumns = presentationPricingColumns({
  codes: ['saloon', 'combi'],
  bands: { saloon: [4, 8], combi: [12] },
  pools: { saloon: 4000, combi: 6000 },
  perPersonFixed: 0,
  accommodation: 0
});
check('columns follow the vehicle order, then each vehicle ladder',
  twoVehicleColumns.map((column) => `${column.code}:${column.pax}`).join(','), 'saloon:4,saloon:8,combi:12');

check('a vehicle with no bands contributes no column',
  presentationPricingColumns({ codes: ['saloon'], bands: { saloon: [] }, pools: { saloon: 9000 } }).length, 0);
check('no vehicle columns means no presentation columns',
  presentationPricingColumns({ codes: [], bands: {}, pools: {} }).length, 0);

/* A party whose size leaves a room with a single occupant carries the supplement for that
   room, spread over the party, on every column. It is why a 3 pax column is dearer than a
   third of a 2 pax column times three, and why the price a client reads already accounts
   for the room the party cannot fill. */
const forcedPresentation = presentationPricingColumns({
  codes: ['suv'],
  bands: { suv: [2, 3, 4] },
  pools: { suv: 4000 },
  perPersonFixed: 0,
  accommodation: 540,
  singleSupplement: 270,
  roomCapacity: 2
});
check('an odd party column carries its share of the single supplement it cannot avoid',
  forcedPresentation.map((column) => Math.round(column.each * 100) / 100).join(','), '2540,1963.33,1540');
check('an even party column fills every room and carries no supplement',
  forcedPresentation.map((column) => column.pax).join(','), '2,3,4');

const noRoomPlanColumns = presentationPricingColumns({
  codes: ['suv'], bands: { suv: [3] }, pools: { suv: 0 }, accommodation: 540
});
check('with no supplement there is nothing to spread, so the column is unchanged',
  noRoomPlanColumns[0].each, 540);

check('room capacity is read from the package accommodation',
  accommodationRoomCapacity({ days: [{ services: [lodgeService] }], library: [lodge] }), 2);
check('a smaller room type sets the capacity a party is allocated across',
  accommodationRoomCapacity({
    days: [{ services: [{ ...lodgeService, item_id: 'single-room' }] }],
    library: [{ id: 'single-room', category: 'Accommodation', max_occupancy: 1 }]
  }), 1);
check('no accommodation defaults the room capacity to a double',
  accommodationRoomCapacity({ days: [{ services: [] }], library: [] }), 2);

/* A supplement is a room charge, so the season's supplement is derived the same way the
   per-person figure is: from the covered contract window. This is what lets the Presentation
   summary always show a supplement rather than a zero that reads as "no charge". */
const seasonalSupplementLodge = {
  ...accommodation, id: 'seasonal-supp-lodge', name: 'Supplement lodge',
  item_rates: [
    { id: 'supp-low', currency: 'ZAR', rate_basis: 'per_person_sharing', price_1_adult: 700, price_2_adults: 450, single_supplement: 250, valid_from: '2026-03-16', valid_to: '2026-11-30' },
    { id: 'supp-high', currency: 'ZAR', rate_basis: 'per_person_sharing', price_1_adult: 900, price_2_adults: 600, single_supplement: 380, valid_from: '2026-01-01', valid_to: '2026-03-15' }
  ]
};
const seasonalSupplementService = {
  item_id: 'seasonal-supp-lodge', rate_id: 'supp-low', item_name: 'Supplement lodge',
  category: 'Accommodation', currency_code: 'ZAR', rate_basis: 'per_person_sharing',
  unit_cost: 700, quantity: 1, is_included: true
};
const supplementDays = [{ services: [seasonalSupplementService] }];
check('a resolved rate row carries its own single supplement',
  accommodationRatesForTrip(seasonalSupplementService, seasonalSupplementLodge, '2026-06-01', '2026-06-05').chosen.supplement, 250);
check('a season inside a contract window derives that window\'s single supplement',
  singleSupplementForSeason({ days: supplementDays, library: [seasonalSupplementLodge], from: '2026-02-01', to: '2026-02-28' }).total, 380);
check('the derived supplement names the accommodation line it came from',
  singleSupplementForSeason({ days: supplementDays, library: [seasonalSupplementLodge], from: '2026-06-01', to: '2026-06-30' }).rows[0].name, 'Supplement lodge');
check('two lodges in one season sum to a single supplement',
  singleSupplementForSeason({
    days: [{ services: [seasonalSupplementService, { ...seasonalSupplementService, item_name: 'Supplement lodge 2' }] }],
    library: [seasonalSupplementLodge], from: '2026-06-01', to: '2026-06-30'
  }).total, 500);
check('a season with no covering window cannot derive a single supplement',
  singleSupplementForSeason({ days: supplementDays, library: [seasonalSupplementLodge], from: '2027-01-10', to: '2027-01-15' }).total, null);
check('an unresolvable accommodation is named so the operator can see why',
  singleSupplementForSeason({ days: supplementDays, library: [seasonalSupplementLodge], from: '2027-01-10', to: '2027-01-15' }).unresolved.join(','), 'Supplement lodge');
check('a package with no accommodation derives no supplement, so the caller keeps its override',
  singleSupplementForSeason({ days: [{ services: [poolDays[0].services[0]] }], library: [poolTransfer], from: '2026-06-01', to: '2026-06-30' }).total, null);