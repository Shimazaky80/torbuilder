import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

/* A filter that keeps several values on at once. An itinerary or package usually
   covers more than one island, so the operator wants Mauritius AND Rodrigues on
   the same list rather than re-picking the dropdown for each stop. */
export default function MultiSelectFilter({
  label,
  options = [],
  value,
  onChange,
  placeholder = 'All',
  searchPlaceholder = 'Search…',
  className = '',
  emptyText = 'Nothing to choose yet.'
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  const selected = useMemo(() => (value || []).filter(Boolean), [value]);

  useEffect(() => {
    const onDocumentMouseDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDocumentMouseDown);
    return () => document.removeEventListener('mousedown', onDocumentMouseDown);
  }, []);

  const toggle = (option) => {
    onChange(selected.includes(option) ? selected.filter((entry) => entry !== option) : [...selected, option]);
  };

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? options.filter((option) => option.toLowerCase().includes(term)) : options;
  }, [options, query]);

  const summary = !selected.length
    ? placeholder
    : selected.length === 1
      ? selected[0]
      : `${selected.length} selected`;

  return (
    <div
      className={`multi-select-filter ${className}`}
      ref={rootRef}
      onKeyDown={(event) => { if (event.key === 'Escape' && open) close(); }}
    >
      <strong>{label}</strong>
      <button
        type="button"
        className={`multi-select-trigger ${selected.length ? 'has-selection' : ''}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => { setOpen((was) => !was); setQuery(''); }}
      >
        <span title={selected.join(', ') || placeholder}>{summary}</span>
        <ChevronDown size={15} className={`multi-select-chevron ${open ? 'open' : ''}`} />
      </button>
      {selected.length > 1 && (
        <div className="multi-select-chips">
          {selected.map((entry) => (
            <button key={entry} type="button" className="multi-select-chip" onClick={() => toggle(entry)} title={`Stop filtering by ${entry}`}>
              {entry} <X size={11} />
            </button>
          ))}
        </div>
      )}
      {open && (
        <div className="multi-select-menu" role="listbox" aria-multiselectable="true">
          <div className="multi-select-search">
            <Search size={14} />
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} />
          </div>
          <div className="multi-select-options">
            {visible.map((option) => (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={selected.includes(option)}
                className={`multi-select-option ${selected.includes(option) ? 'is-selected' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => toggle(option)}
              >
                <span>{option}</span>
                {selected.includes(option) && <Check size={14} />}
              </button>
            ))}
            {!visible.length && <p className="multi-select-empty">{query ? 'No match.' : emptyText}</p>}
          </div>
          <div className="multi-select-foot">
            {!!selected.length && (
              <button type="button" className="multi-select-clear" onClick={() => onChange([])}>Show every destination</button>
            )}
            <button type="button" className="multi-select-done" onClick={close}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
