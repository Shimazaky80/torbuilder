import { useState } from 'react';
import SearchableSelect from './SearchableSelect';
import { UserCheck, X } from 'lucide-react';
import {
  GUIDE_SERVICE_TYPES,
  GUIDE_SERVICE_TYPE_LABELS,
  guideRateFor,
  guideChargeTotal,
  guideSelection
} from '../lib/guidePricing';
import {
  guideMemberName,
  guideUpliftPercent,
  guideMembersByDestination,
  guideMemberSupplierName,
  priceGuideLine
} from '../lib/guideRoster';

/* A Guide is charged per the service it accompanies, so the operator has to say
   which of the five flat per-trip amounts this guide line is priced from before
   the line can be costed. Each type shows its contracted amount so the choice is
   made on figures, not on memory of what the guide contract lays out.

   Naming who is guiding is optional and asked in the same breath, because it
   changes one number on this line - the person's uplift - and nothing else. The
   operator never has to leave the dialog to do the maths: the total shown is the
   amount the line will actually cost. */
const money = (value, code) => `${code} ${(Number(value) || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const memberOptionLabel = (member) => {
  const percent = guideUpliftPercent(member);
  const where = member?.destination_area || member?.city || '';
  return [
    guideMemberName(member) || 'Unnamed guide',
    percent > 0 ? `+${percent}%` : 'standard rate',
    where
  ].filter(Boolean).join(' · ');
};

export default function GuideServiceTypeModal({
  item,
  rate,
  currency = 'ZAR',
  defaultValue = [],
  members = [],
  rosterReady = false,
  destination = '',
  defaultMemberId = '',
  onConfirm,
  onCancel
}) {
  const [selection, setSelection] = useState(() => guideSelection(defaultValue));
  const [memberId, setMemberId] = useState(defaultMemberId || '');
  const base = guideChargeTotal(rate, selection);
  const member = members.find((entry) => String(entry.id) === String(memberId)) || null;
  const priced = priceGuideLine({ baseCharge: base, member, supplierName: guideMemberSupplierName(member) });
  const grouped = guideMembersByDestination(members, destination);
  const ordered = [...grouped.here, ...grouped.elsewhere];

  return (
    <div className="modal-overlay service-guide-overlay">
      <div className="modal-content service-guide-modal">
        <div className="modal-header">
          <div>
            <h2>Guide service charge</h2>
            <p style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '0.3rem' }}>
              {item?.name || 'Guide'} — pick what this guide service accompanies. The five
              amounts below are the flat per-trip rates on the guide&rsquo;s contract.
            </p>
          </div>
          <button className="close-btn" onClick={onCancel}><X size={20} /></button>
        </div>

        <div className="service-guide-type-list">
          {GUIDE_SERVICE_TYPES.map((type) => {
            const label = GUIDE_SERVICE_TYPE_LABELS[type];
            const rateValue = guideRateFor(rate, type);
            return (
              <label
                key={type}
                className={`service-guide-type-row ${selection.includes(type) ? 'selected' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={selection.includes(type)}
                  onChange={(event) => setSelection((current) => (
                    event.target.checked
                      ? [...current, type]
                      : current.filter((entry) => entry !== type)
                  ))}
                />
                <span className="service-guide-type-label">
                  <strong>{label}</strong>
                  <small>{rateValue > 0 ? 'flat per trip' : 'no rate set'}</small>
                </span>
                <span className="service-guide-type-rate">{money(rateValue, currency)}</span>
              </label>
            );
          })}
        </div>

        <p className="service-guide-help">
          {selection.includes('overland')
            ? 'Overland also asks where the guide and driver eat and sleep, per day.'
            : 'Choose at least one service type. Where more than one is ticked, their flat amounts add up to the line charge.'}
        </p>

        {rosterReady && (
          <div className="service-guide-section guide-person-section">
            <h3>Who is guiding?</h3>
            <SearchableSelect
              value={memberId}
              onChange={(event) => setMemberId(event.target.value)}
              aria-label="Which guide is on this line"
            >
              <option value="">No one named — the standard destination rate</option>
              {ordered.map((entry) => (
                <option key={entry.id} value={entry.id}>{memberOptionLabel(entry)}</option>
              ))}
            </SearchableSelect>
            {ordered.length === 0 ? (
              <p className="service-guide-help">
                Nobody in the guide directory yet. Add them under Guide Team and they will
                appear here with the percentage they cost above the destination rate.
              </p>
            ) : (
              <p className="service-guide-help">
                Guides for this destination are listed first; anyone who works elsewhere stays
                selectable. Naming a guide records who was paid and adds only their uplift to
                this line — it never changes what the clients are sold for.
              </p>
            )}
          </div>
        )}

        <div className="service-guide-total">
          <span>
            Guide charge for this line
            {priced.snapshot && priced.charged !== priced.baseCharge && (
              <small className="service-guide-total-detail">
                {money(priced.baseCharge, currency)} standard + {guideUpliftPercent(member)}% for {guideMemberName(member)}
              </small>
            )}
          </span>
          <strong>{money(priced.charged, currency)}</strong>
        </div>

        <div className="form-actions">
          <button type="button" className="secondary-btn" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="primary-btn"
            disabled={selection.length === 0}
            onClick={() => onConfirm(selection, memberId || null)}
          >
            <UserCheck size={16} /> Apply guide charge
          </button>
        </div>
      </div>
    </div>
  );
}
