import { Children, isValidElement, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

const textOf = (node) => {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (isValidElement(node)) return textOf(node.props.children);
  return '';
};

/** Searchable, native-select-compatible dropdown used throughout the app. */
export default function SearchableSelect({
  value,
  defaultValue,
  onChange,
  children,
  className = 'pricing-select',
  style,
  placeholder,
  disabled = false,
  required = false,
  name,
  title,
  id,
  'aria-label': ariaLabel,
  ...inputProps
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef(null);
  const controlled = value !== undefined;
  const selectedValue = String(controlled ? (value ?? '') : (defaultValue ?? ''));
  const options = useMemo(() => Children.toArray(children)
    .filter((child) => isValidElement(child) && child.type === 'option')
    .map((child) => ({
      value: String(child.props.value ?? textOf(child.props.children)),
      label: child.props.children,
      text: textOf(child.props.children),
      disabled: Boolean(child.props.disabled),
      key: child.key ?? String(child.props.value ?? textOf(child.props.children))
    })), [children]);
  const selected = options.find((option) => option.value === selectedValue);
  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return options.filter((option) => !q || option.text.toLocaleLowerCase().includes(q) || option.value.toLocaleLowerCase().includes(q));
  }, [options, query]);

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

  const emitChange = (nextValue) => {
    rootRef.current?.querySelector('input[type="text"]')?.setCustomValidity('');
    if (onChange) onChange({ target: { value: nextValue, name }, currentTarget: { value: nextValue, name } });
    setOpen(false);
    setQuery('');
  };

  const moveActive = (direction) => {
    if (!filtered.length) return;
    let next = activeIndex;
    for (let i = 0; i < filtered.length; i += 1) {
      next = (next + direction + filtered.length) % filtered.length;
      if (!filtered[next].disabled) break;
    }
    setActiveIndex(next);
  };

  return (
    <div className="searchable-select" ref={rootRef} style={{ position: 'relative', width: style?.width ?? '100%', minWidth: 0 }}>
      <div className="searchable-select-control" style={{ position: 'relative' }}>
        <Search className="searchable-select-search-icon" size={15} aria-hidden="true" />
        <input
          {...inputProps}
          id={id}
          type="text"
          className={className}
          style={{ width: '100%', paddingLeft: '2rem', paddingRight: '2.2rem', ...style }}
          value={open ? query : (selected?.text ?? '')}
          placeholder={placeholder ?? (!selected ? options.find((option) => option.value === '')?.text : undefined)}
          title={title}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          autoComplete="off"
          disabled={disabled}
          required={required && !selectedValue}
          onFocus={(event) => {
            inputProps.onFocus?.(event);
            if (!disabled) { setQuery(''); setActiveIndex(0); setOpen(true); }
          }}
          onClick={(event) => {
            inputProps.onClick?.(event);
            if (!disabled && !open) { setQuery(''); setActiveIndex(0); setOpen(true); }
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onInput={(event) => {
            inputProps.onInput?.(event);
            event.currentTarget.setCustomValidity(required && !selectedValue ? 'Please select an option from the list.' : '');
          }}
          onKeyDown={(event) => {
            inputProps.onKeyDown?.(event);
            if (event.defaultPrevented) return;
            if (event.key === 'ArrowDown') { event.preventDefault(); if (!open) setOpen(true); moveActive(1); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); moveActive(-1); }
            else if (event.key === 'Enter' && open) {
              event.preventDefault();
              const exact = filtered.find((option) => option.text.toLocaleLowerCase() === query.trim().toLocaleLowerCase() || option.value.toLocaleLowerCase() === query.trim().toLocaleLowerCase());
              const option = exact || filtered[activeIndex] || filtered.find((entry) => !entry.disabled);
              if (option && !option.disabled) emitChange(option.value);
            } else if (event.key === 'Escape') { setOpen(false); setQuery(''); }
          }}
        />
        <ChevronDown className={`searchable-select-chevron${open ? ' is-open' : ''}`} size={17} aria-hidden="true" />
      </div>
      {name && <input type="hidden" name={name} value={selectedValue} />}
      {open && (
        <div className="searchable-select-menu" role="listbox">
          {filtered.length === 0 ? (
            <div className="searchable-select-empty">No matching options</div>
          ) : filtered.map((option, index) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === selectedValue}
              key={option.key}
              disabled={option.disabled}
              className={`searchable-select-option${option.value === selectedValue ? ' is-selected' : ''}${index === activeIndex ? ' is-active' : ''}`}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => emitChange(option.value)}
            >
              <span>{option.label}</span>
              {option.value === selectedValue && <Check size={15} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
