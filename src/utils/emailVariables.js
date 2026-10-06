// Centralized transactional-email variable registry -- the single source of
// truth for what {{tokens}} exist, what they resolve to from a real order,
// and what sample value to show while editing/previewing. Meant to be
// reused, unchanged, by the template editor, a later live preview, save-time
// validation, and real send rendering -- so a variable's meaning can never
// drift between them.
//
// Every resolve() below reads ONLY columns confirmed to exist on `orders`
// today (see src/utils/orderWrite.js's insert shape). Fields with no backing
// column yet (tax, invoice_number) resolve to an empty string rather than
// being guessed at -- each says why in `note`.
//
// shipping_carrier/tracking_number/tracking_url (Phase 6) are additive,
// admin-entered fields (see Admin.jsx's Orders tab "Shipping / Tracking"
// field) -- NOT written by orderWrite.js, since an order never ships at the
// moment it's placed. Each falls back to '' when unset, same as every other
// optional token here, so a template referencing one before the admin has
// entered tracking info renders blank instead of literal "undefined".
function fmtDateShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtMoney(n) {
  return (n === null || n === undefined || n === '') ? '' : `₹${Number(n).toLocaleString('en-IN')}`;
}

// Shared by the email and WhatsApp registries (src/utils/whatsappVariables.js imports them) so the same
// order always reads the same way in both channels.
//
// Lifecycle events pass event-specific facts (why it was cancelled, how much was refunded, which return)
// on the order object under `_extra`; they are NOT order columns, so each resolves to '' when absent.
export const PAYMENT_METHOD_LABELS = { razorpay: 'Online payment', cod: 'Cash on Delivery', free: 'Fully covered by gift card / coupon' };
export const PAYMENT_STATUS_TEXT = { paid: 'Paid', cod_pending: 'Pay on delivery', partially_refunded: 'Partially refunded', refunded: 'Refunded' };

