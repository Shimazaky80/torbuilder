/* The rent-a-car drop.

   A hire is not a place you visit for an hour: it is a car collected on one
   date and time and returned on another, and the money follows the gap between
   them in whole 24-hour blocks. So the drop asks for the two ends of the hire
   rather than a duration, shows the block count it worked out, and lets the
   operator pick which vehicle group from the contract fills it.

   Asked for by a package, it is usually asked a different question. A package is
   sold for a validity range, not for a departure, so its transfer component has no
   pick-up date to answer from — it has a REFERENCE LENGTH ("three rental days per
   transfer") and the tariff that runs for the dates the package is sold for. That
   is the component mode: same contract, same vehicle groups, same spec grid, and
   the hire re-prices itself every time the range or the contract moves instead of
   keeping whatever a date said once.

   Nothing here is a dead end. A group whose bands do not reach the length, or
   whose tariff does not cover the package, is still listed - with the reason beside
   it - because the way out of a refusal is to see what the contract does sell, not
   to be told to go away. */
import { useMemo, useState } from 'react';
import { Car, CalendarClock, Ruler, X } from 'lucide-react';
import SearchableSelect from './SearchableSelect';
import CarSpecGrid from './CarSpecGrid';
import { usePlaces } from '../hooks/usePlaces';
import {
  buildRentalDetails,
  carRentalGroupChoices,
  rentalDayCount
} from '../lib/carRentalPricing';
import { hireOfferChoices, referenceHireDetails } from '../lib/packageBundlePricing';

