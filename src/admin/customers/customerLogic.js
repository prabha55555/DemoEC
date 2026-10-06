// Pure rules for the customer screens: lifetime figures from an order list, and the CSV export columns.
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const round2 = (v) => Math.round((n(v) + Number.EPSILON) * 100) / 100;
const time = (v) => { const t = v ? new Date(v).getTime() : NaN; return Number.isFinite(t) ? t : 0; };

// Figures for ONE customer from their orders (narrow rows: total, refunded_amount, status, created_at).
//   orders / lifetime value / average order value count every order except Cancelled ones (a cancelled order was refunded
//   and never kept), and a partial refund lowers an order's value -- the same rule admin_customers() uses in SQL.
export function customerStats(orders) {
  const rows = Array.isArray(orders) ? orders : [];
  const kept = rows.filter(o => o && o.status !== 'Cancelled');
  const lifetime = round2(kept.reduce((s, o) => s + Math.max(0, n(o.total) - n(o.refunded_amount)), 0));
  const times = rows.map(o => time(o?.created_at)).filter(Boolean);
  return {
    placed: rows.length,
    orders: kept.length,
    cancelled: rows.length - kept.length,
    lifetime,
    average: kept.length ? round2(lifetime / kept.length) : 0,
    refunded: round2(kept.reduce((s, o) => s + n(o.refunded_amount), 0)),
    firstAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
    lastAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
  };
}

const dateOnly = (v) => (v ? String(v).slice(0, 10) : '');

// admin_customers() rows (+ marketing opt-in looked up from `profiles`) -> CSV. The opt-in is a COLUMN, never a filter:
// the owner decides what to do with it.
export const CUSTOMER_CSV_COLUMNS = [
  { label: 'Name', get: c => c.name || '' },
  { label: 'Email', get: c => c.email || '' },
  { label: 'Phone', get: c => c.phone || '' },
  { label: 'Orders', get: c => n(c.order_count) },
  { label: 'Total spent', get: c => round2(c.total_spent) },
  { label: 'Last order', get: c => dateOnly(c.last_order_at) },
  { label: 'Joined', get: c => dateOnly(c.created_at) },
  { label: 'Marketing opt-in', get: c => (c.marketing_opt_in === true ? 'Yes' : c.marketing_opt_in === false ? 'No' : '') },
  { label: 'Customer id', get: c => c.id },
];

// A saved address as the lines to show / copy.
export function addressText(a) {
  if (!a) return '';
  return [a.name, [a.line1, a.line2].filter(Boolean).join(', '), [a.city, [a.state, a.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', '), a.phone ? `Phone: ${a.phone}` : ''].filter(Boolean).join('\n');
}
