/* The shared vocabulary: national rows plus the company's own.

   Tour types and vehicle sizes are the platform's words, not each tenant's data,
   so they are seeded once with company_id IS NULL and read by every tenant. A row
   that carries a company id is that company's own - either a type the national
   list has never heard of, or its override of a national row with the same key.

   The override wins. A company that renamed "Combi" to "16-seater Combi" sells the
   name its staff typed, and the rate rows keyed on the vehicle code still resolve,
   because an override keeps the key and changes only the fields a person edits.

   Reads are the easy half: the query asks for the shared rows and the company's
   own, and row-level security hides everybody else's. Writes are the guarded half:
   a tenant never edits a shared row, so the first change to one becomes an
   override in their own name, and undoing that change deletes the override rather
   than touching the shared row back. */

export const TOUR_TYPES = {
  table: 'company_tour_types',
  columns: 'id, company_id, name, is_active',
  keyColumn: 'name',
  label: 'tour type',
  orderBy: ['name', { ascending: true }]
};

export const VEHICLE_TYPES = {
  table: 'company_vehicle_types',
  columns: 'id, company_id, code, name, max_capacity, is_active, sort_order',
  keyColumn: 'code',
  label: 'vehicle type',
  orderBy: ['max_capacity', { ascending: true }]
};

/* The key that decides which rows are the same type. A vehicle's is its stable
   code, because price maps are keyed on it; a tour type carries no code, so its
   name is the key, compared the way the database's unique index compares it. */
export const vocabularyKey = (row, keyColumn) => (
  keyColumn === 'name'
    ? String(row?.name || '').trim().toLowerCase()
    : String(row?.code || '').trim()
);

export const isSharedVocabulary = (row) => !row?.company_id;

/* Merge the two lists the query returned into the one a person reads.

   The company's row replaces the shared row of the same key, and the result says
   which of the two it is: `shared` for a row straight off the national list, and
   an override that keeps the shared row's id in `nationalId` so the UI can offer
   to drop the override and take the national answer back.

   Two passes, so it does not matter which half the database happened to return
   first - a company row read before its standard twin still knows it is an
   override. The list is then re-sorted, because an override can change the very
   field the query ordered on: renaming a 6-seat combi to a 16-seater moves it. */
export const mergeVocabulary = (rows, keyColumn = 'code') => {
  const standardByKey = new Map();
  (rows || []).forEach((row) => {
    const key = vocabularyKey(row, keyColumn);
    if (key && isSharedVocabulary(row) && !standardByKey.has(key)) standardByKey.set(key, row);
  });

  const byKey = new Map();
  (rows || []).forEach((row) => {
    const key = vocabularyKey(row, keyColumn);
    if (!key) return;
    if (isSharedVocabulary(row)) {
      if (!byKey.has(key)) byKey.set(key, { ...row, shared: true, overridden: false, nationalId: null });
      return;
    }
    const standard = standardByKey.get(key);
    byKey.set(key, { ...row, shared: false, overridden: !!standard, nationalId: standard ? standard.id : null });
  });

  const merged = [...byKey.values()];
  return keyColumn === 'name'
    ? merged.sort((a, b) => String(a.name).localeCompare(String(b.name), 'en'))
    : merged.sort((a, b) => (Number(a.max_capacity) - Number(b.max_capacity)) || (Number(a.sort_order) - Number(b.sort_order)));
};

/* The PostgREST filter that reads both halves. A session with no company (a super
   admin on the platform console) sees the shared list and nothing else, which is
   the honest answer - they are not pricing anybody's work. */
export const vocabularyReadFilter = (companyId) => (
  companyId ? `company_id.is.null,company_id.eq.${companyId}` : 'company_id.is.null'
);

/* The payload that turns a shared row into this company's override of it.

   The key travels unchanged - that is what makes the new row an override rather
   than a second type - and only the fields a person edited are written on top of
   the shared values. So renaming a vehicle keeps its code, which is why the price
   maps still resolve; and because a tour type's key IS its name, an override of
   one can only change whether it is active. */
export const vocabularyOverridePayload = (sharedRow, changes = {}, companyId, keyColumn = 'code') => {
  const carried = {};
  if (sharedRow.code) carried.code = sharedRow.code;
  if (sharedRow.name) carried.name = sharedRow.name;
  if (sharedRow.max_capacity !== undefined && sharedRow.max_capacity !== null) carried.max_capacity = sharedRow.max_capacity;
  if (sharedRow.is_active !== undefined && sharedRow.is_active !== null) carried.is_active = sharedRow.is_active;
  if (sharedRow.sort_order !== undefined && sharedRow.sort_order !== null) carried.sort_order = sharedRow.sort_order;
  const payload = { company_id: companyId, ...carried, ...changes };
  if (keyColumn === 'name') payload.name = sharedRow.name;
  else payload.code = sharedRow.code;
  return payload;
};

/* The vehicle list a price grid is built along: active rows only, smallest first,
   because a quote resolves the smallest type that seats the party. */
export const activeVehicleTypes = (rows) => (rows || [])
  .filter((row) => row.is_active)
  .sort((a, b) => (Number(a.max_capacity) - Number(b.max_capacity)) || (Number(a.sort_order) - Number(b.sort_order)));

/* The dropdown answer: the names a company offers, taken from the merged list so
   an override reads as the name the company chose rather than twice over. */
export const vocabularyNames = (rows, keyColumn = 'name') => [
  ...new Set(
    mergeVocabulary(rows, keyColumn)
      .filter((row) => row.is_active)
      .map((row) => String(row.name || '').trim())
      .filter(Boolean)
  )
];
