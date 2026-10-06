// Date ranges for the reports, in INDIA time: "today" and "this month" mean the Indian calendar day / month, whatever zone
// the browser is in. A range is a pair of 'YYYY-MM-DD' day keys, both INCLUSIVE; the database wants instants, so
// rangeBounds() turns it into [start of the first day, start of the day AFTER the last day) in IST.
import { addDaysToKey, formatDate, istDateKey, istStartOfDayISO, keyToDate } from '../lib/format';

export const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'custom', label: 'Custom' },
];
export const DEFAULT_PRESET = '30d';
export const MAX_RANGE_DAYS = 366;

const KEY = /^\d{4}-\d{2}-\d{2}$/;
const validKey = (k) => KEY.test(k || '') && !Number.isNaN(new Date(`${k}T00:00:00Z`).getTime());

export const monthStartKey = (key) => `${key.slice(0, 8)}01`;
export const lastDayOfPreviousMonth = (key) => addDaysToKey(monthStartKey(key), -1);

// Whole days from `from` to `to`, both counted.
export function daysInRange({ from, to }) {
  return Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1;
}

// A hand-typed range made safe: missing ends filled in, swapped if backwards, never in the future, at most a year long.
// `note` says what was changed, so the screen can tell the admin instead of silently showing something else.
export function normaliseCustom({ from, to }, today) {
  let a = validKey(from) ? from : '';
  let b = validKey(to) ? to : '';
  let note = '';
  if (!a && !b) return { from: addDaysToKey(today, -29), to: today, note: 'Pick a start and an end date.' };
  if (!a) a = b;
  if (!b) b = today;
  if (a > b) { [a, b] = [b, a]; note = 'The dates were the wrong way round, so they were swapped.'; }
  if (b > today) { b = today; note = 'The end date cannot be in the future, so it was set to today.'; }
  if (a > b) a = b;
  if (daysInRange({ from: a, to: b }) > MAX_RANGE_DAYS) { a = addDaysToKey(b, -(MAX_RANGE_DAYS - 1)); note = `A report covers at most ${MAX_RANGE_DAYS} days, so the start was moved.`; }
  return { from: a, to: b, note };
}

// preset + (for 'custom') the typed dates -> { from, to, note? } in IST day keys.
export function rangeFor(preset, now = new Date(), custom = {}) {
  const today = istDateKey(now);
  switch (preset) {
    case 'today': return { from: today, to: today };
    case '7d': return { from: addDaysToKey(today, -6), to: today };
    case '30d': return { from: addDaysToKey(today, -29), to: today };
    case 'month': return { from: monthStartKey(today), to: today };
    case 'last-month': { const to = lastDayOfPreviousMonth(today); return { from: monthStartKey(to), to }; }
    case 'custom': return normaliseCustom(custom, today);
    default: return rangeFor(DEFAULT_PRESET, now);
  }
}

// The instants to query with: from = 00:00 IST of the first day, to = 00:00 IST of the day after the last (exclusive).
export function rangeBounds({ from, to }) {
  return { fromISO: istStartOfDayISO(from), toISO: istStartOfDayISO(addDaysToKey(to, 1)) };
}

// Every day key in the range, oldest first.
export function eachDayKey({ from, to }) {
  const out = [];
  for (let k = from, i = 0; k <= to && i < MAX_RANGE_DAYS + 2; k = addDaysToKey(k, 1), i += 1) out.push(k);
  return out;
}

// "Today · 6 Oct 2026" / "1 Oct – 6 Oct 2026"
export function describeRange({ from, to }) {
  if (from === to) return formatDate(keyToDate(from));
  const a = formatDate(keyToDate(from));
  const b = formatDate(keyToDate(to));
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${sameYear ? a.replace(/ \d{4}$/, '') : a} – ${b}`;
}

// The Monday on or before a day key (weekly buckets for long ranges).
export function weekStartKey(key) {
  const d = new Date(`${key}T00:00:00Z`);
  return addDaysToKey(key, -((d.getUTCDay() + 6) % 7));
}