const money = (value, code) => `${code} ${(Number(value) || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const timeField = { padding: '0.35rem', fontSize: '0.85rem', width: '100%', border: '1px solid #cbd5e1', borderRadius: 7 };
/* SearchableSelect owns its own width, padding and the icon gap, so only the
   parts that do not fight that layout are passed in. */
const selectStyle = { fontSize: '0.85rem', border: '1px solid #cbd5e1', borderRadius: 7 };

const nextDay = (isoDate) => {
  if (!isoDate) return '';
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + 1);
  /* Local calendar parts, never toISOString(): in Johannesburg that reads the
     midnight back two hours to the previous UTC day and hands the dialog a return
     date equal to the pick-up date, which is a zero-day hire and no price. */
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

const ChoiceRow = ({ choice, currency, selected, onSelect }) => {
  const label = [
    choice.group.vehicleGroup ? `Group ${choice.group.vehicleGroup}` : '',
    choice.group.vehicleName,
    choice.group.passengers ? `seats ${choice.group.passengers}` : ''
  ].filter(Boolean).join(' · ') || 'Vehicle';
  /* A group sold across several seasons prices differently in each, so the row
     names the tariff the pick-up date answered from. A group with one tariff does
     not say it — there is nothing for the operator to have chosen. */
  const tariff = choice.seasons?.length > 1
    ? ` · ${choice.season ? choice.season.windowLabel : 'no season covers this date'}`
    : '';
  const price = choice.price
    ? `${money(choice.price.total, choice.price.currency || currency)} for ${choice.band.minDays}–${choice.band.maxDays ?? '∞'} day band${tariff}`
    : (choice.validity || choice.error || choice.capacityError || 'Cannot price');
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '0.75rem',
        width: '100%',
        textAlign: 'left',
        padding: '0.5rem 0.7rem',
        borderRadius: 8,
        cursor: 'pointer',
        border: selected ? '1px solid #0891b2' : choice.unusable ? '1px dashed #fca5a5' : '1px solid #e2e8f0',
        background: selected ? '#ecfeff' : '#ffffff'
      }}
    >
      <span>
        <strong style={{ fontSize: '0.82rem', color: '#0e7490' }}>{label}</strong>
        <small style={{ display: 'block', fontSize: '0.7rem', color: choice.unusable ? '#b91c1c' : '#64748b' }}>
          {price}{choice.capacityError && choice.price ? ` — ${choice.capacityError}` : ''}
        </small>
      </span>
      <span style={{ fontSize: '0.68rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>
        {choice.group.rateCode}
      </span>
    </button>
  );
};

/* One end of the hire: a town from the national place list, searched rather than
   typed. The saved value always stays in the list, so a line carrying a spot no
   town list holds - "Terminal 2 desk", or something typed before the list
   existed - still shows itself instead of blanking the field. If the place table
   has not been applied and the bundled list is unavailable, the field degrades
   to the plain text box it used to be. */
const LocationField = ({ label, value, onChange, disabled = false, places }) => {
  const rows = [...places];
  if (value && !rows.some((row) => row.place === value)) {
    rows.unshift({ place: value, province: '', altName: '' });
  }
  return (
    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: disabled ? '#94a3b8' : '#475569' }}>
      {label}
      {places.length === 0 ? (
        <input
          type="text"
          value={disabled ? '' : value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder={disabled ? 'Same as pick-up' : 'e.g. Cape Town International'}
          style={{ ...timeField, background: disabled ? '#f1f5f9' : '#ffffff' }}
        />
      ) : (
        <SearchableSelect
          value={value}
          disabled={disabled}
          allowFreeText
          style={selectStyle}
          placeholder="Start typing a town"
          aria-label={label}
          onChange={(event) => onChange(event.target.value)}
        >
          {rows.map((row) => (
            <option key={`${row.place}|${row.province}`} value={row.place} data-search={row.altName}>
              {`${row.place}${row.province ? ` — ${row.province}` : ''}`}
            </option>
          ))}
        </SearchableSelect>
      )}
    </label>
  );
};

/* A component hire answers with an offer instead of a pick-up date, but the rows,
   the spec grid and the total are the same question about the same car: what it
   costs for this length. So the answer is handed to the dialog in the shape it
   already draws, and the list itself does not change between the two modes. */
const asComponentChoice = (choice) => ({
  group: choice.group,
  seasons: choice.group.seasons,
  season: choice.offer.season || null,
  band: choice.offer.band || null,
  price: choice.offer.canPrice
    ? {
      dailyRate: choice.offer.dailyRate,
      hireTotal: choice.offer.hireTotal,
      contractFee: choice.offer.contractFee,
      total: choice.offer.total,
      currency: choice.offer.currency || 'ZAR'
    }
    : null,
  validity: choice.offer.canPrice ? null : choice.offer.message,
  error: null,
  capacityError: choice.capacityError,
  unusable: choice.unusable,
  offer: choice.offer
});

export default function CarRentalDropModal({
  item,
  currency = 'ZAR',
  defaultPickupDate = '',
  defaultPickupTime = '08:00',
  pax = 0,
  details = null,
  mode = 'itinerary',
  windows = [],
  protectionPercent = 0,
  onConfirm,
  onCancel
}) {
  /* Only a package offers the component mode, and only a package's hire defaults to
     it: an itinerary has real travel dates, and the day the car leaves the yard is
     what prices it there. */
  const componentOffered = mode === 'package';
  const [hireKind, setHireKind] = useState(() => (
    details?.referenceHire === true ? 'component' : (componentOffered ? 'component' : 'dated')
  ));
  const asComponent = componentOffered && hireKind === 'component';
  const [pickupDate, setPickupDate] = useState(details?.pickupAt?.slice(0, 10) || defaultPickupDate || '');
  const [pickupTime, setPickupTime] = useState(details?.pickupAt?.slice(11, 16) || defaultPickupTime);
  const [returnDate, setReturnDate] = useState(details?.returnAt?.slice(0, 10) || nextDay(defaultPickupDate || ''));
  const [returnTime, setReturnTime] = useState(details?.returnAt?.slice(11, 16) || defaultPickupTime);
  const [hireDays, setHireDays] = useState(() => Math.max(1, Number(details?.rentalDays) || 1));
  const [pickupLocation, setPickupLocation] = useState(
    details?.pickupLocation || item?.supplier?.city_location || item?.supplier?.city || item?.location || ''
  );
  const [returnLocation, setReturnLocation] = useState(details?.returnLocation || pickupLocation);
  const [sameReturn, setSameReturn] = useState(details ? details.sameReturn !== false : true);
  const [groupKey, setGroupKey] = useState(details
    ? [details.vehicleGroup, details.vehicleModel, details.contractType].join('|')
    : '');

  const { places } = usePlaces();
  const pickupAt = pickupDate ? `${pickupDate}T${pickupTime || '00:00'}` : '';
  const returnAt = returnDate ? `${returnDate}T${returnTime || '00:00'}` : '';
  /* Both modes end in the same number: how many whole 24-hour blocks the hire is.
     A dated hire works it out from the gap between its two stamps; a component is
     told the length, because the package it belongs to states no dates to count. */
  const days = asComponent ? hireDays : rentalDayCount(pickupAt, returnAt);
  /* The ranges as one stable string, so the choice list is not rebuilt because the
     caller handed a fresh array on a re-render. */
  const windowKey = windows.map((window) => `${window.from}..${window.to}`).join('|');
  const rangesWords = windows.map((window) => `${window.from} – ${window.to}`).join(', ');

  const choices = useMemo(
    () => (asComponent
      ? hireOfferChoices(item, { hireDays: days, windows, pax, protectionPercent }).map(asComponentChoice)
      : carRentalGroupChoices(item, { days, pickupAt, pax })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [asComponent, item, days, pickupAt, pax, protectionPercent, windowKey]
  );
  /* How many groups on this contract are actually sold across more than one
     tariff, so the dialog only talks about seasons when there is a season to pick. */
  const seasonedGroups = choices.filter((choice) => (choice.seasons || []).length > 1).length;
  const selected = choices.find((choice) => choice.group.key === groupKey)
    || choices.find((choice) => !choice.unusable && !choice.capacityError)
    || choices.find((choice) => !choice.unusable)
    || choices[0]
    || null;

  const contractFee = Number(item?.rental_contract_fee);
  const fee = Number.isFinite(contractFee) && contractFee > 0 ? contractFee : 0;
  const resolved = selected?.price || null;
  /* Seats are a hard limit, not a preference: a party of five cannot be quoted a
     two-seater, and the reason has to be the thing standing in the way rather
     than a silently accepted price. */
  const blockedBy = selected
    ? (selected.validity || selected.error || selected.capacityError || null)
    : (choices.length ? 'This contract has no vehicle groups priced.' : 'This library item has no rental rates. Add them in Library Items.');
  /* The tariffs this group is sold across that the pick-up date did not answer, so
     the operator can see the shape of the contract and change the date to reach it. */
  const otherTariffs = selected?.season && (selected.seasons || []).length > 1
    ? selected.seasons
      .filter((entry) => entry.key !== selected.season.key)
      .map((entry) => entry.windowLabel)
      .join(', ')
    : '';
  /* A component priced off a tariff that closed before the package is sold for is
     not a refusal and not a clean answer either: it is a stand-in, and it says so
     the same way a protected season does on every other line. */
  const standing = asComponent && resolved && ['protected', 'stale'].includes(selected.offer?.status)
    ? selected.offer.message
    : '';

  const confirm = () => {
    if (!selected || !resolved || blockedBy) return;
    if (asComponent) {
      onConfirm(referenceHireDetails({
        item,
        offer: selected.offer,
        source: { pickupLocation, returnLocation: sameReturn ? pickupLocation : returnLocation, sameReturn }
      }));
      return;
    }
    onConfirm(buildRentalDetails({
      item,
      group: selected.group,
      season: selected.season,
      band: selected.band,
      days,
      pickupAt,
      returnAt,
      pickupLocation,
      returnLocation: sameReturn ? pickupLocation : returnLocation,
      sameReturn,
      contractFee: fee
    }));
  };

  return (
    <div className="modal-overlay service-guide-overlay">
      <div className="modal-content service-guide-modal tall car-rental-modal">
        <div className="modal-header">
          <div>
            <h2><Car size={18} color="#06b6d4" style={{ verticalAlign: 'middle', marginRight: '0.35rem' }} /> Rent-a-car details</h2>
            <p style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '0.3rem' }}>
              {item?.name || 'Car rental'} — {asComponent
                ? 'this hire is a component of the package, so it states a length rather than dates: whole 24-hour blocks, priced off the tariff that runs for the dates the package is sold for, and re-priced whenever either of them moves.'
                : 'the hire is charged in whole 24-hour blocks between these two moments, one block on each day it covers, and the contract fee goes on a line of its own so a client can see what it came to.'}
            </p>
          </div>
          <button className="close-btn" onClick={onCancel}><X size={20} /></button>
        </div>

        <div className="modal-body">
          {componentOffered && (
            <div className="service-guide-section">
              <h3>What this hire is</h3>
              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                {[
                  { kind: 'component', icon: Ruler, title: 'A package component', words: 'a reference length, priced for the package validity dates and re-priced with them' },
                  { kind: 'dated', icon: CalendarClock, title: 'A hire with fixed dates', words: 'collected and returned on named days, priced off the tariff covering the pick-up' }
                ].map((option) => (
                  <button
                    key={option.kind}
                    type="button"
                    onClick={() => setHireKind(option.kind)}
                    aria-pressed={hireKind === option.kind}
                    style={{
                      flex: '1 1 14rem',
                      textAlign: 'left',
                      padding: '0.5rem 0.7rem',
                      borderRadius: 8,
                      cursor: 'pointer',
                      border: hireKind === option.kind ? '1px solid #0891b2' : '1px solid #e2e8f0',
                      background: hireKind === option.kind ? '#ecfeff' : '#ffffff',
                      fontSize: '0.78rem',
                      color: '#334155'
                    }}
                  >
                    <strong style={{ display: 'block', color: '#0e7490', fontSize: '0.8rem' }}>
                      <option.icon size={14} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
                      {option.title}
                    </strong>
                    {option.words}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="service-guide-section">
            <h3>Where the hire starts and ends</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
              <LocationField
                label="Pick-up location"
                value={pickupLocation}
                places={places}
                onChange={(next) => {
                  setPickupLocation(next);
                  if (sameReturn) setReturnLocation(next);
                }}
              />
              <LocationField
                label="Return location"
                value={sameReturn ? pickupLocation : returnLocation}
                disabled={sameReturn}
                places={places}
                onChange={setReturnLocation}
              />
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.76rem', fontWeight: 600, color: '#0e7490', marginTop: '0.45rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={sameReturn}
                onChange={(event) => {
                  const same = event.target.checked;
                  setSameReturn(same);
                  if (same) setReturnLocation(pickupLocation);
                }}
                style={{ width: 15, height: 15, accentColor: '#0891b2' }}
              />
              Same return — the car goes back where it was collected
            </label>
          </div>

          {asComponent ? (
            <div className="service-guide-section">
              <h3>How long one hire is</h3>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>
                Rental days per hire (24-hour blocks)
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={hireDays}
                  onChange={(event) => setHireDays(Math.max(1, Number(event.target.value) || 1))}
                  style={timeField}
                />
              </label>
              <p className="service-guide-help">
                That is <strong>{days}</strong> whole 24-hour {days === 1 ? 'day' : 'days'} on hire, every time this offer is used.
                {windows.length
                  ? <> The package is sold for {rangesWords}, so the hire is priced off the tariff that runs for all of them.</>
                  : <> This package states no validity dates yet, so the hire is priced off the contract's own first tariff — set the dates and it answers again.</>}
                {seasonedGroups > 0 && (
                  <> {seasonedGroups === 1 ? 'One group' : `${seasonedGroups} groups`} on this contract is sold
                    at different money in different seasons{windows.length ? ', so which one covers these dates is what decides the figure' : ''}.</>
                )}
              </p>
            </div>
          ) : (
            <div className="service-guide-section">
              <h3>When the car is out</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>
                  Pick-up date
                  <input type="date" value={pickupDate} onChange={(event) => setPickupDate(event.target.value)} style={timeField} />
                </label>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>
                  Pick-up time
                  <input type="time" value={pickupTime} onChange={(event) => setPickupTime(event.target.value)} style={timeField} />
                </label>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>
                  Return date
                  <input type="date" value={returnDate} onChange={(event) => setReturnDate(event.target.value)} style={timeField} />
                </label>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>
                  Return time
                  <input type="time" value={returnTime} onChange={(event) => setReturnTime(event.target.value)} style={timeField} />
                </label>
              </div>
              <p className="service-guide-help">
                {days > 0
                  ? <>That is <strong>{days}</strong> whole 24-hour {days === 1 ? 'day' : 'days'} on hire. A car back five minutes past the hour counts as another full day.</>
                  : 'Set both ends of the hire. The return has to be after the pick-up.'}
                {seasonedGroups > 0 && (
                  <> The pick-up date is also what decides <strong>which tariff</strong> each group is
                    charged at — {seasonedGroups === 1 ? 'one group' : `${seasonedGroups} groups`} on this
                    contract is sold at different money in different seasons.</>
                )}
              </p>
            </div>
          )}

          <div className="service-guide-section">
            <h3>Which vehicle from the contract</h3>
            {choices.length === 0 ? (
              <p className="service-guide-help">{blockedBy}</p>
            ) : (
              <>
                <SearchableSelect
                  value={selected?.group.key || ''}
                  onChange={(event) => setGroupKey(event.target.value)}
                  aria-label="Vehicle group for this hire"
                >
                  {choices.map((choice) => (
                    <option key={choice.group.key} value={choice.group.key}>
                      {[choice.group.vehicleGroup, choice.group.vehicleName, choice.group.passengers ? `seats ${choice.group.passengers}` : '']
                        .filter(Boolean).join(' · ') || 'Vehicle'}
                      {' — '}{choice.price ? money(choice.price.total, choice.price.currency || currency) : (choice.validity || choice.error || 'cannot price')}
                      {choice.price && (choice.seasons || []).length > 1 ? ` (${choice.season ? choice.season.windowLabel : 'no season covers this date'})` : ''}
                    </option>
                  ))}
                </SearchableSelect>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.7rem' }}>
                  {choices.slice(0, 4).map((choice) => (
                    <ChoiceRow
                      key={choice.group.key}
                      choice={choice}
                      currency={currency}
                      selected={selected?.group.key === choice.group.key}
                      onSelect={() => setGroupKey(choice.group.key)}
                    />
                  ))}
                </div>
                {selected && (
                  <div style={{ marginTop: '0.7rem', display: 'flex', gap: '0.8rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <CarSpecGrid spec={selected.group} />
                    <div style={{ fontSize: '0.7rem', color: '#64748b', maxWidth: '22rem', lineHeight: 1.45 }}>
                      <strong style={{ color: '#0e7490' }}>{selected.group.rateCode}</strong> ·
                      group {selected.group.vehicleGroup || '—'} · {selected.group.vehicleName || '—'}
                      <br />
                      {selected.group.kmsUnlimited !== false
                        ? 'Unlimited kilometres.'
                        : `${selected.group.kmsIncluded || 0} km included.`}
                      {' '}{selected.season
                        ? (asComponent
                          ? `Rental Price Validity ${selected.season.windowLabel} — the tariff that runs for ${windows.length ? `the package validity dates ${rangesWords}` : 'this package, which states no dates yet'}.${otherTariffs ? ` This group is also sold across ${otherTariffs}.` : ''}`
                          : `Rental Price Validity ${selected.season.windowLabel} — the season that covers a car collected on ${pickupDate || 'this date'}.${otherTariffs ? ` This group is also sold across ${otherTariffs}.` : ''}`)
                        : `No Rental Price Validity window on this group covers ${asComponent ? 'the dates this package is sold for' : (pickupDate || 'the date you set')}.`}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="service-guide-total">
            <span>
              This hire
              {resolved && (
                <small className="service-guide-total-detail">
                  {days} × {money(resolved.dailyRate, resolved.currency || currency)} per day
                  {(selected?.seasons || []).length > 1 && selected.season
                    ? ` off the ${selected.season.windowLabel} tariff`
                    : ''}
                  {fee > 0 ? ` + ${money(fee, resolved.currency || currency)} contract fee on its own line` : ' — no contract fee on this contract'}
                </small>
              )}
            </span>
            <strong>{resolved ? money(resolved.total, resolved.currency || currency) : '—'}</strong>
          </div>

          {blockedBy && (
            <p style={{ fontSize: '0.76rem', color: '#b45309', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '0.5rem 0.7rem', margin: '0.6rem 0 0' }}>
              {blockedBy} Pick another vehicle group, or {asComponent ? 'change the hire length or the package validity dates' : 'change the dates'}.
            </p>
          )}

          {standing && (
            <p style={{ fontSize: '0.76rem', color: '#92400e', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8, padding: '0.5rem 0.7rem', margin: '0.6rem 0 0' }}>
              {standing}
            </p>
          )}
        </div>

        <div className="form-actions">
          <button type="button" className="secondary-btn" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="primary-btn"
            disabled={!resolved || Boolean(blockedBy) || !pickupLocation.trim()}
            onClick={confirm}
          >
            <Car size={16} /> {details ? 'Update the hire' : 'Add the hire'}
          </button>
        </div>
      </div>
    </div>
  );
}
