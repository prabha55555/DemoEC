// Order lifecycle rules, shared by the storefront (tracker, cancel/return buttons), the admin
// (status actions) and the server (guards in api/orders.js). Pure. See docs/ECOMMERCE_REDESIGN.md B3.
//
//   status          Placed -> Confirmed -> Packed -> Shipped -> Out for Delivery -> Delivered
//                   Cancelled (from any pre-delivery state)      Returned (after Delivered)
//   payment_status  paid | cod_pending | partially_refunded | refunded

export const ORDER_STATUSES = ['Placed', 'Confirmed', 'Packed', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled', 'Returned'];

// The happy path, in order -- what the customer's tracker draws.
export const FULFILMENT_STEPS = ['Placed', 'Confirmed', 'Packed', 'Shipped', 'Out for Delivery', 'Delivered'];

export const CUSTOMER_CANCELLABLE = ['Placed', 'Confirmed', 'Packed'];
export const ADMIN_CANCELLABLE = ['Placed', 'Confirmed', 'Packed', 'Shipped', 'Out for Delivery'];
export const TERMINAL_STATUSES = ['Delivered', 'Cancelled', 'Returned'];

export const PAYMENT_STATUS_LABELS = {
  paid: 'Paid',
  cod_pending: 'Pay on delivery',
  partially_refunded: 'Partially refunded',
  refunded: 'Refunded',
};

export const RETURN_STATUSES = ['Requested', 'Approved', 'Rejected', 'Pickup Scheduled', 'Received', 'Refunded', 'Closed'];

export const RETURN_REASONS = [
  'Wrong item received',
  'Damaged or defective',
  'Size / fit issue',
  'Not as described',
  'Quality not as expected',
  'No longer needed',
  'Other',
];

export const CANCEL_REASONS = [
  'Ordered by mistake',
  'Found a better price',
  'Delivery is taking too long',
  'Want to change the order',
  'Other',
];

export const isKnownStatus = (s) => ORDER_STATUSES.includes(s);

// Pre-v2 rows may still say Paid / Pending; both mean "placed and paid" now.
export const normalizeStatus = (s) => (s === 'Paid' || s === 'Pending' || !s ? 'Placed' : s);

export function canCancel(order, actor = 'customer') {
  const status = normalizeStatus(order?.status);
  return (actor === 'admin' ? ADMIN_CANCELLABLE : CUSTOMER_CANCELLABLE).includes(status);
}

// Where an admin may move an order next: any later step on the happy path, or Cancelled.
// Delivered/Cancelled/Returned are final here (Returned is set by the returns workflow).
export function nextStatuses(order) {
  const status = normalizeStatus(order?.status);
  const i = FULFILMENT_STEPS.indexOf(status);
  if (i < 0) return [];
  const forward = FULFILMENT_STEPS.slice(i + 1);
  return canCancel(order, 'admin') ? [...forward, 'Cancelled'] : forward;
}

// Money back WITHOUT cancelling (the admin's "Issue refund"). While an order is still being fulfilled a refund may only
// be PARTIAL -- goodwill for a late delivery, say -- and at least Rs 1 must stay: taking back the whole amount of an order
// that is still going out is a cancellation, which also puts the stock back and releases the coupon. Shared by the server
// and the admin screens so they cannot disagree. Returns null when there is no cap (delivered, returned or cancelled
// orders), otherwise the most that may still be refunded.
export function refundCapBeforeDelivery(order) {
  if (TERMINAL_STATUSES.includes(normalizeStatus(order?.status))) return null;
  const left = Math.round(((Number(order?.total) || 0) - (Number(order?.refunded_amount) || 0)) * 100) / 100;
  return Math.max(0, Math.round((left - 1) * 100) / 100);
}

export const refundBeforeDeliveryMessage = (cap) =>
  `This order has not been delivered yet, so only part of it can be refunded${cap > 0 ? ` (up to ₹${Number(cap).toLocaleString('en-IN')})` : ''}. To give back all of it, cancel the order instead: that refunds the payment and puts the items back in stock.`;

// Customer-visible tracker: every happy-path step with done/current flags and, where the timeline
// recorded it, the time it happened. A cancelled order stops at where it was cancelled.
export function trackerSteps(order) {
  const status = normalizeStatus(order?.status);
  const timeline = Array.isArray(order?.timeline) ? order.timeline : [];
  const at = (s) => timeline.slice().reverse().find(t => t.status === s)?.at || null;
  if (status === 'Cancelled') {
    const reached = FULFILMENT_STEPS.filter(s => at(s));
    return [...reached.map(s => ({ label: s, done: true, current: false, at: at(s) })),
      { label: 'Cancelled', done: true, current: true, at: order?.cancelled_at || at('Cancelled'), cancelled: true }];
  }
  const idx = status === 'Returned' ? FULFILMENT_STEPS.length - 1 : FULFILMENT_STEPS.indexOf(status);
  return FULFILMENT_STEPS.map((label, i) => ({ label, done: i <= idx, current: i === idx, at: at(label) }));
}

// Badge colour family for a status/payment/return label.
export function statusTone(status) {
  const s = normalizeStatus(status);
  if (s === 'Delivered' || s === 'Refunded' || s === 'Approved' || s === 'paid') return 'success';
  if (s === 'Cancelled' || s === 'Rejected' || s === 'Returned') return 'danger';
  if (s === 'Shipped' || s === 'Out for Delivery' || s === 'Pickup Scheduled' || s === 'Received') return 'info';
  return 'warn';
}

// -------------------------------------------------------------------------------- returns
const DAY = 24 * 60 * 60 * 1000;

// Order lines the customer may still return and how many units of each.
// `returnedQty` = { variantKey: qty already requested/returned (non-rejected) }.
// A line's window (days after delivery) is snapshotted on the order item at purchase time
// (item.returnWindowDays); 0 / null means not returnable. Gift cards are never returnable.
export function returnableLines(order, returnedQty = {}, now = Date.now()) {
  const status = normalizeStatus(order?.status);
  if (status !== 'Delivered') return { eligible: false, reason: status === 'Cancelled' ? 'This order was cancelled.' : 'Returns open once the order is delivered.', lines: [] };
  const deliveredAt = order?.delivered_at ? new Date(order.delivered_at).getTime() : null;
  if (!deliveredAt) return { eligible: false, reason: 'Delivery date not recorded yet.', lines: [] };
  const lines = [];
  let expired = false;
  for (const item of Array.isArray(order?.items) ? order.items : []) {
    if (item.isGiftCard) continue;
    const window = Number(item.returnWindowDays);
    if (!Number.isFinite(window) || window <= 0) continue;
    const deadline = deliveredAt + window * DAY;
    if (now > deadline) { expired = true; continue; }
    const key = item.variantId || `${item.id}::${item.size || ''}`;
    const left = Number(item.qty) - Number(returnedQty[key] || 0);
    if (left > 0) lines.push({ ...item, key, returnableQty: left, deadline: new Date(deadline).toISOString() });
  }
  if (!lines.length) return { eligible: false, reason: expired ? 'The return window for this order has closed.' : 'Nothing in this order can be returned.', lines: [] };
  return { eligible: true, reason: '', lines };
}

// Amount to refund for returned lines: what was actually paid for them. An order line records its own coupon
// share (`lineDiscount`, the whole line); orders from before that was recorded fall back to spreading the order
// discount over all merchandise in proportion to value.
export function returnRefundAmount(order, lines) {
  const items = (Array.isArray(order?.items) ? order.items : []).filter(i => !i.isGiftCard);
  const gross = items.reduce((s, i) => s + Number(i.price) * Number(i.qty), 0);
  const share = gross > 0 ? (Number(order?.discount) || 0) / gross : 0;
  let total = 0;
  for (const l of lines || []) {
    const qty = Number(l.qty) || 0;
    const value = (Number(l.price) || 0) * qty;
    const item = l.variantId ? items.find(i => i.variantId === l.variantId) : null;
    if (item && item.lineDiscount !== undefined && item.lineDiscount !== null && Number(item.qty) > 0) {
      total += value - (Number(item.lineDiscount) * qty) / Number(item.qty);
    } else {
      total += value - value * share;
    }
  }
  return Math.max(0, Math.round(total * 100) / 100);
}
