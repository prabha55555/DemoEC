// Vercel serverless function -- the ONLY place the Razorpay Key Secret is ever used,
// and now also the source of truth for what an order actually costs. The browser
// used to send a pre-computed `amount` here and this function just charged it --
// which meant editing that one number in a network request was enough to pay
// whatever you wanted for any cart. Every line item is now re-priced from the
// database, coupons/gift cards are re-validated from their own tables, and the
// Razorpay order is created for that server-computed total -- never the client's.
import { createClient } from '@supabase/supabase-js';
import { shippingFor } from '../src/utils/shipping.js';
import { cartSubtotalOf, couponDiscountOf, couponLineDiscounts, couponProblem, giftCardAppliedOf, DEFAULT_GIFTCARD_MIN, giftcardMaxOf } from '../src/utils/pricing.js';
import { isVariantPurchasable, variantStock, categoryIdsWithAncestors, categoryChain } from '../src/utils/catalog.js';
import { computeTax, resolveGstRate, resolveHsn } from '../src/utils/tax.js';
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
  // 'cod' only when the store has enabled it AND the cart qualifies (checked below); anything else is online.
  const paymentMethod = req.body?.paymentMethod === 'cod' ? 'cod' : 'online';
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
  // The delivery fee depends on the city, so a blank one must never fall back to the cheaper zone.
  if (!addr.city) {
    res.status(400).json({ error: 'Please enter your city or town.' });
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
  let couponNote = null;
  let giftCardCandidate = null;
  let brand = {};
  try {
    // Aggregate quantities per variant (and per gift-card line) BEFORE anything else --
    // otherwise a request could split one large quantity across several line entries.
    const lineKey = (i) => i.isGiftCard ? `gc:${i.id}` : String(i.variantId || '');
    const aggregated = new Map();
    for (const item of items) {
      const qty = Number(item.qty);
      if (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) {
        res.status(400).json({ error: 'One of the items in your cart has an invalid quantity.' });
        return;
      }
      if (!item.isGiftCard && !item.variantId) {
        res.status(400).json({ error: 'One of the items in your cart is out of date. Please remove and re-add it.' });
        return;
      }
      const key = lineKey(item);
      const existing = aggregated.get(key);
      if (existing) existing.qty += qty;
      else aggregated.set(key, { id: item.id, variantId: item.variantId || null, isGiftCard: !!item.isGiftCard, price: item.price, qty });
    }
    const mergedItems = [...aggregated.values()];

    const productIds = [...new Set(mergedItems.filter(i => !i.isGiftCard).map(i => i.id))];
    const variantIds = [...new Set(mergedItems.filter(i => !i.isGiftCard).map(i => i.variantId))];
    const [prodRes, varRes, settingsRes, catRes] = await Promise.all([
      productIds.length ? supabase.from('products').select('*').in('id', productIds) : Promise.resolve({ data: [], error: null }),
      variantIds.length ? supabase.from('product_variants').select('*').in('id', variantIds) : Promise.resolve({ data: [], error: null }),
      supabase.from('settings').select('*').eq('id', 'brand').maybeSingle(),
      supabase.from('categories').select('id, parent_id, gst_rate, hsn_code'),
    ]);
    // Settings drive the shipping fee, COD rules and tax; categories drive GST and coupon scope. If either read
    // fails, stop -- continuing would silently price shipping at 0.
    if (prodRes.error || varRes.error || settingsRes.error || catRes.error) {
      console.error('razorpay-create-order: catalogue/settings read failed.', prodRes.error?.message || varRes.error?.message || settingsRes.error?.message || catRes.error?.message);
      res.status(500).json({ error: 'Could not verify your cart. Please try again.' });
      return;
    }
    const productById = Object.fromEntries((prodRes.data || []).map(p => [p.id, p]));
    const variantById = Object.fromEntries((varRes.data || []).map(v => [v.id, v]));
    brand = settingsRes.data || {};
    const categories = catRes.data || [];

    // ?? applied BEFORE Number() -- an admin deliberately setting a 0 minimum must not
    // be silently overridden back to the hardcoded default.
    const giftcardMin = Number(brand.giftcard_min ?? DEFAULT_GIFTCARD_MIN);
    const giftcardMax = giftcardMaxOf(brand.giftcard_max);
    const defaultGst = Number(brand.default_gst_rate ?? 18);
    const defaultReturnDays = Number(brand.return_window_days ?? 7);

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
        verifiedItemsForClient.push({ id: item.id, variantId: null, isGiftCard: true, price, qty: item.qty });
        continue;
      }

      const product = productById[item.id];
      const variant = variantById[item.variantId];
      // The variant must belong to the product the client named, be live, and be purchasable --
      // a stale cart line or a tampered request just reads as "no longer available".
      if (!product || product.status !== 'active' || !variant || variant.product_id !== product.id || variant.active === false) {
        res.status(400).json({ error: 'One of the items in your cart is no longer available.' });
        return;
      }
      const price = Number(variant.price);
      if (!Number.isFinite(price) || price <= 0) {
        res.status(400).json({ error: 'One of the items in your cart is no longer available.' });
        return;
      }
      const maxQty = Number(product.max_qty_per_order) > 0 ? Number(product.max_qty_per_order) : 10;
      if (item.qty > maxQty) {
        res.status(400).json({ error: `You can order at most ${maxQty} of "${product.name}" at a time.` });
        return;
      }
      // Friendly early message only -- reserve_product_stock (below) does the real, concurrency-safe
      // atomic check-and-reserve.
      const left = variantStock(variant);
      if (!isVariantPurchasable(variant) || (left !== null && item.qty > left)) {
        res.status(400).json({ error: left ? `Only ${left} left of "${product.name}". Please reduce the quantity.` : `"${product.name}" just sold out.` });
        return;
      }

      const chain = categoryChain(categories, product.category_id);
      const label = variant.label && variant.label !== 'Default' ? variant.label : '';
      verifiedCart.push({
        id: item.id, variantId: variant.id, price, qty: item.qty, isGiftCard: false,
        categoryIds: categoryIdsWithAncestors(categories, product.category_id),
        freeShipping: !!product.free_shipping, codAllowed: product.cod_allowed !== false,
      });
      verifiedItemsForClient.push({
        id: item.id, variantId: variant.id, sku: variant.sku || null, isGiftCard: false,
        name: product.name, variantLabel: label, options: variant.options || {},
        price, mrp: variant.mrp != null && Number(variant.mrp) > price ? Number(variant.mrp) : null, qty: item.qty,
        cat: product.cat, brand: product.brand || null,
        image: variant.image_url || (Array.isArray(product.images) ? product.images[0] : null) || null,
        gstRate: resolveGstRate({ product, categoryChain: chain, defaultRate: defaultGst }),
        hsn: resolveHsn({ product, categoryChain: chain }),
        returnWindowDays: product.return_window_days != null ? Number(product.return_window_days) : defaultReturnDays,
        freeShipping: !!product.free_shipping,
      });
    }
    cartSubtotal = cartSubtotalOf(verifiedCart);

    // ---- Cash on Delivery eligibility (only ever when the store switched it on)
    if (paymentMethod === 'cod') {
      if (!brand.cod_enabled) { res.status(400).json({ error: 'Cash on Delivery is not available right now.' }); return; }
      if (verifiedCart.some(i => i.isGiftCard)) { res.status(400).json({ error: 'Gift cards must be paid online.' }); return; }
      if (verifiedCart.some(i => i.codAllowed === false)) { res.status(400).json({ error: 'Cash on Delivery is not available for one of the items in your cart.' }); return; }
    }

    if (couponCode) {
      const { data } = await supabase.from('coupons').select('*').eq('code', String(couponCode).toUpperCase()).eq('active', true).maybeSingle();
      if (data) {
        // first-order / per-customer rules need the customer's order history -- only fetched when the
        // coupon actually has such a rule and we know who the customer is.
        let userOrderCount = null, userUses = null;
        const identityBound = data.first_order_only || Number(data.per_user_limit) > 0;
        if (identityBound && !ownerId) {
          // "first order" / "once per customer" cannot be checked for a guest (a new tab is a new guest), so
          // these coupons need a signed-in account.
          couponNote = 'Sign in to use this coupon.';
        } else {
          if (identityBound) {
            const orders = () => supabase.from('orders').select('id', { count: 'exact', head: true }).eq('user_id', ownerId).neq('status', 'Cancelled');
            // other checkouts of this customer that are still open -- never this attempt itself (a retry reuses its key)
            const pend = () => supabase.from('pending_orders').select('id', { count: 'exact', head: true }).eq('user_id', ownerId).in('status', ['reserving', 'reserved']).neq('checkout_attempt_key', checkoutAttemptKey);
            const [{ count: total }, { count: used }, { count: pendingAll }, { count: pendingSame }] = await Promise.all([
              orders(), orders().eq('coupon_code', data.code), pend(), pend().eq('computed->>couponCode', data.code),
            ]);
            // checkouts still being paid count too, so two parallel checkouts cannot both pass a "once" rule
            userOrderCount = (total ?? 0) + (pendingAll ?? 0);
            userUses = (used ?? 0) + (pendingSame ?? 0);
          }
          const problem = couponProblem(verifiedCart, data, { userOrderCount, userUses });
          if (problem) couponNote = problem; else couponCandidate = data;
        }
      } else {
        couponNote = 'Invalid or expired coupon code.';
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
      if (existing.computed?.paymentMethod === 'cod') {
        const { blob: codBlob, blobSig: codSig } = issueBlob({ computed: existing.computed, receipt: existing.receipt, razorpay_order_id: null }, keySecret);
        res.status(200).json({ cod: true, receipt: existing.receipt, blob: codBlob, blobSig: codSig, ...existing.computed });
        return;
      }
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

    // ---- Shipping: its own visible line, from the delivery address and the cart value (before coupons) ----
    const shipQuote = shippingFor({ cart: verifiedCart, address: addr, brand, paymentMethod });
    const shipping = shipQuote.fee;
    const codFee = shipQuote.codFee;

    // ---- Reserve (debit) the gift card atomically, before any payment exists ----
    // The ceiling is what this ORDER can absorb (merchandise + shipping - discount) -- passed with
    // an unbounded balance so the card's own (possibly stale) balance is never baked into it.
    // redeemGiftCardBalance re-reads the real balance on every CAS pass and returns what it
    // actually debited.
    let giftCard = null;
    let giftCardApplied = 0;
    if (giftCardCandidate) {
      const ceiling = giftCardAppliedOf({ balance: Infinity }, verifiedCart, shipping + codFee, discount);
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

    const total = Math.max(0, cartSubtotal + shipping + codFee - discount - giftCardApplied);

    // Cash on Delivery has a ceiling (cod_max_order) -- checked on the real payable amount.
    if (paymentMethod === 'cod' && Number(brand.cod_max_order) > 0 && total > Number(brand.cod_max_order)) {
      await releaseReservedCoupon();
      await releaseDebitedGiftCard();
      await abortClaim();
      res.status(400).json({ error: `Cash on Delivery is available up to ₹${Number(brand.cod_max_order)}. Please pay online for this order.` });
      return;
    }

    // Each line records its own share of the coupon, so a return refunds exactly what was paid for that line
    // (a coupon may cover only some items).
    const lineDiscounts = couponLineDiscounts(verifiedCart, coupon, discount);
    verifiedItemsForClient.forEach(v => { if (!v.isGiftCard) v.lineDiscount = lineDiscounts[v.variantId] || 0; });

    // GST is already inside every price; this only records how much of the order is tax, for the invoice.
    const taxCalc = computeTax({
      lines: verifiedItemsForClient.filter(v => !v.isGiftCard).map(v => ({ key: v.variantId, name: v.name, hsn: v.hsn, qty: v.qty, price: v.price, gstRate: v.gstRate, lineDiscount: v.lineDiscount })),
      discount, shipping: shipping + codFee,
      shippingRate: Number(brand.default_gst_rate ?? 18),
      sellerState: brand.seller_state, buyerState: addr.state,
    });

    const computed = {
      computedSubtotal: cartSubtotal,
      computedShipping: shipping,
      computedCodFee: codFee,
      computedDiscount: discount,
      computedGiftCardApplied: giftCardApplied,
      computedTax: taxCalc.totals.tax,
      computedTotal: total,
      paymentMethod,
      couponValid: !!coupon,
      couponCode: coupon?.code || null,
      couponNote: coupon ? null : couponNote,
      giftCardValid: !!giftCard,
      giftCardCode: giftCard?.code || null,
      freeShippingAway: shipQuote.away,
      // The delivery zone the fee was priced for; the verify endpoints refuse a different address.
      shipTo: { city: String(addr.city).trim().toLowerCase(), state: String(addr.state || '').trim().toLowerCase(), pincode: String(addr.pincode || '').trim() },
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
    const stockItems = verifiedItemsForClient.filter(v => !v.isGiftCard).map(v => ({ id: v.id, variantId: v.variantId, qty: v.qty }));
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
    // Cash on Delivery: nothing to charge now. The signed blob is the proof the server priced this cart
    // as COD; api/verify-free-order.js turns it into the order exactly like a fully-covered one.
    if (paymentMethod === 'cod') {
      const { blob: blobStr, blobSig } = issueBlob({ computed, receipt, razorpay_order_id: null }, keySecret);
      res.status(200).json({ cod: true, receipt, blob: blobStr, blobSig, ...computed });
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
