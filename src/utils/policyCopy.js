// Wording for the policy pages and the Help Centre that depends on the store settings (Admin -> Settings), so the
// Shipping Policy, Returns Policy, Terms and FAQ always quote the same fees and windows the checkout charges.
// Builds on storeCopy.js (shippingPromise, returnWindowDays) and never contradicts it. Pure.
import { shippingPromise, returnWindowDays } from './storeCopy';

const money = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

export function metroCities(brand) {
  return String(brand?.delivery_metro_cities || '').split(',').map(c => c.trim()).filter(Boolean);
}

// What delivery costs, in a sentence or two. Matches shipping.js: free over the threshold (judged before coupons),
// otherwise a flat fee that depends on whether the address is in a metro city.
export function deliveryFeeText(brand) {
  const threshold = num(brand?.free_shipping_threshold);
  const metro = Math.max(0, num(brand?.shipping_fee_metro));
  const other = Math.max(0, num(brand?.shipping_fee_other));
  if (metro <= 0 && other <= 0) return 'Delivery is free on every order.';
  let fee;
  if (metro > 0 && other > 0) {
    fee = metro === other ? `a delivery fee of ${money(metro)} applies` : `a delivery fee of ${money(metro)} applies to metro cities and ${money(other)} to the rest of India`;
  } else if (metro > 0) fee = `a delivery fee of ${money(metro)} applies to metro cities (delivery elsewhere in India is free)`;
  else fee = `a delivery fee of ${money(other)} applies outside the metro cities (delivery to metro cities is free)`;
  if (threshold > 0) {
    return `${shippingPromise(brand)}, judged on the value of your cart before any coupon is applied. Below that, ${fee}.`;
  }
  return `${fee.charAt(0).toUpperCase()}${fee.slice(1)}.`;
}

// Cash on Delivery, or null when the store does not offer it.
export function codText(brand) {
  if (!brand?.cod_enabled) return null;
  const fee = Math.max(0, num(brand.cod_fee));
  const max = num(brand.cod_max_order);
  return [
    'Cash on Delivery is available on eligible orders',
    max > 0 ? ` up to ${money(max)}` : '',
    fee > 0 ? `, with a COD handling fee of ${money(fee)}` : ' at no extra charge',
    '. Pay the delivery partner in cash or by UPI when your order arrives.',
  ].join('');
}

export function returnWindowText(brand) {
  const days = returnWindowDays(null, brand);
  return days > 0 ? `${days} days` : null;
}

export const supportEmail = (brand, fallback) => brand?.support_email || fallback;
export const supportPhone = (brand, fallback) => brand?.support_phone || fallback;
