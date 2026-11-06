import { useState } from 'react';
import { BedDouble, Package, X } from 'lucide-react';
import {
  accommodationRoomChoices,
  accommodationSeasonChoices,
  coverageNote,
  ESTIMATE_COVERAGE,
  rateOptionLabel,
  seasonChoiceLabel,
  weekendDaysLabel,
  weekendPriceOf
} from '../lib/accommodationOptions';
import { chargeNameOf, extrasChargeGroups } from '../lib/extrasChargeTypes';
import { collapseOccupancyLadder, isOccupancyTiered } from '../lib/occupancyPricing';
import {
  roomCapacityOf,
  roomForRate,
  roomMatchesRate,
  roomOccupancyForRate,
  roomTypeKeyOf,
  roomTypeNameOf
} from '../lib/roomTypes';
import { rateHasPrice, rateTravelCoverage } from '../lib/priceValidity';

/* One accommodation can be contracted at several charge types - room only, bed
   & breakfast, half board, full board with activities - and a season is priced
   at several of them. A drop is asked which season this booking falls in and,
   within that season, which charge type prices the line.

   An extra is offered the same way: one fuel contract that sells 5 litres, a
   full tank and a different fuel again is three charges on one library item, not
   three items. The picker is the same because the shape is the same — a season
   priced at several named charges, the name held on the row's meal_plan — but
   with no rooms, night bands or weekend prices to scope, so those parts of the
   dialog simply have nothing to say.

   Every season is always listed, with its exact window and how that window sits
   against the travel dates. Filtering to only the covering seasons left the
   dialog empty for a trip that falls before the next contracted season, while
   Apply stayed enabled on a hidden row - the operator could not see what price
   they were adding. A non-covering window is still selectable, but it is marked
   as an estimate and the button says so. */

