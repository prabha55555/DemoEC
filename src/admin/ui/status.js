// Which colour family and wording a status gets. Pure: StatusPill renders it, tests check it.
import { ORDER_STATUSES, RETURN_STATUSES, PAYMENT_STATUS_LABELS, normalizeStatus, statusTone } from '../../utils/orderStatus';

// statusTone() speaks 'warn'; the CSS badge classes say 'warning'.
const TONE_CLASS = { warn: 'warning', success: 'success', danger: 'danger', info: 'info', neutral: 'neutral', primary: 'primary', warning: 'warning' };

// Order lifecycle: statusTone() for the endpoints, with Confirmed / Packed given the brand colour so "waiting
// for you" (Placed, amber) and "in progress" (teal) read differently in a table.
function orderPill(status) {
  const s = normalizeStatus(status);
  if (s === 'Confirmed' || s === 'Packed') return { tone: 'primary', label: s };
  return { tone: TONE_CLASS[statusTone(s)], label: s };
}

const PAYMENT_TONES = { paid: 'success', cod_pending: 'warning', partially_refunded: 'info', refunded: 'neutral' };
const PRODUCT_PILLS = { active: ['success', 'Active'], draft: ['warning', 'Draft'], archived: ['neutral', 'Archived'] };
const REVIEW_PILLS = { pending: ['warning', 'Pending'], approved: ['success', 'Approved'], rejected: ['danger', 'Rejected'] };
const STOCK_PILLS = { in_stock: ['success', 'In stock'], low: ['warning', 'Low stock'], out: ['danger', 'Out of stock'], untracked: ['neutral', 'Not tracked'] };
const GENERIC_PILLS = {
  active: ['success', 'Active'], inactive: ['neutral', 'Inactive'], enabled: ['success', 'Enabled'], disabled: ['neutral', 'Disabled'],
  published: ['success', 'Published'], draft: ['neutral', 'Draft'], waiting: ['warning', 'Waiting'], notified: ['success', 'Notified'],
  expired: ['danger', 'Expired'], scheduled: ['info', 'Scheduled'], yes: ['success', 'Yes'], no: ['neutral', 'No'],
};

const titleCase = (s) => String(s ?? '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());

// kind: 'order' | 'payment' | 'return' | 'product' | 'review' | 'stock' | 'generic' | 'auto'
// 'auto' guesses from the value (an order or return status name, a payment_status key, a product/review word).
export function pillFor(status, kind = 'auto') {
  const raw = status;
  if (raw === null || raw === undefined || raw === '') return { tone: 'neutral', label: '—' };
  let k = kind;
  if (k === 'auto') {
    if (ORDER_STATUSES.includes(raw) || raw === 'Paid' || raw === 'Pending') k = 'order';
    else if (RETURN_STATUSES.includes(raw)) k = 'return';
    else if (raw in PAYMENT_TONES) k = 'payment';
    else if (raw in PRODUCT_PILLS && raw !== 'draft') k = 'product';
    else if (raw in REVIEW_PILLS) k = 'review';
    else if (raw in STOCK_PILLS) k = 'stock';
    else k = 'generic';
  }
  const key = String(raw).toLowerCase();
  switch (k) {
    case 'order': return orderPill(raw);
    case 'return': return { tone: TONE_CLASS[statusTone(raw)], label: String(raw) };
    case 'payment': return { tone: PAYMENT_TONES[raw] || 'neutral', label: PAYMENT_STATUS_LABELS[raw] || titleCase(raw) };
    case 'product': { const [tone, label] = PRODUCT_PILLS[key] || ['neutral', titleCase(raw)]; return { tone, label }; }
    case 'review': { const [tone, label] = REVIEW_PILLS[key] || ['neutral', titleCase(raw)]; return { tone, label }; }
    case 'stock': { const [tone, label] = STOCK_PILLS[key] || ['neutral', titleCase(raw)]; return { tone, label }; }
    default: { const [tone, label] = GENERIC_PILLS[key] || ['neutral', titleCase(raw)]; return { tone, label }; }
  }
}
