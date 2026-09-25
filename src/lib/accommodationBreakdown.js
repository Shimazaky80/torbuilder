import { round2, vatOfInclusive } from './invoiceDoc';
import { calculateRoomCharges } from './roomAllocationHelper';

/* "2A, 1C" occupant summary for the Qty column of expanded accommodation lines.
   Adults always appear; the children part is only added when the room / trip
   has at least one child. */
export const paxQtyText = (adults, children) => {
  const a = Math.max(0, Math.round(Number(adults) || 0));
  const c = Math.max(0, Math.round(Number(children) || 0));
  const parts = [`${a}A`];
  if (c > 0) parts.push(`${c}C`);
  return parts.join(', ');
};

const taxOf = (total, rate) => {
  const amount = round2(Number(total) || 0);
  const tax = round2(vatOfInclusive(amount, rate));
  return { subExcl: round2(amount - tax), tax };
};

/* Price a per-room / whole-accommodation breakdown line from a day's
   accommodation selling figure and its room allocation.

   Per-room costs come from calculateRoomCharges (the contracted buy of each
   room, together with the service markup for the sell figure); the actual
   day-line total is distributed across the rooms by that buy so the expanded
   rows always add back up to exactly what the client is billed. The final row
   absorbs any rounding remainder.

   mode 'single' keeps the whole accommodation on one line (occupant summary
   in the Qty column); mode 'rooms' puts each occupied room on its own line
   (e.g. 2A on one line, 1A on another, 2A, 1C on a third). When no room
   allocation (or rate) is available the fallback traveller counts are used so
   a single summary line still displays the A/C figure. */
export const accommodationBreakdown = ({
  mode = 'single',
  lineTotal,
  rooms = [],
  rate = null,
  ageRanges = [],
  markup = 0,
  taxRate = 15,
  fallbackAdults = 0,
  fallbackChildren = 0
} = {}) => {
  const total = round2(Number(lineTotal) || 0);
  const rms = Array.isArray(rooms) ? rooms : [];

  const row = (adults, children, rowTotal, pax) => {
    const t = round2(Number(rowTotal) || 0);
    const t2 = taxOf(t, taxRate);
    return {
      qty: paxQtyText(adults, children),
      qtyTitle: `${adults} Adult${adults === 1 ? '' : 's'}${children > 0 ? `, ${children} Child${children === 1 ? '' : 'ren'}` : ''}`,
      qtyText: true,
      unit: round2(pax > 0 ? t / pax : t),
      subExcl: t2.subExcl,
      tax: t2.tax,
      lineTotal: t
    };
  };

  let charge = null;
  if (rate && rms.length) {
    charge = calculateRoomCharges(
      { item_rates: [rate], child_age_ranges: Array.isArray(ageRanges) ? ageRanges : [] },
      rms,
      undefined,
      Number(markup) || 0
    );
  }
  const occRooms = charge && charge.totalBuy > 0
    ? charge.rooms.filter((rm) => (rm.allocatedTravellers || []).length > 0)
    : [];

  if (mode === 'rooms') {
    if (occRooms.length) {
      const pending = occRooms.map((rm) => ({
        adults: rm.adultCount,
        children: rm.childCount,
        share: charge.totalBuy > 0 ? total * rm.buyCost / charge.totalBuy : 0
      }));
      pending.forEach((p) => { p.lineTotal = round2(p.share); });
      const sum = pending.reduce((a, p) => a + p.lineTotal, 0);
      pending[pending.length - 1].lineTotal = round2(pending[pending.length - 1].lineTotal + round2(total - sum));
      return {
        rows: pending.map((p) => row(p.adults, p.children, p.lineTotal, p.adults + p.children)),
        total
      };
    }
    return { rows: [row(fallbackAdults, fallbackChildren, total, fallbackAdults + fallbackChildren)], total };
  }

  if (occRooms.length) {
    const adults = occRooms.reduce((a, rm) => a + rm.adultCount, 0);
    const children = occRooms.reduce((a, rm) => a + rm.childCount, 0);
    return { rows: [row(adults, children, total, adults + children)], total };
  }
  return { rows: [row(fallbackAdults, fallbackChildren, total, fallbackAdults + fallbackChildren)], total };
};