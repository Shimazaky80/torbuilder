/* A hire line stores the whole answer the operator gave at the drop — which
   vehicle group, which rental-length band, how many 24-hour blocks and what the
   contract fee added — as a JSONB copy on the line itself. A later tariff change
   must not rewrite a quoted hire, so the line carries its own truth. The same
   shape carries a crew figure folded onto a line (crew_share).

   Both columns are probed, not assumed, for the reason given in
   schemaColumnProbe.js: a builder that writes them before their migration runs
   would fail the save of every line on the itinerary. */
import { columnExists } from './schemaColumnProbe';

export const rentalDetailsColumn = (table) => columnExists(table, 'rental_details');

/* True once 20261250 has been applied to the table. Until then a folded crew
   charge still prices the open itinerary, it simply is not on the row. */
export const crewShareColumn = (table) => columnExists(table, 'crew_share');
