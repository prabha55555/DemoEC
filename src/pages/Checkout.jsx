import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useBrand } from '../context/BrandContext';
import { formatMoney, lineKey } from '../utils/catalog';
import { getCartDeliveryRange } from '../utils/delivery';
import { couponProblem } from '../utils/pricing';
import { shippingSummary } from '../utils/shipping';
import { shippingPromise } from '../utils/storeCopy';
import { checkoutTotals, codOption, orderCartPayload, orderItemsPayload } from '../utils/checkoutRules';
import { defaultAddress, normalizeAddresses, orderAddressOf, sortAddresses, upsertAddress } from '../utils/addressBook';
import { isValidIndianMobile, isPlaceholderEmail } from '../utils/orderFormat';
import { thumb } from '../utils/thumbnail';
import { isPincodeConfirmedInvalid } from '../utils/indianAddress';
import { COMPANY } from '../config/company';
import AddressForm from '../components/AddressForm';
import PriceSummary from '../components/PriceSummary';
import toast from 'react-hot-toast';

// Loads Razorpay's checkout widget script once and reuses it on later checkouts.
let razorpayScriptPromise = null;
function loadRazorpayScript() {
  if (window.Razorpay) return Promise.resolve(true);
  if (!razorpayScriptPromise) {
    razorpayScriptPromise = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  }
  return razorpayScriptPromise;
}

// A customer who signed in with a mobile OTP (api/msg91-login.js) has only a non-routable placeholder
// address on their Supabase account. UI-only detection -- the server (api/razorpay-create-order.js /
// api/razorpay-verify-payment.js) makes its own, authoritative decision from the verified token and never
// trusts anything the browser says about this. app_metadata is settable only by the server.
function isMobileLoginUser(user) {
  return !!user && (!!user.app_metadata?.msg91_phone || isPlaceholderEmail(user.email));
}
const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ico = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
const COUPON_COLUMNS = 'code, type, value, description, applies_to, product_ids, category_ids, min_order_value, max_discount, expires_at, starts_at, max_uses, times_used, first_order_only, per_user_limit, active';

// One line of "what this coupon gives you", from its rules.
function couponBlurb(c) {
  const off = c.type === 'percent' ? `${Number(c.value)}% off` : `${formatMoney(c.value)} off`;
  const cap = c.type === 'percent' && Number(c.max_discount) > 0 ? ` up to ${formatMoney(c.max_discount)}` : '';
  const min = Number(c.min_order_value) > 0 ? ` on orders above ${formatMoney(c.min_order_value)}` : '';
  return c.description?.trim() || `${off}${cap}${min}`;
}

