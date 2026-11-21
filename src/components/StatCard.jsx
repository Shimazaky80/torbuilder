/* ─── Stat card ──────────────────────────────────────────────────────────────
   Takes the icon as a node, not a component, so the tinted box sets `color` and
   lucide's currentColor stroke picks it up. Shared by Dashboard and Analytics
   so both pages render the same card - and so neither can reference a local
   component that was never in its own file.

   Dashboard passes a rendered element (<Users size={18} />), Analytics passes
   the component itself (icon={Users}). Both are accepted: rendering a component
   object as a child is what produced "Objects are not valid as a React child". */

import { createElement, isValidElement } from 'react';

const iconNode = (icon) => {
  if (isValidElement(icon)) return icon;
  if (typeof icon === 'function' || (icon && typeof icon === 'object' && (icon.$$typeof || icon.render))) {
    return createElement(icon);
  }
  return icon;
};

const StatCard = ({ icon, label, value, sub, color = '#0d7478', onClick }) => (
  <div
    className="stat-card"
    onClick={onClick}
    style={{
      position: 'relative',
      overflow: 'hidden',
      cursor: onClick ? 'pointer' : 'default'
    }}
  >
    <div style={{ width: '4px', position: 'absolute', left: 0, top: 0, bottom: 0, background: color, borderRadius: '4px 0 0 4px' }} />
    <div style={{ paddingLeft: '0.5rem', display: 'flex', alignItems: 'center', gap: '1rem', width: '100%' }}>
      <div style={{ background: `${color}18`, borderRadius: '12px', padding: '10px', flexShrink: 0, color }}>
        {iconNode(icon)}
      </div>
      <div className="stat-info">
        <div className="stat-value" style={{ color: '#1a202c' }}>{value}</div>
        <div className="stat-label">{label}</div>
        {sub && <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.1rem' }}>{sub}</div>}
      </div>
    </div>
  </div>
);

export default StatCard;
