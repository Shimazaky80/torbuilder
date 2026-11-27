import { useEffect, useMemo, useState } from 'react';
import { UtensilsCrossed, BedDouble, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  guideMealRate,
  driverMealRate,
  guideTravelRate,
  overnightRateRow,
  accommodationAcceptsGuide,
  accommodationDestination,
  singleOvernightRate,
  guideMinClientRooms,
  mealAcceptsDriver,
  guideMealChoices,
  crewMealLines,
  crewRoomLadder
} from '../lib/guidePricing';
import { staffCountWord, staffLadderBasis } from '../lib/staffRoomTiers';


/* Overland guide detail: the lunch, dinner and overnight the guide and driver are
   fed and bedded on the days the guide is used.

   The meals the guide may be booked on are the ones the supplier flagged on the
   Meal item; until any meal is flagged every meal stays selectable, so the
   dialog is never empty for a library that has not been tagged yet.

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

const mealOptionLabel = (item, currency) => {
  const rate = (item.item_rates || [])[0] || {};
  const guide = money(guideMealRate(rate), currency);
  return mealAcceptsDriver(item)
    ? `${item.name} — guide ${guide} · driver ${money(driverMealRate(rate), currency)}`
    : `${item.name} — ${guide}`;
};

export default function GuideDetailsModal({
  guideName = 'the guide',
  dayLabel = 'this day',
  currency = 'ZAR',
  companyId = null,
  libraryItems: libraryItemsProp = [],
  currentAccommodationIds = [],
  /* Paying client rooms booked on this day. The property may only release its
     guide rate once a minimum is reached; an unknown count (the package
     builder quotes have no room allocation) leaves the contracted rate on. */
  clientRooms,
  /* Per-property client rooms for a split night, so the threshold is judged on
     the rooms booked at the property the guide is bedded at rather than the
     whole day's. */
  clientRoomsByAccommodation = null,
  /* The same counts in paying heads, for a property whose crew ladder counts
     guests rather than rooms. */
  payingGuests,
  payingGuestsByAccommodation = null,
  travelStart = '',
  travelEnd = '',
  defaultValues = {},
  detailKinds = { lunch: true, dinner: true, overnight: true },
  onConfirm,
  onCancel
}) {
  const [extraItems, setExtraItems] = useState([]);
  useEffect(() => {
    if (!companyId) return;
    const needsMeals = !!detailKinds?.lunch || !!detailKinds?.dinner;
    const needsAccom = !!detailKinds?.overnight;
    if (!needsMeals && !needsAccom) return;
    const categories = [...(needsMeals ? ['Meals', 'Meal'] : []), ...(needsAccom ? ['Accommodation'] : [])];
    let active = true;
    (async () => {
      try {
        const { data: items, error } = await supabase
          .from('library_items')
          .select('*')
          .eq('company_id', companyId)
          .eq('is_active', true)
          .in('category', categories);
        if (error || !active) return;
        const ids = (items || []).map((i) => i.id);
        const { data: rates } = ids.length
          ? await supabase.from('item_rates').select('*').in('item_id', ids)
          : { data: [] };
        if (!active) return;
        const merged = (items || []).map((item) => ({
          ...item,
          item_rates: (rates || []).filter((r) => r.item_id === item.id)
        }));
        setExtraItems(merged);
      } catch {
        /* modal still works with what it has */
      }
    })();
    return () => { active = false; };
  }, [companyId, detailKinds?.lunch, detailKinds?.dinner, detailKinds?.overnight]);

  const libraryItems = useMemo(() => {
    const merged = new Map((libraryItemsProp || []).map((item) => [item.id, item]));
    extraItems.forEach((item) => {
      const prev = merged.get(item.id);
      merged.set(item.id, prev ? { ...prev, ...item, item_rates: item.item_rates?.length ? item.item_rates : prev.item_rates } : item);
    });
    return Array.from(merged.values());
  }, [libraryItemsProp, extraItems]);

  const showLunch = !!detailKinds?.lunch;
  const showDinner = !!detailKinds?.dinner;
  const showOvernight = !!detailKinds?.overnight;

  const [lunchItemId, setLunchItemId] = useState(defaultValues.lunchItemId || '');
  const [dinnerItemId, setDinnerItemId] = useState(defaultValues.dinnerItemId || '');

  const clientAccoms = useMemo(() => (currentAccommodationIds || [])
    .map((id) => libraryItems.find((item) => item.id === id))
    .filter(Boolean), [currentAccommodationIds, libraryItems]);

  const autoGuideHost = useMemo(() => clientAccoms.find(accommodationAcceptsGuide) || null, [clientAccoms]);
  const hasClientAccom = clientAccoms.length > 0;
  /* Overland overnight: auto-charge when a guest accommodation has a guide rate;
     defer when guide is dropped before any guest accommodation; ask only when
     guest accommodation exists but has no guide rate. */
  const overnightAuto = !!(showOvernight && autoGuideHost);
  const overnightDeferred = !!(showOvernight && !autoGuideHost && !hasClientAccom);
  const overnightNeedsChoice = !!(showOvernight && !autoGuideHost && hasClientAccom);
  const referentHost = autoGuideHost || clientAccoms[0] || null;

  const savedHostId = defaultValues.overnightItemId || '';
  const savedIsAlt = savedHostId && !clientAccoms.some((item) => item.id === savedHostId);
  const [overnightMode, setOvernightMode] = useState(() => {
    if (!showOvernight) return 'none';
    if (autoGuideHost) return 'client';
    if (!hasClientAccom) return 'none';
    if (savedIsAlt) return 'alt';
    if (savedHostId) return 'single_rate';
    return 'single_rate';
  });
  const [altOvernightId, setAltOvernightId] = useState(savedIsAlt ? savedHostId : '');

  const allMeals = useMemo(() => (libraryItems || [])
    .filter((item) => /meal/i.test(item.category || ''))
    .sort((a, b) => a.name.localeCompare(b.name)), [libraryItems]);

  /* Flagged meals only, or the whole Meals module while nothing is flagged. */
  const { meals, restricted } = useMemo(() => guideMealChoices(allMeals), [allMeals]);

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
  const overnightHost = !showOvernight
    ? null
    : overnightAuto
      ? autoGuideHost
      : overnightMode === 'alt'
        ? altHost
        : overnightMode === 'single_rate' || overnightMode === 'client'
          ? referentHost
          : null;

  const hostRate = overnightHost ? overnightRateRow(overnightHost, currency, travelStart, travelEnd) : null;
  /* A split night books its client rooms across more than one property, so the
     host's own count wins; an alt property (or a caller without allocations)
     falls back to the day total / unknown. */
  const clientRoomsAt = (item) => {
    const count = item ? clientRoomsByAccommodation?.[item.id] : undefined;
    return count === undefined ? clientRooms : count;
  };
  const payingGuestsAt = (item) => {
    const count = item ? payingGuestsByAccommodation?.[item.id] : undefined;
    return count === undefined ? payingGuests : count;
  };
  const hostClientRooms = clientRoomsAt(overnightHost);
  const hostPayingGuests = payingGuestsAt(overnightHost);
  const hostCrewLadder = crewRoomLadder(hostRate, { minRooms: guideMinClientRooms(overnightHost) });
  const guideMinRooms = hostCrewLadder[0]?.minRooms ?? 1;
  const guideRateOptions = {
    clientRooms: hostClientRooms,
    payingGuests: hostPayingGuests,
    minRooms: guideMinRooms
  };
  const singleCost = overnightHost ? singleOvernightRate(hostRate) : 0;

  const lunchChoice = lunchChoices.find((item) => item.id === lunchItemId);
  const dinnerChoice = dinnerChoices.find((item) => item.id === dinnerItemId);

  const singleRateChoice = showOvernight && overnightNeedsChoice && overnightMode === 'single_rate';
  const overnightResolved = showOvernight && !overnightDeferred && (
    overnightAuto || singleRateChoice || (overnightMode === 'alt' && !!altHost)
  );
  const overnightLines = overnightResolved && overnightHost
    ? [{
      item: overnightHost,
      who: 'guide',
      unitCost: singleRateChoice
        ? singleOvernightRate(hostRate)
        : guideTravelRate(hostRate, true, guideRateOptions),
      forced: true
    }]
    : [];

  const handleConfirm = () => {
    onConfirm({
      lunch: showLunch ? crewMealLines(lunchChoice) : undefined,
      dinner: showDinner ? crewMealLines(dinnerChoice) : undefined,
      overnight: showOvernight ? overnightLines : undefined,
      guideOnly: true,
      overnightDeferred
    });
  };

  const hasAnyDetail = (showLunch && !!lunchItemId)
    || (showDinner && !!dinnerItemId)
    || overnightResolved
    || overnightDeferred;

  const heading = showOvernight ? 'Guide details' : 'Guide meal allowance';
  const intro = showOvernight
    ? `${guideName} on ${dayLabel} — choose guide meal allowances and overnight accommodation. Overnight is charged to the guide only.`
    : `${guideName} on ${dayLabel} — choose the lunch meal allowance for this guide.`;

  return (
    <div className="modal-overlay service-guide-overlay">
      <div className="modal-content service-guide-modal service-guide-details-modal">
        <div className="modal-header">
          <div>
            <h2>{heading}</h2>
            <p style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '0.3rem' }}>
              {intro}
            </p>
          </div>
          <button className="close-btn" onClick={onCancel}><X size={20} /></button>
        </div>

        {showLunch && (
          <div className="service-guide-section">
            <h3><UtensilsCrossed size={15} /> Lunch</h3>
          <select value={lunchItemId} onChange={(event) => setLunchItemId(event.target.value)}>
            <option value="">No lunch for the guide on this day</option>
            {lunchChoices.map((item) => (
              <option key={item.id} value={item.id}>{mealOptionLabel(item, currency)}</option>
            ))}
          </select>
          {lunchChoices.length === 0 && (
            <p className="service-guide-empty">
              {restricted
                ? 'No meal in the library is flagged for the guide. Tick "Guide meal" on a Meal item to feed the guide.'
                : 'No meal items in the library to feed the guide.'}
            </p>
          )}
        </div>
        )}

        {showDinner && (
        <div className="service-guide-section">
          <h3><UtensilsCrossed size={15} /> Dinner</h3>
          <select value={dinnerItemId} onChange={(event) => setDinnerItemId(event.target.value)}>
            <option value="">No dinner for the guide on this day</option>
            {dinnerChoices.map((item) => (
              <option key={item.id} value={item.id}>{mealOptionLabel(item, currency)}</option>
            ))}
          </select>
          {dinnerChoices.length === 0 && (
            <p className="service-guide-empty">
              {restricted
                ? 'No meal in the library is flagged for the guide. Tick "Guide meal" on a Meal item to feed the guide.'
                : 'No meal items in the library to feed the guide.'}
            </p>
          )}
          {!restricted && allMeals.length > 0 && (
            <p className="service-guide-note">
              No meal has been tagged yet, so every meal is offered. Tick "Guide meal" / "Driver meal"
              on the Meal items the crew actually eats at to restrict these lists.
            </p>
          )}
        </div>
        )}

        {showOvernight && (
        <div className="service-guide-section">
          <h3><BedDouble size={15} /> Guide overnight</h3>

          {overnightAuto && autoGuideHost && (
            <div className="service-guide-note" style={{ color: '#166534', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
              <CheckCircle2 size={14} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
              Guide overnight will be charged automatically at <strong>{autoGuideHost.name}</strong> — {money(guideTravelRate(overnightRateRow(autoGuideHost, currency, travelStart, travelEnd), true, {
                clientRooms: clientRoomsAt(autoGuideHost),
                payingGuests: payingGuestsAt(autoGuideHost),
                minRooms: (crewRoomLadder(overnightRateRow(autoGuideHost, currency, travelStart, travelEnd), { minRooms: guideMinClientRooms(autoGuideHost) })[0]?.minRooms ?? 1)
              }), currency)} / night.
            </div>
          )}

          {overnightDeferred && (
            <div className="service-guide-note" style={{ color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
              <AlertTriangle size={14} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
              No guest accommodation is on this day yet. When guest accommodation with a guide rate is added, the guide overnight will be charged automatically.
            </div>
          )}

          {overnightNeedsChoice && (
            <>
              <div className="service-guide-clients">
                {clientAccoms.map((item) => (
                  <span key={item.id} className="service-guide-client-tag declines">
                    <AlertTriangle size={13} />
                    {item.name} — no contracted guide rate
                  </span>
                ))}
              </div>
              <div className="service-guide-choice">
                <label className={`service-guide-choice-row ${overnightMode === 'single_rate' ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="overnight-host"
                    checked={overnightMode === 'single_rate'}
                    onChange={() => setOvernightMode('single_rate')}
                  />
                  <span>
                    <strong>Charge guide at guest room single room rate</strong>
                    <small>
                      {referentHost
                        ? `Charge the guide at ${referentHost.name}'s single room rate (${money(singleCost, currency)} / night).`
                        : 'Charge the guide at the guest accommodation single room rate.'}
                    </small>
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
                    <strong>Pick guide accommodation in the same destination</strong>
                    <small>Choose a property that has a contracted guide rate in the same destination.</small>
                  </span>
                </label>
              </div>

              {overnightMode === 'alt' && (
                <select value={altOvernightId} onChange={(event) => setAltOvernightId(event.target.value)}>
                  <option value="">Select guide accommodation</option>
                  {altOptions.map((item) => {
                    const rate = overnightRateRow(item, currency, travelStart, travelEnd);
                    const itemLadder = crewRoomLadder(rate, { minRooms: guideMinClientRooms(item) });
                    const itemWord = staffCountWord(staffLadderBasis(itemLadder));
                    const crewOptions = {
                      clientRooms: clientRoomsAt(item),
                      payingGuests: payingGuestsAt(item),
                      minRooms: itemLadder[0]?.minRooms ?? 1
                    };
                    const guideNight = guideTravelRate(rate, true, crewOptions);
                    return (
                      <option key={item.id} value={item.id}>
                        {item.name} — guide {money(guideNight, currency)} / night{crewOptions.minRooms > 1 ? ` (guide rate from ${crewOptions.minRooms} ${itemWord})` : ''}
                      </option>
                    );
                  })}
                </select>
              )}
              {overnightMode === 'alt' && altOptions.length === 0 && (
                <p className="service-guide-empty">No property in the same destination offers a contracted guide rate.</p>
              )}
            </>
          )}
        </div>
        )}

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