import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Users, Car, Settings, CreditCard, Navigation, LogOut } from 'lucide-react';
import { logoutAdmin } from '../utils/auth';

export const Sidebar: React.FC = () => {
  const navigate = useNavigate();

  const handleLogout = () => {
    logoutAdmin();
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
        
        <div style={{ flex: 1 }} />
        
        <NavLink 
          to="/settings" 
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          style={{ marginTop: 'auto' }}
        >
          <Settings size={20} />
          Settings
        </NavLink>

        <button
          onClick={handleLogout}
          className="nav-item"
          style={{ width: '100%', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
          title="Log out from this session"
        >
          <LogOut size={20} style={{ color: '#dc2626' }} />
          <span style={{ color: '#dc2626' }}>Log Out</span>
        </button>
      </nav>
    </div>
  );
};


