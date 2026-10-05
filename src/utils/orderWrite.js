// Shared by both api/razorpay-verify-payment.js and api/verify-free-order.js --
// the last step of checkout, reached only after each has independently proven
// payment (or a legitimate zero-total) through its own checks. From here on the
// two paths do the exact same thing: claim the payment proof exactly once, then
// write orders/gift_cards using ONLY the server-signed `computed` blob for
// anything price-related. Cart fields the client still supplies (recipient name,
// gift message, shipping address) are never price-sensitive, so they're trusted
// as-is -- but every cart line must match a verified line from the blob, or the
// whole write is refused rather than falling back to a client-sent price.
//
// Deliberately INSERT-only against `orders`, same as the client-side code this
// replaces -- never a SELECT for the happy path. The client doesn't need the row
// back either -- everything Confirmation.jsx shows (order ID, items, total,
// address) is already known to it before this call.
//
// Uses the service-role client, not the anon one -- this function is the single
// trusted finalization step for every checkout path (browser-driven and webhook
// recovery alike), reached only after payment/signature verification has already
// happened in the caller. redeem_coupon_use/reserve_product_stock are privileged
// RPCs that must not be callable by an arbitrary anon request; routing this
// module's calls through service-role is what lets anon EXECUTE be revoked on
// them at the database level without breaking this legitimate path.
import { sendOrderConfirmationEmail } from './sendOrderConfirmationEmail.js';
import { withTimeout } from './withTimeout.js';
import { supabaseAdmin as supabase } from './supabaseAdmin.js';
import { issueGiftCards, creditGiftCardBalance } from './giftCards.js';
import { refundRazorpayPayment } from './razorpayRefund.js';
// Hard cap on the automatic confirmation-email attempt -- this function runs
// inside a Vercel serverless function with its own execution time limit, and
// the customer's response must never be held up (or made to time out) by a
// slow/hung email send.
//
// Must be LARGER than sendTemplateEmail.js's own internal Brevo timeout
// (SEND_TIMEOUT_MS, 10000ms) -- an outer cap shorter than an inner one races
// against it and can "win" first, abandoning the Brevo request and the
// email_sends log insert mid-flight without actually cancelling them. In a
// serverless function, once this promise is given up on, the response gets
// sent and the execution environment can be frozen shortly after -- an
// orphaned request in flight at that moment may never complete, silently
// dropping the email even though nothing here threw or reported a failure.
// (api/razorpay-verify-payment.js and api/verify-free-order.js both declare
// maxDuration to give the whole function enough room for this.)
const CONFIRMATION_EMAIL_TIMEOUT_MS = 12000;
const ALREADY_PROCESSED = 'This payment has already been processed. If you don\'t see your order, please contact us with your payment ID.';

// A captured payment that can no longer become a real order (a hard, unexpected
// failure writing the order itself) is refunded automatically rather than left
// as a stuck "paid but nothing to show for it" claim -- see the orders-insert and
// gift-card-insert failure branches below. Refund failures are logged loudly for
// manual follow-up, never thrown -- the customer-facing error is the same either
// way, and a human needs to see the log regardless of whether Razorpay accepted
// the refund call itself.
async function refundIfPaid({ paymentId, amountPaise, reason }) {
  if (!paymentId || !Number.isFinite(amountPaise) || amountPaise <= 0) return;
  const result = await refundRazorpayPayment({
    keyId: process.env.RAZORPAY_KEY_ID, keySecret: process.env.RAZORPAY_KEY_SECRET,
    paymentId, amountPaise, reason,
  });
  if (!result.ok) {
    console.error('SECURITY/RECONCILIATION: automatic refund failed -- needs manual refund.', paymentId, amountPaise, reason, result.error);
  } else {
    console.error('Order could not be completed after payment -- issued an automatic refund.', paymentId, amountPaise, reason);
  }
}

// Best-effort: a redeemed gift card's balance is debited at RESERVATION time now
// (api/razorpay-create-order.js, atomically, before payment even exists -- see
// its own comment); if the order can't be completed after that, the balance
// must go back regardless of which failure branch below triggered this.
async function creditRedeemedGiftCardIfAny(computed, receipt) {
  if (!(computed.giftCardCode && Number(computed.computedGiftCardApplied) > 0)) return;
  const credited = await creditGiftCardBalance(supabase, computed.giftCardCode, computed.computedGiftCardApplied);
  if (!credited) {
    console.error('SECURITY/RECONCILIATION: could not credit back a redeemed gift card balance after an order-write failure -- needs manual check.', computed.giftCardCode, computed.computedGiftCardApplied, receipt);
  }
}

