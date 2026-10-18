import { useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronUp } from 'lucide-react';
import { accommodationPerPersonForSeason, accommodationRoomCapacity, presentationPricingColumns, singleSupplementForSeason, vehicleColumnPools } from '../lib/packagePricing';

/* Presentation reads the same grid the operator priced on the Pricing & seasons tab — same
   columns, same bands — but with the vehicle row stripped out: a client never needs to know
   a vehicle size, only the price for their party. Every season is stacked as its own table. */
const DEFAULT_COLUMNS = 4;

const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
const money = (value, code = 'ZAR') => `${code} ${round(value).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const seasonLabel = (period, index) => period?.name?.trim() || `Season ${index + 1}`;

export const PricingSummaryTab = ({
  vehicleTypes = [],
  periods = [],
  days = [],
  library = [],
  slots = [],
  bands = {},
  currency = 'ZAR',
  childBreakdown
}) => {
  const [showAll, setShowAll] = useState(false);

  const usedCodes = useMemo(() => slots.filter(Boolean), [slots]);
  const hasMore = usedCodes.length > DEFAULT_COLUMNS;
  const visibleCodes = showAll ? usedCodes : usedCodes.slice(0, DEFAULT_COLUMNS);

  const pool = useMemo(
    () => vehicleColumnPools({ days, library, vehicleTypes }),
    [days, library, vehicleTypes]
  );

  /* The occupancy a room sleeps, read from the package's own accommodation so an odd party
     is spread across the same rooms the engine allocates. Falls back to a double. */
  const roomCapacity = useMemo(() => accommodationRoomCapacity({ days, library }), [days, library]);

  /* Every season is its own table, stacked one under the next. The vehicle pool and the
     party sizes never move with the season, so between tables only each season's own
     accommodation figure and its single supplement change. A party that cannot fill every
     room pays the single supplement for the lone room, spread over its members, so the
     price on each column already includes that party's share of it. */
  /* A child only ever changes the price through the accommodation, and the buyer wants to
     know what adding one costs before anyone has declared a range, so the child price is
     always carried on the table. It is priced off the 0-18 range when none is set. */
  const childPrice = Number(childBreakdown?.childTotal) || 0;
  const seasons = periods.length ? periods : [null];

  return <div className="ps ps-summary">
    <section className="package-tab-panel ps-summary-panel">
      <h2><CalendarDays size={19} /> Presentation pricing</h2>
      <p>What a traveller pays, per person, for each season. Each column is one priced option for the party sizes above it &mdash; pick the column that holds your traveller count.</p>
      {!usedCodes.length && <p className="ps-empty">No vehicle columns are set up yet. Add them on the Pricing &amp; seasons tab to see prices here.</p>}
      {!!usedCodes.length && seasons.map((period, seasonIndex) => {
        const accommodation = period?.accommodation_per_person != null && period.accommodation_per_person !== 0
          ? Number(period.accommodation_per_person)
          : (accommodationPerPersonForSeason({ days, library, from: period?.valid_from || null, to: period?.valid_to || null }).total ?? 0);
        /* The supplement is derived from the accommodation's own contract when the season
           carries no override, so a buyer always reads a figure rather than a zero that
           looks like nothing is charged for a single room. The override still wins. */
        const singleSupplement = (period?.single_supplement != null && period.single_supplement !== 0)
          ? Number(period.single_supplement)
          : (singleSupplementForSeason({ days, library, from: period?.valid_from || null, to: period?.valid_to || null }).total ?? 0);
        const columns = presentationPricingColumns({
          codes: visibleCodes,
          bands,
          pools: pool.pools,
          perPersonFixed: pool.perPersonFixed,
          accommodation,
          singleSupplement,
          roomCapacity
        });
        const columnsFor = (code) => columns.filter((column) => column.code === code);
        return <div className="ps-grid-scroll" key={`ps-season-${seasonIndex}`}>
        <table className="ps-grid ps-summary-grid">
          <tbody>
            <tr>
              <td className="ps-grid-label">Travel season<small>full width</small></td>
              <td colSpan={visibleCodes.length}>
                <div className="ps-datecell">
                  <div className="ps-sum-season-line">{period
                    ? <>{seasonLabel(period, seasonIndex)} <span className="ps-sum-season-num">Season {seasonIndex + 1}</span></>
                    : 'No season set'}{period?.valid_from && period?.valid_to ? ` · ${period.valid_from} → ${period.valid_to}` : ''}</div>
                  <div className="ps-datecell-hint">The single supplement and the child price move with the season; each party size's price includes its share of any room left single.</div>
                </div>
              </td>
            </tr>
            <tr>
              <td className="ps-grid-label">Travellers<small>pax per option</small></td>
              {visibleCodes.map((code, index) => <td key={`sum-band-${code}-${index}`} className="ps-sum-travellers">
                <div className="ps-bands">{(bands[code] || []).map((pax, bandIndex) => <div className="ps-band" key={`sum-band-${code}-${bandIndex}`}>
                  <div className="ps-band-pax"><span className="ps-sum-pax">{pax}</span><span className="ps-band-unit">pax</span></div>
                </div>)}</div>
              </td>)}
            </tr>
            <tr>
              <td className="ps-grid-label">Price per person sharing<small>per option</small></td>
              {visibleCodes.map((code, index) => <td key={`sum-price-${code}-${index}`}>
                <div className="ps-bands">{(bands[code] || []).map((pax, bandIndex) => {
                  const each = columnsFor(code)[bandIndex]?.each ?? 0;
                  return <div className="ps-band" key={`sum-price-${code}-${bandIndex}`}>
                    <div className="ps-price">{money(each, currency)}</div>
                  </div>;
                })}</div>
              </td>)}
            </tr>
            <tr>
              <td className="ps-grid-label">Single supplement<small>full width</small></td>
              <td colSpan={visibleCodes.length}>
                <div className="ps-flat-cell ps-flat-amber">{money(singleSupplement, currency)}
                  <span className="ps-flat-from">per person · added when you want your own room · identical for every option</span>
                </div>
              </td>
            </tr>
            <tr>
              <td className="ps-grid-label">Child price<small>full width</small></td>
              <td colSpan={visibleCodes.length}>
                <div className="ps-flat-cell ps-flat-child">
                  {money(childPrice, currency)}
                  <span className="ps-flat-from">unit share + the accommodation child rate &middot; priced for a child aged 0&ndash;18 unless a range is set</span>
                </div>
              </td>
            </tr>

          </tbody>
        </table>
      </div>;
      })}
      {hasMore && <button type="button" className="ps-sum-toggle" onClick={() => setShowAll((open) => !open)}>
        {showAll ? <><ChevronUp size={14} /> Show fewer options</> : <><ChevronDown size={14} /> Show {usedCodes.length - DEFAULT_COLUMNS} more option{usedCodes.length - DEFAULT_COLUMNS === 1 ? '' : 's'}</>}
      </button>}
      {!!usedCodes.length && <p className="ps-note">The figures come from the package&apos;s own seasons. Each season is priced on its own accommodation and single supplement; the vehicle pool is shared.</p>}
    </section>
  </div>;
};