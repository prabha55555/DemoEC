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
import { issueGiftCards, creditGiftCardBalance, redeemGiftCardBalance } from './giftCards.js';
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

export async function writeVerifiedOrder({
  paymentKey, computed, receipt, paymentId, razorpayOrderId, cart, addr, billAddr,
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
  const needsGift = !!(computed.giftCardCode && Number(computed.computedGiftCardApplied) > 0);
  const needsCoupon = !!(computed.couponCode && Number(computed.computedDiscount) > 0);
  // What this order is holding RIGHT NOW (set from the claimed row below). Every failure after the claim gives
  // back exactly these, once -- see failOrder().
  let giftHeld = false;
  let couponHeld = false;
  let stockLines = [];

  // Gives back what this attempt still holds, and undoes the order-side work, then reports the failure.
  // The claim consumed (deleted) the reservation row, so NOTHING else will ever release these.
  async function failOrder({ refundReason, paidMessage, unpaidMessage, voidGiftCodes = [], unclaimLabel }) {
    if (stockLines.length) {
      const { error } = await supabase.rpc('release_stock_lines', { p_items: stockLines });
      if (error) console.error('SECURITY/RECONCILIATION: could not give back reserved stock after an order-write failure -- needs manual check.', error.message, 'order', receipt);
    }
    if (couponHeld) {
      const { error } = await supabase.rpc('release_coupon_use', { p_code: computed.couponCode });
      if (error) console.error('SECURITY/RECONCILIATION: could not release a coupon use after an order-write failure -- needs manual check.', error.message, computed.couponCode, receipt);
    }
    if (giftHeld) {
      const credited = await creditGiftCardBalance(supabase, computed.giftCardCode, computed.computedGiftCardApplied);
      if (!credited) console.error('SECURITY/RECONCILIATION: could not credit back a redeemed gift card balance after an order-write failure -- needs manual check.', computed.giftCardCode, computed.computedGiftCardApplied, receipt);
    }
    if (voidGiftCodes.length) {
      // gift cards this order had already issued must not outlive its refund
      const { error } = await supabase.from('gift_cards').delete().in('code', voidGiftCodes);
      if (error) console.error('SECURITY/RECONCILIATION: could not remove gift cards issued for a failed order -- needs manual check.', voidGiftCodes, receipt);
    }
    stockLines = []; couponHeld = false; giftHeld = false;
    await refundIfPaid({ paymentId, amountPaise, reason: refundReason });
    // Release the used_payments claim made above so a genuine retry is never answered with a stale
    // "already processed" for a payment that produced no order.
    const { error: unclaimError } = await supabase.from('used_payments').delete().eq('payment_key', paymentKey).eq('order_id', receipt);
    if (unclaimError) console.error(`SECURITY/RECONCILIATION: could not release used_payments claim after ${unclaimLabel || 'a failure'} -- payment may be stuck as processed with no order. Needs manual check.`, unclaimError, 'paymentKey', paymentKey, 'order', receipt);
    return { ok: false, error: paymentId ? paidMessage : unpaidMessage };
  }

  {
    const { data: claimedPending, error: pendingClaimError } = await supabase.rpc('claim_pending_order', { p_receipt: receipt });
    if (pendingClaimError) {
      console.error('claim_pending_order failed during finalization (non-fatal, treated as inventory issue):', pendingClaimError, 'order', receipt);
    }
    const flags = claimedPending?.computed || {};
    const stockReleased = !!pendingClaimError || !claimedPending || claimedPending.status === 'released';
    // The public release endpoint (and the expiry sweep) can give a checkout's coupon use and gift-card balance
    // back BEFORE its payment lands -- a slow UPI approval, or someone releasing a checkout they then pay.
    const creditsReleased = (needsGift && !!flags.giftCardReleased) || (needsCoupon && !!flags.couponReleased);
    const noLiveReservation = stockReleased || creditsReleased;

    if (noLiveReservation && requireLiveReservation) {
      // Free/₹0 or Cash-on-Delivery order, no live reservation left to honor -- refuse outright rather
      // than write an order against stock/coupon/gift-card state that may no longer hold. Release the
      // used_payments claim just made above so a genuine retry (a fresh checkout attempt, with its own new
      // receipt) is never blocked by a stale ALREADY_PROCESSED response tied to this now-abandoned receipt.
      const { error: unclaimError } = await supabase.from('used_payments').delete().eq('payment_key', paymentKey).eq('order_id', receipt);
      if (unclaimError) console.error('SECURITY/RECONCILIATION: could not release used_payments claim after a free-order reservation check failed.', unclaimError, 'paymentKey', paymentKey, 'order', receipt);
      // whatever is still held by the consumed row goes back (a released row holds nothing)
      if (claimedPending && claimedPending.status === 'reserved' && claimedPending.reserved_items?.length) await supabase.rpc('release_stock_lines', { p_items: claimedPending.reserved_items });
      if (claimedPending && needsCoupon && !flags.couponReleased) await supabase.rpc('release_coupon_use', { p_code: computed.couponCode });
      if (claimedPending && needsGift && !flags.giftCardReleased) await creditGiftCardBalance(supabase, computed.giftCardCode, computed.computedGiftCardApplied);
      return { ok: false, error: 'Your checkout session expired before it could be confirmed. Please try again.', retryable: true };
    }

    if (!claimedPending && (needsGift || needsCoupon)) {
      // No reservation record at all: nobody can say whether the coupon / gift card was already given back, so
      // honoring the discount could double-spend. A paid customer is refunded rather than guessed at.
      return failOrder({
        refundReason: 'Checkout record missing -- gift card / coupon state unknown',
        paidMessage: 'We could not confirm your gift card or coupon for this order. Your payment has been refunded automatically.',
        unpaidMessage: 'We could not confirm your gift card or coupon for this order. Please contact us with your payment ID.',
        unclaimLabel: 'an unknown-reservation failure',
      });
    }

    // From here the claimed row tells us what this order holds.
    stockLines = !stockReleased && claimedPending.status === 'reserved' ? (claimedPending.reserved_items || []) : [];
    giftHeld = needsGift && !flags.giftCardReleased;
    couponHeld = needsCoupon && !flags.couponReleased;

    // Re-take what a release gave back, so a paid order never keeps a discount that was returned to the pool.
    if (needsGift && flags.giftCardReleased) {
      const redeemed = await redeemGiftCardBalance(supabase, computed.giftCardCode, Number(computed.computedGiftCardApplied));
      const fullAmount = redeemed.ok && Math.abs(Number(redeemed.applied) - Number(computed.computedGiftCardApplied)) < 0.005;
      if (!fullAmount) {
        if (redeemed.ok && Number(redeemed.applied) > 0) await creditGiftCardBalance(supabase, computed.giftCardCode, redeemed.applied);
        return failOrder({
          refundReason: 'Gift card balance no longer available when payment completed',
          paidMessage: 'The gift card on this order could no longer be applied. Your payment has been refunded automatically -- please place the order again.',
          unpaidMessage: 'The gift card on this order could no longer be applied. Please contact us with your payment ID.',
          unclaimLabel: 'a gift-card re-hold failure',
        });
      }
      giftHeld = true;
    }
    if (needsCoupon && flags.couponReleased) {
      const { error: couponErr } = await supabase.rpc('redeem_coupon_use', { p_code: computed.couponCode });
      if (couponErr) {
        return failOrder({
          refundReason: 'Coupon no longer available when payment completed',
          paidMessage: 'The coupon on this order is no longer available. Your payment has been refunded automatically -- please place the order again.',
          unpaidMessage: 'The coupon on this order is no longer available. Please contact us with your payment ID.',
          unclaimLabel: 'a coupon re-hold failure',
        });
      }
      couponHeld = true;
    }

    if (stockReleased) {
      inventoryIssue = {
        detected_at: new Date().toISOString(),
        reason: claimedPending?.status === 'released'
          ? 'Stock reservation expired and was released before payment finalized.'
          : 'No stock reservation record found for this payment at finalization time.',
        items: verifiedItems.filter(v => !v.isGiftCard).map(v => ({ id: v.id, variantId: v.variantId || null, qty: v.qty })),
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
  const lineKeyOf = (item) => item.isGiftCard ? `gc:${item.id}` : String(item.variantId || '');
  const cartByKey = new Map(cart.map(item => [lineKeyOf(item), item]));

  const orderItems = [];
  for (const verified of verifiedItems) {
    const key = lineKeyOf(verified);
    const item = cartByKey.get(key);
    if (!item) {
      return failOrder({
        refundReason: 'Cart changed after payment was verified',
        paidMessage: 'Your cart changed after payment was verified. Your payment has been refunded automatically.',
        unpaidMessage: 'Your cart changed after payment was verified. Please contact us with your payment ID.',
        unclaimLabel: 'a cart-mismatch failure',
      });
    }
    // Everything an invoice, a return or an email needs is frozen on the line at purchase time, so
    // later catalogue edits (renamed product, new price, deleted variant) never rewrite history.
    orderItems.push(verified.isGiftCard
      ? { id: verified.id, name: item.name || 'Gift card', qty: verified.qty, price: verified.price, isGiftCard: true, recipientName: item.recipientName || null, recipientEmail: item.recipientEmail || null, giftMessage: item.giftMessage || null }
      : {
          id: verified.id, variantId: verified.variantId, sku: verified.sku || null,
          name: verified.name || item.name, variantLabel: verified.variantLabel || '', options: verified.options || {},
          qty: verified.qty, price: verified.price, mrp: verified.mrp ?? null,
          cat: verified.cat, brand: verified.brand || null, image: verified.image || null,
          gstRate: verified.gstRate ?? null, hsn: verified.hsn || '', returnWindowDays: verified.returnWindowDays ?? null,
          lineDiscount: Number(verified.lineDiscount) || 0,
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
    // Validity is a store setting (months); 6 when unset.
    const { data: giftSettings } = await supabase.from('settings').select('gift_card_validity_months').eq('id', 'brand').maybeSingle();
    const validityMonths = Number(giftSettings?.gift_card_validity_months) > 0 ? Number(giftSettings.gift_card_validity_months) : 6;
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + validityMonths);
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
      return failOrder({
        refundReason: 'Could not issue purchased gift card',
        paidMessage: 'Could not create your gift card. Your payment has been refunded automatically.',
        unpaidMessage: 'Could not create your gift card. Please contact us with your payment ID.',
        unclaimLabel: 'a gift-card-issue failure',
      });
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

  // How the customer is paying: online (a captured Razorpay payment), Cash on Delivery (the server
  // priced the cart as COD and signed it), or nothing at all (a coupon / gift card covered it).
  const isCod = computed.paymentMethod === 'cod' && Number(computed.computedTotal) > 0;
  const paymentMethod = isCod ? 'cod' : (paymentId ? 'razorpay' : 'free');
  const now = new Date().toISOString();

  const orderData = {
    order_id: receipt, user_id: userId || null, user_email: userEmail, user_name: userName, user_phone: userPhone,
    address: { ...addr, billing: billAddr },
    items: orderItems,
    subtotal: computed.computedSubtotal, shipping: computed.computedShipping, cod_fee: Number(computed.computedCodFee) || 0,
    tax_total: Number(computed.computedTax) || 0, total: computed.computedTotal,
    coupon_code: computed.computedDiscount > 0 ? (computed.couponCode || null) : null, discount: computed.computedDiscount,
    gift_card_code: computed.computedGiftCardApplied > 0 ? (computed.giftCardCode || null) : null,
    gift_card_applied: computed.computedGiftCardApplied > 0 ? Number(computed.computedGiftCardApplied) : 0,
    payment_method: paymentMethod,
    status: 'Placed',
    payment_status: isCod ? 'cod_pending' : 'paid',
    timeline: [{ status: 'Placed', at: now, by: 'system', note: isCod ? 'Cash on Delivery' : undefined }],
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
    // Gift cards this order issued must not outlive its refund (the customer would keep the card AND the money).
    return failOrder({
      refundReason: 'Could not save order after payment',
      paidMessage: 'Could not save your order. Your payment has been refunded automatically.',
      unpaidMessage: 'Could not save your order. Please contact us with your payment ID.',
      voidGiftCodes: [...issuedCodesByLineId.values()].filter(Boolean),
      unclaimLabel: 'a failed order write',
    });
  }

  // Stock ledger rows + popularity counter (stock itself was already taken at reservation time).
  // Best effort: a failure here never affects an order that is already saved and paid.
  try {
    const { error: saleError } = await supabase.rpc('record_order_sale', { p_order_id: receipt, p_items: orderItems });
    if (saleError) console.error('record_order_sale failed (non-fatal):', saleError.message, 'order', receipt);
  } catch (saleErr) {
    console.error('record_order_sale threw (non-fatal):', saleErr?.message, 'order', receipt);
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