export async function writeVerifiedOrder({
  paymentKey, computed, receipt, status, paymentId, razorpayOrderId, cart, addr, billAddr,
  userId, userEmail, userName, userPhone, estimatedDelivery,
  // BUG-4 fix: the free/₹0 path (api/verify-free-order.js) has no captured payment to
  // justify honoring an already-expired or missing reservation the way the paid path
  // must (money already moved there; refusing would recreate the exact "customer paid,
  // got nothing" problem the webhook recovery path exists to prevent). When true, a
  // missing/released stock reservation at claim time is a hard refusal instead of the
  // paid path's inventory_issue tolerance. This is checked against the SAME atomic
  // claim_pending_order call below -- there is no separate check-then-claim step, so
  // there's no race between "is this attempt still valid" and "consume it".
  requireLiveReservation = false,
}) {
  const { verifiedItems } = computed;
  const amountPaise = Math.round(Number(computed.computedTotal) * 100);

  // Claims this payment proof exactly once. A unique-violation here means it was
  // already used (or is being used, right now, by a concurrent request) to write
  // an order -- either a genuine replay, or this same request being retried after
  // the client never saw the first response, OR (the common real-world case) the
  // webhook recovery path and this browser-driven call both reached here within
  // moments of each other. Whichever call wins claims the row; the loser looks up
  // the order the winner just wrote and returns it as a normal success instead of
  // an error -- a customer whose browser lost that race must never see "payment
  // could not be verified" for a payment that, from their perspective, plainly
  // worked. (This is the fix for the client-verify-vs-webhook false-failure race.)
  const { error: claimError } = await supabase.from('used_payments').insert({ payment_key: paymentKey, order_id: receipt });
  if (claimError) {
    if (claimError.code === '23505') {
      const { data: existing } = await supabase.from('orders').select('*').eq('order_id', receipt).maybeSingle();
      if (existing) return { ok: true, order: existing, alreadyProcessed: true };
      return { ok: false, error: ALREADY_PROCESSED, retryable: true };
    }
    console.error('used_payments claim failed:', claimError);
    return { ok: false, error: 'Could not verify your order. Please contact us with your payment ID.' };
  }

  // ---- Atomically claim the stock reservation for this checkout attempt ----
  // Claimed by `receipt`, not razorpay_order_id -- receipt is written in the
  // very first pending_orders INSERT (before stock is even reserved, before
  // Razorpay is ever called), so it's always present and correct regardless of
  // whether the later, separate razorpay_order_id update ever ran. This is the
  // ONE place a reservation is ever consumed for a real, proven payment --
  // claim_pending_order's atomic delete-and-return means it can never race
  // unsafely against the expiry sweep: whichever gets here first wins the row.
  let inventoryIssue = null;
  {
    const { data: claimedPending, error: pendingClaimError } = await supabase.rpc('claim_pending_order', { p_receipt: receipt });
    if (pendingClaimError) {
      console.error('claim_pending_order failed during finalization (non-fatal, treated as inventory issue):', pendingClaimError, 'order', receipt);
    }
    const noLiveReservation = !!pendingClaimError || !claimedPending || claimedPending.status === 'released';
    if (noLiveReservation && requireLiveReservation) {
      // Free/₹0 order, no live reservation left to honor -- refuse outright rather
      // than write an order against stock/coupon/gift-card state that may no longer
      // hold. Release the used_payments claim just made above so a genuine retry
      // (a fresh checkout attempt, with its own new receipt) is never blocked by a
      // stale ALREADY_PROCESSED response tied to this now-abandoned receipt.
      const { error: unclaimError } = await supabase.from('used_payments').delete().eq('payment_key', paymentKey).eq('order_id', receipt);
      if (unclaimError) console.error('SECURITY/RECONCILIATION: could not release used_payments claim after a free-order reservation check failed.', unclaimError, 'paymentKey', paymentKey, 'order', receipt);
      return { ok: false, error: 'Your checkout session expired before it could be confirmed. Please try again.', retryable: true };
    }
    if (noLiveReservation) {
      inventoryIssue = {
        detected_at: new Date().toISOString(),
        reason: claimedPending?.status === 'released'
          ? 'Stock reservation expired and was released before payment finalized.'
          : 'No stock reservation record found for this payment at finalization time.',
        items: verifiedItems.filter(v => !v.isGiftCard).map(v => ({ id: v.id, size: v.size || null, qty: v.qty })),
        payment_id: paymentId || null,
      };
      console.error('INVENTORY ISSUE: payment succeeded with no live stock reservation.', 'order', receipt, 'payment', paymentId);
    }
  }

  // Iteration is driven by `verifiedItems` (server-priced, part of the signed
  // blob), NEVER by the client-supplied `cart` -- `cart` is only ever used as a
  // lookup for non-price metadata (recipient info) for a key that's already
  // known to exist. Driving the loop off `cart` instead would let a request
  // with a forged, duplicated cart (many lines repeating the same real id/key)
  // match the same verified entry over and over, writing one full-value
  // gift_cards row -- or one padded order line -- per duplicate, multiplying
  // real value out of a single real payment. Capping at exactly one write per
  // key in `verifiedItems` makes that impossible regardless of what `cart`
  // contains.
  const cartByKey = new Map(cart.map(item => [item.isGiftCard ? `gc:${item.id}` : `${item.id}::${item.size || ''}`, item]));

  const orderItems = [];
  for (const verified of verifiedItems) {
    const key = verified.isGiftCard ? `gc:${verified.id}` : `${verified.id}::${verified.size || ''}`;
    const item = cartByKey.get(key);
    if (!item) {
      await creditRedeemedGiftCardIfAny(computed, receipt);
      await refundIfPaid({ paymentId, amountPaise, reason: 'Cart changed after payment was verified' });
      const { error: unclaimError } = await supabase.from('used_payments').delete().eq('payment_key', paymentKey).eq('order_id', receipt);
      if (unclaimError) console.error('SECURITY/RECONCILIATION: could not release used_payments claim after a cart-mismatch failure.', unclaimError, 'paymentKey', paymentKey, 'order', receipt);
      return { ok: false, error: paymentId ? 'Your cart changed after payment was verified. Your payment has been refunded automatically.' : 'Your cart changed after payment was verified. Please contact us with your payment ID.' };
    }
    orderItems.push({
      id: verified.id, name: verified.name || item.name, qty: verified.qty, price: verified.price, cat: verified.cat, size: verified.size || null,
      ...(verified.isGiftCard ? { isGiftCard: true, recipientName: item.recipientName || null, recipientEmail: item.recipientEmail || null, giftMessage: item.giftMessage || null } : {}),
    });
  }

  // ---- Issue any purchased gift cards, with a server-generated code ----
  // Codes used to be minted in the browser with Math.random (about 31 bits) and
  // inserted verbatim from the client -- guessable, and a collision or a chosen
  // duplicate could only be discovered as an insert failure after payment had
  // already been captured. issueGiftCards (src/utils/giftCards.js) generates a
  // real, high-entropy code server-side per card and retries on a rare
  // collision; its own rollback removes any card it already inserted for this
  // order if a later one in the same order can't be issued, so a partial
  // gift-card write never survives an overall failure below.
  const giftCardVerifiedItems = verifiedItems.filter(v => v.isGiftCard);
  const issuedCodesByLineId = new Map();
  if (giftCardVerifiedItems.length > 0) {
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 6);
    const cards = giftCardVerifiedItems.map(v => {
      const item = cartByKey.get(`gc:${v.id}`);
      return {
        lineKey: `gc:${v.id}`,
        row: {
          initial_value: v.price, balance: v.price, order_id: receipt,
          purchaser_email: userEmail,
          recipient_name: item.recipientName || null, recipient_email: item.recipientEmail || null, message: item.giftMessage || null,
          expires_at: expiresAt.toISOString(),
        },
      };
    });
    const issued = await issueGiftCards(supabase, cards);
    if (!issued.ok) {
      await creditRedeemedGiftCardIfAny(computed, receipt);
      await refundIfPaid({ paymentId, amountPaise, reason: 'Could not issue purchased gift card' });
      const { error: unclaimError } = await supabase.from('used_payments').delete().eq('payment_key', paymentKey).eq('order_id', receipt);
      if (unclaimError) console.error('SECURITY/RECONCILIATION: could not release used_payments claim after a gift-card-issue failure.', unclaimError, 'paymentKey', paymentKey, 'order', receipt);
      return { ok: false, error: paymentId ? 'Could not create your gift card. Your payment has been refunded automatically.' : 'Could not create your gift card. Please contact us with your payment ID.' };
    }
    for (const { lineKey, code } of issued.codes) issuedCodesByLineId.set(lineKey, code);
  }
  for (const item of orderItems) {
    if (item.isGiftCard) item.giftCode = issuedCodesByLineId.get(`gc:${item.id}`) || null;
  }

  // The gift card a customer REDEEMED (not purchased) already had its balance
  // debited atomically back in api/razorpay-create-order.js, at reservation
  // time -- the same "decrement now, credit back on failure/expiry" shape stock
  // reservation already uses. Nothing to redeem here; this order simply records
  // how much of that already-debited amount it used.

  const orderData = {
    order_id: receipt, user_id: userId || null, user_email: userEmail, user_name: userName, user_phone: userPhone,
    address: { ...addr, billing: billAddr },
    items: orderItems,
    subtotal: computed.computedSubtotal, shipping: computed.computedShipping, total: computed.computedTotal,
    coupon_code: computed.computedDiscount > 0 ? (computed.couponCode || null) : null, discount: computed.computedDiscount,
    gift_card_code: computed.computedGiftCardApplied > 0 ? (computed.giftCardCode || null) : null,
    gift_card_applied: computed.computedGiftCardApplied > 0 ? Number(computed.computedGiftCardApplied) : 0,
    payment_method: 'razorpay',
    status,
    payment_id: paymentId || null,
    razorpay_order_id: razorpayOrderId || null,
    estimated_delivery: estimatedDelivery || null,
    inventory_issue: inventoryIssue,
  };

  const { error: orderError } = await supabase.from('orders').insert(orderData);
  if (orderError) {
    // A unique index on orders.payment_id (where not null) trips only if the same
    // payment somehow reached this point twice despite the used_payments claim
    // above -- belt-and-suspenders, not the primary guard.
    if (orderError.code === '23505' && paymentId) {
      const { data: existing } = await supabase.from('orders').select('*').eq('payment_id', paymentId).maybeSingle();
      if (existing) return { ok: true, order: existing, alreadyProcessed: true };
      return { ok: false, error: ALREADY_PROCESSED };
    }
    console.error('orders insert failed:', orderError);
    await creditRedeemedGiftCardIfAny(computed, receipt);
    await refundIfPaid({ paymentId, amountPaise, reason: 'Could not save order after payment' });
    // Without this, a genuine (non-duplicate) failure here left the payment
    // permanently stuck: claimed in used_payments, but with no order to
    // show for it, and no way to retry -- a later attempt for the exact
    // same payment would just be told ALREADY_PROCESSED forever. Removing
    // the claim we made moments ago (this exact row, nothing historical)
    // lets a genuine retry succeed instead of dead-ending silently.
    const { error: unclaimError } = await supabase.from('used_payments').delete().eq('payment_key', paymentKey).eq('order_id', receipt);
    if (unclaimError) console.error('SECURITY/RECONCILIATION: could not release used_payments claim after a failed order write -- payment may be permanently stuck as processed with no order. Needs manual check.', unclaimError, 'paymentKey', paymentKey, 'order', receipt);
    return { ok: false, error: paymentId ? 'Could not save your order. Your payment has been refunded automatically.' : 'Could not save your order. Please contact us with your payment ID.' };
  }

  // Automatic ORDER_CONFIRMED -- only ever reached once the order is genuinely
  // written (covers both the paid and ₹0/free path, since both call this same
  // function). Never allowed to affect the customer's response: capped at
  // CONFIRMATION_EMAIL_TIMEOUT_MS and its own rejection/error is swallowed here
  // -- sendOrderConfirmationEmail() itself never throws either, this is a second
  // layer of defense against a hang specifically. Duplicate protection is the
  // used_payments claim above, not something re-implemented here -- a retried
  // request for the same paymentKey never reaches this point twice.
  try {
    await withTimeout(sendOrderConfirmationEmail(orderData), CONFIRMATION_EMAIL_TIMEOUT_MS);
  } catch (emailErr) {
    console.error('sendOrderConfirmationEmail timed out or failed -- order already saved successfully, continuing.', emailErr?.message, 'order', orderData.order_id);
  }

  return { ok: true, order: orderData };
}
