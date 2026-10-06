// The pure rules behind the admin order screens: which orders a list shows, what "advance" means, how a refund and a
// cancellation are explained, and how the order's history is stitched together. No React, no network -- everything
// that decides something lives here so it can be tested; the components only draw it.
import { FULFILMENT_STEPS, ORDER_STATUSES, canCancel, nextStatuses, normalizeStatus, refundBeforeDeliveryMessage, refundCapBeforeDelivery } from '../../utils/orderStatus';
import { EVENT_FOR_STATUS, emailEventLabel } from '../../utils/emailEvents';
import { istRangeFilter } from '../lib/format';

export const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const time = (v) => { const t = v ? new Date(v).getTime() : NaN; return Number.isFinite(t) ? t : 0; };

// ------------------------------------------------------------------------------------------ list filters
// Rows written before the lifecycle rework may still say Paid / Pending; both mean Placed.
const LEGACY_PLACED = ['Paid', 'Pending'];

export const PAYMENT_METHOD_OPTIONS = [
  { value: 'razorpay', label: 'Online (Razorpay)' },
  { value: 'cod', label: 'Cash on delivery' },
  { value: 'free', label: 'No payment (gift card / coupon)' },
];
export const PAYMENT_STATUS_OPTIONS = [
  { value: 'paid', label: 'Paid' },
  { value: 'cod_pending', label: 'Pay on delivery' },
  { value: 'partially_refunded', label: 'Partially refunded' },
  { value: 'refunded', label: 'Refunded' },
];
export const METHOD_LABEL = { razorpay: 'Online', cod: 'COD', free: 'No payment' };

// "?status=Placed,Confirmed" -> the stored values to match. Unknown words in a hand-edited URL are ignored.
export function statusValues(csv) {
  const out = [];
  for (const raw of String(csv || '').split(',').map(s => s.trim()).filter(Boolean)) {
    if (!ORDER_STATUSES.includes(raw)) continue;
    out.push(raw);
    if (raw === 'Placed') out.push(...LEGACY_PLACED);
  }
  return Array.from(new Set(out));
}

// The URL's filter values -> the `filters` object useServerList / applyFilters understand.
//   withStatus: false leaves the status out (the status tabs count each status under all the OTHER filters).
// flag: 'inventory_issue' = orders needing attention, 'deleted' = the soft-deleted ones (hidden otherwise).
export function orderListFilters(v, { withStatus = true } = {}) {
  const f = {};
  if (withStatus) { const s = statusValues(v.status); if (s.length) f.status = s; }
  if (v.method) f.payment_method = v.method;
  if (v.pay) f.payment_status = v.pay;
  const range = istRangeFilter(v.from, v.to);
  if (range.gte || range.lt) f.created_at = range;
  if (v.flag === 'deleted') f.deleted_at = { not: ['is', null] };
  else {
    f.deleted_at = null;
    if (v.flag === 'inventory_issue') f.inventory_issue = { not: ['is', null] };
  }
  return f;
}

// ------------------------------------------------------------------------------------------ advancing
export const ADVANCE_LABEL = {
  Confirmed: 'Confirm', Packed: 'Mark packed', Shipped: 'Mark shipped', 'Out for Delivery': 'Out for delivery', Delivered: 'Mark delivered',
};

// The next step along the happy path, or null when the order is finished / cancelled / deleted.
export function nextStep(order) {
  if (!order || order.deleted_at) return null;
  return nextStatuses(order).find(s => s !== 'Cancelled') || null;
}

const skipReason = (o) => {
  if (o.deleted_at) return 'Deleted order';
  const s = normalizeStatus(o.status);
  return s === 'Delivered' ? 'Already delivered' : s === 'Cancelled' ? 'Cancelled' : s === 'Returned' ? 'Returned' : 'Cannot advance';
};

// Bulk "advance": every selected order moves ONE step along its own path. Orders that cannot move are listed, not
// silently dropped, so the confirm dialog can say "2 will be skipped".
export function planBulkAdvance(orders) {
  const moves = [];
  const skipped = [];
  for (const o of orders || []) {
    const to = nextStep(o);
    if (to) moves.push({ id: o.id, orderId: o.order_id, from: normalizeStatus(o.status), to });
    else skipped.push({ id: o.id, orderId: o.order_id, status: normalizeStatus(o.status), reason: skipReason(o) });
  }
  const summary = FULFILMENT_STEPS.filter(s => moves.some(m => m.to === s)).map(s => ({ to: s, count: moves.filter(m => m.to === s).length }));
  return { moves, skipped, summary };
}

