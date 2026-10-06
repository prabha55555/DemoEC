// Shipping fee rules -- ONE implementation, used by the cart/checkout (display) and by
// api/razorpay-create-order.js (the amount actually charged). Pure.
//
// The old model hid a per-product surcharge inside each unit price and claimed "free delivery".
// Now shipping is its own, visible line:
//
//   * nothing physical in the cart (gift cards only)        -> free
//   * every physical line is flagged free_shipping           -> free
//   * cart value (before coupons) >= free_shipping_threshold  -> free   (threshold 0 = no threshold)
//   * otherwise a flat fee: shipping_fee_metro for the metro-city list, shipping_fee_other elsewhere
//   * Cash on Delivery adds cod_fee on top
//
// Setting both fees to 0 gives "free delivery on every order".
import { isMetroCity } from './delivery.js';

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

export function freeShippingThreshold(brand) {
  const t = num(brand?.free_shipping_threshold, 0);
  return t > 0 ? t : 0;
}

// The threshold is judged on the cart value BEFORE any coupon: "free delivery over ₹499" must mean
// what the shopper sees in their cart, and applying a coupon must never make a delivery charge appear.
//
// cart lines: { price, qty, isGiftCard, freeShipping }.  address: { city, state } (may be empty
// on the cart page, before an address exists -- then the metro fee, the lower one, is assumed and
// `estimated` is true so the UI can say "calculated at checkout").
export function shippingFor({ cart, address, brand, paymentMethod = 'online' }) {
  const physical = (cart || []).filter(i => !i.isGiftCard);
  const codFee = paymentMethod === 'cod' ? Math.max(0, num(brand?.cod_fee, 0)) : 0;

  if (physical.length === 0) return { fee: 0, codFee: 0, free: true, reason: 'digital', estimated: false, threshold: 0, away: 0 };

  const threshold = freeShippingThreshold(brand);
  const subtotal = physical.reduce((s, i) => s + num(i.price) * num(i.qty), 0);

  if (physical.every(i => i.freeShipping)) return { fee: 0, codFee, free: true, reason: 'free_items', estimated: false, threshold, away: 0 };
  if (threshold > 0 && subtotal >= threshold) return { fee: 0, codFee, free: true, reason: 'threshold', estimated: false, threshold, away: 0 };

  const known = !!(address && String(address.city || '').trim());
  const metro = known ? isMetroCity(address.city, brand) : true;
  const fee = Math.max(0, metro ? num(brand?.shipping_fee_metro, 0) : num(brand?.shipping_fee_other, 0));
  return {
    fee,
    codFee,
    free: fee === 0,
    reason: fee === 0 ? 'no_fee' : 'flat',
    estimated: !known,
    threshold,
    away: threshold > 0 ? Math.max(0, Math.ceil(threshold - subtotal)) : 0, // "add ₹X more for free delivery"
  };
}

// The line shown in the price summary: 'Free', '₹40', or '₹40 - ₹60' while the address is unknown.
export function shippingSummary({ shipping, brand }) {
  if (!shipping) return '';
  if (shipping.free) return 'Free';
  if (shipping.estimated) {
    const lo = Math.max(0, num(brand?.shipping_fee_metro, 0));
    const hi = Math.max(0, num(brand?.shipping_fee_other, 0));
    if (hi > lo) return `₹${lo} - ₹${hi}`;
  }
  return `₹${shipping.fee}`;
}
