import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import AuthShell, { AuIcon } from '../components/AuthShell';

// Reached from the "Forgot Password?" email link (AuthContext.jsx's
// resetPassword sets redirectTo to this route). That link carries a recovery
// token in the URL, which the Supabase client processes automatically
// (detectSessionInUrl) into a short-lived session and a PASSWORD_RECOVERY
// auth event -- this page just needs to notice that happened and let the
// customer set a new password with supabase.auth.updateUser(). Previously
// this route didn't exist at all, so the email link landed on the 404 page
// with no way to actually finish a password reset.
//
// SEC-AUTH-2 (reported, not fixed here): updateUser() below changes the
// password from this recovery session with no re-entry of the OLD password.
// That's correct for a genuine "forgot password" flow (there's no old
// password to check), but Supabase Auth's dashboard has a separate "Secure
// password change" setting that -- for an already-logged-in user changing
// their password some other way -- requires a recent re-authentication.
// Whether that setting is enabled is a Supabase dashboard item, not
// something this client code can enforce.
const MIN_PASSWORD_LENGTH = 8; // client-side floor only -- see Register.jsx's identical note
export default function ResetPassword() {
  const [checked, setChecked] = useState(false);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    // The recovery event can fire before or after this effect attaches (it
    // depends on how fast the Supabase client parses the URL), so both a live
    // PASSWORD_RECOVERY event and an already-established session (checked via
    // getSession) count as "ready" -- whichever settles first wins.
    let settled = false;
    function settle(hasSession) {
      if (settled) return;
      settled = true;
      setReady(hasSession);
      setChecked(true);
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') settle(!!session);
    });
    supabase.auth.getSession().then(({ data: { session } }) => settle(!!session));
    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) { setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setError(''); setLoading(true);
    try {
      const { error: updateErr } = await supabase.auth.updateUser({ password });
      if (updateErr) throw updateErr;
      toast.success('Password updated. Please sign in with your new password.');
      // Signs out of the temporary recovery session -- the customer should
      // land on a normal sign-in with their new password, not get silently
      // carried into the app on the token from the email link.
      await supabase.auth.signOut();
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err.message || 'Could not update your password. Please try again.');
    } finally { setLoading(false); }
  }

  return (
    <AuthShell
      title="Set a new password"
      subtitle={ready ? 'Choose a strong password you have not used before.' : undefined}
      footer={ready ? <Link to="/login">Back to sign in</Link> : undefined}
      trust="Secure password reset."
    >
      {!checked ? (
        <div style={{ textAlign: 'center', padding: '24px 0' }}><span className="spinner" role="status" aria-label="Checking your reset link"></span></div>
      ) : !ready ? (
        <>
          <div role="alert" className="au-alert">
            This password reset link is invalid or has expired. Please request a new one from the login page.
          </div>
          <Link to="/login" className="btn btn-gold btn-full au-primary">Back to Login</Link>
        </>
      ) : (
        <form onSubmit={handleSubmit}>
          {error && <div id="reset-password-error" role="alert" className="au-alert">{error}</div>}
          <div className="au-field">
            <label htmlFor="reset-password" className="au-label">New password</label>
            <div className="au-inwrap">
              <AuIcon name="lock" />
              <input id="reset-password" name="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`} className="au-input"
                autoComplete="new-password" enterKeyHint="next"
                aria-invalid={error ? 'true' : undefined}
                aria-describedby={error ? 'reset-password-error' : undefined}
              />
            </div>
          </div>
          <div className="au-field" style={{ marginBottom: 20 }}>
            <label htmlFor="reset-confirm" className="au-label">Confirm new password</label>
            <div className="au-inwrap">
              <AuIcon name="lock" />
              <input id="reset-confirm" name="confirmPassword" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Repeat your new password" className="au-input"
                autoComplete="new-password" enterKeyHint="go"
                aria-invalid={error ? 'true' : undefined}
                aria-describedby={error ? 'reset-password-error' : undefined}
              />
            </div>
          </div>
          <button type="submit" className="btn btn-gold btn-full au-primary" disabled={loading} aria-busy={loading}>
            {loading ? <span className="spinner" role="status" aria-label="Updating password"></span> : 'Update password'}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
