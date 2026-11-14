import { useEffect, useId, useRef, useState } from 'react';
import { MapPin, Pencil, X } from 'lucide-react';
import SearchableSelect from './SearchableSelect';
import { useCountries } from '../hooks/useCountries';
import { usePlaces } from '../hooks/usePlaces';
import { dayRoute } from '../lib/dayDestination';
import './DayDestinationEditor.css';

const text = (value) => typeof value === 'string' ? value.trim() : '';
const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
const destinationPatch = (day) => ({
  destination_country: text(day?.destination_country),
  destination_place_id: isUuid(day?.destination_place_id) ? day.destination_place_id : null,
  destination_name: text(day?.destination_name),
  destination_region: text(day?.destination_region)
});
const destinationLabel = (day) => text(day?.destination_name)
  ? [text(day.destination_name), text(day.destination_country)].filter(Boolean).join(', ')
  : '';
/* A saved name is enough to copy, even when its catalogue row was renamed or
   removed: the day keeps the place the operator chose, and the copy keeps it too. */
const hasDestination = (day) => Boolean(text(day?.destination_name));
const placeLabel = (name, region) => [text(name), text(region)].filter(Boolean).join(' — ');
const END_MODES = ['overnight', 'visit', 'departure', 'transit'];
const END_MODE_LABELS = {
  overnight: 'Overnight',
  visit: 'Day visit',
  departure: 'Departure',
  transit: 'Transit'
};

function BulkDestinationApply({ day, days, dayIndex, locked, onApply }) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState([]);
  const panelId = useId();
  const targets = days.map((target, index) => ({ day: target, index })).filter(({ index }) => index !== dayIndex);
  const canApply = !locked && typeof onApply === 'function' && hasDestination(day);
  const indices = targets.filter(({ index }) => selected.includes(index)).map(({ index }) => index);

  return (
    <div className="day-destination-bulk">
      <button
        type="button"
        className="day-destination-button"
        aria-label="Choose days for same destination"
        aria-expanded={expanded}
        aria-controls={panelId}
        disabled={locked}
        onClick={() => { if (!locked) setExpanded(!expanded); }}
      >
        {expanded ? 'Hide' : 'Apply same destination to other days'}
      </button>
      {expanded && (
        <div id={panelId} className="day-destination-bulk-panel">
          <p>Only the destination is copied. End-of-day modes, services and prices stay unchanged.</p>
          {!hasDestination(day) && <p>Set a destination on this day before applying it to other days.</p>}
          {!targets.length && <p>No other days to select.</p>}
          <fieldset disabled={!canApply} className="day-destination-targets" aria-label="Target days for destination">
            {targets.map(({ day: target, index }) => (
              <label className="day-destination-target" key={target?.id || index}>
                <input
                  type="checkbox"
                  aria-label={`Apply destination to day ${index + 1}`}
                  checked={selected.includes(index)}
                  disabled={!canApply}
                  onChange={(event) => {
                    if (!canApply) return;
                    const checked = event.target.checked;
                    setSelected((current) => checked ? [...current, index] : current.filter((value) => value !== index));
                  }}
                />
                <span>Day {index + 1} — {destinationLabel(target) || 'Destination not set'}</span>
              </label>
            ))}
          </fieldset>
          <button
            type="button"
            className="day-destination-button day-destination-apply"
            aria-label="Apply destination to selected days"
            disabled={!canApply || !indices.length}
            onClick={() => {
              if (!canApply || !indices.length) return;
              onApply(indices, destinationPatch(day));
              setSelected([]);
              setExpanded(false);
            }}
          >
            Apply{indices.length ? ` to ${indices.length} selected ${indices.length === 1 ? 'day' : 'days'}` : ''}
          </button>
        </div>
      )}
    </div>
  );
}

