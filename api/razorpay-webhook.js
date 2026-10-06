// Server-to-server safety net for api/razorpay-verify-payment.js. That
// endpoint only ever runs if the CUSTOMER'S OWN BROWSER makes it back to call
// it after Razorpay's checkout widget reports success -- if the tab is
// closed, the browser crashes, or the connection drops in that moment, the
// payment is genuinely captured on Razorpay's side but nothing here ever
// writes an order for it. This endpoint is registered directly in the
// Razorpay Dashboard (Settings > Webhooks) as a `payment.captured` webhook,
// which Razorpay calls from ITS servers regardless of what happens to the
// customer's browser -- so this is the one path that still recovers the
// order even when the client-driven one never fires at all.
//
// Must be idempotent against the normal path: both this and
// api/razorpay-verify-payment.js ultimately call writeVerifiedOrder(), which
// claims the payment in `used_payments` (a unique constraint) before writing
// anything -- whichever of the two gets there first wins, and the other's
// attempt is a harmless, expected no-op (ALREADY_PROCESSED). Uses the
// service-role client -- this is a trusted server-to-server endpoint (Razorpay
// calling us, never a browser), and claim_pending_order/redeem_gift_card/
// decrement_product_stock are privileged RPCs that anon must not be able to
// call directly (see the RLS/RPC permission migration this endpoint is part of).
import crypto from 'crypto';
import { timingSafeHexEqual } from '../src/utils/signedToken.js';
import { writeVerifiedOrder } from '../src/utils/orderWrite.js';
import { sendWhatsAppOrderConfirmation } from '../src/utils/sendWhatsAppConfirmation.js';
import { supabaseAdmin as supabase } from '../src/utils/supabaseAdmin.js';

// Razorpay's signature is computed over the exact raw request body bytes --
// Vercel's default JSON body-parsing would hand back a re-serialized copy
// that isn't guaranteed to match byte-for-byte (same reasoning
// api/razorpay-verify-payment.js's blob signature check already relies on
// for its own payload). Disabling it here and reading the raw stream
// ourselves is the only way to verify this correctly.
export const config = { api: { bodyParser: false }, maxDuration: 30 };

