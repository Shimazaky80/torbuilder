/* The destination catalogue: the standard places every tenant reads plus the
   company's own.

   What this has to hold is the merge, the filter the Settings card applies, and
   the payload a tenant writes. A company's own row wins over a standard twin,
   but a saved day is never re-keyed: the day stores its own name and region, so
   renaming or deleting a catalogue row cannot rewrite an itinerary. */
import {
  PLACE_COLUMNS,
  filterPlaces,
  isSharedPlace,
  mergePlaces,
  placeClash,
  placeFormFrom,
  placeKey,
  placePayload,
  placeReadFilter,
  placeSearchText
} from '../src/lib/placeCatalog.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};

const windhoek = { id: 'n-whk', company_id: null, country: 'Namibia', province: 'Khomas', place: 'Windhoek', alt_name: 'Windhuk', is_hub: true, is_active: true };
const swakopmund = { id: 'n-swk', company_id: null, country: 'Namibia', province: 'Erongo', place: 'Swakopmund', alt_name: null, is_hub: false, is_active: true };
const capeTown = { id: 'n-cpt', company_id: null, country: 'South Africa', province: 'Western Cape', place: 'Cape Town', alt_name: null, is_hub: true, is_active: true };
const myLodge = { id: 'c-lodge', company_id: 'acme', country: 'Namibia', province: 'Kunene', place: 'Etendeka Lodge', alt_name: 'Etendeka', is_hub: false, is_active: true };
const myWindhoek = { id: 'c-whk', company_id: 'acme', country: 'Namibia', province: 'Khomas', place: 'Windhoek', alt_name: null, is_hub: true, is_active: true };

/* - Keys --------------------------------------------------------------------------------------- */

check('a place key folds country, region and name', placeKey({ country: ' Namibia ', province: 'KHOMAS', place: 'Windhoek' }), 'namibia|khomas|windhoek');
check('a missing value is still a key part', placeKey({ country: 'Namibia', place: 'Windhoek' }), 'namibia||windhoek');
check('a row without a company is the standard one', isSharedPlace(windhoek), true);
check('a row with a company is the company\'s own', isSharedPlace(myLodge), false);
check('a null row is not a place', isSharedPlace(null), true);

/* - Reading the two halves as one list ---------------------------------------------------------- */

check(
  'the standard list alone reads in country and place order',
  mergePlaces([swakopmund, capeTown, windhoek]).map((row) => row.place),
  ['Swakopmund', 'Windhoek', 'Cape Town']
);
check(
  'the company\'s own row is kept alongside the standard list',
  mergePlaces([windhoek, swakopmund, myLodge]).map((row) => row.place),
  ['Etendeka Lodge', 'Swakopmund', 'Windhoek']
);
check(
  'a company row replaces a standard twin with the same key',
  mergePlaces([windhoek, myWindhoek]).map((row) => [row.id, row.company_id]),
  [['c-whk', 'acme']]
);
check(
  'the replacement wins whichever half was read first',
  mergePlaces([myWindhoek, windhoek]).map((row) => row.id),
  ['c-whk']
);
check('an empty read is an empty list', mergePlaces([]), []);
check('a null read is an empty list', mergePlaces(null), []);
check('a row without an id is dropped', mergePlaces([{ country: 'Namibia', province: 'Khomas', place: 'Windhoek' }]), []);

/* - Searching and filtering --------------------------------------------------------------------- */

check('the search text covers place, region, country and alternative name', placeSearchText(windhoek), 'windhoek khomas namibia windhuk');

const catalogue = mergePlaces([windhoek, swakopmund, capeTown, myLodge]);
check('a country filter keeps one country', filterPlaces(catalogue, { country: 'Namibia' }).map((row) => row.place), ['Etendeka Lodge', 'Swakopmund', 'Windhoek']);
check('the mine scope hides the standard list', filterPlaces(catalogue, { scope: 'mine' }).map((row) => row.place), ['Etendeka Lodge']);
check('the standard scope hides the company list', filterPlaces(catalogue, { scope: 'standard' }).map((row) => row.place), ['Swakopmund', 'Windhoek', 'Cape Town']);
check('the all scope keeps both halves', filterPlaces(catalogue, { scope: 'all' }).length, 4);
check('a search matches the alternative name', filterPlaces(catalogue, { query: 'windhuk' }).map((row) => row.place), ['Windhoek']);
check('a search folds case', filterPlaces(catalogue, { query: 'SWAKOP' }).map((row) => row.place), ['Swakopmund']);
check('a search matches the region', filterPlaces(catalogue, { query: 'kunene' }).map((row) => row.place), ['Etendeka Lodge']);
check('a country and a search combine', filterPlaces(catalogue, { country: 'Namibia', query: 'lodge' }).map((row) => row.place), ['Etendeka Lodge']);
check('a filter that matches nothing is empty', filterPlaces(catalogue, { query: 'nowhere' }), []);

/* - Catching a duplicate before the database does ------------------------------------------------- */

check('a place already on the list clashes with an identical new place', placeClash(catalogue, { country: 'Namibia', province: 'Khomas', place: 'windhoek' })?.id, 'n-whk');
check('the row being edited does not clash with itself', placeClash(catalogue, { country: 'Namibia', province: 'Khomas', place: 'Windhoek' }, 'n-whk'), null);
check('a new place that nobody has is no clash', placeClash(catalogue, { country: 'Namibia', province: 'Kunene', place: 'Palmwag' }), null);

/* - Writing -------------------------------------------------------------------------------------- */

const payload = placePayload({ country: ' Namibia ', province: ' Kunene ', place: ' Palmwag ', altName: ' ', isHub: true, isActive: true }, 'acme');
check('the payload belongs to the company', payload.company_id, 'acme');
check('the payload trims the place fields', [payload.country, payload.province, payload.place], ['Namibia', 'Kunene', 'Palmwag']);
check('an empty alternative name is stored as null', payload.alt_name, null);
check('hub and active travel with the row', [payload.is_hub, payload.is_active], [true, true]);
check('a form without an active flag defaults to active', placePayload({ country: 'Namibia', province: 'Kunene', place: 'Palmwag' }, 'acme').is_active, true);
check('a form without a hub flag defaults to not a hub', placePayload({ country: 'Namibia', province: 'Kunene', place: 'Palmwag' }, 'acme').is_hub, false);

const form = placeFormFrom({ ...myLodge, alt_name: 'Etendeka' });
check('a row opens into the form the editor uses', [form.country, form.province, form.place, form.altName], ['Namibia', 'Kunene', 'Etendeka Lodge', 'Etendeka']);
check('an inactive row opens inactive', placeFormFrom({ ...myLodge, is_active: false }).isActive, false);

/* - Reading both halves ------------------------------------------------------------------------- */

check('a company reads the standard list and its own', placeReadFilter('acme'), 'company_id.is.null,company_id.eq.acme');
check('a session with no company reads only the standard list', placeReadFilter(null), 'company_id.is.null');

/* - The table spec the page builds its query from ----------------------------------------------- */

check('the query reads the ownership column', PLACE_COLUMNS.includes('company_id'), true);
check('the query reads the search columns', ['country', 'province', 'place', 'alt_name'].every((column) => PLACE_COLUMNS.includes(column)), true);

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
