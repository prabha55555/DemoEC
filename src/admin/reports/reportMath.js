// The number-crunching behind the reports, free of React and Supabase so it can be tested. Every figure here comes
// from rows the database already filtered to the date range and to NON-cancelled orders (cancelled orders were refunded
// in full and never kept, so they are not sales); refunds are always shown explicitly, never silently netted away.
import { istStamp } from '../orders/orderCsv';
import { eachDayKey, weekStartKey } from './dateRange';

export const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
export const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

// ------------------------------------------------------------------------------------------ sales
// admin_sales_daily() rows { day, orders, sales, refunds, units } -> one entry per day of the range (quiet days = zeros),
// each with net = sales - refunds and the average order value (net / orders).
//   sales   = what the goods + delivery cost the customer before any gift card (total + gift_card_applied)
//   refunds = money refunded on those same orders
export function buildSalesSeries(rows, range) {
  const byDay = new Map();
  for (const r of rows || []) byDay.set(String(r.day).slice(0, 10), r);
  return eachDayKey(range).map((key) => {
    const r = byDay.get(key);
    const orders = r ? num(r.orders) : 0;
    const sales = r ? round2(r.sales) : 0;
    const refunds = r ? round2(r.refunds) : 0;
    const net = round2(sales - refunds);
    return { key, orders, sales, refunds, net, units: r ? num(r.units) : 0, aov: orders ? round2(net / orders) : 0 };
  });
}

export function salesTotals(series) {
  const t = series.reduce((a, d) => ({ orders: a.orders + d.orders, sales: a.sales + d.sales, refunds: a.refunds + d.refunds, units: a.units + d.units }), { orders: 0, sales: 0, refunds: 0, units: 0 });
  const sales = round2(t.sales);
  const refunds = round2(t.refunds);
  const net = round2(sales - refunds);
  return { orders: t.orders, units: t.units, sales, refunds, net, aov: t.orders ? round2(net / t.orders) : 0 };
}

// Chart buckets: a bar per day up to `maxDaily` days, a bar per week (Monday start) beyond that, so a year is readable.
// Each: { key, revenue (= net), orders, sales, refunds }.
export function chartBuckets(series, maxDaily = 92) {
  if (series.length <= maxDaily) return series.map(d => ({ key: d.key, revenue: d.net, orders: d.orders, sales: d.sales, refunds: d.refunds }));
  const weeks = new Map();
  for (const d of series) {
    const k = weekStartKey(d.key);
    const w = weeks.get(k) || { key: k, revenue: 0, orders: 0, sales: 0, refunds: 0 };
    w.revenue = round2(w.revenue + d.net); w.orders += d.orders; w.sales = round2(w.sales + d.sales); w.refunds = round2(w.refunds + d.refunds);
    weeks.set(k, w);
  }
  return Array.from(weeks.values());
}

export const SALES_CSV_COLUMNS = [
  { label: 'Date', get: d => d.key },
  { label: 'Orders', get: d => d.orders },
  { label: 'Units', get: d => d.units },
  { label: 'Sales', get: d => d.sales },
  { label: 'Refunds', get: d => d.refunds },
  { label: 'Net sales', get: d => d.net },
  { label: 'Average order value', get: d => d.aov },
];

// ------------------------------------------------------------------------------------------ products / categories
// admin_sales_by_product() / admin_sales_by_category() rows with each one's share of `total` revenue (one decimal).
export function withShare(rows, total) {
  const whole = total === undefined ? (rows || []).reduce((s, r) => s + num(r.revenue), 0) : num(total);
  return (rows || []).map(r => ({ ...r, units: num(r.units), revenue: round2(r.revenue), share: pct(num(r.revenue), whole) }));
}

export const PRODUCT_CSV_COLUMNS = [
  { label: 'Product', get: r => r.name || '' },
  { label: 'Product id', get: r => r.product_id || '' },
  { label: 'Units sold', get: r => r.units },
  { label: 'Revenue', get: r => r.revenue },
  { label: 'Share of revenue %', get: r => r.share },
];
export const CATEGORY_CSV_COLUMNS = [
  { label: 'Category', get: r => r.category || '' },
  { label: 'Units sold', get: r => r.units },
  { label: 'Revenue', get: r => r.revenue },
  { label: 'Share of revenue %', get: r => r.share },
];

