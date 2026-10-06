// Pure logic behind the product form's "options & variants" editor: option types (Size, Colour ...) with their
// values, the variant table generated as their cartesian product, and the diff that turns the edited table into
// database writes. No React, no network -- everything here is unit-tested (variantMatrix.test.js).
//
// Shapes
//   option type  { id, name, values: ['S','M'] }             product.option_types stores { name, values } only
//   variant row  { key, id|null, options: {Size:'M'}, label: 'M / Red', sku, price, mrp, stock, track_inventory,
//                  active, weight_g, image_url }               numbers are STRINGS while editing (controlled inputs)
//
// Structural edits (add / rename / remove a value or an option) are DISCRETE operations that return the next
// { types, variants } -- never per keystroke -- so half-typed names can never delete a variant that holds stock.
import { variantLabelFromOptions } from '../../utils/catalog';

export const MAX_OPTION_TYPES = 3;
export const MAX_VARIANTS = 150;

const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const lc = (s) => squash(s).toLowerCase();

let seq = 0;
export const newKey = (prefix = 'v') => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

export function blankType(over = {}) {
  return { id: newKey('t'), name: '', values: [], ...over };
}

export function blankVariant(over = {}) {
  return {
    key: newKey(), id: null, options: {}, label: 'Default', sku: '', price: '', mrp: '', stock: '0',
    track_inventory: true, active: true, weight_g: '', image_url: '', ...over,
  };
}

// The option types that actually shape the variant table: a name, at least one value, no duplicates, at most 3.
// Names and values are whitespace-normalised, because variant `options` must equal the product's option values
// character for character (that is how the product page matches a selection to a variant).
export function effectiveTypes(types) {
  const names = new Set();
  const out = [];
  for (const t of types || []) {
    const name = squash(t?.name);
    if (!name || names.has(lc(name))) continue;
    const seen = new Set();
    const values = [];
    for (const v of t.values || []) {
      const s = squash(v);
      if (s && !seen.has(lc(s))) { seen.add(lc(s)); values.push(s); }
    }
    if (!values.length) continue;
    names.add(lc(name));
    out.push({ name, values });
    if (out.length === MAX_OPTION_TYPES) break;
  }
  return out;
}

// [{Size:'S',Colour:'Red'}, {Size:'S',Colour:'Blue'}, ...] -- the first type is the outermost loop. No types -> [{}].
export function cartesian(types) {
  let acc = [{}];
  for (const t of types) {
    const next = [];
    for (const base of acc) for (const v of t.values) next.push({ ...base, [t.name]: v });
    acc = next;
  }
  return acc;
}

// How many variants these option types generate (1 when there are none).
export function comboCount(types) {
  return effectiveTypes(types).reduce((n, t) => n * t.values.length, 1);
}

// A stable identity for an options object, whatever order its keys were written in.
export const optionsKey = (options) => JSON.stringify(Object.keys(options || {}).sort().map(k => [k, String(options[k])]));

// What product.option_types is saved as.
export const optionTypesPayload = (types) => effectiveTypes(types).map(t => ({ name: t.name, values: t.values }));

// Form option types from a saved product (ids are only for React keys).
export function typesFromRecord(optionTypes) {
  return (Array.isArray(optionTypes) ? optionTypes : [])
    .filter(t => t && squash(t.name))
    .map(t => blankType({ name: squash(t.name), values: (Array.isArray(t.values) ? t.values : []).map(squash).filter(Boolean) }));
}

// Rewrites every variant so its options / label match `types`, appending a row for each combination that is
// missing (new rows copy price / MRP / weight / tracking from `seed`, by default the first existing row) and
// returning the rows that no longer match any combination as `removed`. The result is in table order.
export function reconcileVariants(variants, types, seed) {
  const eff = effectiveTypes(types);
  const byKey = new Map();
  for (const v of variants || []) if (!byKey.has(optionsKey(v.options))) byKey.set(optionsKey(v.options), v);
  const base = seed || (variants || [])[0] || {};
  const used = new Set();
  const rows = cartesian(eff).map((options) => {
    const label = variantLabelFromOptions(options, eff);
    const existing = byKey.get(optionsKey(options));
    if (existing) { used.add(existing.key); return { ...existing, options, label }; }
    return blankVariant({ options, label, price: base.price ?? '', mrp: base.mrp ?? '', track_inventory: base.track_inventory ?? true, weight_g: base.weight_g ?? '' });
  });
  return { variants: rows, removed: (variants || []).filter(v => !used.has(v.key)) };
}

