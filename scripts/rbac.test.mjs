import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ACCESS_LEVELS,
  BUILT_IN_ROLES,
  FLAGS,
  MODULES,
  MODULE_IDS,
  PLATFORM_ROLE_KEY,
  assignableRoles,
  builtInRole,
  can,
  canSeeCosts,
  hasOverrides,
  isPlatformProfile,
  levelLabel,
  normaliseOverrides,
  resolveAccess,
  rolesHolding
} from '../src/lib/rbac.js';
import { scopeCompanyId, setPlatformScope } from '../src/lib/tenantScope.js';

let failures = 0;
const check = (label, actual, expected) => {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
};

console.log('\n--- Running Role-Based Access Control Verification Tests ---\n');

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(join(here, '..', 'supabase', 'migrations', '20261257_role_based_access_control.sql'), 'utf8');

/* 1. The catalogue is complete. A role with a module missing reads as 'none',
      which is a silent refusal to work, so every job states every module. */
check('every module appears in every built-in role', BUILT_IN_ROLES.map((role) => (
  MODULE_IDS.filter((id) => !ACCESS_LEVELS.includes(role.access[id]) ? id : null).filter(Boolean)
)).filter((missing) => missing.length > 0), []);

check('the platform admin is the last seeded role', BUILT_IN_ROLES[BUILT_IN_ROLES.length - 1].key, 'super_admin');

/* 2. The seeded rows and the mirror in the app say the same thing. This is the
      check that keeps a job description edited in one place from drifting out of
      the other: the Admin reads the row, the app answers before the row arrives. */
const seeded = [...migration.matchAll(
  /\('([a-z_]+)',\s*'([^']+)',\s*'([^']+)',\s*'(\{[^']*\})'::jsonb,\s*'(\{[^']*\})'::jsonb,\s*true,\s*(\d+)\)/g
)].map(([, key, name, description, access, flags, sortOrder]) => ({
  key,
  name,
  description,
  access: JSON.parse(access),
  flags: JSON.parse(flags),
  sortOrder: Number(sortOrder)
}));

check('the migration seeds as many roles as the app mirrors', seeded.length, BUILT_IN_ROLES.length);

const drift = seeded.filter((row) => {
  const mirror = BUILT_IN_ROLES.find((role) => role.key === row.key);
  if (!mirror) return true;
  const sorted = (obj) => JSON.stringify(Object.keys(obj).sort().map((k) => [k, obj[k]]));
  return mirror.name !== row.name
    || mirror.description !== row.description
    || Number(mirror.sortOrder) !== row.sortOrder
    || sorted(mirror.access) !== sorted(row.access)
    || sorted(mirror.flags) !== sorted(row.flags);
}).map((row) => row.key);

check('no seeded role has drifted from src/lib/rbac.js', drift, []);

/* 3. Admin holds everything; nobody else does. This is the rule the whole
      structure was asked for, so it is asserted rather than assumed. */
const admin = resolveAccess({ roleKey: 'admin' });
check('admin writes every module', MODULE_IDS.filter((id) => !can(admin, id, 'write')), []);
check('admin sees the cost price', canSeeCosts(admin), true);

const consultant = resolveAccess({ roleKey: 'consultant' });
check('consultant reads the catalogue but cannot change it', can(consultant, 'library'), true);
check('consultant cannot write the catalogue', can(consultant, 'library', 'write'), false);
check('consultant has no users page', can(consultant, 'users'), false);
check('consultant has no finance page', can(consultant, 'finance'), false);
check('consultant is not shown the cost price', canSeeCosts(consultant), false);
check('consultant sells: writes itineraries', can(consultant, 'itineraries', 'write'), true);

/* Asking for read is satisfied by write, asking for write is not satisfied by
   read. Both halves of that one rule. */
const guide = resolveAccess({ roleKey: 'guide' });
check('a read level passes a read check', can(guide, 'itineraries', 'read'), true);
check('a read level fails a write check', can(guide, 'itineraries', 'write'), false);
check('a guide is not given the client ledger', can(guide, 'clients'), false);

