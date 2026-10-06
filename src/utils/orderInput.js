// SERVER-ONLY. Shape and length limits for the customer-supplied (non-price) fields
// that end up stored on pending orders and orders: address, contact details and the
// cart's descriptive metadata. Prices, quantities and totals never come from here --
// those are always recomputed server-side.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function sanitizeAddress(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  return {
    name: text(a.name, 100),
    phone: text(a.phone, 20),
    line1: text(a.line1, 200),
    line2: text(a.line2, 200),
    city: text(a.city, 80),
    state: text(a.state, 60),
    pincode: text(a.pincode, 10),
  };
}

export function sanitizeEmail(raw) {
  const email = text(raw, 254);
  return EMAIL.test(email) ? email : '';
}

// Keeps only the cart keys the order writer reads back (matching key, display name and
// gift-card recipient details) and bounds each of them. `id` and `variantId` are only
// type-coerced and length-capped, never re-spaced: they are matching keys and must stay
// byte-identical to what the pricing pass saw for the same line.
export function sanitizeCart(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 50).filter(i => i && typeof i === 'object').map(i => ({
    id: String(i.id ?? '').slice(0, 80),
    variantId: i.variantId ? String(i.variantId).slice(0, 80) : null,
    isGiftCard: !!i.isGiftCard,
    name: text(i.name, 200),
    recipientName: text(i.recipientName, 100),
    recipientEmail: sanitizeEmail(i.recipientEmail),
    giftMessage: typeof i.giftMessage === 'string' ? i.giftMessage.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 500) : '',
  }));
}

// True when `addr` is for the delivery zone the checkout was priced for (computed.shipTo, signed into the
// blob). Without this a customer could price delivery to a nearby city and ship to a far one. A blob from
// before shipTo existed has none and passes.
export function shipToMatches(shipTo, addr) {
  if (!shipTo) return true;
  const n = (v) => String(v || '').trim().toLowerCase();
  return n(addr?.city) === n(shipTo.city) && n(addr?.state) === n(shipTo.state)
    && String(addr?.pincode || '').trim() === String(shipTo.pincode || '').trim();
}

// One call for the whole set of order-write fields a checkout request carries.
export function sanitizeOrderFields(body) {
  const b = body || {};
  return {
    cart: sanitizeCart(b.cart),
    addr: sanitizeAddress(b.addr),
    billAddr: b.billAddr ? sanitizeAddress(b.billAddr) : null,
    userName: text(b.userName, 100) || null,
    userEmail: sanitizeEmail(b.userEmail) || null,
    userPhone: text(b.userPhone, 20) || null,
    estimatedDelivery: text(b.estimatedDelivery, 120) || null,
  };
}
