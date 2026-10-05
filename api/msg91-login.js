// Mobile-number (OTP) login for customers. The browser runs MSG91's own default OTP widget and
// hands us ONLY the access token that widget returns after the customer typed the correct OTP.
//
// Every request first has MSG91 (server-to-server, with the server-only MSG91_AUTH_KEY) verify that
// token -- the verified mobile number comes from MSG91's answer, never from anything the browser says.
//
// One verified mobile number belongs to exactly ONE account (public.verified_phones, service-role only):
//   * number already registered  -> sign in to THAT account (email, Google or mobile-created alike);
//   * number only TYPED on an old account (profiles.phone, never verified) -> no silent sign-in and no
//     silent duplicate: the customer is told the account exists (masked email) and chooses to sign in,
//     get a reset link, or -- since they have just proved the number -- continue with it as a new account;
//   * number unknown anywhere     -> a new mobile account is created and registered.
// The result is a single-use Supabase token hash the browser exchanges with supabase.auth.verifyOtp(), so
// AuthContext receives an ordinary session. No password is created or stored, no JWT is minted by us, and
// this path can never sign in the admin account.
//
// Actions (one file: the Vercel Hobby plan allows 12 functions and /api is already at 12):
//   (default)     { accessToken }                 -> { tokenHash } | 409 ACCOUNT_EXISTS | 409 EMAIL_UNCONFIRMED
//   'continue'    { action, continueToken }       -> { tokenHash }   (new mobile account despite an unverified claim)
//   'email-reset' { action, continueToken }       -> { ok: true }    (reset link to the account(s) that claim the number)
import { supabaseAdmin } from '../src/utils/supabaseAdmin.js';
import { isRateLimited, clientIp } from '../src/utils/rateLimit.js';
import { signPayload, timingSafeHexEqual } from '../src/utils/signedToken.js';

const MSG91_VERIFY_URL = 'https://api.msg91.com/api/v5/widget/verifyAccessToken';
const INDIAN_MOBILE = /^91[6-9]\d{9}$/;
const CONTINUE_TTL_MS = 10 * 60 * 1000;
const SITE_ORIGINS = ['https://brightlightsolutions.in', 'https://www.brightlightsolutions.in'];

const GENERIC_ERROR = 'Could not verify your mobile number. Please try again.';

function fail(res, status, error, extra) {
  res.status(status).json({ error, ...(extra || {}) });
}

function placeholderEmailFor(mobile) {
  const domain = String(process.env.PHONE_LOGIN_EMAIL_DOMAIN || 'phone.brightlightsolutions.invalid').trim().toLowerCase();
  return `p${mobile}@${domain}`;
}

function isAdminEmail(email) {
  const admin = String(process.env.REACT_APP_ADMIN_EMAIL || '').trim().toLowerCase().replace(/^"|"$/g, '');
  return !!admin && String(email || '').trim().toLowerCase() === admin;
}

function maskEmail(email) {
  const [local = '', domain = ''] = String(email || '').split('@');
  return `${local.slice(0, 1)}•••••@${domain}`;
}

// Short-lived, server-signed proof that THIS server verified THIS number a moment ago. Lets the customer
// continue after the "account already exists" screen without going through the OTP again, and -- because it
// is signed with a server-only secret -- is not a phone number the browser could choose.
function issueContinueToken(mobile, authKey, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ m: mobile, exp: now + CONTINUE_TTL_MS })).toString('base64url');
  return `${payload}.${signPayload(payload, authKey)}`;
}
function readContinueToken(token, authKey, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 600 || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  try {
    if (!timingSafeHexEqual(signPayload(payload, authKey), sig)) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data && INDIAN_MOBILE.test(String(data.m)) && Number(data.exp) > now ? data.m : null;
  } catch { return null; }
}