/* 4. Exceptions outrank the job in BOTH directions: the senior consultant who
      is shown the cost price, and the finance clerk cut down to reading. */
const senior = resolveAccess({
  roleKey: 'consultant',
  overrides: { modules: { analytics: 'read' }, flags: { view_costs: true } }
});
check('an exception grants a module the role refuses', can(senior, 'analytics'), true);
check('and shows the cost price on top of a consultant', canSeeCosts(senior), true);

const narrowed = resolveAccess({
  roleKey: 'finance',
  overrides: { modules: { finance: 'read' } }
});
check('an exception can also take access away', can(narrowed, 'finance', 'write'), false);
check('while leaving the reading it grants', can(narrowed, 'finance', 'read'), true);
check('the exception is where the answer came from', narrowed.modules.finance.from, 'exception');
check('an untouched module still answers from the role', narrowed.modules.analytics.from, 'role');

/* 5. A disabled person holds nothing, and the row is kept rather than deleted. */
const suspended = resolveAccess({ roleKey: 'admin', isActive: false });
check('a disabled admin writes nothing', MODULE_IDS.filter((id) => can(suspended, id, 'write')), []);
check('a disabled admin reads nothing', MODULE_IDS.filter((id) => can(suspended, id, 'read')), []);
check('a disabled admin sees no costs', canSeeCosts(suspended), false);

/* 5b. An account with no profiles row is resolved exactly the way the session
        now does. It used to inherit the platform, which is every company on the
        app handed to whoever registered next. */
const unprovisioned = resolveAccess({ isActive: false });
check('an unprovisioned account writes nothing', MODULE_IDS.filter((id) => can(unprovisioned, id, 'write')), []);
check('an unprovisioned account reads nothing', MODULE_IDS.filter((id) => can(unprovisioned, id, 'read')), []);
check('an unprovisioned account is not the platform', unprovisioned.isPlatformAdmin, false);
check('an unprovisioned account sees no costs', canSeeCosts(unprovisioned), false);

/* 6. Garbage under-grants. A module renamed, a level misspelled, a role nobody
      has heard of — none of them may turn into access. */
check('an unknown module in an exception is dropped', normaliseOverrides({ modules: { wizardry: 'write', clients: 'write' }, flags: { view_costs: true, ghost: true } }), { modules: { clients: 'write' }, flags: { view_costs: true } });
check('a misspelled level is dropped', normaliseOverrides({ modules: { clients: 'WRITE' } }), { modules: {}, flags: {} });
check('an unknown role answers as a consultant', resolveAccess({ roleKey: 'marketing_intern' }).roleKey, 'consultant');
check('a half-read role row grants nothing extra', resolveAccess({
  roleKey: 'odd',
  roleRows: [{ key: 'odd', name: 'Odd', access: { clients: 'superuser', suppliers: 'write' } }]
}).modules.clients.level, 'none');
check('but keeps the level the row really stated', resolveAccess({
  roleKey: 'odd',
  roleRows: [{ key: 'odd', name: 'Odd', access: { clients: 'superuser', suppliers: 'write' } }]
}).modules.suppliers.level, 'write');
check('an empty override set is no exception at all', hasOverrides({ modules: {}, flags: {} }), false);
check('one module exception is an exception', hasOverrides({ modules: { clients: 'read' }, flags: {} }), true);

/* 7. The platform role is not on the menu for a company, and the roster answers
      with the app's own copy when the database has not replied. */
check('a tenant is not offered the platform role', assignableRoles([]).map((r) => r.key).includes('super_admin'), false);
check('the platform is offered it', assignableRoles([], { callerIsPlatform: true }).map((r) => r.key).includes('super_admin'), true);
check('an empty role table still answers', assignableRoles([null, undefined]).map((r) => r.key), BUILT_IN_ROLES.filter((r) => r.key !== 'super_admin').map((r) => r.key));
check('a company role read from the table is added', assignableRoles([{ key: 'reservations', name: 'Reservations', access: { clients: 'write' }, flags: {}, sort_order: 25 }]).map((r) => r.key).slice(0, 3), ['admin', 'consultant', 'reservations']);

