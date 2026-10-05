import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { msg91Configured, openMsg91Widget, cancelMsg91Session, msg91WidgetOpen } from '../utils/msg91Widget';
import toast from 'react-hot-toast';
import AuthShell, { AuIcon } from '../components/AuthShell';

export default function Login() {
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [gLoading, setGLoading] = useState(false);
  const [error, setError]     = useState('');
  const [resetSent, setResetSent] = useState(false);
  const { loginWithEmail, loginWithMobileToken, loginWithGoogle, resetPassword } = useAuth();
  const [method, setMethod] = useState('email'); // 'email' | 'mobile'
  const [mobileBusy, setMobileBusy] = useState(false);
  // Set when the verified number is already linked to an existing account (server answer: ACCOUNT_EXISTS).
  const [conflict, setConflict] = useState(null); // { hints: string[], continueToken: string } | null
  const [conflictNote, setConflictNote] = useState('');
  const mountedRef = useRef(true);
  const mobileEnabled = msg91Configured();
  const navigate = useNavigate();
  const location = useLocation();
  // Includes .search (not just .pathname) -- ProtectedRoute passes the full
  // location, so a deep link like /account?tab=addresses was otherwise landing
  // on the plain Dashboard tab after signing in.
  const fromLoc = location.state?.from;
  const from = fromLoc ? `${fromLoc.pathname}${fromLoc.search || ''}` : '/account';

  async function handleEmail(e) {
    e.preventDefault();
    if (!email || !password) { setError('Please enter email and password.'); return; }
    setLoading(true); setError('');
    try {
      await loginWithEmail(email.trim(), password);
      toast.success('Welcome back!');
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed. Please check your details.');
    } finally { setLoading(false); }
  }

  // Leaving /login must never leave a live callback that could complete a login (or set state) later.
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; cancelMsg91Session(); };
  }, []);

  const MOBILE_ERRORS = {
    not_configured: 'Mobile login is not available right now. Please use email instead.',
    script_failed: 'Could not load mobile verification. Check your connection and try again.',
    init_failed: 'Could not start mobile verification. Please try again.',
    verification_failed: 'We could not verify that number. Please try again.',
    no_token: 'We could not verify that number. Please try again.',
  };

  async function postMobile(payload) {
    const res = await fetch('/api/msg91-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    return { res, json };
  }

  // Exchanges the single-use token the server issued for a normal Supabase session.
  async function finishMobileLogin(tokenHash) {
    await loginWithMobileToken(tokenHash);
    if (!mountedRef.current) return;
    toast.success('Welcome back!');
    navigate(from, { replace: true });
  }

  // MSG91's own popup collects the number and OTP; all this page ever receives is the access token it
  // returns, which the server verifies with MSG91 before any Supabase session is created.
  async function completeMobileLogin(accessToken) {
    try {
      const { res, json } = await postMobile({ accessToken });
      if (res.status === 409 && json.code === 'ACCOUNT_EXISTS' && json.continueToken) {
        if (mountedRef.current) { setConflict({ hints: Array.isArray(json.hints) ? json.hints : [], continueToken: json.continueToken }); setConflictNote(''); }
        return;
      }
      if (!res.ok || !json.tokenHash) throw new Error(json.error || 'Could not verify your mobile number. Please try again.');
      await finishMobileLogin(json.tokenHash);
    } catch (err) {
      if (mountedRef.current) setError(err.message || 'Mobile login failed. Please try again.');
    } finally {
      if (mountedRef.current) setMobileBusy(false);
    }
  }

  // "This is not my account": the customer has just proved they own this number, so continue with it.
  async function continueWithNumber() {
    if (!conflict || mobileBusy) return;
    setMobileBusy(true); setError('');
    try {
      const { res, json } = await postMobile({ action: 'continue', continueToken: conflict.continueToken });
      if (!res.ok || !json.tokenHash) throw new Error(json.error || 'Could not continue. Please verify your number again.');
      await finishMobileLogin(json.tokenHash);
    } catch (err) {
      if (mountedRef.current) setError(err.message || 'Could not continue. Please verify your number again.');
    } finally {
      if (mountedRef.current) setMobileBusy(false);
    }
  }

  async function emailResetLink() {
    if (!conflict || mobileBusy) return;
    setMobileBusy(true); setError('');
    try {
      const { res, json } = await postMobile({ action: 'email-reset', continueToken: conflict.continueToken });
      if (!res.ok) throw new Error(json.error || 'Could not send the reset link. Please try again.');
      if (mountedRef.current) setConflictNote('We have sent a password reset link to the email on that account. Open it, set a new password, then sign in.');
    } catch (err) {
      if (mountedRef.current) setError(err.message || 'Could not send the reset link. Please try again.');
    } finally {
      if (mountedRef.current) setMobileBusy(false);
    }
  }

  function backToEmailLogin() { setConflict(null); setConflictNote(''); setError(''); setMethod('email'); }

  async function handleMobile(force = false) {
    setError('');
    if (mobileBusy && !force) return;
    setMobileBusy(true);
    await openMsg91Widget({
      force,
      onToken: (token) => { if (mountedRef.current) completeMobileLogin(token); },
      onError: (code) => { if (!mountedRef.current) return; setError(MOBILE_ERRORS[code] || MOBILE_ERRORS.verification_failed); setMobileBusy(false); },
    });
  }

  async function handleGoogle() {
    setGLoading(true); setError('');
    try { await loginWithGoogle(); }
    catch (err) { setError('Google sign-in failed.'); setGLoading(false); }
  }

  async function handleReset() {
    if (!email) { setError('Enter your email above to reset password.'); return; }
    try { await resetPassword(email.trim()); setResetSent(true); toast.success('Reset email sent.'); }
    catch { setError('Could not send reset email.'); }
  }

  const errProps = error ? { 'aria-invalid': 'true', 'aria-describedby': 'login-error' } : {};

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to track orders, save items and check out faster."
      footer={<>New here? <Link to="/register" state={location.state}>Create an account</Link></>}
    >
      {error && <div id="login-error" role="alert" className="au-alert">{error}</div>}
      {resetSent && <div role="status" className="au-ok">Password reset email sent. Check your inbox.</div>}

      {/* GOOGLE */}
      <button type="button" className="au-google" onClick={handleGoogle} disabled={gLoading}>
        {gLoading ? <span className="spinner" style={{ width: 16, height: 16 }}></span> : (
          <>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Continue with Google
          </>
        )}
      </button>

      <div className="au-or" aria-hidden="true">or</div>

      <div role="tablist" aria-label="Sign in method" className="au-seg">
        {[['email', 'Email'], ['mobile', 'Mobile Number']].map(([key, label]) => (
          <button key={key} type="button" role="tab" id={`login-tab-${key}`} aria-selected={method === key} aria-controls={`login-panel-${key}`}
            onClick={() => { setMethod(key); setError(''); setConflict(null); setConflictNote(''); }}
          >{label}</button>
        ))}
      </div>

      {method === 'mobile' && conflict && (
        <div role="tabpanel" id="login-panel-mobile" aria-labelledby="login-tab-mobile">
          <div className="au-alert">This mobile number is already linked to an account.</div>
          {conflict.hints.length > 0 && (
            <div className="au-found">
              <small>Account found</small>
              {conflict.hints.map(h => <div key={h}>{h}</div>)}
            </div>
          )}
          <p className="au-hint">To keep accounts safe and avoid duplicates, please use that account.</p>
          {conflictNote && <div role="status" className="au-ok">{conflictNote}</div>}
          <button type="button" className="btn btn-gold btn-full au-primary" onClick={backToEmailLogin}>Sign in with email</button>
          <button type="button" className="btn btn-outline btn-full au-primary" onClick={emailResetLink} disabled={mobileBusy} style={{ marginTop: 10 }}>{mobileBusy ? <span className="spinner" role="status" aria-label="Please wait"></span> : 'Email me a reset link'}</button>
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <button type="button" className="au-linkbtn" onClick={continueWithNumber} disabled={mobileBusy}>This is not my account. Continue with this number.</button>
          </div>
        </div>
      )}

      {method === 'mobile' && !conflict && (
        <div role="tabpanel" id="login-panel-mobile" aria-labelledby="login-tab-mobile">
          <p className="au-hint">
            Sign in with a one-time code sent by SMS to your Indian mobile number. No password needed.
          </p>
          <button type="button" className="btn btn-gold btn-full au-primary" onClick={() => handleMobile(false)} disabled={!mobileEnabled || mobileBusy} aria-busy={mobileBusy}>
            {mobileBusy ? <span className="spinner" role="status" aria-label="Verifying"></span> : 'Continue with Mobile'}
          </button>
          {mobileBusy && msg91WidgetOpen() && (
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <button type="button" className="au-linkbtn" onClick={() => handleMobile(true)}>Closed the window? Open it again</button>
            </div>
          )}
          {!mobileEnabled && <div className="au-hint" style={{ marginTop: 14, textAlign: 'center', marginBottom: 0 }}>Mobile login isn't available right now. Please use email.</div>}
        </div>
      )}

      <form onSubmit={handleEmail} style={{ display: method === 'email' ? 'block' : 'none' }} id="login-panel-email" role="tabpanel" aria-labelledby="login-tab-email">
        <div className="au-field">
          <label htmlFor="login-email" className="au-label">Email address</label>
          <div className="au-inwrap">
            <AuIcon name="mail" />
            <input id="login-email" name="email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className="au-input"
              autoComplete="email" inputMode="email" enterKeyHint="next" autoCapitalize="none" spellCheck={false}
              {...errProps}
            />
          </div>
        </div>
        <div className="au-field">
          <label htmlFor="login-password" className="au-label">Password</label>
          <div className="au-inwrap">
            <AuIcon name="lock" />
            <input id="login-password" name="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Your password" className="au-input"
              autoComplete="current-password" enterKeyHint="go"
              {...errProps}
            />
          </div>
        </div>
        <div className="au-row">
          <button type="button" className="au-linkbtn" onClick={handleReset}>Forgot password?</button>
        </div>
        <button type="submit" className="btn btn-gold btn-full au-primary" disabled={loading} aria-busy={loading}>
          {loading ? <span className="spinner" role="status" aria-label="Signing in"></span> : 'Sign in'}
        </button>
      </form>
    </AuthShell>
  );
}