export function paymentMethodText(o) { return PAYMENT_METHOD_LABELS[o?.payment_method] || (o?.payment_id ? 'Online payment' : ''); }
export function paymentStatusText(o) { return PAYMENT_STATUS_TEXT[o?.payment_status] || (o?.payment_id ? 'Paid' : ''); }
export function shippingAddressText(o) {
  const a = o?.address;
  if (!a) return '';
  return [a.name, a.line1, a.line2, a.city, [a.state, a.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}
// "2 x Cotton Kurta (M), 1 x USB-C Cable" -- a one-line summary for short messages.
export function itemsSummaryText(o) {
  return (Array.isArray(o?.items) ? o.items : [])
    .map(i => `${Number(i.qty) || 1} x ${i.name || 'Item'}${i.variantLabel ? ` (${i.variantLabel})` : (i.size ? ` (${i.size})` : '')}`)
    .join(', ');
}
export const invoiceNumberOf = (o) => (o?.order_id ? `INV-${o.order_id}` : '');

export const EMAIL_VARIABLES = [
  { key: 'customer_name', label: 'Customer Name', resolve: o => o.user_name || '' },
  { key: 'customer_email', label: 'Customer Email', resolve: o => o.user_email || '' },
  { key: 'order_number', label: 'Order Number', resolve: o => o.order_id || '' },
  { key: 'order_date', label: 'Order Date', resolve: o => fmtDateShort(o.created_at) },
  { key: 'order_status', label: 'Order Status', resolve: o => (o.status === 'Paid' || o.status === 'Pending') ? 'Placed' : (o.status || '') },
  { key: 'payment_status', label: 'Payment Status', resolve: o => paymentStatusText(o) },
  { key: 'payment_method', label: 'Payment Method', resolve: o => paymentMethodText(o) },
  { key: 'payment_id', label: 'Payment ID', resolve: o => o.payment_id || '' },
  { key: 'invoice_number', label: 'Invoice Number', resolve: o => invoiceNumberOf(o) },
  { key: 'items_summary', label: 'Items (one line)', resolve: o => itemsSummaryText(o) },
  { key: 'shipping_address', label: 'Shipping Address', resolve: o => shippingAddressText(o) },
  { key: 'subtotal', label: 'Subtotal', resolve: o => fmtMoney(o.subtotal) },
  { key: 'shipping', label: 'Shipping', resolve: o => fmtMoney(o.shipping) },
  { key: 'cod_fee', label: 'Cash on Delivery Fee', resolve: o => fmtMoney(o.cod_fee) },
  { key: 'tax', label: 'GST (included in total)', resolve: o => fmtMoney(o.tax_total || 0), note: 'Prices include GST; this is the GST portion of the total.' },
  { key: 'discount', label: 'Discount', resolve: o => fmtMoney(o.discount) },
  { key: 'gift_card_applied', label: 'Gift Card Applied', resolve: o => fmtMoney(o.gift_card_applied) },
  { key: 'total', label: 'Total', resolve: o => fmtMoney(o.total) },
  { key: 'estimated_delivery', label: 'Estimated Delivery', resolve: o => o.estimated_delivery || '' },
  { key: 'shipping_carrier', label: 'Shipping Carrier', resolve: o => o.shipping_carrier || '' },
  { key: 'tracking_number', label: 'Tracking Number', resolve: o => o.tracking_number || '' },
  { key: 'tracking_url', label: 'Tracking URL', resolve: o => o.tracking_url || '' },
  { key: 'cancel_reason', label: 'Cancellation Reason', resolve: o => o._extra?.cancelReason || o.cancel_reason || '' },
  { key: 'refund_amount', label: 'Refund Amount', resolve: o => fmtMoney(o._extra?.refundAmount ?? (Number(o.refunded_amount) || '')) },
  { key: 'refund_id', label: 'Refund Reference', resolve: o => o._extra?.refundId || '' },
  { key: 'return_id', label: 'Return Request ID', resolve: o => o._extra?.returnId ? String(o._extra.returnId).slice(0, 8).toUpperCase() : '' },
  { key: 'return_reason', label: 'Return Reason', resolve: o => o._extra?.returnReason || '' },
  { key: 'return_note', label: 'Note From Us (return decision)', resolve: o => o._extra?.returnNote || '' },
];

export const EMAIL_VARIABLE_KEYS = EMAIL_VARIABLES.map(v => v.key);

// A realistic, fully-populated fake order -- same shape orderWrite.js writes
// -- for sample values and a later live-preview feature. Never touches
// Supabase.
export const SAMPLE_ORDER = {
  order_id: 'BL-10482',
  user_name: 'Priya Sharma',
  user_email: 'priya.sharma@example.com',
  status: 'Confirmed',
  payment_status: 'paid',
  payment_method: 'razorpay',
  payment_id: 'pay_sample123',
  subtotal: 24500,
  shipping: 0,
  discount: 500,
  tax_total: 3661.02,
  total: 24000,
  address: { name: 'Priya Sharma', line1: '12 Lake View Road', city: 'Chennai', state: 'Tamil Nadu', pincode: '600001' },
  items: [{ name: 'Cotton Kurta Set', variantLabel: 'M', qty: 2, price: 12250 }],
  created_at: new Date().toISOString(),
};

// Resolves every known order variable against a real order row (or
// SAMPLE_ORDER by default) into a flat { key: value } map.
export function resolveVariables(order) {
  const out = {};
  for (const v of EMAIL_VARIABLES) out[v.key] = v.resolve(order || SAMPLE_ORDER);
  return out;
}

// SUPPORT_REPLY is not order-shaped -- it resolves against an `enquiries` row
// (see the Admin Enquiries tab's real columns: id, product, user_name,
// user_email, user_phone, message, created_at, type, status). There is no
// `subject` column on enquiries -- support_subject is mapped from `product`,
// the closest real field, documented rather than invented. There is no
// reply-storage column either -- support_reply is always blank here; a real
// send would need the admin's composed reply text passed in directly rather
// than resolved from any stored row.
export const SUPPORT_VARIABLES = [
  { key: 'customer_name', label: 'Customer Name', resolve: e => e.user_name || '' },
  { key: 'customer_email', label: 'Customer Email', resolve: e => e.user_email || '' },
  { key: 'support_subject', label: 'Support Subject', resolve: e => e.product || '', note: 'enquiries has no subject column -- mapped from the enquiry\'s product field.' },
  { key: 'support_message', label: 'Support Message', resolve: e => e.message || '' },
  { key: 'support_reply', label: 'Support Reply', resolve: () => '', note: 'No reply-sending system exists yet -- composed by the admin at send time, not stored. Always blank in preview/sample.' },
];
export const SUPPORT_VARIABLE_KEYS = SUPPORT_VARIABLES.map(v => v.key);

// Which registry applies to a given event -- SUPPORT_REPLY uses the
// enquiry-shaped set above, every other event uses the order-shaped one.
export function variablesForEvent(eventType) {
  return eventType === 'SUPPORT_REPLY' ? SUPPORT_VARIABLES : EMAIL_VARIABLES;
}
