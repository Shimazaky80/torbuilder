import { useState } from 'react';
import { Fuel, X } from 'lucide-react';

/* A vehicle whose tariff excludes fuel was just dropped.
 *
 * The contract says fuel is not in the price, so the operator is offered the
 * chance to add an allowance now rather than remembering it later. The choices
 * are the tenant's own Extras items that carry a fuel charge — each priced in
 * the library, so picking one drops it at its contracted figure with no maths
 * here. "Not now" leaves the vehicle as it is; the allowance can still be
 * dropped from the sidebar at any time. */
export default function FuelForVehicleModal({ vehicleName = 'This vehicle', items = [], onConfirm, onCancel }) {
  const [selected, setSelected] = useState('');
  const chosen = items.find((item) => item.id === selected) || null;

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '560px', width: '100%' }}>
        <div className="modal-header">
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Fuel size={18} /> Add a fuel allowance?</h2>
            <p style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '0.3rem' }}>
              {vehicleName}&rsquo;s tariff excludes fuel, so the client pays for it separately.
              Pick one of your fuel charges to add as a line linked to this vehicle, or skip it for now.
            </p>
          </div>
          <button className="close-btn" onClick={onCancel}><X size={20} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '46vh', overflowY: 'auto', padding: '0.25rem 0' }}>
          {items.length === 0 && (
            <p style={{ fontSize: '0.8rem', color: '#b45309', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
              No Extras item with a fuel charge is in the library yet. Add one under Library Items
              (category Extras, charge type &ldquo;Fuel allowance&rdquo;) and it will appear here.
            </p>
          )}
          {items.map((item) => {
            const isSelected = selected === item.id;
            return (
              <label
                key={item.id}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.6rem',
                  border: `1px solid ${isSelected ? '#0d7478' : '#e2e8f0'}`,
                  background: isSelected ? '#f0fdfa' : '#fff',
                  borderRadius: 8, padding: '0.6rem 0.75rem', cursor: 'pointer'
                }}
              >
                <input
                  type="radio"
                  name="fuel-item"
                  style={{ marginTop: '0.2rem' }}
                  checked={isSelected}
                  onChange={() => setSelected(item.id)}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: '0.85rem', color: '#1e293b', display: 'block' }}>{item.name}</strong>
                  <small style={{ fontSize: '0.74rem', color: '#64748b' }}>
                    {[item.supplier?.name || item.supplier_name, 'priced in the library'].filter(Boolean).join(' · ')}
                  </small>
                </span>
              </label>
            );
          })}
        </div>

        <div className="form-actions">
          <button type="button" className="secondary-btn" onClick={() => onConfirm(null)}>Not now</button>
          <button
            type="button"
            className="primary-btn"
            disabled={!chosen}
            onClick={() => onConfirm(chosen)}
          >
            <Fuel size={16} /> Add allowance
          </button>
        </div>
      </div>
    </div>
  );
}