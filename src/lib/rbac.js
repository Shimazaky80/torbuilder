/* Role-based access control.
   The structure a tour operator or DMC actually runs on: a handful of named
   jobs, each holding a level per module, one Admin who holds everything, and a
   per-person exception for the senior consultant who is shown the cost price
   while the junior is not.

   Three rules shape everything below:

   1. A level is `none`, `read` or `write`. Asking for `write` is satisfied by
      `write`; asking for `read` is satisfied by either. Nothing asks for a
      fourth level, so nothing has to invent one.
   2. An exception outranks the job description in BOTH directions. A Finance
      person quietly cut down to reading invoices is a real thing in this
      industry, and it must not read as a bug.
   3. The BUILT_IN_ROLES here mirror the seeded `roles` table so the app can
      answer before the database has replied. `scripts/rbac.test.mjs` compares
      the two, because a job description that drifts from the row the Admin
      sees is worse than no job description at all. */

export const ACCESS_LEVELS = ['none', 'read', 'write'];

const LEVEL_RANK = { none: 0, read: 1, write: 2 };

/* The modules a company's work is cut into. `nav` is the Sidebar entry and
   `route` the path it opens, so one table answers "is this menu item mine?" and
   "may I stand on this page?" without either drifting from the other. */
export const MODULES = [
  { id: 'dashboard', label: 'Dashboard', nav: 'dashboard', route: '/dashboard', summary: 'The day at a glance' },
  { id: 'clients', label: 'Clients', nav: 'clients', route: '/clients', summary: 'Who buys the trips and what they are owed' },
  { id: 'suppliers', label: 'Suppliers', nav: 'suppliers', route: '/suppliers', summary: 'Who the company buys from' },
  { id: 'guide_team', label: 'Guide Team', nav: 'guide-team', route: '/guide-team', summary: 'The guides and drivers on the roster' },
  { id: 'library', label: 'Library Items', nav: 'library-items', route: '/library-items', summary: 'The contracted catalogue and its rates' },
  { id: 'packages', label: 'Packages', nav: 'packages', route: '/packages', summary: 'Fixed offers and what they contain' },
  { id: 'itineraries', label: 'Itineraries', nav: 'itineraries', route: '/itineraries', summary: 'Trip plans, quotes and vouchers' },
  { id: 'tariffs', label: 'Tariffs', nav: 'tariffs', route: '/tariffs', summary: 'Published rates and the partner portal' },
  { id: 'finance', label: 'Finance', nav: 'finance', route: '/finance', summary: 'Invoices, receipts and payments' },
  { id: 'analytics', label: 'Analytics', nav: 'analytics', route: '/analytics', summary: 'Sales, margin and destination reports' },
  { id: 'users', label: 'Users', nav: 'users', route: '/users', summary: 'Who is in the company and what they may reach' },
  { id: 'settings', label: 'Settings', nav: 'settings', route: '/settings', summary: 'Tax, currency and company defaults' }
];

export const MODULE_IDS = MODULES.map((module) => module.id);

export const FLAGS = [
  {
    id: 'view_costs',
    label: 'See the cost price',
    summary: 'Supplier buy totals, margin and cost columns. Selling prices are unaffected.'
  }
];

const fullAccess = (level) => MODULE_IDS.reduce((map, id) => ({ ...map, [id]: level }), {});

