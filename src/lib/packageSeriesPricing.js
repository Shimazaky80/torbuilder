import {
  calculatePackageTravellerBreakdown,
  packageBandPax,
  packageBandPriceColumns,
  packageBandSuggestions,
  packageChildAgeRange,
  packageCurrencyFor,
  packageRateForDates,
  packageTierDays,
  packageValidityWindows
} from './packagePricing';
import { contractTypeForTourType, normalizeRateType, ratesForContract } from './rateTypes';

/* The three prices a series sells are not typed in: they are the package's own
   figures for its smallest pax band in its first active season. This module is
   the one place that turns the package data into those figures, so the series
   form and any later importer cannot quietly pick a different band or season.

   The currency is the package's. No figure from another currency is ever added
   here: one band's breakdown is one currency, and the three numbers are copied
   out of it rather than combined with a second column. */

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const hasFigure = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

const dayOf = (iso) => {
  const text = String(iso || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return Date.UTC(Number(text.slice(0, 4)), Number(text.slice(5, 7)) - 1, Number(text.slice(8, 10)));
};

/* The season behind the figures. A package has no status column on its validity
   rows, so "active" means a complete window containing today; an operator who
   has only published future windows still gets the earliest one rather than no
   price at all. */
const activePeriod = (periods = [], today = '') => {
  const windows = packageValidityWindows(periods).sort((left, right) => left.fromDay - right.fromDay);
  if (!windows.length) return null;
  const now = dayOf(today) ?? dayOf(new Date().toISOString().slice(0, 10));
  if (now !== null) {
    const current = windows.find((window) => window.fromDay <= now && window.toDay >= now);
    if (current) return current;
  }
  return windows[0];
};

/* Narrow the library to the contract the package sells under and to the season
   that is active. A line with a locked snapshot still prices from that snapshot
   inside the engine; this only chooses which library row stands behind a line
   that has no snapshot, exactly as the builder's season resolution does. */
const libraryForPeriod = (library = [], period, contractType) => (Array.isArray(library) ? library : []).map((item) => {
  let rates = Array.isArray(item?.item_rates) ? item.item_rates : [];
  if (contractType) rates = ratesForContract(rates, contractType);
  if (period) {
    const covering = packageRateForDates(
      { ...item, item_rates: rates },
      [{ valid_from: period.from, valid_to: period.to }],
      contractType
    );
    if (covering) rates = [covering];
  }
  return { ...item, item_rates: rates };
});

/* Saved pax options are the bands the operator sells. A package with no saved
   band can still price from the capacities its vehicles suggest, but if there
   is no band at all there is no price point to derive. */
const bandsFor = (bands = [], days = [], library = []) => {
  const seen = new Set();
  const saved = (Array.isArray(bands) ? bands : [])
    .map((band) => ({ ...band, pax: packageBandPax(band) }))
    .sort((left, right) => left.pax - right.pax)
    .filter((band) => !seen.has(band.pax) && seen.add(band.pax));
  if (saved.length) return saved;
  return packageBandSuggestions(days, library).map((pax) => ({ pax }));
};

const PRICE_LABELS = ['price per person sharing', 'single supplement', 'child price'];

export const deriveSeriesPricesFromPackage = ({
  pkg = {},
  days = [],
  library = [],
  periods = [],
  bands = [],
  vehicleTypes = [],
  tourTypes = [],
  today = ''
} = {}) => {
  const currency = String(pkg.currency_code || packageCurrencyFor(days)).toUpperCase() || 'ZAR';
  const period = activePeriod(periods, today);
  /* An explicit "any contract" tour type resolves to '' and must stay open: it
     is an answer, not a missing one. Only a package with no tour type inherits
     the older rate_type. */
  const hasTourType = Boolean(String(pkg.tour_type ?? '').trim());
  const contractType = hasTourType
    ? contractTypeForTourType(tourTypes, pkg.tour_type)
    : normalizeRateType(pkg.rate_type);
  const pricedLibrary = libraryForPeriod(library, period, contractType);
  const childRange = packageChildAgeRange(Array.isArray(pkg.child_age_ranges) ? pkg.child_age_ranges[0] : null);
  const chosenBands = bandsFor(bands, days, pricedLibrary);

  const missing = new Set();
  let column = null;
  if (!chosenBands.length) {
    PRICE_LABELS.forEach((label) => missing.add(label));
  } else {
    const breakdown = chosenBands.map((band) => {
      const pax = packageBandPax(band);
      return {
        ...band,
        pax,
        pricing: calculatePackageTravellerBreakdown({
          days: packageTierDays(days, band, pricedLibrary),
          library: pricedLibrary,
          childRange,
          vehicleTypes,
          markupPercent: 0,
          pattern: { pax }
        })
      };
    });
    /* The first band can be a saved placeholder nobody priced. Take the smallest
       band that actually has a sharing price; if none does, keep the smallest so
       the caller can show the missing-price hint instead of silently quoting 0. */
    const priced = breakdown.filter((band) => (
      band.pricing?.servable !== false && Number(band.pricing?.adultSharingTotal) > 0
    ));
    column = packageBandPriceColumns(priced.length ? priced : breakdown)[0] || null;
  }

  const figure = (value, label) => {
    if (!column || !hasFigure(value)) {
      missing.add(label);
      return 0;
    }
    return round2(value);
  };

  const sharingPrice = figure(column?.perPerson, PRICE_LABELS[0]);
  const singleSupplementPrice = figure(column?.singleSupplement, PRICE_LABELS[1]);
  const childPrice = figure(column?.child, PRICE_LABELS[2]);
  const absent = [...missing];

  return {
    packageId: pkg.id || '',
    currency,
    period: period ? `${period.from} – ${period.to}` : '',
    pax: column?.pax ?? null,
    sharingPrice,
    singleSupplementPrice,
    childPrice,
    missing: absent,
    hint: absent.length
      ? `This package does not define ${absent.join(', ')}. Those figures are shown as 0 until the package is priced.`
      : ''
  };
};

export default deriveSeriesPricesFromPackage;
