import { X, Tag, Calendar, Users, DollarSign, Info } from 'lucide-react';
import { SURCHARGE_CATEGORY } from '../lib/surchargeFees';

/* A read-only view of everything a library item can be priced at, across every season at
   once. The directory row deliberately shows a single season, stepped with arrows, because
   the table has room for one figure; this surface is where the whole rate card is read
   without opening (and risking an accidental edit of) the item. */

/* Only these keys carry a price. Anything else on a rate row is metadata (season, board,
   validity) or an alias column written by the save path, and the read-only view has no use
   for it. Restricting to this set is what keeps the card free of noise. */
const PRICE_KEYS = new Set([
  'price_1_adult', 'price_2_adults', 'price_3_plus_adults', 'unit_cost', 'unit_price',
  'child_discount', 'taxes_and_surcharges', 'fuel_surcharge',
  'entrance_fee_per_person', 'entrance_fee_per_vehicle', 'conservation_levy_per_adult',
  'conservation_levy_per_child', 'conservation_levy_adult', 'conservation_levy_child',
  'guide_rate', 'driver_rate', 'guide_transfer_rate', 'guide_half_day_rate',
  'guide_full_day_rate', 'guide_overland_rate', 'guide_dinner_rate', 'fast_track_adult_rate',
  'adult_rate', 'child_rate'
]);

/* Mirrors of the price_1_adult / price_2_adults columns. Showing them would print the same
   number twice under a different name. */
const ALIAS_KEYS = new Set(['single_room_rate', 'double_twin_rate', 'triple_room_rate', 'effective_single_rate']);

/* The fields that describe the headline price of a rate. A per-person rate stores unit_price
   as a copy of the 2-adult figure, and a flat room stores the 2-adult figure as a copy of the
   room rate, so one of each pair is always a restatement - only the first is printed. */
const PRIMARY_PRICE_KEYS = new Set(['price_1_adult', 'price_2_adults', 'price_3_plus_adults', 'unit_price', 'unit_cost']);

const PRICE_ORDER = [
  'price_1_adult', 'price_2_adults', 'price_3_plus_adults', 'unit_price', 'unit_cost',
  'child_discount', 'taxes_and_surcharges', 'fuel_surcharge',
  'entrance_fee_per_person', 'entrance_fee_per_vehicle', 'conservation_levy_per_adult',
  'conservation_levy_adult', 'conservation_levy_per_child', 'conservation_levy_child',
  'guide_rate', 'driver_rate', 'guide_transfer_rate', 'guide_half_day_rate',
  'guide_full_day_rate', 'guide_overland_rate', 'guide_dinner_rate', 'fast_track_adult_rate',
  'adult_rate', 'child_rate'
];

const FIELD_LABELS = {
  price_1_adult: '1 adult (single)',
  price_2_adults: '2 adults sharing (PPS)',
  price_3_plus_adults: '3+ adults (per person)',
  unit_cost: 'Unit cost',
  unit_price: 'Unit price (per room / vehicle)',
  child_discount: 'Child discount',
  taxes_and_surcharges: 'Taxes & surcharges',
  fuel_surcharge: 'Fuel surcharge',
  entrance_fee_per_person: 'Entrance fee / person',
  entrance_fee_per_vehicle: 'Entrance fee / vehicle',
  conservation_levy_per_adult: 'Conservation levy / adult',
  conservation_levy_per_child: 'Conservation levy / child',
  conservation_levy_adult: 'Conservation levy / adult',
  conservation_levy_child: 'Conservation levy / child',
  guide_rate: 'Guide rate',
  driver_rate: 'Driver rate',
  guide_transfer_rate: 'Guide transfer rate',
  guide_half_day_rate: 'Guide half day rate',
  guide_full_day_rate: 'Guide full day rate',
  guide_overland_rate: 'Guide overland rate',
  guide_dinner_rate: 'Guide dinner rate',
  fast_track_adult_rate: 'Fast track adult rate',
  adult_rate: 'Adult rate',
  child_rate: 'Child rate'
};

const numOrNull = (value) => (value === null || value === undefined || value === '' ? null : parseFloat(value));

