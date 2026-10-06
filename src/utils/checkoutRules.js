// Checkout / cart number crunching shared by the Cart page, the Checkout page and their tests.
// DISPLAY only: api/razorpay-create-order.js re-prices everything from the database and its numbers
// are the ones that are charged. Pure.
import { shippingFor } from './shipping';
import { cartSubtotalOf, couponDiscountOf, giftCardAppliedOf } from './pricing';
import { codAvailable } from './storeCopy';

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Price at MRP for a set of lines (a line without a higher MRP counts at its selling price).
export const mrpTotalOf = (cart) => (cart || []).reduce((s, i) => s + (num(i.mrp) > num(i.price) ? num(i.mrp) : num(i.price)) * num(i.qty), 0);

// Everything the price card shows for one payment method.
export function checkoutTotals({ cart, brand, address = null, paymentMethod = 'online', coupon = null, giftCard = null }) {
  const lines = cart || [];
  const quote = shippingFor({ cart: lines, address, brand, paymentMethod });
  const subtotal = cartSubtotalOf(lines);
  const mrpTotal = mrpTotalOf(lines);
  const discount = couponDiscountOf(lines, coupon);
  const giftCardApplied = giftCardAppliedOf(giftCard, lines, quote.fee + quote.codFee, discount);
  const total = Math.max(0, round2(subtotal + quote.fee + quote.codFee - discount - giftCardApplied));
  return {
    quote, subtotal, mrpTotal,
    productSavings: Math.max(0, round2(mrpTotal - subtotal)),
    shipping: quote.fee, codFee: quote.codFee,
    discount, giftCardApplied, total,
    totalSavings: Math.max(0, round2(mrpTotal - subtotal)) + discount,
  };
}

// The Cash on Delivery card at checkout.
//   visible  -> render the option at all (the store switched COD on)
//   enabled  -> the shopper can pick it for THIS cart
//   reason   -> why it is disabled (shown under the card)
//   fee      -> the COD fee that would be added
// `totalWithCod` is the payable amount INCLUDING the COD fee: the server checks cod_max_order against it.
export function codOption({ brand, cart, totalWithCod }) {
  const lines = cart || [];
  if (!brand?.cod_enabled) return { visible: false, enabled: false, reason: '', fee: 0 };
  const fee = Math.max(0, num(brand.cod_fee, 0));
  if (lines.some(i => i.isGiftCard)) return { visible: true, enabled: false, reason: "Cash on Delivery isn't available for gift cards.", fee };
  if (!codAvailable(brand, lines)) return { visible: true, enabled: false, reason: "Cash on Delivery isn't available for one of the items in your cart.", fee };
  const max = num(brand.cod_max_order, 0);
  if (max > 0 && num(totalWithCod) > max) {
    return { visible: true, enabled: false, reason: `Cash on Delivery isn't available for orders above ₹${max.toLocaleString('en-IN')}.`, fee };
  }
  return { visible: true, enabled: true, reason: '', fee };
}

// The request body `items` for /api/razorpay-create-order. Prices are sent for the server to ignore.
export const orderItemsPayload = (cart) => (cart || []).map(i => ({
  id: i.id, variantId: i.variantId || null, qty: i.qty, isGiftCard: !!i.isGiftCard, price: i.price,
}));

// The descriptive part of each line the server stores / reads back (it re-sanitises all of this).
export const orderCartPayload = (cart) => (cart || []).map(i => ({
  id: i.id, variantId: i.variantId || null, name: i.name, isGiftCard: !!i.isGiftCard,
  ...(i.isGiftCard ? { recipientName: i.recipientName, recipientEmail: i.recipientEmail, giftMessage: i.giftMessage } : {}),
}));
