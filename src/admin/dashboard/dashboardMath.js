// The dashboard's number-crunching, free of React and Supabase so it can be unit-tested.
//
// Rules (docs: ECOMMERCE_REDESIGN B5 / the ADM-1 brief):
//   * an order counts toward revenue unless its status is Cancelled or Returned
//   * its value is `total` minus `refunded_amount` (a partial refund lowers it), never below 0
//   * days are IST calendar days; "Today" is bucketed by IST hour
import { ORDER_STATUSES, normalizeStatus } from '../../utils/orderStatus';
import { IST, addDaysToKey, istDateKey } from '../lib/format';

export const REVENUE_EXCLUDED = ['Cancelled', 'Returned'];

export const isCounted = (order) => !REVENUE_EXCLUDED.includes(normalizeStatus(order?.status));

// What an order contributes to revenue (0 for a cancelled / returned one).
export function orderRevenue(order) {
  if (!isCounted(order)) return 0;
  const total = Number(order?.total) || 0;
  const refunded = Number(order?.refunded_amount) || 0;
  return Math.max(0, total - refunded);
}

const partsFmt = new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
// { key: 'YYYY-MM-DD', hour: 0-23 } of an instant, in IST.
export function istParts(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(partsFmt.formatToParts(d).map(x => [x.type, x.value]));
  return { key: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}

// Totals for a set of orders: { revenue, orders (counted ones), aov }.
export function summarise(orders) {
  let revenue = 0;
  let count = 0;
  for (const o of orders) {
    if (!isCounted(o)) continue;
    revenue += orderRevenue(o);
    count += 1;
  }
  return { revenue, orders: count, aov: count ? revenue / count : 0 };
}

// Orders created on one of the given IST day keys.
export function ordersOnDays(orders, dayKeys) {
  const set = new Set(dayKeys);
  return orders.filter(o => { const p = istParts(o.created_at); return p && set.has(p.key); });
}

// Buckets for the chart. days = 1 -> 24 hourly buckets for today; days > 1 -> one bucket per IST day, oldest first,
// ending today. Each bucket: { key, label, revenue, orders }.
export function buildSeries(orders, days, now = new Date()) {
  const today = istDateKey(now);
  if (days <= 1) {
    const buckets = Array.from({ length: 24 }, (_, h) => ({ key: `${today}T${String(h).padStart(2, '0')}`, hour: h, revenue: 0, orders: 0 }));
    for (const o of orders) {
      const p = istParts(o.created_at);
      if (!p || p.key !== today || !isCounted(o)) continue;
      buckets[p.hour].revenue += orderRevenue(o);
      buckets[p.hour].orders += 1;
    }
    return buckets;
  }
  const keys = Array.from({ length: days }, (_, i) => addDaysToKey(today, i - (days - 1)));
  const byKey = new Map(keys.map(k => [k, { key: k, revenue: 0, orders: 0 }]));
  for (const o of orders) {
    const p = istParts(o.created_at);
    const b = p && byKey.get(p.key);
    if (!b || !isCounted(o)) continue;
    b.revenue += orderRevenue(o);
    b.orders += 1;
  }
  return keys.map(k => byKey.get(k));
}

// Order counts per status, every status shown (zeros included), legacy Paid / Pending folded into Placed.
export function statusBreakdown(orders) {
  const counts = Object.fromEntries(ORDER_STATUSES.map(s => [s, 0]));
  for (const o of orders) {
    const s = normalizeStatus(o.status);
    if (s in counts) counts[s] += 1;
  }
  return ORDER_STATUSES.map(status => ({ status, count: counts[status] }));
}

// A y-axis maximum that is a "nice" round number above the data, so gridlines land on tidy values.
export function niceMax(value) {
  if (!(value > 0)) return 100;
  const pow = 10 ** Math.floor(Math.log10(value));
  const n = value / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}
