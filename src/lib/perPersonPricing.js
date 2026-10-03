import { round2, vatOfInclusive, numOr } from './invoiceDoc';
import { isAdultTraveller, childRateForAge, calculateRoomCharges } from './roomAllocationHelper';

const parseF = (v) => parseFloat(v) || 0;

/* Single / sharing BUY rates for one accommodation rate row. Single and sharing
   mirror the field conventions used by contractPaxRate and calculateRoomCharges.
   Children are resolved age-aware (band keys in child_rates_breakdown matched
   against rate._ageRanges, or a flat `child` key / price_child / child_rate /
   child_discount) by childRateForAge — a configured 0 is a free child.

   Flat room rates are ordered differently. There unit_price is the whole shared
   room and single_room_rate / effective_single_rate is the whole room occupied by
   one adult, and neither is a per-person figure. Reading price_1_adult first
   would make a flat shared room look like a single rate and a flat single room
   look like it had a separate single supplement, so the flat fields are read
   first and the per-adult columns are only a last resort. */
const rateNumbers = (rate) => {
  const isFlat = String(rate?.rate_basis || '') === 'per_room'
    || parseF(rate?.unit_price) > 0 && !parseF(rate?.price_2_adults);
  if (isFlat) {
    const shared = parseF(rate?.unit_price) || parseF(rate?.price_1_adult) || 0;
    const single = parseF(rate?.single_room_rate)
      || parseF(rate?.effective_single_rate)
      || shared;
    return { singleBuy: single, sharingBuy: shared };
  }
  const singleBuy = parseF(rate?.price_1_adult) || parseF(rate?.single_room_rate) || parseF(rate?.unit_price) || 0;
  const sharingBuy = parseF(rate?.price_2_adults) || parseF(rate?.double_twin_rate) || singleBuy || 0;
  return { singleBuy, sharingBuy };
};

