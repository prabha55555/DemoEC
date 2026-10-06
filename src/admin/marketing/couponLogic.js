// The pure rules behind the coupon screens: which bucket a coupon is in right now, how to ask the database for each bucket,
// what a coupon says in words, and the form's validation -- the same rules the server enforces in src/utils/pricing.js
// (couponProblem / couponDiscountOf), so a coupon that saves here behaves the way its form says it will at checkout.
import { IST_OFFSET } from '../lib/format';

const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const t = (v) => { const x = v ? new Date(v).getTime() : NaN; return Number.isFinite(x) ? x : null; };

export const COUPON_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'expired', label: 'Expired' },
  { value: 'exhausted', label: 'Used up' },
  { value: 'inactive', label: 'Switched off' },
];

export const isExhausted = (c) => num(c.max_uses) > 0 && num(c.times_used) >= num(c.max_uses);

// Every coupon is in exactly ONE bucket, checked in this order, so the tab counts always add up:
//   inactive (switched off) > expired > scheduled (not started) > exhausted (max uses reached) > active
export function couponStatus(c, now = new Date()) {
  if (!c || c.active === false) return 'inactive';
  const at = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const end = t(c.expires_at);
  if (end !== null && end < at) return 'expired';
  const start = t(c.starts_at);
  if (start !== null && start > at) return 'scheduled';
  if (isExhausted(c)) return 'exhausted';
  return 'active';
}

const NIL = '00000000-0000-0000-0000-000000000000'; // "no ids": an empty `in` list is ignored by the list helper, this matches nothing

// The `filters` object (see hooks/serverList.js applyFilters) that selects ONE bucket on the server.
// PostgREST cannot compare two columns, so "times_used >= max_uses" is answered from `exhaustedIds`, a small separate read
// of the coupons that have a limit (see exhaustedCouponIds in CouponsPage).
export function couponStatusFilters(status, now = new Date(), exhaustedIds = []) {
  if (!status) return {};
  const iso = (now instanceof Date ? now : new Date(now)).toISOString();
  const notExpired = `expires_at.is.null,expires_at.gte.${iso}`;
  const started = `starts_at.is.null,starts_at.lte.${iso}`;
  const idList = `(${exhaustedIds.join(',')})`;
  switch (status) {
    case 'inactive': return { active: false };
    case 'expired': return { active: true, expires_at: { lt: iso } };
    case 'scheduled': return { active: true, starts_at: { gt: iso }, $or: notExpired };
    case 'exhausted': return { active: true, id: exhaustedIds.length ? exhaustedIds : [NIL], $or: `and(or(${notExpired}),or(${started}))` };
    case 'active': return { active: true, ...(exhaustedIds.length ? { id: { not: ['in', idList] } } : {}), $or: `and(or(${notExpired}),or(${started}))` };
    default: return {};
  }
}

