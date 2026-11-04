import { round2, vatOfInclusive, numOr } from './invoiceDoc';
import { isAdultTraveller, childRateForAge, calculateRoomCharges, normaliseTravellerRole } from './roomAllocationHelper';
import { chargesChildRate, childFigureForLine, isFlatBasis } from './servicePricing';
import {
  baseSingleSupplement,
  normaliseSingleSupplementLadder,
  singleSupplementForOrdinal
} from './singleSupplement';
import {
  isOccupancyTiered,
  occupancyCeiling,
  occupancyFloor,
  occupancyRateForPax
} from './occupancyPricing';
import { rateForAllocatedRoom } from './roomTypePricing';

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
   first and the per-adult columns are only a last resort.

   An occupancy-laddered villa has no single and no sharing figure of its own -
   the price depends on how many sleep in. The card still needs two columns, so it
   reads the contract's two ends: the dearest band (smallest party the supplier
   sells) is the column a lone payer would land in, the fullest band is what a
   sharing party pays. The room-by-room allocation loop below overrides both with
   each room's own band, so these two figures are the quoted range, never a charge. */
const rateNumbers = (rate) => {
  if (isOccupancyTiered(rate)) {
    const sharing = occupancyRateForPax(rate, occupancyCeiling(rate)) || 0;
    const single = occupancyRateForPax(rate, occupancyFloor(rate)) || sharing;
    return { singleBuy: single, sharingBuy: sharing };
  }
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

/* Everything one accommodation rate row says about the price of a bed: the two
   columns, whether the room is charged per room or by an occupancy ladder, and
   its own single-supplement ladder. The per-person card needs all of it per room,
   because a night can mix this property's room types and each is contracted
   separately — see roomTypePricing.js. */
const roomProfileOf = (rate) => {
  const { singleBuy, sharingBuy } = rateNumbers(rate);
  return {
    rate,
    singleBuy,
    sharingBuy,
    /* A third adult in a room pays the room's extra-adult figure, which falls
       back to the sharing rate when the contract states none. */
    extraAdultBuy: parseF(rate?.price_3_plus_adults) > 0 ? parseF(rate?.price_3_plus_adults) : sharingBuy,
    flat: String(rate?.rate_basis || '') === 'per_room'
      || (parseF(rate?.unit_price) > 0 && !parseF(rate?.price_2_adults)),
    /* A villa on an occupancy ladder has no single supplement and no child
       discount: the room's own occupant count picks the band and every head in it
       pays that figure. */
    occupancyPriced: isOccupancyTiered(rate),
    singleLadder: normaliseSingleSupplementLadder(rate),
    singleSuppBase: baseSingleSupplement(rate, sharingBuy, singleBuy)
  };
};

/* The adult / child split of one non-accommodation line.
   Returns null for anything that is not child-priced, for a party with no children
   and for a line whose contracted figures cannot be read - the caller then charges
   the whole party at sellPP in the sharing row, exactly as it always has.

   The scale is fitted to the line's own sellPP, so the two rows re-add to the day
   total even when the season or the markup this breakdown resolves differs from
   the one the line was priced with. */
const nonAccommodationChildSplit = ({ sv, pp, list, rateBy, T }) => {
  if (!chargesChildRate({ category: sv.category, basis: sv.basis })) return null;
  const children = list.filter((t) => !isAdultTraveller(t));
  if (!children.length) return null;
  const rate = rateBy(sv.itemId, sv.item_rates, sv.dayDate);
  if (!rate) return null;
  /* The rate row is authoritative about how it bills: a per-unit extra was
     bought as one service, so no head on it - adult or child - has a price. */
  if (isFlatBasis(rate.rate_basis)) return null;
  const item = {
    category: sv.category,
    child_age_ranges: Array.isArray(rate._ageRanges) ? rate._ageRanges : []
  };
  const adultBuy = parseF(rate.price_1_adult) || parseF(rate.unit_price) || 0;
  if (adultBuy <= 0) return null;
  const childBuys = children.map((child) => {
    const figure = childFigureForLine(rate, item, Number(child.age), adultBuy);
    return figure === null ? adultBuy : figure;
  });
  const adultsCount = Math.max(0, list.length - children.length);
  const expectedBuy = (adultBuy * adultsCount) + childBuys.reduce((sum, buy) => sum + buy, 0);
  if (expectedBuy <= 0) return null;
  const scale = (pp * T) / expectedBuy;
  return {
    adultSell: adultBuy * scale,
    childDeltas: childBuys.map((buy) => (buy - adultBuy) * scale)
  };
};

/* Per-currency per-person pricing breakdown.

   Deductive model (rows are additive and reconcile to the room-charges total):
     - Per person sharing: the base everyone would pay if all travellers shared
       accommodation at the sharing rate, plus all non-accommodation services. A
       child pays the adult rate on a service that sells space (a seat, a berth, a
       place on a tour); on the services bought per head - meals, entries, extras -
       the child's own contracted figure comes off this row into Per child.
     - Single supplement: single-occupancy rooms pay the single rate instead of
       the sharing rate, i.e. (single − sharing) per single room. When the
       contract carries a single-supplement ladder the supplement follows the
       room's ordinal instead: waived singles (tier supplement 0) add nothing,
       later tiers add the amount entered in the library item, and rooms beyond
       the ladder add the base supplement. The ordinal counts client singles per
       accommodation line, in the same order the room engine prices them.
     - Per child: children sharing with adults are charged the child rate where
       one exists (including an explicit 0 = free child); the child figure is
       the sharing base plus the per-child child-rate difference, for the room
       and for any per-head service that contracts a child price.

   Every room is priced from the contract of the room TYPE its allocation names -
   a Family Suite beside two Standard Rooms costs three different figures - and
   the resolution is shared with the room engine (roomTypePricing.js), so the two
   cannot quote different nights. A third adult pays that room's extra-adult
   figure and a flat room is charged once, as the engine charges them.

   `services` are normalized entries:
     { category, currencyCode, sellPP, taxRate, itemId, roomAllocations, markup }
   `rateBy(itemId)` resolves the rate ROW the line is priced from, for
   accommodation and for the per-head categories that carry a child figure.
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
    if (sv.guideOnly === true || sv.guide_only === true
      || !/accommodation/i.test(String(sv.category || ''))) {
      /* A meal, an entry or an extra is bought per head, so the child on the
         party has their own price and the invoice has to show it. The line's
         sellPP is the MIXED average the engine charged, so the adult figure and
         each child figure are scaled back onto it: the rows keep reconciling to
         the day total while the child row stops reading as the adult price.
         Every other non-accommodation category sells space and stays whole in
         the sharing row, exactly as it is charged. */
      const childSplit = nonAccommodationChildSplit({ sv, pp, list, rateBy, T });
      if (childSplit) {
        add(childSplit.adultSell * T, taxRate, 'sharing');
        childSplit.childDeltas.forEach((delta) => add(delta, taxRate, 'childD'));
        return;
      }
      add(pp * T, taxRate, 'sharing');
      return;
    }

    const rate = sv.itemId ? rateBy(sv.itemId, sv.item_rates, sv.dayDate) : null;
    const ageRanges = Array.isArray(rate?._ageRanges) ? rate._ageRanges : [];
    const lineProfile = roomProfileOf(rate);
    const { sharingBuy } = lineProfile;
    const rooms = Array.isArray(sv.roomAllocations) && sv.roomAllocations.length ? sv.roomAllocations : null;
    /* Children in their own room price at adult rates or one single room rate
       (property contract), so the breakdown must not show child discounts the
       room engine never gave. */
    const ownRoomPolicy = String(sv.children_own_room_policy || sv.childrenOwnRoomPolicy || 'child_rates');

    /* Selling scale: the item's markup when known (builder saves it on the
       service / itinerary day item); otherwise inferred from the contracted
       room buy total (`sellPP x T / contractBuy`) so the rows reconcile to the
       day-line; last resort the sellPP/selling ratio. */
    let scale;
    const markupPct = Number(sv.markup) || 0;
    if (markupPct > 0 && sharingBuy > 0) {
      scale = 1 + markupPct / 100;
    } else if (rooms && sharingBuy > 0) {
      const buy = calculateRoomCharges({ item_rates: [rate], child_age_ranges: ageRanges, children_own_room_policy: ownRoomPolicy }, rooms, undefined, 0).totalBuy;
      const allocatedPax = rooms.reduce(
        (count, room) => count + (Array.isArray(room.allocatedTravellers) ? room.allocatedTravellers.length : 0),
        0
      );
      scale = buy > 0 ? (pp * (allocatedPax || T)) / buy : (sharingBuy > 0 ? pp / sharingBuy : 1);
    } else {
      scale = sharingBuy > 0 ? pp / sharingBuy : 1;
    }
    const sellOf = (buy) => (buy > 0 ? buy * scale : pp);

    if (!rooms) {
      add(sellOf(sharingBuy) * T, taxRate, 'sharing');
      return;
    }

    /* Each room is priced from the contract of the room TYPE its allocation
       names, not from the single row the line was sold at: a night with a Family
       Suite beside two Standard Rooms charges three different contracts. The
       resolution goes through the same helper the room engine uses, so the two
       engines cannot disagree about which row a bed is priced from, and a row
       with no type stamp behaves exactly as it did before. */
    const typedProfiles = new Map();
    const profileForRoom = (rm) => {
      const resolved = rateForAllocatedRoom(rate, rm);
      if (resolved.reason) return { profile: lineProfile, reason: resolved.reason };
      if (!resolved.rate || resolved.rate === rate) return { profile: lineProfile, reason: '' };
      if (!typedProfiles.has(resolved.rate)) typedProfiles.set(resolved.rate, roomProfileOf(resolved.rate));
      return { profile: typedProfiles.get(resolved.rate), reason: resolved.reason };
    };
    let singleOrdinal = 0;

    const isStaffRoom = (rm, occs) => {
      const soloTourLeader = occs.length === 1 && normaliseTravellerRole(occs[0]?.role) === 'tour_leader';
      const hasGuide = occs.some((t) => normaliseTravellerRole(t?.role) === 'tour_guide');
      const staff = (rm?.roomType === 'staff' || rm?.isStaffRoom === true) && !soloTourLeader;
      return soloTourLeader || hasGuide || staff;
    };

    rooms.forEach((rm) => {
      const occs = Array.isArray(rm.allocatedTravellers) ? rm.allocatedTravellers : [];
      const occ = occs.length;
      if (!occ) return;
      const { profile: p, reason: typeRefusal } = profileForRoom(rm);
      /* A room this season does not price was charged nothing by the room engine
         either, so it contributes nothing here and the rows keep re-adding to
         the day line. */
      if (typeRefusal) return;
      const bands = Array.isArray(p.rate?._ageRanges) && p.rate._ageRanges.length ? p.rate._ageRanges : ageRanges;
      const sharingSell = sellOf(p.sharingBuy);
      const singleSell = sellOf(p.singleBuy);
      const childSellFor = (t) => {
        const c = childRateForAge(p.rate, parseF(t?.age), bands, p.sharingBuy);
        return c.known && p.sharingBuy > 0 ? c.rate * scale : null;
      };
      const childOccs = occs.filter((t) => !isAdultTraveller(t));
      const staffRoom = isStaffRoom(rm, occs);
      /* A children-only client room under a children-own-room policy prices at
         adult rates, so its occupants are presented like adults below. */
      const childOnlyAsAdult = !staffRoom && childOccs.length === occ && ownRoomPolicy === 'adult_rates';
      const childOnlySingleRoom = !staffRoom && childOccs.length === occ && ownRoomPolicy === 'single_room_rate';

      if (p.occupancyPriced && !staffRoom) {
        const bandRate = occupancyRateForPax(p.rate, occ);
        add(bandRate === null ? pp * occ : bandRate * occ * scale, taxRate, 'sharing');
        return;
      }

      if (occ === 1) {
        if (staffRoom) {
          add(sharingSell, taxRate, 'sharing');
          return;
        }
        /* Only paying-client singles consume a ladder slot; a solo child does
           too, matching the room engine. Flat rooms are priced per room and are
           excluded from the ladder. */
        if (!p.flat) singleOrdinal += 1;
        if (!childOccs.length || childOnlyAsAdult) {
          add(sharingSell, taxRate, 'sharing');
          /* A ladder is quoted in library (buy) figures and has to be scaled;
             the plain gap between the single and sharing rates is already a
             selling figure, so scaling it again would mark the supplement up
             twice and stop the summary re-adding to the day line. */
          const supplement = !p.flat && p.singleLadder.length
            ? singleSupplementForOrdinal(p.singleLadder, p.singleSuppBase, singleOrdinal) * scale
            : singleSell - sharingSell;
          add(supplement, taxRate, 'single');
        } else if (childOnlySingleRoom) {
          /* One single room rate for the whole room: no supplement ladder. */
          add(sharingSell, taxRate, 'sharing');
          add(singleSell - sharingSell, taxRate, 'single');
        } else {
          add(sharingSell, taxRate, 'sharing');
          const childSell = childSellFor(childOccs[0]);
          if (childSell !== null) {
            add(childSell - sharingSell, taxRate, 'childD');
          } else if (!p.flat && p.singleLadder.length) {
            const supplement = singleSupplementForOrdinal(p.singleLadder, p.singleSuppBase, singleOrdinal);
            add(supplement * scale, taxRate, 'single');
          }
        }
        return;
      }

      if (p.flat) {
        /* One charge for the whole room, however many sleep in it. */
        add(sharingSell, taxRate, 'sharing');
        return;
      }
      if (childOnlySingleRoom) {
        /* The property charges one single room rate for the children-only room. */
        add(singleSell, taxRate, 'sharing');
        return;
      }
      /* Every head in the room pays the sharing figure first, exactly as the room
         engine charges it, and the contract's deviations come off that base: an
         adult beyond the second pays the room's extra-adult figure instead, and a
         child with a contracted child rate pays that. A child with no child rate
         already sits in the base at the sharing figure. */
      const adultHeads = childOnlyAsAdult ? occ : occ - childOccs.length;
      const extraAdults = Math.max(0, adultHeads - 2);
      add(occ * sharingSell + extraAdults * (sellOf(p.extraAdultBuy) - sharingSell), taxRate, 'sharing');
      if (childOnlyAsAdult) return;
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
    /* The document needs the head count to express the party-only rows (the
       supplement is the whole party's money) per person, so it travels with the
       rows instead of every caller re-counting the party. */
    childrenCount,
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

/* The same money expressed for ONE traveller, which is what a per-person
   document prints.

   Two of the engine's rows are not per-head to start with: the single
   supplement is the whole party's supplement bill, and each child is billed
   once for that child, not once per head. Both are converted here - the
   supplement spread over every head in the party, each child's price above the
   sharing base multiplied by the children and then spread the same way - so
   that the rows add down the page to that traveller's total instead of mixing
   one person's rate with the party's bill.

   Labels are returned as dictionary keys plus their numbers; the document
   supplies the words and the currency format. */
export const perPersonHeadBreakdown = (r) => {
  if (!r) return null;
  const heads = Math.max(1, Number(r.totalCount) || 1);
  const rows = [{
    key: 'doc.perPersonSharing',
    incl: r.perPersonSharing.sell,
    tax: r.perPersonSharing.tax
  }];
  if (r.hasSingle) {
    rows.push({
      key: 'doc.singleSupplementPerPerson',
      incl: (Number(r.singleSupplement.sell) || 0) / heads,
      tax: (Number(r.singleSupplement.tax) || 0) / heads
    });
  }
  if (r.hasChildren && r.perChild) {
    const kids = Math.max(1, Number(r.childrenCount) || 1);
    rows.push({
      key: 'doc.childRateAdjustment',
      count: kids,
      each: round2(r.perChild.sell - r.perPersonSharing.sell),
      eachTax: round2(r.perChild.tax - r.perPersonSharing.tax),
      incl: ((r.perChild.sell - r.perPersonSharing.sell) * kids) / heads,
      tax: ((r.perChild.tax - r.perPersonSharing.tax) * kids) / heads
    });
  }
  /* Rounding happens before the total is taken, so the column a reader adds down
     the page is the column that answers with the total per person. The cent a
     split leaves behind belongs to the last row of the party's own table, not to
     this one. */
  const money = (row) => ({
    ...row,
    incl: round2(row.incl),
    tax: round2(row.tax)
  });
  const settled = rows.map(money);
  const total = money({
    key: 'doc.totalPerPerson',
    incl: settled.reduce((sum, row) => sum + row.incl, 0),
    tax: settled.reduce((sum, row) => sum + row.tax, 0),
    total: true
  });
  return { heads, rows: settled, total, rowsWithTotal: settled.concat([total]) };
};