/* Seeded into `roles` by supabase/migrations/20261257_role_based_access_control.sql. */
export const BUILT_IN_ROLES = [
  {
    key: 'admin',
    name: 'Admin',
    description: 'Full access to everything, including the money the supplier charges and the people who may hold it.',
    access: fullAccess('write'),
    flags: { view_costs: true },
    sortOrder: 10
  },
  {
    key: 'consultant',
    name: 'Consultant',
    description: 'Sells the trip: clients, itineraries and packages. Quotes are priced for the client, not for the margin.',
    access: { ...fullAccess('none'), dashboard: 'read', clients: 'write', suppliers: 'read', guide_team: 'read', library: 'read', packages: 'write', itineraries: 'write', tariffs: 'read' },
    flags: { view_costs: false },
    sortOrder: 20
  },
  {
    key: 'operations',
    name: 'Operations',
    description: 'Runs the trip once it is sold: suppliers, guide team, hire and the confirmations on every service.',
    access: { ...fullAccess('none'), dashboard: 'read', clients: 'read', suppliers: 'write', guide_team: 'write', library: 'read', packages: 'read', itineraries: 'write', tariffs: 'write', finance: 'read', analytics: 'read' },
    flags: { view_costs: true },
    sortOrder: 30
  },
  {
    key: 'finance',
    name: 'Finance',
    description: 'Bills and collects: invoices, receipts, payments and the margin reports that go with them.',
    access: { ...fullAccess('none'), dashboard: 'read', clients: 'read', suppliers: 'read', itineraries: 'read', tariffs: 'read', finance: 'write', analytics: 'write' },
    flags: { view_costs: true },
    sortOrder: 40
  },
  {
    key: 'guide',
    name: 'Guide / Field Staff',
    description: 'Reads the trip they are on the day before: the itinerary, the crew roster and nothing else.',
    access: { ...fullAccess('none'), dashboard: 'read', guide_team: 'read', itineraries: 'read' },
    flags: { view_costs: false },
    sortOrder: 50
  },
  {
    key: 'viewer',
    name: 'View Only',
    description: 'Reads everything the company sells and books, changes nothing, and is not shown the cost price.',
    access: { ...fullAccess('read'), users: 'none', settings: 'none' },
    flags: { view_costs: false },
    sortOrder: 60
  },
  {
    key: 'super_admin',
    name: 'Platform Admin',
    description: 'The platform owner. Sees every company; not assignable by a tenant admin.',
    access: fullAccess('write'),
    flags: { view_costs: true },
    sortOrder: 100
  }
];

export const PLATFORM_ROLE_KEY = 'super_admin';

export const levelRank = (level) => LEVEL_RANK[level] ?? 0;

export const isKnownLevel = (level) => ACCESS_LEVELS.includes(level);

export const levelLabel = (level) => (
  level === 'write' ? 'Full' : level === 'read' ? 'View' : 'No access'
);

export const moduleLabel = (moduleId) => (
  MODULES.find((module) => module.id === moduleId)?.label || moduleId
);

export const flagLabel = (flagId) => (
  FLAGS.find((flag) => flag.id === flagId)?.label || flagId
);

/* A role row read from `roles`, or the built-in mirror, answered the same way.
   Unknown modules and misspelled levels are dropped rather than trusted: a
   half-read job description must under-grant, never over-grant. */
const parseRole = (raw) => {
  if (!raw?.key) return null;
  const access = MODULE_IDS.reduce((map, id) => {
    const level = raw.access?.[id];
    return { ...map, [id]: isKnownLevel(level) ? level : 'none' };
  }, {});
  const flags = FLAGS.reduce((map, flag) => (
    { ...map, [flag.id]: raw.flags?.[flag.id] === true }
  ), {});
  return {
    key: raw.key,
    name: raw.name || raw.key,
    description: raw.description || '',
    access,
    flags,
    sortOrder: Number(raw.sort_order ?? raw.sortOrder) || 0,
    isBuiltin: raw.is_builtin === true || BUILT_IN_ROLES.some((role) => role.key === raw.key)
  };
};

export const builtInRole = (key) => parseRole(BUILT_IN_ROLES.find((role) => role.key === key));

/* The roles a person may be given: the platform catalogue plus anything this
   company has added. The platform role is never offered to a tenant. */
export const assignableRoles = (roleRows = [], { callerIsPlatform = false } = {}) => {
  const merged = new Map();
  BUILT_IN_ROLES.forEach((role) => merged.set(role.key, parseRole(role)));
  (Array.isArray(roleRows) ? roleRows : [])
    .map(parseRole)
    .filter(Boolean)
    .forEach((role) => merged.set(role.key, role));
  return [...merged.values()]
    .filter((role) => callerIsPlatform || role.key !== PLATFORM_ROLE_KEY)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
};