// ------------------------------------------------------------------------------------------ wording
const rupees = (v) => `₹${num(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

// "10% off up to ₹150" / "₹100 off"
export function describeOffer(c) {
  if (!c) return '';
  if (c.type === 'percent') {
    const cap = num(c.max_discount);
    return `${num(c.value)}% off${cap > 0 ? ` up to ${rupees(cap)}` : ''}`;
  }
  return `${rupees(c.value)} off`;
}

// What the coupon applies to.
export function describeScope(c, categoryNames = {}) {
  const products = Array.isArray(c?.product_ids) ? c.product_ids.length : 0;
  const cats = Array.isArray(c?.category_ids) ? c.category_ids : [];
  if (c?.applies_to === 'products') return `${products} product${products === 1 ? '' : 's'}`;
  if (c?.applies_to === 'bundle') return `Bundle of ${products} products`;
  if (c?.applies_to === 'categories') {
    const names = cats.map(id => categoryNames[id]).filter(Boolean);
    return names.length && names.length <= 2 ? names.join(', ') : `${cats.length} categor${cats.length === 1 ? 'y' : 'ies'}`;
  }
  return 'All products';
}

export const describeUsage = (c) => `${num(c.times_used)} / ${num(c.max_uses) > 0 ? num(c.max_uses) : '∞'}`;

export function describeLimits(c) {
  const parts = [];
  if (c.first_order_only) parts.push('First order only');
  if (num(c.per_user_limit) > 0) parts.push(`${num(c.per_user_limit)} per customer`);
  return parts.length ? parts.join(' · ') : 'No limit';
}

// ------------------------------------------------------------------------------------------ the form
// All text fields hold STRINGS (as the kit's inputs do); lists hold ids; dates are IST wall-clock "YYYY-MM-DDTHH:mm".
export const EMPTY_COUPON_FORM = {
  code: '', description: '', type: 'percent', value: '', max_discount: '', min_order_value: '',
  applies_to: 'all', product_ids: [], category_ids: [], starts_at: '', expires_at: '', max_uses: '', per_user_limit: '',
  first_order_only: false, is_public: true, active: true,
};

// An instant -> the value of an <input type="datetime-local"> showing India time ('' for none).
export function istInputValue(iso) {
  const ms = t(iso);
  if (ms === null) return '';
  const shifted = new Date(ms + 5.5 * 3600 * 1000);
  return shifted.toISOString().slice(0, 16);
}
// ...and back: the admin types India time; we store the instant.
export function istInputToISO(local) {
  if (!local || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const d = new Date(`${local}:00${IST_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function couponToForm(c) {
  return {
    code: c.code || '', description: c.description || '', type: c.type === 'flat' ? 'flat' : 'percent',
    value: c.value === null || c.value === undefined ? '' : String(c.value),
    max_discount: c.max_discount === null || c.max_discount === undefined ? '' : String(c.max_discount),
    min_order_value: num(c.min_order_value) > 0 ? String(c.min_order_value) : '',
    applies_to: ['products', 'bundle', 'categories'].includes(c.applies_to) ? c.applies_to : 'all',
    product_ids: Array.isArray(c.product_ids) ? c.product_ids.slice() : [], category_ids: Array.isArray(c.category_ids) ? c.category_ids.slice() : [],
    starts_at: istInputValue(c.starts_at), expires_at: istInputValue(c.expires_at),
    max_uses: num(c.max_uses) > 0 ? String(c.max_uses) : '', per_user_limit: num(c.per_user_limit) > 0 ? String(c.per_user_limit) : '',
    first_order_only: !!c.first_order_only, is_public: c.is_public !== false, active: c.active !== false,
  };
}

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,19}$/;
export const normaliseCode = (v) => String(v || '').trim().toUpperCase().replace(/\s+/g, '');

// { field: message } -- empty when the form is fine. Mirrors pricing.js: percent is capped at 100 there, a bundle needs
// ALL its items in the cart, a category coupon needs a category, "ends" has to come after "starts".
export function validateCoupon(f, { now = new Date() } = {}) {
  const e = {};
  const code = normaliseCode(f.code);
  if (!code) e.code = 'Enter a code, or press Generate.';
  else if (!CODE_RE.test(code)) e.code = 'Use 3 to 20 letters, numbers, dashes or underscores (no spaces).';

  const raw = String(f.value ?? '').trim();
  const value = Number(raw);
  if (raw === '' || !Number.isFinite(value)) e.value = 'Enter the discount.';
  else if (f.type === 'percent' && (value < 1 || value > 100)) e.value = 'A percentage must be between 1 and 100.';
  else if (f.type !== 'percent' && !(value > 0)) e.value = 'The amount must be more than ₹0.';

  const minRaw = String(f.min_order_value ?? '').trim();
  if (minRaw !== '' && !(Number(minRaw) >= 0)) e.min_order_value = 'Enter 0 or more.';

  if (f.type === 'percent') {
    const capRaw = String(f.max_discount ?? '').trim();
    if (capRaw !== '' && !(Number(capRaw) > 0)) e.max_discount = 'The cap must be more than ₹0 (or leave it blank for no cap).';
  }

  if (f.applies_to === 'products' && (f.product_ids || []).length < 1) e.applies_to = 'Pick at least one product.';
  else if (f.applies_to === 'bundle' && (f.product_ids || []).length < 2) e.applies_to = 'A bundle needs at least two products: the coupon only works when ALL of them are in the cart.';
  else if (f.applies_to === 'categories' && (f.category_ids || []).length < 1) e.applies_to = 'Pick at least one category.';

  const start = f.starts_at ? istInputToISO(f.starts_at) : null;
  const end = f.expires_at ? istInputToISO(f.expires_at) : null;
  if (f.starts_at && !start) e.starts_at = 'That date and time is not valid.';
  if (f.expires_at && !end) e.expires_at = 'That date and time is not valid.';
  if (start && end && new Date(end) <= new Date(start)) e.expires_at = 'The end must be after the start.';

  for (const key of ['max_uses', 'per_user_limit']) {
    const r = String(f[key] ?? '').trim();
    if (r !== '' && !(Number.isInteger(Number(r)) && Number(r) >= 0)) e[key] = 'Enter a whole number, or leave it blank for no limit.';
  }
  return e;
}