export default function Checkout() {
  const { currentUser, userProfile, refreshProfile } = useAuth();
  const { cart, clearCart, refreshCart, hasUnavailable } = useCart();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const mobileLogin = isMobileLoginUser(currentUser);
  const [loading, setLoading] = useState(false);
  const [addrMode, setAddrMode] = useState('saved'); // 'saved' | 'new' -- 'saved' only counts when saved addresses exist
  const [selectedAddrId, setSelectedAddrId] = useState(null);
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState({
    name: userProfile?.name || '', phone: userProfile?.phone || '',
    email: isMobileLoginUser(currentUser) ? '' : (currentUser?.email || ''), line1: '', line2: '', city: '', state: '', pincode: '',
  });
  const [saveAddr, setSaveAddr] = useState(true);
  const [billingSame, setBillingSame] = useState(true);
  const [billing, setBilling] = useState({ name: '', phone: '', line1: '', line2: '', city: '', state: '', pincode: '' });
  const [paymentMethod, setPaymentMethod] = useState('online'); // 'online' | 'cod'
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [applyingCoupon, setApplyingCoupon] = useState(false);
  const [offers, setOffers] = useState([]);
  const [showAllOffers, setShowAllOffers] = useState(false);
  const [giftCardCode, setGiftCardCode] = useState('');
  const [appliedGiftCard, setAppliedGiftCard] = useState(null);
  const [applyingGiftCard, setApplyingGiftCard] = useState(false);
  // Full-screen "don't close this page" overlay for the gap between Razorpay
  // reporting success and our own server actually confirming the order --
  // previously just a small spinner inside the button, easy to miss right
  // when a customer is most likely to think nothing happened and navigate
  // away (see api/razorpay-webhook.js's own comment for why that moment
  // specifically matters). verifyingPaymentId is null for the free/₹0 and
  // Cash on Delivery paths, which have no Razorpay payment to reference.
  const [verifying, setVerifying] = useState(false);
  const [verifyDone, setVerifyDone] = useState(false);
  const [verifyingPaymentId, setVerifyingPaymentId] = useState(null);
  const [verifyKind, setVerifyKind] = useState('online'); // 'online' | 'cod' | 'free' -- only changes the overlay's wording

  // Best-effort abandonment mitigation for the stock and coupon reservations
  // api/razorpay-create-order.js makes (reserve_product_stock / redeem_coupon_use)
  // -- refs, not state, because they're read from a pagehide listener
  // registered once for this component's whole lifetime, independent of any
  // single placeOrder() call. This does NOT replace DB-side reservation
  // expiry -- a crash, killed tab, or lost connection can still prevent this
  // from ever running; the server-side expiry sweep is the authoritative
  // backstop, this is purely an optimization to free stock/coupon sooner
  // when the browser signal IS available. See the pagehide effect below.
  //
  // outstandingReservationRef: the checkout attempt's reservation info, or
  // null. checkoutAttemptKey is always present whenever a reservation exists
  // (stock is reserved for any real cart); code is only set if a coupon was
  // also applied. Set once api/razorpay-create-order confirms a reservation;
  // cleared the instant it's resolved through ANY path -- one of the
  // existing releaseReservations() call sites, or the instant verification
  // succeeds (a successful order must never have its reservations released,
  // no matter what fires afterward).
  const outstandingReservationRef = useRef(null); // checkoutAttemptKey string | null
  // verifyInFlightRef: true only in the narrow window between sending a
  // payment-verification request and getting a definitive answer back.
  // The pagehide handler stays silent whenever this is true, on purpose --
  // if the tab closes while a payment might have genuinely succeeded
  // server-side (or is about to, via the webhook recovery path), releasing
  // here would be exactly the "ambiguous state" release the existing
  // releaseReservations() call sites already deliberately avoid. Left true
  // (never reset) if the verify fetch itself throws -- same reasoning: a
  // network error here doesn't mean the server never received/processed
  // the request.
  const verifyInFlightRef = useRef(false);
  // One key per genuine checkout attempt: created on the first Proceed-to-Payment click and
  // REUSED by any retry of that same attempt (the server treats it as the idempotency key, so a
  // retry can never reserve stock / a coupon use / gift-card balance a second time). Cleared only
  // once the attempt's holds have been definitively given back or the order succeeded, so the
  // next genuinely new checkout starts with a fresh key.
  const checkoutAttemptKeyRef = useRef(null);
  // A ref, not the `loading` state, guards double-clicks: state updates don't land until the next
  // render, so two clicks in the same tick would both read loading === false.
  const placingRef = useRef(false);
  // Set once an order is confirmed, so emptying the cart afterwards does not bounce back to /cart.
  const completedRef = useRef(false);

  // Refreshing (or closing and reopening the tab) between Razorpay reporting success and our
  // server confirming the order used to drop the customer back on an untouched, fully-populated
  // checkout with no hint that money may have just moved -- inviting a second payment. The
  // in-flight marker is written the instant Razorpay reports success and cleared only once the
  // order is confirmed, so a reload inside that window gets an explicit warning.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('tt_payment_inflight');
      if (!raw) return;
      const marker = JSON.parse(raw);
      if (marker && Date.now() - marker.ts < 30 * 60 * 1000) {
        toast(`We're still confirming a payment you just made${marker.paymentId ? ` (ID ${marker.paymentId})` : ''}. Please check My Orders (or your email) before paying again -- if it doesn't appear, contact us with that payment ID.`, { icon: '⚠️', duration: 12000 });
      } else {
        localStorage.removeItem('tt_payment_inflight');
      }
    } catch { /* storage unavailable or malformed -- nothing to warn about */ }
  }, []);

  useEffect(() => {
    function handlePageHide() {
      if (verifyInFlightRef.current) return; // ambiguous -- might still succeed server-side, never release
      const reservationKey = outstandingReservationRef.current;
      if (!reservationKey) return;
      outstandingReservationRef.current = null; // best-effort de-dup -- never attempt this twice client-side
      try {
        // Same-origin call to release-reservation.js (a thin proxy that
        // releases the stock reservation, the coupon reservation, or both in
        // one request -- see that file's own header comment) rather than
        // hitting Supabase's REST RPC endpoints directly -- keeps both
        // privileged RPCs off the public anon key. fetch with keepalive
        // still works the same way for a same-origin request, and
        // supabase.rpc() still can't pass keepalive through to its own
        // internal fetch call, so this stays a raw fetch.
        fetch('/api/release-reservation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checkoutAttemptKey: reservationKey }),
          keepalive: true,
        }).catch(() => {}); // fire-and-forget -- the page is already unloading, nothing left to react to
      } catch { /* best-effort only -- never throw during unload */ }
    }
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, []);

  // Prices and stock in a stored cart go stale -- re-check once when checkout opens.
  useEffect(() => {
    refreshCart();
    // eslint-disable-next-line
  }, []);

  // ---- addresses ------------------------------------------------------------------------------
  const savedAddresses = useMemo(() => sortAddresses(normalizeAddresses(userProfile?.addresses)), [userProfile?.addresses]);
  const hasSaved = savedAddresses.length > 0;
  const usingSaved = addrMode === 'saved' && hasSaved;
  const selectedSaved = savedAddresses.find(a => a.id === selectedAddrId) || defaultAddress(savedAddresses);
  const shipTo = usingSaved ? selectedSaved : form;
  const shippingCity = shipTo?.city || '';
  const deliveryEstimate = getCartDeliveryRange(cart, brand, shippingCity);
  const digitalOnly = cart.length > 0 && cart.every(i => i.isGiftCard);

  // ---- totals (display only -- the server re-derives every number, see placeOrder) --------------
  // A coupon that no longer fits the cart (the cart was refreshed, quantities changed) stops counting at once
  // rather than at the Razorpay widget.
  const couponIssue = appliedCoupon ? couponProblem(cart, appliedCoupon) : null;
  const activeCoupon = appliedCoupon && !couponIssue ? appliedCoupon : null;
  const totalsOnline = checkoutTotals({ cart, brand, address: shipTo, paymentMethod: 'online', coupon: activeCoupon, giftCard: appliedGiftCard });
  const totalsCod = checkoutTotals({ cart, brand, address: shipTo, paymentMethod: 'cod', coupon: activeCoupon, giftCard: appliedGiftCard });
  const cod = codOption({ brand, cart, totalWithCod: totalsCod.total });
  // Nothing left to pay (coupon / gift card cover everything) -> no payment method applies, and no COD fee.
  const fullyCovered = totalsOnline.total <= 0;
  const method = !fullyCovered && paymentMethod === 'cod' && cod.enabled ? 'cod' : 'online';
  const t = method === 'cod' ? totalsCod : totalsOnline;
  const total = t.total;

  // Sync form when userProfile loads asynchronously after render.
  // userProfile gets a new object reference on every Supabase auth event (a
  // background token refresh, not just sign-in) -- forcing the mode to "saved"
  // unconditionally on every one of those re-fired this mid-checkout, silently
  // flipping a customer's deliberate "New address" choice back to "Use saved" and
  // collapsing the address form they were filling in. Only forces it the first
  // time real profile data actually arrives, never again after that.
  const profileSyncedRef = useRef(false);
  useEffect(() => {
    if (profileSyncedRef.current || !userProfile) return;
    profileSyncedRef.current = true;
    setForm(f => ({
      ...f,
      name: f.name || userProfile.name || '',
      phone: f.phone || userProfile.phone || '',
    }));
  }, [userProfile]);

  // Public coupons the signed-in customer may use -- one tap to apply (RLS only lists public, live ones).
  useEffect(() => {
    if (!currentUser) { setOffers([]); return undefined; }
    let alive = true;
    supabase.from('coupons').select(COUPON_COLUMNS).order('created_at', { ascending: false }).limit(12)
      .then(({ data, error }) => { if (alive && !error) setOffers(Array.isArray(data) ? data : []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [currentUser]);

  async function applyCoupon(codeArg, rowArg) {
    const code = String(codeArg ?? couponCode).trim().toUpperCase();
    if (!code) return;
    setApplyingCoupon(true);
    try {
      let data = rowArg || null;
      if (!data) {
        // Routed through api/lookup.js (a server-side single-code lookup)
        // instead of querying the coupons table directly -- the table's own
        // public SELECT policy used to let anyone list every active coupon.
        const res = await fetch('/api/lookup', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'coupon', code }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.coupon) { toast.error('Invalid or expired coupon code.'); setAppliedCoupon(null); return; }
        data = body.coupon;
      }
      // First-order and per-customer limits can only be judged by the server; they are reported after create-order.
      const problem = couponProblem(cart, data);
      if (problem) { toast.error(problem); setAppliedCoupon(null); return; }
      setAppliedCoupon(data);
      setCouponCode(data.code);
      toast.success('Coupon applied.');
    } catch {
      toast.error('Could not verify coupon. Please try again.');
      setAppliedCoupon(null);
    } finally { setApplyingCoupon(false); }
  }

  function removeCoupon() {
    setAppliedCoupon(null);
    setCouponCode('');
  }

  async function applyGiftCard() {
    const code = giftCardCode.trim().toUpperCase();
    if (!code) return;
    setApplyingGiftCard(true);
    try {
      // Routed through api/lookup.js instead of querying the gift_cards
      // table directly -- the table's own public SELECT policy used to let
      // anyone list every gift card ever issued (code, balance, recipient/
      // purchaser email). The proxy returns only code/balance/expires_at,
      // which is all this form ever reads.
      const res = await fetch('/api/lookup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'gift-card', code }),
      });
      const { giftCard: data } = await res.json().catch(() => ({}));
      if (!res.ok || !data) { toast.error('Invalid gift card code.'); setAppliedGiftCard(null); return; }
      if (Number(data.balance) <= 0) { toast.error('This gift card has no remaining balance.'); setAppliedGiftCard(null); return; }
      if (data.expires_at && new Date(data.expires_at) < new Date()) { toast.error('This gift card has expired.'); setAppliedGiftCard(null); return; }
      setAppliedGiftCard(data);
      toast.success(`Gift card applied — ${formatMoney(data.balance)} available.`);
    } catch {
      toast.error('Could not verify gift card. Please try again.');
      setAppliedGiftCard(null);
    } finally { setApplyingGiftCard(false); }
  }

  function removeGiftCard() {
    setAppliedGiftCard(null);
    setGiftCardCode('');
  }

  function patchForm(patch) { setForm(f => ({ ...f, ...patch })); setErrors(e => { const n = { ...e }; Object.keys(patch).forEach(k => { n[k] = ''; }); return n; }); }
  function patchBilling(patch) { setBilling(b => ({ ...b, ...patch })); setErrors(e => { const n = { ...e }; Object.keys(patch).forEach(k => { n['b_' + k] = ''; }); return n; }); }
  const billErrors = useMemo(() => Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith('b_')).map(([k, v]) => [k.slice(2), v])), [errors]);

  function validate() {
    const e = {};
    // A saved address from before city/PIN were required can be incomplete; the server refuses it, so say so up front.
    if (usingSaved && !['name', 'phone', 'line1', 'city', 'state', 'pincode'].every(k => String(selectedSaved?.[k] || '').trim())) {
      toast.error('That saved address is incomplete (city or PIN code missing). Pick another or add a new address.');
      return false;
    }
    if (!usingSaved) {
      if (!form.name.trim()) e.name = 'Required';
      if (!form.phone.trim()) e.phone = 'Required';
      else if (!isValidIndianMobile(form.phone)) e.phone = 'Enter a valid 10-digit phone number';
      if (!form.email.trim()) e.email = 'Required';
      else if (!VALID_EMAIL.test(form.email.trim())) e.email = 'Enter a valid email address';
      if (!form.line1.trim()) e.line1 = 'Required';
      if (!form.city.trim()) e.city = 'Required';
      if (!form.state.trim()) e.state = 'Required';
      if (!form.pincode.trim()) e.pincode = 'Required';
      else if (!/^\d{6}$/.test(form.pincode.trim())) e.pincode = 'Enter a valid 6-digit PIN code';
    }
    // Mobile-OTP customers have no usable account email, so the checkout email is ALWAYS required for them
    // (the new-address block above only checks it when it is showing, i.e. not for a saved address).
    if (mobileLogin && usingSaved) {
      if (!form.email.trim()) e.email = 'Required';
      else if (!VALID_EMAIL.test(form.email.trim()) || isPlaceholderEmail(form.email.trim())) e.email = 'Enter a valid email address';
    } else if (mobileLogin && isPlaceholderEmail(form.email.trim())) {
      e.email = 'Enter a valid email address';
    }
    if (!billingSame) {
      if (!billing.name.trim()) e.b_name = 'Required';
      if (!billing.line1.trim()) e.b_line1 = 'Required';
      if (!billing.city.trim()) e.b_city = 'Required';
      if (!billing.state.trim()) e.b_state = 'Required';
      if (!billing.pincode.trim()) e.b_pincode = 'Required';
      else if (!/^\d{6}$/.test(billing.pincode.trim())) e.b_pincode = 'Enter a valid 6-digit PIN code';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  // Shared by every confirmation path (paid online, Cash on Delivery, fully covered) -- runs only once
  // the server has confirmed (in api/razorpay-verify-payment.js or api/verify-free-order.js) that real
  // money actually moved, that the order is Cash on Delivery, or that none was needed, AND has already
  // written the orders/gift_cards rows itself from its own re-derived numbers. This function no longer
  // writes either table -- it only handles the client-side-only follow-ups: saving a new address to the
  // profile, remembering a summary for the confirmation page, and sending the customer there.
  async function finalizeOrder({ addr, billAddr, orderId, computed, mode, contactEmail }) {
    // Save a new address to the address book (signed-in customers; same line1 + pincode updates, never duplicates)
    if (saveAddr && !usingSaved && currentUser) {
      try {
        const { addresses } = upsertAddress(userProfile?.addresses || [], addr);
        const { error } = await supabase.from('profiles').update({ addresses }).eq('id', currentUser.id);
        if (!error) await refreshProfile();
      } catch { /* the order is already placed -- a failed address save must never get in the way */ }
    }

    // Gift-card redemption and stock decrement happen server-side, inside writeVerifiedOrder()
    // (src/utils/orderWrite.js) -- as part of the same trusted call that already wrote this order.

    // ts lets Confirmation.jsx tell "just placed" apart from "revisited this page
    // days later" -- this key is never cleared, so without a timestamp, a
    // bookmark/back-button/direct visit long after the fact re-showed the old
    // order as if it had just been placed.
    try { localStorage.removeItem('tt_payment_inflight'); } catch { /* best-effort */ }
    const verified = new Map((computed.verifiedItems || []).map(v => [v.isGiftCard ? `gc:${v.id}` : String(v.variantId || ''), v]));
    const summaryItems = cart.map(i => {
      const v = verified.get(lineKey(i)) || {};
      return {
        id: i.id, variantId: i.variantId || null, isGiftCard: !!i.isGiftCard,
        name: v.name || i.name, variantLabel: v.variantLabel ?? i.variantLabel ?? '',
        qty: v.qty ?? i.qty, price: v.price ?? i.price, mrp: v.mrp ?? i.mrp ?? null,
        image: v.image || i.image || null, brand: v.brand || i.brand || null,
      };
    });
    try {
      localStorage.setItem('tt_last_order', JSON.stringify({
        orderId, ts: Date.now(),
        items: summaryItems,
        subtotal: computed.computedSubtotal, shipping: computed.computedShipping, codFee: computed.computedCodFee || 0,
        discount: computed.computedDiscount || 0, giftCard: computed.computedGiftCardApplied || 0, tax: computed.computedTax || 0,
        total: computed.computedTotal, couponCode: computed.couponCode || null,
        paymentMethod: mode, // 'online' | 'cod' | 'free'
        estimatedDelivery: deliveryEstimate ? `${deliveryEstimate.daysLabel} (${deliveryEstimate.label})` : null,
        addr, billAddr: billingSame ? null : billAddr, email: contactEmail || null, digital: digitalOnly,
      }));
    } catch { /* storage full/blocked -- the confirmation page falls back to "view my orders" */ }
    completedRef.current = true;
    clearCart();
    navigate('/confirmation');
    return true;
  }

  async function placeOrder() {
    if (loading || placingRef.current) return; // guard against a double-tap firing this twice before the disabled state re-renders
    if (hasUnavailable) { toast.error('Remove the out-of-stock items from your cart to continue.'); return; }
    if (!validate()) { toast.error('Please fill in all required fields.'); return; }
    placingRef.current = true;
    setLoading(true);

    // One id per genuine attempt, reused by a retry of the same attempt (see
    // checkoutAttemptKeyRef above) -- used server-side (api/razorpay-create-order.js) as the
    // idempotency key so a retry can never reserve stock, a coupon use or gift-card balance
    // twice, or create a second Razorpay order.
    const checkoutAttemptKey = checkoutAttemptKeyRef.current || crypto.randomUUID();
    checkoutAttemptKeyRef.current = checkoutAttemptKey;

    const addr = usingSaved
      ? orderAddressOf(selectedSaved)
      : orderAddressOf(form);
    const billAddr = billingSame ? addr : { ...orderAddressOf(billing), phone: billing.phone || addr.phone };

    // We only ship within India -- checked here against BOTH addresses (a saved
    // address skips validate()'s own format check above, so this is the one place
    // guaranteed to run for every checkout, new address or saved) rather than
    // relying on the pincode having been typed fresh just now.
    if (await isPincodeConfirmedInvalid(addr.pincode) || (!billingSame && await isPincodeConfirmedInvalid(billAddr.pincode))) {
      toast.error('Unable to purchase -- we currently ship within India only. For international orders, please contact us on WhatsApp.');
      setLoading(false);
      placingRef.current = false;
      return;
    }

    // Everything the verify endpoints need to write the order themselves, besides
    // the signed blob -- none of this is price-sensitive (it's shipping/contact/
    // gift-recipient info the customer already entered), so it's sent as-is. The
    // blob itself, not this, is what the server actually trusts for pricing.
    // Computed here (not after the create-order call below) so it can also be
    // sent WITH that request -- api/razorpay-create-order.js now stashes it
    // server-side as a `pending_orders` row, so a customer who pays but never
    // makes it back to this tab (closed browser, crash, lost connection) can
    // still have their order recovered by api/razorpay-webhook.js instead of
    // the payment just vanishing into nothing on our end.
    // Normal customers: their account email, exactly as before. Mobile-OTP customers: the email they typed
    // here -- never the placeholder. Contact only; the server decides identity from the bearer token.
    const contactEmail = mobileLogin ? form.email.trim() : (currentUser?.email || form.email);
    const orderWriteFields = {
      cart: orderCartPayload(cart), addr, billAddr,
      userId: currentUser?.id || null,
      userEmail: contactEmail,
      userName: userProfile?.name || (usingSaved ? selectedSaved?.name : form.name),
      userPhone: addr.phone || form.phone || userProfile?.phone,
      estimatedDelivery: deliveryEstimate?.label || null,
    };

    // For a logged-in customer, the verify endpoints now derive user_id/
    // user_email from this token server-side (supabase.auth.getUser()) and
    // ignore whatever userId/userEmail this same request body claims --
    // previously those two fields were trusted from the body with no way to
    // confirm they actually belonged to whoever was making the request.
    // Guest checkout (no session) is unaffected; the body fields are still
    // what the server uses in that case, same as before.
    let authHeaders = {};
    if (currentUser) {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (token) authHeaders = { Authorization: `Bearer ${token}` };
    }

    // Every checkout -- paid, Cash on Delivery, or fully covered by a coupon/gift card -- starts by
    // asking the server what this cart actually costs. The client's own `total`
    // above is only ever used to render the page before this call; it is never
    // trusted for the charge or the order record. See api/razorpay-create-order.js.
    //
    // The order number itself is also assigned there now -- atomically, from a
    // database sequence -- rather than generated here. A client-invented ID
    // could never guarantee two concurrent checkouts land on different numbers;
    // the server can.
    let orderJson;
    try {
      const orderRes = await fetch('/api/razorpay-create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          items: orderItemsPayload(cart),
          couponCode: activeCoupon?.code || null, giftCardCode: appliedGiftCard?.code || null,
          checkoutAttemptKey, paymentMethod: method, ...orderWriteFields,
        }),
      });
      orderJson = await orderRes.json();
      if (!orderRes.ok) {
        // The server says this attempt's holds are already gone -- the next click is a new attempt.
        if (orderJson.expired) checkoutAttemptKeyRef.current = null;
        toast.error(orderJson.error || 'Could not start checkout. Please try again.');
        setLoading(false);
        placingRef.current = false;
        return;
      }
    } catch (err) {
      console.error(err);
      toast.error('Could not start checkout. Please check your connection and try again.');
      setLoading(false);
      placingRef.current = false;
      return;
    }
    const orderId = orderJson.receipt;

    const computed = {
      computedSubtotal: orderJson.computedSubtotal, computedShipping: orderJson.computedShipping, computedCodFee: orderJson.computedCodFee,
      computedDiscount: orderJson.computedDiscount, computedGiftCardApplied: orderJson.computedGiftCardApplied, computedTax: orderJson.computedTax,
      computedTotal: orderJson.computedTotal, couponCode: orderJson.couponCode, verifiedItems: orderJson.verifiedItems,
    };

    // Reservations now genuinely exist server-side -- both the stock
    // reservation (always, for any cart with real items) and the coupon
    // reservation (only if one was applied) -- tracked here (not just inside
    // releaseReservations()'s own closure below) so the pagehide
    // listener registered once for this whole component can see them too.
    outstandingReservationRef.current = checkoutAttemptKey;

    // The server dropped the coupon (first order only, usage limit, expired ...): say why.
    if (orderJson.couponNote) toast(orderJson.couponNote, { icon: 'ℹ️', duration: 6000 });

    // The page's own `total` was computed from what the browser had on hand and is
    // only ever a preview -- if it doesn't match what the server just verified (a
    // price changed, a coupon expired or hit its cap, a gift card's balance moved),
    // say so now rather than let the customer discover a different number inside the
    // Razorpay widget with no explanation.
    if (Math.abs(computed.computedTotal - total) >= 1) {
      toast(`Your total was updated to ${formatMoney(computed.computedTotal)} based on current pricing.`, { icon: 'ℹ️', duration: 5000 });
    }

    // If this checkout reserved a coupon use (see api/razorpay-create-order.js's
    // redeem_coupon_use call) but payment never actually completes -- the widget is
    // dismissed, the payment fails, or a free order's token can't be confirmed --
    // that reservation would otherwise sit there forever, having burned one of a
    // limited coupon's uses for a sale that never happened. Only called from
    // clear-cut "no money moved" paths below, never from an ambiguous one (e.g. a
    // failed signature check after the Razorpay handler already fired, where a
    // payment may or may not have actually gone through).
    async function releaseReservations() {
      // Cleared here too (not just after a successful verify) so the
      // pagehide listener never attempts a second release for a reservation
      // this function is already handling -- whichever path resolves the
      // reservation first (an existing failure branch here, or the
      // pagehide listener on tab close) is the only one that fires.
      outstandingReservationRef.current = null;
      checkoutAttemptKeyRef.current = null; // holds are being given back -- the next click is a new attempt
      // Routed through api/release-reservation.js -- see the pagehide
      // listener above for why this no longer calls Supabase's REST RPC
      // endpoints directly. One request releases stock and (if a coupon was
      // reserved) the coupon together; the endpoint attempts each
      // independently server-side, so one failing never prevents the other.
      try {
        const res = await fetch('/api/release-reservation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Coupon/gift-card/stock release is derived server-side from this attempt's own
          // reservation row -- the client never names a coupon code to release.
          body: JSON.stringify({ checkoutAttemptKey }),
        });
        if (!res.ok) console.error('Failed to release reservation:', res.status, orderId);
      } catch (err) {
        console.error('Failed to release reservation:', err, orderId);
      }
    }

    // ── NO RAZORPAY PAYMENT NEEDED: fully covered by coupon/gift card, or Cash on Delivery ──────
    // Razorpay (like every payment gateway) can't process a ₹0 charge -- the server
    // already confirmed the total is zero and issued a signed authorization instead
    // of a Razorpay order. Cash on Delivery takes the same road: the signed blob proves the
    // server priced the cart as COD, and verify-free-order turns it into an order.
    if (orderJson.free || orderJson.cod) {
      const mode = orderJson.cod ? 'cod' : 'free';
      setVerifyKind(mode);
      setVerifying(true);
      setVerifyDone(false);
      setVerifyingPaymentId(null);
      verifyInFlightRef.current = true; // ambiguous window starts -- see the ref's own declaration above
      try {
        const verifyRes = await fetch('/api/verify-free-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ receipt: orderId, blob: orderJson.blob, blobSig: orderJson.blobSig, ...orderWriteFields }),
        });
        const verifyJson = await verifyRes.json();
        if (!verifyJson.verified) {
          verifyInFlightRef.current = false; // clean, definitive failure -- no longer ambiguous
          setVerifying(false);
          await releaseReservations();
          toast.error(verifyJson.error || 'Could not confirm your order total. Please try again.');
          setLoading(false); placingRef.current = false;
          return;
        }
        verifyInFlightRef.current = false;
        outstandingReservationRef.current = null; // order succeeded -- must never be released after this
        checkoutAttemptKeyRef.current = null;
        setVerifyDone(true);
        await new Promise(r => setTimeout(r, 700)); // let the checkmark actually register before navigating away
        const ok = await finalizeOrder({ addr, billAddr, orderId, computed, mode, contactEmail });
        if (!ok) { setVerifying(false); setLoading(false); placingRef.current = false; }
      } catch (err) {
        // Deliberately NOT clearing verifyInFlightRef here -- a network
        // error on our end doesn't mean the server never processed the
        // request, same ambiguity the pre-existing code already avoided
        // releasing on (no releaseReservations() call in this catch
        // either, before this change).
        setVerifying(false);
        console.error(err);
        toast.error('Failed to place order. Please try again.');
        setLoading(false); placingRef.current = false;
      }
      return;
    }

    // ── ONLINE PAYMENT (Razorpay) ──────────────────────────────────────
    // No WhatsApp popup here -- the real payment widget is the whole point of this
    // path, and a paid order already shows up in Admin with its real payment ID.
    // The order is only ever written to Supabase AFTER the payment signature is
    // verified server-side (api/razorpay-verify-payment) -- never before.
    try {
      const scriptOk = await loadRazorpayScript();
      if (!scriptOk || !window.Razorpay) {
        await releaseReservations();
        toast.error('Could not load the payment gateway. Please check your connection and try again.');
        setLoading(false); placingRef.current = false;
        return;
      }

      const rzp = new window.Razorpay({
        key: orderJson.key_id,
        amount: orderJson.amount,
        currency: orderJson.currency,
        order_id: orderJson.id,
        name: brand.brand_name || COMPANY.name,
        description: `Order ${orderId}`,
        prefill: { name: addr.name, email: contactEmail, contact: addr.phone },
        theme: { color: '#0F766E' },
        handler: async function (response) {
          // Fires the instant Razorpay itself reports success -- the overlay
          // needs to appear right here, before the verify call even starts,
          // since this is exactly the moment a customer might otherwise think
          // nothing happened and close the tab.
          setVerifyKind('online');
          setVerifying(true);
          setVerifyDone(false);
          setVerifyingPaymentId(response.razorpay_payment_id);
          try { localStorage.setItem('tt_payment_inflight', JSON.stringify({ paymentId: response.razorpay_payment_id, ts: Date.now() })); } catch { /* best-effort */ }
          // Ambiguous window starts here, same as the free-order path -- but
          // note it's deliberately NEVER cleared on the failure branch just
          // below either (no change from the pre-existing behavior there):
          // a failed verify after Razorpay already reported success doesn't
          // mean no money moved, so this stays true and the pagehide
          // listener stays silent for the rest of this checkout attempt.
          verifyInFlightRef.current = true;
          try {
            const verifyRes = await fetch('/api/razorpay-verify-payment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...authHeaders },
              body: JSON.stringify({ ...response, blob: orderJson.blob, blobSig: orderJson.blobSig, ...orderWriteFields }),
            });
            const verifyJson = await verifyRes.json();
            if (!verifyJson.verified) {
              setVerifying(false);
              toast.error(verifyJson.error || ('Payment could not be verified. If money was deducted, please contact us with your payment ID: ' + response.razorpay_payment_id));
              setLoading(false); placingRef.current = false;
              return;
            }
            verifyInFlightRef.current = false;
            outstandingReservationRef.current = null; // order succeeded -- must never be released after this
            checkoutAttemptKeyRef.current = null;
            setVerifyDone(true);
            await new Promise(r => setTimeout(r, 700)); // let the checkmark actually register before navigating away
            const ok = await finalizeOrder({ addr, billAddr, orderId, computed, mode: 'online', contactEmail });
            if (!ok) { setVerifying(false); setLoading(false); placingRef.current = false; }
          } catch (err) {
            // Same reasoning as the free-order path's catch -- leave
            // verifyInFlightRef true, ambiguous, never released.
            setVerifying(false);
            console.error(err);
            toast.error('Payment succeeded but we could not save your order. Please contact us with your payment ID: ' + response.razorpay_payment_id);
            setLoading(false); placingRef.current = false;
          }
        },
        modal: {
          ondismiss: function () {
            releaseReservations();
            setLoading(false); placingRef.current = false;
          },
        },
      });
      rzp.on('payment.failed', function (response) {
        releaseReservations();
        toast.error(response.error?.description || 'Payment failed. Please try again.');
        setLoading(false); placingRef.current = false;
      });
      rzp.open();
    } catch (err) {
      console.error(err);
      await releaseReservations();
      toast.error('Failed to start payment. Please try again.');
      setLoading(false); placingRef.current = false;
    }
  }

  if (cart.length === 0) return completedRef.current ? null : <Navigate to="/cart" replace />;

  const itemCount = cart.reduce((s, i) => s + i.qty, 0);
  const steps = ['Cart', 'Address', 'Payment'];
  const currentStep = 2;
  const payNow = fullyCovered ? 'Place order' : method === 'cod' ? 'Place order' : `Pay ${formatMoney(total)}`;
  const payLabel = loading ? <span className="spinner" role="status" aria-label="Placing your order"></span> : payNow;
  const blocked = hasUnavailable;

  const rows = [
    { key: 'price', label: `Price (${itemCount} ${itemCount === 1 ? 'item' : 'items'})`, value: formatMoney(t.mrpTotal) },
    ...(t.productSavings > 0 ? [{ key: 'disc', label: 'Discount', value: `− ${formatMoney(t.productSavings)}`, tone: 'minus' }] : []),
    ...(t.discount > 0 ? [{ key: 'coupon', label: `Coupon (${activeCoupon?.code})`, value: `− ${formatMoney(t.discount)}`, tone: 'minus' }] : []),
    ...(digitalOnly ? [] : [{
      key: 'ship', label: 'Delivery',
      value: t.quote.free ? 'Free' : (t.quote.estimated ? shippingSummary({ shipping: t.quote, brand }) : formatMoney(t.shipping)),
      tone: t.quote.free ? 'free' : undefined,
      sub: !t.quote.free && t.quote.estimated ? 'Enter your PIN code for the exact charge' : undefined,
    }]),
    ...(method === 'cod' && t.codFee > 0 ? [{ key: 'cod', label: 'Cash on Delivery fee', value: formatMoney(t.codFee) }] : []),
    ...(t.giftCardApplied > 0 ? [{ key: 'gc', label: `Gift card (${appliedGiftCard?.code})`, value: `− ${formatMoney(t.giftCardApplied)}`, tone: 'minus' }] : []),
  ];
  const hint = !digitalOnly && !t.quote.free && t.quote.threshold > 0 && t.quote.away > 0
    ? { text: <>Add <strong>{formatMoney(t.quote.away)}</strong> more for free delivery — <Link to="/shop" style={{ color: 'inherit', textDecoration: 'underline' }}>keep shopping</Link></>, away: t.quote.away, threshold: t.quote.threshold }
    : null;

  const shownOffers = showAllOffers ? offers : offers.slice(0, 3);
  const overlayCopy = verifyKind === 'online'
    ? { title: verifyDone ? 'Order Confirmed' : 'Confirming Your Order', body: verifyDone ? 'Redirecting you to your order now…' : "Your payment went through — we're finalizing everything now. This usually takes just a few seconds." }
    : { title: verifyDone ? 'Order Placed' : 'Placing Your Order', body: verifyDone ? 'Redirecting you to your order now…' : "We're confirming your order. This usually takes just a few seconds." };

  return (
    <div className="co-page" style={{ paddingTop: 'var(--hdr-h)', minHeight: '80vh', background: 'var(--bg)' }}>
      {/* HEADER -- plain title row + 3-step tracker */}
      <div className="bl-pagehead co-head">
        <div className="bl-pagehead-inner">
          <div className="co-head-row">
            <h1 className="co-title">Checkout</h1>
            <ol className="co-steps" aria-label="Checkout progress">
              {steps.map((label, i) => {
                const n = i + 1;
                const state = n < currentStep ? 'done' : n === currentStep ? 'active' : '';
                return (
                  <li key={label} className={`co-step ${state}`} aria-current={n === currentStep ? 'step' : undefined}>
                    <span className="co-step-dot">
                      {n < currentStep ? (
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
                      ) : n}
                    </span>
                    <span className="co-step-label">{label}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>

      <div className="bl-wrap co-wrap">
        <div className="checkout-grid">
          <div className="co-main">
            {/* STOCK PROBLEM */}
            {blocked && (
              <div className="co-alert" role="alert">
                Some items in your cart are out of stock. <Link to="/cart">Go to your cart</Link> and remove them to continue.
              </div>
            )}

            {/* GUEST NOTICE */}
            {!currentUser && (
              <div className="co-guest">
                <svg {...ico} width="18" height="18" style={{ flexShrink: 0, color: 'var(--text-muted)' }}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                <div className="co-guest-text">Checking out as a guest. Have an account?</div>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => navigate('/login', { state: { from: { pathname: '/checkout' } } })}>Sign In</button>
              </div>
            )}

            {/* SHIPPING ADDRESS */}
            <section className="co-card" aria-labelledby="co-h-ship">
              <div className="co-card-head">
                <span className="co-num" aria-hidden="true">1</span>
                <h2 className="co-card-title" id="co-h-ship">{digitalOnly ? 'Billing address' : 'Delivery address'}</h2>
                <span className="co-req">*Required</span>
              </div>
              <div className="co-card-body">
                {hasSaved && (
                  <div style={{ marginBottom: usingSaved && !mobileLogin ? 0 : 16 }}>
                    <div className="co-seg">
                      <label className={usingSaved ? 'on' : ''}>
                        <input type="radio" name="addr-mode" checked={usingSaved} onChange={() => setAddrMode('saved')} /> Use saved
                      </label>
                      <label className={!usingSaved ? 'on' : ''}>
                        <input type="radio" name="addr-mode" checked={!usingSaved} onChange={() => setAddrMode('new')} /> New address
                      </label>
                    </div>
                    {usingSaved && (
                      <div className="co-addr-list" role="radiogroup" aria-label="Saved addresses">
                        {savedAddresses.map(addr => {
                          const on = selectedSaved?.id === addr.id;
                          return (
                            <div
                              key={addr.id}
                              role="radio"
                              aria-checked={on}
                              tabIndex={0}
                              className={`co-addr${on ? ' selected' : ''}`}
                              onClick={() => setSelectedAddrId(addr.id)}
                              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedAddrId(addr.id); } }}
                            >
                              <div className={`payment-radio${on ? ' checked' : ''}`}></div>
                              <div className="co-addr-text">
                                <div className="co-addr-name">
                                  <strong>{addr.name}</strong><span>{addr.phone}</span>
                                  {addr.isDefault && <span className="co-tag">Default</span>}
                                  {addr.type && <span className="co-tag">{addr.type}</span>}
                                </div>
                                <div>{[addr.line1, addr.line2].filter(Boolean).join(', ')}, {addr.city}, {addr.state}, {addr.pincode}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                {mobileLogin && usingSaved && (
                  <div style={{ marginTop: 6 }}>
                    <label className="form-label" htmlFor="ship-email">Email * (for your order confirmation)</label>
                    <input id="ship-email" className="form-input" type="email" value={form.email} onChange={e => patchForm({ email: e.target.value })} autoComplete="email" inputMode="email" style={errors.email ? { borderColor: 'var(--error)' } : undefined} aria-invalid={errors.email ? 'true' : undefined} />
                    {errors.email && <div className="form-error" role="alert">{errors.email}</div>}
                  </div>
                )}
                {!usingSaved && (
                  <>
                    <AddressForm value={form} onChange={patchForm} errors={errors} idPrefix="ship" fields={{ email: true }} />
                    {currentUser && (
                      <div className="co-check" style={{ marginTop: 14 }}>
                        <input type="checkbox" id="saveAddr" checked={saveAddr} onChange={e => setSaveAddr(e.target.checked)} />
                        <label htmlFor="saveAddr">Save this address for next time</label>
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>

            {/* BILLING ADDRESS */}
            <section className="co-card" aria-labelledby="co-h-bill">
              <div className="co-card-head">
                <span className="co-num" aria-hidden="true">2</span>
                <h2 className="co-card-title" id="co-h-bill">Billing address</h2>
              </div>
              <div className="co-card-body">
                <div className="co-check" style={{ marginBottom: billingSame ? 0 : 16 }}>
                  <input type="checkbox" id="billSame" checked={billingSame} onChange={e => setBillingSame(e.target.checked)} />
                  <label htmlFor="billSame">{digitalOnly ? 'Same as the address above' : 'Same as delivery address'}</label>
                </div>
                {!billingSame && (
                  <AddressForm value={billing} onChange={patchBilling} errors={billErrors} idPrefix="bill" fields={{ phone: 'optional' }} />
                )}
              </div>
            </section>

            {/* PAYMENT */}
            <section className="co-card" aria-labelledby="co-h-pay">
              <div className="co-card-head">
                <span className="co-num" aria-hidden="true">3</span>
                <h2 className="co-card-title" id="co-h-pay">Payment</h2>
              </div>
              <div className="co-card-body">
                {fullyCovered ? (
                  <div className="co-covered" role="status">
                    <svg {...ico} width="20" height="20"><path d="M20 6L9 17l-5-5" /></svg>
                    <div><strong>Nothing to pay</strong><span>Your coupon / gift card covers this whole order.</span></div>
                  </div>
                ) : (
                  <div className="co-methods" role="radiogroup" aria-label="Payment method">
                    <label className={`co-method${method === 'online' ? ' on' : ''}`}>
                      <input type="radio" name="pay-method" value="online" checked={method === 'online'} onChange={() => setPaymentMethod('online')} />
                      <span className={`payment-radio${method === 'online' ? ' checked' : ''}`} aria-hidden="true"></span>
                      <span className="co-pay-ico" aria-hidden="true">
                        <svg {...ico} width="20" height="20"><rect x="2" y="5" width="20" height="14" rx="3" /><path d="M2 10h20M6 15h4" /></svg>
                      </span>
                      <span>
                        <span className="co-pay-name">Pay online</span>
                        <span className="co-pay-sub">UPI, cards, net banking — secured by Razorpay</span>
                      </span>
                    </label>
                    {cod.visible && (
                      <label className={`co-method${method === 'cod' ? ' on' : ''}${cod.enabled ? '' : ' is-disabled'}`}>
                        <input type="radio" name="pay-method" value="cod" checked={method === 'cod'} disabled={!cod.enabled} onChange={() => setPaymentMethod('cod')} aria-describedby={cod.enabled ? undefined : 'cod-reason'} />
                        <span className={`payment-radio${method === 'cod' ? ' checked' : ''}`} aria-hidden="true"></span>
                        <span className="co-pay-ico" aria-hidden="true">
                          <svg {...ico} width="20" height="20"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></svg>
                        </span>
                        <span>
                          <span className="co-pay-name">Cash on Delivery{cod.enabled && cod.fee > 0 ? <em className="co-fee"> · ₹{cod.fee} fee</em> : null}</span>
                          <span className="co-pay-sub" id="cod-reason">{cod.enabled ? 'Pay when your order arrives' : cod.reason}</span>
                        </span>
                      </label>
                    )}
                  </div>
                )}
                <button type="button" className="btn btn-gold btn-full co-pay co-pay-desktop" data-testid="place-order" onClick={placeOrder} disabled={loading || blocked}>
                  {payLabel}
                </button>
                <div className="co-secure">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                  {fullyCovered ? 'No payment needed for this order' : method === 'cod' ? `Pay ${formatMoney(total)} when your order is delivered` : 'Secure payment via Razorpay'}
                </div>
              </div>
            </section>
          </div>

          {/* PRICE DETAILS */}
          <PriceSummary
            className="co-summary checkout-summary-sticky"
            title="Price details"
            headRight={<span className="co-sum-count">{itemCount} {itemCount === 1 ? 'item' : 'items'}</span>}
            rows={rows}
            total={{ label: fullyCovered ? 'Total payable' : method === 'cod' ? 'Amount payable on delivery' : 'Total payable', value: formatMoney(total) }}
            savings={t.totalSavings}
            hint={hint}
            footer={(
              <>
                {deliveryEstimate && (
                  <div className="co-delivery">
                    <svg {...ico} width="18" height="18" style={{ flexShrink: 0, color: 'var(--primary)' }}>
                      <path d="M1 3h15v13H1zM16 8h4l3 3v5h-7V8zM5.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM18.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
                    </svg>
                    <span>
                      Estimated delivery: <strong>{deliveryEstimate.daysLabel} ({deliveryEstimate.label})</strong>{shippingCity ? '' : ' (enter your city for an exact estimate)'}
                    </span>
                  </div>
                )}
                {digitalOnly && <div className="co-delivery"><span>Gift cards are delivered by email as soon as payment is confirmed.</span></div>}
                <ul className="co-trust">
                  <li><svg {...ico}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>Secure payment</li>
                  <li><svg {...ico}><path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z" /><circle cx="5.5" cy="18.5" r="2" /><circle cx="18.5" cy="18.5" r="2" /></svg>{shippingPromise(brand)}</li>
                </ul>
              </>
            )}
          >
            <div className="co-lines">
              {cart.map(item => (
                <div key={lineKey(item) || item.id} className="co-line">
                  <div className="co-line-img">
                    {item.image ? <img src={thumb(item.image, 120)} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="co-line-name">{item.name}</div>
                    {item.variantLabel && <div className="co-line-meta">{item.variantLabel}</div>}
                    {item.isGiftCard && (
                      <div className="co-line-meta">
                        Code issued after payment{item.recipientName ? ` — for ${item.recipientName}` : ''}
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 2 }}>
                      <span className="co-line-qty">Qty {item.qty}</span>
                      <span className="co-line-price">{formatMoney(item.price * item.qty)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="co-promo">
              <div className="co-promo-title">Coupon or gift card</div>
              {/* COUPON */}
              <div style={{ marginBottom: 10 }}>
                {appliedCoupon ? (
                  <>
                    <div className="co-applied">
                      <span>{appliedCoupon.code} applied</span>
                      <button type="button" onClick={removeCoupon}>Remove</button>
                    </div>
                    {couponIssue && <div className="co-offer-issue" role="alert">{couponIssue}</div>}
                  </>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      className="form-input co-code"
                      aria-label="Coupon code"
                      value={couponCode}
                      onChange={e => setCouponCode(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyCoupon(); } }}
                      placeholder="Coupon code"
                    />
                    <button type="button" onClick={() => applyCoupon()} disabled={applyingCoupon || !couponCode.trim()} className="btn btn-outline btn-sm co-apply" style={{ opacity: applyingCoupon || !couponCode.trim() ? 0.5 : 1 }}>
                      {applyingCoupon ? '...' : 'Apply'}
                    </button>
                  </div>
                )}
                {!appliedCoupon && shownOffers.length > 0 && (
                  <ul className="co-offers" aria-label="Available offers">
                    {shownOffers.map(c => {
                      const problem = couponProblem(cart, c);
                      return (
                        <li key={c.code} className={`co-offer${problem ? ' is-off' : ''}`}>
                          <div style={{ minWidth: 0 }}>
                            <span className="co-offer-code">{c.code}</span>
                            <div className="co-offer-text">{couponBlurb(c)}</div>
                            {problem && <div className="co-offer-issue">{problem}</div>}
                          </div>
                          <button type="button" className="btn btn-outline btn-sm" disabled={!!problem || applyingCoupon} onClick={() => applyCoupon(c.code, c)} aria-label={`Apply coupon ${c.code}`}>Apply</button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {!appliedCoupon && offers.length > 3 && (
                  <button type="button" className="co-more" onClick={() => setShowAllOffers(s => !s)}>{showAllOffers ? 'Show fewer offers' : `Show all ${offers.length} offers`}</button>
                )}
              </div>

              {/* GIFT CARD BALANCE */}
              <div>
                {appliedGiftCard ? (
                  <div className="co-applied">
                    <span>{appliedGiftCard.code} — {formatMoney(appliedGiftCard.balance)} available</span>
                    <button type="button" onClick={removeGiftCard}>Remove</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      className="form-input co-code"
                      aria-label="Gift card code"
                      value={giftCardCode}
                      onChange={e => setGiftCardCode(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyGiftCard(); } }}
                      placeholder="Gift card code"
                    />
                    <button type="button" onClick={applyGiftCard} disabled={applyingGiftCard || !giftCardCode.trim()} className="btn btn-outline btn-sm co-apply" style={{ opacity: applyingGiftCard || !giftCardCode.trim() ? 0.5 : 1 }}>
                      {applyingGiftCard ? '...' : 'Apply'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </PriceSummary>
        </div>
      </div>

      {/* Mobile sticky pay bar -- sits directly above the bottom tab bar */}
      <div className="co-bar">
        <div className="co-bar-total">
          <span>{method === 'cod' && !fullyCovered ? 'Pay on delivery' : 'Total'}</span>
          <strong>{formatMoney(total)}</strong>
        </div>
        <button type="button" className="btn btn-gold co-bar-btn" data-testid="place-order-mobile" onClick={placeOrder} disabled={loading || blocked}>
          {payLabel}
        </button>
      </div>

      {/* Full-screen "don't close this page" overlay -- see the `verifying`
          state comment above for why this exists. verifyDone swaps the
          spinner for a checkmark for a beat before finalizeOrder() navigates
          to /confirmation; the spinner's rotation is an inline style on that
          svg specifically (not a class-based descendant selector), so
          swapping to the checkmark svg below can never accidentally inherit
          it the way an earlier version of this did in preview. */}
      {verifying && (
        <div role="alertdialog" aria-modal="true" aria-label={overlayCopy.title} style={{ position: 'fixed', inset: 0, background: 'rgba(8,31,29,0.62)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 2100 }}>
          <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-lg)', maxWidth: 380, width: '100%', padding: '32px 28px 28px', textAlign: 'center' }}>
            {verifyDone ? (
              <div style={{ width: 56, height: 56, margin: '0 auto 18px', borderRadius: '50%', background: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
            ) : (
              <div style={{ width: 56, height: 56, margin: '0 auto 18px', position: 'relative' }}>
                <svg viewBox="0 0 60 60" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)', animation: 'checkout-spin 1.1s linear infinite' }}>
                  <circle cx="30" cy="30" r="24" fill="none" stroke="var(--primary-tint)" strokeWidth="4" />
                  <circle cx="30" cy="30" r="24" fill="none" stroke="var(--primary)" strokeWidth="4" strokeLinecap="round" strokeDasharray="150.8" strokeDashoffset="110" />
                </svg>
              </div>
            )}
            <div style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 500, color: 'var(--text)', marginBottom: 8 }}>
              {overlayCopy.title}
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-muted)', marginBottom: verifyDone ? 0 : 18 }}>
              {overlayCopy.body}
            </div>
            {!verifyDone && (
              <>
                <div style={{ fontWeight: 500, fontSize: 12.5, color: 'var(--sun-text)', background: 'var(--sun-tint)', border: '1px solid var(--sun)', borderRadius: 6, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 9, textAlign: 'left' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                  <span>Please don't close or refresh this page.</span>
                </div>
                {verifyingPaymentId && (
                  <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)' }}>
                    Payment ID: <span style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontWeight: 500, color: 'var(--text)' }}>{verifyingPaymentId}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes checkout-spin { to { transform: rotate(270deg); } }

        /* header: plain title row + 3-step tracker */
        .co-head .bl-pagehead-inner { padding-top: 12px; padding-bottom: 12px; }
        @media (min-width: 768px) { .co-head .bl-pagehead-inner { padding-top: 14px; padding-bottom: 14px; } }
        .co-head-row { display: flex; align-items: center; justify-content: space-between; gap: 10px 24px; flex-wrap: wrap; }
        .co-title { font-family: var(--font-head); font-size: 20px; line-height: 1.3; margin: 0; }
        .co-steps { display: flex; align-items: center; list-style: none; margin: 0; padding: 0; }
        .co-step { display: flex; align-items: center; gap: 6px; color: var(--text-muted); font-size: 12.5px; white-space: nowrap; }
        .co-step + .co-step::before { content: ''; display: block; width: 44px; height: 1px; background: #CDD6D4; margin: 0 4px 0 10px; }
        .co-step + .co-step.done::before, .co-step + .co-step.active::before { background: var(--primary); }
        .co-step-dot { width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 11.5px; font-weight: 500; background: #fff; border: 1px solid #B8C3C1; color: var(--text-muted); flex-shrink: 0; }
        .co-step.active, .co-step.done { color: var(--text); }
        .co-step.active { font-weight: 500; }
        .co-step.active .co-step-dot, .co-step.done .co-step-dot { background: var(--primary); border-color: var(--primary); color: #fff; }

        .co-wrap { padding-top: 12px; padding-bottom: 40px; }
        .checkout-grid { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 12px; align-items: start; }
        .co-main { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
        .co-alert { padding: 11px 16px; border: 1px solid #F3C2BD; background: #FDEBE9; color: var(--error); border-radius: 8px; font-size: 13.5px; font-weight: 500; }
        .co-alert a { color: inherit; text-decoration: underline; }

        /* numbered section cards: thin header strip + body */
        .co-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
        .co-card-head { display: flex; align-items: center; gap: 10px; padding: 11px 16px; background: #F7FAF9; border-bottom: 1px solid var(--border); }
        .co-num { width: 22px; height: 22px; border-radius: 50%; background: var(--primary); color: #fff; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .co-card-title { font-family: var(--font-head); font-size: 15px; font-weight: 500; color: var(--text); margin: 0; }
        .co-req { margin-left: auto; font-size: 12px; color: var(--error); }
        .co-card-body { padding: 16px; }
        .co-guest { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 16px; background: #fff; border: 1px solid var(--border); border-radius: 8px; }
        .co-guest-text { flex: 1; min-width: 160px; font-size: 13.5px; color: var(--text); }

        /* 40px boxed inputs */
        .co-card .form-input { height: 40px; padding: 0 12px; border: 1px solid #CDD6D4; border-radius: 6px; background: #fff; }
        .co-card select.form-input { padding-right: 8px; }
        .co-check { display: flex; align-items: center; gap: 10px; min-height: 32px; }
        .co-check input { width: 16px; height: 16px; accent-color: var(--primary); cursor: pointer; flex-shrink: 0; }
        .co-check label { flex: 1; display: flex; align-items: center; min-height: 32px; font-size: 14px; color: var(--text); cursor: pointer; }

        /* saved / new toggle */
        .co-seg { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
        .co-seg label { position: relative; display: inline-flex; align-items: center; justify-content: center; min-height: 38px; padding: 0 16px; border: 1px solid #CDD6D4; border-radius: 6px; background: #fff; font-size: 13.5px; font-weight: 500; color: var(--text); cursor: pointer; transition: border-color .12s, background .12s, color .12s; }
        .co-seg label.on { border-color: var(--primary); background: var(--primary-tint); color: var(--primary); }
        .co-seg input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; pointer-events: none; }
        .co-seg label:focus-within { outline: 2px solid var(--primary); outline-offset: 2px; }

        /* saved-address tiles */
        .co-addr-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); gap: 10px; }
        .co-addr { display: flex; align-items: flex-start; gap: 10px; border: 1px solid var(--border); border-radius: 6px; padding: 12px 14px; background: #fff; cursor: pointer; transition: border-color .12s, background .12s; }
        .co-addr:hover { border-color: var(--primary-border); }
        .co-addr.selected { border-color: var(--primary); background: var(--primary-tint); }
        .co-addr:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
        .co-addr .payment-radio { width: 18px; height: 18px; margin-top: 2px; }
        .co-addr.selected .payment-radio.checked { box-shadow: inset 0 0 0 3px var(--primary-tint); }
        .co-addr-text { font-size: 13.5px; color: var(--text); line-height: 1.55; min-width: 0; overflow-wrap: anywhere; }
        .co-addr-name { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 10px; margin-bottom: 2px; }
        .co-addr-name strong { font-size: 14px; font-weight: 500; color: var(--text); }
        .co-addr-name span { font-size: 13px; color: var(--text-muted); }
        .co-addr-name .co-tag { font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 4px; background: #EEF2F1; color: var(--text-muted); }

        /* payment method cards + pay button */
        .co-methods { display: flex; flex-direction: column; gap: 10px; }
        .co-method { position: relative; display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid var(--border); border-radius: 8px; background: #fff; cursor: pointer; transition: border-color .15s, background .15s; }
        .co-method:hover:not(.is-disabled) { border-color: var(--primary-border); }
        .co-method.on { border-color: var(--primary); background: var(--primary-tint); }
        .co-method.is-disabled { cursor: not-allowed; background: #F7F8F8; }
        .co-method.is-disabled .co-pay-name, .co-method.is-disabled .co-pay-ico { opacity: .55; }
        .co-method input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; pointer-events: none; }
        .co-method:focus-within { outline: 2px solid var(--primary); outline-offset: 2px; }
        .co-method > span { display: block; }
        .co-method .payment-radio { display: inline-block; }
        .co-pay-ico { width: 40px; height: 40px; border-radius: 6px; background: #fff; border: 1px solid var(--primary-border); color: var(--primary); display: flex !important; align-items: center; justify-content: center; flex-shrink: 0; }
        .co-pay-name { display: block; font-weight: 500; font-size: 14.5px; color: var(--text); }
        .co-fee { font-style: normal; font-weight: 400; color: var(--text-muted); }
        .co-pay-sub { display: block; font-size: 13px; color: var(--text-muted); line-height: 1.4; }
        .co-method.is-disabled .co-pay-sub { color: var(--warning); }
        .co-covered { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 8px; background: #E3F6EE; color: var(--success); }
        .co-covered strong { display: block; font-weight: 600; font-size: 14.5px; }
        .co-covered span { font-size: 13px; }
        .co-pay { margin-top: 16px; min-height: 46px; font-size: 15px; }
        .co-pay:disabled, .co-bar-btn:disabled { opacity: .55; cursor: not-allowed; }
        .co-pay .spinner, .co-bar-btn .spinner { width: 20px; height: 20px; border-width: 2px; border-color: rgba(255,255,255,.4); border-top-color: #fff; }
        .co-secure { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 12px; font-size: 12.5px; color: var(--text-muted); text-align: center; }

        /* price details card */
        .co-summary { overflow-x: hidden; overflow-y: auto; position: sticky; top: calc(var(--hdr-h) + 12px); max-height: calc(100vh - var(--hdr-h) - 24px); }
        .co-sum-count { font-size: 12.5px; font-weight: 400; color: var(--text-muted); }
        .co-lines { padding-bottom: 2px; margin-bottom: 14px; border-bottom: 1px solid var(--border); }
        .co-line { display: flex; gap: 10px; margin-bottom: 12px; }
        .co-line-img { width: 48px; height: 48px; border: 1px solid var(--border); border-radius: 4px; flex-shrink: 0; overflow: hidden; background: #EFF3F2; }
        .co-line-name { font-size: 13.5px; font-weight: 500; color: var(--text); line-height: 1.35; overflow-wrap: anywhere; }
        .co-line-meta { font-size: 12px; color: var(--text-muted); }
        .co-line-qty { font-size: 12.5px; color: var(--text-muted); }
        .co-line-price { font-size: 14px; font-weight: 600; color: var(--text); }
        .co-promo { margin: 0 0 14px; padding-bottom: 14px; border-bottom: 1px solid var(--border); }
        .co-promo-title { font-size: 13px; font-weight: 500; color: var(--text); margin-bottom: 8px; }
        .co-code { text-transform: uppercase; letter-spacing: .02em; flex: 1; min-width: 0; height: 38px; padding: 0 12px; font-size: 13.5px; border-radius: 6px; }
        .co-code::placeholder { text-transform: none; letter-spacing: 0; }
        .co-apply { min-height: 38px; flex-shrink: 0; }
        .co-applied { display: flex; justify-content: space-between; align-items: center; gap: 10px; background: var(--primary-tint); border: 1px solid var(--primary-border); border-radius: 6px; padding: 4px 6px 4px 12px; }
        .co-applied span { font-size: 13px; font-weight: 500; color: var(--primary-dark); overflow-wrap: anywhere; }
        .co-applied button { background: none; border: none; font-size: 12.5px; color: var(--text-muted); padding: 4px 8px; min-height: 30px; border-radius: 4px; cursor: pointer; }
        .co-applied button:hover { color: var(--error); }
        .co-offers { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
        .co-offer { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border: 1px dashed var(--primary-border); border-radius: 6px; background: #fff; }
        .co-offer.is-off { background: #F7F8F8; border-color: var(--border); }
        .co-offer-code { display: inline-block; font-weight: 600; font-size: 13px; letter-spacing: .02em; color: var(--primary); }
        .co-offer.is-off .co-offer-code { color: var(--text-muted); }
        .co-offer-text { font-size: 12.5px; color: var(--text-muted); line-height: 1.4; }
        .co-offer-issue { margin-top: 3px; font-size: 12px; color: var(--warning); line-height: 1.4; }
        .co-more { margin-top: 8px; padding: 4px 0; background: none; border: none; font-size: 12.5px; font-weight: 600; color: var(--primary); cursor: pointer; }
        .co-delivery { margin-top: 14px; padding: 10px 12px; background: var(--primary-tint); border-radius: 6px; display: flex; align-items: flex-start; gap: 10px; font-size: 13px; color: var(--text-muted); line-height: 1.5; }
        .co-delivery strong { font-weight: 500; color: var(--text); }
        .co-trust { list-style: none; margin: 14px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 16px; }
        .co-trust li { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted); }
        .co-trust svg { color: var(--primary); flex-shrink: 0; }

        .co-bar { display: none; }

        @media (max-width: 899px) {
          .co-page { padding-bottom: 68px; }
          .checkout-grid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
          /* Sticky only makes sense beside the form in the two-column desktop layout. */
          .checkout-summary-sticky { position: static; max-height: none; overflow: hidden; }
          .co-pay-desktop { display: none !important; }
          .co-bar {
            display: flex; align-items: center; justify-content: space-between; gap: 12px;
            position: fixed; left: 0; right: 0; z-index: 90;
            bottom: calc(var(--bottom-nav-h) + env(safe-area-inset-bottom, 0px));
            background: #fff; border-top: 1px solid var(--border);
            padding: 8px 14px;
          }
          .co-bar-total { display: flex; flex-direction: column; line-height: 1.2; }
          .co-bar-total span { font-size: 12px; color: var(--text-muted); }
          .co-bar-total strong { font-size: 18px; font-weight: 600; color: var(--text); }
          .co-bar-btn { flex: 1; max-width: 260px; min-height: 44px; font-size: 15px; }
        }
        @media (max-width: 640px) {
          .co-card-head { padding: 10px 12px; }
          .co-card-body { padding: 14px 12px; }
          .co-guest { padding: 10px 12px; }
        }
        @media (max-width: 520px) {
          .co-steps { width: 100%; justify-content: space-between; }
          .co-step { font-size: 12px; }
          .co-step + .co-step { flex: 1; }
          .co-step + .co-step::before { width: auto; flex: 1; min-width: 10px; margin: 0 2px 0 8px; }
          .co-seg label { flex: 1; padding: 0 10px; }
        }
      `}</style>
    </div>
  );
}