/* 8. The panel that refuses a page names the onward road, so the answer is a
      role to ask for rather than a dead end. */
check('level labels read as an operator would say them', ACCESS_LEVELS.map(levelLabel), ['No access', 'View', 'Full']);
check('jobs that reach finance for writing', rolesHolding('finance', 'write'), ['Admin', 'Finance']);
check('jobs that reach analytics for writing', rolesHolding('analytics', 'write'), ['Admin', 'Finance']);
check('jobs that reach analytics at all', rolesHolding('analytics', 'read'), ['Admin', 'Operations', 'Finance', 'View Only']);
check('the module list and the route table agree', MODULES.every((m) => m.route.startsWith('/') && m.nav), true);
check('builtInRole answers nothing for an unknown key', builtInRole('nope'), null);

/* 9. The database side has to be there too: an app that gates the menu while
      profiles stay writable from anywhere is decoration. */
[
  'public.user_module_access',
  'public.user_can_see_costs',
  'public.admin_set_user_role',
  'public.admin_set_user_access',
  'public.admin_set_user_active',
  'public.admin_create_invitation',
  'public.admin_revoke_invitation',
  'public.join_company_by_invitation',
  'public.get_company_team',
  'public.role_changes'
].forEach((object) => {
  check(`${object} exists in the migration`, migration.includes(object), true);
});
check('the legacy role CHECK constraint is dropped', migration.includes('DROP CONSTRAINT IF EXISTS profiles_user_role_check'), true);
check('user_role becomes a real foreign key', migration.includes('REFERENCES public.roles(key)'), true);
check('nobody reads the last Admin out of the company', migration.includes('This is the last Admin in the company'), true);
check('nobody disables their own account', migration.includes('You cannot disable your own account'), true);
check('a company cannot hand out the platform role', migration.includes('The platform admin role cannot be assigned by a company admin'), true);
check('the cost flag is decided in SQL as well as in the app', migration.includes('view_costs'), true);

/* 10. The platform owns no company, so a function that only ever reads the
        caller's own profile shows it nothing. The second migration lets the
        platform name the tenant it is acting on — and keeps that power off the
        table for everyone else. */
const scopeMigration = readFileSync(join(here, '..', 'supabase', 'migrations', '20261258_platform_tenant_scope.sql'), 'utf8');
check('the roster takes a company', /FUNCTION public\.get_company_team\(p_company UUID DEFAULT NULL\)/.test(scopeMigration), true);
check('the old roster overload is dropped', scopeMigration.includes('DROP FUNCTION IF EXISTS public.get_company_team();'), true);
check('an invitation is addressed to a company', /FUNCTION public\.admin_create_invitation\(\s*p_email TEXT,\s*p_role_key TEXT,\s*p_company UUID DEFAULT NULL/.test(scopeMigration), true);
check('naming a neighbour is refused before it is honoured', (scopeMigration.match(/only the platform may/gi) || []).length >= 3, true);
/* The platform's own company is NULL, and `uuid <> NULL` answers NULL rather
   than true — which silently skipped the whole branch and returned an empty
   roster. Naming your own company must still be a no-op for a tenant. */
check('a named company is compared NULL-safely', (scopeMigration.match(/p_company IS DISTINCT FROM v_company/g) || []).length, 2);
check('no bare <> is left on a nullable company', /p_company <> v_company/.test(scopeMigration), false);
check('the platform reaches the access functions', (scopeMigration.match(/v_caller_is_platform/g) || []).length >= 6, true);
check('a tenant stays inside its own company in admin_set_user_access', scopeMigration.includes('IF NOT v_caller_is_platform AND v_target.company_id IS DISTINCT FROM v_caller.company_id THEN'), true);
check('the platform can revoke a stranded invitation', scopeMigration.includes('AND NOT public.is_super_admin()'), true);
check('the platform can read the audit trail', scopeMigration.includes('OR public.is_super_admin()'), true);
/* A tenant wrongly marked as the owner has to be undoable from the Users page,
   but never by the account holding the flag itself. */
check('only the platform may edit a platform row', (scopeMigration.match(/\) AND NOT v_caller_is_platform THEN/g) || []).length, 2);
check('the platform cannot change its own role', scopeMigration.includes('You cannot change your own platform role'), true);
check('the platform flag follows the role', scopeMigration.includes('is_super_admin = (p_role_key = \'super_admin\')'), true);
/* A bare `NULL OR false` answers NULL, and an IF that answers NULL does not
   fire — which would have skipped the company confinement for exactly the
   accounts whose flag was never written. */
