// Pure query builders shared by the Products list and the Inventory screen: PostgREST `or=(…)` groups for "low stock"
// (each product may have its own level) combined with a text search, and the list sort options.
//
// useServerList accepts ONE raw `$or` string, but "low stock" and "search" are both OR-shaped, so they are combined
// by expanding (A or B) and (C or D) into one OR of ANDs: or( and(A,C), and(A,D), and(B,C), and(B,D) ).

// "and(a,b)" -> "a,b"; a bare condition stays as it is.
const inner = (part) => { const m = /^and\((.*)\)$/.exec(part); return m ? m[1] : part; };

// parts: arrays of OR-alternatives. [] means "no constraint". Returns the combined or-string ('' when none).
export function combineOr(groupsA, groupsB) {
  const a = (groupsA || []).filter(Boolean);
  const b = (groupsB || []).filter(Boolean);
  if (!a.length && !b.length) return '';
  if (!a.length) return b.join(',');
  if (!b.length) return a.join(',');
  const out = [];
  for (const x of a) for (const y of b) out.push(`and(${inner(x)},${inner(y)})`);
  return out.join(',');
}

const uniq = (list) => Array.from(new Set(list));

// "At or below its own low-stock level" as OR-alternatives. Products that set their own level (`overrides`:
// [{ id, level }]) are grouped by level; everyone else uses `storeLevel`.
//   column     the stock number to compare ('stock' on variants, 'total_stock' on products)
//   idColumn   how a row points at its product ('product_id' on variants, 'id' on products)
//   extra      conditions every alternative also needs (['active.eq.true', 'track_inventory.eq.true'])
// Overrides beyond `maxOverrides` are ignored here (the URL would get too long); the caller shows a note.
export function lowStockGroups({ column, idColumn, storeLevel, overrides = [], extra = [], maxOverrides = 120 }) {
  const level = Number.isFinite(Number(storeLevel)) ? Number(storeLevel) : 5;
  const list = overrides.filter(o => o && o.id && Number.isFinite(Number(o.level))).slice(0, maxOverrides);
  const base = extra.join(',');
  const wrap = (...conds) => `and(${[base, ...conds].filter(Boolean).join(',')})`;
  if (!list.length) return [wrap(`${column}.lte.${level}`)];
  const byLevel = new Map();
  for (const o of list) byLevel.set(Number(o.level), [...(byLevel.get(Number(o.level)) || []), o.id]);
  const all = uniq(list.map(o => o.id));
  const groups = [wrap(`${idColumn}.not.in.(${all.join(',')})`, `${column}.lte.${level}`)];
  for (const [lv, ids] of byLevel) groups.push(wrap(`${idColumn}.in.(${uniq(ids).join(',')})`, `${column}.lte.${lv}`));
  return groups;
}

// The words of a search box, safe for an `ilike` inside an or-string.
export const searchTerms = (text) => String(text || '').toLowerCase().split(/\s+/).map(w => w.replace(/[%_\\,()*"']/g, '')).filter(Boolean).slice(0, 6);

// Alternatives matching a product by its search_text (every word must appear) or by explicit ids.
export function productSearchGroups({ words = [], ids = [], textColumn = 'search_text', idColumn = 'id' }) {
  const out = [];
  if (words.length) out.push(words.length === 1 ? `${textColumn}.ilike.%${words[0]}%` : `and(${words.map(w => `${textColumn}.ilike.%${w}%`).join(',')})`);
  if (ids.length) out.push(`${idColumn}.in.(${uniq(ids).join(',')})`);
  return out;
}

// ------------------------------------------------------------------------------------------------- list sorting
// URL value -> order spec for useServerList. Every sort ends on id so a page boundary never repeats / skips a row.
const TIE = [{ column: 'id', ascending: true }];
export const PRODUCT_SORTS = {
  newest: [{ column: 'created_at', ascending: false }, ...TIE],
  oldest: [{ column: 'created_at', ascending: true }, ...TIE],
  name_asc: [{ column: 'name', ascending: true }, ...TIE],
  name_desc: [{ column: 'name', ascending: false }, ...TIE],
  price_asc: [{ column: 'price', ascending: true, nullsFirst: false }, ...TIE],
  price_desc: [{ column: 'price', ascending: false, nullsFirst: false }, ...TIE],
  stock_asc: [{ column: 'total_stock', ascending: true }, ...TIE],
  stock_desc: [{ column: 'total_stock', ascending: false }, ...TIE],
  sales_desc: [{ column: 'sales_count', ascending: false }, { column: 'created_at', ascending: false }, ...TIE],
  sales_asc: [{ column: 'sales_count', ascending: true }, { column: 'created_at', ascending: false }, ...TIE],
};
export const SORT_CHOICES = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name_asc', label: 'Name A–Z' },
  { value: 'name_desc', label: 'Name Z–A' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'stock_asc', label: 'Stock: low to high' },
  { value: 'stock_desc', label: 'Stock: high to low' },
  { value: 'sales_desc', label: 'Best selling' },
];
export const productOrder = (sort) => PRODUCT_SORTS[sort] || PRODUCT_SORTS.newest;

// A column header click toggles asc <-> desc for its field: 'name' -> name_asc / name_desc.
export function toggleSort(current, field) {
  const [f, dir] = [String(current || '').replace(/_(asc|desc)$/, ''), /_asc$/.test(current || '') ? 'asc' : 'desc'];
  if (f === field) return `${field}_${dir === 'asc' ? 'desc' : 'asc'}`;
  return `${field}_${field === 'sales' ? 'desc' : 'asc'}`;
}
export function sortState(current) {
  const m = /^(name|price|stock|sales)_(asc|desc)$/.exec(current || '');
  return m ? { key: m[1], dir: m[2] } : undefined;
}
