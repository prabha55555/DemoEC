// The no-payment counterpart of api/razorpay-verify-payment.js -- reached when a
// coupon and/or gift card covers a cart entirely (zero total), or when the customer chose
// Cash on Delivery, so there's no Razorpay payment to check. The blob's HMAC (signed in
// api/razorpay-create-order.js) is the proof here instead of a Razorpay signature: it's
// server-issued and can't be forged without RAZORPAY_KEY_SECRET, so a client can't hand-craft
// a "total is 0" or "this is a COD order" claim.
// Same replay guard and order write as the paid path (src/utils/orderWrite.js).
import { createClient } from '@supabase/supabase-js';
import { readBlob } from '../src/utils/signedToken.js';
import { writeVerifiedOrder } from '../src/utils/orderWrite.js';
import { sanitizeOrderFields, sanitizeEmail, shipToMatches } from '../src/utils/orderInput.js';
import { sendWhatsAppOrderConfirmation } from '../src/utils/sendWhatsAppConfirmation.js';

const supabase = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY);

// See api/razorpay-verify-payment.js's identical config -- writeVerifiedOrder()
// can now spend up to ~12s on the automatic ORDER_CONFIRMED email attempt.
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    res.status(500).json({ verified: false, error: 'Payment gateway is not configured.' });
    return;
  }

  const { receipt, blob, blobSig } = req.body || {};
  const { cart, addr, billAddr, userName, userPhone, estimatedDelivery } = sanitizeOrderFields(req.body);
  const userEmail = sanitizeEmail(req.body?.userEmail) || null;

  if (!receipt || !blob || !blobSig) {
    res.status(400).json({ verified: false, error: 'Missing verification details.' });
    return;
  }
  if (!cart.length || !addr.line1) {
    res.status(400).json({ verified: false, error: 'Missing order details.' });
    return;
  }

  // Same identity binding as api/razorpay-verify-payment.js -- see its own
  // comment for the full reasoning. A present-but-invalid token is rejected
  // outright, never silently falls back to trusting the body instead.
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
  }

  try {
    const blobResult = readBlob(blob, blobSig, keySecret);
    if (!blobResult.ok) {
      const message = blobResult.reason === 'EXPIRED'
        ? 'Your checkout session has expired. Please start checkout again.'
        : 'Could not confirm your order total. Please try again.';
      res.status(400).json({ verified: false, error: message });
      return;
    }
    const parsedBlob = blobResult.data;
    if (parsedBlob.receipt !== receipt) {
      res.status(400).json({ verified: false, error: 'This confirmation does not match your order. Please try again.' });
      return;
    }
    const { computed } = parsedBlob;
    if (!shipToMatches(computed.shipTo, addr)) {
      res.status(400).json({ verified: false, error: 'Your delivery address changed after pricing. Please start checkout again.' });
      return;
    }
    const isCod = computed.paymentMethod === 'cod' && Number(computed.computedTotal) > 0;
    if (Number(computed.computedTotal) > 0 && !isCod) {
      res.status(400).json({ verified: false, error: 'This order was not fully covered. Please try again.' });
      return;
    }

    // No money has moved on this path, so -- unlike the paid path, whose inventory_issue
    // tolerance exists because a captured payment must be honored even if its reservation
    // lapsed -- a free order with no live reservation is refused. requireLiveReservation makes
    // writeVerifiedOrder refuse on the result of its OWN atomic claim_pending_order call (after
    // the used_payments claim), so there is no separate check-then-claim window to race in.
    const result = await writeVerifiedOrder({
      paymentKey: `free:${receipt}`,
      computed, receipt,
      paymentId: null, razorpayOrderId: null,
      cart, addr, billAddr, userId: ownerId, userEmail: ownerEmail, userName, userPhone, estimatedDelivery,
      requireLiveReservation: true,
    });
    if (!result.ok) {
      res.status(409).json({ verified: false, error: result.error });
      return;
    }
    // Same WhatsApp confirmation a paid order gets (never throws, never delays the response past its own timeout).
    if (!result.alreadyProcessed) await sendWhatsAppOrderConfirmation(result.order);
    res.status(200).json({ verified: true, order: result.order });
  } catch (err) {
    console.error('verify-free-order failed:', err);
    res.status(500).json({ verified: false, error: 'Could not confirm your order. Please try again.' });
  }
}
