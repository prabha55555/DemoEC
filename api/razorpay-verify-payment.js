// Confirms a Razorpay payment really happened for the amount the server itself
// computed, then writes the order/gift-card rows server-side -- the client never
// gets to write those directly. Five checks, in order, each closing a different
// way the old client-side-insert flow could be abused:
//   1. Razorpay's own signature -- proves this payment_id/order_id pair is real.
//   2. The blob's HMAC + age -- proves `computed` is exactly what
//      api/razorpay-create-order.js priced, byte-for-byte, not a client edit,
//      and that it hasn't gone stale (see src/utils/signedToken.js's readBlob).
//   3. Re-fetching the payment from Razorpay's API -- proves at least the computed
//      total was actually captured (not merely claimed), within a generous ceiling
//      that tolerates Razorpay's own gateway fees without accepting an unrelated
//      amount, and that this payment belongs to this Razorpay order (steps 1+2
//      alone don't rule out a signature/blob pair replayed against a different,
//      cheaper checkout).
//   4. Claiming the payment in used_payments -- proves this exact payment hasn't
//      already been used to write an order (replay protection).
//   5. Writing orders/gift_cards from the verified blob (src/utils/orderWrite.js).
import crypto from 'crypto';
import { timingSafeHexEqual, readBlob } from '../src/utils/signedToken.js';
import { createClient } from '@supabase/supabase-js';
import { writeVerifiedOrder } from '../src/utils/orderWrite.js';
import { sendWhatsAppOrderConfirmation } from '../src/utils/sendWhatsAppConfirmation.js';
import { sanitizeOrderFields, sanitizeEmail, shipToMatches } from '../src/utils/orderInput.js';

// Anon-key client -- only ever verifies a user's own bearer token
// (auth.getUser), which needs no elevated privilege. Every privileged RPC
// this checkout flow needs runs inside writeVerifiedOrder() via its own
// service-role client instead.
const supabase = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY);

