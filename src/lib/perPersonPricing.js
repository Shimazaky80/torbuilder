import { round2, vatOfInclusive, numOr } from './invoiceDoc';
import { isAdultTraveller, childRateForAge, calculateRoomCharges, normaliseTravellerRole } from './roomAllocationHelper';
import { chargesChildRate, childFigureForLine, isFlatBasis } from './servicePricing';
import {
  isSurchargeItem, feeChargesPerHead, surchargeRateAmount, surchargeChildAmount
} from './surchargeFees';
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

/* The money one non-accommodation line costs EACH CHILD in its own right.
   Returns null for anything that prices no head, for a party with no children
   and for a line whose contracted figures cannot be read - the caller then charges
   the whole party at sellPP in the adults' row, exactly as it always has.

   The scale is fitted to the line's own sellPP, so the rows re-add to the day
   total even when the season or the markup this breakdown resolves differs from
   the one the line was priced with. A child the contract gives no figure of their
   own pays the adult price - and the adult price is not money specifically applied
   to a child, so it stays with the adults.

   Two contracts are read two different ways: a Meals/Tickets/Extras line states a
   child figure in its rate row, while a Fees & Tickets line states it in the fee's
   own column, which is the column its day line was charged from. */
const nonAccommodationChildSplit = ({ sv, pp, list, rateBy, T }) => {
  const children = list.filter((t) => !isAdultTraveller(t));
  if (!children.length) return null;
  const rate = rateBy(sv.itemId, sv.item_rates, sv.dayDate);
  if (!rate) return null;

  let adultBuy;
  let figures;
  if (isSurchargeItem({ category: sv.category })) {
    /* A fee quotes its figures in its own columns - an entrance fee, a ticket or
       a conservation levy each read a different cell - and the category rename
       means the head-selling gate above never sees one. Read them through the
       same accessors the day line was priced with, so a child's entrance fee
       lands on the child's row and not in the adults' money. A per-unit or
       per-vehicle fee buys a thing, not a head, so it prices no child. */
    const fee = { surcharge_type: sv.surchargeType, surcharge_unit_basis: sv.surchargeUnitBasis };
    if (!feeChargesPerHead(fee)) return null;
    adultBuy = surchargeRateAmount(rate, fee) || 0;
    if (adultBuy <= 0) return null;
    const figure = surchargeChildAmount(rate, fee);
    figures = children.map(() => figure);
  } else {
    if (!chargesChildRate({ category: sv.category, basis: sv.basis })) return null;
    /* The rate row is authoritative about how it bills: a per-unit extra was
       bought as one service, so no head on it - adult or child - has a price. */
    if (isFlatBasis(rate.rate_basis)) return null;
    adultBuy = parseF(rate.price_1_adult) || parseF(rate.unit_price) || 0;
    if (adultBuy <= 0) return null;
    const item = {
      category: sv.category,
      child_age_ranges: Array.isArray(rate._ageRanges) ? rate._ageRanges : []
    };
    figures = children.map((child) => childFigureForLine(rate, item, Number(child.age), adultBuy));
  }
  const adultsCount = Math.max(0, list.length - children.length);
  /* What the engine charged per child: their own figure where the contract states
     one, the adult figure where it does not. The scale has to be fitted to that,
     because sellPP is the average the line was actually bought at. */
  const childBuys = figures.map((figure) => (figure === null ? adultBuy : figure));
  const expectedBuy = (adultBuy * adultsCount) + childBuys.reduce((sum, buy) => sum + buy, 0);
  if (expectedBuy <= 0) return null;
  const scale = (pp * T) / expectedBuy;
  return {
    partyTotal: pp * T,
    /* A child the contract gives no figure of their own still takes the seat, so
       they carry the adult figure of this line - their money lands on their own
       row instead of quietly raising the adults'. */
    childSells: childBuys.map((buy) => buy * scale)
  };
};

