// SERVER-ONLY. The single admin check shared by every admin-triggered send
// endpoint (api/send-order-email.js, api/send-order-whatsapp.js,
// api/send-test-email.js). Lives in src/utils rather than api/ because every
// file under api/ counts against Vercel's serverless-function limit.
//
// Resolves to { ok: false, status, error } or, on success,
// { ok: true, adminEmail, token, client } where `client` is a Supabase client
// scoped to the caller's own token -- the follow-up queries (orders, templates,
// settings) run as the real authenticated admin under RLS, never with a
// privileged key.
import { createClient } from '@supabase/supabase-js';

export async function requireAdmin(req, label = 'requireAdmin') {
  const authHeader = req.headers?.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return { ok: false, status: 401, error: 'Missing authorization token.' };

  const adminEmail = (process.env.REACT_APP_ADMIN_EMAIL || '').trim();
  if (!adminEmail) {
    // Misconfiguration, not a client error -- fail closed rather than ever
    // treating "no admin configured" as "anyone is admin".
    console.error(`${label}: REACT_APP_ADMIN_EMAIL is not set.`);
    return { ok: false, status: 500, error: 'Admin is not configured.' };
  }

  const url = process.env.REACT_APP_SUPABASE_URL;
  const anonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error(`${label}: Supabase is not configured.`);
    return { ok: false, status: 500, error: 'Admin is not configured.' };
  }

  // Passing the JWT explicitly makes Supabase validate it against the auth
  // server and return the real user it belongs to -- a forged or expired
  // token simply fails here.
  const { data: userData, error: userErr } = await createClient(url, anonKey).auth.getUser(token);
  const user = userData?.user;
  if (userErr || !user?.email) return { ok: false, status: 401, error: 'Invalid or expired session.' };

  // The admin address is public (REACT_APP_ vars ship in the browser bundle),
  // so the email string alone must never be enough: the account has to have
  // actually proven ownership of that address.
  if (!user.email_confirmed_at) return { ok: false, status: 403, error: 'Not authorized.' };
  if (user.email.trim().toLowerCase() !== adminEmail.toLowerCase()) return { ok: false, status: 403, error: 'Not authorized.' };

  const client = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
  return { ok: true, adminEmail, token, client };
}