/* A figure is shown when it was actually set. The save path stores a blank money box as null, so
   null / undefined / "" all mean "not offered". A bare numeric 0 is the residue of the old "start
   every box at 0.00" default, so it also reads as nothing was loaded and stays hidden. */
const isPresent = (value) => value !== null && value !== undefined && value !== '';
const isPriced = (value) => isPresent(value) && !(typeof value === 'number' && value === 0);

/* Child age bands keep the raw typed value in their JSONB map, so an explicitly typed 0.00 survives
   as the string "0.00" and still reads as a price, while a band that was never touched stays the
   number 0 and a cleared box stays "". */
const isChildRateSet = (value) => isPresent(value) && !(typeof value === 'number' && value === 0);

const chipStyle = {
  display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.72rem', fontWeight: 700,
  color: '#334155', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '5px',
  padding: '0.12rem 0.45rem', marginRight: '0.35rem', marginBottom: '0.35rem'
};

const headStyle = {
  fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.03em', textTransform: 'uppercase',
  color: '#64748b', marginBottom: '0.3rem'
};

const Section = ({ title, children }) => (
  <div style={{ marginTop: '0.7rem' }}>
    <div style={headStyle}>{title}</div>
    {children}
  </div>
);

const Row = ({ label, value }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '0.82rem', padding: '0.15rem 0', borderBottom: '1px dashed #eef2f7' }}>
    <span style={{ color: '#64748b' }}>{label}</span>
    <span style={{ fontWeight: 600, color: '#0f172a', textAlign: 'right' }}>{value}</span>
  </div>
);

