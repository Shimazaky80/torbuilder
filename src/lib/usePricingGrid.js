import { useCallback, useMemo, useState } from 'react';
import { seedBandsForSeats } from './packagePricing';

/* The grid is an operator's working view and holds no stored content: the columns come
   from the company's vehicle types, seeded to the first MAX_COLUMNS smallest, and the bands
   are seeded per column (D20) and free to edit. Nothing here reaches the database. Seeding
   is derived rather than written into an effect, so an empty pick never fights a late-arriving
   vehicle list. The state lives above the tabs, so the Pricing & seasons tab (editing)
   and the Presentation pricing tab (presentation) read one and the same grid.

   A package may carry its own vehicle_columns (chosen at creation): when present, those codes
   seed the columns instead of the first MAX_COLUMNS smallest, so each package presents the
   vehicles the operator picked for it. Codes that no longer exist in Settings are kept anyway,
   so the presentation stays stable, and an operator override in the grid still wins. */
export const MAX_GRID_COLUMNS = 6;

const seatsOf = (code, vehicleTypes = []) => Number((vehicleTypes || []).find((type) => type?.code === code)?.max_capacity) || 0;

export const usePricingGrid = (vehicleTypes = [], storedColumns = []) => {
  const [customSlots, setCustomSlots] = useState(() => Array(MAX_GRID_COLUMNS).fill(null));
  const [bandEdits, setBandEdits] = useState({});

  const defaultSlots = useMemo(
    () => {
      const stored = Array.isArray(storedColumns) ? storedColumns.filter(Boolean) : [];
      if (stored.length) {
        const seen = [];
        for (const code of stored) if (code && !seen.includes(code)) seen.push(code);
        return seen.slice(0, MAX_GRID_COLUMNS);
      }
      return (vehicleTypes || []).map((type) => type?.code).filter(Boolean).slice(0, MAX_GRID_COLUMNS);
    },
    [storedColumns, vehicleTypes]
  );
  /* A column customized by the operator keeps its choice; a column never touched follows the
     vehicle list, so the grid picks up a new type added in Settings without losing overrides.
     An explicitly emptied column (stored as '') stays empty instead of refilling from defaults. */
  const slots = useMemo(
    () => customSlots.map((custom, index) => {
      if (custom === '') return null;
      return custom ?? defaultSlots[index] ?? null;
    }),
    [customSlots, defaultSlots]
  );
  const usedCodes = useMemo(() => slots.filter(Boolean), [slots]);
  const bands = useMemo(() => {
    const out = {};
    for (const code of usedCodes) {
      const seats = seatsOf(code, vehicleTypes);
      /* A band in the working grid is never smaller than two travellers (margin guard), but
         it can never exceed the vehicle's seats either. The guard is a rule of this grid: the
         party sizes a package has already saved are read from their own rows and are never
         rewritten by it. */
      out[code] = (bandEdits[code] || seedBandsForSeats(seats))
        .map((pax) => seats ? Math.min(seats, Math.max(2, Math.floor(pax))) : Math.max(2, Math.floor(pax)));
    }
    return out;
  }, [usedCodes, bandEdits, vehicleTypes]);

  const changeSlot = useCallback((index, code) => {
    setCustomSlots((previous) => previous.map((value, slotIndex) => (slotIndex === index ? code || '' : value)));
  }, []);
  const changeBand = useCallback((code, bandIndex, rawValue) => {
    const pax = Number(rawValue);
    const seats = seatsOf(code, vehicleTypes);
    const minPax = seats ? Math.min(seats, 2) : 2;
    if (!Number.isFinite(pax) || pax < minPax) return;
    const nextPax = seats ? Math.min(seats, Math.max(2, Math.floor(pax))) : Math.max(2, Math.floor(pax));
    setBandEdits((previous) => {
      const current = previous[code] || seedBandsForSeats(seats);
      return { ...previous, [code]: current.map((value, index) => (index === bandIndex ? nextPax : value)) };
    });
  }, [vehicleTypes]);

  return { customSlots, bandEdits, defaultSlots, slots, usedCodes, bands, changeSlot, changeBand };
};