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

// Which cart lines a coupon applies to. Cart/order lines carry `id` (product id) and `categoryIds`
// (their category plus every ancestor, so a coupon on "Fashion" also covers "Men").
function couponLines(cart, coupon) {
  const lines = cart.filter(i => !i.isGiftCard);
  if (coupon.applies_to === 'products' || coupon.applies_to === 'bundle') {
    return lines.filter(i => (coupon.product_ids || []).includes(i.id));
  }
  if (coupon.applies_to === 'categories') {
    const ids = coupon.category_ids || [];
    return lines.filter(i => (i.categoryIds || []).some(c => ids.includes(c)));
  }
  return lines;
}

// A coupon's own eligibility rule -- whether it applies at all to what's in this cart -- shared by
// Checkout.jsx (the "Apply" button's messages) and api/razorpay-create-order.js (the real, charged
// source of truth). Returns the coupon if it is eligible, else null.
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
  if (coupon.applies_to === 'categories') {
    return couponLines(cart, coupon).length > 0 ? coupon : null;
  }
  return merchandiseSubtotalOf(cart) > 0 ? coupon : null;
}

// Why a coupon cannot be used right now, in words the customer can act on -- or null when it can.
// ctx carries what only the server knows: userOrderCount (their previous orders) and
// userUses (times THEY have used this code). Omitted on the client, so those two rules are enforced
// at checkout and reported back by the server.
export function couponProblem(cart, coupon, { now = new Date(), userOrderCount = null, userUses = null } = {}) {
  if (!coupon || coupon.active === false) return 'Invalid or expired coupon code.';
  if (coupon.starts_at && new Date(coupon.starts_at) > now) return 'This coupon is not active yet.';
  if (coupon.expires_at && new Date(coupon.expires_at) < now) return 'This coupon has expired.';
  const maxUses = Number(coupon.max_uses);
  if (Number.isFinite(maxUses) && maxUses > 0 && Number(coupon.times_used || 0) >= maxUses) return 'This coupon has reached its usage limit.';
  if (!couponEligibleFor(cart, coupon)) {
    if (coupon.applies_to === 'bundle') return `This coupon needs all ${(coupon.product_ids || []).length} bundle items in your cart.`;
    if (coupon.applies_to === 'categories') return "This coupon doesn't apply to the categories in your cart.";
    return "This coupon doesn't apply to the items in your cart.";
  }
  const minOrder = Number(coupon.min_order_value) || 0;
  const subtotal = merchandiseSubtotalOf(cart);
  if (minOrder > 0 && subtotal < minOrder) return `Add items worth ₹${Math.ceil(minOrder - subtotal)} more to use this coupon.`;
  if (coupon.first_order_only && userOrderCount !== null && userOrderCount > 0) return 'This coupon is only for your first order.';
  const perUser = Number(coupon.per_user_limit);
  if (Number.isFinite(perUser) && perUser > 0 && userUses !== null && userUses >= perUser) return 'You have already used this coupon the maximum number of times.';
  return null;
}

// A coupon scoped to specific products / a bundle / categories only discounts those lines' share of
// the cart. An unscoped ("all") coupon covers every merchandise line but never a gift card.
export function couponBaseOf(cart, coupon) {
  if (!coupon) return 0;
  return couponLines(cart, coupon).reduce((s, i) => s + (Number(i.price) || 0) * i.qty, 0);
}

// Percent discounts are capped at 100% here, in the one place both client and server call through --
// a coupon accidentally saved as e.g. 150% off can never discount more than its base, and an optional
// max_discount caps a percent coupon in rupees ("20% off up to ₹300").
export function couponDiscountOf(cart, coupon) {
  if (!coupon) return 0;
  const base = couponBaseOf(cart, coupon);
  if (base <= 0) return 0;
  let raw = coupon.type === 'percent'
    ? Math.round(base * (Math.min(Number(coupon.value) || 0, 100) / 100))
    : Math.min(Number(coupon.value) || 0, base);
  const cap = Number(coupon.max_discount);
  if (coupon.type === 'percent' && Number.isFinite(cap) && cap > 0) raw = Math.min(raw, cap);
  return Math.max(0, Math.min(raw, base));
}

// Splits an order's coupon discount over the lines it actually applied to, in proportion to each line's
// value (the last line absorbs the rounding). Keyed by variantId; stored on every order line as
// `lineDiscount` so a later return refunds exactly what was paid for that line -- a coupon on one item
// must not reduce the refund of another, nor leave the scoped item over-refunded.
export function couponLineDiscounts(cart, coupon, discount) {
  const out = {};
  const total = Number(discount) || 0;
  if (!coupon || !(total > 0)) return out;
  const lines = couponLines(cart, coupon);
  const base = lines.reduce((s, i) => s + (Number(i.price) || 0) * i.qty, 0);
  if (base <= 0) return out;
  let allocated = 0;
  lines.forEach((line, idx) => {
    const value = (Number(line.price) || 0) * line.qty;
    const share = idx === lines.length - 1
      ? Math.round((total - allocated) * 100) / 100
      : Math.round((total * value / base) * 100) / 100;
    allocated += share;
    out[line.variantId] = (out[line.variantId] || 0) + share;
  });
  return out;
}

// How much of the gift card's balance this order consumes: never more than the
// merchandise (plus shipping) still owed after the coupon, and never any of it
// towards buying another gift card.
export function giftCardAppliedOf(giftCard, cart, shipping, discount) {
  if (!giftCard) return 0;
  const redeemable = Math.max(merchandiseSubtotalOf(cart) + shipping - discount, 0);
  return Math.min(Number(giftCard.balance) || 0, redeemable);
}
