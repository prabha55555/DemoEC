// SERVER-ONLY. Everything that gives a checkout attempt's held stock, coupon use and
// gift-card balance back. Takes the service-role Supabase client as its first argument
// (see giftCards.js).
//
// The coupon use and the gift-card balance are each released at most once per attempt:
// every release is tied to the attempt's own pending_orders row and guarded by a
// compare-and-set marker stored in that row's `computed` JSON. Coupons used to be
// releasable by anyone who knew the code, with nothing tying the caller to a reservation
// that actually held it -- see api/release-reservation.js's own header comment.
import { creditGiftCardBalance } from './giftCards.js';

// Looks up the live reservation row for a receipt without consuming it.
export async function peekPendingByReceipt(supabase, receipt) {
  const { data, error } = await supabase
    .from('pending_orders')
    .select('checkout_attempt_key, status, expires_at, computed')
    .eq('receipt', receipt)
    .maybeSingle();
  return { pending: data || null, error };
}

// Marks one boolean flag inside a pending_orders row's `computed` JSON, but only if it
// isn't already set -- the compare-and-set that makes a release idempotent and
// exactly-once. Returns true if THIS call is the one that just set it.
//
// Done by one SQL statement (claim_release_flag, jsonb_set on the CURRENT value): the earlier
// version wrote back a stale copy of `computed`, so setting the gift-card flag erased the coupon
// flag and a repeated release gave the coupon use back a second time.
async function claimReleaseFlag(supabase, checkoutAttemptKey, flag) {
  const { data, error } = await supabase.rpc('claim_release_flag', { p_key: checkoutAttemptKey, p_flag: flag });
  if (error) {
    console.error(`claimReleaseFlag(${flag}) failed.`, error.message, checkoutAttemptKey);
    return false;
  }
  return data === true;
}

// Releases the stock, the coupon use (if any) and the gift-card balance (if any) held by
// one checkout attempt. Safe to call any number of times, from the browser's release
// beacon, from a server path that decided the order cannot proceed, or from the
// application-level expiry sweep. Resolves to { ok, released }.
export async function releaseCheckoutReservation(supabase, checkoutAttemptKey) {
  const { data: row, error: readError } = await supabase
    .from('pending_orders')
    .select('checkout_attempt_key, status, computed')
    .eq('checkout_attempt_key', checkoutAttemptKey)
    .maybeSingle();
  if (readError) {
    console.error('releaseCheckoutReservation: could not read the reservation.', readError.message, checkoutAttemptKey);
    return { ok: false, released: false };
  }
  // No row: already consumed by a finished order, or never existed. Nothing to give back.
  if (!row) return { ok: true, released: false };

  let ok = true;
  const computed = row.computed || {};

  if (computed.couponCode && Number(computed.computedDiscount) > 0) {
    if (await claimReleaseFlag(supabase, checkoutAttemptKey, 'couponReleased')) {
      const { error: couponError } = await supabase.rpc('release_coupon_use', { p_code: computed.couponCode });
      if (couponError) {
        console.error('releaseCheckoutReservation: release_coupon_use failed.', couponError.message, checkoutAttemptKey);
        ok = false;
      }
    }
  }

  if (computed.giftCardCode && Number(computed.computedGiftCardApplied) > 0) {
    if (await claimReleaseFlag(supabase, checkoutAttemptKey, 'giftCardReleased')) {
      const credited = await creditGiftCardBalance(supabase, computed.giftCardCode, computed.computedGiftCardApplied);
      if (!credited) {
        console.error('SECURITY/RECONCILIATION: could not credit back a reserved gift card balance -- needs manual check.', computed.giftCardCode, computed.computedGiftCardApplied, checkoutAttemptKey);
        ok = false;
      }
    }
  }

  // Only actually held for a real (non-gift-card-only) cart -- reserve_product_stock is
  // never called for a gift-card-only checkout attempt, and release_product_stock is a
  // safe no-op when there is nothing under this key to release.
  if (row.status !== 'released') {
    const { error: stockError } = await supabase.rpc('release_product_stock', { p_checkout_attempt_key: checkoutAttemptKey });
    if (stockError) {
      console.error('releaseCheckoutReservation: release_product_stock failed.', stockError.message, checkoutAttemptKey);
      ok = false;
    }
  }
  return { ok, released: true };
}

export async function releaseReservationByReceipt(supabase, receipt) {
  const { pending, error } = await peekPendingByReceipt(supabase, receipt);
  if (error || !pending) return { ok: !error, released: false };
  return releaseCheckoutReservation(supabase, pending.checkout_attempt_key);
}

// Application-level backstop for reservations nobody ever explicitly released (tab killed
// before the pagehide beacon fires, a lost connection, etc). release_expired_reservations
// (called at the top of every create-order request) only knows about stock; this covers
// the coupon/gift-card side too, by piggybacking on the same "someone else starts a
// checkout" moment rather than needing its own cron. Capped and best-effort: never lets a
// slow or partial sweep block the checkout request that triggered it.
export async function sweepExpiredCheckoutReservations(supabase, { limit = 20 } = {}) {
  const { data: expired, error } = await supabase
    .from('pending_orders')
    .select('checkout_attempt_key')
    .eq('status', 'reserved')
    .lt('expires_at', new Date().toISOString())
    .limit(limit);
  if (error || !expired?.length) return;
  for (const row of expired) {
    try { await releaseCheckoutReservation(supabase, row.checkout_attempt_key); }
    catch (err) { console.error('sweepExpiredCheckoutReservations: one release failed.', err?.message, row.checkout_attempt_key); }
  }
}