// Runs the moves ONE AT A TIME (each call can send an email and a WhatsApp message, and api/orders allows 60 requests
// per 10 minutes). `advance(move, { notify })` resolves { ok, error, notified, status }. A failure never stops the rest,
// except "too many requests" (429): hammering on would only fail the remainder too, so those are reported untouched.
export async function runBulkAdvance(moves, advance, { notify = true, onProgress } = {}) {
  const done = [];
  const failed = [];
  const notAttempted = [];
  let stopped = false;
  for (let i = 0; i < moves.length; i += 1) {
    const m = moves[i];
    if (stopped) { notAttempted.push(m); continue; }
    if (onProgress) onProgress({ index: i, total: moves.length, move: m });
    let res;
    try { res = await advance(m, { notify }); } catch (e) { res = { ok: false, error: e?.message || 'Request failed' }; }
    if (res && res.ok) done.push({ ...m, notified: res.notified || null });
    else {
      failed.push({ ...m, error: res?.error || 'Something went wrong.' });
      if (res && res.status === 429) stopped = true;
    }
  }
  return { done, failed, notAttempted };
}

// ------------------------------------------------------------------------------------------ notifications
const CHANNELS = [['email', 'Email'], ['whatsapp', 'WhatsApp']];

// What api/orders reports back ({ email, whatsapp } each 'sent' | 'failed' | 'skipped…') in plain words.
export function describeNotified(notified) {
  if (!notified) return [];
  const out = [];
  for (const [key, name] of CHANNELS) {
    const s = notified[key];
    if (s === 'sent') out.push({ channel: key, state: 'sent', text: `${name} sent` });
    else if (s === 'failed') out.push({ channel: key, state: 'failed', text: `${name} could not be sent` });
    else if (s === 'skipped:no-template') out.push({ channel: key, state: 'skipped', text: `no enabled ${name} template for this event` });
    else if (s === 'skipped:no-email') out.push({ channel: key, state: 'skipped', text: 'the customer has no email address' });
    else if (s === 'skipped:no-phone') out.push({ channel: key, state: 'skipped', text: 'the customer has no phone number' });
  }
  return out;
}

// One sentence for a toast: "Email sent · WhatsApp: no enabled template for this event".
export function notifiedSentence(notified) {
  const parts = describeNotified(notified);
  if (!parts.length) return '';
  return parts.map(p => (p.state === 'skipped' ? `${p.channel === 'email' ? 'Email' : 'WhatsApp'}: ${p.text}` : p.text)).join(' · ');
}

// Before a status change: which customer messages WILL go out. `templates` = { email: {name}|null, whatsapp: {name}|null }
// (the enabled template the server would pick for the event). Says plainly when nothing will be sent and why.
export function planNotification({ to, order, templates = {} }) {
  const eventType = EVENT_FOR_STATUS[to] || null;
  if (!eventType) {
    return { eventType: null, lines: [{ channel: 'all', state: 'none', text: `Nothing is sent to the customer when an order is marked ${to}.` }] };
  }
  return planEventNotification({ eventType, order, templates });
}

// The same plan for an event that is not a status move (a refund, a cancellation, a return decision, a resend).
// channels: which channels the server really uses for that event (return decisions are email only).
export function planEventNotification({ eventType, order, templates = {}, channels = ['email', 'whatsapp'] }) {
  const label = emailEventLabel(eventType);
  const lines = [];
  if (channels.includes('email')) {
    if (!order?.user_email) lines.push({ channel: 'email', state: 'skip', text: 'No email: this order has no email address.' });
    else if (!templates.email) lines.push({ channel: 'email', state: 'skip', text: `No email: there is no enabled "${label}" email template. Switch one on under Email templates.` });
    else lines.push({ channel: 'email', state: 'send', text: `Email "${templates.email.name || label}" to ${order.user_email}.` });
  }
  if (channels.includes('whatsapp')) {
    if (!order?.user_phone) lines.push({ channel: 'whatsapp', state: 'skip', text: 'No WhatsApp: this order has no phone number.' });
    else if (!templates.whatsapp) lines.push({ channel: 'whatsapp', state: 'skip', text: `No WhatsApp: there is no enabled "${label}" WhatsApp template. Switch one on under WhatsApp templates.` });
    else lines.push({ channel: 'whatsapp', state: 'send', text: `WhatsApp message to ${order.user_phone}.` });
  }
  return { eventType, lines };
}

// ------------------------------------------------------------------------------------------ order lines + money
export const hasGiftCardLine = (order) => (Array.isArray(order?.items) ? order.items : []).some(i => i && i.isGiftCard);