// Drops one option from every variant (removing an option type). Variants that become identical collapse into
// the first of them (the rest are `removed`). Returns { variants, removed }.
function collapseWithout(variants, name) {
  const kept = new Map();
  const removed = [];
  for (const v of variants) {
    const options = Object.fromEntries(Object.entries(v.options || {}).filter(([k]) => k !== name));
    const k = optionsKey(options);
    if (kept.has(k)) { removed.push(v); continue; }
    kept.set(k, { ...v, options });
  }
  return { variants: [...kept.values()], removed };
}

const fail = (error) => ({ ok: false, error });
const typeIndex = (types, id) => types.findIndex(t => t.id === id);

export function addType(state) {
  if (state.types.length >= MAX_OPTION_TYPES) return fail(`A product can have at most ${MAX_OPTION_TYPES} options.`);
  return { ok: true, types: [...state.types, blankType()], variants: state.variants, removed: [] };
}

// Names the option (or renames it: every variant's options key and label are rewritten).
export function setTypeName(state, typeId, rawName) {
  const i = typeIndex(state.types, typeId);
  if (i === -1) return fail('That option no longer exists.');
  const name = squash(rawName);
  if (!name) return fail('Give the option a name, e.g. Size or Colour.');
  if (name.length > 30) return fail('Option names can be at most 30 characters.');
  if (state.types.some((t, j) => j !== i && lc(t.name) === lc(name))) return fail(`There is already an option called "${name}".`);
  const old = squash(state.types[i].name);
  const types = state.types.map((t, j) => (j === i ? { ...t, name } : t));
  if (!old || old === name || !state.types[i].values.length) return { ok: true, types, variants: state.variants, removed: [] };
  const variants = state.variants.map((v) => {
    if (!(old in (v.options || {}))) return v;
    const options = Object.fromEntries(Object.entries(v.options).map(([k, val]) => [k === old ? name : k, val]));
    return { ...v, options };
  });
  const r = reconcileVariants(variants, types);
  return { ok: true, types, variants: r.variants, removed: r.removed };
}

// Adds a value. The first value of an option makes it "real": existing variants adopt it (a simple product's
// Default variant becomes "S", keeping its stock and SKU), and every other combination is generated.
export function addValue(state, typeId, rawValue) {
  const i = typeIndex(state.types, typeId);
  if (i === -1) return fail('That option no longer exists.');
  const t = state.types[i];
  const value = squash(rawValue);
  if (!squash(t.name)) return fail('Name the option first (e.g. Size), then add its values.');
  if (!value) return fail('Type a value to add, e.g. M.');
  if (value.length > 40) return fail('Option values can be at most 40 characters.');
  if (t.values.some(v => lc(v) === lc(value))) return fail(`"${value}" is already a ${t.name} value.`);
  const types = state.types.map((x, j) => (j === i ? { ...x, values: [...x.values, value] } : x));
  const count = comboCount(types);
  if (count > MAX_VARIANTS) return fail(`That would create ${count} variants. The limit is ${MAX_VARIANTS}; remove some values first.`);
  let variants = state.variants;
  if (!t.values.length) variants = variants.map(v => ({ ...v, options: { ...(v.options || {}), [squash(t.name)]: value } }));
  const r = reconcileVariants(variants, types);
  return { ok: true, types, variants: r.variants, removed: r.removed };
}