// ------------------------------------------------------------------------------------------ coupons
// Orders that used a coupon (narrow rows: coupon_code, discount, total, status) -> one line per code.
//   uses = orders, discount = what the coupon cost you, revenue = what those orders were charged
export function couponReport(rows) {
  const byCode = new Map();
  for (const r of rows || []) {
    if (!r || !r.coupon_code || r.status === 'Cancelled') continue;
    const e = byCode.get(r.coupon_code) || { code: r.coupon_code, uses: 0, discount: 0, revenue: 0 };
    e.uses += 1; e.discount += num(r.discount); e.revenue += num(r.total);
    byCode.set(r.coupon_code, e);
  }
  const lines = Array.from(byCode.values()).map(e => ({ ...e, discount: round2(e.discount), revenue: round2(e.revenue), average: round2(e.discount / e.uses) }))
    .sort((a, b) => b.discount - a.discount || b.uses - a.uses || a.code.localeCompare(b.code));
  const totals = lines.reduce((t, l) => ({ uses: t.uses + l.uses, discount: round2(t.discount + l.discount), revenue: round2(t.revenue + l.revenue) }), { uses: 0, discount: 0, revenue: 0 });
  return { lines, totals };
}
export const COUPON_CSV_COLUMNS = [
  { label: 'Coupon code', get: l => l.code },
  { label: 'Orders', get: l => l.uses },
  { label: 'Discount given', get: l => l.discount },
  { label: 'Average discount', get: l => l.average },
  { label: 'Order value', get: l => l.revenue },
];

// ------------------------------------------------------------------------------------------ payments
// How the money came in. Rows (narrow): payment_method, payment_status, status, total, gift_card_applied, discount, refunded_amount.
// Cancelled orders are NOT sales, so they stay out of every figure except `cancelledRefunds`, which exists so the refunds
// that cancellations triggered are visible too (a cancelled online order is refunded in full).
export function methodOf(row) {
  const m = row?.payment_method;
  if (m === 'cod') return 'cod';
  if (m === 'free' || (m !== 'razorpay' && num(row?.total) <= 0)) return 'free';
  return 'online';
}

export function summarisePayments(rows) {
  const s = {
    orders: 0,
    online: { orders: 0, amount: 0, refunded: 0 },
    cod: { orders: 0, amount: 0, collected: { orders: 0, amount: 0 }, pending: { orders: 0, amount: 0 }, refunded: 0 },
    free: { orders: 0 },
    giftCard: 0, coupon: 0, refunds: 0, refundedOrders: 0,
    cancelled: { orders: 0, refunds: 0 },
  };
  for (const r of rows || []) {
    if (!r) continue;
    if (r.status === 'Cancelled') { s.cancelled.orders += 1; s.cancelled.refunds += num(r.refunded_amount); continue; }
    s.orders += 1;
    s.giftCard += num(r.gift_card_applied);
    s.coupon += num(r.discount);
    const refunded = num(r.refunded_amount);
    s.refunds += refunded;
    if (refunded > 0) s.refundedOrders += 1;
    const m = methodOf(r);
    if (m === 'online') { s.online.orders += 1; s.online.amount += num(r.total); s.online.refunded += refunded; }
    else if (m === 'cod') {
      s.cod.orders += 1; s.cod.amount += num(r.total); s.cod.refunded += refunded;
      const bucket = r.payment_status === 'cod_pending' ? s.cod.pending : s.cod.collected;
      bucket.orders += 1; bucket.amount += num(r.total);
    } else s.free.orders += 1;
  }
  const r2 = (o) => { for (const k of Object.keys(o)) if (typeof o[k] === 'number') o[k] = round2(o[k]); return o; };
  r2(s.online); r2(s.cod.collected); r2(s.cod.pending); r2(s.cod); r2(s.cancelled); r2(s);
  return s;
}

// The payments table's server filters. method: razorpay | cod | free. pay: a payment_status. refunds: 'with' | 'without'.
// cancelled: '' (default: leave cancelled orders out) | 'include' | 'only'.
export function paymentFilters({ method = '', pay = '', refunds = '', cancelled = '' } = {}, bounds) {
  const f = { deleted_at: null };
  if (bounds) f.created_at = { gte: bounds.fromISO, lt: bounds.toISO };
  if (method) f.payment_method = method;
  if (pay) f.payment_status = pay;
  if (refunds === 'with') f.refunded_amount = { gt: 0 };
  if (refunds === 'without') f.refunded_amount = { lte: 0 };
  if (cancelled === 'only') f.status = 'Cancelled';
  else if (cancelled !== 'include') f.status = { neq: 'Cancelled' };
  return f;
}

export const PAYMENT_CSV_COLUMNS = [
  { label: 'Order number', get: o => o.order_id },
  { label: 'Placed (IST)', get: o => istStamp(o.created_at) },
  { label: 'Customer', get: o => o.user_name || o.user_email || 'Guest' },
  { label: 'Email', get: o => o.user_email || '' },
  { label: 'Payment method', get: o => ({ razorpay: 'Online (Razorpay)', cod: 'Cash on delivery', free: 'No payment (gift card / coupon)' }[o.payment_method] || o.payment_method || '') },
  { label: 'Razorpay payment id', get: o => o.payment_id || '' },
  { label: 'Amount charged', get: o => num(o.total) },
  { label: 'Gift card applied', get: o => num(o.gift_card_applied) },
  { label: 'Coupon discount', get: o => num(o.discount) },
  { label: 'Refunded', get: o => num(o.refunded_amount) },
  { label: 'Payment status', get: o => o.payment_status || '' },
  { label: 'Order status', get: o => o.status || '' },
];
