import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../hooks/useSession';
import { useNavigationGuard } from '../context/NavigationGuardContext';
import { 
  LayoutDashboard, 
  Users, 
  UserCog,
  Building2, 
  Package, 
  Backpack, 
  Map, 
  Tag, 
  Receipt, 
  BarChart3, 
  UserCircle, 
  Settings, 
  LogOut,
  ChevronLeft,
  ChevronRight,
  Plane,
  ShieldCheck
} from 'lucide-react';
import tLogo from '../assets/t_logo.png';
import fullLogo from '../assets/full_logo.png';

/* The menu is the company's work cut into the same modules the roles are
   written against (src/lib/rbac.js). An entry the account cannot reach is not
   drawn — and RequireAccess still stands behind the address, because a menu is
   a convenience and not a boundary. */
const navItems = [
  { id: 'dashboard', module: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
  { id: 'clients', module: 'clients', label: 'Clients', icon: Users, path: '/clients' },
  { id: 'suppliers', module: 'suppliers', label: 'Suppliers', icon: Building2, path: '/suppliers' },
  { id: 'guide-team', module: 'guide_team', label: 'Guide Team', icon: UserCog, path: '/guide-team' },
  { id: 'library-items', module: 'library', label: 'Library Items', icon: Package, path: '/library-items' },
  { id: 'packages', module: 'packages', label: 'Packages', icon: Backpack, path: '/packages' },
  { id: 'itineraries', module: 'itineraries', label: 'Itineraries', icon: Map, path: '/itineraries' },
  { id: 'finance', module: 'finance', label: 'Finance', icon: Receipt, path: '/finance' },
  { id: 'tariffs', module: 'tariffs', label: 'Tariffs', icon: Tag, path: '/tariffs' },
  { id: 'analytics', module: 'analytics', label: 'Analytics', icon: BarChart3, path: '/analytics' },
  { id: 'users', module: 'users', label: 'Users', icon: UserCircle, path: '/users' },
  { id: 'settings', module: 'settings', label: 'Settings', icon: Settings, path: '/settings' },
  { id: 'super-admin', label: 'Platform Admin', icon: ShieldCheck, path: '/super-admin', platformOnly: true },
];

export const Sidebar = () => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const navigate = useNavigate();
  const { requestNavigate } = useNavigationGuard();
  const { name, roleName, isPlatformAdmin, can, companies, viewingCompany, setViewingCompany } = useSession();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  return (
    <aside className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <div className="app-logo-area">
          <img src={tLogo} className="logo-t" alt="torbuilder" />
          <img src={fullLogo} className="logo-full" alt="torbuilder" />
        </div>
        <button 
          className="collapse-btn"
          onClick={() => setIsCollapsed(!isCollapsed)}
          style={{ padding: '4px', transition: 'all 0.2s', background: 'none', border: 'none', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {isCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
        </button>
      </div>

      <nav className="sidebar-menu">
        {navItems
          .filter((item) => !item.platformOnly || isPlatformAdmin)
          .filter((item) => !item.module || can(item.module, 'read'))
          .map((item) => (
          <NavLink
            key={item.id}
            to={item.path}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            onClick={(e) => {
              e.preventDefault();
              requestNavigate(item.path);
            }}
          >
            <item.icon className="nav-icon" size={20} style={{ minWidth: '20px' }} />
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer" style={{ padding: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
        {isPlatformAdmin && !isCollapsed && (
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.75, marginBottom: '0.35rem' }}>
              <Building2 size={12} style={{ verticalAlign: '-2px', marginRight: '4px' }} />
              Viewing tenant
            </label>
            <select
              value={viewingCompany || ''}
              onChange={(e) => setViewingCompany(e.target.value)}
              disabled={companies.length === 0}
              style={{ width: '100%', padding: '0.45rem 0.5rem', borderRadius: '8px', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', fontSize: '0.8rem', fontWeight: 600, cursor: companies.length ? 'pointer' : 'default' }}
            >
              {companies.length === 0 && <option value="">No companies yet</option>}
              {companies.map((company) => (
                <option key={company.id} value={company.id} style={{ color: '#1e293b' }}>{company.name}</option>
              ))}
            </select>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.68rem', opacity: 0.7, lineHeight: 1.4 }}>
              Every page below reads this company only.
            </p>
          </div>
        )}
        <div className="user-profile" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <div className="user-avatar" style={{ width: '32px', height: '32px', background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
            {name?.charAt(0) || 'U'}
          </div>
          {!isCollapsed && (
            <div className="user-info">
              <div style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{name}</div>
              <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                {isPlatformAdmin ? 'Platform Admin' : roleName}
              </div>
            </div>
          )}
        </div>
        <button className="logout-btn" onClick={handleLogout} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', borderRadius: '0.5rem', background: 'none', border: 'none', color: 'white', cursor: 'pointer', transition: 'all 0.2s' }}>
          <LogOut size={20} />
          {!isCollapsed && <span>Logout</span>}
        </button>
      </div>
    </aside>
  );
};
