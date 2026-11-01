import {
  DESTINATION_COLUMNS,
  destinationClause,
  destinationsOf,
  matchesDestinations,
  sortedDestinations
} from '../src/lib/destinationFilter.js';

const check = (label, actual, expected) => {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  if (!passed) process.exitCode = 1;
};

/* What an item is filed under */
check('every destination column counts', destinationsOf({
  destination_region: 'Cape Town', destination_area: 'Atlantic Seaboard', location: 'Southern Suburbs'
}), ['Cape Town', 'Atlantic Seaboard', 'Southern Suburbs']);
check('blanks and stray spaces drop out', destinationsOf({
  destination_region: '  Cape Town  ', destination_area: '   ', location: null
}), ['Cape Town']);
check('the same name in two columns is offered once', destinationsOf({
  destination_region: 'Mahe', destination_area: 'Mahe'
}), ['Mahe']);
check('an item with nothing recorded has no destination', destinationsOf({ name: 'Freelance guide' }), []);
check('a missing item is not a crash', destinationsOf(null), []);
check('the picker reads region, area and the older location field', DESTINATION_COLUMNS, ['destination_region', 'destination_area', 'location']);
/* Case variants are a data problem, not a dedupe target: filtering by one
   spelling would not match the other, so hiding it would lose items. They sort
   next to each other so the operator can see the duplicate. */
check('the option list is deduped and alphabetical', sortedDestinations(['Zanzibar', 'Cape Town', 'zanzibar', 'Cape Town', '']), ['Cape Town', 'zanzibar', 'Zanzibar']);

/* The clause the server is sent */
check('no selection sends no clause', destinationClause([]), '');
check('blank names are not a selection', destinationClause(['', '  ', null]), '');
check('the same island picked twice is one filter', destinationClause(['Mahe', 'Mahe']), destinationClause(['Mahe']));
check('one island filters all three columns', destinationClause(['Mahe']), [
  'destination_region.in.("Mahe")',
  'destination_area.in.("Mahe")',
  'location.in.("Mahe")'
].join(','));
/* PostgREST splits on commas, so an unquoted "Kruger (Mpumalanga)" parses into a
   filter that matches nothing — the picker would look empty for a real island. */
check('a name with spaces is quoted', destinationClause(['Cape Town CBD']).includes('in.("Cape Town CBD")'), true);
check('a name with brackets is quoted', destinationClause(['Kruger (Mpumalanga)']).includes('in.("Kruger (Mpumalanga)")'), true);
check('a name with a full stop is quoted', destinationClause(['No.1 Road']).includes('in.("No.1 Road")'), true);
check('a quote inside a name cannot break out', destinationClause(['St James"s']).includes('\\"'), true);
check('a backslash inside a name stays one value', destinationClause(['Cape\\Town']).includes('Cape\\\\Town'), true);
check('several islands share one list per column', destinationClause(['Mahe', 'Praslin']), [
  'destination_region.in.("Mahe","Praslin")',
  'destination_area.in.("Mahe","Praslin")',
  'location.in.("Mahe","Praslin")'
].join(','));

/* The same rule the server applies, so the sidebar never shows what it filtered out */
const lodge = { destination_region: 'Vaila', destination_area: 'Mahe' };
check('an empty selection hides nothing', matchesDestinations(lodge, []), true);
check('a region match counts', matchesDestinations({ destination_region: 'Mahe' }, ['Mahe']), true);
check('an area match counts', matchesDestinations(lodge, ['Mahe']), true);
check('the older location field counts', matchesDestinations({ location: 'Mahe' }, ['Mahe']), true);
check('any selected island lets the item through', matchesDestinations(lodge, ['Rodrigues', 'Mahe']), true);
check('an island the item is not filed under hides it', matchesDestinations(lodge, ['Rodrigues']), false);
check('a destination-less item is hidden while filtering', matchesDestinations({ name: 'Freelance guide' }, ['Mahe']), false);
check('whitespace in the stored value does not block a match', matchesDestinations({ destination_region: '  Mahe ' }, ['Mahe']), true);
check('a blank name in the selection is ignored, not a wildcard', matchesDestinations(lodge, ['']), true);
