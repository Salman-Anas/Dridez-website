import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Shield, User, Lock, Eye, EyeOff, Loader2, AlertCircle, ArrowRight, Smartphone
} from 'lucide-react';
import { loginAdmin, isAuthenticated } from '../utils/auth';
import './Login.css';

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // If already authenticated on this device, redirect to dashboard immediately
  useEffect(() => {
    if (isAuthenticated()) {
      navigate('/', { replace: true });
    }
  }, [navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password) {
      setError('Please enter both username and password.');
      return;
    }

    setIsLoading(true);

    try {
      // Simulate a subtle network delay for smooth UX transition & brute force mitigation
      await new Promise((resolve) => setTimeout(resolve, 600));

      const success = await loginAdmin(username, password);

      if (success) {
        navigate('/', { replace: true });
      } else {
        setError('Invalid admin username or password.');
      }
    } catch {
      setError('An unexpected error occurred during authentication.');
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
          {/* Username input */}
          <div className="login-input-group">
            <label htmlFor="admin-username" className="login-label">
              Admin Username
            </label>
            <div className="login-input-wrapper">
              <input
                id="admin-username"
                type="text"
                className="login-input"
                placeholder="Enter admin username..."
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (error) setError('');
                }}
                disabled={isLoading}
                autoComplete="username"
                autoFocus
              />
              <User className="login-input-icon" size={18} />
            </div>
          </div>

          {/* Password input */}
          <div className="login-input-group">
            <label htmlFor="admin-password" className="login-label">
              Encrypted Password
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

          {/* Security Device Notice */}
          <div className="login-security-notice">
            <Smartphone size={18} style={{ flexShrink: 0, color: '#818cf8' }} />
            <span>
              <strong>Device Auth Protected:</strong> Active sessions are cryptographically bound to this device. Logging in from a new device will require re-authentication.
            </span>
          </div>

          {/* Submit Action Button */}
          <button
            type="submit"
            className="login-submit-btn"
            disabled={isLoading || !username || !password}
          >
            {isLoading ? (
              <>
                <Loader2 size={20} className="spinner-icon" />
                <span>Decrypting Credentials...</span>
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
