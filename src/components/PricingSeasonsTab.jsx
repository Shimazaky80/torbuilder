import { useMemo, useState } from 'react';
import { CalendarDays, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  accommodationRatesForTrip,
  vehicleColumnPools,
  vehicleVectorPrice
} from '../lib/packagePricing';

const MAX_COLUMNS = 6;

const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
const money = (value, code = 'ZAR') => `${code} ${round(value).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const seatsOf = (code, vehicleTypes = []) => Number((vehicleTypes || []).find((type) => type?.code === code)?.max_capacity) || 0;
const nameOf = (code, vehicleTypes = []) => (vehicleTypes || []).find((type) => type?.code === code)?.name || code;
const basisLabelOf = (basis) => ({
  per_person: 'per person',
  per_person_sharing: 'per person sharing',
  per_room: 'per room',
  per_vehicle: 'per vehicle',
  per_trip: 'per trip',
  per_unit: 'per unit',
  per_adult: 'per adult',
  per_child: 'per child',
  tiered: 'by pax count'
}[basis] || 'per person');
const seasonLabel = (period, index) => period?.name?.trim() || `Season ${index + 1}`;
const dateLabel = (date) => {
  if (!date) return '';
  const [, month, day] = String(date).split('-');
  return `${day} ${Number(month)}`;
};

export const PricingSeasonsTab = ({
  vehicleTypes = [],
  periods = [],
  onAddPeriod,
  onChangePeriod,
  onRemovePeriod,
  days = [],
  library = [],
  childRange,
  acceptsChildren = false,
  currency = 'ZAR',
  childBreakdown,
  onRefreshService,
  refreshInProgress = false,
  slots = [],
  usedCodes = [],
  bands = {},
  changeSlot,
  changeBand,
  activeSeason = 0,
  setActiveSeason,
  accommodationPerPerson = null,
  derivedAccommodation = { total: null, rows: [], derived: false, unresolved: [] },
  derivedSingleSupplement = { total: null, rows: [], derived: false, unresolved: [] }
}) => {
  const [tripFrom, setTripFrom] = useState('');
  const [tripTo, setTripTo] = useState('');
  const [refreshedKeys, setRefreshedKeys] = useState({});

  const pool = useMemo(
    () => vehicleColumnPools({ days, library, vehicleTypes }),
    [days, library, vehicleTypes]
  );

  const hasTripDates = Boolean(tripFrom && tripTo);
  const resolvedSeason = useMemo(() => {
    if (!hasTripDates) return null;
    return (periods || []).find((period) =>
      period.valid_from && period.valid_to &&
      String(period.valid_from) <= String(tripTo) && String(period.valid_to) >= String(tripFrom)
    ) || null;
  }, [periods, tripFrom, tripTo, hasTripDates]);

  const activePeriod = resolvedSeason || periods[activeSeason] || null;
  const activePeriodIndex = resolvedSeason ? -1 : activeSeason;

  /* The single supplement is shown for whichever season is active. A season's own figure,
     when the operator has locked one, wins; otherwise it is derived from the accommodation
     lines so a reader always gets a number. It is a room charge, so only accommodation
     contributes and no other line in the package is counted. */
  const hasSupplementOverride = activePeriod?.single_supplement != null && activePeriod.single_supplement !== 0;
  const singleSupplement = hasSupplementOverride
    ? Number(activePeriod.single_supplement)
    : (derivedSingleSupplement.total ?? 0);
  const supplementDerived = !hasSupplementOverride && derivedSingleSupplement.total != null;

  const sharedPoolOf = (code) => Number(pool.pools[code]) || 0;

  /* The accommodation lines, resolved one at a time against the trip dates. Each lodge
     prices off its own contract windows, so the resolution runs per line (D15/D16). */
  const accommodationLines = useMemo(() => {
    const rows = [];
    let dayIndex = -1;
    for (const day of days || []) {
      dayIndex += 1;
      (day?.services || []).forEach((service, serviceIndex) => {
        if (service?.is_included === false) return;
        const item = (library || []).find((entry) => entry.id === service.item_id);
        if (!item || !/accommodation/i.test(String(item.category || service.category || ''))) return;
        rows.push({ service, item, dayIndex, serviceIndex });
      });
    }
    return rows;
  }, [days, library]);

  const accommodationResolutions = useMemo(() => accommodationLines.map(({ service, item }) => ({
    ...accommodationRatesForTrip(service, item, tripFrom, tripTo),
    item,
    service
  })), [accommodationLines, tripFrom, tripTo]);

  const allServices = useMemo(() => {
    const rows = [];
    (days || []).forEach((day, dayIndex) => {
      (day?.services || []).forEach((service, serviceIndex) => {
        if (service?.is_included === false) return;
        const item = (library || []).find((entry) => entry.id === service.item_id);
        rows.push({ service, item, dayIndex, serviceIndex });
      });
    });
    return rows;
  }, [days, library]);

  const markRefreshed = (key) => setRefreshedKeys((previous) => ({ ...previous, [key]: true }));
  const refreshOne = (row) => {
    onRefreshService(row.dayIndex, row.serviceIndex);
    markRefreshed(`${row.dayIndex}:${row.serviceIndex}`);
    setTimeout(() => setRefreshedKeys((previous) => ({ ...previous, [`${row.dayIndex}:${row.serviceIndex}`]: false })), 2500);
  };
  const refreshAll = () => {
    if (!allServices.length || refreshInProgress) return;
    allServices.forEach((row) => {
      onRefreshService(row.dayIndex, row.serviceIndex);
      markRefreshed(`${row.dayIndex}:${row.serviceIndex}`);
    });
    setTimeout(() => setRefreshedKeys({}), 2500);
  };

  const vehiclePills = (row) => {
    const rate = row.service?.rate_snapshot && Object.keys(row.service.rate_snapshot).length
      ? row.service.rate_snapshot
      : (row.item?.item_rates || []).find((entry) => entry.id === row.service.rate_id);
    const basis = String(rate?.rate_basis || row.service?.rate_basis || row.item?.pricing_model || '').toLowerCase();
    if (/accommodation/i.test(String(row.item?.category || row.service?.category || ''))) {
      return <span className="ps-pill ps-pill-season">priced from the season</span>;
    }
    if (basis === 'per_vehicle' && rate?.prices_by_vehicle && Object.keys(rate.prices_by_vehicle).length) {
      return usedCodes.length ? <span className="ps-pills">{usedCodes.map((code) => {
        const cell = vehicleVectorPrice(rate.prices_by_vehicle, code);
        return <span key={code} className={`ps-pill ${cell === null ? 'ps-pill-none' : ''}`}>
          {nameOf(code, vehicleTypes)}: {cell === null ? 'not priced' : money(cell, row.service.currency_code || currency)}
        </span>;
      })}</span> : <span className="ps-pill ps-pill-none">no vehicle columns chosen</span>;
    }
    return <span className="ps-pill">{basisLabelOf(basis)}</span>;
  };

  const basisBadge = (row) => {
    const rate = row.service?.rate_snapshot && Object.keys(row.service.rate_snapshot).length
      ? row.service.rate_snapshot
      : (row.item?.item_rates || []).find((entry) => entry.id === row.service.rate_id);
    return <span className={`ps-basis ps-basis-${String(rate?.rate_basis || row.service?.rate_basis || row.item?.pricing_model || 'per_person').toLowerCase().replace(/_/g, '-')}`}>
      {basisLabelOf(rate?.rate_basis || row.service?.rate_basis || row.item?.pricing_model)}
    </span>;
  };

  return <div className="ps">
    <section className="package-tab-panel ps-seasons">
      <h2><CalendarDays size={19} /> Seasons</h2>
      <p>A season is a header, not a copy: it points at the same service rows and stores only the two numbers that vary inside the year &mdash; accommodation and the single supplement. Everything else is the annual grid below.</p>
      <div className="ps-season-strip">
        {(periods || []).map((period, index) => <button
          key={`season-${index}`}
          type="button"
          className={`ps-chip ${activeSeason === index && !resolvedSeason ? 'on' : ''}`}
          onClick={() => { setActiveSeason(index); setTripFrom(''); setTripTo(''); }}
        >
          <span className="ps-chip-name">{seasonLabel(period, index)}</span>
          <span className="ps-chip-dates">{period.valid_from ? `${dateLabel(period.valid_from)} – ${dateLabel(period.valid_to)}` : 'dates needed'}</span>
        </button>)}
        <button type="button" className="ps-chip ps-chip-add" onClick={() => { onAddPeriod(); setActiveSeason(periods.length); }}><Plus size={13} /> Add season</button>
      </div>
      {activePeriod && <div className="ps-season-editor">
        <div className="ps-season-editor-head"><h3>{resolvedSeason ? 'Resolved season' : 'Editing season'}</h3>
          {resolvedSeason && <span className="ps-badge">resolved from the trip dates</span>}</div>
        <div className="ps-season-editor-grid">
          <label><span>Name</span><input type="text" value={activePeriod?.name || ''} placeholder={`Season ${(activePeriodIndex < 0 ? periods.findIndex((p) => p === activePeriod) : activePeriodIndex) + 1}`} onChange={(event) => activePeriodIndex >= 0 && onChangePeriod(activePeriodIndex, 'name', event.target.value)} /></label>
          <label><span>Starts</span><input type="date" value={activePeriod?.valid_from || ''} onChange={(event) => activePeriodIndex >= 0 && onChangePeriod(activePeriodIndex, 'valid_from', event.target.value)} /></label>
          <label><span>Ends</span><input type="date" value={activePeriod?.valid_to || ''} onChange={(event) => activePeriodIndex >= 0 && onChangePeriod(activePeriodIndex, 'valid_to', event.target.value)} /></label>
          <label><span>Accommodation per person <small>sharing</small></span><input type="number" min="0" step="0.01" value={activePeriod?.accommodation_per_person ?? ''} placeholder={derivedAccommodation.total != null ? `derived: ${money(derivedAccommodation.total, currency)}` : 'derived from the season below'} onChange={(event) => activePeriodIndex >= 0 && onChangePeriod(activePeriodIndex, 'accommodation_per_person', event.target.value === '' ? null : Number(event.target.value))} /></label>
          <label><span>Single supplement <small>per person</small></span><input type="number" min="0" step="0.01" value={activePeriod?.single_supplement ?? ''} placeholder={derivedSingleSupplement.total != null ? `derived: ${money(derivedSingleSupplement.total, currency)}` : '0.00'} onChange={(event) => activePeriodIndex >= 0 && onChangePeriod(activePeriodIndex, 'single_supplement', event.target.value === '' ? null : Number(event.target.value))} /></label>
        </div>
        {!resolvedSeason && <button type="button" className="ps-icon-button" aria-label={`Remove ${seasonLabel(activePeriod, activePeriodIndex)}`} onClick={() => onRemovePeriod(activePeriodIndex)}><Trash2 size={15} /> Remove this season</button>}
      </div>}
      <div className="ps-trip">
        <span className="ps-trip-label">Trip dates</span>
        <input type="date" value={tripFrom} onChange={(event) => setTripFrom(event.target.value)} />
        <span className="ps-trip-arrow">&rarr;</span>
        <input type="date" value={tripTo} onChange={(event) => setTripTo(event.target.value)} />
        {hasTripDates && <span className="ps-trip-res">
          {resolvedSeason
            ? <>resolved package season: <b>{seasonLabel(resolvedSeason, periods.findIndex((p) => p === resolvedSeason))}</b></>
            : <>no package season covers these dates</>}
        </span>}
      </div>
      <p className="ps-note">The grid keeps the same annual prices whatever season is chosen &mdash; only the amber and pink rows, the overlay and the accommodation resolution change.</p>
    </section>

    <section className="package-tab-panel ps-grid-panel">
      <h2>Vehicle &times; traveller grid</h2>
      <p>Up to {MAX_COLUMNS} columns. Vehicle sizes come from Settings and can only be used once each &mdash; the column is the size, not the supplier. Prices are annual and locked per line; editing the grid never rewrites the package.</p>
      {!usedCodes.length && <p className="ps-empty">No vehicle types are set up in Settings yet. Add vehicle sizes there to price this grid.</p>}
      {!!usedCodes.length && <div className="ps-grid-scroll">
        <table className="ps-grid">
          <thead>
            <tr>
              <th className="ps-grid-label">Vehicle</th>
              {slots.map((code, index) => <th key={`slot-${index}`} className="ps-veh-head">
                <select value={code || ''} onChange={(event) => changeSlot(index, event.target.value)}>
                  <option value="">&mdash; empty column &mdash;</option>
                  {(vehicleTypes || []).map((type) => <option key={type.code} value={type.code} disabled={usedCodes.includes(type.code) && type.code !== slots[index]}>{type.name} &middot; {Number(type.max_capacity) || 0} seats</option>)}
                </select>
                {code && <div className="ps-veh-meta"><span>{seatsOf(code, vehicleTypes)} seats</span><span>column {index + 1}</span></div>}
              </th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="ps-grid-label">Travel season</td>
              <td colSpan={slots.length}>
                <div className="ps-datecell">
                  <div className="ps-datecell-lbl">{activePeriod ? `${seasonLabel(activePeriod, activePeriodIndex)} · applies to every vehicle column` : 'No season set'}</div>
                  <div className="ps-datecell-val">{activePeriod?.valid_from ? `${activePeriod.valid_from} → ${activePeriod.valid_to}` : '\u2014'}</div>
                  <div className="ps-datecell-hint">Driven by the accommodation &mdash; lodges are what change dates inside a year. Vehicles have no dates of their own.</div>
                </div>
              </td>
            </tr>
            <tr>
              <td className="ps-grid-label">Travellers<small>pax per band</small></td>
              {slots.map((code, index) => <td key={`band-${index}`}>{code ? <div className="ps-bands">{(bands[code] || []).map((pax, bandIndex) => <div className="ps-band" key={`band-${index}-${bandIndex}`}>
                <div className="ps-band-pax"><input type="number" min={Math.min(seatsOf(code, vehicleTypes) || 2, 2)} max={seatsOf(code, vehicleTypes)} value={pax} onChange={(event) => changeBand(code, bandIndex, event.target.value)} /><span className="ps-band-unit">pax</span></div>
              </div>)}</div> : null}</td>)}
            </tr>
            <tr>
              <td className="ps-grid-label">Price per person<small>unit pool &divide; pax + per-person</small></td>
              {slots.map((code, index) => <td key={`price-${index}`}>{code ? <div className="ps-bands">{(bands[code] || []).map((pax, bandIndex) => {
                const each = sharedPoolOf(code) / pax;
                return <div className="ps-band" key={`price-${index}-${bandIndex}`}>
                  <div className="ps-price">{money(each + pool.perPersonFixed, currency)}</div>
                  <div className="ps-formula">{money(each, currency)} + {money(pool.perPersonFixed, currency)}</div>
                </div>;
              })}</div> : null}</td>)}
            </tr>
            <tr>
              <td className="ps-grid-label">Accommodation<small>per person sharing</small></td>
              <td colSpan={slots.length}>
                <div className="ps-flat-cell ps-flat-accom">{accommodationPerPerson != null ? money(accommodationPerPerson, currency) : '\u2014'}
                  <span className="ps-flat-from">same for every vehicle column · switches with the season{accommodationPerPerson != null && activePeriod?.accommodation_per_person == null && derivedAccommodation.rows.length ? ` · derived from ${derivedAccommodation.rows.map((row) => row.name).join(', ')}` : ''}</span>
                </div>
              </td>
            </tr>
            <tr>
              <td className="ps-grid-label">Single supplement</td>
              <td colSpan={slots.length}>
                <div className="ps-flat-cell ps-flat-amber">{money(singleSupplement, currency)}
                  {supplementDerived && <span className="ps-stamp ps-stamp-ok">derived</span>}
                  {activePeriod?.single_supplement != null && <span className="ps-stamp">locked on the season</span>}
                  <span className="ps-flat-from">per person · identical for every vehicle column · charged only on the accommodation · switches with the season</span>
                </div>
              </td>
            </tr>
            <tr>
              <td className="ps-grid-label">Child price</td>
              <td colSpan={slots.length}>
                <div className="ps-flat-cell ps-flat-child">
                  {!acceptsChildren
                    ? 'Children are not accepted on this package'
                    : !childRange
                      ? 'No child age range set on the Children &amp; ages tab'
                      : money(childBreakdown?.childAccommodation ?? 0, currency)}
                  <span className="ps-flat-from">accommodation child rate from the library item for the resolved season · for every other line the child pays the adult price shown above</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>}
      <p className="ps-note">Traveller bands are seeded from the vehicle size in Settings: <b>step = round(size &divide; 3)</b>, bands <b>[step, 2&times;step, size]</b>. The smallest vehicle gets two bands. The pickers are free &mdash; override per package.</p>
    </section>

    <section className="package-tab-panel ps-overlay-panel">
      <h2>Season overlay &mdash; the only thing a season changes</h2>
      <p>Accommodation is the one line whose price moves inside the year. The vehicle &amp; service pool never moves with a season.</p>
      <div className="ps-overlay">
        <div className="ps-ov">
          <h4>Accommodation &amp; park fees <span className="ps-stamp ps-stamp-chg">changes</span></h4>
          <div className="ps-ov-big">{accommodationPerPerson != null ? money(accommodationPerPerson, currency) : '\u2014'}
            {activePeriod?.accommodation_per_person == null && derivedAccommodation.total != null && <span className="ps-stamp ps-stamp-ok">derived</span>}
            {activePeriod?.accommodation_per_person != null && <span className="ps-stamp">locked on the season</span>}
          </div>
          <div className="ps-ov-note">Per person, sharing, for the {activePeriod ? <b>{seasonLabel(activePeriod, activePeriodIndex)}</b> : 'active'} season.
            {activePeriod?.accommodation_per_person == null
              ? (derivedAccommodation.total != null
                ? <> Read off the accommodation line{derivedAccommodation.rows.length === 1 ? '' : 's'}: <b>{derivedAccommodation.rows.map((row) => row.name).join(', ')}</b>. Override it in the editor to lock the season's own figure.</>
                : (derivedAccommodation.rows.length ? <>Every accommodation in the season must resolve a rate &mdash; check the resolution below.</> : <>No accommodation in this package. Add one on the Itinerary tab, or enter a figure here.</>))
              : 'Locked on this season; clear the field to read it from the accommodation again.'}</div>
        </div>
        <div className="ps-ov">
          <h4>Single supplement <span className="ps-stamp ps-stamp-chg">changes</span></h4>
          <div className="ps-ov-big">{money(singleSupplement, currency)}
            {supplementDerived && <span className="ps-stamp ps-stamp-ok">derived</span>}
            {activePeriod?.single_supplement != null && <span className="ps-stamp">locked on the season</span>}
          </div>
          <div className="ps-ov-note">Per person, <b>full width &mdash; identical for every vehicle column</b>, and charged only on the accommodation &mdash; every other line is shared unit cost. Shown for {activePeriod ? <b>{seasonLabel(activePeriod, activePeriodIndex)}</b> : 'the active season'}.
            {activePeriod?.single_supplement == null
              ? (derivedSingleSupplement.total != null
                ? <> Read off the accommodation line{derivedSingleSupplement.rows.length === 1 ? '' : 's'}: <b>{derivedSingleSupplement.rows.map((row) => row.name).join(', ')}</b>. Override it in the editor to lock the season's own figure.</>
                : ' Enter a figure here to publish a supplement.')
              : ' Locked on this season; clear the field to read it from the accommodation again.'}</div>
        </div>
        <div className="ps-ov ps-ov-locked">
          <h4>Unit pool (vehicle + shared)<span className="ps-stamp ps-stamp-same">annual</span></h4>
          <div className="ps-ov-big">{usedCodes.length ? money(sharedPoolOf(usedCodes[0]), currency) : '\u2014'}</div>
          <div className="ps-ov-note">Shared by vehicle column, divided by traveller count. Transfers, game drives, meals &mdash; annual, never per season. Pool of the first column.</div>
        </div>
      </div>
    </section>

    <section className="package-tab-panel ps-resolve-panel">
      <h2>Accommodation season resolution</h2>
      <p>When a trip straddles an accommodation&rsquo;s own rate boundary, the higher rate is charged for every night &mdash; never split, never first-night.</p>
      {!hasTripDates
        ? <p className="ps-empty">Enter trip dates above to resolve each lodge&rsquo;s contract season.</p>
        : accommodationResolutions.length
          ? <div className="ps-breakdown-table-wrap"><table className="ps-svc-table"><thead><tr><th>Accommodation</th><th>Contract seasons</th><th>Resolution for these dates</th></tr></thead>
            <tbody>
              {accommodationResolutions.map(({ item, service, rates, overlapping, chosen }) => <tr key={item.id || service.item_id}>
                <td>{service.item_name || item.name}</td>
                <td>{rates.length ? rates.map((rate) => <span key={rate.id} className={`ps-pill ${rate.covers ? 'ps-pill-on' : ''}`}>{rate.name}{rate.from ? ` · ${rate.from}` : ''}{rate.to ? ` → ${rate.to}` : ''}</span>) : <span className="ps-pill ps-pill-none">no contract windows</span>}</td>
                <td>{!overlapping.length
                  ? <span className="ps-pill ps-pill-none">no rate covers these dates</span>
                  : chosen
                    ? <span className="ps-pill ps-pill-on">{overlapping.length > 1 ? `straddles ${overlapping.length} seasons → ` : ''}{chosen.name} at {money(chosen.sharing, service.currency_code || currency)}/night{overlapping.length > 1 ? ' for all nights' : ''}</span>
                    : <span className="ps-pill ps-pill-none">unresolved</span>}
                </td>
              </tr>)}
            </tbody>
          </table></div>
          : <p className="ps-empty">No accommodation in this package.</p>}
    </section>

    <section className="package-tab-panel ps-services-panel">
      <h2>Services &mdash; locked snapshot</h2>
      <p>Prices are written on the package when the line is added and stay locked until you press <i>Update from library</i>. Supplier changes never move a saved package on their own.</p>
      {!allServices.length && <p className="ps-empty">Add services on the Itinerary tab to see their locked rates.</p>}
      {!!allServices.length && <div className="ps-breakdown-table-wrap"><table className="ps-svc-table">
        <thead><tr><th>Service</th><th>Cost basis</th><th>Vehicle prices</th><th>Season</th><th>Snapshot</th></tr></thead>
        <tbody>
          {allServices.map((row) => {
            const key = `${row.dayIndex}:${row.serviceIndex}`;
            const rate = row.service?.rate_snapshot && Object.keys(row.service.rate_snapshot).length
              ? row.service.rate_snapshot
              : (row.item?.item_rates || []).find((entry) => entry.id === row.service.rate_id);
            const accommodation = /accommodation/i.test(String(row.item?.category || row.service?.category || ''));
            const windows = accommodation && row.item
              ? accommodationRatesForTrip(row.service, row.item, null, null).rates
              : [];
            return <tr key={`svc-${key}`}>
              <td><b>{row.service.item_name || row.item?.name || 'Service'}</b><small>day {row.dayIndex + 1}{row.item?.supplier_name ? ` · ${row.item.supplier_name}` : ''}</small></td>
              <td>{basisBadge(row)}</td>
              <td>{vehiclePills(row)}</td>
              <td>{accommodation
                ? (windows.length
                  ? <span className="ps-pills">{windows.map((rate) => <span key={`${rate.id}-${rate.from || 'open'}-${rate.to || 'open'}`} className="ps-pill ps-pill-season">{rate.name}{rate.from ? ` · ${rate.from}` : ''}{rate.to ? ` → ${rate.to}` : ''}</span>)}</span>
                  : <span className="ps-pill ps-pill-none">seasonal · no contract windows</span>)
                : <span className="ps-pill">annual</span>}</td>
              <td><div className="ps-snapshot">
                <span className={`ps-badge ${refreshedKeys[key] ? 'ps-badge-ok' : ''}`}>{refreshedKeys[key] ? 'updated' : rate?.id ? 'locked snapshot' : 'live library rate'}</span>
                <button type="button" className="ps-icon-button ps-refresh" title="Update this line from the library rate" disabled={refreshInProgress} onClick={() => refreshOne(row)}><RefreshCw size={14} /></button>
              </div></td>
            </tr>;
          })}
        </tbody>
      </table></div>}
      {!!allServices.length && <div className="ps-services-footer">
        <span>Which supplier is cheaper is decided here, at the line &mdash; not in the vehicle picker or by the season.</span>
        <button type="button" className="secondary-btn" disabled={refreshInProgress} onClick={refreshAll}><RefreshCw size={14} /> Update all from library</button>
      </div>}
    </section>
  </div>;
};