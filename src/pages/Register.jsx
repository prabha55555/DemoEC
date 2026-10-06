import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import AuthShell, { AuIcon } from '../components/AuthShell';

// Client-side floor only -- Supabase Auth's own dashboard "Minimum password
// length" setting (Authentication > Providers > Email) is the real gate;
// raising it here without also raising it there doesn't add any actual
// strength, it only changes when the error shows up.
const MIN_PASSWORD_LENGTH = 8;

// autoComplete per RFC-ish browser/password-manager field hints (per-field, not
// a per-field object here since each key maps 1:1 already).
const FIELD_META = {
  name:     { autoComplete: 'name',          inputMode: undefined, enterKeyHint: 'next' },
  email:    { autoComplete: 'email',         inputMode: 'email',   enterKeyHint: 'next' },
  phone:    { autoComplete: 'tel',           inputMode: 'tel',     enterKeyHint: 'next' },
  password: { autoComplete: 'new-password',  inputMode: undefined, enterKeyHint: 'next' },
  confirm:  { autoComplete: 'new-password',  inputMode: undefined, enterKeyHint: 'go' },
};

export default function Register() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [gLoading, setGLoading] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  // Set when the project requires email confirmation: sign-up succeeded but there is no session yet.
  const [pendingEmail, setPendingEmail] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [resending, setResending] = useState(false);
  const { registerWithEmail, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Same redirect-back contract as Login.jsx -- a guest sent here via /checkout ->
  // /login -> "Create an account" should land back at checkout after registering,
  // not always at /account. Includes .search (not just .pathname) -- ProtectedRoute
  // passes the full location, so a deep link like /account?tab=addresses was
  // otherwise landing on the plain Dashboard tab after signing in.
  const fromLoc = location.state?.from;
  const from = fromLoc ? `${fromLoc.pathname}${fromLoc.search || ''}` : '/account';

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setTimeout(() => setResendIn(n => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function resendConfirmation() {
    if (resendIn > 0 || resending || !pendingEmail) return;
    setResending(true);
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email: pendingEmail });
      if (error) throw error;
      toast.success('Confirmation email sent again.');
      setResendIn(30);
    } catch (err) { toast.error(err.message || 'Could not resend the email. Please try again shortly.'); }
    finally { setResending(false); }
  }

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: '' })); }

  function validate() {
    const e = {};
    if (!form.name.trim()) e.name = 'Full name is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Valid email required';
    if (!form.phone.trim()) e.phone = 'Phone number required';
    else if (!/^[6-9]\d{9}$/.test(form.phone.trim().replace(/\D/g, '').slice(-10))) e.phone = 'Enter a valid 10-digit phone number';
    if (form.password.length < MIN_PASSWORD_LENGTH) e.password = `At least ${MIN_PASSWORD_LENGTH} characters`;
    if (form.password !== form.confirm) e.confirm = 'Passwords do not match';
    if (!agreedToTerms) e.terms = 'Please accept the Terms & Conditions to continue';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleRegister(e) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const result = await registerWithEmail(form.name.trim(), form.email.trim(), form.password, form.phone, marketingOptIn);
      if (result?.session) {
        toast.success(`Welcome, ${form.name.trim()}!`);
        navigate(from, { replace: true });
      } else {
        // "Confirm email" is on: no session until the link in the inbox is opened. Say so instead of
        // pretending the customer is signed in.
        setPendingEmail(form.email.trim());
        setResendIn(30);
      }
    } catch (err) {
      // Deliberately generic -- confirming "this email already exists" lets an
      // attacker enumerate registered customers one address at a time. Supabase
      // itself still sends the account owner an actionable email in this case;
      // this is only about what the FORM says back to whoever's typing.
      if (err.message?.includes('already registered')) {
        setErrors(e => ({ ...e, email: 'Could not create an account with these details. If you already have one, try signing in instead.' }));
      } else { toast.error(err.message || 'Registration failed.'); }
    } finally { setLoading(false); }
  }

  async function handleGoogle() {
    if (!agreedToTerms) {
      // The terms checkbox sits below this button, so a toast (not just the
      // inline field error) makes sure the rejection is actually seen.
      toast.error('Please accept the Terms & Conditions to continue.');
      setErrors(e => ({ ...e, terms: 'Please accept the Terms & Conditions to continue' }));
      return;
    }
    setGLoading(true);
    try { await loginWithGoogle(from); }
    catch (err) { toast.error('Google sign-in failed.'); setGLoading(false); }
  }

  if (pendingEmail) {
    return (
      <AuthShell
        title="Check your email"
        subtitle={<>We have sent a confirmation link to <strong>{pendingEmail}</strong>. Open it to activate your account, then sign in.</>}
        footer={<>Wrong address? <button type="button" className="au-linkbtn" onClick={() => { setPendingEmail(''); setResendIn(0); }}>Start again</button></>}
        trust="Can't find it? Check your spam or promotions folder."
      >
        <div role="status" className="au-ok">Your account is created but not active until the email is confirmed.</div>
        <Link to="/login" state={location.state} className="btn btn-gold btn-full au-primary">Go to sign in</Link>
        <button type="button" className="btn btn-outline btn-full au-primary" onClick={resendConfirmation} disabled={resendIn > 0 || resending} style={{ marginTop: 10 }}>
          {resending ? <span className="spinner" role="status" aria-label="Sending"></span> : resendIn > 0 ? `Resend email (${resendIn}s)` : 'Resend email'}
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Join Brightlight Solutions to order faster and track every delivery."
      footer={<>Already have an account? <Link to="/login" state={location.state}>Sign in</Link></>}
      trust="Your details are used only to process your orders."
    >
      {/* GOOGLE */}
      <button type="button" className="au-google" onClick={handleGoogle} disabled={gLoading}>
        {gLoading ? <span className="spinner" style={{ width: 16, height: 16 }}></span> : (
          <>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Continue with Google
          </>
        )}
      </button>

      <div className="au-or" aria-hidden="true">or sign up with email</div>

      <form onSubmit={handleRegister}>
        <div className="au-grid">
        {[
          { label: 'Full name', key: 'name',     type: 'text',     ph: 'Your full name', icon: 'user', full: true },
          { label: 'Email address', key: 'email', type: 'email',   ph: 'you@example.com', icon: 'mail', full: true },
          { label: 'Mobile number', key: 'phone', type: 'tel',     ph: '10-digit mobile number', icon: 'phone', full: true },
          { label: 'Password',  key: 'password', type: 'password', ph: `At least ${MIN_PASSWORD_LENGTH} characters`, icon: 'lock' },
          { label: 'Confirm password', key: 'confirm', type: 'password', ph: 'Repeat your password', icon: 'lock' },
        ].map(({ label, key, type, ph, icon, full }) => {
          const meta = FIELD_META[key];
          const errorId = `register-${key}-error`;
          return (
            <div key={key} className="au-field" style={full ? { gridColumn: '1 / -1' } : undefined}>
              <label className="au-label" htmlFor={`register-${key}`}>{label}</label>
              <div className="au-inwrap">
                <AuIcon name={icon} />
                <input
                  id={`register-${key}`} name={key} className="au-input"
                  type={type} value={form[key]} placeholder={ph} onChange={e => set(key, e.target.value)}
                  autoComplete={meta.autoComplete} inputMode={meta.inputMode} enterKeyHint={meta.enterKeyHint}
                  autoCapitalize={key === 'email' ? 'none' : undefined} spellCheck={key === 'email' ? false : undefined}
                  aria-invalid={errors[key] ? 'true' : undefined}
                  aria-describedby={errors[key] ? errorId : undefined}
                />
              </div>
              {errors[key] && <div id={errorId} role="alert" className="au-fielderr">{errors[key]}</div>}
            </div>
          );
        })}
        </div>

        {/* REQUIRED — terms + how we use your data */}
        <div style={{ marginBottom: 14 }}>
          <label className="au-check">
            <input
              type="checkbox"
              checked={agreedToTerms}
              aria-invalid={errors.terms ? 'true' : undefined}
              aria-describedby={errors.terms ? 'register-terms-error' : undefined}
              onChange={e => { setAgreedToTerms(e.target.checked); setErrors(er => ({ ...er, terms: '' })); }}
            />
            <span>
              I agree to the <Link to="/terms" target="_blank">Terms &amp; Conditions</Link> and{' '}
              <Link to="/privacy-policy" target="_blank">Privacy Policy</Link>, including how my order and account details are stored and used to process orders and improve this website.
            </span>
          </label>
          {errors.terms && <div id="register-terms-error" role="alert" className="au-fielderr" style={{ marginLeft: 26 }}>{errors.terms}</div>}
        </div>

        {/* OPTIONAL — marketing consent, kept separate and unchecked by default */}
        <div style={{ marginBottom: 20 }}>
          <label className="au-check">
            <input
              type="checkbox"
              checked={marketingOptIn}
              onChange={e => setMarketingOptIn(e.target.checked)}
            />
            <span>
              Email me about new products and special offers. Optional — you can turn this off anytime from your account.
            </span>
          </label>
        </div>

        <button type="submit" className="btn btn-gold btn-full au-primary" disabled={loading} aria-busy={loading}>
          {loading ? <span className="spinner" role="status" aria-label="Creating account"></span> : 'Create account'}
        </button>
      </form>
    </AuthShell>
  );
}
