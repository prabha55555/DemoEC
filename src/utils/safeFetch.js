import { withTimeout } from './withTimeout';

// A stalled connection (dropped mid-request, no error, no response -- just never
// settling) and an expired login session both need handling everywhere a
// Supabase query runs, not just the one place they were first noticed and fixed
// (Admin's Dashboard, commit d18d451 / 8364c5f). This is that fix, factored out
// so every other fetch site can use the same one instead of re-copying it.
export function isAuthExpiredError(err) {
  return !!err && /jwt|token|expired|401/i.test(err.message || err.code || '');
}

// Wraps a Supabase query promise (or anything resolving to {data, error}) with a
// timeout, so a stall always settles one way or another instead of hanging the
// caller's loading state forever. Returns `timedOut: true` (with `error` set to
// the timeout) if the timeout won the race, so callers can tell "genuinely no
// data" apart from "never got an answer."
export async function safeQuery(promise, timeoutMs = 10000) {
  try {
    const result = await withTimeout(promise, timeoutMs);
    return { data: result?.data ?? null, error: result?.error ?? null, timedOut: false };
  } catch (e) {
    return { data: null, error: e, timedOut: true };
  }
}
