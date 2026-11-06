/* A hire line stores the whole answer the operator gave at the drop — which
   vehicle group, which rental-length band, how many 24-hour blocks and what the
   contract fee added — as a JSONB copy on the line itself. A later tariff change
   must not rewrite a quoted hire, so the line carries its own truth. The same
   shape carries a crew figure folded onto a line (crew_share). */

/* Extra columns a service line carries are all probed, never assumed, for the
   reason given in schemaColumnProbe.js: a builder that writes one before its
   migration runs fails the save of every line on the itinerary. */
import { columnExists } from './schemaColumnProbe';

export const rentalDetailsColumn = (table) => columnExists(table, 'rental_details');

/* True once 20261250 has been applied to the table. Until then a folded crew
   charge still prices the open itinerary, it simply is not on the row. */
export const crewShareColumn = (table) => columnExists(table, 'crew_share');

/* True once 20261256 has been applied. Composing an offer still works before
   then — the lines group in the builder and print grouped — they simply lose the
   key when the package is saved, because nothing can store it yet. */
export const bundleColumn = (table) => columnExists(table, 'bundle_key');
