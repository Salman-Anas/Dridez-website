import React, { useEffect, useState } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { Loader, Menu, ShieldAlert } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { useAdminAuth } from '../utils/adminAuthContext';
import { logoutAdmin } from '../utils/auth';

export const Layout: React.FC = () => {
  const location = useLocation();
  const { status, user } = useAdminAuth();
  // On a phone the sidebar is a drawer behind the top bar's menu button.
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  // Firebase restores a persisted session asynchronously. Redirecting during
  // that window would bounce a signed-in admin to the login screen on every
  // refresh, so the guard waits for a decision first.
  if (status === 'loading') {
    return (
      <div className="auth-gate">
        <Loader size={34} className="spin" />
        <p>Checking your admin session…</p>
      </div>
    );
  }

  if (status === 'signed-out') {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // A real account without the claim: the rules would refuse every read, so
  // there is nothing useful to show. Say why rather than rendering empty pages.
  if (status === 'not-admin') {
    return (
      <div className="auth-gate">
        <ShieldAlert size={38} style={{ color: 'var(--accent-red)' }} />
        <h2>Not an admin account</h2>
        <p>
          {user?.email ? <strong>{user.email}</strong> : 'This account'} is signed in, but its
          token does not carry the <span className="mono">admin</span> claim. Every read the
          portal makes would be refused by the security rules.
        </p>
        <p className="auth-gate-hint">
          Someone with console access can grant it with{' '}
          <span className="mono">node functions/scripts/setAdmin.js {user?.email ?? '<email>'}</span>,
          then sign out and back in.
        </p>
        <button className="auth-gate-btn" onClick={() => { void logoutAdmin(); }}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <header className="portal-topbar">
        <button
          className="portal-menu-btn"
          onClick={() => setNavOpen(true)}
          aria-label="Open menu"
          aria-controls="portal-nav"
          aria-expanded={navOpen}
        >
          <Menu size={18} />
        </button>
        <img src="/dridez-icon.png" alt="" width={28} height={28} />
        <strong>Dridez Admin</strong>
      </header>
      {navOpen && <div className="sidebar-backdrop" onClick={() => setNavOpen(false)} />}
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
};
