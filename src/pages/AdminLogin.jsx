import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth, isAdminUser } from '../context/AuthContext';
import AuthShell, { AuIcon } from '../components/AuthShell';
import useDocumentTitle from '../admin/hooks/useDocumentTitle';

// Same normalisation AuthContext's isAdminUser() applies -- a trimmed,
// case-insensitive compare, so "Admin@Shop.com " is not rejected for typing.
const norm = (s) => (s || '').trim().toLowerCase();

// One wording for every failure that could reveal which address is the admin one.
const GENERIC_LOGIN_ERROR = 'Login failed. Check your email and password.';

// Where to go after signing in: the admin page the visitor was sent here from (AdminRoute passes it in
// location.state.from), so a deep link like /admin/orders/BL-20001 survives the login. Only /admin paths are honoured.
function destination(location) {
  const from = location.state?.from;
  const path = from?.pathname;
  if (typeof path === 'string' && /^\/admin(\/|$)/.test(path) && !path.startsWith('/admin/login')) return `${path}${from.search || ''}`;
  return '/admin';
}

export default function AdminLogin() {
  useDocumentTitle('Admin sign in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { loginWithEmail, currentUser, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Already signed in as the admin: straight to the panel.
  useEffect(() => {
    if (currentUser && isAdmin) navigate(destination(location), { replace: true });
  }, [currentUser, isAdmin, navigate, location]);

  async function handleLogin(e) {
    e.preventDefault();
    if (!email || !password) { setError('Please enter email and password.'); return; }

    // Skips a pointless auth round-trip for any other address. Deliberately the same wording as a wrong password,
    // so this form never confirms which address is the admin one. The server (RLS + requireAdmin) is what
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
        // Signed in, but not as a confirmed admin account -- the effect above will never navigate, so don't leave
        // the button spinning. A right password with an unconfirmed email gets the specific message (the address is
        // already known to be the admin one at this point); anything else gets the generic wording. Either way no
        // live session is left behind that can never open the panel.
        setError(data?.user && !data.user.email_confirmed_at
          ? 'Signed in, but the email on this account is not confirmed. Confirm it in Supabase (Authentication > Users) and try again.'
          : GENERIC_LOGIN_ERROR);
        setLoading(false);
        try { await logout(); } catch { /* best-effort */ }
      }
      // otherwise the effect above navigates once currentUser updates
    } catch (err) {
      setError(err.message || GENERIC_LOGIN_ERROR);
      setLoading(false);
    }
  }

  return (
    <AuthShell
      bare
      title="Admin sign in"
      subtitle="Store administration. Authorised staff only."
      footer={<a href="/">Return to the store</a>}
      trust="Access is restricted and monitored."
    >
      {error && (
        <div id="admin-login-error" role="alert" className="au-alert">
          {error}
        </div>
      )}

      <form onSubmit={handleLogin} noValidate>
        <div className="au-field">
          <label htmlFor="admin-email" className="au-label">Admin email</label>
          <div className="au-inwrap">
            <AuIcon name="mail" />
            <input
              id="admin-email" name="email" className="au-input"
              type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email" inputMode="email" enterKeyHint="next"
              autoCapitalize="none" spellCheck={false} autoFocus
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