/* Exceptions are stored per person. Anything not in the catalogue is dropped on
   the way in, so a stray key cannot shadow a real module forever. */
export const normaliseOverrides = (raw) => {
  const modules = {};
  Object.entries(raw?.modules || {}).forEach(([id, level]) => {
    if (MODULE_IDS.includes(id) && isKnownLevel(level)) modules[id] = level;
  });
  const flags = {};
  FLAGS.forEach((flag) => {
    if (raw?.flags?.[flag.id] === true || raw?.flags?.[flag.id] === false) {
      flags[flag.id] = raw.flags[flag.id];
    }
  });
  return { modules, flags };
};

export const hasOverrides = (overrides) => (
  Object.keys(overrides?.modules || {}).length > 0 || Object.keys(overrides?.flags || {}).length > 0
);

/* The answer the whole app works from: what level does this person hold in this
   module, and where did that answer come from. */
export const resolveAccess = ({
  roleKey = '',
  overrides = {},
  isPlatformAdmin = false,
  isActive = true,
  roleRows = []
} = {}) => {
  if (isPlatformAdmin || roleKey === PLATFORM_ROLE_KEY) {
    return {
      roleKey: roleKey || PLATFORM_ROLE_KEY,
      role: builtInRole(PLATFORM_ROLE_KEY),
      isPlatformAdmin: true,
      isActive: true,
      modules: MODULE_IDS.reduce((map, id) => ({ ...map, [id]: { level: 'write', from: 'platform' } }), {}),
      flags: { view_costs: { value: true, from: 'platform' } }
    };
  }

  const role = assignableRoles(roleRows).find((entry) => entry.key === roleKey) || builtInRole(roleKey) || builtInRole('consultant');
  const clean = normaliseOverrides(overrides);
  const modules = MODULE_IDS.reduce((map, id) => (
    Object.prototype.hasOwnProperty.call(clean.modules, id)
      ? { ...map, [id]: { level: clean.modules[id], from: 'exception' } }
      : { ...map, [id]: { level: role.access[id] || 'none', from: 'role' } }
  ), {});
  const flags = FLAGS.reduce((map, flag) => (
    Object.prototype.hasOwnProperty.call(clean.flags, flag.id)
      ? { ...map, [flag.id]: { value: clean.flags[flag.id], from: 'exception' } }
      : { ...map, [flag.id]: { value: role.flags[flag.id] === true, from: 'role' } }
  ), {});

  return { roleKey: role.key, role, isPlatformAdmin: false, isActive, modules, flags };
};

export const levelOf = (access, moduleId) => access?.modules?.[moduleId]?.level || 'none';

/* A disabled person holds nothing, wherever the access came from. The row stays
   so the audit trail and the roster still read correctly. */
export const can = (access, moduleId, level = 'read') => (
  access?.isActive !== false
  && levelRank(levelOf(access, moduleId)) >= levelRank(level)
);

export const canSeeCosts = (access) => (
  access?.isActive !== false && access?.flags?.view_costs?.value === true
);

/* What the no-access panel says. It names the module and the job that holds it,
   because "you are not allowed" with no road onward is how people end up
   telephoning the owner about a menu item. */
export const accessDeniedMessage = (access, moduleId, level = 'read') => {
  const label = moduleLabel(moduleId);
  if (access?.isActive === false) {
    return `${label} is closed to your account because it has been disabled. Ask your administrator to reinstate it.`;
  }
  if (level === 'write' && levelRank(levelOf(access, moduleId)) === 1) {
    return `${label} is view-only for your role. Editing it needs write access — ask an Admin to change your role or grant you ${label} access.`;
  }
  return `Your account has no access to ${label}. Ask an Admin to give it to you, or to change your role.`;
};

/* The role names a person would be given to reach a module — the onward road the
   panel above promises. */
export const rolesHolding = (moduleId, level = 'read', roleRows = []) => (
  assignableRoles(roleRows)
    .filter((role) => role.key !== PLATFORM_ROLE_KEY)
    .filter((role) => levelRank(role.access[moduleId]) >= levelRank(level))
    .map((role) => role.name)
);