// Real Razorpay payment.captured payloads are a few KB at most -- this is
// generous headroom, not a tight fit, purely to stop an unbounded accumulation
// if something sent a very large or never-ending body before signature
// verification ever gets a chance to reject it.
const MAX_BODY_BYTES = 1024 * 1024; // 1MB

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let bytes = 0;
    let rejected = false;
    req.on('data', (chunk) => {
      if (rejected) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        rejected = true;
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => { if (!rejected) resolve(data); });
    req.on('error', (err) => { if (!rejected) reject(err); });
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('razorpay-webhook: RAZORPAY_WEBHOOK_SECRET is not set -- cannot verify webhook calls.');
    res.status(500).json({ error: 'Webhook is not configured.' });
    return;
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    console.error('razorpay-webhook: failed to read request body.', err?.message);
    res.status(400).json({ error: 'Could not read request body.' });
    return;
  }

  const signature = req.headers['x-razorpay-signature'];
  if (!signature) {
    res.status(400).json({ error: 'Missing signature.' });
    return;
  }
  const expectedSignature = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  if (!timingSafeHexEqual(expectedSignature, signature)) {
    console.error('razorpay-webhook: signature mismatch -- rejecting.');
    res.status(400).json({ error: 'Invalid signature.' });
    return;
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    res.status(400).json({ error: 'Malformed request body.' });
    return;
  }

  // Only payment.captured actually needs recovery -- every other event type
  // (order.paid, payment.failed, refund.*, ...) is acknowledged with 200 and
  // ignored, so Razorpay doesn't keep retrying deliveries we were never
  // going to act on anyway. Respond 200 by default for exactly that reason.
  if (body?.event !== 'payment.captured') {
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  const payment = body?.payload?.payment?.entity;
  const paymentId = payment?.id;
  const razorpayOrderId = payment?.order_id;
  if (!paymentId || !razorpayOrderId) {
    console.error('razorpay-webhook: payment.captured with no payment/order id -- unexpected payload shape.', body);
    res.status(200).json({ ok: true, error: 'Unexpected payload shape.' });
    return;
  }

  try {
    // Looked up by `receipt`, not razorpay_order_id -- razorpay_order_id on
    // our own pending_orders row is only ever set by a separate, best-effort
    // update in api/razorpay-create-order.js, made *after* Razorpay's order
    // already exists. If our server crashed in the gap between "Razorpay
    // order created" and "that update committing", a lookup by
    // razorpay_order_id would find nothing even though the reservation is
    // still there. `receipt` doesn't have this problem -- it's written in
    // the very first pending_orders INSERT, before Razorpay is ever called,
    // so it's always present regardless of what happened afterward.
    //
    // Razorpay's payment.captured payload doesn't hand us the receipt
    // directly, so it's fetched from Razorpay's own order record -- their
    // authoritative copy of what we originally sent them, never dependent on
    // whether our own follow-up write ever ran.
    const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
    const orderRes = await fetch(`https://api.razorpay.com/v1/orders/${razorpayOrderId}`, {
      headers: { 'Authorization': `Basic ${auth}` },
    });
    const orderData = await orderRes.json();
    if (!orderRes.ok || !orderData?.receipt) {
      console.error('razorpay-webhook: could not fetch order receipt from Razorpay.', razorpayOrderId, orderData);
      res.status(200).json({ ok: true, error: 'Could not resolve order receipt.' });
      return;
    }

    // A plain, non-exclusive read -- deliberately NOT the atomic claim.
    // writeVerifiedOrder() below is the single place that actually claims
    // (consumes) this row now, as part of its own inventory-issue
    // determination; if this endpoint also claimed it here first, that
    // internal claim would always find nothing and wrongly flag every
    // webhook-recovered order as an inventory issue. This read only exists
    // to recover cart/addr/computed -- data the client-driven path already
    // has from the browser, which this endpoint has no other source for.
    //
    // Finding nothing here means either the client-driven path's own
    // writeVerifiedOrder() call already claimed (and, if applicable,
    // resolved) this row -- the common case, this webhook call is then just
    // a confirmation of something already done -- or this payment predates
    // pending_orders existing at all, or the row was old enough to have been
    // permanently swept. Either way, there's nothing this endpoint can
    // reconstruct an order from without it.
    const { data: pending, error: readErr } = await supabase.from('pending_orders').select('*').eq('receipt', orderData.receipt).maybeSingle();
    if (readErr) {
      console.error('razorpay-webhook: pending_orders read failed.', readErr.message, orderData.receipt);
      res.status(200).json({ ok: true, error: 'Could not read pending order.' });
      return;
    }
    if (!pending) {
      res.status(200).json({ ok: true, recovered: false, reason: 'no pending_orders row (already handled or predates this feature)' });
      return;
    }

    // The signed webhook proves Razorpay captured THIS payment; it does not prove the payment
    // matches the checkout attempt we stored. Same amount/currency/order relationship the
    // browser-driven verify endpoint enforces, and never build an order from a claim row that
    // never finished pricing (status 'reserving' has an empty `computed`).
    const computedTotal = Number(pending.computed?.computedTotal);
    if (!Array.isArray(pending.computed?.verifiedItems) || !Number.isFinite(computedTotal)) {
      console.error('razorpay-webhook: pending_orders row has no finalized pricing.', orderData.receipt, pending.status);
      res.status(200).json({ ok: true, recovered: false, reason: 'pending order was never finalized' });
      return;
    }
    const expectedPaise = Math.round(computedTotal * 100);
    const paidEnough = Number(payment.amount) >= expectedPaise;
    const notWildlyOver = Number(payment.amount) <= Math.round(expectedPaise * 1.5);
    if (payment.status !== 'captured' || payment.currency !== 'INR' || !paidEnough || !notWildlyOver) {
      console.error('razorpay-webhook: payment does not match the stored order -- NOT recovering.', {
        receipt: orderData.receipt, expectedPaise, paymentAmount: payment.amount, paymentStatus: payment.status, currency: payment.currency,
      });
      res.status(200).json({ ok: true, recovered: false, reason: 'payment amount/status mismatch' });
      return;
    }

    const result = await writeVerifiedOrder({
      paymentKey: paymentId,
      computed: pending.computed,
      receipt: pending.receipt,
      paymentId,
      razorpayOrderId,
      cart: pending.cart,
      addr: pending.addr,
      billAddr: pending.bill_addr,
      userId: pending.user_id,
      userEmail: pending.user_email,
      userName: pending.user_name,
      userPhone: pending.user_phone,
      estimatedDelivery: pending.estimated_delivery,
    });

    if (!result.ok) {
      // ALREADY_PROCESSED here means the normal path's own writeVerifiedOrder
      // call won the race in the few seconds between payment and this
      // webhook delivery -- expected and harmless, not a real failure.
      res.status(200).json({ ok: true, recovered: false, reason: result.error });
      return;
    }

    // The browser-driven request wrote this order moments ago (and already sent its messages).
    if (result.alreadyProcessed) {
      res.status(200).json({ ok: true, recovered: false, reason: 'already processed' });
      return;
    }

    // writeVerifiedOrder() only handles the automatic email -- the WhatsApp
    // send is a separate step in the normal path too (api/razorpay-verify-
    // payment.js), so it's repeated here for parity. Awaited for the same
    // reason that file awaits it: this function's execution environment can
    // freeze shortly after the response is sent, which would silently
    // orphan an in-flight send.
    await sendWhatsAppOrderConfirmation(result.order);

    console.log('razorpay-webhook: recovered an order the client-driven path never wrote.', result.order.order_id);
    res.status(200).json({ ok: true, recovered: true, order_id: result.order.order_id });
  } catch (err) {
    console.error('razorpay-webhook: unexpected failure.', err?.message, razorpayOrderId);
    // 200, not 500 -- a transient failure here should not make Razorpay
    // hammer this endpoint with retries; the order is either already safe
    // (normal path) or this was a genuine miss that needs a human to check
    // payment_id against the orders table directly.
    res.status(200).json({ ok: false, error: 'Unexpected failure -- check server logs.' });
  }
}
