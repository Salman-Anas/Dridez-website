import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Car, Settings, CreditCard, Navigation,
  LogOut, CheckSquare, LifeBuoy, Wallet,
} from 'lucide-react';
import { logoutAdmin } from '../utils/auth';
import { useAdminAuth } from '../utils/adminAuthContext';

export const Sidebar: React.FC = () => {
  const navigate = useNavigate();
  const { adminEmail } = useAdminAuth();

  const handleLogout = async () => {
    await logoutAdmin();
    navigate('/login', { replace: true });
  };

  return (
    <div className="sidebar">
      <div className="sidebar-logo">
        Admin Portal
      </div>

      <nav>
        <NavLink
          to="/"
          end
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
        >
          <LayoutDashboard size={20} />
          Dashboard
        </NavLink>

        <NavLink
          to="/rides"
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
        >
          <Navigation size={20} />
          Rides
        </NavLink>

        <NavLink
          to="/drivers"
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
        >
          <Car size={20} />
          Drivers
        </NavLink>

        <NavLink
          to="/users"
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
        >
          <Users size={20} />
          Users
        </NavLink>

        <NavLink
          to="/payments"
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
        >
          <CreditCard size={20} />
          Payments
        </NavLink>

        <NavLink
          to="/driver-accounts"
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
        >
          <Wallet size={20} />
          Driver Accounts
        </NavLink>

        <NavLink
          to="/tickets"
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
        >
          <LifeBuoy size={20} />
          Support Tickets
        </NavLink>

        <NavLink
          to="/tasks"
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
        >
          <CheckSquare size={20} />
          Tasks
        </NavLink>

        <div style={{ flex: 1 }} />

        <NavLink
          to="/settings"
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          style={{ marginTop: 'auto' }}
        >
          <Settings size={20} />
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
          className="nav-item"
          style={{ width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
          title="Sign out of Firebase on this device"
        >
          <LogOut size={20} style={{ color: '#dc2626' }} />
          <span style={{ color: '#dc2626' }}>Log Out</span>
        </button>
      </nav>
    </div>
  );
};
