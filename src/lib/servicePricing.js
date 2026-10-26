import { resolveSeasonForTravel, applyProtectionToRate } from './priceValidity';
import { isSurchargeItem, isSurchargeChargeable, surchargeBuyTotal, surchargePricing } from './surchargeFees';
import { isGuideService, isGuideOnly } from './guidePricing';
import { allocatedTravellerCount, hasStaffAccommodation, payingClientCount, travellersPlusTlCount } from './roomAllocationHelper';

const FLAT_BASIS = new Set(['per_vehicle', 'per_trip', 'per_room', 'flat']);

const rateForItem = (item, code) => {
  const rates = Array.isArray(item?.item_rates) ? item.item_rates : [];
  const currency = String(code || '').toUpperCase();
  return rates.find((rate) => String(rate.currency || '').toUpperCase() === currency) || rates[0] || null;
};

const tierRateForPax = (rate, pax) => {
  const tiers = Array.isArray(rate?.tiered_pricing) ? rate.tiered_pricing : [];
  if (!tiers.length) return 0;
  const count = Number(pax) || 0;
  let chosen = tiers.find((tier) => {
    const minimum = parseInt(tier.min_pax, 10) || 0;
    const maximum = parseInt(tier.max_pax, 10) || 0;
    return count >= minimum && (maximum === 0 || count <= maximum);
  });
  if (!chosen) chosen = tiers[tiers.length - 1];
  const total = parseFloat(chosen?.rate) || 0;
  return count > 0 ? total / count : total;
};

const accommodationPaxRate = (rate, pax) => {
  const count = Number(pax) || 0;
  const num = (value) => parseFloat(value) || 0;
  if (String(rate?.rate_basis || '') === 'per_room') {
    const room = num(rate?.unit_price) || num(rate?.price_2_adults) || num(rate?.double_twin_rate) || num(rate?.price_1_adult) || 0;
    const single = num(rate?.single_room_rate) || num(rate?.effective_single_rate) || room;
    const total = count <= 1 ? single : room;
    return count > 0 ? total / count : total;
  }
  if (count <= 1) return num(rate?.price_1_adult) || num(rate?.single_room_rate) || num(rate?.unit_price) || 0;
  if (count === 2) return num(rate?.price_2_adults) || num(rate?.double_twin_rate) || 0;
  const sharing = num(rate?.price_2_adults) || num(rate?.double_twin_rate) || num(rate?.price_1_adult) || 0;
  const extra = num(rate?.price_3_plus_adults) > 0 ? num(rate?.price_3_plus_adults) : sharing;
  return count > 0 ? (2 * sharing + Math.max(0, count - 2) * extra) / count : 0;
};

export const contractPaxRate = (item, code, pax) => {
  const rate = rateForItem(item, code);
  const raw = rate ? parseFloat(rate.price_1_adult) || parseFloat(rate.unit_price) || 0 : 0;
  const basis = rate?.rate_basis || item?.pricing_model || 'per_person';
  const count = Number(pax) || 0;
  if (basis === 'tiered') return tierRateForPax(rate, count);
  if (basis === 'per_person_sharing') return accommodationPaxRate(rate, count);
  if (String(rate?.rate_basis || '') === 'per_room') return accommodationPaxRate(rate, count);
  if (FLAT_BASIS.has(basis)) return count > 0 ? raw / count : raw;
  return raw;
};

export const sidebarLibraryRate = (item, code, pax) => {
  const rate = rateForItem(item, code);
  const basis = rate?.rate_basis || item?.pricing_model || 'per_person';
  if (!['per_vehicle', 'per_trip', 'flat'].includes(basis)) {
    return contractPaxRate(item, code, pax);
  }
  const tierRate = parseFloat(rate?.tiered_pricing?.[0]?.rate) || 0;
  return parseFloat(rate?.price_1_adult || rate?.unit_price) || tierRate;
};

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

const isGuideLineService = (service) => isGuideService(service)
  || isGuideOnly(service)
  || !!service?.guideForKey
  || (Array.isArray(service?.guideServiceTypes) && service.guideServiceTypes.length > 0);

/* How many shares a line's per-person figure is multiplied by.
   Most lines just use the current party size. Two cases differ: a guide line's
   flat per-trip figure is shared by clients + tour leaders (never the tour
   guide), and accommodation whose rooms house staff is carried by the paying
   clients alone. A saved pax wins when present, because that is the divisor the
   stored buy/sell figures were built on. */
export const servicePax = (service, fallbackPax = 0, shareContext = null) => {
  const fallback = Math.max(0, Number(fallbackPax) || 0);
  const saved = Math.max(0, Number(service?.pax) || 0);

  if (/accommodation/i.test(String(service?.category || ''))) {
    if (hasStaffAccommodation(service?.roomAllocations)) {
      if (saved > 0) return saved;
      const paying = Number(shareContext?.payingClients) || 0;
      if (paying > 0) return paying;
    }
    const allocated = allocatedTravellerCount(service?.roomAllocations);
    if (allocated > 0) return allocated;
    return saved > 0 ? saved : fallback;
  }

  if (isGuideLineService(service)) {
    if (saved > 0) return saved;
    const divisor = Number(shareContext?.travellersPlusTl) || 0;
    return divisor > 0 ? divisor : fallback;
  }

  return fallback;
};

export const contractedServiceTotal = (service, fallbackPax = 0, shareContext = null) => {
  const pax = servicePax(service, fallbackPax, shareContext);
  return round2((Number(service?.buyPP) || 0) * Math.max(0, pax));
};

