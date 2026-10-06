// Pure logic for the Inventory screen: stock states, the "Adjust stock" maths, ledger labels. No React, no network
// (unit-tested in inventoryLogic.test.js).

import { friendlyDbError } from '../hooks/adminWrite';

// Why stock moved. The dialog offers the first six; the others are written by checkout, cancellations and older screens.
export const ADJUST_REASONS = [
  { value: 'restock', label: 'Received stock' },
  { value: 'recount', label: 'Recount' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'return', label: 'Returned' },
  { value: 'correction', label: 'Correction' },
  { value: 'other', label: 'Other' },
];

export const REASON_LABELS = {
  sale: 'Sale', restock: 'Received stock', adjustment: 'Adjustment', cancel: 'Order cancelled', return: 'Returned',
  correction: 'Correction', recount: 'Recount', damaged: 'Damaged', other: 'Other',
};
export const reasonLabel = (code) => REASON_LABELS[code] || (code ? String(code).replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()) : '—');

// Filter list for the ledger (value = stored code).
export const LEDGER_REASONS = ['sale', 'restock', 'recount', 'damaged', 'return', 'cancel', 'correction', 'adjustment', 'other']
  .map(value => ({ value, label: REASON_LABELS[value] }));

// The level at or below which a product's variants count as "low": the product's own, else the store's.
export function lowStockLevel(product, brand) {
  const own = product?.low_stock_threshold;
  if (own !== null && own !== undefined && own !== '' && Number.isFinite(Number(own))) return Math.max(0, Number(own));
  const store = Number(brand?.low_stock_threshold);
  return Number.isFinite(store) && store >= 0 ? store : 5;
}

// 'untracked' (unlimited) | 'out' | 'low' | 'in' for a variant row.
export function variantStockState(variant, level) {
  if (!variant || variant.track_inventory === false) return 'untracked';
  const n = Number(variant.stock);
  if (!Number.isFinite(n) || n <= 0) return 'out';
  return n <= Number(level) ? 'low' : 'in';
}

export const STATE_LABELS = { in: 'In stock', low: 'Low stock', out: 'Out of stock', untracked: 'Unlimited' };

// ---------------------------------------------------------------------------------------- adjust dialog maths
// mode: 'add' | 'remove' | 'set'; qty: the typed string; current: the stock now.
// -> { ok: true, args: { p_delta } | { p_set_to }, delta, resulting } or { ok: false, error }.
export function planAdjustment({ mode, qty, current }) {
  const cur = Number(current) || 0;
  const raw = String(qty ?? '').trim();
  if (raw === '') return { ok: false, error: 'Enter a quantity.' };
  if (!/^\d+$/.test(raw)) return { ok: false, error: 'Enter a whole number.' };
  const n = Number(raw);
  if (n > 1000000) return { ok: false, error: 'That quantity is too large.' };
  if (mode === 'set') return { ok: true, args: { p_set_to: n }, delta: n - cur, resulting: n };
  if (n === 0) return { ok: false, error: 'Enter a quantity above zero.' };
  if (mode === 'remove') {
    if (n > cur) return { ok: false, error: `You can't remove more than the ${cur} in stock.` };
    return { ok: true, args: { p_delta: -n }, delta: -n, resulting: cur - n };
  }
  return { ok: true, args: { p_delta: n }, delta: n, resulting: cur + n };
}

// "+5" / "−3" / "0" for the ledger's change column.
export const signed = (n) => { const v = Number(n) || 0; return v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0'; };

// An order number like BL-20001 (what sale / cancel / return rows reference).
export const isOrderRef = (ref) => /^[A-Za-z]{2,6}-\d{3,}$/.test(String(ref || '').trim());

// One bulk or quick-restock run: the rows that will be written and why any are skipped.
export function planBulk({ mode, qty, rows }) {
  const plan = [];
  const skipped = [];
  for (const r of rows) {
    if (r.track_inventory === false) { skipped.push({ row: r, reason: 'Not stock-tracked' }); continue; }
    const p = planAdjustment({ mode, qty, current: r.stock });
    if (!p.ok) { skipped.push({ row: r, reason: p.error }); continue; }
    if (p.delta === 0) { skipped.push({ row: r, reason: 'Already at that level' }); continue; }
    plan.push({ row: r, args: p.args, delta: p.delta, resulting: p.resulting });
  }
  return { plan, skipped };
}

// A failed admin_adjust_stock call as a sentence an admin can act on.
export function stockErrorMessage(error) {
  const msg = error?.message || '';
  const m = /below zero \(would be (-?\d+)\)/i.exec(msg);
  if (m) return `Stock can't go below zero (that would leave ${m[1]}).`;
  if (/not authorized/i.test(msg) || String(error?.code) === '42501') return "You don't have permission to change stock - are you signed in as the store admin?";
  if (/VARIANT_NOT_FOUND/.test(msg)) return 'That variant no longer exists.';
  return friendlyDbError(error);
}
