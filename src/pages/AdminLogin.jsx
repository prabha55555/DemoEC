import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, isAdminUser } from '../context/AuthContext';
import AuthShell, { AuIcon } from '../components/AuthShell';

// Same normalisation AuthContext's isAdminUser() applies -- a trimmed,
// case-insensitive compare, so "Admin@Shop.com " is not rejected for typing.
const norm = (s) => (s || '').trim().toLowerCase();

const GENERIC_LOGIN_ERROR = 'Login failed. Check your email and password.';

export default function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { loginWithEmail, currentUser, isAdmin, logout } = useAuth();
  const navigate = useNavigate();

  // If already logged in as admin, go to admin panel
  useEffect(() => {
    if (currentUser && isAdmin) {
      navigate('/admin');
    }
  }, [currentUser, isAdmin, navigate]);

  async function handleLogin(e) {
    e.preventDefault();
    if (!email || !password) { setError('Please enter email and password.'); return; }

    // Skips a pointless auth round-trip for any other address. Deliberately the
    // same wording as a wrong password, so this form never confirms which
    // address is the admin one. The server (RLS + requireAdmin) is what
    // actually decides -- this is only a courtesy check.
    const adminEmail = norm(process.env.REACT_APP_ADMIN_EMAIL);
    if (!adminEmail || norm(email) !== adminEmail) {
      setError(GENERIC_LOGIN_ERROR);
      return;
    }

    setLoading(true); setError('');
    try {
      const data = await loginWithEmail(email.trim(), password);
      if (!isAdminUser(data?.user)) {
        // Signed in, but not as a confirmed admin account -- the effect above
        // will never navigate, so don't leave the button spinning forever.
        // The password was right (sign-in succeeded) but the account's email isn't confirmed --
        // say so plainly instead of the wrong-password wording, and don't leave a live session
        // behind that can never open the panel.
        setError(data?.user && !data.user.email_confirmed_at
          ? 'Signed in, but the email on this account is not confirmed. Confirm it in Supabase (Authentication > Users) and try again.'
          : GENERIC_LOGIN_ERROR);
        setLoading(false);
        try { await logout(); } catch { /* best-effort */ }
      }
      // otherwise navigate happens in the useEffect above when currentUser updates
    } catch (err) {
      setError(err.message || GENERIC_LOGIN_ERROR);
      setLoading(false);
    }
  }

  return (
    <AuthShell
      bare
      title="Admin sign in"
      subtitle="Brightlight Solutions store administration. Authorised staff only."
      footer={<a href="/">Return to website</a>}
      trust="Access is restricted and monitored."
    >
      {error && (
        <div id="admin-login-error" role="alert" className="au-alert">
          {error}
        </div>
      )}

      <form onSubmit={handleLogin}>
        <div className="au-field">
          <label htmlFor="admin-email" className="au-label">Admin email</label>
          <div className="au-inwrap">
            <AuIcon name="mail" />
            <input
              id="admin-email" name="email" className="au-input"
              type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email" inputMode="email" enterKeyHint="next"
              autoCapitalize="none" spellCheck={false}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? 'admin-login-error' : undefined}
              placeholder="admin@example.com"
            />
          </div>
        </div>
        <div className="au-field" style={{ marginBottom: 22 }}>
          <label htmlFor="admin-password" className="au-label">Password</label>
          <div className="au-inwrap">
            <AuIcon name="lock" />
            <input
              id="admin-password" name="password" className="au-input"
              type="password" value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password" enterKeyHint="go"
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? 'admin-login-error' : undefined}
              placeholder="Your password"
            />
          </div>
        </div>
        <button
          type="submit" className="btn btn-dark btn-full au-primary" disabled={loading}
          aria-busy={loading}
          aria-label={loading ? 'Signing in' : undefined}
        >
          {loading ? <span className="spinner" aria-hidden="true" /> : 'Enter admin panel'}
        </button>
      </form>
    </AuthShell>
  );
}
