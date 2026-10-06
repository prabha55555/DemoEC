// Customer-facing wording that depends on the store's own settings (Admin -> Settings), so no screen
// hardcodes a shipping or returns promise the store may not keep. Pure -- takes the `brand` settings row.

const money = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

// "Free delivery on orders above ₹499" / "Free delivery on every order" / "Delivery from ₹40"
export function shippingPromise(brand) {
  const threshold = num(brand?.free_shipping_threshold, 0);
  const metro = num(brand?.shipping_fee_metro, 0);
  const other = num(brand?.shipping_fee_other, 0);
  if (metro <= 0 && other <= 0) return 'Free delivery on every order';
  if (threshold > 0) return `Free delivery on orders above ${money(threshold)}`;
  return `Delivery from ${money(Math.min(...[metro, other].filter(x => x > 0)))}`;
}

// Days a product can be returned after delivery: the product's own setting, else the store's. 0 = none.
export function returnWindowDays(product, brand) {
  const own = product?.return_window_days;
  if (own !== null && own !== undefined && own !== '') return Math.max(0, num(own, 0));
  return Math.max(0, num(brand?.return_window_days, 7));
}

// "7-day returns" / "Non-returnable"
export function returnPolicyShort(product, brand) {
  const d = returnWindowDays(product, brand);
  return d > 0 ? `${d}-day returns` : 'Non-returnable';
}

// Whether Cash on Delivery is offered for a set of products / cart lines (every one must allow it,
// and none may be a gift card).
export function codAvailable(brand, products = []) {
  return !!brand?.cod_enabled && products.every(p => p?.cod_allowed !== false && p?.codAllowed !== false && !p?.isGiftCard);
}
