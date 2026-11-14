import { useEffect, useRef } from 'react';
import { LayoutGrid, X, Plus, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';

/* Day navigation shared by the itinerary and package builders.
 *
 * A long trip used to scroll its day cards off to the right, so finding Day 14
 * meant dragging a scrollbar. The rail wraps compact chips instead — every day
 * stays in view and one click jumps to it. The board is the overview layer: a
 * calendar-style grid of every day with its count, value and honest status dots,
 * for when the consultant wants to see the whole trip at once. Both take the same
 * normalized day descriptor so the camelCase itinerary and the snake_case package
 * can reuse them without the component knowing either shape.
 *
 * Descriptor: { key, index, dayNumber, destinationName, destinationLabel,
 *               dateLabel, fullLabel, count, valueLabel, marked,
 *               status: { empty, estimate, guideUnnamed } }
 *
 * destinationName is the short place ("Cape Town") the chip prints, while
 * destinationLabel is the full "Cape Town, South Africa" used in the tooltip and
 * screen-reader text. Both are optional: a day without a destination simply
 * keeps the compact chip. */

function DayStatusDots({ status = {} }) {
  const dots = [];
  if (status.empty) dots.push({ cls: 'empty', label: 'No items yet' });
  if (status.estimate) dots.push({ cls: 'estimate', label: 'Pre-season estimate' });
  if (status.guideUnnamed) dots.push({ cls: 'guide', label: 'Guide not named' });
  if (!dots.length) return null;
  return (
    <span className="day-status-dots" role="img" aria-label={dots.map((d) => d.label).join(', ')}>
      {dots.map((d) => <span key={d.cls} className={`day-dot ${d.cls}`} title={d.label} aria-hidden="true" />)}
    </span>
  );
}

export function DayStepper({ index = 0, count = 0, onPrev, onNext }) {
  if (count <= 1) return null;
  return (
    <div className="day-stepper" role="group" aria-label="Step between days">
      <button type="button" className="day-step-btn" onClick={onPrev} disabled={index <= 0} title="Previous day (Left arrow)" aria-label="Previous day">
        <ChevronLeft size={16} />
      </button>
      <span className="day-step-label">Day {index + 1}<span className="day-step-of"> of {count}</span></span>
      <button type="button" className="day-step-btn" onClick={onNext} disabled={index >= count - 1} title="Next day (Right arrow)" aria-label="Next day">
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

export function DayRail({
  days = [],
  activeIndex = 0,
  onSelect,
  canMark = false,
  onToggleMark,
  onAddDay,
  addDisabled = false,
  onOpenBoard,
  markedCount = 0,
  markedLines = 0,
  bulkArmed = false,
  onBulkDelete,
  onClearMarks,
  showBulk = true,
  variant = 'itinerary',
}) {
  const deleteClass = variant === 'package' ? 'secondary-btn danger' : 'action-btn danger';
  const clearClass = variant === 'package' ? 'secondary-btn' : 'action-btn';
  return (
    <div className="day-rail-wrap">
      <div className="day-rail" role="tablist" aria-label="Days">
        {days.map((d) => (
          <div key={d.key} className={`day-chip-cell${d.marked ? ' marked' : ''}`}>
            {canMark && (
              <input
                type="checkbox"
                className="day-chip-mark"
                checked={d.marked}
                onChange={() => onToggleMark(d.index)}
                title={`Tick Day ${d.dayNumber} to delete it together with the other ticked days`}
                aria-label={`Tick Day ${d.dayNumber} for bulk delete`}
              />
            )}
            <button
              type="button"
              role="tab"
              aria-selected={d.index === activeIndex}
              className={`day-chip${d.index === activeIndex ? ' active' : ''}`}
              onClick={() => onSelect(d.index)}
              title={`Day ${d.dayNumber}${d.destinationLabel ? ` · ${d.destinationLabel}` : ''}${d.dateLabel ? ` · ${d.dateLabel}` : ''} · ${d.count} item${d.count === 1 ? '' : 's'} · ${d.valueLabel}`}
            >
              <span className="day-chip-top">
                <span className="day-chip-num">Day {d.dayNumber}</span>
                <DayStatusDots status={d.status} />
              </span>
              {d.destinationLabel && <span className="day-chip-destination" title={d.destinationLabel}>{d.destinationName || d.destinationLabel}</span>}
              {d.dateLabel && <span className="day-chip-date">{d.dateLabel}</span>}
              <span className="day-chip-value">{d.valueLabel}</span>
            </button>
          </div>
        ))}
        <button type="button" className="day-chip-action add" onClick={onAddDay} disabled={addDisabled} title={addDisabled ? 'Locked — read-only' : 'Add a day'}>
          <Plus size={15} /> Add Day
        </button>
        <button type="button" className="day-chip-action board" onClick={onOpenBoard} title="Open the all-days board">
          <LayoutGrid size={15} /> All days
        </button>
      </div>
      {showBulk && markedCount > 0 && (
        <div className="day-bulk-bar">
          <span className="day-bulk-count">
            {markedCount} day{markedCount === 1 ? '' : 's'} ticked
            {markedLines ? ` · ${markedLines} service line${markedLines === 1 ? '' : 's'} on them` : ''}
          </span>
          <button
            type="button"
            className={`${deleteClass}${bulkArmed ? ' armed' : ''}`}
            onClick={onBulkDelete}
            title="Deleting a day takes every service line worked on it"
          >
            <Trash2 size={15} />
            {bulkArmed
              ? `Click again to delete ${markedCount} day${markedCount === 1 ? '' : 's'}`
              : `Delete ${markedCount} day${markedCount === 1 ? '' : 's'}`}
          </button>
          <button type="button" className={clearClass} onClick={onClearMarks}>Clear</button>
        </div>
      )}
    </div>
  );
}

export function DayBoardModal({ open, days = [], activeIndex = 0, onSelect, onClose, title = 'All days', subtitle = '' }) {
  const gridRef = useRef(null);
  const activeRef = useRef(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!open) { wasOpenRef.current = false; return undefined; }
    if (!wasOpenRef.current && activeRef.current) activeRef.current.focus();
    wasOpenRef.current = true;
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      const grid = gridRef.current;
      if (!grid) return;
      const tiles = Array.from(grid.querySelectorAll('.day-board-tile'));
      if (!tiles.length) return;
      const current = tiles.indexOf(document.activeElement);
      const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length || 1;
      let next = current < 0 ? activeIndex : current;
      if (event.key === 'ArrowLeft') next -= 1;
      else if (event.key === 'ArrowRight') next += 1;
      else if (event.key === 'ArrowUp') next -= columns;
      else if (event.key === 'ArrowDown') next += columns;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tiles.length - 1;
      next = Math.max(0, Math.min(tiles.length - 1, next));
      event.preventDefault();
      tiles[next].focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, activeIndex, onClose]);

  if (!open) return null;
  const hasEstimate = days.some((d) => d.status?.estimate);
  const hasGuide = days.some((d) => d.status?.guideUnnamed);
  const hasEmpty = days.some((d) => d.status?.empty);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content tall day-board" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}><LayoutGrid size={18} /> {title}</h2>
            {subtitle && <p className="day-board-sub">{subtitle}</p>}
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Close the all-days board"><X size={20} /></button>
        </div>
        <div className="modal-body">
          <div className="day-board-grid" ref={gridRef} role="group" aria-label={title}>
            {days.map((d) => (
              <button
                key={d.key}
                type="button"
                ref={d.index === activeIndex ? activeRef : null}
                className={`day-board-tile${d.index === activeIndex ? ' active' : ''}${d.marked ? ' marked' : ''}`}
                onClick={() => onSelect(d.index)}
                aria-label={`Day ${d.dayNumber}${d.destinationLabel ? `, ${d.destinationLabel}` : ''}, ${d.count} item${d.count === 1 ? '' : 's'}, ${d.valueLabel}`}
              >
                <span className="day-board-tile-head">
                  <span className="day-board-num">Day {d.dayNumber}</span>
                  <DayStatusDots status={d.status} />
                </span>
                {d.destinationLabel && <span className="day-board-destination" title={d.destinationLabel}>{d.destinationName || d.destinationLabel}</span>}
                <span className="day-board-date">{d.fullLabel || d.dateLabel || ''}</span>
                <span className="day-board-meta">
                  <span className="day-board-count">{d.count} item{d.count === 1 ? '' : 's'}</span>
                  <span className="day-board-value">{d.valueLabel}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="day-board-legend">
            {hasEstimate && <span><span className="day-dot estimate" aria-hidden="true" /> Pre-season estimate</span>}
            {hasGuide && <span><span className="day-dot guide" aria-hidden="true" /> Guide not named</span>}
            {hasEmpty && <span><span className="day-dot empty" aria-hidden="true" /> No items yet</span>}
            <span className="day-board-hint">Click a day to jump to it · Esc to close</span>
          </div>
        </div>
      </div>
    </div>
  );
}