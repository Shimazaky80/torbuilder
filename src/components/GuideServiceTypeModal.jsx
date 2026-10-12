import { useState } from 'react';
import { UserCheck, X } from 'lucide-react';
import {
  GUIDE_SERVICE_TYPES,
  GUIDE_SERVICE_TYPE_LABELS,
  guideRateFor,
  guideChargeTotal,
  guideSelection
} from '../lib/guidePricing';

/* A Guide is charged per the service it accompanies, so the operator has to say
   which of the five flat per-trip amounts this guide line is priced from before
   the line can be costed. Each type shows its contracted amount so the choice is
   made on figures, not on memory of what the guide contract lays out. */
const money = (value, code) => `${code} ${(Number(value) || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function GuideServiceTypeModal({
  item,
  rate,
  currency = 'ZAR',
  defaultValue = [],
  onConfirm,
  onCancel
}) {
  const [selection, setSelection] = useState(() => guideSelection(defaultValue));
  const total = guideChargeTotal(rate, selection);

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

        <div className="service-guide-total">
          <span>Guide charge for this line</span>
          <strong>{money(total, currency)}</strong>
        </div>

        <div className="form-actions">
          <button type="button" className="secondary-btn" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="primary-btn"
            disabled={selection.length === 0}
            onClick={() => onConfirm(selection)}
          >
            <UserCheck size={16} /> Apply guide charge
          </button>
        </div>
      </div>
    </div>
  );
}