export const lineAmounts = (item) => {
  const qty = num(item?.qty) || 0;
  const gross = round2(qty * num(item?.price));
  const discount = round2(Math.min(num(item?.lineDiscount), gross));
  return { qty, gross, discount, net: round2(gross - discount) };
};

// "Cotton Kurta Set (M) +2 more" for the list's items column.
export function itemsHeadline(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const first = items[0];
  return { first: first || null, more: Math.max(0, items.length - 1), units: items.reduce((s, i) => s + (num(i?.qty) || 0), 0) };
}

export const customerName = (order) => order?.user_name || order?.address?.name || order?.user_email || 'Guest';

// wa.me wants digits with the country code: a 10-digit Indian mobile gets 91 in front.
export function waNumber(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length === 10 ? `91${d}` : d.replace(/^0+/, '');
}

// ------------------------------------------------------------------------------------------ refunds
// `orders.refunds[]` entries, normalised. type: online | manual | gift_card. status: pending | processed | failed.
// (Rows from before statuses existed have none; they were processed.) Oldest first.
export function refundEntries(order) {
  const list = Array.isArray(order?.refunds) ? order.refunds : [];
  return list.map((r, i) => {
    const type = r?.type === 'gift_card' ? 'gift_card' : (r?.type === 'manual' || r?.status === 'manual') ? 'manual' : 'online';
    const status = r?.status === 'failed' ? 'failed' : r?.status === 'pending' ? 'pending' : 'processed';
    return {
      id: r?.id || `refund-${i}`, amount: num(r?.amount), at: r?.at || null, reason: r?.reason || '', by: r?.by || '',
      type, status, ref: r?.ref || '', code: r?.code || '',
    };
  }).sort((a, b) => time(a.at) - time(b.at));
}

// Why an admin cannot issue a refund on this order (or '' when they can). The server re-checks everything; this
// only keeps the button honest.
export function refundBlockReason(order) {
  if (!order) return 'Order not loaded.';
  if (hasGiftCardLine(order)) return 'This order includes a gift card. Cancel the order instead: that voids the card (while it is unspent) and refunds the payment.';
  const total = num(order.total);
  if (order.payment_method === 'free' || total <= 0) return 'Nothing was charged for this order, so there is nothing to refund.';
  if (order.payment_method === 'cod' && order.payment_status === 'cod_pending') return 'Cash on delivery: no money has been collected yet, so there is nothing to refund.';
  if (round2(total - num(order.refunded_amount)) <= 0) return 'This order has already been fully refunded.';
  const cap = refundCapBeforeDelivery(order);
  if (cap !== null && cap <= 0) return refundBeforeDeliveryMessage(cap);   // still going out: only a part may be refunded, and nothing is left to give
  return '';
}

// The money picture of an order for the Payment card and the refund dialog.
//   remaining = what can still go back to the original payment method (total - refunded_amount): a HINT, the server caps it
//   giftLeft  = gift-card money that can still be credited back (only matters when more than `remaining` is refunded)
export function refundSummary(order) {
  const entries = refundEntries(order);
  const total = round2(order?.total);
  const refunded = round2(order?.refunded_amount);
  const remaining = Math.max(0, round2(total - refunded));
  const giftApplied = round2(order?.gift_card_applied);
  const giftReturned = round2(entries.filter(e => e.type === 'gift_card' && e.status !== 'failed').reduce((s, e) => s + e.amount, 0));
  const giftLeft = order?.gift_card_code ? Math.max(0, round2(giftApplied - giftReturned)) : 0;
  const blocked = refundBlockReason(order);
  const cap = refundCapBeforeDelivery(order);   // null once delivered / cancelled / returned; before that, the most that may be refunded
  return {
    entries, total, refunded, remaining, giftApplied, giftReturned, giftLeft, giftCode: order?.gift_card_code || '',
    cap, maxAmount: cap === null ? round2(remaining + giftLeft) : cap,
    blocked, canRefund: !blocked,
    hasFailed: entries.some(e => e.status === 'failed'),
    hasPending: entries.some(e => e.status === 'pending'),
    // a CANCELLED online order whose refund failed and money is still to give back: the admin has to finish it. (A failed
    // goodwill refund on a live order owes nothing -- the Payment card shows that attempt as failed and refundable again.)
    needsAttention: normalizeStatus(order?.status) === 'Cancelled' && entries.some(e => e.status === 'failed' && e.type !== 'gift_card') && remaining > 0 && order?.payment_method === 'razorpay',
  };
}

