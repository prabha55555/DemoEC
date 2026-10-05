// Shared, pure discount/total math used by both the client (Checkout.jsx, for display)
// and the server (api/razorpay-create-order.js, as the source of truth for what's
// actually charged) -- importing the same functions from both places guarantees the
// two can never drift apart.

// The gift-card minimum used whenever an admin hasn't set their own giftcard_min in
// Brand Settings -- was previously copy-pasted independently in BrandContext,
// GiftCard.jsx, Admin.jsx, and api/razorpay-create-order.js, risking one of the four
// getting updated and the rest silently left behind.
export const DEFAULT_GIFTCARD_MIN = 1000;

// giftcard_max is optional -- an admin can leave it unset for no upper limit at all.
// Shared by the client (GiftCard.jsx) and server (api/razorpay-create-order.js) so
// "unset" resolves to the same Infinity in both places rather than drifting.
export function giftcardMaxOf(giftcardMax) {
  const v = Number(giftcardMax);
  return Number.isFinite(v) && v > 0 ? v : Infinity;
}

export function cartSubtotalOf(cart) {
  return cart.reduce((s, i) => s + (Number(i.price) || 0) * i.qty, 0);
}

// Gift-card purchase lines are stored value, not merchandise: a coupon never
// discounts them, and a redeemed gift card's balance never pays for them --
// otherwise a percentage coupon turns into cash (buy a 100%-face-value card for
// less than 100%), and a gift card could effectively buy another gift card.
function merchandiseSubtotalOf(cart) {
  return cart.filter(i => !i.isGiftCard).reduce((s, i) => s + (Number(i.price) || 0) * i.qty, 0);
}

// A coupon's own eligibility rule -- whether it applies at all to what's in this
// cart -- used to live duplicated in both Checkout.jsx (for the "Apply" button's
// error messages) and api/razorpay-create-order.js (as the real, charged source of
// truth), and had already started to drift: only the client surfaced a
// bundle-specific error message. Returns the coupon if it's eligible, else null.
export function couponEligibleFor(cart, coupon) {
  if (!coupon) return null;
  const cartProductIds = cart.filter(i => !i.isGiftCard).map(i => i.id);
  if (coupon.applies_to === 'products') {
    return (coupon.product_ids || []).some(id => cartProductIds.includes(id)) ? coupon : null;
  }
  if (coupon.applies_to === 'bundle') {
    const need = coupon.product_ids || [];
    return need.length && need.every(id => cartProductIds.includes(id)) ? coupon : null;
  }
  return merchandiseSubtotalOf(cart) > 0 ? coupon : null;
}

// A coupon scoped to specific products/a bundle should only discount those items'
// share of the cart, not the whole subtotal (which may include unrelated items).
// An unscoped ("all") coupon covers every merchandise line but never a gift card.
export function couponBaseOf(cart, coupon) {
  if (!coupon) return 0;
  if (coupon.applies_to === 'products' || coupon.applies_to === 'bundle') {
    return cart
      .filter(i => !i.isGiftCard && (coupon.product_ids || []).includes(i.id))
      .reduce((s, i) => s + (Number(i.price) || 0) * i.qty, 0);
  }
  return merchandiseSubtotalOf(cart);
}

// Percent discounts are capped at 100% here, in the one place both client and server
// call through -- a coupon accidentally saved as e.g. 150% off can never produce a
// discount larger than the base it's applied to, no matter what's stored in the DB.
export function couponDiscountOf(cart, coupon) {
  if (!coupon) return 0;
  const base = couponBaseOf(cart, coupon);
  if (base <= 0) return 0;
  const raw = coupon.type === 'percent'
    ? Math.round(base * (Math.min(Number(coupon.value) || 0, 100) / 100))
    : Math.min(Number(coupon.value) || 0, base);
  return Math.max(0, Math.min(raw, base));
}

// How much of the gift card's balance this order consumes: never more than the
// merchandise (plus shipping) still owed after the coupon, and never any of it
// towards buying another gift card.
export function giftCardAppliedOf(giftCard, cart, shipping, discount) {
  if (!giftCard) return 0;
  const redeemable = Math.max(merchandiseSubtotalOf(cart) + shipping - discount, 0);
  return Math.min(Number(giftCard.balance) || 0, redeemable);
}