// Returns the verified "91XXXXXXXXXX" number, or null. Never throws.
async function verifiedMobileFor(accessToken, authKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(MSG91_VERIFY_URL, {
      method: 'POST',
      headers: { authkey: authKey, 'content-type': 'application/json' },
      body: JSON.stringify({ 'access-token': accessToken }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || data.type !== 'success') return null;
    const mobile = String(data.message || '').replace(/\D/g, '');
    return INDIAN_MOBILE.test(mobile) ? mobile : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function tokenHashFor(email) {
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = data?.properties?.hashed_token;
  return { tokenHash: error ? null : tokenHash || null, user: data?.user || null, error };
}

// Accounts that CLAIM this number without having verified it: profiles.phone (typed at registration) matches
// the last ten digits, and the account is not itself a mobile-created one. Throws if the lookup fails, so a
// database problem can never be mistaken for "no claim" (which would allow a duplicate).
async function unverifiedClaimsFor(mobile) {
  const { data: profiles, error } = await supabaseAdmin.from('profiles').select('id').eq('phone_digits', mobile.slice(2)).limit(5);
  if (error) throw new Error(`profiles lookup failed: ${error.code || error.message}`);
  const claims = [];
  for (const row of profiles || []) {
    const { data } = await supabaseAdmin.auth.admin.getUserById(row.id);
    const user = data?.user;
    if (!user?.email || user.app_metadata?.msg91_phone || isAdminEmail(user.email)) continue; // gone, a mobile-created account, or the admin (never involved)
    claims.push(user);
  }
  return claims;
}

async function registerNumber(mobile, userId) {
  const { error } = await supabaseAdmin.from('verified_phones').insert({ phone: mobile, user_id: userId });
  if (error && error.code !== '23505') throw new Error(`verified_phones insert failed: ${error.code || error.message}`);
}

// Signs in (creating once if needed) the mobile-created account for this number.
async function signInMobileAccount(mobile) {
  const email = placeholderEmailFor(mobile);
  const { error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { name: 'Customer', phone: mobile.slice(2), auth_method: 'mobile_otp' },
    app_metadata: { msg91_phone: mobile },
  });
  if (createError && createError.code !== 'email_exists' && !/already.*(registered|exists)/i.test(createError.message || '')) {
    throw new Error(`createUser failed: ${createError.code || createError.status}`);
  }
  const { tokenHash, user } = await tokenHashFor(email);
  if (!tokenHash) throw new Error('generateLink failed');
  // Anti-squatting: only ever sign in an account THIS server created for this exact verified number.
  if (user?.app_metadata?.msg91_phone !== mobile) return { refused: true };
  await registerNumber(mobile, user.id);
  return { tokenHash };
}

// The main decision, given a number MSG91 has just verified.
async function loginFor(mobile, authKey, { force = false } = {}) {
  // 1. Already registered -> that account, whatever kind it is.
  const { data: reg, error: regError } = await supabaseAdmin.from('verified_phones').select('user_id').eq('phone', mobile).maybeSingle();
  if (regError) throw new Error(`registry lookup failed: ${regError.code || regError.message}`);
  if (reg?.user_id) {
    const { data } = await supabaseAdmin.auth.admin.getUserById(reg.user_id);
    const user = data?.user;
    if (user?.email) {
      if (isAdminEmail(user.email)) return { status: 403, error: 'This account cannot sign in with a mobile number.' };
      if (!user.email_confirmed_at) return { status: 409, error: 'Please confirm your email address first, then sign in with your mobile number.', extra: { code: 'EMAIL_UNCONFIRMED' } };
      const { tokenHash } = await tokenHashFor(user.email);
      if (!tokenHash) throw new Error('generateLink failed');
      return { status: 200, body: { tokenHash } };
    }
    // Registry row pointing at a deleted account: drop it and carry on as an unregistered number.
    await supabaseAdmin.from('verified_phones').delete().eq('phone', mobile);
  }

  // 2. Not registered. Someone may still claim it (typed, never verified).
  if (!force) {
    const claims = await unverifiedClaimsFor(mobile);
    if (claims.length > 0) {
      return {
        status: 409,
        error: 'This mobile number is already linked to an account.',
        extra: { code: 'ACCOUNT_EXISTS', hints: claims.map(u => maskEmail(u.email)), continueToken: issueContinueToken(mobile, authKey) },
      };
    }
  }

  // 3. Nobody has it (or the customer just proved it is theirs): the mobile-created account.
  const result = await signInMobileAccount(mobile);
  if (result.refused) return { status: 409, error: 'This mobile number cannot be used to sign in. Please contact us.' };
  return { status: 200, body: { tokenHash: result.tokenHash } };
}

async function sendResetEmails(mobile, req) {
  const claims = await unverifiedClaimsFor(mobile);
  const origin = SITE_ORIGINS.includes(req.headers?.origin) ? req.headers.origin : SITE_ORIGINS[0];
  for (const user of claims) {
    if (isAdminEmail(user.email)) continue; // never trigger anything for the admin account from this path
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(user.email, { redirectTo: `${origin}/reset-password` });
    if (error) console.error('msg91-login: reset email failed.', error.code || error.status);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    fail(res, 405, 'Method not allowed');
    return;
  }

  const authKey = process.env.MSG91_AUTH_KEY;
  if (!authKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    fail(res, 503, 'Mobile login is not available right now.');
    return;
  }

  // Tight per-IP budget: a real customer needs one to three calls per login.
  if (isRateLimited(`msg91-login:${clientIp(req)}`, { limit: 15, windowMs: 10 * 60 * 1000 })) {
    fail(res, 429, 'Too many attempts. Please wait a few minutes and try again.');
    return;
  }

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
  if (!body) {
    fail(res, 400, 'Invalid request.');
    return;
  }
  const action = body.action === undefined ? 'login' : body.action;

  try {
    if (action === 'login') {
      const accessToken = body.accessToken;
      if (typeof accessToken !== 'string' || accessToken.length < 20 || accessToken.length > 4096) {
        fail(res, 400, 'Invalid request.');
        return;
      }
      const mobile = await verifiedMobileFor(accessToken, authKey);
      if (!mobile) {
        fail(res, 401, GENERIC_ERROR);
        return;
      }
      const out = await loginFor(mobile, authKey);
      if (out.status === 200) res.status(200).json(out.body); else fail(res, out.status, out.error, out.extra);
      return;
    }

    if (action === 'continue' || action === 'email-reset') {
      const mobile = readContinueToken(body.continueToken, authKey);
      if (!mobile) {
        fail(res, 401, 'Your verification expired. Please verify your number again.');
        return;
      }
      if (action === 'continue') {
        const out = await loginFor(mobile, authKey, { force: true });
        if (out.status === 200) res.status(200).json(out.body); else fail(res, out.status, out.error, out.extra);
        return;
      }
      await sendResetEmails(mobile, req);
      res.status(200).json({ ok: true });
      return;
    }

    fail(res, 400, 'Invalid request.');
  } catch (err) {
    console.error('msg91-login failed:', err?.message);
    fail(res, 500, GENERIC_ERROR);
  }
}
