import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useSession } from '../hooks/useSession';
import { MODULES, moduleLabel, rolesHolding, levelLabel } from '../lib/rbac';

/* Stands in front of a page whose module the signed-in person does not hold.
   The menu is filtered, but a menu is not a boundary — typing an address, or
   following a link a colleague sent, reaches the route. The panel says what was
   reached, what the account holds there and who changes it, rather than
   bouncing the person to a dashboard they will read as a bug. */
export const RequireAccess = ({ module, level = 'read', children }) => {
  const { can, access, roleName } = useSession();
  if (can(module, level)) return children;

  const entry = MODULES.find((item) => item.id === module);
  const held = levelLabel(access?.modules?.[module]?.level || 'none');
  const holders = rolesHolding(module, level);

  return (
    <div className="super-admin-page" style={{ paddingBottom: '4rem' }}>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '2.5rem', maxWidth: '46rem', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <ShieldAlert size={26} color="#b45309" />
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#1e293b', margin: 0 }}>
            {moduleLabel(module)} is not part of your {roleName} access
          </h1>
        </div>
        <p style={{ color: '#475569', margin: '0 0 1rem', lineHeight: 1.6 }}>
          {entry?.summary}. Your account holds <strong>{held}</strong> here, so the page is closed rather than half-shown.
        </p>
        <p style={{ color: '#475569', margin: '0 0 1.5rem', lineHeight: 1.6 }}>
          An Admin can give it to you on the <strong>Users</strong> page, either by changing your role or by granting
          {holders.length ? <> one of the roles that already holds it — {holders.slice(0, 4).join(', ')}{holders.length > 4 ? ', and others' : ''}</> : ' this module to your account'}.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Link to="/dashboard" className="primary-btn" style={{ width: 'auto', padding: '0.6rem 1.2rem', background: '#0d7478', textDecoration: 'none' }}>
            Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
};

/* The platform console is not a module a company can be given: its data is every
   company on the platform, and only RLS plus this gate stand between a tenant
   admin and it. */
export const RequirePlatform = ({ children }) => {
  const { isPlatformAdmin } = useSession();
  if (isPlatformAdmin) return children;
  return (
    <div className="super-admin-page" style={{ paddingBottom: '4rem' }}>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '2.5rem', maxWidth: '40rem', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <ShieldAlert size={26} color="#b45309" />
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#1e293b', margin: 0 }}>Platform administration</h1>
        </div>
        <p style={{ color: '#475569', margin: 0, lineHeight: 1.6 }}>
          This console holds every company on the platform. It is open to a platform admin account only, and a
          company Admin cannot be given it — not by role and not by exception.
        </p>
      </div>
    </div>
  );
};
