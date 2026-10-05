import React, { createContext, useContext, useEffect, useState } from 'react';
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

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);

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
  // Both calls here are timeboxed -- this function is awaited before setLoading(false)
  // in the session bootstrap below, and every other DB call in this codebase that
  // gates a loading screen already gets this treatment for exactly this reason: a
  // stalled connection (dropped mid-request, no error, no response) with no timeout
  // left the caller's `loading` true forever, and since ProtectedRoute/AdminRoute
  // render nothing at all while loading, the entire page -- not just a spinner --
  // appeared to hang indefinitely, with a manual refresh as the only way out. This
  // was the one place in the login path that never got that fix.
  async function ensureProfile(user) {
    try {
      const { data } = await withTimeout(supabase.from('profiles').select('id').eq('id', user.id).single(), 8000);
      if (!data) {
        const { error: insertErr } = await withTimeout(supabase.from('profiles').insert({
          id: user.id,
          name: user.user_metadata?.name || user.email?.split('@')[0] || '',
          phone: user.user_metadata?.phone || '',
          marketing_opt_in: user.user_metadata?.marketing_opt_in ?? false,
          addresses: []
        }), 8000);
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
    return data;
  }

  // Completes a mobile-number (MSG91 OTP) login. `tokenHash` is the single-use token api/msg91-login.js
  // returns AFTER verifying the OTP with MSG91 server-side; exchanging it here is the standard Supabase
  // verifyOtp call, so the session that results is an ordinary one (onAuthStateChange picks it up).
  async function loginWithMobileToken(tokenHash) {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
    if (error) throw error;
    return data;
  }

  async function loginWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
    if (error) throw error;
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
    // that handler.
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
    }
  }, []);

  useEffect(() => {
    // Get initial session -- raced against a timeout since a stalled connection
    // (dropped mid-request, no error, no response) leaves this pending forever
    // otherwise, which permanently blanks every route gated by `loading` (Account,
    // Admin -- see ProtectedRoute/AdminRoute's `if (loading) return null;`).
    withTimeout(supabase.auth.getSession(), 8000).then(async ({ data: { session } }) => {
      const user = session?.user || null;
      setCurrentUser(user);
      if (user) { await ensureProfile(user); fetchProfile(user.id); }
      setLoading(false);
    }).catch(() => setLoading(false));

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        const user = session?.user || null;
        setCurrentUser(user);
        if (user) {
          await ensureProfile(user);
          fetchProfile(user.id);
        } else {
          setUserProfile(null);
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
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
