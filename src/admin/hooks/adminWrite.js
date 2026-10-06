import toast from 'react-hot-toast';
import { withTimeout } from '../../utils/withTimeout';
import { isAuthExpiredError } from '../../utils/safeFetch';

// Fired (on window) when a request fails because the login session is gone; AdminLayout listens and
// sends the admin to /admin/login. Keeps adminWrite a plain function (no router hook needed).
export const AUTH_EXPIRED_EVENT = 'adm:auth-expired';
export function notifyAuthExpired() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}

export const NO_ROWS_MESSAGE = 'Nothing was saved — are you signed in as the store admin?';
export const NO_ROWS_DELETE_MESSAGE = 'Nothing was deleted — are you signed in as the store admin?';

// A database / network error -> a sentence an admin can act on. `overrides` maps an error code to custom
// wording (e.g. { 23505: 'Another template is already the system template for this event.' }).
export function friendlyDbError(error, overrides = {}) {
  if (!error) return 'Something went wrong.';
  const code = String(error.code || '');
  if (overrides[code]) return overrides[code];
  const msg = error.message || String(error);
  if (/timed out/i.test(msg)) return 'Timed out — check your connection and try again.';
  if (isAuthExpiredError(error)) return 'Your session has expired — please sign in again.';
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) return "You don't have permission to do that — are you signed in as the store admin?";
  if (code === '23505') return 'That already exists — it has to be unique.';
  if (code === '23503') return "That is still used by something else, so it can't be removed or changed this way.";
  if (code === '42P01' || code === 'PGRST205') return 'A required table is missing — run the latest supabase/schema.sql in Supabase.';
  if (code === '42703') return `A required column is missing — run the latest supabase/schema.sql in Supabase. (${msg})`;
  return msg;
}

export const isPermissionError = (e) => !!e && (String(e.code) === '42501' || /row-level security|permission denied/i.test(e.message || ''));

// Wraps a Supabase write (insert / update / upsert / delete builder) so it can never fail silently.
//
// Row-level security turns a forbidden UPDATE or DELETE into HTTP 200 with ZERO rows changed -- no error
// at all -- so "no error" does not mean "saved". adminWrite appends `.select()` and treats an empty result
// as a failure. It never throws:
//
//   const { ok, data, error } = await adminWrite(
//     supabase.from('coupons').update({ active: false }).eq('id', id),
//     { success: 'Coupon switched off.' });
//   if (!ok) return;            // the failure was already toasted
//
// opts: success (toast text on success) · failure (replaces the error text) · errors ({ code: text }) ·
//       silent (no toasts at all) · noRowsMessage · expectRows (default true; pass false for a write that
//       legitimately affects nothing) · timeoutMs (default 20000).
// Returns { ok, data (array of the affected rows), error ({ message, code }) }.
export async function adminWrite(builder, opts = {}) {
  const { success, failure, errors, silent = false, expectRows = true, timeoutMs = 20000 } = opts;
  const isDelete = builder?.method === 'DELETE';
  const noRows = opts.noRowsMessage || (isDelete ? NO_ROWS_DELETE_MESSAGE : NO_ROWS_MESSAGE);
  let res;
  try {
    res = await withTimeout(builder.select(), timeoutMs);
  } catch (e) {
    return fail({ message: e?.message || 'Request failed', code: 'EXCEPTION' });
  }
  if (res?.error) return fail(res.error);
  const data = Array.isArray(res?.data) ? res.data : (res?.data ? [res.data] : []);
  if (expectRows && data.length === 0) return fail({ message: noRows, code: 'NO_ROWS' }, noRows);
  if (success && !silent) toast.success(success);
  return { ok: true, data, error: null };

  function fail(error, forcedMessage) {
    if (isAuthExpiredError(error)) notifyAuthExpired();
    const message = forcedMessage || failure || friendlyDbError(error, errors);
    if (!silent) toast.error(message);
    return { ok: false, data: [], error: { message, code: error.code || null, original: error } };
  }
}