check('the caller check cannot answer unknown', (scopeMigration.match(/v_caller_is_platform := COALESCE\(v_caller\.is_super_admin, false\)/g) || []).length, 3);

/* 11. One place decides whose data a query belongs to: the platform's chosen
        tenant, otherwise the caller's own. */
check('a tenant keeps its own company', scopeCompanyId('own-company'), 'own-company');
setPlatformScope('tenant-b');
check('the platform overrides with the tenant it picked', scopeCompanyId(null), 'tenant-b');
check('even over its own null profile', scopeCompanyId('own-company'), 'tenant-b');
setPlatformScope(null);
check('leaving the tenant restores the own company', scopeCompanyId('own-company'), 'own-company');

/* 12. One place answers "is this the platform". The database accepts either the
        flag or the role, so every copy of that test in the app was a place the
        two could drift apart — and a page that checked only the role would hand
        a company account the whole product. */
check('the flag alone is the platform', isPlatformProfile({ is_super_admin: true, user_role: 'admin' }), true);
check('the role alone is the platform', isPlatformProfile({ is_super_admin: null, user_role: 'super_admin' }), true);
check('a role with the flag written false is still the platform', isPlatformProfile({ is_super_admin: false, user_role: 'super_admin' }), true);
check('an admin with no flag is not', isPlatformProfile({ is_super_admin: false, user_role: 'admin' }), false);
check('a null flag on its own is not', isPlatformProfile({ is_super_admin: null, user_role: 'operations' }), false);
check('no profile at all is not the platform', isPlatformProfile(null), false);
check('the role key the helper matches is the seeded platform role', PLATFORM_ROLE_KEY, BUILT_IN_ROLES[BUILT_IN_ROLES.length - 1].key);
/* The guard that keeps the drift from coming back: the comparison is written
   once, in rbac.js, and pages ask it. */
const copiesOfTheTest = ['src/pages/Users.jsx', 'src/components/SessionProvider.jsx', 'src/components/Sidebar.jsx', 'src/App.jsx']
  .filter((file) => /is_super_admin\s*===/.test(readFileSync(join(here, '..', file), 'utf8')));
check('no page re-reads the flag for itself', copiesOfTheTest, []);
check('the users page asks the helper', readFileSync(join(here, '..', 'src', 'pages', 'Users.jsx'), 'utf8').includes('isPlatformProfile(member)'), true);
check('the session asks the helper', readFileSync(join(here, '..', 'src', 'components', 'SessionProvider.jsx'), 'utf8').includes('isPlatformProfile(profile)'), true);

/* 13. The command centre is where a company is looked at, so it is where the
        operator should be able to step inside one. Managing the rows and doing
        the work used to be two places with the sidebar picker as the only road
        between them. */
const commandCentre = readFileSync(join(here, '..', 'src', 'pages', 'SuperAdmin.jsx'), 'utf8');
check('the command centre takes the session scope', /useSession\(\)/.test(commandCentre), true);
check('a company row moves the picker onto it', /setViewingCompany\(company\.id\)/.test(commandCentre), true);
check('and opens that tenant rather than staying on the list', /navigate\('\/dashboard'\)/.test(commandCentre), true);

console.log(failures
  ? `\n${failures} rbac example(s) FAILED\n`
  : '\nAll Role-Based Access Control verification examples PASSED successfully!\n');
if (failures) process.exitCode = 1;
