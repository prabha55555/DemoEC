import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { withTimeout } from '../utils/withTimeout';
import toast from 'react-hot-toast';

const AuthContext = createContext();
export function useAuth() { return useContext(AuthContext); }

// UI-only gate -- RLS and the requireAdmin() check in api/*.js are the real
// enforcement. Normalised the same way those server checks are (trimmed,
// case-insensitive, confirmed address only) so the client never shows the admin
// panel to an account the server would reject.
export function isAdminUser(user) {
  const adminEmail = (process.env.REACT_APP_ADMIN_EMAIL || '').trim().toLowerCase();
  return !!adminEmail
    && !!user?.email_confirmed_at
    && (user.email || '').trim().toLowerCase() === adminEmail;
}

// Where to send the customer after an OAuth round trip. The Google redirect lands on the site root with
// no memory of where the customer was (checkout, a deep link into Account ...), so the intended path is
// parked in sessionStorage before leaving and taken back out when the SIGNED_IN event arrives. Only a
// same-site path, and only for a few minutes, so a stale entry can never steer a later, unrelated login.
const AFTER_LOGIN_KEY = 'tt_after_login';
const AFTER_LOGIN_TTL_MS = 10 * 60 * 1000;

export function isInternalReturnPath(p) {
  return typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/\\') && p.length < 500;
}
function rememberAfterLogin(path) {
  try {
    if (isInternalReturnPath(path)) sessionStorage.setItem(AFTER_LOGIN_KEY, JSON.stringify({ path, ts: Date.now() }));
    else sessionStorage.removeItem(AFTER_LOGIN_KEY);
  } catch { /* storage blocked -- the customer simply lands on the home page after Google sign-in */ }
}
function takeAfterLogin() {
  try {
    const raw = sessionStorage.getItem(AFTER_LOGIN_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(AFTER_LOGIN_KEY);
    const { path, ts } = JSON.parse(raw);
    return isInternalReturnPath(path) && Date.now() - ts < AFTER_LOGIN_TTL_MS ? path : null;
  } catch { return null; }
}
function forgetAfterLogin() { try { sessionStorage.removeItem(AFTER_LOGIN_KEY); } catch { /* ignore */ } }

// Every auth event hands back a fresh `user` object even when nothing about the customer changed (a
// background token refresh). Keeping the old reference stops every effect keyed on `currentUser` from
// re-running (Account re-fetching orders, wishlist re-merging ...).
const sameUser = (a, b) => !!a && !!b && a.id === b.id && a.email === b.email && a.updated_at === b.updated_at
  && a.email_confirmed_at === b.email_confirmed_at && a.app_metadata?.msg91_phone === b.app_metadata?.msg91_phone;

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  // Profile sync is skipped when the same user was only just synced (session restore and the
  // INITIAL_SESSION / SIGNED_IN events that follow it all arrive within moments of each other).
  const lastSyncRef = useRef({ id: null, at: 0 });

  const isAdmin = isAdminUser(currentUser);

  async function fetchProfile(userId) {
    try {
      const { data } = await withTimeout(supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single(), 8000);
      if (data) setUserProfile(data);
    } catch (e) { /* keep null -- covers both a real error and a timeout */ }
  }

  // Single source of truth for "does this user have a profile row yet" — called both
  // on initial session restore and on every SIGNED_IN event, so a profile that failed
  // to get created at signup (or was later deleted) gets repaired for returning users
  // too, not just brand-new sign-ins.
  //
  // Both calls here are timeboxed -- the session bootstrap below waits for this before
  // setLoading(false), and every other DB call in this codebase that gates a loading
  // screen already gets this treatment for exactly this reason: a stalled connection
  // (dropped mid-request, no error, no response) with no timeout left the caller's
  // `loading` true forever, and since ProtectedRoute/AdminRoute render a spinner while
  // loading, the entire page appeared to hang indefinitely, with a manual refresh as
  // the only way out.
  // One request per user at a time: sign-in fires both the session bootstrap and a SIGNED_IN event within
  // moments of each other, and two overlapping checks each saw "no profile yet" and both inserted
  // (a 409 "profiles_pkey" error on every login). Callers share the one in flight.
  const profileChecks = new Map();   // user id -> promise
  function ensureProfile(user) {
    if (profileChecks.has(user.id)) return profileChecks.get(user.id);
    const run = createProfileIfMissing(user).finally(() => profileChecks.delete(user.id));
    profileChecks.set(user.id, run);
    return run;
  }

  async function createProfileIfMissing(user) {
    try {
      // maybeSingle: "no row yet" is a normal answer here, not a 406 error.
      const { data } = await withTimeout(supabase.from('profiles').select('id').eq('id', user.id).maybeSingle(), 8000);
      if (!data) {
        // ignoreDuplicates = INSERT ... ON CONFLICT DO NOTHING, so even a request that slips past the guard
        // above (another tab, a retry) can never fail on the primary key.
        const { error: insertErr } = await withTimeout(supabase.from('profiles').upsert({
          id: user.id,
          name: user.user_metadata?.name || user.email?.split('@')[0] || '',
          phone: user.user_metadata?.phone || '',
          marketing_opt_in: user.user_metadata?.marketing_opt_in ?? false,
          addresses: []
        }, { onConflict: 'id', ignoreDuplicates: true }), 8000);
        // Supabase resolves with {error}, it doesn't throw -- without this, an RLS
        // denial or constraint failure here was invisible, not even reaching the
        // catch below, leaving a user permanently profile-less with no trace at all.
        if (insertErr) console.error('ensureProfile insert failed:', insertErr, 'for user', user.id);
      }
    } catch (e) { console.error('ensureProfile failed:', e); /* best-effort repair; fetchProfile below will just keep userProfile null */ }
  }

  async function loginWithEmail(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    forgetAfterLogin(); // the page that called us navigates itself; a parked Google return path must not override it
    return data;
  }

  // Completes a mobile-number (MSG91 OTP) login. `tokenHash` is the single-use token api/msg91-login.js
  // returns AFTER verifying the OTP with MSG91 server-side; exchanging it here is the standard Supabase
  // verifyOtp call, so the session that results is an ordinary one (onAuthStateChange picks it up).
  async function loginWithMobileToken(tokenHash) {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
    if (error) throw error;
    forgetAfterLogin();
    return data;
  }

  // `returnTo` = the same-site path (with query) to come back to once Google has signed the customer in.
  async function loginWithGoogle(returnTo) {
    rememberAfterLogin(returnTo);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
    if (error) { forgetAfterLogin(); throw error; }
  }

  async function registerWithEmail(name, email, password, phone, marketingOptIn = false) {
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { name, phone, marketing_opt_in: marketingOptIn } }
    });
    if (error) throw error;
    // Profile creation is handled centrally by ensureProfile() when the resulting
    // SIGNED_IN event fires, using this same name/phone/marketing_opt_in (via
    // user_metadata) — avoids a duplicate-insert race between this function and
    // that handler. When the project requires email confirmation there is no session
    // yet (`data.session` is null) and the caller must tell the customer to check their inbox.
    return data;
  }

  async function resetPassword(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`
    });
    if (error) throw error;
  }

  async function logout() {
    await supabase.auth.signOut();
    lastSyncRef.current = { id: null, at: 0 };
    setCurrentUser(null);
    setUserProfile(null);
  }

  async function refreshProfile() {
    if (!currentUser) return;
    await fetchProfile(currentUser.id);
  }

  async function updateProfile(updates) {
    if (!currentUser) return;
    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', currentUser.id);
    if (error) throw error;
    await fetchProfile(currentUser.id);
  }

  useEffect(() => {
    // A cancelled or failed Google OAuth attempt redirects back here with
    // #error=...&error_description=... in the URL instead of a real session --
    // there's no dedicated OAuth callback route, so nothing was ever reading
    // this, and a customer who cancelled the consent screen just landed back
    // on the homepage with zero explanation. Runs once, on mount, since this
    // hash only ever appears immediately after that redirect.
    if (window.location.hash.includes('error=')) {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const desc = params.get('error_description');
      toast.error(desc ? desc.replace(/\+/g, ' ') : 'Sign-in was cancelled or failed. Please try again.');
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      forgetAfterLogin();
    }
  }, []);

  useEffect(() => {
    let alive = true;

    // Makes sure the signed-in user has a profile row, then loads it. Always ends by clearing `loading`.
    // Never awaited inside an auth callback (see below).
    function syncProfile(user) {
      const last = lastSyncRef.current;
      if (last.id === user.id && Date.now() - last.at < 2500) { if (alive) setLoading(false); return Promise.resolve(); }
      lastSyncRef.current = { id: user.id, at: Date.now() };
      return ensureProfile(user)
        .then(() => { fetchProfile(user.id); })
        .catch(() => { /* ensureProfile logs its own failures */ })
        .finally(() => { if (alive) setLoading(false); });
    }

    // Get initial session -- raced against a timeout since a stalled connection
    // (dropped mid-request, no error, no response) leaves this pending forever
    // otherwise, which permanently blanks every route gated by `loading` (Account,
    // Admin -- see ProtectedRoute/AdminRoute).
    withTimeout(supabase.auth.getSession(), 8000).then(({ data: { session } }) => {
      if (!alive) return null;
      const user = session?.user || null;
      setCurrentUser(prev => (sameUser(prev, user) ? prev : user));
      if (user) return syncProfile(user);
      setLoading(false);
      return null;
    }).catch(() => { if (alive) setLoading(false); });

    // Listen for auth changes. supabase-js holds an internal lock while it runs this callback, so
    // awaiting another supabase call INSIDE it (ensureProfile / fetchProfile) can deadlock the client.
    // The callback only records the user; everything that talks to Supabase is deferred to the next tick.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const user = session?.user || null;
      setCurrentUser(prev => (sameUser(prev, user) ? prev : user));
      if (!user) {
        lastSyncRef.current = { id: null, at: 0 };
        setUserProfile(null);
        setLoading(false);
        return;
      }
      if (event === 'SIGNED_IN') {
        const back = takeAfterLogin();
        if (back) navigate(back, { replace: true });
      }
      if (event === 'TOKEN_REFRESHED') { setLoading(false); return; } // same customer, nothing to re-sync
      setTimeout(() => { syncProfile(user); }, 0);
    });

    return () => { alive = false; subscription.unsubscribe(); };
    // eslint-disable-next-line
  }, []);

  const value = {
    currentUser, userProfile, isAdmin, loading,
    loginWithEmail, loginWithMobileToken, loginWithGoogle, registerWithEmail,
    resetPassword, logout, refreshProfile, updateProfile,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
