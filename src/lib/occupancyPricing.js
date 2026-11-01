/* Villas and apartments priced per person by how many sleep in them.
 *
 * A standard room is contracted on its adult count: a single rate, a sharing rate
 * and an extra-adult rate. A villa is contracted on its OCCUPANCY: the supplier
 * quotes one per-person-per-night figure for each party the room takes, and every
 * head in the room pays it, adult or child. The figure falls as the villa fills
 * because the price is the villa's and the party splits it - two people in a
 * four-bedroom villa pay more each than six do.
 *
 * The adult-keyed columns cannot express that. A party of one adult and two
 * children reads the 1-adult (single) figure and a party of two adults and two
 * children reads the 2-adult figure, so neither lands on the band the supplier
 * quoted for 3 and for 4.
 *
 * Everything here is pure so the builder, the package engine, the rate card and
 * the tests read one ladder and never disagree about it.
 */

const num = (value) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const whole = (value) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

export const OCCUPANCY_BASIS = 'per_person_occupancy';

/* Whether a charge-basis string - the one stored on a room type or on a rate row
   - is the occupancy ladder. */
export const isOccupancyBasis = (basis) => String(basis || '').toLowerCase() === OCCUPANCY_BASIS;

/* The ladder as stored: one row per band, each band a party size and the figure
   every head in the room pays. A row with no usable rate, no party size, or an
   inverted band is dropped rather than guessed at - a half-typed band must not
   price a villa. */
export const normalizeOccupancyLadder = (tiers) => (Array.isArray(tiers) ? tiers : [])
  .map((tier) => {
    const rate = num(tier?.rate ?? tier?.price);
    const from = whole(tier?.min_pax ?? tier?.minPax ?? tier?.pax);
    const to = whole(tier?.max_pax ?? tier?.maxPax ?? tier?.pax) ?? from;
    if (rate === null || !(from > 0) || !(to > 0) || to < from) return null;
    return { minPax: from, maxPax: to, rate };
  })
  .filter(Boolean)
  .sort((a, b) => a.minPax - b.minPax || a.maxPax - b.maxPax);

export const occupancyLadderOf = (rate) => normalizeOccupancyLadder(rate?.occupancy_rates);

/* Whether a rate is sold on the occupancy ladder. The basis is the declaration,
   but a row that carries a ladder is ladder-priced even when its basis was never
   migrated, so an existing contract is never silently read as a sharing rate. */
export const isOccupancyTiered = (rateOrBasis) => {
  if (!rateOrBasis) return false;
  const basis = typeof rateOrBasis === 'string' ? rateOrBasis : rateOrBasis.rate_basis;
  if (String(basis || '').toLowerCase() === OCCUPANCY_BASIS) return true;
  return typeof rateOrBasis === 'object' && occupancyLadderOf(rateOrBasis).length > 0;
};

/* The figure one head pays for a room holding `pax` people, or null when the room
   is not sold at that size. A party above the top band is refused rather than
   priced at the nearest one: the supplier's "-" is a room that does not take them,
   not a discount. Same for a party below the bottom band - a villa quoted from two
   is not sold to one. */
export const occupancyRateForPax = (rate, pax) => {
  const travellers = whole(pax);
  if (!(travellers > 0)) return null;
  const band = occupancyLadderOf(rate).find((tier) => travellers >= tier.minPax && travellers <= tier.maxPax);
  return band ? band.rate : null;
};

/* The largest and smallest parties the ladder sells. The ceiling is what the
   supplier's "-" columns mean, and it is the room's own capacity limit for
   pricing purposes even when the room record allows more. */
export const occupancyCeiling = (rate) => occupancyLadderOf(rate).reduce((top, tier) => Math.max(top, tier.maxPax), 0);
export const occupancyFloor = (rate) => occupancyLadderOf(rate).reduce((low, tier) => (low === 0 ? tier.minPax : Math.min(low, tier.minPax)), 0);

/* The capacity a rate row lets the operator sell. A ladder stops where its bands
   stop: beds above the last priced party are not a capacity, they are a room that
   cannot be quoted. */
export const pricedCapacity = (rate, capacity) => {
  const beds = Math.max(0, parseInt(capacity, 10) || 0);
  if (!isOccupancyTiered(rate)) return beds;
  const ceiling = occupancyCeiling(rate);
  if (!ceiling) return beds;
  return Math.max(1, beds ? Math.min(beds, ceiling) : ceiling);
};

/* A supplier sheet quotes one line per party size; five, six, seven and eight all
   at R6 882 is one band. Collapse consecutive equal rates so a rate card states the
   contract once instead of repeating a figure the reader reads as four prices. */
export const collapseOccupancyLadder = (rate) => {
  const collapsed = [];
  occupancyLadderOf(rate).forEach((tier) => {
    const previous = collapsed[collapsed.length - 1];
    if (previous && previous.rate === tier.rate && previous.maxPax === tier.minPax - 1) {
      previous.maxPax = tier.maxPax;
      return;
    }
    collapsed.push({ ...tier });
  });
  return collapsed;
};

/* What the ladder is missing, in the operator's terms. Returned as a message so a
   save can refuse the row inline instead of storing a ladder that prices nothing. */
export const occupancyLadderError = (rate, capacity = 0) => {
  const ladder = occupancyLadderOf(rate);
  if (!ladder.length) return 'Add at least one occupancy band with a per-person price.';
  const ceiling = occupancyCeiling(rate);
  const limit = whole(capacity);
  if (limit > 0 && ceiling > limit) {
    return `The ladder sells up to ${ceiling} pax but the room only takes ${limit}.`;
  }
  const gap = ladder.find((tier, index) => {
    const next = ladder[index + 1];
    return next && next.minPax > tier.maxPax + 1;
  });
  if (gap) {
    const next = ladder[ladder.indexOf(gap) + 1];
    const missing = next.minPax - gap.maxPax === 1 ? `${next.minPax} pax` : `${gap.maxPax + 1}\u2013${next.minPax - 1} pax`;
    return `No price for ${missing}, so a party that size cannot be quoted.`;
  }
  return '';
};
