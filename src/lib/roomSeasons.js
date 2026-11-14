/* A property's seasons are shared by every room type.

   The library item is the property; its rooms are room types, not separate
   items. A season - its name, validity window, charge types, night bands and
   weekend days - therefore belongs to the property, and every room prices the
   same season with its own money. These helpers keep that structure in one
   place so the editor, the add-room clone and the tests agree.
*/

/* A season is identified by what the operator typed as the season itself. The
   room is deliberately absent: the same season across rooms is one season. */
export const seasonIdentityOf = (season = {}) => [
  String(season.seasonName ?? season.season_name ?? '').trim(),
  String(season.validFrom ?? season.valid_from ?? '').trim(),
  String(season.validTo ?? season.valid_to ?? '').trim()
].join('|');

/* The charge type (room only, half board, ...) a rate row prices. Empty means
   the item's default board, so it is a real, distinct value rather than a gap. */
export const chargeTypeOf = (season = {}) =>
  String(season.optionName ?? season.meal_plan ?? '').trim();

/* Fields that describe the season rather than one room's price. They travel
   together when a season is renamed, redated or cloned. Money never does. */
export const SEASON_SHARED_FIELDS = [
  'seasonName',
  'validFrom',
  'validTo',
  'minNights',
  'maxNights',
  'weekendDays',
  'fuelIncluded'
];

export const sharedSeasonSkeletonOf = (season = {}) => {
  const skeleton = {};
  SEASON_SHARED_FIELDS.forEach((field) => {
    if (season[field] !== undefined) skeleton[field] = season[field];
  });
  return skeleton;
};

/* One room's copy of a season: the shared structure plus the room it prices. */
export const seasonForRoom = (season, roomKey = '') => ({
  ...sharedSeasonSkeletonOf(season),
  optionName: chargeTypeOf(season),
  roomKey: roomKey || ''
});

/* Group rate rows into the property's seasons. The identity ignores the room,
   so the same season across rooms folds into one group. `memberIndices` is
   scoped to the room being edited (or every row when no room is given), while
   `sharedMemberIndices` always names every room's rows so an edit to the shared
   season reaches them all. */
export const sharedSeasonGroupsFor = (seasons, roomKey = '') => {
  const groups = [];
  const byKey = new Map();
  (seasons || []).forEach((season, index) => {
    const key = seasonIdentityOf(season);
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        seasonName: season.seasonName,
        validFrom: season.validFrom,
        validTo: season.validTo,
        roomKey: '',
        roomKeys: [],
        chargeNames: [],
        memberIndices: [],
        sharedMemberIndices: []
      });
      groups.push(byKey.get(key));
    }
    const group = byKey.get(key);
    const room = season.roomKey || '';
    const charge = chargeTypeOf(season);
    group.sharedMemberIndices.push(index);
    if (!group.roomKeys.includes(room)) group.roomKeys.push(room);
    if (!group.chargeNames.includes(charge)) group.chargeNames.push(charge);
    if (!roomKey || room === roomKey) {
      group.memberIndices.push(index);
      group.roomKey = room;
    }
  });
  /* A room with no row in a season is not shown that season: it has no rates
     for it yet, and borrowing another room's row would misprice the room. */
  return roomKey ? groups.filter((group) => group.memberIndices.length) : groups;
};

/* Every row that shares a season's identity, regardless of room. Renaming or
   redating a season must land on all of them. */
export const seasonRowsWithIdentity = (seasons, identity) =>
  (seasons || [])
    .map((season, index) => ({ season, index }))
    .filter(({ season }) => seasonIdentityOf(season) === identity);

/* Rows that carry the same season AND the same charge type. A night band or
   weekend rule is shared across rooms but stays per charge type, because half
   board and full board are separate contracts within one season. */
export const seasonChargeRows = (seasons, identity, chargeType = '') => {
  const charge = String(chargeType ?? '').trim();
  return (seasons || [])
    .map((season, index) => ({ season, index }))
    .filter(({ season }) => seasonIdentityOf(season) === identity && chargeTypeOf(season) === charge);
};

/* The season skeleton every room must carry. Given a property's seasons,
   return one skeleton per distinct season/charge pair so a new room can price
   the same seasons from blank money. */
export const seasonSkeletonsFor = (seasons) => {
  const skeletons = [];
  sharedSeasonGroupsFor(seasons).forEach((group) => {
    const rows = group.sharedMemberIndices.map((index) => seasons[index]);
    const chargeTypes = [...new Set(rows.map(chargeTypeOf))];
    (chargeTypes.length ? chargeTypes : ['']).forEach((charge) => {
      const source = rows.find((row) => chargeTypeOf(row) === charge) || rows[0];
      skeletons.push({ ...sharedSeasonSkeletonOf(source), optionName: charge });
    });
  });
  return skeletons;
};