/* Per-currency per-person pricing breakdown.

   Whose money is whose (the rule an operator quotes a family by):
     - Per child: what one child costs. The figure the room contract prices them at
       (or the sharing figure where the property does not split guests by age), the
       figure a per-head service (meals, entries, extras) contracts for their age,
       and their share of any charge the party shares - a car or a boat hired once
       for everyone, a seat on a transfer, a place on a tour, a room charged flat.
       A child takes a seat and a bed, so a child pays for them. The row is
       therefore always a real price, never a discount off an adult.
     - Per person sharing: what one ADULT costs - the adult figure of every room
       and service, each adult's share of the charges the party shares, and the
       money an adult contract applies and a child's does not. Adding a child to a
       quote therefore moves both rows: the child's own money and the share of the
       party charges that stops being the adults' to carry alone.
     - Single supplement: an adult in a single room pays the single rate instead of
       the sharing rate, i.e. (single − sharing) per single room. When the
       contract carries a single-supplement ladder the supplement follows the
       room's ordinal instead: waived singles (tier supplement 0) add nothing,
       later tiers add the amount entered in the library item, and rooms beyond
       the ladder add the base supplement. The ordinal counts client singles per
       accommodation line, in the same order the room engine prices them. A
       children-only room is that child's accommodation, so its whole charge -
       premium included - belongs to the child row.

   The three rows reconcile as
       adults x per person sharing + single supplement + children x per child
   equals the money the party is charged, so separating a child neither invents
   nor loses a rand.

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
   single/shared rooms. Non-accommodation services are added to the party.
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
         party has a price of their own and the invoice has to show it. The line's
         sellPP is the MIXED average the engine charged, so each child's own figure
         is scaled back onto it: the rows keep reconciling to the day total while
         the child row carries what the contract applies to that child. */
      const childSplit = nonAccommodationChildSplit({ sv, pp, list, rateBy, T });
      if (childSplit) {
        const kidsMoney = childSplit.childSells.reduce((sum, sell) => sum + sell, 0);
        add(childSplit.partyTotal - kidsMoney, taxRate, 'sharing');
        childSplit.childSells.forEach((sell) => add(sell, taxRate, 'childD'));
        return;
      }
      /* A line that prices no child of their own - a seat-selling transfer, a tour
         place, a boat or a car hired once for the party - is still money the whole
         party shares, and every traveller takes their place in it. sellPP is what
         one head costs, so each child carries it and the rest is the adults'. */
      add(pp * (T - childrenCount), taxRate, 'sharing');
      add(pp * childrenCount, taxRate, 'childD');
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
      const childOnly = !staffRoom && childOccs.length === occ;
      /* The two children-own-room policies decide the FIGURE a children-only room
         costs; either way the room is the children's own accommodation, so its
         whole charge is carried by the child row. */
      const childOnlyAsAdult = childOnly && ownRoomPolicy === 'adult_rates';
      const childOnlySingleRoom = childOnly && ownRoomPolicy === 'single_room_rate';
      /* A ladder is quoted in library (buy) figures and has to be scaled; the
         plain gap between the single and sharing rates is already a selling
         figure, so scaling it again would mark the supplement up twice and stop
         the summary re-adding to the day line. */
      const ladderSupplement = () => (!p.flat && p.singleLadder.length
        ? singleSupplementForOrdinal(p.singleLadder, p.singleSuppBase, singleOrdinal) * scale
        : singleSell - sharingSell);

      if (p.occupancyPriced && !staffRoom) {
        /* A villa on a ladder sells one figure per head in the band, so each child
           carries their own head and each adult carries theirs. */
        const bandRate = occupancyRateForPax(p.rate, occ);
        const perHead = bandRate === null ? pp : bandRate * scale;
        add(perHead * (occ - childOccs.length), taxRate, 'sharing');
        add(perHead * childOccs.length, taxRate, 'childD');
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
        if (!childOccs.length) {
          add(sharingSell, taxRate, 'sharing');
          add(ladderSupplement(), taxRate, 'single');
        } else if (childOnlyAsAdult) {
          add(sharingSell + ladderSupplement(), taxRate, 'childD');
        } else if (childOnlySingleRoom) {
          /* One single room rate for the whole room: no supplement ladder. */
          add(singleSell, taxRate, 'childD');
        } else {
          const childSell = childSellFor(childOccs[0]);
          if (childSell !== null) {
            add(childSell, taxRate, 'childD');
          } else {
            /* No child figure for this age: the room is still the child's own
               accommodation, at the sharing rate plus whatever the ladder charges
               a room of one. */
            add(sharingSell + (!p.flat && p.singleLadder.length
              ? singleSupplementForOrdinal(p.singleLadder, p.singleSuppBase, singleOrdinal) * scale
              : 0), taxRate, 'childD');
          }
        }
        return;
      }

      if (p.flat) {
        /* One charge for the whole room, however many sleep in it - but everyone
           sleeping there takes a bed in it, so each occupant carries their share
           of it and a child's share lands on the child's own row. */
        add(sharingSell * (occ - childOccs.length) / occ, taxRate, 'sharing');
        add(sharingSell * childOccs.length / occ, taxRate, 'childD');
        return;
      }
      if (childOnlySingleRoom) {
        /* The property charges one single room rate for the children-only room. */
        add(singleSell, taxRate, 'childD');
        return;
      }
      /* Every head in the room pays the sharing figure first, exactly as the room
         engine charges it, and the contract's deviations replace it: an adult
         beyond the second pays the room's extra-adult figure instead, and a child
         with a contracted child rate pays that. A child with no child rate pays
         the sharing figure - their own bed, at the adult price. */
      const adultHeads = childOnlyAsAdult ? occ : occ - childOccs.length;
      const extraAdults = Math.max(0, adultHeads - 2);
      const extraAdultPremium = extraAdults * (sellOf(p.extraAdultBuy) - sharingSell);
      if (childOnlyAsAdult) {
        add(occ * sharingSell + extraAdultPremium, taxRate, 'childD');
        return;
      }
      const kidsMoney = childOccs.reduce((sum, t) => sum + (childSellFor(t) ?? sharingSell), 0);
      add((occ - childOccs.length) * sharingSell + extraAdultPremium, taxRate, 'sharing');
      if (kidsMoney > 0) add(kidsMoney, taxRate, 'childD');
    });
  });

  const adultsCount = Math.max(0, T - childrenCount);
  /* A party with no adult in it has nobody to carry the shared money, so the
     children's rows hold the whole bill. */
  const kidsCarryParty = adultsCount === 0 && childrenCount > 0;
  const adults = kidsCarryParty
    ? { incl: 0, tax: 0, excl: 0, heads: 1 }
    : { incl: sharingIncl, tax: sharingTax, excl: sharingExcl, heads: adultsCount };
  const kids = kidsCarryParty
    ? { incl: childIncl + sharingIncl, tax: childTax + sharingTax, excl: childExcl + sharingExcl }
    : { incl: childIncl, tax: childTax, excl: childExcl };

  return {
    perPersonSharing: {
      sell: round2(adults.incl / adults.heads),
      tax: round2(adults.tax / adults.heads),
      subExcl: round2(adults.excl / adults.heads)
    },
    singleSupplement: {
      sell: round2(singleIncl),
      tax: round2(singleTax),
      subExcl: round2(singleExcl)
    },
    perChild: childrenCount > 0 ? {
      sell: round2(kids.incl / childrenCount),
      tax: round2(kids.tax / childrenCount),
      subExcl: round2(kids.excl / childrenCount)
    } : null,
    hasSingle: singleIncl > 0,
    hasChildren: childrenCount > 0,
    /* The document needs the adult count to divide the party-only rows (the
       supplement is the whole party's money) per adult, and the head count to
       express the money due, so both travel with the rows instead of every caller
       re-counting the party. */
    childrenCount,
    adultsCount,
    totalCount: T
  };
};

