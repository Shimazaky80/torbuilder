/* The destination catalogue: the standard places every tenant reads plus the
   company's own.

   app_places carries both halves. A row with company_id IS NULL is the platform's
   standard place; a row carrying the tenant's own company_id is a destination
   only that tenant sees and may edit. The read query asks for both and row-level
   security hides everybody else's.

   Unlike tour types and vehicle sizes there is no override: a place is not a
   price key, so a tenant that wants a different spelling or a new village simply
   adds its own row. The merge still prefers the company's row when the same
   country/region/place appears twice, so a duplicate created outside this screen
   cannot hide the tenant's version of it. */

export const PLACE_COLUMNS = 'id, company_id, country, province, place, alt_name, is_hub, is_active';

export const PLACE_PAGE_SIZE = 1000;

export const placeText = (value) => String(value || '').trim();

export const isSharedPlace = (row) => !row?.company_id;

/* The key that decides two rows are the same place. Folded, because a person
   typing "windhoek" means the Windhoek already on the list; the database's
   tenant index folds the same three fields. */
export const placeKey = (row) => [row?.country, row?.province, row?.place]
  .map((value) => placeText(value).toLowerCase())
  .join('|');

/* One row per id and one row per place key. The company's own row wins over a
   standard twin, whichever order the database returned them in. */
export const mergePlaces = (rows) => {
  const byId = new Map();
  (rows || []).forEach((row) => {
    if (row?.id) byId.set(row.id, row);
  });

  const byKey = new Map();
  [...byId.values()].forEach((row) => {
    const key = placeKey(row);
    const existing = byKey.get(key);
    if (!existing || (isSharedPlace(existing) && !isSharedPlace(row))) byKey.set(key, row);
  });

  return [...byKey.values()].sort((a, b) =>
    placeText(a.country).localeCompare(placeText(b.country), 'en')
    || placeText(a.place).localeCompare(placeText(b.place), 'en')
    || placeText(a.province).localeCompare(placeText(b.province), 'en')
    || placeText(a.id).localeCompare(placeText(b.id), 'en'));
};

/* Everything a search box should match: the place, its region, its country and
   the other names it is sold under. */
export const placeSearchText = (row) => [
  row?.place, row?.province, row?.country, row?.alt_name
].map(placeText).join(' ').toLowerCase();

/* The Settings card filter. `scope` is 'mine', 'standard' or 'all'. */
export const filterPlaces = (rows, { country = '', scope = 'all', query = '' } = {}) => {
  const wantedCountry = placeText(country);
  const q = placeText(query).toLowerCase();
  return (rows || []).filter((row) => {
    if (wantedCountry && placeText(row.country) !== wantedCountry) return false;
    if (scope === 'mine' && isSharedPlace(row)) return false;
    if (scope === 'standard' && !isSharedPlace(row)) return false;
    return !q || placeSearchText(row).includes(q);
  });
};

/* A place that already answers to the same key. Checked against both halves, so
   adding a standard town as a private copy is caught before the database has to
   say no. The row being edited never clashes with itself. */
export const placeClash = (rows, form, editingId = null) => {
  const key = placeKey(form);
  return (rows || []).find((row) => row.id !== editingId && placeKey(row) === key) || null;
};

/* The form a row opens into for editing. */
export const placeFormFrom = (row = {}) => ({
  country: placeText(row.country),
  province: placeText(row.province),
  place: placeText(row.place),
  altName: placeText(row.alt_name),
  isHub: !!row.is_hub,
  isActive: row.is_active !== false
});

/* The row a company writes. Ownership is always the caller's company: a tenant
   never writes a standard row, and never writes another tenant's row. */
export const placePayload = (form = {}, companyId) => ({
  company_id: companyId,
  country: placeText(form.country),
  province: placeText(form.province),
  place: placeText(form.place),
  alt_name: placeText(form.altName) || null,
  is_hub: !!form.isHub,
  is_active: form.isActive !== false
});

/* The PostgREST filter that reads both halves. A session with no company (a
   platform admin looking at no tenant) sees the standard list only. */
export const placeReadFilter = (companyId) => (
  companyId ? `company_id.is.null,company_id.eq.${companyId}` : 'company_id.is.null'
);