// writeVerifiedOrder() can now spend up to ~12s on the automatic
// ORDER_CONFIRMED email attempt (see orderWrite.js's CONFIRMATION_EMAIL_TIMEOUT_MS)
// on top of this function's own Razorpay re-fetch and DB writes, and this
// handler then spends up to another ~10s on the WhatsApp confirmation below
// -- explicitly request enough execution time so the platform doesn't kill
// the function (and silently drop an in-flight email/WhatsApp send) before
// both complete.
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    res.status(500).json({ verified: false, error: 'Payment gateway is not configured.' });
    return;
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, blob, blobSig } = req.body || {};
  const { cart, addr, billAddr, userName, userPhone, estimatedDelivery } = sanitizeOrderFields(req.body);
  // A guest's typed address is untrusted text: bound and validated like every other customer-supplied field.
  const userEmail = sanitizeEmail(req.body?.userEmail) || null;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !blob || !blobSig) {
    res.status(400).json({ verified: false, error: 'Missing payment details.' });
    return;
  }
  if (!cart.length || !addr.line1) {
    res.status(400).json({ verified: false, error: 'Missing order details.' });
    return;
  }

  // If this request carries a Supabase session token, THAT is the
  // authoritative identity for this order -- the body's own userId/userEmail
  // are ignored in that case, closing the gap where a caller could
  // previously claim any account's UUID just by putting it in the request
  // body. A present-but-invalid/expired token is rejected outright (never
  // silently falls back to trusting the body instead -- that would just be
  // the same bypass wearing a garbage-token disguise). No token at all is
  // unchanged, legitimate guest checkout: the body-supplied contact fields
  // are still trusted, same as before.
  let ownerId = null;
  let ownerEmail = userEmail;
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (bearerToken) {
    const { data: authData, error: authError } = await supabase.auth.getUser(bearerToken);
    if (authError || !authData?.user) {
      res.status(401).json({ verified: false, error: 'Your session has expired. Please sign in again and retry.' });
      return;
    }
    ownerId = authData.user.id;
    ownerEmail = authData.user.email;

    // Mobile-OTP customers: the account address is a non-routable placeholder (see api/msg91-login.js),
    // so the order's contact email is the one typed at checkout -- validated already when the checkout
    // was created (api/razorpay-create-order.js) and re-validated here. Contact only: identity is still
    // solely the verified token above. This never rejects: a captured payment must still be recorded,
    // so an unusable typed address simply leaves the order without a contact email.
    const phoneLoginDomain = String(process.env.PHONE_LOGIN_EMAIL_DOMAIN || 'phone.brightlightsolutions.invalid').trim().toLowerCase();
    const isPlaceholder = (e) => String(e || '').trim().toLowerCase().endsWith(`@${phoneLoginDomain}`);
    if (isPlaceholder(authData.user.email) || authData.user.app_metadata?.msg91_phone) {
      const typed = sanitizeEmail(userEmail);
      ownerEmail = typed && !isPlaceholder(typed) ? typed : null;
    }
  }

  try {
    // 1. Razorpay's own signature.
    const expectedSig = crypto.createHmac('sha256', keySecret).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
    if (!timingSafeHexEqual(expectedSig, razorpay_signature)) {
      res.status(400).json({ verified: false, error: 'Payment signature could not be verified.' });
      return;
    }

    // 2. The blob's HMAC + age -- checked against the exact string the client
    // was handed, never a re-stringified copy, and rejected if presented too
    // long after it was issued (src/utils/signedToken.js's readBlob).
    const blobResult = readBlob(blob, blobSig, keySecret);
    if (!blobResult.ok) {
      const message = blobResult.reason === 'EXPIRED'
        ? 'Your checkout session has expired. Please start checkout again.'
        : 'Could not confirm your order total. Please try again.';
      res.status(400).json({ verified: false, error: message });
      return;
    }
    const parsedBlob = blobResult.data;
    if (parsedBlob.razorpay_order_id !== razorpay_order_id) {
      res.status(400).json({ verified: false, error: 'This payment does not match your order. Please try again.' });
      return;
    }
    const { computed, receipt } = parsedBlob;
    if (!shipToMatches(computed.shipTo, addr)) {
      // Checked before any state changes; a genuine paid order is still written by the webhook from the address
      // the server stored when it priced the checkout.
      res.status(400).json({ verified: false, error: 'Your delivery address changed after pricing. Please start checkout again.' });
      return;
    }

    // 3. Re-fetch the real payment from Razorpay -- confirms it was actually
    // captured, for this order, at the amount the server computed. Steps 1+2
    // alone prove "a valid signature+blob pair exists," not that THIS payment
    // paid THIS amount for THIS order.
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const payRes = await fetch(`https://api.razorpay.com/v1/payments/${razorpay_payment_id}`, {
      headers: { 'Authorization': `Basic ${auth}` },
    });
    const payment = await payRes.json();
    if (!payRes.ok) {
      res.status(502).json({ verified: false, error: 'Could not confirm your payment with the gateway.' });
      return;
    }
    const expectedPaise = Math.round(Number(computed.computedTotal) * 100);
    // Amount check -- deliberately NOT a strict equality. Razorpay's own
    // gateway can legitimately add a customer-facing convenience fee on top
    // of the order amount for certain payment methods/account configurations
    // ("Fee Bearer: Customer" or similar) -- when that's active, the
    // genuinely captured payment.amount is correctly HIGHER than
    // expectedPaise, and a strict equality check rejects a fully legitimate,
    // fully-paid order (this is exactly what happened to a real customer).
    // Nothing in this codebase calculates or intends any such fee itself --
    // confirmed via a full audit of the cart/checkout/pricing code, no
    // fee/surcharge logic exists anywhere -- so any amount above
    // expectedPaise originates entirely on Razorpay's side, never ours.
    //
    // Underpayment is still an outright reject: payment.amount must be at
    // least expectedPaise. Overpayment is accepted only up to a generous,
    // deliberately conservative ceiling -- well beyond any realistic gateway
    // convenience fee (typically low single-digit percent) -- so it can
    // never mask a genuine miscalculation or an unrelated, wildly-mismatched
    // payment. This ceiling is safe specifically because payment.order_id
    // must equal razorpay_order_id, which is itself tied to expectedPaise
    // via the signed blob (steps 1-2 above) -- a client can never cause an
    // arbitrary, unrelated amount to reach this comparison; only Razorpay's
    // own fee calculation for this exact order can push payment.amount above
    // expectedPaise.
    const OVERPAYMENT_CEILING_MULTIPLIER = 1.5;
    const paidEnough = Number(payment.amount) >= expectedPaise;
    const notWildlyOver = Number(payment.amount) <= Math.round(expectedPaise * OVERPAYMENT_CEILING_MULTIPLIER);
    if (payment.status !== 'captured' || payment.order_id !== razorpay_order_id || !paidEnough || !notWildlyOver) {
      console.error('razorpay-verify-payment: amount/status check failed.', {
        expectedPaise, paymentAmount: payment.amount, paymentStatus: payment.status,
        paymentOrderId: payment.order_id, razorpay_order_id,
      });
      res.status(400).json({ verified: false, error: 'Payment could not be confirmed for the correct amount.' });
      return;
    }

    // 4 + 5. Claim the payment once, then write orders/gift_cards from the
    // verified blob.
    const result = await writeVerifiedOrder({
      paymentKey: razorpay_payment_id,
      computed, receipt,
      paymentId: razorpay_payment_id, razorpayOrderId: razorpay_order_id,
      cart, addr, billAddr, userId: ownerId, userEmail: ownerEmail, userName, userPhone, estimatedDelivery,
    });
    if (!result.ok) {
      res.status(409).json({ verified: false, error: result.error });
      return;
    }

    // Note: writeVerifiedOrder() above already claims the pending_orders
    // reservation row internally (as part of inventory-issue detection), so
    // there's nothing left to clean up here -- the old standalone cleanup
    // call this comment used to describe is gone, not just moved.

    // WhatsApp order-confirmation -- only ever reached once the order is
    // genuinely written and only for a real Razorpay payment (never the
    // free/₹0 path, which goes through api/verify-free-order.js instead and
    // never calls this). Awaited, not fire-and-forget: a serverless
    // function's execution environment can freeze shortly after its
    // response is sent, which would silently orphan an in-flight call --
    // same reasoning already applied to the automatic email above. Never
    // allowed to affect the customer's response either way; its own
    // internal timeout/error handling never throws.
    // (not again when the webhook or an earlier request already processed this payment -- it was sent then)
    if (!result.alreadyProcessed) await sendWhatsAppOrderConfirmation(result.order);

    res.status(200).json({ verified: true, order: result.order });
  } catch (err) {
    console.error('razorpay-verify-payment failed:', err);
    res.status(500).json({ verified: false, error: 'Could not verify your payment. Please contact us with your payment ID.' });
  }
}
