/* Contract single-supplement ladder.
 *
 * A property may charge the sharing rate for the first N single rooms and add
 * the single supplement only from room N+1. Some contracts price the rooms after
 * the waiver at a different amount again, so the rule is a ladder:
 *
 *   single_supplement_tiers = [
 *     { singles: 2, supplement: 0 },    // singles 1-2 waived
 *     { singles: 4, supplement: 150 }   // singles 3-4 take a 150 supplement
 *   ]
 *
 * Each tier states the TOTAL number of single rooms covered once the ladder
 * reaches it, and the supplement charged for the single rooms that tier adds. A
 * tier never shrinks the coverage of the tier before it. A supplement of 0 is a
 * waiver. Singles beyond the last tier pay the season's own single supplement.
 *
 * The count is per night: each accommodation line is priced on its own. Only
 * paying clients consume a slot; staff, guide/driver and tour-leader rooms are
 * charged by their own rules.
 */

const has = (value) => value !== null && value !== undefined && value !== '';

/* The waiver is a contract rule, so it must survive even where the optional
   single_supplement_tiers column has not been added yet. It travels in the rate
   notes as a marker and is always stripped before notes are shown. */
const WAIVER_NOTE = /\[\[\s*waiver\s*:\s*(\d+)\s*\]\]/i;

export const waiverNoteCount = (notes) => {
  const match = String(notes ?? '').match(WAIVER_NOTE);
  return match ? Math.max(0, parseInt(match[1], 10) || 0) : 0;
};

export const stripWaiverNote = (notes) => String(notes ?? '').replace(WAIVER_NOTE, '').replace(/\s+/g, ' ').trim();

export const withWaiverNote = (notes, count) => {
  const cleaned = stripWaiverNote(notes);
  const waived = Math.max(0, Math.round(Number(count) || 0));
  if (!waived) return cleaned || null;
  return `${cleaned ? `${cleaned} ` : ''}[[waiver:${waived}]]`;
};

export const normaliseSingleSupplementLadder = (rate) => {
  const stored = Array.isArray(rate?.single_supplement_tiers) ? rate.single_supplement_tiers : [];
  /* A database without the ladder column keeps the waiver in the notes. The
     column always wins when it carries tiers, so the two cannot drift. */
  const source = stored.length
    ? stored
    : (() => {
        const waived = waiverNoteCount(rate?.notes);
        return waived > 0 ? [{ singles: waived, supplement: 0 }] : [];
      })();
  const tiers = source
    .filter((tier) => tier && has(tier.supplement) && Number.isFinite(Number(tier.supplement)))
    .map((tier) => ({
      singles: Math.max(1, Math.round(Number(tier.singles ?? tier.singleRooms ?? tier.rooms) || 1)),
      supplement: Number(tier.supplement)
    }))
    .sort((a, b) => a.singles - b.singles);
  let covered = 0;
  return tiers.map((tier) => {
    covered = Math.max(covered, tier.singles);
    return { singles: covered, supplement: tier.supplement };
  });
};

/* The supplement a solitary guest pays once the ladder no longer covers them.
   A property that states a positive supplement outright wins; otherwise it is
   the gap between the single and sharing rates, which is the figure the old room
   engine already charged. A stored 0 is treated as unset because the column
   defaults to 0, so it cannot be told apart from a blank field. */
export const baseSingleSupplement = (rate, sharing, single) => {
  const stated = Number(rate?.single_supplement);
  if (has(rate?.single_supplement) && Number.isFinite(stated) && stated !== 0) return stated;
  return Math.max(0, (Number(single) || 0) - (Number(sharing) || 0));
};

/* The supplement for one single room, counting from 1. Returns the tier figure
   while the ladder covers the room and the base afterwards. A missing / zero
   ordinal (an empty or non-single room) never consumes a tier. */
export const singleSupplementForOrdinal = (ladder, base, ordinal) => {
  if (!(Number(ordinal) >= 1)) return 0;
  const tier = (Array.isArray(ladder) ? ladder : []).find((entry) => ordinal <= entry.singles);
  return tier ? tier.supplement : base;
};

/* The trip-wide ladder for a package presentation: every accommodation on the
   trip contributes at each single-room ordinal, so a party with two singles
   pays the second tier of both properties. Boundaries are the union of the
   properties' tiers; between boundaries each property's figure is constant. */
export const combineSingleSupplements = (rows = []) => {
  const list = (Array.isArray(rows) ? rows : [])
    .filter(Boolean)
    .map((row) => ({
      base: Number(row.supplement) || 0,
      ladder: Array.isArray(row.ladder) ? row.ladder : []
    }));
  const base = list.reduce((sum, row) => sum + row.base, 0);
  const boundaries = [...new Set(list.flatMap((row) => row.ladder.map((tier) => tier.singles)))]
    .filter((singles) => singles >= 1)
    .sort((a, b) => a - b);
  const tiers = boundaries.map((singles) => ({
    singles,
    supplement: list.reduce((sum, row) => sum + singleSupplementForOrdinal(row.ladder, row.base, singles), 0)
  }));
  return { base, tiers };
};

/* Total supplement for `count` single rooms, in room order. */
export const totalSingleSupplement = (ladder, base, count) => {
  const rooms = Math.max(0, Math.round(Number(count) || 0));
  let total = 0;
  for (let ordinal = 1; ordinal <= rooms; ordinal += 1) {
    total += singleSupplementForOrdinal(ladder, base, ordinal);
  }
  return total;
};

/* The sidebar rate card asks one question: how many single rooms should the
   property waive before the single rate applies? Store the answer as a single
   zero-supplement tier, the shape every pricing path already reads. */
export const waiverLadder = (count) => {
  const waived = Math.max(0, Math.round(Number(count) || 0));
  return waived > 0 ? [{ singles: waived, supplement: 0 }] : [];
};

/* The waiver a saved rate row represents, read back into the editor. A legacy
   ladder with reduced tiers keeps its leading waiver; the extra tiers no longer
   have an editor, so re-saving collapses them to the waiver. */
export const waiverFromLadder = (rate) => {
  let waived = 0;
  for (const tier of normaliseSingleSupplementLadder(rate)) {
    if (tier.supplement !== 0) break;
    waived = tier.singles;
  }
  return waived;
};

/* Plain-language reading of a ladder for the one-line supplement cells: leading
   zero tiers are waivers, the first tier above zero is the figure the later
   singles pay, and `beyond` is the base once the ladder runs out. */
export const singleSupplementLadderSummary = (tiers = [], base = 0) => {
  const list = (Array.isArray(tiers) ? tiers : [])
    .filter((tier) => tier && Number(tier.singles) >= 1)
    .sort((a, b) => Number(a.singles) - Number(b.singles));
  let waived = 0;
  let index = 0;
  while (index < list.length && Number(list[index].supplement) === 0) {
    waived = Number(list[index].singles);
    index += 1;
  }
  const firstCharged = index < list.length ? list[index] : null;
  return {
    waived,
    nextSupplement: firstCharged ? Number(firstCharged.supplement) : null,
    nextSingles: firstCharged ? Number(firstCharged.singles) : null,
    beyond: Number(base) || 0
  };
};
