/* The car-hire spec grid: six columns, the icon on top and the answer below.

   One component for three jobs - the Library editor, the drop dialog preview and
   any on-screen document - so a car cannot be described one way on the contract
   and another way on the voucher. The printed documents use carSpecGridHtml from
   the same module, which is why the geometry lives there rather than here. */
import { createElement } from 'react';
import { CAR_SPEC_ORDER, CAR_SPEC_TITLES, carSpecIconNodes, carSpecValue } from '../lib/carSpecIcons';

const Glyph = ({ name, size = 18, color = '#0891b2' }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ verticalAlign: 'middle', display: 'inline-block' }}
    aria-hidden="true"
  >
    {carSpecIconNodes(name).map(([tag, attrs], index) =>
      createElement(tag, { ...attrs, key: `${name}-${index}` })
    )}
  </svg>
);

const Choice = ({ active, onClick, disabled, children, label }) => (
  <button
    type="button"
    title={label}
    disabled={disabled}
    onClick={onClick}
    style={{
      padding: '0.2rem 0.45rem',
      borderRadius: 6,
      fontSize: '0.72rem',
      fontWeight: 800,
      cursor: disabled ? 'default' : 'pointer',
      border: active ? '1px solid #0891b2' : '1px solid #cbd5e1',
      background: active ? '#0891b2' : '#ffffff',
      color: active ? '#ffffff' : '#64748b',
      opacity: disabled ? 0.5 : 1
    }}
  >
    {children}
  </button>
);

const CountInput = ({ value, onChange, disabled, label }) => (
  <input
    type="number"
    min="0"
    aria-label={label}
    disabled={disabled}
    value={value ?? ''}
    onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
    style={{
      width: 54,
      padding: '0.2rem 0.3rem',
      textAlign: 'center',
      fontSize: '0.82rem',
      fontWeight: 800,
      color: '#0e7490',
      border: '1px solid #67e8f9',
      borderRadius: 6,
      background: '#ffffff'
    }}
  />
);

const ValueCell = ({ id, spec, onChange, disabled }) => {
  const shown = carSpecValue(spec, id);
  if (onChange) {
    if (id === 'gear') {
      return (
        <span style={{ display: 'inline-flex', gap: '0.2rem' }}>
          <Choice label="Manual" active={shown === 'M'} disabled={disabled} onClick={() => onChange('gear', 'manual')}>M</Choice>
          <Choice label="Automatic" active={shown === 'A'} disabled={disabled} onClick={() => onChange('gear', 'automatic')}>A</Choice>
        </span>
      );
    }
    if (id === 'fuel') {
      return (
        <span style={{ display: 'inline-flex', gap: '0.2rem' }}>
          <Choice label="Fuel" active={shown === 'F'} disabled={disabled} onClick={() => onChange('fuelType', 'fuel')}>F</Choice>
          <Choice label="Electric" active={shown === 'E'} disabled={disabled} onClick={() => onChange('fuelType', 'electric')}>E</Choice>
        </span>
      );
    }
    if (id === 'aircon') {
      return (
        <Choice
          label={shown === 'cross' ? 'No air conditioning - make it yes' : 'Air conditioned - make it no'}
          active={shown === 'tick'}
          disabled={disabled}
          onClick={() => onChange('aircon', shown === 'cross')}
        >
          <Glyph name={shown === 'cross' ? 'cross' : 'tick'} size={13} color={shown === 'cross' ? '#64748b' : '#ffffff'} />
        </Choice>
      );
    }
    const field = { luggage: 'luggage', doors: 'doors', passengers: 'passengers' }[id];
    return <CountInput label={CAR_SPEC_TITLES[id]} disabled={disabled} value={spec?.[field]} onChange={(next) => onChange(field, next)} />;
  }
  if (shown === 'tick' || shown === 'cross') {
    return <Glyph name={shown} size={16} color={shown === 'tick' ? '#0891b2' : '#94a3b8'} />;
  }
  return <strong style={{ fontSize: '0.85rem', color: shown ? '#0e7490' : '#94a3b8' }}>{shown || '—'}</strong>;
};

export default function CarSpecGrid({ spec, onChange, disabled = false, color = '#0891b2', size = 18 }) {
  return (
    <div
      className="car-spec-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${CAR_SPEC_ORDER.length}, minmax(56px, 1fr))`,
        gap: 1,
        border: '1px solid #67e8f9',
        borderRadius: 10,
        overflow: 'hidden',
        width: 'fit-content'
      }}
    >
      {CAR_SPEC_ORDER.map((id) => (
        <div
          key={`${id}-icon`}
          title={CAR_SPEC_TITLES[id]}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.4rem 0.25rem', background: '#e0f7fb', borderBottom: '1px solid #a5f3fc' }}
        >
          <Glyph name={id === 'fuel' && carSpecValue(spec, 'fuel') === 'E' ? 'electric' : id} size={size} color={color} />
        </div>
      ))}
      {CAR_SPEC_ORDER.map((id) => (
        <div
          key={`${id}-value`}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.3rem 0.25rem', background: '#f0fdff', minHeight: 30 }}
        >
          <ValueCell id={id} spec={spec} onChange={onChange} disabled={disabled} />
        </div>
      ))}
    </div>
  );
}