// Renames one value everywhere (types and every variant that carries it).
export function renameValue(state, typeId, from, rawTo) {
  const i = typeIndex(state.types, typeId);
  if (i === -1) return fail('That option no longer exists.');
  const t = state.types[i];
  const to = squash(rawTo);
  if (!to) return fail('A value cannot be empty.');
  if (to.length > 40) return fail('Option values can be at most 40 characters.');
  if (to === from) return { ok: true, types: state.types, variants: state.variants, removed: [] };
  if (t.values.some(v => v !== from && lc(v) === lc(to))) return fail(`"${to}" is already a ${t.name} value.`);
  const name = squash(t.name);
  const types = state.types.map((x, j) => (j === i ? { ...x, values: x.values.map(v => (v === from ? to : v)) } : x));
  const variants = state.variants.map(v => (String((v.options || {})[name]) === from ? { ...v, options: { ...v.options, [name]: to } } : v));
  const r = reconcileVariants(variants, types);
  return { ok: true, types, variants: r.variants, removed: r.removed };
}

// Removes a value and the variants that use it (returned as `removed` so the caller can confirm / account for
// stock). Removing an option's LAST value removes the option from every variant instead.
export function removeValue(state, typeId, value) {
  const i = typeIndex(state.types, typeId);
  if (i === -1) return fail('That option no longer exists.');
  const t = state.types[i];
  const name = squash(t.name);
  if (t.values.length <= 1) {
    const c = collapseWithout(state.variants, name);
    const types = state.types.map((x, j) => (j === i ? { ...x, values: [] } : x));
    const r = reconcileVariants(c.variants, types);
    return { ok: true, types, variants: r.variants, removed: [...c.removed, ...r.removed] };
  }
  const types = state.types.map((x, j) => (j === i ? { ...x, values: x.values.filter(v => v !== value) } : x));
  const r = reconcileVariants(state.variants, types);
  return { ok: true, types, variants: r.variants, removed: r.removed };
}

export function removeType(state, typeId) {
  const i = typeIndex(state.types, typeId);
  if (i === -1) return fail('That option no longer exists.');
  const t = state.types[i];
  const types = state.types.filter((_, j) => j !== i);
  if (!t.values.length) return { ok: true, types, variants: state.variants, removed: [] };
  const c = collapseWithout(state.variants, squash(t.name));
  const r = reconcileVariants(c.variants, types);
  return { ok: true, types, variants: r.variants, removed: [...c.removed, ...r.removed] };
}

// Moves an option up (-1) or down (+1): variant labels follow the option order ("M / Red" -> "Red / M").
export function moveType(state, typeId, dir) {
  const i = typeIndex(state.types, typeId);
  const j = i + dir;
  if (i === -1 || j < 0 || j >= state.types.length) return { ok: true, types: state.types, variants: state.variants, removed: [] };
  const types = [...state.types];
  [types[i], types[j]] = [types[j], types[i]];
  const r = reconcileVariants(state.variants, types);
  return { ok: true, types, variants: r.variants, removed: r.removed };
}

// Turning options off keeps ONE variant (the first row) as the Default; the others are `removed`.
export function disableOptions(state) {
  const [first, ...rest] = state.variants;
  const keep = first ? { ...first, options: {}, label: 'Default' } : blankVariant();
  return { ok: true, types: [], variants: [keep], removed: rest };
}

// "Apply to all": sets one field on every row (or only the active ones).
export function applyToAll(variants, field, value, { onlyActive = false } = {}) {
  return variants.map(v => (onlyActive && !v.active ? v : { ...v, [field]: value }));
}

// Variants that would be thrown away and hold units (the caller asks before doing it).
export const removedWithStock = (removed) => (removed || []).filter(v => v.id && v.track_inventory !== false && Number(v.stock) > 0);

