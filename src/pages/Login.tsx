import React, { useState } from 'react';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import {
  Shield, Mail, Lock, Eye, EyeOff, Loader2, AlertCircle, ArrowRight, KeyRound
} from 'lucide-react';
import { loginAdmin, AdminAuthError } from '../utils/auth';
import { useAdminAuth } from '../utils/adminAuthContext';
import './Login.css';

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const { status } = useAdminAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Firebase persists the session itself, so an already-signed-in admin who
  // lands here goes straight through.
  if (status === 'admin') {
    return <Navigate to="/" replace />;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError('Please enter both your admin email and password.');
      return;
    }

    setIsLoading(true);
    try {
      await loginAdmin(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(
        err instanceof AdminAuthError
          ? err.message
          : 'An unexpected error occurred during authentication.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page-container">
      {/* Background glowing spheres */}
      <div className="login-bg-sphere-1" />
      <div className="login-bg-sphere-2" />

      {/* Main Glassmorphic Form Card */}
      <div className="login-glass-card">
        <header className="login-header">
          <div className="login-logo-badge">
            <Shield size={34} />
          </div>
          <h1 className="login-title">Dridez Command Portal</h1>
          <p className="login-subtitle">Enterprise Driver &amp; Rider Management Network</p>
        </header>

        {error && (
          <div className="login-error-box" role="alert">
            <AlertCircle size={20} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        <form className="login-form" onSubmit={handleLogin}>
          {/* Email input */}
          <div className="login-input-group">
            <label htmlFor="admin-email" className="login-label">
              Admin Email
            </label>
            <div className="login-input-wrapper">
              <input
                id="admin-email"
                type="email"
                className="login-input"
                placeholder="admin@yourdomain.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError('');
                }}
                disabled={isLoading}
                autoComplete="username"
                autoFocus
              />
              <Mail className="login-input-icon" size={18} />
            </div>
          </div>

          {/* Password input */}
          <div className="login-input-group">
            <label htmlFor="admin-password" className="login-label">
              Password
            </label>
            <div className="login-input-wrapper">
              <input
                id="admin-password"
                type={showPassword ? 'text' : 'password'}
                className="login-input"
                placeholder="Enter account password..."
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError('');
                }}
                disabled={isLoading}
                autoComplete="current-password"
              />
              <Lock className="login-input-icon" size={18} />
              <button
                type="button"
                className="login-password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* What actually grants access */}
          <div className="login-security-notice">
            <KeyRound size={18} style={{ flexShrink: 0, color: '#818cf8' }} />
            <span>
              <strong>Firebase Auth:</strong> sign in with a Firebase account that carries the{' '}
              <span className="mono">admin</span> claim. The database rules refuse every read and
              write from any other account, so an ordinary rider or driver login will not open the
              portal.
            </span>
          </div>

          {/* Submit Action Button */}
          <button
            type="submit"
            className="login-submit-btn"
            disabled={isLoading || !email || !password}
          >
            {isLoading ? (
              <>
                <Loader2 size={20} className="spinner-icon" />
                <span>Signing in…</span>
              </>
            ) : (
              <>
                <span>Access Dashboard</span>
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>

        <footer className="login-footer">
          <span>Dridez OS &copy; {new Date().getFullYear()}</span>
          <Link to="/privacypolicy">View Privacy Policy</Link>
        </footer>
      </div>
    </div>
  );
};

export default Login;