// What cancelling THIS order will do, derived from the order itself (so the dialog never overpromises).
export function cancelConsequences(order) {
  const out = [];
  const items = Array.isArray(order?.items) ? order.items : [];
  const physical = items.some(i => !i?.isGiftCard);
  const giftBought = hasGiftCardLine(order);
  if (giftBought) out.push({ kind: 'gift-void', text: 'The gift card bought with this order is voided first. That only works while it is completely unspent; if any of it was used, the cancellation is refused.' });
  if (physical) {
    if (order?.inventory_issue) out.push({ kind: 'stock-none', text: 'Stock is not changed: payment landed after the stock hold expired, so these items were never taken out of stock.' });
    else if (order?.restocked_at) out.push({ kind: 'stock-none', text: 'Stock is not changed: it was already put back.' });
    else out.push({ kind: 'stock', text: 'The items go back into stock.' });
  }
  if (order?.coupon_code && num(order?.discount) > 0) out.push({ kind: 'coupon', text: `One use of coupon ${order.coupon_code} is released, so it can be used again.` });
  const giftUsed = num(order?.gift_card_applied);
  const summary = refundSummary(order);
  if (order?.gift_card_code && giftUsed > 0) out.push({ kind: 'gift-credit', text: `₹${summary.giftLeft > 0 ? summary.giftLeft : giftUsed} goes back onto gift card ${order.gift_card_code}.` });
  const total = num(order?.total);
  if (order?.payment_method === 'razorpay' && total > 0) {
    if (summary.remaining > 0) out.push({ kind: 'refund-online', text: `₹${summary.remaining.toLocaleString('en-IN')} is refunded to the customer's original payment method through Razorpay (usually 5–7 business days).` });
    else out.push({ kind: 'refund-none', text: 'The payment has already been refunded in full.' });
  } else if (order?.payment_method === 'cod') {
    out.push({ kind: 'refund-none', text: order?.payment_status === 'cod_pending' ? 'Cash on delivery: nothing was collected, so there is nothing to refund.' : 'Cash on delivery: the money was collected in cash, so any refund is yours to pay out.' });
  } else if (total <= 0) {
    out.push({ kind: 'refund-none', text: 'Nothing was charged for this order, so there is nothing to refund.' });
  }
  out.push({ kind: 'status', text: 'The order is marked Cancelled. This cannot be undone.' });
  out.push({ kind: 'notify', text: 'The customer is sent the cancellation message (and a refund message) if enabled templates exist.' });
  return out;
}

export const CANCEL_PRESETS = ['Out of stock', 'Customer asked to cancel', 'Address cannot be served', 'Payment problem', 'Courier could not deliver'];

// Can the admin cancel from this status at all? (the server decides again)
export const adminCanCancel = (order) => !order?.deleted_at && canCancel(order, 'admin');

// ------------------------------------------------------------------------------------------ timeline
export const RETURN_FLOW = {
  Requested: ['Approved', 'Rejected'],
  Approved: ['Pickup Scheduled', 'Received', 'Refunded', 'Closed'],
  'Pickup Scheduled': ['Received', 'Refunded', 'Closed'],
  Received: ['Refunded', 'Closed'],
};
export const shortReturnId = (id) => String(id || '').slice(0, 8).toUpperCase();

const REFUND_TYPE_LABEL = { online: 'to the original payment method', manual: 'recorded as a manual refund', gift_card: 'credited to the gift card' };

