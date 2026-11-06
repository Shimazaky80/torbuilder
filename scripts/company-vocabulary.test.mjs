/* The shared vocabulary: national tour types and vehicle sizes, plus a company's
   own rows over the top.

   What this has to hold is the merge and the write that follows it. A company's row
   wins wherever the two carry the same key - in either order the database returned
   them - and an override keeps that key, because a vehicle's code is what every
   saved price map is written against. If a rename could re-key a vehicle, the rates
   of every package built on it would silently stop resolving. */
import {
  TOUR_TYPES,
  VEHICLE_TYPES,
  activeVehicleTypes,
  isSharedVocabulary,
  mergeVocabulary,
  vocabularyKey,
  vocabularyNames,
  vocabularyOverridePayload,
  vocabularyReadFilter
} from '../src/lib/companyVocabulary.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};

const sprinter = { id: 'n-16', company_id: null, code: 'sprinter_16', name: 'Sprinter (16)', max_capacity: 16, is_active: true, sort_order: 4 };
const combi = { id: 'n-combi', company_id: null, code: 'combi', name: 'Combi', max_capacity: 6, is_active: true, sort_order: 2 };
const mine = { id: 'c-16', company_id: 'acme', code: 'sprinter_16', name: 'Mercedes 16-seater', max_capacity: 16, is_active: true, sort_order: 4 };
const invented = { id: 'c-x', company_id: 'acme', code: 'helimco', name: 'Helimco (9)', max_capacity: 9, is_active: true, sort_order: 0 };

/* - Keys --------------------------------------------------------------------------------------- */

check('a vehicle key is its code', vocabularyKey(mine, 'code'), 'sprinter_16');
check('a tour key is its name, folded', vocabularyKey({ name: '  Series Departure ' }, 'name'), 'series departure');
check('a missing value is no key at all', vocabularyKey({ name: '  ' }, 'name'), '');
check('a row without a company is the standard one', isSharedVocabulary(sprinter), true);
check('a row with a company is not', isSharedVocabulary(mine), false);

/* - Reading the two halves as one list ---------------------------------------------------------- */

check(
  'the standard list alone reads as standard',
  mergeVocabulary([combi, sprinter], 'code').map((r) => [r.name, r.shared, r.overridden]),
  [['Combi', true, false], ['Sprinter (16)', true, false]]
);

const [first, second] = mergeVocabulary([combi, sprinter, mine], 'code');
check('the company row replaces the standard one', [first.name, second.name], ['Combi', 'Mercedes 16-seater']);
check('the replacement is marked as an override', [second.shared, second.overridden], [false, true]);
check('the override remembers the standard row', second.nationalId, 'n-16');
check('a row nobody else has is the company\'s own', mergeVocabulary([sprinter, invented], 'code')
  .find((r) => r.code === 'helimco').overridden, false);
check('an own row with no standard twin has nothing to restore', mergeVocabulary([invented], 'code')[0].nationalId, null);

/* The database may hand back either half first, and the answer cannot depend on it. */
check(
  'a company row read before its standard twin is still an override',
  mergeVocabulary([mine, sprinter], 'code').map((r) => [r.name, r.overridden, r.nationalId]),
  [['Mercedes 16-seater', true, 'n-16']]
);

/* Resizing is the whole point of overriding a vehicle, and the list a quote walks
   has to be smallest-first after it. */
const resized = { ...mine, name: 'Sprinter (6)', max_capacity: 6 };
check(
  'a resized override sorts with the size it now sells',
  mergeVocabulary([combi, sprinter, resized], 'code').map((r) => r.name),
  ['Combi', 'Sprinter (6)']
);

check(
  'a tour override is matched the way the index matches it',
  mergeVocabulary([
    { id: 'n-fit', company_id: null, name: 'FIT', is_active: true },
    { id: 'c-fit', company_id: 'acme', name: 'Fit', is_active: false }
  ], 'name').map((r) => [r.id, r.name, r.is_active, r.nationalId]),
  [['c-fit', 'Fit', false, 'n-fit']]
);

check('an empty read is an empty list', mergeVocabulary([], 'code'), []);
check('a null read is an empty list', mergeVocabulary(null, 'name'), []);
check('a row with no key is dropped, not merged', mergeVocabulary([{ id: 'x', company_id: null, name: '  ' }], 'name'), []);

/* The dropdown lists: active only, one name per key, in the order the table reads. */
check(
  'the name list skips what the company switched off',
  vocabularyNames([
    { id: 'n-1', company_id: null, name: 'Incentives', is_active: true },
    { id: 'n-2', company_id: null, name: 'Groups', is_active: true },
    { id: 'c-2', company_id: 'acme', name: 'Groups', is_active: false }
  ]),
  ['Incentives']
);
check('a vehicle list reads the same way', vocabularyNames([combi, mine], 'code'), ['Combi', 'Mercedes 16-seater']);

/* The grid axis: inactive rows price nothing, and switching a standard size off
   through an override takes it out of the grid even though the standard row is
   still active for everybody else. */
check(
  'only active sizes go into a price grid',
  activeVehicleTypes(mergeVocabulary([combi, sprinter, invented, { ...mine, is_active: false }], 'code')).map((r) => r.max_capacity),
  [6, 9]
);

/* - Reading both halves ------------------------------------------------------------------------- */

check('a company reads the standard list and its own', vocabularyReadFilter('acme'), 'company_id.is.null,company_id.eq.acme');
check('a session with no company reads only the standard list', vocabularyReadFilter(null), 'company_id.is.null');

/* - Writing: the first change makes an override, and the key survives -------------------------- */

const vehicleOverride = vocabularyOverridePayload(sprinter, { name: 'Big Sprinter', max_capacity: 18 }, 'acme', 'code');
check('an override is written in the company name', vehicleOverride.company_id, 'acme');
check('an override keeps the code the prices are keyed on', vehicleOverride.code, 'sprinter_16');
check('an override carries the edits', [vehicleOverride.name, vehicleOverride.max_capacity], ['Big Sprinter', 18]);
check('an override carries what was not edited', [vehicleOverride.is_active, vehicleOverride.sort_order], [true, 4]);

/* A typed name cannot smuggle a new key in: the code is re-asserted from the
   standard row after the changes are applied. */
check(
  'an edit can never re-key the standard row',
  vocabularyOverridePayload(sprinter, { code: 'something_else', name: 'X' }, 'acme', 'code').code,
  'sprinter_16'
);

const tourOverride = vocabularyOverridePayload(
  { id: 'n-fit', company_id: null, name: 'FIT', is_active: true },
  { is_active: false, name: 'Renamed' },
  'acme',
  'name'
);
check('switching a standard type off keeps its name', tourOverride.name, 'FIT');
check('switching a standard type off is written as inactive', tourOverride.is_active, false);
check('a tour override belongs to the company', tourOverride.company_id, 'acme');

/* - The table specs the pages build their queries from ----------------------------------------- */

check('tour types read the columns the merge needs', TOUR_TYPES.columns.includes('company_id'), true);
check('vehicle types read the code and the capacity', VEHICLE_TYPES.columns.includes('max_capacity'), true);
check('a tour type is keyed on its name', TOUR_TYPES.keyColumn, 'name');
check('a vehicle type is keyed on its code', VEHICLE_TYPES.keyColumn, 'code');

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
