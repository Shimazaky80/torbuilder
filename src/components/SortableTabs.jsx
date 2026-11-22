/* eslint-disable react-refresh/only-export-components -- the storage helpers are
   exported next to the tab bar so a page only needs one import. */
import { useMemo, useRef, useState } from 'react';
import { GripVertical } from 'lucide-react';

const readLocal = (key) => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeLocal = (key, value) => {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
  } catch {
    /* Storage can be disabled or full; reordering still works for this session. */
  }
};

/* The active tab is a plain string. A stored value that is no longer one of the
   visible sections is a leftover from an older build, so it falls back. */
export const readStoredTab = (storageKey, validIds, fallback) => {
  const allowed = Array.isArray(validIds) ? validIds : [];
  const stored = readLocal(`${storageKey}.active`);
  if (allowed.includes(stored)) return stored;
  return allowed.includes(fallback) ? fallback : (allowed[0] ?? fallback);
};

export const writeStoredTab = (storageKey, id) => {
  writeLocal(`${storageKey}.active`, String(id));
};

/* Order is the visible sections in the order the person chose. A section added
   later joins the end and one that no longer exists drops out, so a save from an
   older build does not throw the whole choice away. Unknown ids and duplicates
   are ignored; malformed JSON falls back to the canonical order from `tabs`. */
const readStoredOrder = (storageKey, canonicalIds) => {
  const raw = readLocal(`${storageKey}.order`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const allowed = new Set(canonicalIds);
    const kept = [];
    parsed.forEach((id) => {
      if (allowed.has(id) && !kept.includes(id)) kept.push(id);
    });
    return kept.length ? kept : null;
  } catch {
    return null;
  }
};

const SortableTabs = ({ tabs = [], value, onChange, storageKey, ariaLabel = 'Sections' }) => {
  const canonicalIds = useMemo(() => tabs.map((tab) => tab.id), [tabs]);
  const [order, setOrder] = useState(() => readStoredOrder(storageKey, canonicalIds) || canonicalIds);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const dragIdRef = useRef(null);
  const tabRefs = useRef({});

  /* A section added in a later build joins the end of the saved order; a removed
     one drops out. The stored order itself is only rewritten on an actual drop. */
  const orderedTabs = useMemo(() => {
    const allowed = new Set(canonicalIds);
    const kept = order.filter((id) => allowed.has(id));
    return [...kept, ...canonicalIds.filter((id) => !kept.includes(id))]
      .map((id) => tabs.find((tab) => tab.id === id))
      .filter(Boolean);
  }, [order, canonicalIds, tabs]);

  const handleDragStart = (event, id) => {
    dragIdRef.current = id;
    setDragId(id);
    if (event.dataTransfer) {
      try {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', id);
      } catch { /* Firefox-safe / partially mocked transfer objects */ }
    }
  };

  const handleDragOver = (event, id) => {
    event.preventDefault();
    if (event.dataTransfer) {
      try { event.dataTransfer.dropEffect = 'move'; } catch { /* ignore */ }
    }
    if (overId !== id) setOverId(id);
  };

  const handleDrop = (event, targetId) => {
    event.preventDefault();
    const from = dragIdRef.current;
    dragIdRef.current = null;
    setDragId(null);
    setOverId(null);
    if (!from || from === targetId) return;
    const ids = orderedTabs.map((tab) => tab.id);
    const fromIndex = ids.indexOf(from);
    const targetIndex = ids.indexOf(targetId);
    if (fromIndex < 0 || targetIndex < 0) return;
    ids.splice(fromIndex, 1);
    ids.splice(targetIndex, 0, from);
    setOrder(ids);
    writeLocal(`${storageKey}.order`, JSON.stringify(ids));
  };

  const handleDragEnd = () => {
    dragIdRef.current = null;
    setDragId(null);
    setOverId(null);
  };

  const handleKeyDown = (event, index) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = orderedTabs[(index + step + orderedTabs.length) % orderedTabs.length];
    if (!next) return;
    onChange(next.id);
    tabRefs.current[next.id]?.focus();
  };

  return (
    <nav className="sortable-tabs" role="tablist" aria-label={ariaLabel}>
      {orderedTabs.map((tab, index) => {
        const Icon = tab.icon;
        const active = tab.id === value;
        const isOver = Boolean(dragId) && dragId !== tab.id && overId === tab.id;
        return (
          <button
            key={tab.id}
            ref={(node) => { tabRefs.current[tab.id] = node; }}
            type="button"
            role="tab"
            className={`sortable-tab${active ? ' active' : ''}${isOver ? ' drag-over' : ''}`}
            aria-selected={active}
            aria-label={tab.ariaLabel || tab.label}
            tabIndex={active ? 0 : -1}
            draggable
            title={`${tab.label} — drag to reorder`}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            onDragStart={(event) => handleDragStart(event, tab.id)}
            onDragOver={(event) => handleDragOver(event, tab.id)}
            onDragEnter={(event) => handleDragOver(event, tab.id)}
            onDragLeave={() => { if (overId === tab.id) setOverId(null); }}
            onDrop={(event) => handleDrop(event, tab.id)}
            onDragEnd={handleDragEnd}
          >
            <GripVertical className="sortable-tab-drag-icon" size={14} aria-hidden="true" />
            {Icon && <Icon size={16} aria-hidden="true" />}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

export default SortableTabs;