export default function DayDestinationEditor({
  day = {},
  previousDay = null,
  days = [],
  dayIndex = 0,
  defaultCountry = '',
  disabled = false,
  available = true,
  onChange,
  onApply
}) {
  const [open, setOpen] = useState(false);
  const modalRef = useRef(null);
  const titleId = useId();
  const countries = useCountries();
  const country = text(day.destination_country) || text(previousDay?.destination_country) || text(defaultCountry);
  /* The catalogue is only needed while the picker is open, so a closed popup
     does not fetch a country's towns behind the day workspace. */
  const { places, loading, error } = usePlaces(available && open ? country : '');
  const locked = disabled || !available;
  const canChange = !locked && typeof onChange === 'function';
  const catalogue = places.filter((row) => isUuid(row.id) && row.country === country && text(row.place));
  const countryOptions = [...new Set([...countries, country].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en'));
  const savedId = day.destination_place_id;
  const hasSaved = Boolean(savedId || text(day.destination_name));
  const selectedRow = catalogue.find((row) => row.id.toLowerCase() === text(savedId).toLowerCase());
  const savedOnly = hasSaved && !selectedRow;
  const placeValue = selectedRow?.id || (hasSaved ? (savedId || '__saved_destination__') : '');
  const placeDisabled = !canChange || !country || loading || !catalogue.length;
  const previousLabel = destinationLabel(previousDay);
  const currentLabel = destinationLabel(day);
  const canCopyPrevious = canChange && hasDestination(previousDay);
  const endMode = END_MODES.includes(day.end_of_day) ? day.end_of_day : '';
  const statusId = useId();
  const reviewId = useId();
  const actionLabel = locked ? 'View destination' : currentLabel ? 'Change destination' : 'Set destination';
  const routeText = dayRoute(day, previousDay)
    || (previousLabel ? `${previousLabel} → Destination not set` : 'Choose where this day starts and ends.');
  let status = '';

  if (!available) status = 'Apply the day-destinations migration to enable destination editing.';
  else if (!country) status = 'Choose a country to see its destination catalogue.';
  else if (loading) status = `Loading destinations for ${country}…`;
  else if (error) status = `Could not load the destination catalogue for ${country}. Check the places migration and connection, then try again. Saved destinations are kept.`;
  else if (!catalogue.length) status = `No active catalogue places are available for ${country}. Apply the places migration or ask an administrator to add active places.`;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      /* The place search closes its own list on Escape; leave the dialog open
         for that keypress so one Escape never closes both. */
      const target = event.target;
      if (target instanceof Element && target.closest('.searchable-select')?.querySelector('.searchable-select-menu')) return;
      event.preventDefault();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    modalRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <div className="day-destination-bar">
        <MapPin size={15} className="day-destination-bar-icon" aria-hidden="true" />
        <div className="day-destination-bar-text">
          <strong className={currentLabel ? '' : 'unset'}>{currentLabel || 'No destination set'}</strong>
          {END_MODE_LABELS[endMode] && <span className="day-destination-bar-mode">{END_MODE_LABELS[endMode]}</span>}
        </div>
        <button
          type="button"
          className="day-destination-bar-btn"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={`${actionLabel} for day ${dayIndex + 1}`}
        >
          <Pencil size={13} /> {actionLabel}
        </button>
      </div>
      {open && (
        <div
          className="modal-overlay"
          onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}
        >
          <div
            ref={modalRef}
            tabIndex={-1}
            className="modal-content tall day-destination-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2 id={titleId}><MapPin size={18} /> Day {dayIndex + 1} destination</h2>
                <p className="day-destination-modal-sub">{routeText}</p>
              </div>
              <button type="button" className="close-btn" onClick={() => setOpen(false)} aria-label="Close day destination">
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <fieldset className="day-destination-fields" disabled={!canChange}>
                <label className="day-destination-field">
                  <span>Country</span>
                  <SearchableSelect
                    key={`country:${dayIndex}:${canChange}`}
                    className="day-destination-input"
                    aria-label="Destination country"
                    aria-describedby={statusId}
                    value={country}
                    disabled={!canChange}
                    placeholder="Choose a country"
                    onChange={(event) => {
                      const next = event.target.value;
                      if (!canChange || next === country || !countryOptions.includes(next)) return;
                      onChange({ destination_country: next, destination_place_id: null, destination_name: '', destination_region: '' });
                    }}
                  >
                    <option value="" disabled>Choose a country</option>
                    {countryOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                  </SearchableSelect>
                </label>
                <label className="day-destination-field">
                  <span>Place</span>
                  <SearchableSelect
                    key={`place:${dayIndex}:${country}:${placeDisabled}`}
                    className="day-destination-input"
                    aria-label="Destination place"
                    aria-describedby={`${statusId} ${reviewId}`}
                    aria-busy={loading}
                    value={placeValue}
                    disabled={placeDisabled}
                    placeholder={loading ? 'Loading destinations…' : 'Choose a catalogue place'}
                    onChange={(event) => {
                      if (placeDisabled) return;
                      const row = catalogue.find((entry) => entry.id === event.target.value);
                      if (!row) return;
                      onChange({
                        destination_country: row.country,
                        destination_place_id: row.id,
                        destination_name: row.place,
                        destination_region: row.province || ''
                      });
                    }}
                  >
                    <option value="" disabled>Choose a catalogue place</option>
                    {savedOnly && (
                      <option value={placeValue} disabled>
                        {placeLabel(day.destination_name || 'Saved destination', day.destination_region)} (saved)
                      </option>
                    )}
                    {catalogue.map((row) => (
                      <option key={row.id} value={row.id} data-search={row.altName}>
                        {placeLabel(row.place, row.province)}
                      </option>
                    ))}
                  </SearchableSelect>
                </label>
                <label className="day-destination-field">
                  <span>End of day</span>
                  <select
                    className="day-destination-input"
                    aria-label="End of day"
                    value={END_MODES.includes(day.end_of_day) ? day.end_of_day : ''}
                    disabled={!canChange}
                    onChange={(event) => {
                      const mode = event.target.value;
                      if (canChange && (!mode || END_MODES.includes(mode))) onChange({ end_of_day: mode || null });
                    }}
                  >
                    <option value="">Not specified</option>
                    <option value="overnight">Overnight</option>
                    <option value="visit">Visit</option>
                    <option value="departure">Departure</option>
                    <option value="transit">Transit</option>
                  </select>
                </label>
              </fieldset>
              <p id={statusId} className="day-destination-status" role="status">{status}</p>
              {savedOnly && !loading && available && (
                <p className="day-destination-status">The saved destination is not in the active catalogue. It is kept until you choose a replacement or change country.</p>
              )}
              {!loading && available && places.some((row) => !row.id) && !catalogue.length && (
                <p className="day-destination-status">The bundled rental list has no place IDs and cannot be used for day destinations.</p>
              )}
              <div className="day-destination-actions">
                <button
                  type="button"
                  className="day-destination-button"
                  aria-label="Copy previous day destination"
                  title={canCopyPrevious ? previousLabel : 'The previous day needs a saved destination.'}
                  disabled={!canCopyPrevious}
                  onClick={() => { if (canCopyPrevious) onChange(destinationPatch(previousDay)); }}
                >
                  Use previous day destination
                </button>
                <BulkDestinationApply
                  key={JSON.stringify([dayIndex, day.id, destinationPatch(day), days.map((target) => target?.id)])}
                  day={day}
                  days={days}
                  dayIndex={dayIndex}
                  locked={locked}
                  onApply={onApply}
                />
              </div>
              <p id={reviewId} className="day-destination-review">Review services, travel times and prices after changing destinations. Services are never changed automatically.</p>
              <div className="day-destination-modal-actions">
                <button type="button" className="primary-btn" onClick={() => setOpen(false)}>Done</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