/* Serialize a computePerPersonRows result into the JSON snapshot persisted on
   an invoice (and shown by the builder exports). Each row is one class of
   traveller's price with the number of them that pays it, so the document can
   print a quantity instead of implying every figure is everybody's. */
export const breakdownSnapshot = (r) => {
  if (!r) return null;
  const adults = Math.max(1, Number(r.adultsCount) || r.totalCount || 1);
  const rows = [{
    label: 'Per person sharing', count: adults,
    sell: r.perPersonSharing.sell, subExcl: r.perPersonSharing.subExcl, tax: r.perPersonSharing.tax
  }];
  if (r.hasSingle) rows.push({
    label: 'Single supplement', count: adults,
    sell: round2(r.singleSupplement.sell / adults),
    subExcl: round2(r.singleSupplement.subExcl / adults),
    tax: round2(r.singleSupplement.tax / adults)
  });
  if (r.perChild) rows.push({
    label: 'Per child', count: Math.max(1, Number(r.childrenCount) || 1),
    sell: r.perChild.sell, subExcl: r.perChild.subExcl, tax: r.perChild.tax
  });
  return { rows, totalCount: r.totalCount, adultsCount: r.adultsCount, hasChildren: r.hasChildren, hasSingle: r.hasSingle };
};

/* The same money expressed as the price list a document prints.

   Under the rule above, an adult's price and a child's price are different
   figures, so a column that added down one traveller's money no longer exists.
   Each row is one class of traveller: the figure that traveller pays and how
   many of them are in the party. The closing row is the party's money - what the
   day lines charged - which is what the rows multiply out to.

   Labels are returned as dictionary keys plus their numbers; the document
   supplies the words and the currency format. */
