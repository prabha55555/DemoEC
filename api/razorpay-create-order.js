// Vercel serverless function -- the ONLY place the Razorpay Key Secret is ever used,
// and now also the source of truth for what an order actually costs. The browser
// used to send a pre-computed `amount` here and this function just charged it --
// which meant editing that one number in a network request was enough to pay
// whatever you wanted for any cart. Every line item is now re-priced from the
// database, coupons/gift cards are re-validated from their own tables, and the
// Razorpay order is created for that server-computed total -- never the client's.
import { createClient } from '@supabase/supabase-js';
import { getShippingCost } from '../src/utils/delivery.js';
import { cartSubtotalOf, couponDiscountOf, couponEligibleFor, giftCardAppliedOf, DEFAULT_GIFTCARD_MIN, giftcardMaxOf } from '../src/utils/pricing.js';
import { issueBlob } from '../src/utils/signedToken.js';
import { supabaseAdmin as supabase } from '../src/utils/supabaseAdmin.js';
import { redeemGiftCardBalance, creditGiftCardBalance } from '../src/utils/giftCards.js';
import { sanitizeOrderFields, sanitizeEmail } from '../src/utils/orderInput.js';
import { isRateLimited, clientIp } from '../src/utils/rateLimit.js';
import { sweepExpiredCheckoutReservations, releaseCheckoutReservation } from '../src/utils/reservations.js';

// Anon-key client used ONLY to verify the caller's own bearer token (if one is
// sent) -- mirrors the identity-binding pattern in api/razorpay-verify-payment.js /
// api/verify-free-order.js. If a request carries a token, THAT is the only source of
// identity: the body's own userId/userEmail are never read at all.
const supabaseAuth = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY);

// Our own inventory-reservation timeout -- NOT a Razorpay order expiry. This is purely
// how long we're willing to hold stock/coupon/gift-card value for one unpaid checkout
// attempt before releasing it back. A genuine slow payment that lands after this window
// is handled explicitly (see orderWrite.js's inventory_issue detection), never silently.
const RESERVATION_TIMEOUT_MINUTES = 5;

// How long an in-progress claim on a checkoutAttemptKey is honored before a retry for
// the SAME key may reclaim it. Only needs to cover the pricing + redemption work below;
// guards against a crash between claiming and finishing leaving the key stuck forever.
const CLAIM_TIMEOUT_MS = 60 * 1000;