// ---------------------------------------------------------------------------------------------- save diff
const numOrNull = (v) => { const s = String(v ?? '').trim(); if (s === '') return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const intOrNull = (v) => { const n = numOrNull(v); return n === null ? null : Math.trunc(n); };
const textOrNull = (v) => { const s = String(v ?? '').trim(); return s || null; };

// A form row as the columns that are stored (stock is handled separately: it only ever changes through
// admin_adjust_stock on an existing variant).
export function variantColumns(row, position) {
  return {
    sku: textOrNull(row.sku),
    options: row.options || {},
    label: row.label || 'Default',
    price: numOrNull(row.price),
    mrp: numOrNull(row.mrp),
    track_inventory: row.track_inventory !== false,
    weight_g: intOrNull(row.weight_g),
    image_url: textOrNull(row.image_url),
    active: row.active !== false,
    position,
  };
}

const COMPARED = ['sku', 'label', 'price', 'mrp', 'track_inventory', 'weight_g', 'image_url', 'active', 'position'];

// What is saved vs what is in the form.
//   base      the variant rows as loaded from the database ([] for a new product)
//   rows      the edited table, in display order
// Returns
//   inserts       [{ row, columns, opening }]  brand-new variants (stock is written as 0, `opening` is given through
//                                              admin_adjust_stock so the ledger shows it)
//   updates       [{ id, patch, optionsChanged }]   only the columns that changed -- never stock
//   deletes       [id]                          rows that were removed from the table
//   stockChanges  [{ id, from, to }]            existing, tracked rows whose stock number was edited
export function diffVariants(base, rows) {
  const byId = new Map((base || []).map(v => [v.id, v]));
  const inserts = [];
  const updates = [];
  const stockChanges = [];
  const keep = new Set();
  rows.forEach((row, position) => {
    const cols = variantColumns(row, position);
    const old = row.id ? byId.get(row.id) : null;
    if (!old) {
      const opening = row.track_inventory !== false ? Math.max(0, intOrNull(row.stock) ?? 0) : 0;
      inserts.push({ row, columns: cols, opening });
      return;
    }
    keep.add(old.id);
    const patch = {};
    for (const c of COMPARED) {
      const before = c === 'sku' ? textOrNull(old.sku)
        : c === 'price' ? numOrNull(old.price)
          : c === 'mrp' ? numOrNull(old.mrp)
            : c === 'weight_g' ? intOrNull(old.weight_g)
              : c === 'image_url' ? textOrNull(old.image_url)
                : c === 'track_inventory' ? old.track_inventory !== false
                  : c === 'active' ? old.active !== false
                    : old[c];
      if (before !== cols[c]) patch[c] = cols[c];
    }
    const optionsChanged = optionsKey(old.options) !== optionsKey(cols.options);
    if (optionsChanged) patch.options = cols.options;
    if (Object.keys(patch).length) updates.push({ id: old.id, patch, optionsChanged });
    const tracked = cols.track_inventory;
    const to = intOrNull(row.stock);
    if (tracked && to !== null && to >= 0 && to !== Number(old.stock)) stockChanges.push({ id: old.id, from: Number(old.stock), to });
  });
  const deletes = (base || []).filter(v => !keep.has(v.id)).map(v => v.id);
  return { inserts, updates, deletes, stockChanges };
}

// True when nothing would be written.
export const diffIsEmpty = (d) => !d.inserts.length && !d.updates.length && !d.deletes.length && !d.stockChanges.length;

// ------------------------------------------------------------------------------------------------ SKU helpers
// A suggested SKU: PREFIX-S-RED (letters and digits only), unique among `taken` (a Set of lower-cased SKUs).
export function suggestSku(prefix, options, taken) {
  const clean = (v) => String(v).toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 12);
  const base = [clean(prefix) || 'SKU', ...Object.values(options || {}).map(clean).filter(Boolean)].join('-');
  let sku = base;
  let n = 2;
  while (taken.has(sku.toLowerCase())) { sku = `${base}-${n}`; n += 1; }
  return sku;
}

// Adopts the ids the database gave to rows that were new when the form was saved, so a retry updates them instead of
// inserting a duplicate. Matches by option combination (unique per product).
export function mergeVariantIds(rows, freshVariants) {
  const byKey = new Map((freshVariants || []).map(v => [optionsKey(v.options), v]));
  return rows.map((r) => {
    if (r.id) return { ...r, key: r.id };
    const v = byKey.get(optionsKey(r.options));
    return v ? { ...r, id: v.id, key: v.id } : r;
  });
}
