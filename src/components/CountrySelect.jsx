import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check } from 'lucide-react';

const CountrySelect = ({ value, onChange, countries, placeholder }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = open && query
    ? countries.filter(c =>
        c.toLowerCase().startsWith(query.toLowerCase()) ||
        c.toLowerCase().includes(query.toLowerCase())
      )
    : countries;

  const selectCountry = (name) => {
    onChange(name);
    setOpen(false);
    setQuery('');
  };

  return (
    <div style={{ position: 'relative' }} ref={rootRef}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          border: '1px solid #e2e8f0',
          borderRadius: '10px',
          background: '#f8fafc',
          cursor: 'text'
        }}
      >
        <input
          type="text"
          className="pricing-select"
          style={{ border: 'none', background: 'transparent', boxShadow: 'none', paddingRight: '2.2rem' }}
          placeholder={placeholder}
          value={open ? query : value}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { setOpen(true); setQuery(''); }}
          onClick={() => { if (!open) { setOpen(true); setQuery(''); } }}
        />
        <ChevronDown
          size={18}
          color="#64748b"
          style={{ position: 'absolute', right: '0.85rem', cursor: 'pointer', transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none' }}
          onClick={() => setOpen(o => !o)}
        />
      </div>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            maxHeight: '220px',
            overflowY: 'auto',
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
            zIndex: 30
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: '0.75rem 1rem', color: '#94a3b8', fontSize: '0.85rem' }}>
              No countries match "{query}"
            </div>
          ) : filtered.slice(0, 50).map(name => (
            <div
              key={name}
              onClick={() => selectCountry(name)}
              style={{
                padding: '0.55rem 1rem',
                cursor: 'pointer',
                fontSize: '0.85rem',
                color: value === name ? '#0d7478' : '#334155',
                fontWeight: value === name ? 700 : 400,
                background: value === name ? '#f0fdfa' : '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = value === name ? '#f0fdfa' : '#fff'; }}
            >
              <span>{name}</span>
              {value === name && <Check size={15} color="#0d7478" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CountrySelect;