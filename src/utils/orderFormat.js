// Small pure helpers the account / order / confirmation / invoice screens share: dates, order-line
// fallbacks for pre-v2 orders, address text, masked phone numbers. No React, no network.
import { PAYMENT_STATUS_LABELS, normalizeStatus } from './orderStatus';
import { paymentMethodText } from './emailVariables';

const dateOf = (d) => { const x = d ? new Date(d) : null; return x && !isNaN(x.getTime()) ? x : null; };

export const fmtDate = (d) => { const x = dateOf(d); return x ? x.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; };
export const fmtDateShort = (d) => { const x = dateOf(d); return x ? x.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''; };
export const fmtDateTime = (d) => {
  const x = dateOf(d);
  return x ? x.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '';
};

// orders.estimated_delivery is either a YYYY-MM-DD date or a ready-made label ("20 Aug - 25 Aug").
export const formatDeliveryLabel = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? fmtDate(s) : (s || ''));

export const orderItemsOf = (order) => (Array.isArray(order?.items) ? order.items : []);

// Older orders carried `size` instead of `variantLabel` and often had no image.
export const lineVariantLabel = (item) => {
  const v = item?.variantLabel || item?.size || '';
  return v && v !== 'Default' ? v : '';
};

// Every line is a gift card -> nothing ships (the code is emailed).
export const isDigitalOrder = (order) => {
  const items = orderItemsOf(order);
  return items.length > 0 && items.every(i => i.isGiftCard);
};

// An order that bought a gift card cannot be cancelled by the customer (the server refuses: GIFT_CARD_ORDER).
export const hasGiftCardItem = (order) => orderItemsOf(order).some(i => i.isGiftCard);
export const GIFT_CARD_CANCEL_NOTE = "Orders with a gift card can't be cancelled — contact support.";

export const hasPhysicalItems = (order) => orderItemsOf(order).some(i => !i.isGiftCard);

// Stable per-line key that works for new (variantId) and old (id + size) orders.
export const orderLineKey = (item, index = 0) => item?.variantId || (item?.id ? `${item.id}::${item.size || ''}` : `line-${index}`);

export const paymentStatusLabel = (order) => PAYMENT_STATUS_LABELS[order?.payment_status] || (order?.payment_id ? 'Paid' : '');
export const paymentMethodLabel = (order) => paymentMethodText(order) || '';

// "Paid online" / "Pay ₹X on delivery" wording lives with the callers (they know the amount);
// this only answers which of the three modes an order is in.
export const paymentModeOf = (order) => {
  const m = order?.payment_method;
  if (m === 'cod') return 'cod';
  if (m === 'free') return 'free';
  return 'online';
};

export const isCancelledOrReturned = (order) => ['Cancelled', 'Returned'].includes(normalizeStatus(order?.status));

// 98••••3210 -- enough to recognise the number, not enough to read it out loud.
export function maskPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `${d.slice(0, 2)}••••${d.slice(6)}` : '';
}

// A mobile-OTP account has a non-routable placeholder address (api/msg91-login.js); never show it.
export const isPlaceholderEmail = (e) => /@phone\.[^@\s]+\.invalid$/i.test(String(e || '').trim());

export function addressLines(a) {
  if (!a) return [];
  return [
    a.name,
    [a.line1, a.line2].filter(Boolean).join(', '),
    [a.city, [a.state, a.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    a.phone ? `Phone: ${a.phone}` : '',
  ].filter(Boolean);
}

export const VALID_INDIAN_MOBILE = /^[6-9]\d{9}$/;
export const isValidIndianMobile = (v) => VALID_INDIAN_MOBILE.test(String(v || '').replace(/\D/g, '').slice(-10));

// What the customer is told about money after a cancellation (from api/orders.js's `refund` result).
export function cancelRefundMessage(order, refund) {
  const online = Number(refund?.onlineRefunded) || 0;
  const gift = Number(refund?.giftCardCredited) || 0;
  const parts = [];
  if (online > 0) parts.push(`₹${online.toLocaleString('en-IN')} will be refunded to your original payment method in 5–7 business days.`);
  if (gift > 0) parts.push(`₹${gift.toLocaleString('en-IN')} has been added back to your gift card.`);
  if (!parts.length) {
    parts.push(order?.payment_method === 'cod' ? 'No payment was taken, so there is nothing to refund.' : 'There is nothing to refund for this order.');
  }
  return parts.join(' ');
}