/* Per-currency per-person pricing breakdown.

   Deductive model (rows are additive and reconcile to the room-charges total):
     - Per person sharing: the base everyone would pay if all travellers shared
       accommodation at the sharing rate, plus all non-accommodation services
       (children pay the adult rate on those).
     - Single supplement: single-occupancy rooms pay the single rate instead of
       the sharing rate, i.e. (single − sharing) per single room.
     - Per child: children sharing with adults are charged the child rate where
       one exists (including an explicit 0 = free child); the child figure is
       the sharing base plus the per-child child-rate difference.

   `services` are normalized entries:
     { category, currencyCode, sellPP, taxRate, itemId, roomAllocations, markup }
   `rateBy(itemId)` resolves the accommodation rate ROW for the group currency.
   The selling figures are Library-derived: each BUY rate is scaled by the
   service's markup (or by the contracted room-buy total when markup is
   unknown), so Per person sharing / Single supplement / Per child remain the
   clean Library prices even when the day-line sellPP was averaged over mixed
   single/shared rooms. Non-accommodation services are added per person.
*/
export const computePerPersonRows = ({ services = [], travellers = [], rateBy = () => null, defaultTaxRate = 15 } = {}) => {
  const list = Array.isArray(travellers) ? travellers : [];
  const childrenCount = list.filter((t) => !isAdultTraveller(t)).length;
  const T = Math.max(list.length, 1);

  let sharingIncl = 0, sharingTax = 0, sharingExcl = 0;
  let singleIncl = 0, singleTax = 0, singleExcl = 0;
  let childIncl = 0, childTax = 0, childExcl = 0;

  const add = (incl, rate, bucket) => {
    const tax = vatOfInclusive(incl, rate);
    if (bucket === 'single') {
      singleIncl += incl; singleTax += tax; singleExcl += incl - tax;
    } else if (bucket === 'childD') {
      childIncl += incl; childTax += tax; childExcl += incl - tax;
    } else {
      sharingIncl += incl; sharingTax += tax; sharingExcl += incl - tax;
    }
  };

  (Array.isArray(services) ? services : []).forEach((sv) => {
    const taxRate = numOr(sv.taxRate, defaultTaxRate);
    const pp = round2(Number(sv.sellPP) || 0);
    if (pp < 0) return;
    if (!/accommodation/i.test(String(sv.category || ''))) {
      add(pp * T, taxRate, 'sharing');
      return;
    }

    const rate = sv.itemId ? rateBy(sv.itemId) : null;
    const ageRanges = Array.isArray(rate?._ageRanges) ? rate._ageRanges : [];
    const { singleBuy, sharingBuy } = rateNumbers(rate);
    const rooms = Array.isArray(sv.roomAllocations) && sv.roomAllocations.length ? sv.roomAllocations : null;

    /* Selling scale: the item's markup when known (builder saves it on the
       service / itinerary day item); otherwise inferred from the contracted
       room buy total (`sellPP x T / contractBuy`) so the rows reconcile to the
       day-line; last resort the sellPP/selling ratio. */
    let scale;
    const markupPct = Number(sv.markup) || 0;
    if (markupPct > 0 && sharingBuy > 0) {
      scale = 1 + markupPct / 100;
    } else if (rooms && sharingBuy > 0) {
      const buy = calculateRoomCharges({ item_rates: [rate], child_age_ranges: ageRanges }, rooms, undefined, 0).totalBuy;
      const allocatedPax = rooms.reduce(
        (count, room) => count + (Array.isArray(room.allocatedTravellers) ? room.allocatedTravellers.length : 0),
        0
      );
      scale = buy > 0 ? (pp * (allocatedPax || T)) / buy : (sharingBuy > 0 ? pp / sharingBuy : 1);
    } else {
      scale = sharingBuy > 0 ? pp / sharingBuy : 1;
    }
    const sharingSell = sharingBuy > 0 ? sharingBuy * scale : pp;
    const singleSell = sharingBuy > 0 ? singleBuy * scale : pp;
    const childSellFor = (t) => {
      const c = childRateForAge(rate, parseF(t?.age), ageRanges, sharingBuy);
      return c.known && sharingBuy > 0 ? c.rate * scale : null;
    };

    if (!rooms) {
      add(sharingSell * T, taxRate, 'sharing');
      return;
    }

    rooms.forEach((rm) => {
      const occs = Array.isArray(rm.allocatedTravellers) ? rm.allocatedTravellers : [];
      const occ = occs.length;
      if (!occ) return;
      const childOccs = occs.filter((t) => !isAdultTraveller(t));

      if (occ === 1) {
        if (!childOccs.length) {
          add(sharingSell, taxRate, 'sharing');
          add(singleSell - sharingSell, taxRate, 'single');
        } else {
          add(sharingSell, taxRate, 'sharing');
          const childSell = childSellFor(childOccs[0]);
          if (childSell !== null) add(childSell - sharingSell, taxRate, 'childD');
        }
        return;
      }

      add(occ * sharingSell, taxRate, 'sharing');
      childOccs.forEach((t) => {
        const childSell = childSellFor(t);
        if (childSell !== null) add(childSell - sharingSell, taxRate, 'childD');
      });
    });
  });

  return {
    perPersonSharing: {
      sell: round2(sharingIncl / T),
      tax: round2(sharingTax / T),
      subExcl: round2(sharingExcl / T)
    },
    singleSupplement: {
      sell: round2(singleIncl),
      tax: round2(singleTax),
      subExcl: round2(singleExcl)
    },
    perChild: childrenCount > 0 ? {
      sell: round2(sharingIncl / T + childIncl / childrenCount),
      tax: round2(sharingTax / T + childTax / childrenCount),
      subExcl: round2(sharingExcl / T + childExcl / childrenCount)
    } : null,
    hasSingle: singleIncl > 0,
    hasChildren: childrenCount > 0,
    totalCount: T
  };
};

/* Serialize a computePerPersonRows result into the JSON snapshot persisted on
   an invoice (and shown by the builder exports). */
export const breakdownSnapshot = (r) => {
  if (!r) return null;
  const rows = [{ label: 'Per person sharing', sell: r.perPersonSharing.sell, subExcl: r.perPersonSharing.subExcl, tax: r.perPersonSharing.tax }];
  if (r.hasSingle) rows.push({ label: 'Single supplement', sell: r.singleSupplement.sell, subExcl: r.singleSupplement.subExcl, tax: r.singleSupplement.tax });
  if (r.perChild) rows.push({ label: 'Per child', sell: r.perChild.sell, subExcl: r.perChild.subExcl, tax: r.perChild.tax });
  return { rows, totalCount: r.totalCount, hasChildren: r.hasChildren, hasSingle: r.hasSingle };
};