const money = (value, code) => `${code} ${(Number(value) || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const priceOf = (rate) => (
  Number(rate?.unit_cost) || Number(rate?.price_2_adults) || Number(rate?.price_1_adult)
  || Number(rate?.unit_price) || 0
);

/* A villa ladder prices a PARTY SIZE, not a room, so it carries a column of
   numbers instead of the single figure these rows usually show. The rate column
   prints the range a party can land in and the note names the sizes, so a ladder
   is never read as one price - or as R0.00 because no adult column was filled in. */
const occupancyBands = (rate) => collapseOccupancyLadder(rate);
const occupancyRangeLabel = (rate, code) => {
  const bands = occupancyBands(rate);
  if (!bands.length) return money(0, code);
  const low = Math.min(...bands.map((band) => band.rate));
  const high = Math.max(...bands.map((band) => band.rate));
  return low === high ? money(low, code) : `${money(low, code)} \u2013 ${money(high, code)}`;
};
const occupancySizesLabel = (rate) => occupancyBands(rate)
  .map((band) => (band.minPax === band.maxPax ? `${band.minPax}` : `${band.minPax}-${band.maxPax}`))
  .join(', ');

const coverageHeadline = (status) => {
  switch (status) {
    case 'covers':
      return 'matches the travel dates';
    case 'starts_after':
      return 'starts after the travel dates';
    case 'ends_before':
      return 'ended before the travel dates';
    case 'starts_during':
    case 'ends_during':
      return 'covers only part of the travel dates';
    case 'undated':
      return 'no validity dates';
    default:
      return 'travel dates not set';
  }
};

export default function AccommodationChargeModal({
  item,
  currency = 'ZAR',
  travelStart = '',
  travelEnd = '',
  defaultRateId = '',
  variant = 'accommodation',
  onConfirm,
  onCancel
}) {
  const isExtras = variant === 'extras';
  const rooms = isExtras ? [] : accommodationRoomChoices(item);
  const seasonGroupsOf = (room) => (isExtras ? extrasChargeGroups(item) : accommodationSeasonChoices(item, room));
  const rateBy = new Map((item?.item_rates || []).map((rate) => [rate.id, rate]));
  const coverageOf = (rateId) => rateTravelCoverage(rateBy.get(rateId), travelStart, travelEnd);
  const isEstimateWindow = (coverage) => ESTIMATE_COVERAGE.includes(coverage?.status);
  /* One row per nightly price. A charge type priced at several night bands
     offers several rows, all under the one charge type. */
  const bandsOfOption = (option) => (
    Array.isArray(option?.bands) && option.bands.length
      ? option.bands
      : [{ rateId: option?.rateId, label: '', hasPrice: option?.hasPrice }]
  );
  const bandsOfRoom = (room) => seasonGroupsOf(room)
    .flatMap((season) => season.options.flatMap(bandsOfOption));
  /* A weekend price rides on the same row as the normal nightly figure, on the
     nights the property calls weekend, so it is stated beside the rate rather
     than offered as another charge type. */
  const weekendNote = (rate) => {
    const days = weekendDaysLabel(rate);
    const price = weekendPriceOf(rate);
    return days && price !== null ? ` \u00b7 weekend ${days} ${money(price, currency)}` : '';
  };
  const hasWeekendRates = (item?.item_rates || []).some((rate) => weekendNote(rate) !== '');
  /* An extra sells either the service or the seat on it, and the figure on the
     row means different money in each case — the dialog has to say which. */
  const extrasBasisNote = (rate) => (String(rate?.rate_basis || item?.pricing_model || '') === 'per_unit'
    ? 'per service'
    : 'per person');

  /* Prefer the row the builder already resolved for these dates, when it belongs
     to the room being priced. When there is none, prefer a covering priced row,
     then the nearest future season (which is what a pre-season trip will be
     estimated from), then any priced row. */
  const chooseDefaultRate = (room) => {
    const defaultRate = defaultRateId ? rateBy.get(defaultRateId) : null;
    if (defaultRate && (!room || !rooms.length || roomMatchesRate(room, defaultRate))) {
      return defaultRateId;
    }
    const priced = bandsOfRoom(room).filter((band) => band.hasPrice);
    const covering = priced.find((band) => {
      const status = coverageOf(band.rateId).status;
      return status === 'covers' || status === 'open';
    });
    if (covering) return covering.rateId;
    const future = priced
      .filter((band) => coverageOf(band.rateId).status === 'starts_after')
      .sort((a, b) => String(coverageOf(a.rateId).validFrom).localeCompare(String(coverageOf(b.rateId).validFrom)))[0];
    return future?.rateId || priced[0]?.rateId || bandsOfRoom(room)[0]?.rateId || '';
  };

  const defaultRate = defaultRateId ? rateBy.get(defaultRateId) : null;
  const initialRoom = roomForRate(defaultRate, rooms) || rooms[0] || null;
  const [selectedRoomKey, setSelectedRoomKey] = useState(roomTypeKeyOf(initialRoom));
  const [selectedRateId, setSelectedRateId] = useState(() => chooseDefaultRate(initialRoom));
  const selectedRoom = rooms.find((room) => roomTypeKeyOf(room) === selectedRoomKey) || rooms[0] || null;
  const seasons = seasonGroupsOf(selectedRoom);
  const allBands = bandsOfRoom(selectedRoom);
  const hasNightBands = allBands.some((band) => band.banded);

  const switchRoom = (room) => {
    setSelectedRoomKey(roomTypeKeyOf(room));
    setSelectedRateId(chooseDefaultRate(room));
  };

  const selectedRate = rateBy.get(selectedRateId) || null;
  /* An extra's default charge is the item itself, so it pins the row and keeps
     the line's charge name blank rather than repeating the item's own name. */
  const selectedOptionLabel = isExtras
    ? chargeNameOf(selectedRate)
    : (rateOptionLabel(selectedRate, item) || 'Standard');
  const selectedCoverage = selectedRateId ? coverageOf(selectedRateId) : null;
  const selectedNeedsEstimate = isEstimateWindow(selectedCoverage);
  const canApply = !!selectedRate && rateHasPrice(selectedRate);
  const selectedOccupancy = selectedRoom
    ? {
        maxOccupancy: roomCapacityOf(selectedRoom, item?.max_occupancy),
        maxAdults: selectedRoom.maxAdults,
        maxChildren: selectedRoom.maxChildren
      }
    : roomOccupancyForRate(selectedRate, item?.max_occupancy);

  const travelNote = travelStart || travelEnd
    ? `Travel dates ${travelStart || '?'} to ${travelEnd || travelStart || '?'}`
    : 'Travel dates not set yet';

  return (
    <div className="modal-overlay service-guide-overlay">
      <div className="modal-content service-guide-modal accom-charge-modal">
        <div className="modal-header">
          <div>
            <h2>{isExtras ? 'Extra charge type' : 'Accommodation charge type'}</h2>
            <p style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '0.3rem' }}>
              {item?.name || (isExtras ? 'Extra' : 'Accommodation')} — pick the season
              {isExtras ? ' and' : ', the room, the season and, within it,'} the charge type this {isExtras ? 'extra' : 'booking'} is priced from. {travelNote}.
            </p>
          </div>
          <button className="close-btn" onClick={onCancel}><X size={20} /></button>
        </div>

        {rooms.length > 1 && (
          <div style={{ marginBottom: '0.85rem' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#64748b', marginBottom: '0.4rem' }}>
              Room type
            </div>
            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
              {rooms.map((room) => {
                const key = roomTypeKeyOf(room);
                const selected = key === selectedRoomKey;
                return (
                  <button
                    key={key || roomTypeNameOf(room)}
                    type="button"
                    onClick={() => switchRoom(room)}
                    style={{
                      padding: '0.35rem 0.75rem',
                      borderRadius: '999px',
                      cursor: 'pointer',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      border: `1px solid ${selected ? '#0d7478' : '#cbd5e1'}`,
                      background: selected ? '#f0fdfa' : '#fff',
                      color: selected ? '#0d7478' : '#475569'
                    }}
                  >
                    {roomTypeNameOf(room) || 'Room'}
                    <span style={{ fontWeight: 500, color: '#94a3b8' }}> · sleeps {roomCapacityOf(room)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="accom-charge-list">
          {seasons.map((season) => {
            const seasonCoverage = coverageOf(season.options?.[0]?.rateId);
            const seasonEstimate = isEstimateWindow(seasonCoverage);
            return (
              <div key={`${season.name}|${season.validFrom}|${season.validTo}`} className="accom-charge-option">
                <div className="accom-charge-option-head">
                  <strong>{seasonChoiceLabel(season)}</strong>
                  <span style={{ color: seasonEstimate ? '#b45309' : '#64748b', fontWeight: seasonEstimate ? 700 : 500 }}>
                    {coverageHeadline(seasonCoverage?.status)}
                  </span>
                </div>
                <div className="service-guide-type-list">
                  {season.options.map((option) => {
                    const bands = bandsOfOption(option);
                    const multipleBands = bands.length > 1;
                    return (
                      <div key={option.label} className="accom-charge-family">
                        {multipleBands && (
                          <div className="accom-charge-family-head">
                            <strong>{option.label}</strong>
                            <span>{bands.length} night bands</span>
                          </div>
                        )}
                        {bands.map((band) => {
                          const rate = rateBy.get(band.rateId);
                          const coverage = coverageOf(band.rateId);
                          return (
                            <label
                              key={band.rateId}
                              className={`service-guide-type-row ${selectedRateId === band.rateId ? 'selected' : ''} ${band.hasPrice ? '' : 'disabled'}`}
                            >
                              <input
                                type="radio"
                                name="accom-charge"
                                checked={selectedRateId === band.rateId}
                                disabled={!band.hasPrice}
                                onChange={() => setSelectedRateId(band.rateId)}
                              />
                              <span className="service-guide-type-label">
                                <strong>{multipleBands ? (band.label || 'Every stay') : option.label}</strong>
                                <small>
                                  {multipleBands ? `${option.label} · ` : ''}
                                  {band.hasPrice ? 'season rate' : 'no price on this season'}
                                  {coverage.status === 'covers' ? ' · matches travel dates' : ''}
                                  {isExtras ? ` · ${extrasBasisNote(rate)}` : ''}
                                  {isOccupancyTiered(rate)
                                    ? ` · per person per night, by pax in the room (${occupancySizesLabel(rate)} pax)`
                                    : ''}
                                  {weekendNote(rate)}
                                </small>
                              </span>
                              <span className="service-guide-type-rate">
                                {isOccupancyTiered(rate) ? occupancyRangeLabel(rate, currency) : money(priceOf(rate), currency)}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {hasNightBands && (
          <p className="accom-night-band-note">
            This room is contracted at more than one nightly price depending on the length of the stay.
            The itinerary applies the band that covers the nights you place; a package uses the band chosen here.
          </p>
        )}

        {hasWeekendRates && (
          <p className="accom-night-band-note">
            This room charges its contracted weekend price on the nights the property treats as weekend.
            The itinerary applies it to those dates automatically; a package quotes the standard nightly
            price because its travel dates are not fixed yet.
          </p>
        )}

        {selectedNeedsEstimate && (
          <div
            style={{
              marginTop: '0.25rem',
              background: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: '8px',
              padding: '0.65rem 0.75rem',
              color: '#92400e',
              fontSize: '0.82rem',
              lineHeight: 1.5
            }}
          >
            <strong>
              {selectedCoverage.status === 'starts_after'
                ? 'Pre-season estimate.'
                : selectedCoverage.status === 'ends_before'
                  ? 'Expired season.'
                  : 'Partial season.'}
            </strong>{' '}
            This window {coverageNote(selectedCoverage)}. No Pricing Protection is applied, and the line
            stays an estimate until the travel dates fall inside a live season.
          </div>
        )}

        <div className="form-actions">
          <button type="button" className="secondary-btn" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="primary-btn"
            disabled={!canApply}
            onClick={() => onConfirm({
              rateId: selectedRateId,
              optionLabel: selectedOptionLabel,
              allowEstimate: selectedNeedsEstimate,
              roomTypeId: selectedRoom?.id || selectedRate?.room_type_id || null,
              roomType: selectedRoom?.name || selectedRate?.room_type || '',
              roomMaxOccupancy: selectedOccupancy.maxOccupancy,
              roomMaxAdults: selectedOccupancy.maxAdults,
              roomMaxChildren: selectedOccupancy.maxChildren
            })}
          >
            {isExtras ? <Package size={16} /> : <BedDouble size={16} />} {selectedNeedsEstimate ? 'Apply estimate' : 'Apply charge type'}
          </button>
        </div>
      </div>
    </div>
  );
}