export const supplierPaymentDocumentStatus = (supplierPaid) => supplierPaid === true
  ? {
    heading: 'Proof of Payment',
    stamp: 'PAID',
    amountLabel: 'Amount paid to supplier',
    footnote: 'This document confirms that the amount stated above was paid to the supplier for the service listed.'
  }
  : {
    heading: 'Supplier Payment Record',
    stamp: 'NOT PAID',
    amountLabel: 'Contracted amount',
    footnote: 'Payment has not been confirmed as paid to the supplier. This document shows the contracted amount only and is not proof of payment.'
  };

export const repriceServicesForPax = ({
  days = [],
  libraryItems = [],
  paxCount = 0,
  childCount = 0,
  travellers = [],
  travelWindow = {},
  protectionPercent = 0
} = {}) => {
  const count = Math.max(0, Number(paxCount) || 0);
  const guideDivisor = travellersPlusTlCount(travellers) || count;
  const payingClients = payingClientCount(travellers);
  const skipped = [];
  let repriced = 0;
  if (!count) return { days, skipped };

  const updatedDays = (Array.isArray(days) ? days : []).map((day) => ({
    ...day,
    services: (Array.isArray(day.services) ? day.services : []).map((service) => {
      /* A guide line and its guide-&-driver detail lines are a flat per-trip
         figure split across the party, not a per-person library rate. Re-split
         the same flat total over the new party size so a pax change neither
         inflates the guide nor repriced it off the library. */
      const isGuideLine = (Array.isArray(service.guideServiceTypes) && service.guideServiceTypes.length > 0)
        || service.guideOnly === true || service.guide_only === true || !!service.guideForKey;
      if (isGuideLine && Number(service.buyPP) > 0) {
        const flatTotal = (Number(service.buyPP) || 0) * (Number(service.pax) || count || 1);
        const divisor = guideDivisor > 0 ? guideDivisor : 1;
        const buyPP = round2(flatTotal / divisor);
        const guideMarkup = Number(service.markup) || 0;
        repriced += 1;
        return {
          ...service,
          buyPP,
          sellPP: round2(buyPP * (1 + guideMarkup / 100)),
          pax: divisor
        };
      }

      /* Staff rooms are absorbed by the paying clients: re-split the same
         contracted accommodation total across the clients alone. A line with
         no staff rooms keeps its allocated divisor untouched. */
      if (/accommodation/i.test(String(service.category || ''))) {
        const storedPax = Number(service.pax) || 0;
        if (!hasStaffAccommodation(service.roomAllocations) || payingClients <= 0
          || !storedPax || storedPax === payingClients) {
          return service;
        }
        const flatTotal = (Number(service.buyPP) || 0) * storedPax;
        const buyPP = round2(flatTotal / payingClients);
        const accommodationMarkup = Number(service.markup) || 0;
        repriced += 1;
        return {
          ...service,
          buyPP,
          sellPP: round2(buyPP * (1 + accommodationMarkup / 100)),
          pax: payingClients
        };
      }

      if (!service.itemId || Number(service.pax) === count) {
        return service;
      }

      const item = libraryItems.find((entry) => String(entry.id) === String(service.itemId));
      if (!item || !Array.isArray(item.item_rates) || !item.item_rates.length) {
        skipped.push(service.name || 'Unnamed service');
        return service;
      }

      const currencyCode = service.currencyCode || item.currency || '';
      const season = resolveSeasonForTravel({
        rates: item.item_rates,
        currencyCode,
        startDate: travelWindow.start,
        endDate: travelWindow.end,
        protectionPercent
      });
      if (!season.rate) {
        skipped.push(service.name || item.name || 'Unnamed service');
        return service;
      }

      const rate = season.protectionPercent
        ? applyProtectionToRate(season.rate, season.protectionPercent)
        : season.rate;
      const pricedItem = { ...item, item_rates: [rate] };
      const markup = Number(service.markup) || 0;

      if (isSurchargeItem(item)) {
        const chargeable = typeof service.surchargeChargeable === 'boolean'
          ? service.surchargeChargeable
          : isSurchargeChargeable(item);
        const { unitBasis, total } = surchargeBuyTotal({
          rate,
          item,
          paxCount: count,
          childCount,
          nights: 1
        });
        const priced = surchargePricing({ buyTotal: total, markupPercent: markup, chargeable });
        repriced += 1;
        return {
          ...service,
          basis: unitBasis,
          buyPP: round2(priced.buy / count),
          sellPP: round2(priced.sell / count),
          pax: count,
          surchargeUnitBasis: unitBasis,
          surchargePassedThrough: priced.passedThrough,
          surchargeReference: round2(priced.reference || 0)
        };
      }

      const buyPP = round2(contractPaxRate(pricedItem, currencyCode, count));
      const basis = rate.rate_basis || item.pricing_model || 'per_person';
      repriced += 1;
      return {
        ...service,
        basis,
        buyPP,
        sellPP: round2(buyPP * (1 + markup / 100)),
        pax: count,
        item_rates: [rate],
        priceProtectionPercent: season.protectionPercent || 0,
        protectedSeasonName: season.protectionPercent ? season.seasonName : '',
        seasonName: season.seasonName || '',
        seasonValidFrom: season.validFrom || '',
        seasonValidTo: season.validTo || ''
      };
    })
  }));

  return { days: updatedDays, repriced, skipped };
};