export const perPersonHeadBreakdown = (r) => {
  if (!r) return null;
  const heads = Math.max(1, Number(r.totalCount) || 1);
  const kids = Math.max(0, Number(r.childrenCount) || 0);
  const adults = Math.max(1, Number(r.adultsCount) || (heads - kids) || heads);
  const money = (row) => ({
    ...row,
    unit: round2(row.unit),
    unitTax: round2(row.unitTax),
    incl: round2(row.unit * row.count),
    tax: round2(row.unitTax * row.count)
  });
  const rows = [{ key: 'doc.perPersonSharing', count: adults, unit: r.perPersonSharing.sell, unitTax: r.perPersonSharing.tax }];
  if (r.hasSingle) {
    /* The supplement is the party's bill; the adults carry it between them. */
    rows.push({
      key: 'doc.singleSupplement',
      count: adults,
      unit: (Number(r.singleSupplement.sell) || 0) / adults,
      unitTax: (Number(r.singleSupplement.tax) || 0) / adults
    });
  }
  if (r.hasChildren && r.perChild && kids > 0) {
    rows.push({ key: 'doc.perChild', count: kids, unit: r.perChild.sell, unitTax: r.perChild.tax });
  }
  const settled = rows.map(money);
  /* The quantity column does the adding, so the total is the sum of the row
     money rather than a per-head average of it. */
  const total = {
    key: 'doc.partyTotal',
    count: null,
    unit: null,
    unitTax: null,
    incl: round2(settled.reduce((sum, row) => sum + row.incl, 0)),
    tax: round2(settled.reduce((sum, row) => sum + row.tax, 0)),
    total: true
  };
  return { heads, adults, rows: settled, total, rowsWithTotal: settled.concat([total]) };
};

/* Which column of that money the document prints for each row.

   "Per person figures only" reads the table down the head's own column: the
   quantity is 1 and the subtotal, VAT and inclusive figure are one traveller's
   money. Printing the class money there instead quotes a client a total the
   choice explicitly refuses - multiplying a class out is what the other choice
   is for. Labels stay dictionary keys; the document supplies the words. */
export const perPersonPrintRows = (r, { totals = true } = {}) => {
  const set = perPersonHeadBreakdown(r);
  if (!set) return null;
  const head = (row) => ({
    key: row.key, qty: '1', unit: row.unit,
    subExcl: round2(row.unit - row.unitTax), tax: row.unitTax, incl: row.unit
  });
  const cls = (row) => ({
    key: row.key,
    qty: row.count ? String(row.count) : '',
    unit: row.unit === null ? '' : row.unit,
    subExcl: round2(row.incl - row.tax), tax: row.tax, incl: row.incl
  });
  return {
    rows: set.rows.map(totals ? cls : head),
    /* The closing row is the party's money whenever it prints; the choice that
       stops at the figures leaves it out. */
    total: { ...cls(set.total), total: true }
  };
};