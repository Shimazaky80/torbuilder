import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { 
  LayoutDashboard, 
  Users, 
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

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
  { id: 'clients', label: 'Clients', icon: Users, path: '/clients' },
  { id: 'suppliers', label: 'Suppliers', icon: Building2, path: '/suppliers' },
  { id: 'library-items', label: 'Library Items', icon: Package, path: '/library-items' },
  { id: 'packages', label: 'Packages', icon: Backpack, path: '/packages' },
  { id: 'itineraries', label: 'Itineraries', icon: Map, path: '/itineraries' },
  { id: 'tariffs', label: 'Tariffs', icon: Tag, path: '/tariffs' },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, path: '/analytics' },
  { id: 'users', label: 'Users', icon: UserCircle, path: '/users' },
  { id: 'settings', label: 'Settings', icon: Settings, path: '/settings' },
  { id: 'super-admin', label: 'Platform Admin', icon: ShieldCheck, path: '/super-admin', adminOnly: true },
];

export const Sidebar = () => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [profile, setProfile] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from('profiles')
          .select('first_name, last_name, user_role, is_super_admin')
          .eq('id', user.id)
          .single();
        setProfile(data);
      }
    };
    fetchProfile();
  }, []);

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
          .filter(item => !item.adminOnly || profile?.is_super_admin)
          .map((item) => (
          <NavLink
            key={item.id}
            to={item.path}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <item.icon className="nav-icon" size={20} style={{ minWidth: '20px' }} />
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer" style={{ padding: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
        <div className="user-profile" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <div className="user-avatar" style={{ width: '32px', height: '32px', background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
            {profile?.first_name?.charAt(0) || 'U'}
          </div>
          {!isCollapsed && (
            <div className="user-info">
              <div style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{profile?.first_name} {profile?.last_name}</div>
              <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>{profile?.user_role || 'Admin'}</div>
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