// Non-blocking heads-ups for a form that is valid.
export function couponWarnings(f, now = new Date()) {
  const w = [];
  const end = f.expires_at ? istInputToISO(f.expires_at) : null;
  if (end && new Date(end) < now) w.push('The end date is in the past: customers will see this coupon as expired.');
  if (f.first_order_only || Number(f.per_user_limit) > 0) w.push('Customers must be signed in to use this coupon. Guests are told "Sign in to use this coupon." because "first order" and "per customer" can only be checked for an account.');
  if (f.type === 'flat' && Number(f.min_order_value) > 0 && Number(f.value) >= Number(f.min_order_value)) w.push('The discount is as large as the minimum order, so qualifying orders could be free or nearly free.');
  if (f.active === false) w.push('This coupon is switched off: customers cannot use it until you switch it on.');
  return w;
}

// The row to write. Lists are kept only for the scope that uses them; numbers are numbers; blank limits are NULL (unlimited).
export function couponPayload(f) {
  const percent = f.type === 'percent';
  const maxUses = Math.floor(num(f.max_uses));
  const perUser = Math.floor(num(f.per_user_limit));
  return {
    code: normaliseCode(f.code),
    description: String(f.description || '').trim(),
    type: percent ? 'percent' : 'flat',
    value: num(f.value),
    max_discount: percent && num(f.max_discount) > 0 ? num(f.max_discount) : null,
    min_order_value: num(f.min_order_value) > 0 ? num(f.min_order_value) : 0,
    applies_to: ['products', 'bundle', 'categories'].includes(f.applies_to) ? f.applies_to : 'all',
    product_ids: ['products', 'bundle'].includes(f.applies_to) ? Array.from(new Set(f.product_ids || [])) : [],
    category_ids: f.applies_to === 'categories' ? Array.from(new Set(f.category_ids || [])) : [],
    starts_at: f.starts_at ? istInputToISO(f.starts_at) : null,
    expires_at: f.expires_at ? istInputToISO(f.expires_at) : null,
    max_uses: maxUses > 0 ? maxUses : null,
    per_user_limit: perUser > 0 ? perUser : null,
    first_order_only: !!f.first_order_only,
    is_public: f.is_public !== false,
    active: f.active !== false,
  };
}

// "SAVE-7KQ2XM": a memorable prefix and six characters without look-alikes (no 0/O, 1/I). `random` is injectable for tests.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generateCode(prefix = 'SAVE', random = Math.random) {
  let out = '';
  for (let i = 0; i < 6; i += 1) out += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return `${normaliseCode(prefix) || 'SAVE'}-${out}`;
}

// A copy of a coupon for the "Duplicate" action: same rules, a fresh code, switched off until the admin is ready.
export function duplicateForm(c, random = Math.random) {
  return { ...couponToForm(c), code: generateCode('COPY', random), active: false };
}

// Deleting a coupon that has been used would orphan the orders that point at it: suggest switching it off instead.
export function deleteBlocker(c, orderCount = 0) {
  const used = num(c?.times_used);
  if (used > 0 || orderCount > 0) {
    const n = Math.max(used, orderCount);
    return `${c.code} has been used on ${n} order${n === 1 ? '' : 's'}, so it cannot be deleted. Switch it off instead: it stays in your records but customers can no longer use it.`;
  }
  return '';
}

// What a coupon did: from its orders (narrow rows: discount, total, status). Cancelled orders gave the use back.
export function couponUsageStats(orders) {
  const rows = Array.isArray(orders) ? orders : [];
  const kept = rows.filter(o => o && o.status !== 'Cancelled');
  const discount = kept.reduce((s, o) => s + num(o.discount), 0);
  return {
    orders: kept.length, cancelled: rows.length - kept.length,
    discount: Math.round(discount * 100) / 100,
    revenue: Math.round(kept.reduce((s, o) => s + num(o.total), 0) * 100) / 100,
  };
}
