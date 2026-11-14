import { useState } from 'react';
import { Fuel, X } from 'lucide-react';
import { fuelBlockMessage } from '../lib/fuelAllowance';

/* Which vehicle a fuel allowance fuels.
 *
 * The allowance is the operator's own Extras item, priced in the library; this
 * dialog never asks for a figure. It asks only which vehicle on the trip the
 * fuel belongs to, because that link is what removes the allowance with the
 * vehicle and stops a second one being added for the same car.
 *
 * A vehicle whose tariff already includes fuel is refused inline — an allowance
 * on top of it bills the client twice. A vehicle already carrying an allowance
 * is refused too. "Add without a vehicle" keeps the escape for an allowance
 * bought before the hire is recorded. */
export default function FuelVehicleModal({ itemName = 'Fuel allowance', options = [], onConfirm, onCancel }) {
  const [selected, setSelected] = useState('');
  const chosen = options.find((option) => option.key === selected) || null;
  const unlinked = selected === '__unlinked__';
  const canConfirm = unlinked || (chosen && !chosen.blocked);

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '560px', width: '100%' }}>
        <div className="modal-header">
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Fuel size={18} /> Which vehicle does this fuel?</h2>
            <p style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '0.3rem' }}>
              {itemName} — pick the vehicle this allowance fuels. It lands as one line on that
              vehicle&rsquo;s day and is removed with it. The price is the library charge, not a figure typed here.
            </p>
          </div>
          <button className="close-btn" onClick={onCancel}><X size={20} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '46vh', overflowY: 'auto', padding: '0.25rem 0' }}>
          {options.length === 0 && (
            <p style={{ fontSize: '0.8rem', color: '#b45309', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
              No vehicle is on this trip yet. Add the hire or transfer first, or add the allowance without a vehicle below.
            </p>
          )}
          {options.map((option) => {
            const blocked = !!option.blocked;
            const isSelected = selected === option.key;
            return (
              <label
                key={option.key}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.6rem',
                  border: `1px solid ${isSelected ? '#0d7478' : '#e2e8f0'}`,
                  background: blocked ? '#f8fafc' : (isSelected ? '#f0fdfa' : '#fff'),
                  borderRadius: 8, padding: '0.6rem 0.75rem',
                  cursor: blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.75 : 1
                }}
              >
                <input
                  type="radio"
                  name="fuel-vehicle"
                  style={{ marginTop: '0.2rem' }}
                  disabled={blocked}
                  checked={isSelected}
                  onChange={() => setSelected(option.key)}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: '0.85rem', color: '#1e293b', display: 'block' }}>{option.name}</strong>
                  <small style={{ fontSize: '0.74rem', color: '#64748b' }}>{option.dayLabel}</small>
                  {blocked && (
                    <small style={{ display: 'block', fontSize: '0.74rem', color: '#b91c1c', marginTop: '0.25rem' }}>
                      {fuelBlockMessage(option)}
                    </small>
                  )}
                </span>
              </label>
            );
          })}

          <label
            style={{
              display: 'flex', alignItems: 'center', gap: '0.6rem',
              border: `1px solid ${unlinked ? '#0d7478' : '#e2e8f0'}`,
              background: unlinked ? '#f0fdfa' : '#fff',
              borderRadius: 8, padding: '0.6rem 0.75rem', cursor: 'pointer'
            }}
          >
            <input
              type="radio"
              name="fuel-vehicle"
              checked={unlinked}
              onChange={() => setSelected('__unlinked__')}
            />
            <span style={{ fontSize: '0.82rem', color: '#475569' }}>
              Add without a vehicle — I&rsquo;ll link it later
            </span>
          </label>
        </div>

        <div className="form-actions">
          <button type="button" className="secondary-btn" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="primary-btn"
            disabled={!canConfirm}
            onClick={() => onConfirm(unlinked ? null : chosen)}
          >
            <Fuel size={16} /> Add fuel allowance
          </button>
        </div>
      </div>
    </div>
  );
}