const LibraryItemDetailModal = ({ item, vehicleTypes = [], onClose }) => {
  const currency = item.currency_code || item.currency || '';
  const money = (value) => `${currency ? `${currency} ` : ''}${(Number(value) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const vehicleLabel = (value) => {
    if (value && typeof value === 'object') {
      if (value.free) return 'Free';
      if (value.na) return 'n/a';
      return '\u2014';
    }
    return money(value);
  };
  const bands = Array.isArray(item.child_age_ranges) ? item.child_age_ranges : [];
  const rates = Array.isArray(item.item_rates) ? item.item_rates : [];
  const carRates = Array.isArray(item.car_rental_rates) ? item.car_rental_rates : [];
  const vehicleName = (code) => vehicleTypes.find((type) => String(type.id ?? type.code) === String(code))?.name || code;

  /* Every figure is shown when it was actually set: a blank money box is stored as null and stays
     hidden, while an explicit 0 is a real price and prints. */
  const scalarFields = (rate) => {
    const isFlat = rate.rate_basis === 'per_room' || item.pricing_model === 'per_room';
    /* A flat room leads with the room rate; a per-person rate leads with the 1-adult and
       2-adult figures. The order decides which label survives when two keys hold the same
       number. */
    const order = isFlat
      ? ['unit_price', 'price_2_adults', 'price_1_adult', 'price_3_plus_adults', 'unit_cost', ...PRICE_ORDER.slice(5)]
      : PRICE_ORDER;
    const seen = new Set();
    const rows = [];
    order.forEach((key) => {
      if (!PRICE_KEYS.has(key) || ALIAS_KEYS.has(key)) return;
      const value = rate[key];
      if (!isPriced(value)) return;
      if (PRIMARY_PRICE_KEYS.has(key)) {
        const signature = Number(numOrNull(value));
        if (seen.has(signature)) return;
        seen.add(signature);
      }
      rows.push([key, value]);
    });
    return rows;
  };

  const childRateRows = (rate, fastTrack = false) => {
    const map = (fastTrack ? rate.fast_track_child_rates_breakdown : rate.child_rates_breakdown) || {};
    const rows = bands
      .map((band) => ({ key: band.id, label: `${band.name || 'Child'} (${band.ageFrom ?? 0}\u2013${band.ageTo ?? 18} yrs)`, value: map[band.id] }))
      .filter((row) => isChildRateSet(row.value));
    if (!rows.length && isChildRateSet(map.child)) rows.push({ key: 'child', label: 'Child', value: map.child });
    return rows;
  };

  const carGroups = (() => {
    const keys = {};
    const groups = [];
    carRates.forEach((rate) => {
      const key = `${rate.vehicle_group || ''}|${rate.vehicle_name || ''}|${rate.rate_code || ''}`;
      if (!keys[key]) { keys[key] = { ...rate, ranges: [] }; groups.push(keys[key]); }
      keys[key].ranges.push(rate);
    });
    return groups;
  })();

  const hasAnything = rates.length > 0 || carRates.length > 0;
  const arrow = <span style={{ margin: '0 0.3rem' }}>{'\u2192'}</span>;

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 1003, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.25rem' }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{ background: '#fff', borderRadius: '12px', width: 'min(860px, 96vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', padding: '1rem 1.25rem', borderBottom: '1px solid #e2e8f0', background: '#fafafa' }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 800, color: '#0f172a' }}>
              {item.name}{item.identifier_code ? <span style={{ color: '#0d7478' }}> {'\u2014'} {item.identifier_code}</span> : ''}
            </h3>
            <div style={{ marginTop: '0.4rem' }}>
              <span style={chipStyle}><Tag size={12} /> {item.category || 'Uncategorised'}</span>
              {item.supplier?.name && <span style={chipStyle}><Users size={12} /> {item.supplier.name}</span>}
              {item.destination_region && <span style={chipStyle}>{item.destination_region}{item.destination_area ? ` \u00b7 ${item.destination_area}` : ''}</span>}
              <span style={chipStyle}><DollarSign size={12} /> {currency || 'No currency'}</span>
              {item.pricing_model && <span style={chipStyle}>{String(item.pricing_model).replace(/_/g, ' ')}</span>}
            </div>
          </div>
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close" style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}><X size={20} /></button>
        </div>

        <div style={{ padding: '1rem 1.25rem', overflowY: 'auto' }}>
          <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', fontSize: '0.82rem', color: '#475569' }}>
            {item.max_occupancy != null && <span><strong>Max occupancy:</strong> {item.max_occupancy}</span>}
            {item.max_adults != null && <span><strong>Max adults:</strong> {item.max_adults}</span>}
            {bands.length > 0 && <span><strong>Child age tiers:</strong> {bands.map((band) => `${band.name || 'Child'} ${band.ageFrom ?? 0}\u2013${band.ageTo ?? 18}`).join(' \u00b7 ')}</span>}
            {item.meal_plan && <span><strong>Default board:</strong> {item.meal_plan}</span>}
          </div>

          {!hasAnything && (
            <div style={{ marginTop: '1rem', fontSize: '0.82rem', color: '#94a3b8' }}>
              No rates have been recorded for this item yet. Add a season in the editor and every pricing figure will appear here.
            </div>
          )}

          {rates.map((rate, rateIndex) => {
            const fields = scalarFields(rate);
            const tiers = Array.isArray(rate.tiered_pricing) ? rate.tiered_pricing : [];
            const vehicles = rate.prices_by_vehicle && typeof rate.prices_by_vehicle === 'object'
              ? Object.entries(rate.prices_by_vehicle).filter(([, value]) => value !== null && value !== undefined && !(typeof value === 'number' && value === 0))
              : [];
            const standardChildren = childRateRows(rate);
            const fastTrackChildren = childRateRows(rate, true);
            const guideMeals = item.category === 'Accommodation' ? (rate.guide_meal_plan || item.meal_plan) : null;
            const driverMeals = item.category === 'Accommodation' ? (rate.driver_meal_plan || item.meal_plan) : null;

            return (
              <div key={rate.id ?? rateIndex} style={{ marginTop: '1rem', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.85rem 0.95rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.92rem' }}>
                    {rate.season_name || rate.option_name || `Season ${rateIndex + 1}`}
                  </div>
                  <div>
                    <span style={chipStyle}><Calendar size={12} /> {rate.valid_from || 'open'}{arrow}{rate.valid_to || 'open'}</span>
                    {rate.rate_basis && <span style={chipStyle}>{String(rate.rate_basis).replace(/_/g, ' ')}</span>}
                    {rate.meal_plan && <span style={chipStyle}>{rate.meal_plan}</span>}
                  </div>
                </div>

                {fields.length > 0 && (
                  <Section title="Prices">
                    {fields.map(([key, value]) => (
                      <Row
                        key={key}
                        label={FIELD_LABELS[key] || key.replace(/_/g, ' ')}
                        value={key === 'child_discount' ? `${value}%` : money(value)}
                      />
                    ))}
                  </Section>
                )}

                {tiers.length > 0 && (
                  <Section title="Tiered pricing (by pax)">
                    {tiers.map((tier, index) => (
                      <Row key={index} label={`${tier.min_pax ?? '?'}\u2013${tier.max_pax ?? '?'} pax`} value={money(tier.rate)} />
                    ))}
                  </Section>
                )}

                {vehicles.length > 0 && (
                  <Section title="Per-vehicle pricing">
                    {vehicles.map(([code, value]) => (
                      <Row key={code} label={vehicleName(code)} value={`${vehicleLabel(value)} / vehicle`} />
                    ))}
                  </Section>
                )}

                {standardChildren.length > 0 && (
                  <Section title="Child sharing rates">
                    {standardChildren.map((row) => <Row key={row.key} label={row.label} value={`${money(row.value)} / child`} />)}
                  </Section>
                )}

                {fastTrackChildren.length > 0 && (
                  <Section title="Fast track child rates">
                    {fastTrackChildren.map((row) => <Row key={row.key} label={row.label} value={`${money(row.value)} / child`} />)}
                  </Section>
                )}

                {item.category === 'Accommodation' && (isPriced(rate.guide_rate) || isPriced(rate.driver_rate) || item.guide_driver_room_offered) && (
                  <Section title="Guide & driver">
                    {(isPriced(rate.guide_rate) || item.guide_driver_room_offered) && <Row label="Guide" value={`${isPriced(rate.guide_rate) ? money(rate.guide_rate) : '\u2014'}${guideMeals ? ` \u00b7 ${guideMeals}` : ''}`} />}
                    {(isPriced(rate.driver_rate) || item.guide_driver_room_offered) && <Row label="Driver" value={`${isPriced(rate.driver_rate) ? money(rate.driver_rate) : '\u2014'}${driverMeals ? ` \u00b7 ${driverMeals}` : ''}`} />}
                  </Section>
                )}

                {rate.notes && (
                  <Section title="Notes">
                    <div style={{ fontSize: '0.8rem', color: '#475569', whiteSpace: 'pre-wrap' }}>{rate.notes}</div>
                  </Section>
                )}
              </div>
            );
          })}

          {item.category === SURCHARGE_CATEGORY && rates.length > 0 && (
            <div style={{ marginTop: '0.85rem', fontSize: '0.78rem', color: '#c2410c', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Info size={13} /> Surcharge fee figures sit on the season rows above, keyed to the surcharge type (entrance fee, conservation levy, ...).
            </div>
          )}

          {carGroups.length > 0 && (
            <Section title="Car rental rates">
              {carGroups.map((group, index) => (
                <div key={index} style={{ marginTop: '0.5rem', border: '1px solid #99f6e4', borderRadius: '10px', padding: '0.7rem 0.85rem' }}>
                  <div style={{ fontWeight: 800, color: '#0e7490', fontSize: '0.88rem' }}>
                    {group.vehicle_group ? `${group.vehicle_group} \u00b7 ` : ''}{group.vehicle_name || 'Vehicle'}{group.rate_code ? ` \u2014 ${group.rate_code}` : ''}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', margin: '0.15rem 0 0.35rem' }}>
                    {group.kms_unlimited !== false ? 'Unlimited km' : `${group.kms_included || 0} km included`}
                    {group.min_days ? ` \u00b7 min ${group.min_days} days` : ''}
                    {group.valid_from || group.valid_to ? <> \u00b7 {group.valid_from || 'open'}{arrow}{group.valid_to || 'open'}</> : null}
                  </div>
                  {group.ranges.map((range, rangeIndex) => (
                    <Row
                      key={rangeIndex}
                      label={`${range.min_days ?? '?'}\u2013${range.max_days ?? '\u221e'} days`}
                      value={`${money(range.price)} / vehicle`}
                    />
                  ))}
                </div>
              ))}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
};

export default LibraryItemDetailModal;
