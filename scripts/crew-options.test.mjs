import {
  driverMealRate,
  flightOffersGuideTicket,
  guideFlightRate,
  guideMealChoices,
  guideMealRate,
  crewMealLines,
  mealAcceptsDriver,
  mealAcceptsGuide,
  crewChargeOf,
  crewShareOn,
  crewSharePerPerson,
  crewShareDivisor,
  refreshCrewShare
} from '../src/lib/guidePricing';
import { libraryItemDetail } from '../src/lib/libraryItemDetail';
import {
  LIBRARY_ITEM_LIGHT_FIELDS,
  LIBRARY_ITEM_PACKAGE_FIELDS,
  LIBRARY_ITEM_PACKAGE_FIELDS_FALLBACK
} from '../src/lib/libraryItemFields';
import { repriceServicesForPax, revalidateServicesForWindow } from '../src/lib/servicePricing';
import { buildItineraryPackage } from '../src/lib/itineraryToPackage';
import { calculatePackageTravellerBreakdown, vehicleColumnPools } from '../src/lib/packagePricing';
import { voucherDetailLines } from '../src/lib/voucherDetails';

const check = (label, actual, expected) => {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  if (!passed) process.exitCode = 1;
};

const rowsOf = (card, key) => {
  const section = card.sections.find((entry) => entry.key === key);
  return section ? section.rows.map((row) => [row.label, row.value]) : [];
};
const money = (value) => `ZAR ${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* The crew flags the supplier states on the item. Only a literal true counts: a
   library row saved before the migration carries null, and a string coming back
   from a form must not silently put a meal on the manifest. */
check('a flagged meal feeds the guide', mealAcceptsGuide({ guide_meal_offered: true }), true);
check('an unflagged meal does not', mealAcceptsGuide({ guide_meal_offered: null }), false);
check('a text "true" is not a flag', mealAcceptsDriver({ driver_meal_offered: 'true' }), false);
check('a flight only offers the guide a seat when flagged', flightOffersGuideTicket({ guide_flight_offered: true }), true);

/* -- The meal picker the guide dialog shows ---------------------------------
   Nothing tagged anywhere keeps the whole Meals module selectable; the moment
   the operator tags one meal, the picker is restricted to the tagged ones. */
const buffet = { id: 'm1', name: 'Buffet lunch', guide_meal_offered: true };
const picnic = { id: 'm2', name: 'Picnic', guide_meal_offered: false };
const tagged = guideMealChoices([buffet, picnic]);
check('tagged meals restrict the picker', [tagged.restricted, tagged.meals.map((m) => m.id)], [true, ['m1']]);
const untagged = guideMealChoices([picnic]);
check('an untagged library falls back to every meal', [untagged.restricted, untagged.meals.map((m) => m.id)], [false, ['m2']]);
check('no meals at all is an empty picker, not undefined', guideMealChoices(undefined), { meals: [], restricted: false });

/* -- Crew rates -------------------------------------------------------------
   A crew member who eats the clients' fare has no separate figure, so the adult
   price stands rather than a zero. */
check('a typed guide meal rate wins', guideMealRate({ guide_rate: 400, price_1_adult: 500 }), 400);
check('a guide meal falls back to the adult fare', guideMealRate({ price_1_adult: 500 }), 500);
check('a typed driver meal rate wins', driverMealRate({ driver_rate: 450, price_1_adult: 500 }), 450);
check('a driver meal falls back to the adult fare', driverMealRate({ unit_price: 600 }), 600);
check('no crew meal is charged when the guide is not needed', driverMealRate({ driver_rate: 450 }, false), 0);

/* -- The guide's seat on a flight -------------------------------------------
   A charter prices the whole aircraft, so only a typed crew fare can price one
   seat on it; a per-person flight charges the guide the clients' fare. */
check('a typed crew fare prices the guide seat', guideFlightRate({ guide_rate: 900, price_1_adult: 1500 }), 900);
check('a per-person flight falls back to the clients fare', guideFlightRate({ price_1_adult: 1500 }), 1500);
check('a charter with no crew fare has no seat price', guideFlightRate({ price_1_adult: 1500 }, { perCharter: true }), 0);
check('a charter with a crew fare prices the seat', guideFlightRate({ guide_rate: 900, unit_price: 12000 }, { perCharter: true }), 900);

/* -- What one meal choice puts on the day -----------------------------------
   The answer is an array: the guide always eats it, and the driver joins when the
   supplier says so, each line priced off its own party's rate. */
const mealRate = { id: 'r1', price_1_adult: 500, guide_rate: 400, driver_rate: 350 };
const guideOnlyMeal = { id: 'm1', name: 'Buffet lunch', category: 'Meals', guide_meal_offered: true, item_rates: [mealRate] };
const crewMeal = { ...guideOnlyMeal, driver_meal_offered: true };

check('no meal is no line', crewMealLines(null), []);
check('a guide-only meal is one line', crewMealLines(guideOnlyMeal).map((l) => [l.who, l.unitCost]), [['guide', 400]]);
check('a crew meal is a guide line and a driver line',
  crewMealLines(crewMeal).map((l) => [l.who, l.unitCost]),
  [['guide', 400], ['driver', 350]]);
check('both lines carry the same item, so the day shows one meal per party',
  crewMealLines(crewMeal).every((l) => l.item.id === 'm1'), true);

/* -- The rate card ----------------------------------------------------------
   The crew figure charged is printed, not the column it came from: a flagged
   meal with no typed crew rate prints the adult fare and says so. */
const mealCard = (extraRates, extraItem = {}) => libraryItemDetail({
  item: {
    name: 'Buffet lunch', category: 'Meals', currency: 'ZAR',
    meal_type: 'Lunch', item_rates: [{ id: 'r1', season_name: 'All year', ...extraRates }],
    ...extraItem
  }
}).seasons[0];

check('an untagged meal shows no crew section', rowsOf(mealCard({ price_1_adult: 500 }), 'guide-driver'), []);
check('a flagged guide meal prints the crew fare',
  rowsOf(mealCard({ price_1_adult: 500, guide_rate: 400 }, { guide_meal_offered: true }), 'guide-driver'),
  [['Guide', `${money(400)} / person`]]);
check('a crew meal without a driver figure prints the adult fare',
  rowsOf(mealCard({ price_1_adult: 500, guide_rate: 400 }, { guide_meal_offered: true, driver_meal_offered: true }), 'guide-driver'),
  [['Guide', `${money(400)} / person`], ['Driver', `${money(500)} / person · adult fare`]]);

const flightCard = (rate) => libraryItemDetail({
  item: {
    name: 'Light aircraft hop', category: 'Flights / Charter', currency: 'ZAR',
    guide_flight_offered: true, item_rates: [{ id: 'f1', season_name: 'All year', ...rate }]
  }
}).seasons[0];
const priceLabels = (card) => card.sections.find((s) => s.key === 'prices').rows.map((r) => r.label);

check('a per-person flight prints the clients fare and the guide seat',
  priceLabels(flightCard({ rate_basis: 'per_person', price_1_adult: 1500, guide_rate: 900 })),
  ['Per person', 'Guide seat']);
check('the guide seat prints the crew fare, not the clients fare',
  flightCard({ rate_basis: 'per_person', price_1_adult: 1500, guide_rate: 900 }).sections
    .find((s) => s.key === 'prices').rows.find((r) => r.label === 'Guide seat').value,
  `${money(900)} / person`);
check('a per-person flight with no crew fare still quotes the clients fare for the seat',
  flightCard({ rate_basis: 'per_person', price_1_adult: 1500 }).sections
    .find((s) => s.key === 'prices').rows.find((r) => r.label === 'Guide seat').value,
  `${money(1500)} / person`);
check('a charter with no crew fare shows no guide seat',
  priceLabels(flightCard({ rate_basis: 'per_vehicle', unit_price: 12000 })),
  ['Charter (per flight)']);
check('a charter with a crew fare shows the seat beside the aircraft price',
  priceLabels(flightCard({ rate_basis: 'per_vehicle', unit_price: 12000, guide_rate: 900 })),
  ['Charter (per flight)', 'Guide seat']);
check('a flight the guide is not sold on prints no seat',
  priceLabels(libraryItemDetail({
    item: {
      name: 'Scheduled hop', category: 'Flights / Charter', currency: 'ZAR',
      item_rates: [{ id: 'f2', season_name: 'All year', rate_basis: 'per_person', price_1_adult: 1500 }]
    }
  }).seasons[0]),
  ['Per person']);

/* -- The columns the builders must load -------------------------------------
   PostgREST rejects the WHOLE select when one named column is missing, so the
   crew flags are added to a projection the caller can retry without them. */
const CREW_COLUMNS = ['guide_meal_offered', 'driver_meal_offered', 'guide_flight_offered'];
const fields = (value) => String(value).replace(/\s/g, '').split(',');

check('the itinerary library load selects the crew flags',
  CREW_COLUMNS.every((c) => fields(LIBRARY_ITEM_LIGHT_FIELDS).includes(c)), true);
check('the package library load selects the crew flags',
  CREW_COLUMNS.every((c) => fields(LIBRARY_ITEM_PACKAGE_FIELDS).includes(c)), true);
check('the retry projection leaves the crew flags out',
  CREW_COLUMNS.some((c) => fields(LIBRARY_ITEM_PACKAGE_FIELDS_FALLBACK).includes(c)), false);
check('the retry projection still loads the item itself',
  ['id', 'name', 'category'].every((c) => fields(LIBRARY_ITEM_PACKAGE_FIELDS_FALLBACK).includes(c)), true);

/* -- The crew figure folded onto the line that buys it ----------------------
   A guide's seat on a flight and a guide's place on a tour are bought with the
   clients' ticket, so they join that line's buy and are shared by the party. The
   old shape - a second line "for the guide alone" that nobody was charged - is
   gone. A party that rostered no guide is still escorted by one, so a line that
   sells the crew a place always buys at least one. */
const flightSeasonRate = {
  id: 'f-1', currency: 'ZAR', rate_basis: 'per_person',
  season_name: 'Nov 2026 - Oct 2027', valid_from: '2026-11-01', valid_to: '2027-10-31',
  price_1_adult: 1500, guide_rate: 900
};
const flight = {
  id: 'fl', name: 'Light aircraft hop', category: 'Flights / Charter', currency: 'ZAR',
  guide_flight_offered: true, pricing_model: 'per_person', item_rates: [flightSeasonRate]
};
const plainFlight = { ...flight, id: 'fl-plain', guide_flight_offered: false };
const charterRate = { id: 'f-c', currency: 'ZAR', rate_basis: 'per_vehicle', unit_price: 12000 };
const tourRate = { ...flightSeasonRate, id: 't-1', price_1_adult: 700, guide_rate: 350 };
const tour = {
  id: 'tr', name: 'Sunset cruise', category: 'Activities / Tours', currency: 'ZAR',
  pricing_model: 'per_person', item_rates: [tourRate]
};

check('a flight crew fare buys one seat per guide',
  crewChargeOf(flight, flightSeasonRate, { guideCount: 2 }),
  { kind: 'guide_seat', label: 'Guide seat', fare: 900, heads: 2, total: 1800 });
check('a flight the guide is not sold on folds nothing', crewChargeOf(plainFlight, flightSeasonRate), null);
check('a charter that prices the whole aircraft has no seat to fold',
  crewChargeOf(flight, charterRate, { perCharter: true }), null);
check('a charter with a crew fare buys the seat at it',
  crewChargeOf(flight, { ...charterRate, guide_rate: 900 }, { perCharter: true }),
  { kind: 'guide_seat', label: 'Guide seat', fare: 900, heads: 1, total: 900 });
check('a tour folds the guide rate on its own season row',
  crewChargeOf(tour, tourRate),
  { kind: 'guide_place', label: "Guide's place", fare: 350, heads: 1, total: 350 });
check('a tour that never priced the guide folds nothing',
  crewChargeOf(tour, { ...tourRate, guide_rate: null }), null);
check('a flagged meal keeps its own crew line, not a fold',
  crewChargeOf({ id: 'm1', name: 'Buffet lunch', category: 'Meals', guide_meal_offered: true }, { price_1_adult: 500, guide_rate: 400 }),
  null);

/* Who carries the share: the travellers and their tour leaders, never the guide
   whose fare is being split. */
check('the share is the crew sum over the party', crewSharePerPerson(1800, 7), 257.14);
check('no party means no share', crewSharePerPerson(1800, 0), 0);
const sixClients = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, name: `Client ${i}`, role: 'client' }));
const party = [...sixClients, { id: 'tl1', name: 'Leader', role: 'tour_leader' }];
check('the share context decides when it has a figure', crewShareDivisor({ travellersPlusTl: 9 }, party, 4), 9);
check('otherwise the roster does', crewShareDivisor(null, party, 4), 7);
check('and an empty roster falls back to the party size', crewShareDivisor(null, [], 4), 4);
check('a fallback of nothing still shares by one', crewShareDivisor(null, [], 0), 1);

/* The fold as it rides on a saved line, in either builder's field naming. */
check('a saved itinerary line reads its fold',
  crewShareOn({ crewShare: { kind: 'guide_seat', label: 'Guide seat', fare: 900, heads: 1, total: 900, divisor: 6 } }).total, 900);
check('a saved package line reads its fold',
  crewShareOn({ crew_share: { kind: 'guide_place', label: "Guide's place", fare: 350, heads: 1, total: 350, divisor: 5 } }).total, 350);
check('a fold with no money in it is no fold', crewShareOn({ crewShare: { total: 0 } }), null);
check('a line without a fold is an ordinary line', crewShareOn({ buyPP: 1500 }), null);

/* A new season re-prices the seat the same way it re-prices the ticket, but a
   season that stopped quoting one cannot delete money already sold. */
const folded = { kind: 'guide_seat', label: 'Guide seat', fare: 900, heads: 1, total: 900, divisor: 6 };
check('a new season moves the seat fare',
  [refreshCrewShare(folded, { guide_rate: 990 }).fare, refreshCrewShare(folded, { guide_rate: 990 }).total],
  [990, 990]);
/* A per-person flight has no seat price of its own: the guide pays what the
   clients pay, so a season that lifted their fare lifts the seat with it. */
check('a seat with no crew figure follows the new client fare',
  refreshCrewShare(folded, { price_1_adult: 1650 }).total, 1650);
const soldPlace = { kind: 'guide_place', label: "Guide's place", fare: 350, heads: 1, total: 350, divisor: 6 };
check('a place the new season stopped quoting keeps its sold figure',
  refreshCrewShare(soldPlace, { price_1_adult: 800 }), soldPlace);
check('and a charter seat with no crew fare does too',
  refreshCrewShare(folded, { price_1_adult: 1650 }, { perCharter: true }), folded);
check('a second guide on the roster buys a second seat',
  refreshCrewShare(folded, { guide_rate: 990 }, { guideCount: 2 }).total, 1980);

/* -- The reprice engines ----------------------------------------------------
   A party that gained a tour leader re-shares the seat even though the client
   count did not move; a party that moved not at all leaves the line alone. */
const foldedLine = {
  itemId: 'fl', name: 'Light aircraft hop', category: 'Flights / Charter', currencyCode: 'ZAR',
  basis: 'per_person', buyPP: 1650, sellPP: 1650, markup: 0, pax: 6,
  crewShare: folded
};
const window = { start: '2026-11-05', end: '2026-11-14' };
const grown = repriceServicesForPax({
  days: [{ services: [foldedLine] }],
  libraryItems: [flight],
  paxCount: 7,
  travellers: party,
  travelWindow: window
}).days[0].services[0];
check('a bigger party is the same ticket plus a smaller share of the seat', grown.buyPP, 1628.57);
check('and the fold remembers who now shares it', grown.crewShare.divisor, 7);
check('the seat itself is still one seat', grown.crewShare.total, 900);

const unmoved = repriceServicesForPax({
  days: [{ services: [foldedLine] }],
  libraryItems: [flight],
  paxCount: 6,
  travellers: sixClients,
  travelWindow: window
}).days[0].services[0];
check('a party that did not move leaves the folded seat alone', unmoved, foldedLine);

const priorRate = { ...flightSeasonRate, id: 'f-0', season_name: 'Nov 2025 - Oct 2026', valid_from: '2025-11-01', valid_to: '2026-10-31' };
const movedSeason = revalidateServicesForWindow({
  days: [{
    services: [{
      ...foldedLine,
      seasonName: priorRate.season_name, seasonValidFrom: priorRate.valid_from,
      seasonValidTo: priorRate.valid_to, rateSeasonStatus: 'ok'
    }]
  }],
  libraryItems: [{ ...flight, item_rates: [priorRate, { ...flightSeasonRate, price_1_adult: 1650, guide_rate: 990 }] }],
  paxCount: 6,
  travellers: sixClients,
  travelWindow: window
}).days[0].services[0];
check('a new season re-prices the seat off its own row', [movedSeason.crewShare.fare, movedSeason.crewShare.total], [990, 990]);
check('and the line charges the new ticket with the new share', movedSeason.buyPP, 1815);

/* -- The crossing into a package ------------------------------------------
   unit_cost stays the price of one client's place; the crew sum crosses over as
   its own snapshot, so the package re-shares it over whoever turns up in a band
   rather than buying a seat per head. */
const built = buildItineraryPackage({
  meta: { itineraryName: 'Island Hop', numAdults: 7, travellers: party },
  days: [{ key: 'd1', dayNumber: 1, date: '2026-11-05', services: [grown] }],
  libraryItems: [flight],
  fallbackPax: 7,
  travelWindow: { start: '2026-11-01', end: '2027-10-31' },
  currencyCode: 'ZAR'
});
const crossed = built.days[0].items[0];
check('the client fare crosses over without the seat', crossed.unit_cost, 1500);
check('the seat crosses over as its own figure', [crossed.crew_share.total, crossed.crew_share.fare], [900, 900]);
check('and the fare it was sold at travels with the line', crossed.crew_share.kind, 'guide_seat');

const band = calculatePackageTravellerBreakdown({
  days: [{ day_number: 1, services: [crossed] }],
  pattern: { pax: 7 },
  library: [flight]
});
check('a band charges its own party the seat share', [band.unitPerPerson, band.unitTotal, band.partyTotal], [1628.57, 11400, 11400]);
const biggerBand = calculatePackageTravellerBreakdown({
  days: [{ day_number: 1, services: [crossed] }],
  pattern: { pax: 12 },
  library: [flight]
});
check('a bigger band splits the same seat, never buys one per head',
  [biggerBand.unitPerPerson, biggerBand.partyTotal], [1575, 18900]);

/* The presentation matrix shows the seat as a flat sum every column shares, not
   as a per-person figure - the per-person slice is added to a column unscaled. */
const pools = vehicleColumnPools({
  days: [{ day_number: 1, services: [crossed] }],
  library: [flight],
  vehicleTypes: [{ code: 'SED', max_capacity: 4 }, { code: 'VAN', max_capacity: 8 }]
});
check('the crew sum joins every vehicle column', [pools.pools.SED, pools.pools.VAN], [900, 900]);
check('and never the per-person fixed slice', [pools.perPersonFixed, pools.flatTotal], [1500, 900]);

/* -- The documents ----------------------------------------------------------
   The party pays for the seat inside its own fare, but the supplier still has to
   be asked for it, so the voucher breaks it out. */
check('the voucher names the seat and who shares it',
  voucherDetailLines({
    category: 'Flights / Charter', currencyCode: 'ZAR', confirmationNumber: 'SA342',
    crewShare: { ...folded, divisor: 7 }
  }).includes('Guide seat: ZAR 900.00, shared by 7'), true);
check('the voucher counts the seats',
  voucherDetailLines({
    category: 'Flights / Charter', currencyCode: 'ZAR',
    crewShare: { ...folded, heads: 2, total: 1800, divisor: 7 }
  }).includes('Guide seat: ZAR 900.00 × 2, shared by 7'), true);
check('an ordinary line documents no crew',
  voucherDetailLines({ category: 'Flights / Charter', currencyCode: 'ZAR' }),
  ['Confirmation Status: OK']);

console.log('\n--- Crew meals & guide flight options suite complete ---\n');
