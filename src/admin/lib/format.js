// Display formatting for the admin. Every date is shown (and every day is bucketed) in Indian
// Standard Time regardless of the browser's own zone -- the store owner reads "today" as an
// Indian calendar day. IST has no daylight saving, so a fixed +05:30 offset is exact.
import { formatMoney as catalogFormatMoney } from '../../utils/catalog';

export const IST = 'Asia/Kolkata';
export const IST_OFFSET = '+05:30';

// "₹1,299" / "₹1,299.50" ('' for a non-number). Same rule the storefront uses.
export const formatMoney = catalogFormatMoney;

// Compact money for chart axes and tight tiles: ₹950, ₹1.2K, ₹3.4L, ₹2.1Cr (Indian grouping).
export function formatMoneyCompact(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  const abs = Math.abs(v);
  const trim = (x) => String(Math.round(x * 10) / 10).replace(/\.0$/, '');
  if (abs >= 1e7) return `₹${trim(v / 1e7)}Cr`;
  if (abs >= 1e5) return `₹${trim(v / 1e5)}L`;
  if (abs >= 1e3) return `₹${trim(v / 1e3)}K`;
  return `₹${Math.round(v)}`;
}

const toDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const dateFmt = new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
const shortFmt = new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: 'numeric', month: 'short' });
const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' });

// "06 Oct 2026"
export function formatDate(v) { const d = toDate(v); return d ? dateFmt.format(d) : ''; }
// "06 Oct 2026, 3:42 pm"
export function formatDateTime(v) { const d = toDate(v); return d ? dateTimeFmt.format(d).replace(/\b(AM|PM)\b/, m => m.toLowerCase()) : ''; }
// "6 Oct" -- chart labels
export function formatDayShort(v) { const d = toDate(v); return d ? shortFmt.format(d) : ''; }

// "just now" / "5 min ago" / "3 h ago" / "yesterday" / "12 Sep 2026"
export function relativeTime(v, now = Date.now()) {
  const d = toDate(v);
  if (!d) return '';
  const sec = Math.round((now - d.getTime()) / 1000);
  if (sec < 45) return 'just now';
  if (sec < 90 * 60) return `${Math.max(1, Math.round(sec / 60))} min ago`;
  if (sec < 22 * 3600) return `${Math.round(sec / 3600)} h ago`;
  if (sec < 36 * 3600) return 'yesterday';
  if (sec < 7 * 86400) return `${Math.round(sec / 86400)} days ago`;
  return formatDate(d);
}

// ---- IST calendar-day arithmetic (for "today / 7 days / 30 days" ranges and per-day buckets) ----

// 'YYYY-MM-DD' of the IST calendar day the instant falls on.
export function istDateKey(v = new Date()) { const d = toDate(v); return d ? keyFmt.format(d) : ''; }

// The UTC instant (ISO string) at which an IST calendar day starts -- usable directly in a
// Supabase `.gte('created_at', …)` filter.
export function istStartOfDayISO(key) { return new Date(`${key}T00:00:00${IST_OFFSET}`).toISOString(); }

// Add whole days to a 'YYYY-MM-DD' key (pure calendar arithmetic, no zone involved).
export function addDaysToKey(key, n) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// The last `n` IST calendar-day keys, oldest first, ending on today.
export function lastDayKeys(n, now = new Date()) {
  const today = istDateKey(now);
  return Array.from({ length: n }, (_, i) => addDaysToKey(today, i - (n - 1)));
}

// A FilterBar date range ('YYYY-MM-DD' from / to, either may be empty) as `created_at` filter operators:
// { gte: <start of the from-day IST>, lt: <start of the day AFTER the to-day IST> } -- so the whole last day counts.
// Spread it into useServerList's filters:  filters: { created_at: istRangeFilter(from, to) }
export function istRangeFilter(from, to) {
  const out = {};
  if (from) out.gte = istStartOfDayISO(from);
  if (to) out.lt = istStartOfDayISO(addDaysToKey(to, 1));
  return out;
}

// A YYYY-MM-DD key as a Date at noon UTC, for formatting a label without zone drift.
export function keyToDate(key) { return new Date(`${key}T12:00:00Z`); }

// Cleans a number string typed into a money/number box: keeps digits (and at most one dot with
// `decimals` places). Used by MoneyInput / NumberInput; exported for tests.
export function sanitizeDecimal(raw, decimals = 2) {
  let s = String(raw ?? '').replace(/[^\d.]/g, '');
  const dot = s.indexOf('.');
  if (dot !== -1) {
    const head = s.slice(0, dot);
    const tail = s.slice(dot + 1).replace(/\./g, '').slice(0, Math.max(0, decimals));
    s = decimals > 0 ? `${head}.${tail}` : head;
  }
  return s;
}

// '' / null / undefined / non-numeric -> `fallback`, else the Number.
export function parseNumber(v, fallback = null) {
  if (v === '' || v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