const PROCESSING = { processing: true, error: 'Your previous request is still being processed. Please wait a moment and try again.' };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    res.status(500).json({ error: 'Payment gateway is not configured.' });
    return;
  }

  if (isRateLimited(`create-order:${clientIp(req)}`, { limit: 20, windowMs: 10 * 60 * 1000 })) {
    res.status(429).json({ error: 'Too many checkout attempts. Please wait a few minutes and try again.' });
    return;
  }

  const { items, couponCode, giftCardCode, checkoutAttemptKey } = req.body || {};
  // Everything else (address, contact fields, cart display metadata) is customer-supplied
  // but not price-sensitive -- sanitized for shape/length before being stashed in
  // pending_orders, never trusted for pricing.
  const { cart, addr, billAddr, userName, userEmail, userPhone, estimatedDelivery } = sanitizeOrderFields(req.body);

  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'Your cart is empty.' });
    return;
  }
  if (!checkoutAttemptKey || typeof checkoutAttemptKey !== 'string' || checkoutAttemptKey.length > 100) {
    res.status(400).json({ error: 'Missing checkout attempt identifier.' });
    return;
  }
  if (!cart.length || !addr.line1) {
    res.status(400).json({ error: 'Missing order details.' });
    return;
  }

  let ownerId = null;
  let ownerEmail = userEmail;
  const ownerName = userName;
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (bearerToken) {
    const { data: authData, error: authError } = await supabaseAuth.auth.getUser(bearerToken);
    if (authError || !authData?.user) {
      res.status(401).json({ error: 'Your session has expired. Please sign in again and retry.' });
      return;
    }
    ownerId = authData.user.id;
    ownerEmail = authData.user.email;

    // A customer who signed in with a mobile OTP (api/msg91-login.js) has only a non-routable placeholder
    // address on their Supabase account, which must never become the order's contact email. For them the
    // email typed at checkout is used as the CONTACT email only -- it is re-validated here, and is never
    // used to decide who the customer is (ownerId above still comes solely from the verified token).
    const phoneLoginDomain = String(process.env.PHONE_LOGIN_EMAIL_DOMAIN || 'phone.brightlightsolutions.invalid').trim().toLowerCase();
    const isPlaceholder = (e) => String(e || '').trim().toLowerCase().endsWith(`@${phoneLoginDomain}`);
    if (isPlaceholder(authData.user.email) || authData.user.app_metadata?.msg91_phone) {
      const typed = sanitizeEmail(userEmail);
      if (!typed || isPlaceholder(typed)) {
        res.status(400).json({ error: 'Please enter a valid email address for your order confirmation.' });
        return;
      }
      ownerEmail = typed;
    }
  }

  // Best-effort cleanup of any OTHER attempt's reservation that's past its expiry, so
  // abandoned holds are back in circulation before this request's own checks run.
  // Never blocks or fails this request.
  try {
    await supabase.rpc('release_expired_reservations');
  } catch (sweepErr) {
    console.error('release_expired_reservations sweep failed (non-fatal):', sweepErr?.message);
  }
  try {
    await sweepExpiredCheckoutReservations(supabase);
  } catch (sweepErr) {
    console.error('sweepExpiredCheckoutReservations failed (non-fatal):', sweepErr?.message);
  }

  // ==== READ-ONLY PASS -- prices the cart and looks up (but does NOT redeem) the coupon
  // and gift card. Nothing here changes any state, so it is safe to repeat on every retry.
  let verifiedCart;
  let verifiedItemsForClient;
  let cartSubtotal;
  let couponCandidate = null;
  let giftCardCandidate = null;
  try {
    // Aggregate quantities per product+size (and per gift-card line) BEFORE anything else --
    // otherwise a request could split one large quantity across several line entries.
    const lineKey = (i) => i.isGiftCard ? `gc:${i.id}` : `${i.id}::${i.size || ''}`;
    const aggregated = new Map();
    for (const item of items) {
      const qty = Number(item.qty);
      if (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) {
        res.status(400).json({ error: 'One of the items in your cart has an invalid quantity.' });
        return;
      }
      const key = lineKey(item);
      const existing = aggregated.get(key);
      if (existing) existing.qty += qty;
      else aggregated.set(key, { id: item.id, size: item.size || null, isGiftCard: !!item.isGiftCard, price: item.price, qty });
    }
    const mergedItems = [...aggregated.values()];

    const productIds = [...new Set(mergedItems.filter(i => !i.isGiftCard).map(i => i.id))];
    const hasGiftCard = mergedItems.some(i => i.isGiftCard);
    const [{ data: products, error: prodErr }, { data: settings }] = await Promise.all([
      productIds.length ? supabase.from('products').select('*').in('id', productIds) : Promise.resolve({ data: [], error: null }),
      hasGiftCard ? supabase.from('settings').select('giftcard_min, giftcard_max').eq('id', 'brand').maybeSingle() : Promise.resolve({ data: null }),
    ]);
    if (prodErr) {
      res.status(500).json({ error: 'Could not verify your cart. Please try again.' });
      return;
    }
    const productById = Object.fromEntries((products || []).map(p => [p.id, p]));

    let giftcardMin = DEFAULT_GIFTCARD_MIN, giftcardMax = Infinity;
    if (settings) {
      // ?? applied BEFORE Number() -- an admin deliberately setting a 0 minimum must not
      // be silently overridden back to the hardcoded default.
      giftcardMin = Number(settings.giftcard_min ?? giftcardMin);
      giftcardMax = giftcardMaxOf(settings.giftcard_max);
    }

    verifiedCart = [];
    verifiedItemsForClient = [];
    for (const item of mergedItems) {
      if (item.isGiftCard) {
        // A gift card is always exactly one redeemable code -- a qty > 1 would be charged
        // in full but only ever produce one card, so it's rejected outright.
        if (item.qty !== 1) {
          res.status(400).json({ error: 'Gift cards can only be purchased one at a time -- add another to your cart separately.' });
          return;
        }
        const price = Number(item.price);
        if (!Number.isFinite(price) || !Number.isInteger(price) || price < giftcardMin || price > giftcardMax) {
          const rangeMsg = Number.isFinite(giftcardMax) ? `between Rs. ${giftcardMin} and Rs. ${giftcardMax}` : `of at least Rs. ${giftcardMin}`;
          res.status(400).json({ error: `Gift card amount must be a whole number ${rangeMsg}.` });
          return;
        }
        verifiedCart.push({ id: item.id, price, qty: item.qty, isGiftCard: true });
        verifiedItemsForClient.push({ id: item.id, size: null, isGiftCard: true, price, qty: item.qty });
        continue;
      }

      const product = productById[item.id];
      if (!product || product.available === false || product.enquiry_only) {
        res.status(400).json({ error: 'One of the items in your cart is no longer available.' });
        return;
      }

      let price = Number(product.price);
      const hasVariants = Array.isArray(product.variants) && product.variants.length > 0;
      if (hasVariants) {
        if (!item.size) {
          res.status(400).json({ error: 'One of the items in your cart needs an option selected -- please remove and re-add it.' });
          return;
        }
        const variant = product.variants.find(v => v.size === item.size);
        if (!variant) {
          res.status(400).json({ error: 'One of the items in your cart is no longer available.' });
          return;
        }
        price = Number(variant.price);
      }
      // Shipping is a flat per-unit add-on set on the product -- folded in here, server-side,
      // so it's always part of the real charge. Must match src/data/products.js's
      // effectivePrice() exactly.
      price += Number(product.shipping_charge) || 0;
      if (!Number.isFinite(price) || price <= 0) {
        res.status(400).json({ error: 'One of the items in your cart is no longer available.' });
        return;
      }

      // Stock sufficiency is deliberately NOT checked here -- reserve_product_stock (below)
      // does the real, concurrency-safe atomic check-and-reserve.
      verifiedCart.push({ id: item.id, price, qty: item.qty, isGiftCard: false, shipping_charge: Number(product.shipping_charge) || 0 });
      verifiedItemsForClient.push({ id: item.id, size: item.size, isGiftCard: false, price, qty: item.qty, name: product.name, cat: product.cat });
    }
    cartSubtotal = cartSubtotalOf(verifiedCart);

    if (couponCode) {
      const { data } = await supabase.from('coupons').select('*').eq('code', String(couponCode).toUpperCase()).eq('active', true).maybeSingle();
      if (data) {
        const eligible = couponEligibleFor(verifiedCart, data);
        const maxUses = Number(eligible?.max_uses);
        const capReached = Number.isFinite(maxUses) && maxUses > 0 && Number(eligible?.times_used || 0) >= maxUses;
        if (eligible && !capReached) couponCandidate = eligible;
      }
    }

    // Pre-filter only (does the card exist, is it unexpired, does it have anything left?).
    // The authoritative balance check happens inside redeemGiftCardBalance's own fresh read.
    if (giftCardCode) {
      const { data } = await supabase.from('gift_cards').select('code, balance, expires_at').eq('code', String(giftCardCode).toUpperCase()).maybeSingle();
      const notExpired = !data?.expires_at || new Date(data.expires_at) >= new Date();
      if (data && Number(data.balance) > 0 && notExpired) giftCardCandidate = data;
    }
  } catch (err) {
    console.error('razorpay-create-order pricing pass failed:', err);
    res.status(500).json({ error: 'Could not verify your cart. Please try again.' });
    return;
  }

  const shipping = getShippingCost(verifiedCart);

  // ==== CLAIM THIS CHECKOUT ATTEMPT -- atomically, BEFORE touching any coupon use counter,
  // gift-card balance or stock. checkoutAttemptKey is the idempotency boundary: whichever
  // request's INSERT wins the unique constraint is the ONLY one that ever reaches the
  // redemption code below. Every other request for the same key either waits (processing)
  // or replays the winner's already-computed result -- it never redeems anything itself, so
  // a retry can no longer over-count a coupon or double-debit a gift card. ====
  const placeholderOrderId = `attempt:${checkoutAttemptKey}`;
  const placeholderReceipt = `pending:${checkoutAttemptKey}`;
  const insertClaim = () => supabase.from('pending_orders').insert({
    checkout_attempt_key: checkoutAttemptKey,
    razorpay_order_id: placeholderOrderId,
    receipt: placeholderReceipt,
    computed: {}, cart, addr, bill_addr: billAddr || null,
    user_id: ownerId, user_email: ownerEmail || null, user_name: ownerName || null,
    user_phone: userPhone || null, estimated_delivery: estimatedDelivery || null,
    status: 'reserving',
    expires_at: new Date(Date.now() + CLAIM_TIMEOUT_MS).toISOString(),
  });

  const { error: claimInsertError } = await insertClaim();
  if (claimInsertError) {
    if (claimInsertError.code !== '23505') {
      console.error('pending_orders claim insert failed:', claimInsertError.message, checkoutAttemptKey);
      res.status(500).json({ error: 'Could not start checkout. Please try again.' });
      return;
    }

    const { data: existing } = await supabase.from('pending_orders').select('*').eq('checkout_attempt_key', checkoutAttemptKey).maybeSingle();
    if (!existing) {
      // Claimed a moment ago, already resolved by the time we looked.
      res.status(409).json({ error: 'Please try again.' });
      return;
    }

    if (existing.status === 'reserving') {
      const stillFresh = existing.expires_at && new Date(existing.expires_at) > new Date();
      if (stillFresh) {
        res.status(409).json(PROCESSING);
        return;
      }
      // The earlier attempt's own short claim window has passed -- treat it as abandoned
      // (a crash between claiming and finishing; nothing was ever reserved for it that
      // isn't tracked elsewhere) and reclaim it exactly once.
      const { error: staleDeleteError } = await supabase.from('pending_orders')
        .delete().eq('checkout_attempt_key', checkoutAttemptKey).eq('status', 'reserving').lt('expires_at', new Date().toISOString());
      if (staleDeleteError) {
        console.error('Could not reclaim a stale checkout-attempt claim:', staleDeleteError.message, checkoutAttemptKey);
        res.status(409).json(PROCESSING);
        return;
      }
      const { error: retryClaimError } = await insertClaim();
      if (retryClaimError) {
        res.status(409).json(PROCESSING);
        return;
      }
      // Fell through: this request now owns a fresh claim.
    } else if (existing.status === 'reserved') {
      // Replay the original result instead of redoing any work. The blob is a pure function
      // of computed+receipt+razorpay_order_id, so re-signing (with a fresh issue time) is exact.
      const stillPlaceholder = String(existing.razorpay_order_id || '').startsWith('attempt:');
      if (stillPlaceholder && Number(existing.computed?.computedTotal) > 0) {
        // A paid checkout whose Razorpay order was never created (its holds were already given
        // back) -- nothing valid to replay. expired:true tells the client to mint a fresh key.
        res.status(409).json({ expired: true, error: 'Your checkout session expired. Please try again.' });
        return;
      }
      const { blob: blobStr, blobSig } = issueBlob({ computed: existing.computed, receipt: existing.receipt, razorpay_order_id: stillPlaceholder ? null : existing.razorpay_order_id }, keySecret);
      if (stillPlaceholder) {
        res.status(200).json({ free: true, receipt: existing.receipt, blob: blobStr, blobSig, ...existing.computed });
      } else {
        res.status(200).json({ id: existing.razorpay_order_id, key_id: keyId, receipt: existing.receipt, blob: blobStr, blobSig, ...existing.computed });
      }
      return;
    } else {
      // 'released' (or any other terminal state): its holds were already given back, so it can
      // neither be replayed nor safely re-run under this key. The client mints a fresh key.
      res.status(409).json({ expired: true, error: 'Your checkout session expired. Please try again.' });
      return;
    }
  }

  // ---- From here on this request exclusively owns the claim row for checkoutAttemptKey ----
  let claimReserving = true; // false once the row has moved past 'reserving'
  async function abortClaim() {
    if (!claimReserving) return; // never delete a row that is already a real reservation
    claimReserving = false;
    const { error } = await supabase.from('pending_orders').delete().eq('checkout_attempt_key', checkoutAttemptKey).eq('status', 'reserving');
    if (error) console.error('Failed to clean up an aborted checkout-attempt claim:', error.message, checkoutAttemptKey);
  }

  // Set the moment redeem_coupon_use actually succeeds, read by the failure paths.
  let redeemedCouponCode = null;
  async function releaseReservedCoupon() {
    if (!redeemedCouponCode) return;
    const code = redeemedCouponCode;
    redeemedCouponCode = null;
    const { error } = await supabase.rpc('release_coupon_use', { p_code: code });
    if (error) console.error('Failed to release coupon reservation after order-creation failure:', error, code);
  }

  // Same shape, for a gift-card balance already debited atomically below.
  let debitedGiftCard = null; // { code, amount } | null
  async function releaseDebitedGiftCard() {
    if (!debitedGiftCard) return;
    const { code, amount } = debitedGiftCard;
    debitedGiftCard = null;
    const credited = await creditGiftCardBalance(supabase, code, amount);
    if (!credited) console.error('SECURITY/RECONCILIATION: could not release a debited gift card after order-creation failure -- needs manual check.', code, amount);
  }

  let stockReserved = false;
  async function releaseReservedStock() {
    if (!stockReserved) return;
    stockReserved = false;
    const { error } = await supabase.rpc('release_product_stock', { p_checkout_attempt_key: checkoutAttemptKey });
    if (error) console.error('Failed to release stock reservation after order-creation failure:', error, checkoutAttemptKey);
  }

  // Gives back everything this attempt holds, exactly once. Once the claim row has moved past
  // 'reserving' it is a real reservation the expiry sweep will ALSO try to release later, so the
  // release must go through releaseCheckoutReservation (which marks the coupon/gift-card release
  // as consumed on that row) -- releasing directly here would let the sweep credit the same gift
  // card / coupon use back a second time.
  async function releaseHeldResources() {
    if (claimReserving) {
      await releaseReservedStock();
      await releaseReservedCoupon();
      await releaseDebitedGiftCard();
      await abortClaim();
      return;
    }
    stockReserved = false;
    redeemedCouponCode = null;
    debitedGiftCard = null;
    await releaseCheckoutReservation(supabase, checkoutAttemptKey);
  }

  try {
    // ---- Reserve the coupon's use slot atomically, before any payment exists ----
    let coupon = couponCandidate;
    let discount = coupon ? couponDiscountOf(verifiedCart, coupon) : 0;
    if (coupon && discount > 0) {
      const { error: couponRedeemErr } = await supabase.rpc('redeem_coupon_use', { p_code: coupon.code });
      if (couponRedeemErr) {
        // Another checkout took the last use -- proceed at full price, exactly like an expired code.
        coupon = null;
        discount = 0;
      } else {
        redeemedCouponCode = coupon.code;
      }
    } else {
      coupon = null;
      discount = 0;
    }

    // ---- Reserve (debit) the gift card atomically, before any payment exists ----
    // The ceiling is what this ORDER can absorb (merchandise + shipping - discount) -- passed with
    // an unbounded balance so the card's own (possibly stale) balance is never baked into it.
    // redeemGiftCardBalance re-reads the real balance on every CAS pass and returns what it
    // actually debited.
    let giftCard = null;
    let giftCardApplied = 0;
    if (giftCardCandidate) {
      const ceiling = giftCardAppliedOf({ balance: Infinity }, verifiedCart, shipping, discount);
      if (ceiling > 0) {
        const redeemResult = await redeemGiftCardBalance(supabase, giftCardCandidate.code, ceiling);
        if (redeemResult.ok) {
          giftCard = giftCardCandidate;
          giftCardApplied = redeemResult.applied;
          debitedGiftCard = { code: giftCardCandidate.code, amount: redeemResult.applied };
        }
        // else: emptied/expired/changed underneath us -- proceed without the gift card.
      }
    }

    const total = Math.max(0, cartSubtotal + shipping - discount - giftCardApplied);

    const computed = {
      computedSubtotal: cartSubtotal,
      computedShipping: shipping,
      computedDiscount: discount,
      computedGiftCardApplied: giftCardApplied,
      computedTotal: total,
      couponValid: !!coupon,
      couponCode: coupon?.code || null,
      giftCardValid: !!giftCard,
      giftCardCode: giftCard?.code || null,
      verifiedItems: verifiedItemsForClient,
    };

    // Order number assigned server-side, atomically, from a database sequence.
    const { data: receiptData, error: receiptError } = await supabase.rpc('next_order_number');
    if (receiptError || !receiptData) {
      await releaseReservedCoupon();
      await releaseDebitedGiftCard();
      await abortClaim();
      console.error('next_order_number RPC failed:', receiptError);
      res.status(500).json({ error: 'Could not start checkout. Please try again.' });
      return;
    }
    const receipt = receiptData;

    // Record what this attempt actually took (the release paths read it back from this row)
    // BEFORE stock is reserved, so the row is never 'reserved' with placeholder contents.
    const { error: finalizeClaimError } = await supabase.from('pending_orders')
      .update({ receipt, computed })
      .eq('checkout_attempt_key', checkoutAttemptKey).eq('status', 'reserving');
    if (finalizeClaimError) {
      await releaseReservedCoupon();
      await releaseDebitedGiftCard();
      await abortClaim();
      console.error('pending_orders finalize update failed:', finalizeClaimError.message, checkoutAttemptKey);
      res.status(500).json({ error: 'Could not start checkout. Please try again.' });
      return;
    }

    // ---- Reserve stock atomically -- this *is* the real inventory decrement ----
    const stockItems = verifiedItemsForClient.filter(v => !v.isGiftCard).map(v => ({ id: v.id, size: v.size || null, qty: v.qty }));
    if (stockItems.length > 0) {
      const { error: reserveError } = await supabase.rpc('reserve_product_stock', {
        p_checkout_attempt_key: checkoutAttemptKey, p_items: stockItems, p_timeout_minutes: RESERVATION_TIMEOUT_MINUTES,
      });
      if (reserveError) {
        await abortClaim();
        await releaseReservedCoupon();
        await releaseDebitedGiftCard();
        res.status(400).json({ error: 'One or more items in your cart just sold out. Please review your cart and try again.' });
        return;
      }
      stockReserved = true;
      claimReserving = false; // reserve_product_stock moves the row to 'reserved' itself
    } else {
      // Gift-card-only cart -- nothing to reserve, but the claim row still needs to move past
      // 'reserving' so it is treated as a normal live reservation subject to the real expiry.
      const { error: reservedUpdateError } = await supabase.from('pending_orders')
        .update({ status: 'reserved', reserved_items: [], expires_at: new Date(Date.now() + RESERVATION_TIMEOUT_MINUTES * 60000).toISOString() })
        .eq('checkout_attempt_key', checkoutAttemptKey).eq('status', 'reserving');
      if (reservedUpdateError) {
        await releaseReservedCoupon();
        await releaseDebitedGiftCard();
        await abortClaim();
        console.error('pending_orders reserved-status update failed:', reservedUpdateError.message, checkoutAttemptKey);
        res.status(500).json({ error: 'Could not start checkout. Please try again.' });
        return;
      }
      claimReserving = false;
    }

    // A signed, opaque proof of everything above -- carried through the client unchanged and
    // checked again (signature + age) in api/razorpay-verify-payment.js / api/verify-free-order.js.
    if (total <= 0) {
      const { blob: blobStr, blobSig } = issueBlob({ computed, receipt, razorpay_order_id: null }, keySecret);
      res.status(200).json({ free: true, receipt, blob: blobStr, blobSig, ...computed });
      return;
    }

    const amountPaise = Math.round(total * 100);
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: 'INR',
        receipt,
      }),
    });
    const data = await rzpRes.json();
    if (!rzpRes.ok) {
      await releaseHeldResources();
      res.status(502).json({ error: data?.error?.description || 'Could not create payment order.' });
      return;
    }
    const { blob: blobStr, blobSig } = issueBlob({ computed, receipt, razorpay_order_id: data.id }, keySecret);

    // Cosmetic/best-effort only -- recovery keys off `receipt`, not this. Defensively scoped to
    // the exact placeholder this attempt wrote.
    const { error: updateErr } = await supabase.from('pending_orders')
      .update({ razorpay_order_id: data.id })
      .eq('checkout_attempt_key', checkoutAttemptKey)
      .eq('razorpay_order_id', placeholderOrderId)
      .eq('status', 'reserved');
    if (updateErr) {
      console.error('pending_orders razorpay_order_id cosmetic update failed (non-fatal, recovery is unaffected):', updateErr.message, checkoutAttemptKey, data.id);
    }

    res.status(200).json({ id: data.id, amount: data.amount, currency: data.currency, key_id: keyId, receipt, blob: blobStr, blobSig, ...computed });
  } catch (err) {
    await releaseHeldResources();
    console.error('razorpay-create-order failed:', err);
    res.status(500).json({ error: 'Could not start payment. Please try again.' });
  }
}
