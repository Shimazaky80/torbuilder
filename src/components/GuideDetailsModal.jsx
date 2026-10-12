import { useMemo, useState } from 'react';
import { UtensilsCrossed, BedDouble, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import {
  guideMealRate,
  guideTravelRate,
  driverTravelRate,
  overnightRiderRate,
  overnightRateRow,
  accommodationAcceptsGuide,
  accommodationDestination,
  singleOvernightRate,
  OVERNIGHT_RIDER_LABELS
} from '../lib/guidePricing';

/* Overland guide detail: the lunch, dinner and overnight the guide and driver are
   fed and bedded on the days the guide is used.

   The overnight is charged to the guide & driver only — never the clients — and
   the operator chooses which party is billed (guide / driver / both; "both"
   writes one line each). Where the guide sleeps is decided against the clients'
   accommodation on the day:
     - if the property contracts a guide & driver room, the guide/driver are
       charged its guide_rate / driver_rate;
     - if it does not, the operator either keeps the clients' property (the
       charged parties fall back to its default single rate each) or picks
       another property in the same destination that does contract one. */
const money = (value, code) => `${code} ${(Number(value) || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const mealTypeOf = (item) => String(item?.meal_type || '').trim().toLowerCase();

const resolveMealPlan = (item) => {
  if (!item) return null;
  const rate = (item.item_rates || [])[0] || {};
  return { item, unitCost: guideMealRate(rate) };
};

const riderList = (charge) => (charge === 'both' ? ['guide', 'driver'] : [charge]);

export default function GuideDetailsModal({
  guideName = 'the guide',
  dayLabel = 'this day',
  currency = 'ZAR',
  libraryItems = [],
  currentAccommodationIds = [],
  travelStart = '',
  travelEnd = '',
  defaultValues = {},
  onConfirm,
  onCancel
}) {
  const [lunchItemId, setLunchItemId] = useState(defaultValues.lunchItemId || '');
  const [dinnerItemId, setDinnerItemId] = useState(defaultValues.dinnerItemId || '');
  const [guideOnly, setGuideOnly] = useState(defaultValues.guideOnly !== false);
  const [riderCharge, setRiderCharge] = useState(
    defaultValues.riderCharge || (defaultValues.overnightItemId ? 'guide' : 'both')
  );

  const clientAccoms = useMemo(() => (currentAccommodationIds || [])
    .map((id) => libraryItems.find((item) => item.id === id))
    .filter(Boolean), [currentAccommodationIds, libraryItems]);

  const acceptsClientRoom = clientAccoms.some(accommodationAcceptsGuide);
  /* The clients' own property is the referent for "same destination", and the
     natural host when it contracts a guide & driver room. */
  const referentHost = clientAccoms.find(accommodationAcceptsGuide) || clientAccoms[0] || null;

  const savedHostId = defaultValues.overnightItemId || '';
  const savedIsAlt = savedHostId && !clientAccoms.some((item) => item.id === savedHostId);
  const [overnightMode, setOvernightMode] = useState(() => {
    if (!savedHostId) return referentHost ? 'client' : 'none';
    return savedIsAlt ? 'alt' : 'client';
  });
  const [altOvernightId, setAltOvernightId] = useState(savedIsAlt ? savedHostId : '');

  const meals = useMemo(() => (libraryItems || [])
    .filter((item) => /meal/i.test(item.category || ''))
    .sort((a, b) => a.name.localeCompare(b.name)), [libraryItems]);

  const lunchOptions = useMemo(() => meals.filter((item) => mealTypeOf(item).includes('lunch')), [meals]);
  const dinnerOptions = useMemo(() => meals.filter((item) => mealTypeOf(item).includes('dinner')), [meals]);
  /* Any meal left over (no meal_type, or 'Breakfast/{meal}') is a candidate too,
     so an operator who never classified their meals can still feed the guide. */
  const undecidedMeals = useMemo(() => meals.filter((item) => !mealTypeOf(item) || mealTypeOf(item) === 'breakfast'), [meals]);
  const lunchChoices = lunchOptions.length ? lunchOptions : undecidedMeals;
  const dinnerChoices = dinnerOptions.length ? dinnerOptions : undecidedMeals;

  /* Properties in the same destination that DO contract a guide & driver room,
     the alternative the operator may pick when the clients' property does not. */
  const altOptions = useMemo(() => {
    const destination = referentHost ? accommodationDestination(referentHost) : '';
    return (libraryItems || [])
      .filter((item) => /accommodation/i.test(item.category || ''))
      .filter((item) => accommodationAcceptsGuide(item))
      .filter((item) => (referentHost ? item.id !== referentHost.id && !!destination && accommodationDestination(item) === destination : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [libraryItems, referentHost]);

  const altHost = altOptions.find((item) => item.id === altOvernightId) || null;
  const overnightHost = overnightMode === 'client' ? referentHost
    : overnightMode === 'alt' ? altHost
      : null;

  const hostRate = overnightHost ? overnightRateRow(overnightHost, currency, travelStart, travelEnd) : null;
  const guideCost = overnightHost ? guideTravelRate(hostRate) : 0;
  const driverCost = overnightHost ? driverTravelRate(hostRate) : 0;
  const singleCost = overnightHost ? singleOvernightRate(hostRate) : 0;
  const nights = riderList(riderCharge);
  const overnightTotal = nights.reduce((sum, who) => sum + overnightRiderRate(hostRate, who), 0);

  const lunchChoice = lunchChoices.find((item) => item.id === lunchItemId);
  const dinnerChoice = dinnerChoices.find((item) => item.id === dinnerItemId);

  const overnightLines = overnightHost
    ? riderList(riderCharge).map((who) => ({
      item: overnightHost,
      who,
      unitCost: overnightRiderRate(hostRate, who)
    }))
    : [];

  const handleConfirm = () => {
    onConfirm({
      lunch: resolveMealPlan(lunchChoice),
      dinner: resolveMealPlan(dinnerChoice),
      overnight: overnightLines,
      guideOnly
    });
  };

  const hasAnyDetail = !!lunchItemId || !!dinnerItemId || overnightLines.length > 0;

  return (
    <div className="modal-overlay service-guide-overlay">
      <div className="modal-content service-guide-modal service-guide-details-modal">
        <div className="modal-header">
          <div>
            <h2>Guide &amp; driver details</h2>
            <p style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '0.3rem' }}>
              {guideName} on {dayLabel} — the meals and the bed the guide &amp; driver get while
              touring overland. The clients keep their own room; each line is charged to the guide
              &amp; driver only.
            </p>
          </div>
          <button className="close-btn" onClick={onCancel}><X size={20} /></button>
        </div>

        <div className="service-guide-section">
          <h3><UtensilsCrossed size={15} /> Lunch</h3>
          <select value={lunchItemId} onChange={(event) => setLunchItemId(event.target.value)}>
            <option value="">No lunch for the guide on this day</option>
            {lunchChoices.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} — {money(guideMealRate((item.item_rates || [])[0] || {}), currency)}
              </option>
            ))}
          </select>
          {lunchChoices.length === 0 && <p className="service-guide-empty">No meal items in the library to feed the guide.</p>}
        </div>

        <div className="service-guide-section">
          <h3><UtensilsCrossed size={15} /> Dinner</h3>
          <select value={dinnerItemId} onChange={(event) => setDinnerItemId(event.target.value)}>
            <option value="">No dinner for the guide on this day</option>
            {dinnerChoices.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} — {money(guideMealRate((item.item_rates || [])[0] || {}), currency)}
              </option>
            ))}
          </select>
          {dinnerChoices.length === 0 && <p className="service-guide-empty">No meal items in the library to feed the guide.</p>}
        </div>

        <div className="service-guide-section">
          <h3><BedDouble size={15} /> Guide &amp; driver overnight</h3>

          {clientAccoms.length > 0 ? (
            <div className="service-guide-clients">
              {clientAccoms.map((item) => (
                <span key={item.id} className={`service-guide-client-tag ${accommodationAcceptsGuide(item) ? 'accepts' : 'declines'}`}>
                  {accommodationAcceptsGuide(item)
                    ? <CheckCircle2 size={13} />
                    : <AlertTriangle size={13} />}
                  {item.name} — {accommodationAcceptsGuide(item)
                    ? 'guide & driver room offered'
                    : 'no contracted guide & driver room'}
                </span>
              ))}
            </div>
          ) : (
            <p className="service-guide-empty">No client accommodation is on this day.</p>
          )}

          {!acceptsClientRoom && referentHost && (
            <div className="service-guide-choice">
              <label className={`service-guide-choice-row ${overnightMode === 'client' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="overnight-host"
                  checked={overnightMode === 'client'}
                  onChange={() => setOvernightMode('client')}
                />
                <span>
                  <strong>Proceed at {referentHost.name}</strong>
                  <small>The same accommodation as the clients. The guide, driver or both are charged the default single rate each ({money(singleCost, currency)} / night).</small>
                </span>
              </label>
              <label className={`service-guide-choice-row ${overnightMode === 'alt' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="overnight-host"
                  checked={overnightMode === 'alt'}
                  onChange={() => setOvernightMode('alt')}
                />
                <span>
                  <strong>Use a different property in the same destination that accepts the guide &amp; driver</strong>
                  <small>Only the chosen party is charged there — the clients keep their own room and are never charged.</small>
                </span>
              </label>
            </div>
          )}

          {!acceptsClientRoom && !referentHost && (
            <div className="service-guide-choice">
              <label className={`service-guide-choice-row ${overnightMode === 'alt' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="overnight-host"
                  checked={overnightMode === 'alt'}
                  onChange={() => setOvernightMode('alt')}
                />
                <span>
                  <strong>Choose a property that offers a guide &amp; driver room</strong>
                  <small>There is no client accommodation on this day to fall back to.</small>
                </span>
              </label>
            </div>
          )}

          {overnightMode === 'alt' && (
            <select value={altOvernightId} onChange={(event) => setAltOvernightId(event.target.value)}>
              <option value="">Select a property that offers a guide &amp; driver room</option>
              {altOptions.map((item) => {
                const rate = overnightRateRow(item, currency, travelStart, travelEnd);
                return (
                  <option key={item.id} value={item.id}>
                    {item.name} — guide {money(guideTravelRate(rate), currency)} · driver {money(driverTravelRate(rate), currency)} / night
                  </option>
                );
              })}
            </select>
          )}
          {overnightMode === 'alt' && altOptions.length === 0 && (
            <p className="service-guide-empty">No property in the same destination offers a guide &amp; driver room.</p>
          )}

          <label className={`service-guide-choice-row ${overnightMode === 'none' ? 'selected' : ''}`}>
            <input
              type="radio"
              name="overnight-host"
              checked={overnightMode === 'none'}
              onChange={() => setOvernightMode('none')}
            />
            <span>
              <strong>No overnight for the guide &amp; driver</strong>
              <small>Nothing is bedded on this day.</small>
            </span>
          </label>

          {overnightHost && overnightMode !== 'none' && (
            <div className="service-guide-riders">
              <div className="service-guide-riders-head">Who is charged for the night</div>
              {['guide', 'driver', 'both'].map((who) => {
                const cost = who === 'both' ? guideCost + driverCost : overnightRiderRate(hostRate, who);
                return (
                  <label key={who} className={`service-guide-choice-row ${riderCharge === who ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="overnight-rider"
                      checked={riderCharge === who}
                      onChange={() => setRiderCharge(who)}
                    />
                    <span>
                      <strong>{OVERNIGHT_RIDER_LABELS[who]}</strong>
                      <small>
                        {who === 'both'
                          ? `Guide ${money(guideCost, currency)} + driver ${money(driverCost, currency)} — two charges`
                          : `${money(cost, currency)} / night`}
                      </small>
                    </span>
                    <span className="service-guide-rider-total">{money(cost, currency)}</span>
                  </label>
                );
              })}
              <div className="service-guide-total">
                Overnight total: <strong>{money(overnightTotal, currency)}</strong>
                {' '}({nights.length} line{nights.length === 1 ? '' : 's'})
              </div>
            </div>
          )}

          {overnightHost && overnightMode === 'client' && !acceptsClientRoom && (
            <p className="service-guide-note">
              {referentHost?.name} does not contract a guide &amp; driver room, so the charged
              party falls back to its default single rate.
            </p>
          )}
        </div>

        <label className="service-guide-check-row">
          <input type="checkbox" checked={guideOnly} onChange={(event) => setGuideOnly(event.target.checked)} />
          <span>
            <strong>Only the guide &amp; driver are charged for these</strong>
            <small>The clients never pay for the guide's meals; the overnight is always charged to the guide &amp; driver alone.</small>
          </span>
        </label>

        <div className="form-actions">
          <button type="button" className="secondary-btn" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="primary-btn"
            onClick={handleConfirm}
            disabled={!hasAnyDetail}
          >
            Apply guide details
          </button>
        </div>
      </div>
    </div>
  );
}