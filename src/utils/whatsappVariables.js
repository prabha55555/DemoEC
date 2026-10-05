// Variable registry for WhatsApp templates -- separate from
// src/utils/emailVariables.js because WhatsApp needs a couple of different
// tokens (a bare number for the amount, since the template text supplies its
// own currency symbol) and doesn't need email-only ones (subtotal, discount,
// invoice_number, ...). Both read from the same real `orders` row shape
// (see src/utils/orderWrite.js's insert), so nothing here is invented.
function fmtDateShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export const WHATSAPP_VARIABLES = [
  { key: 'customer_name', label: 'Customer Name', resolve: o => o.user_name || '' },
  { key: 'order_id', label: 'Order ID', resolve: o => o.order_id || '' },
  // Bare number, comma-formatted, no currency symbol -- the template text
  // itself supplies the "₹" (see the seed content given to the admin), so a
  // pre-formatted "Rs. X" or "₹X" here would double up.
  { key: 'total_amount', label: 'Total Amount (number only -- put ₹ in your template text)', resolve: o => (Number(o.total) || 0).toLocaleString('en-IN') },
  { key: 'order_date', label: 'Order Date', resolve: o => fmtDateShort(o.created_at) },
  { key: 'expected_delivery_date', label: 'Expected Delivery Date', resolve: o => o.estimated_delivery ? fmtDateShort(o.estimated_delivery) : '' },
  // orders has no actual-delivered-date column -- always resolves to today,
  // the moment this message is sent (Set & Notify is a manual, in-the-moment
  // action, so "today" is the real delivery-confirmation date in practice).
  { key: 'delivery_date', label: 'Delivery Date', resolve: () => fmtDateShort(new Date().toISOString()), note: 'No actual-delivered-date column exists -- always resolves to today, at send time.' },
  // Reuses api/product-share.js (built for the customer-facing enquiry
  // flow) keyed off the order's first item's product id -- WhatsApp's
  // crawler needs a page with real Open Graph tags to render a photo
  // preview, same reasoning as the enquiry message, and `products` is
  // public data (unlike `orders`, which has no anon read access -- this
  // deliberately never tries to build an order-specific preview page, which
  // would need a way to read order data publicly). Blank for a gift-card-only
  // order or one with no items, so a template using this token just shows no
  // link rather than a broken one.
  { key: 'photo_url', label: 'Product Photo Link (shows a photo preview in WhatsApp)', resolve: o => (Array.isArray(o.items) && o.items[0]?.id) ? `https://www.brightlightsolutions.in/api/product-share?id=${o.items[0].id}` : '' },
  // Used only by PRODUCT_ENQUIRY_RECEIVED (api/send-enquiry-whatsapp.js),
  // which passes a plain { user_phone, product_name } object into
  // sendWhatsAppTemplate rather than a real `orders` row -- harmless no-op
  // for every other template, since a real order object never has this field.
  { key: 'product_name', label: 'Product Name', resolve: o => o.product_name || '' },
  // Phase 6 -- additive, admin-entered fields (see Admin.jsx's Orders tab
  // "Shipping / Tracking" field), not written at order-placement time, so
  // each falls back to '' rather than rendering literal "undefined" in a
  // Shipped/Delivered template sent before tracking info is entered.
  { key: 'shipping_carrier', label: 'Shipping Carrier', resolve: o => o.shipping_carrier || '' },
  { key: 'tracking_number', label: 'Tracking Number', resolve: o => o.tracking_number || '' },
  { key: 'tracking_url', label: 'Tracking URL', resolve: o => o.tracking_url || '' },
];

export const WHATSAPP_VARIABLE_KEYS = WHATSAPP_VARIABLES.map(v => v.key);

export function resolveWhatsAppVariables(order) {
  const out = {};
  for (const v of WHATSAPP_VARIABLES) out[v.key] = v.resolve(order || {});
  return out;
}

// Whether a template opted into photo attachment by using {{photo_url}}
// anywhere in its message. Callers (sendWhatsAppConfirmation.js,
// api/send-order-whatsapp.js) check this before doing the extra `products`
// lookup needed to resolve a real image URL -- so a template that doesn't
// use the token never pays for that query.
export function templateWantsPhoto(message) {
  return /\{\{\s*photo_url\s*\}\}/i.test(message || '');
}
