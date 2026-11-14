import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Car, Settings, CreditCard, Navigation,
  LogOut, CheckSquare, LifeBuoy, Wallet, X, MessagesSquare,
} from 'lucide-react';
import { logoutAdmin } from '../utils/auth';
import { useAdminAuth } from '../utils/adminAuthContext';

const LINKS = [
  { to: '/', label: 'Dashboard', Icon: LayoutDashboard, end: true },
  { to: '/rides', label: 'Rides', Icon: Navigation },
  { to: '/drivers', label: 'Drivers', Icon: Car },
  { to: '/users', label: 'Users', Icon: Users },
  { to: '/payments', label: 'Payments', Icon: CreditCard },
  { to: '/driver-accounts', label: 'Driver Accounts', Icon: Wallet },
  { to: '/support-chat', label: 'Support Chat', Icon: MessagesSquare },
  { to: '/tickets', label: 'Support Tickets', Icon: LifeBuoy },
  { to: '/tasks', label: 'Tasks', Icon: CheckSquare },
];

interface Props {
  /** On a phone the sidebar is a drawer; this says whether it's showing. */
  open: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<Props> = ({ open, onClose }) => {
  const navigate = useNavigate();
  const { adminEmail } = useAdminAuth();

  const handleLogout = async () => {
    await logoutAdmin();
    navigate('/login', { replace: true });
  };

  const linkClass = ({ isActive }: { isActive: boolean }) => `nav-item ${isActive ? 'active' : ''}`;

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`} id="portal-nav" aria-label="Portal navigation">
      <div className="sidebar-brand">
        <img src="/dridez-icon.png" alt="" width={32} height={32} />
        <div>
          <strong>Dridez</strong>
          <span>Admin portal</span>
        </div>
        <button className="sidebar-close" onClick={onClose} aria-label="Close menu">
          <X size={16} />
        </button>
      </div>

      <nav onClick={e => { if ((e.target as HTMLElement).closest('a')) onClose(); }}>
        {LINKS.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={linkClass}>
            <Icon size={16} />
            {label}
          </NavLink>
        ))}

        <div className="sidebar-spacer" />

        <NavLink to="/settings" className={linkClass}>
          <Settings size={16} />
          Settings
        </NavLink>

        {adminEmail && (
          <div className="sidebar-admin" title={adminEmail}>
            Signed in as
            <span className="sidebar-admin-email">{adminEmail}</span>
          </div>
        )}

        <button
          onClick={() => { void handleLogout(); }}
          className="nav-item nav-logout"
          title="Sign out of Firebase on this device"
        >
          <LogOut size={16} />
          Log out
        </button>
      </nav>
    </aside>
  );
};
