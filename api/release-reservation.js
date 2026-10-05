// Releases the stock (and, if one was reserved, the coupon use) held by one checkout
// attempt. Deliberately no auth required -- a guest (never logged in) checkout must be
// able to release its own reservation, and the pagehide beacon can't perform an auth
// handshake during page unload anyway.
//
// SECURITY (P0 fix): this endpoint used to also accept a bare `code` and release ANY
// coupon's use by code alone, with nothing tying the caller to a reservation that
// actually held it -- release_coupon_use(p_code) can only decrement a coupon's usage
// counter, never increment it, but a public, unauthenticated "decrement this coupon's
// usage counter" call is by itself a way to defeat max_uses (release, redeem again at
// checkout, repeat). The coupon release is now derived ONLY from the
// checkoutAttemptKey's own pending_orders row (see src/utils/reservations.js), and is
// marked consumed there so it can never be replayed for the same attempt either.
import { supabaseAdmin } from '../src/utils/supabaseAdmin.js';
import { releaseCheckoutReservation } from '../src/utils/reservations.js';
import { isRateLimited, clientIp } from '../src/utils/rateLimit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { checkoutAttemptKey } = req.body || {};
  if (!checkoutAttemptKey || typeof checkoutAttemptKey !== 'string') {
    res.status(400).json({ error: 'Missing checkout attempt identifier.' });
    return;
  }
  // A generous cap -- this fires once per abandoned/failed checkout for a genuine
  // customer, so this only ever throttles someone hammering the endpoint directly.
  if (isRateLimited(`release:${clientIp(req)}`, { limit: 30, windowMs: 60000 })) {
    res.status(429).json({ ok: false, error: 'Too many requests.' });
    return;
  }

  const { ok } = await releaseCheckoutReservation(supabaseAdmin, checkoutAttemptKey);
  // Best-effort/fire-and-forget from the caller's side either way (pagehide beacon,
  // or a definitive checkout failure) -- never surfaced to the customer as an error.
  res.status(200).json({ ok });
}
