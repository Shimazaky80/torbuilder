/* A platform admin has no company of their own, so every page that scopes its
   queries to profile.company_id would show them an empty app. The tenant they
   are looking at lives here instead of in React state because most of those
   call sites are plain async functions with no hook to read from.

   The scope is only ever set for a session that resolveAccess calls the
   platform. For everyone else it stays null and scopeCompanyId answers with
   their own company, which is what it has always done. */

const STORAGE_KEY = 'torbuilder.platformCompanyScope';

let scope = null;
const listeners = new Set();

const notify = () => listeners.forEach((fn) => fn(scope));

export const platformScope = () => scope;

export const setPlatformScope = (companyId) => {
  const next = companyId || null;
  if (next === scope) return;
  scope = next;
  try {
    if (scope) window.localStorage.setItem(STORAGE_KEY, scope);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* A blocked storage only costs the remembered choice, not the scoping. */
  }
  notify();
};

export const readStoredPlatformScope = () => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
};

export const onPlatformScopeChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/* One place decides whose data a query belongs to. */
export const scopeCompanyId = (ownCompanyId) => scope || ownCompanyId || null;
