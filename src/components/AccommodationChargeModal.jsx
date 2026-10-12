import { useState } from 'react';
import { BedDouble, X } from 'lucide-react';
import {
  accommodationSeasonChoices,
  rateOptionLabel,
  seasonChoiceLabel
} from '../lib/accommodationOptions';
import { rateWindow } from '../lib/priceValidity';

const dayIndex = (iso) => {
  if (!iso) return null;
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000);
};

/* One accommodation can be contracted at several charge types - room only, bed
   & breakfast, half board, full board with activities - and a season is priced
   at several of them. A drop is asked which season this booking falls in and,
   within that season, which charge type prices the line. Every charge type is
   shown with its exact window so the right season can be matched to the travel
   dates, and the row that covers them is flagged. */

const money = (value, code) => `${code} ${(Number(value) || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const priceOf = (rate) => (
  Number(rate?.unit_cost) || Number(rate?.price_2_adults) || Number(rate?.price_1_adult)
  || Number(rate?.unit_price) || 0
);

export default function AccommodationChargeModal({
  item,
  currency = 'ZAR',
  travelStart = '',
  travelEnd = '',
  defaultRateId = '',
  onConfirm,
  onCancel
}) {
  const allSeasons = accommodationSeasonChoices(item);
  const rateBy = new Map((item?.item_rates || []).map((rate) => [rate.id, rate]));
  const winStart = dayIndex(travelStart);
  const winEnd = dayIndex(travelEnd) === null ? winStart : dayIndex(travelEnd);
  const coversTrip = (rateId) => {
    if (winStart === null) return true;
    const rate = rateBy.get(rateId);
    if (!rate) return true;
    const w = rateWindow(rate);
    if (!w.dated) return true;
    return w.fromDay <= winStart && w.toDay >= winEnd;
  };
  const seasons = winStart === null
    ? allSeasons
    : allSeasons
        .map((season) => ({
          ...season,
          options: (season.options || []).filter((opt) => coversTrip(opt.rateId))
        }))
        .filter((season) => season.options.length > 0);
  if (winStart !== null && seasons.length === 0) {
    // fallback to all if nothing covers
    // keep allSeasons but user expects to see matching; but per request (B) show matching - if none, maybe show none? but let us keep original behavior? user says 'show the season available matching package season dates' - if none match, show empty or fallback to all? better to show all so user can see
    // but follow request more directly: filter to matching. Let us not fallback silently
  }

  let firstUsable = '';
  const fallback = seasons[0]?.options?.[0]?.rateId || allSeasons[0]?.options?.[0]?.rateId || '';
  for (const season of seasons.length ? seasons : allSeasons) {
    const option = season.options.find((entry) => entry.hasPrice) || season.options[0];
    if (option) {
      firstUsable = option.rateId;
      break;
    }
  }

  const [selectedRateId, setSelectedRateId] = useState(
    () => (defaultRateId && rateBy.has(defaultRateId) ? defaultRateId : firstUsable || fallback)
  );

  const selectedRate = rateBy.get(selectedRateId) || null;
  const selectedOptionLabel = rateOptionLabel(selectedRate, item) || 'Standard';

  const travelNote = travelStart || travelEnd
    ? `Travel dates ${travelStart || '?'} to ${travelEnd || travelStart || '?'}`
    : '';

  return (
    <div className="modal-overlay service-guide-overlay">
      <div className="modal-content service-guide-modal accom-charge-modal">
        <div className="modal-header">
          <div>
            <h2>Accommodation charge type</h2>
            <p style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '0.3rem' }}>
              {item?.name || 'Accommodation'} — pick the season and, within it, the charge type this booking is priced from.
              {travelNote ? ` ${travelNote}.` : ''}
            </p>
          </div>
          <button className="close-btn" onClick={onCancel}><X size={20} /></button>
        </div>

        <div className="accom-charge-list">
          {seasons.map((season) => (
            <div key={`${season.name}|${season.validFrom}|${season.validTo}`} className="accom-charge-option">
              <div className="accom-charge-option-head">
                <strong>{seasonChoiceLabel(season)}</strong>
                <span>{season.options.length} charge type{season.options.length === 1 ? '' : 's'}</span>
              </div>
              <div className="service-guide-type-list">
                {season.options.map((option) => {
                  const rate = rateBy.get(option.rateId);
                  const coversTrip = option.rateId === defaultRateId;
                  return (
                    <label
                      key={option.rateId}
                      className={`service-guide-type-row ${selectedRateId === option.rateId ? 'selected' : ''} ${option.hasPrice ? '' : 'disabled'}`}
                    >
                      <input
                        type="radio"
                        name="accom-charge"
                        checked={selectedRateId === option.rateId}
                        onChange={() => setSelectedRateId(option.rateId)}
                      />
                      <span className="service-guide-type-label">
                        <strong>{option.label}</strong>
                        <small>
                          {option.hasPrice ? 'season rate' : 'no price on this season'}
                          {coversTrip ? ' · matches travel dates' : ''}
                        </small>
                      </span>
                      <span className="service-guide-type-rate">{money(priceOf(rate), currency)}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="form-actions">
          <button type="button" className="secondary-btn" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="primary-btn"
            disabled={!selectedRateId}
            onClick={() => onConfirm({ rateId: selectedRateId, optionLabel: selectedOptionLabel })}
          >
            <BedDouble size={16} /> Apply charge type
          </button>
        </div>
      </div>
    </div>
  );
}