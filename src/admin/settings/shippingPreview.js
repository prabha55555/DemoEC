// What shoppers will see for a set of shipping settings -- computed with the SAME functions the storefront and the
// checkout server use (shippingPromise / shippingFor), so the preview cannot disagree with reality.
import { shippingFor } from '../../utils/shipping';
import { shippingPromise } from '../../utils/storeCopy';

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) && v !== '' ? n : d; };

// The brand-shaped object built from the form's (string) values.
export function draftBrand(values, brand = {}) {
  return {
    ...brand,
    free_shipping_threshold: num(values.free_shipping_threshold),
    shipping_fee_metro: num(values.shipping_fee_metro),
    shipping_fee_other: num(values.shipping_fee_other),
    delivery_metro_cities: values.delivery_metro_cities || '',
    delivery_extra_days: num(values.delivery_extra_days),
  };
}

const roundTo = (n, step) => Math.max(step, Math.round(n / step) * step);

// Worked examples: a basket below the free-delivery level to a metro city and to another city, and one above it.
// ("₹300 cart to Chennai → ₹40; ₹600 cart → Free" at the default settings.)
export function shippingExamples(brandLike) {
  const threshold = num(brandLike.free_shipping_threshold);
  const metroCity = String(brandLike.delivery_metro_cities || '').split(',').map(c => c.trim()).filter(Boolean)[0] || 'Chennai';
  const low = threshold > 0 ? roundTo(threshold * 0.6, 50) : 300;
  const high = threshold > 0 ? roundTo(threshold * 1.2, 50) : 600;
  const feeFor = (value, city) => {
    const r = shippingFor({ cart: [{ price: value, qty: 1 }], address: { city }, brand: brandLike });
    return r.free ? 'Free' : `₹${r.fee}`;
  };
  const rows = [
    { cart: low, city: metroCity, text: `₹${low} cart to ${metroCity}`, result: feeFor(low, metroCity) },
    { cart: low, city: 'a smaller town', text: `₹${low} cart to a smaller town`, result: feeFor(low, 'Smallville') },
    { cart: high, city: metroCity, text: `₹${high} cart to ${metroCity}`, result: feeFor(high, metroCity) },
  ];
  return { promise: shippingPromise(brandLike), rows };
}
