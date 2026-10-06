// CSV exports for orders: one row per ORDER, and one row per ORDER LINE (with GST). Pure column definitions in the
// shape lib/csv.js wants ({ label, get(row) }), so they can be tested and handed straight to exportCsv / toCsv.
// Numbers are written as numbers (never "₹1,299"), so a spreadsheet can add them up.
import { computeTax } from '../../utils/tax';
import { PAYMENT_STATUS_LABELS, normalizeStatus } from '../../utils/orderStatus';
import { IST } from '../lib/format';
import { METHOD_LABEL, customerName, itemsHeadline, round2 } from './orderLogic';

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

const stampFmt = new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// "2026-10-06 15:42" in India time -- sorts correctly and every spreadsheet reads it as a date.
export function istStamp(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const p = Object.fromEntries(stampFmt.formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${String(Number(p.hour) % 24).padStart(2, '0')}:${p.minute}`;
}

export const ORDER_CSV_COLUMNS = [
  { label: 'Order number', get: o => o.order_id },
  { label: 'Placed (IST)', get: o => istStamp(o.created_at) },
  { label: 'Status', get: o => normalizeStatus(o.status) },
  { label: 'Payment method', get: o => METHOD_LABEL[o.payment_method] || o.payment_method || '' },
  { label: 'Payment status', get: o => PAYMENT_STATUS_LABELS[o.payment_status] || o.payment_status || '' },
  { label: 'Customer', get: o => customerName(o) },
  { label: 'Email', get: o => o.user_email || '' },
  { label: 'Phone', get: o => o.user_phone || o.address?.phone || '' },
  { label: 'City', get: o => o.address?.city || '' },
  { label: 'State', get: o => o.address?.state || '' },
  { label: 'Pincode', get: o => o.address?.pincode || '' },
  { label: 'Units', get: o => itemsHeadline(o).units },
  { label: 'Items subtotal', get: o => n(o.subtotal) },
  { label: 'Discount', get: o => n(o.discount) },
  { label: 'Coupon', get: o => o.coupon_code || '' },
  { label: 'Delivery fee', get: o => n(o.shipping) },
  { label: 'COD fee', get: o => n(o.cod_fee) },
  { label: 'Gift card applied', get: o => n(o.gift_card_applied) },
  { label: 'GST included in total', get: o => n(o.tax_total) },
  { label: 'Total charged', get: o => n(o.total) },
  { label: 'Refunded', get: o => n(o.refunded_amount) },
  { label: 'Razorpay payment id', get: o => o.payment_id || '' },
  { label: 'Courier', get: o => o.shipping_carrier || '' },
  { label: 'Tracking number', get: o => o.tracking_number || '' },
  { label: 'Needs attention', get: o => (o.inventory_issue ? 'Stock issue' : '') },
];

// One row per order line. Each carries its order and, for physical goods, that line's GST worked out the same way the
// invoice does (price is GST-inclusive; the order's coupon share is taken off first -- the line's own `lineDiscount`
// when it has one).
export function orderLineRows(orders, { defaultRate = 18, sellerState = '' } = {}) {
  const rows = [];
  for (const order of orders || []) {
    const items = Array.isArray(order.items) ? order.items : [];
    const goods = items.filter(i => i && !i.isGiftCard);
    const tax = computeTax({
      lines: goods.map((i, idx) => ({ key: idx, qty: n(i.qty), price: n(i.price), gstRate: i.gstRate ?? defaultRate, lineDiscount: i.lineDiscount, hsn: i.hsn })),
      discount: n(order.discount), shipping: 0, shippingRate: defaultRate, sellerState, buyerState: order.address?.state || '',
    });
    let g = 0;
    items.forEach((item) => {
      if (!item) return;
      rows.push({ order, item, calc: item.isGiftCard ? null : tax.lines[g++] });
    });
  }
  return rows;
}

export const ORDER_LINE_CSV_COLUMNS = [
  { label: 'Order number', get: r => r.order.order_id },
  { label: 'Placed (IST)', get: r => istStamp(r.order.created_at) },
  { label: 'Status', get: r => normalizeStatus(r.order.status) },
  { label: 'Customer', get: r => customerName(r.order) },
  { label: 'Product', get: r => r.item.name || '' },
  { label: 'Variant', get: r => (r.item.variantLabel || r.item.size || '').replace(/^Default$/, '') },
  { label: 'SKU', get: r => r.item.sku || '' },
  { label: 'Category', get: r => r.item.cat || '' },
  { label: 'Quantity', get: r => n(r.item.qty) },
  { label: 'Unit price (incl. GST)', get: r => n(r.item.price) },
  { label: 'MRP', get: r => (n(r.item.mrp) > 0 ? n(r.item.mrp) : '') },
  { label: 'Coupon discount on line', get: r => (r.calc ? r.calc.discount : n(r.item.lineDiscount)) },
  { label: 'Line total', get: r => (r.calc ? r.calc.net : round2(n(r.item.qty) * n(r.item.price))) },
  { label: 'GST rate %', get: r => (r.calc ? r.calc.rate : '') },
  { label: 'Taxable value', get: r => (r.calc ? r.calc.taxable : '') },
  { label: 'GST amount', get: r => (r.calc ? r.calc.tax : '') },
  { label: 'HSN', get: r => r.item.hsn || '' },
  { label: 'Gift card', get: r => (r.item.isGiftCard ? 'Yes' : 'No') },
];