// Everything that happened to an order, newest first: status changes (who / note), refunds and return requests woven in.
//   returns: the order's `order_returns` rows (optional)
export function buildTimeline(order, returns = []) {
  const events = [];
  (Array.isArray(order?.timeline) ? order.timeline : []).forEach((t, i) => {
    if (!t) return;
    events.push({ key: `s${i}`, at: t.at, kind: 'status', tone: t.status === 'Cancelled' || t.status === 'Returned' ? 'danger' : t.status === 'Delivered' ? 'success' : 'primary',
      title: normalizeStatus(t.status), detail: t.note || '', by: t.by || '' });
  });
  refundEntries(order).forEach((r) => {
    const failed = r.status === 'failed';
    events.push({
      key: `r${r.id}`, at: r.at, kind: 'refund', tone: failed ? 'danger' : 'info', failed,
      title: `${failed ? 'Refund failed' : r.status === 'pending' ? 'Refund started' : 'Refund'}: ₹${r.amount.toLocaleString('en-IN')}`,
      detail: [REFUND_TYPE_LABEL[r.type], r.reason, r.ref ? `ref ${r.ref}` : ''].filter(Boolean).join(' · '), by: r.by,
    });
  });
  for (const ret of returns || []) {
    if (!ret) continue;
    const code = shortReturnId(ret.id);
    events.push({ key: `q${ret.id}`, at: ret.created_at, kind: 'return', tone: 'warning', title: `${ret.type === 'replacement' ? 'Replacement' : 'Return'} requested (${code})`, detail: ret.reason || '', by: 'customer', href: `/admin/returns/${ret.id}` });
    if (ret.resolved_at) events.push({ key: `q${ret.id}-end`, at: ret.resolved_at, kind: 'return', tone: ret.status === 'Rejected' ? 'danger' : 'success', title: `Return ${ret.status.toLowerCase()} (${code})`, detail: ret.admin_note || '', by: '', href: `/admin/returns/${ret.id}` });
    else if (['Approved', 'Pickup Scheduled', 'Received'].includes(ret.status)) events.push({ key: `q${ret.id}-mid`, at: ret.updated_at, kind: 'return', tone: 'info', title: `Return ${ret.status.toLowerCase()} (${code})`, detail: ret.admin_note || '', by: '', href: `/admin/returns/${ret.id}` });
  }
  // newest first; a stable index keeps same-instant events in the order they were produced
  return events.map((e, i) => ({ ...e, _i: i })).sort((a, b) => time(b.at) - time(a.at) || b._i - a._i).map(({ _i, ...e }) => e);
}

// ------------------------------------------------------------------------------------------ misc wording
// COD orders: the amount a courier collects.
export const codToCollect = (order) => (order?.payment_method === 'cod' && order?.payment_status === 'cod_pending' ? round2(order.total) : 0);

// Which status moves the dialog should treat as a plain note + notify step vs the shipping form.
export const needsShippingDetails = (to) => to === 'Shipped';

export const COURIERS = ['Delhivery', 'Blue Dart', 'DTDC', 'India Post', 'Ecom Express', 'Xpressbees', 'Shadowfax', 'Amazon Shipping', 'Ekart', 'Shiprocket', 'Professional Couriers', 'Gati', 'Self delivery'];

// ------------------------------------------------------------------------------------------ returns
export const RETURN_TERMINAL = ['Rejected', 'Refunded', 'Closed'];
export const RETURN_ACTION_LABEL = {
  Approved: 'Approve', Rejected: 'Reject…', 'Pickup Scheduled': 'Pickup scheduled', Received: 'Mark received', Refunded: 'Refund…', Closed: 'Close without refund',
};
// The customer message each return move sends (return decisions are emailed only; a refund goes by email and WhatsApp).
export const RETURN_EVENT = { Approved: 'RETURN_APPROVED', Rejected: 'RETURN_REJECTED', Refunded: 'REFUND_PROCESSED' };
export const returnNextStatuses = (status) => RETURN_FLOW[status] || [];

const DAY_MS = 24 * 60 * 60 * 1000;

// "2 × Cotton Kurta (M), 1 × Cap" for a return's or an order's lines.
export function itemsSummaryText(items) {
  return (Array.isArray(items) ? items : []).filter(Boolean)
    .map(i => `${Number(i.qty) || 1} × ${i.name || 'Item'}${i.variantLabel && i.variantLabel !== 'Default' ? ` (${i.variantLabel})` : ''}`).join(', ');
}

// Each returned line against the return window it was sold with (item.returnWindowDays, counted from the delivery date).
// state: 'open' | 'closed' | 'none' (sold as non-returnable) | 'unknown' (no delivery date recorded)
export function returnWindows(order, retItems, now = Date.now()) {
  const lines = Array.isArray(order?.items) ? order.items : [];
  const delivered = order?.delivered_at ? time(order.delivered_at) : 0;
  return (Array.isArray(retItems) ? retItems : []).map((ri, i) => {
    const line = lines.find(l => (ri.variantId && l.variantId === ri.variantId) || (!ri.variantId && l.id === ri.id));
    const days = Number(line?.returnWindowDays);
    const base = { key: ri.variantId || `${ri.id}-${i}`, name: ri.name || line?.name || 'Item', windowDays: Number.isFinite(days) ? days : null };
    if (!(days > 0)) return { ...base, state: 'none', deadline: null, daysLeft: null };
    if (!delivered) return { ...base, state: 'unknown', deadline: null, daysLeft: null };
    const deadline = delivered + days * DAY_MS;
    return { ...base, state: now <= deadline ? 'open' : 'closed', deadline: new Date(deadline).toISOString(), daysLeft: Math.ceil((deadline - now) / DAY_MS) };
  });
}
