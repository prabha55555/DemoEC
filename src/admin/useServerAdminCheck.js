import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { withTimeout } from '../utils/withTimeout';

// Whether the DATABASE recognises this login as the store admin.
//
// The browser-side admin check (isAdminUser) only looks at the signed-in email. Every admin read and write is
// actually decided by row-level security through public.is_admin() -- and when that says "no" (a session issued
// before the admin account was recreated, a mismatched admin address, an unconfirmed email) Postgres does not raise
// an error: lists simply come back EMPTY and writes change nothing. The result is an admin that looks healthy but
// shows "0 orders" everywhere. So the shell asks the same function once per login and shows an access-denied screen
// instead of a misleading empty panel.
//
//   'checking'  asking · 'ok'  the database accepts this login · 'denied'  it does not ·
//   'unknown'   could not ask (offline, function missing): do NOT block the admin, the per-screen errors still apply
const confirmedUsers = new Set(); // user ids already confirmed during this page session (skips the round trip on remounts)

export default function useServerAdminCheck(userId) {
  const [state, setState] = useState(() => (userId && confirmedUsers.has(userId) ? 'ok' : 'checking'));

  useEffect(() => {
    if (!userId) return undefined;
    if (confirmedUsers.has(userId)) { setState('ok'); return undefined; }
    let cancelled = false;
    setState('checking');
    withTimeout(supabase.rpc('is_admin'), 8000)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setState('unknown');
        else if (data === true) { confirmedUsers.add(userId); setState('ok'); }
        else setState('denied');
      })
      .catch(() => { if (!cancelled) setState('unknown'); });
    return () => { cancelled = true; };
  }, [userId]);

  return state;
}

// For tests: forget which users were confirmed.
export const resetServerAdminCheck = () => confirmedUsers.clear();
