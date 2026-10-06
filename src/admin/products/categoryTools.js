// Pure helpers for the Categories screen and the category pickers (product form, product list, CSV import).
// Categories come as a flat list { id, parent_id, name, slug, sort_order, active, ... }; the UI is two levels deep
// (roots = groups, children = sub-categories), though the schema allows more and these helpers cope with it.
import { buildCategoryTree, categoryChain, descendantIds, slugify } from '../../utils/catalog';

export { slugify };

// ------------------------------------------------------------------------------------------------ slugs
export const isSlugTaken = (slug, categories, ownId = null) =>
  (categories || []).some(c => c.id !== ownId && String(c.slug).toLowerCase() === String(slug).toLowerCase());

// The slug for `name` that no other category uses: "men", then "men-2", "men-3" ...
export function uniqueSlug(name, categories, ownId = null) {
  const base = slugify(name);
  if (!isSlugTaken(base, categories, ownId)) return base;
  let n = 2;
  while (isSlugTaken(`${base}-${n}`, categories, ownId)) n += 1;
  return `${base}-${n}`;
}

// Why a typed slug is not acceptable ('' when fine). Slugs end up in storefront URLs (/shop/<slug>).
export function slugProblem(slug, categories, ownId = null) {
  const s = String(slug || '').trim();
  if (!s) return 'A slug is required.';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) return 'Use lowercase letters, numbers and single hyphens only (e.g. home-decor).';
  if (isSlugTaken(s, categories, ownId)) {
    const other = (categories || []).find(c => c.id !== ownId && String(c.slug).toLowerCase() === s.toLowerCase());
    return `The slug "${s}" is already used by "${other?.name || 'another category'}". Choose another.`;
  }
  return '';
}

// ------------------------------------------------------------------------------------------- tree / pickers
// roots with .children, sorted by sort_order then name.
export const treeOf = (categories) => buildCategoryTree(categories);

// Flat option list for a <select>, parents first with their children indented: [{ value, label, depth, category }].
export function treeOptions(categories, { excludeIds = [], indent = '— ' } = {}) {
  const skip = new Set(excludeIds);
  const out = [];
  const walk = (nodes, depth) => nodes.forEach((n) => {
    if (skip.has(n.id)) return;
    out.push({ value: n.id, label: `${depth ? indent.repeat(depth) : ''}${n.name}${n.active === false ? ' (hidden)' : ''}`, depth, category: n });
    walk(n.children || [], depth + 1);
  });
  walk(treeOf(categories), 0);
  return out;
}

// "Fashion > Men" (a root is just its name).
export function categoryPath(categories, id, sep = ' > ') {
  return categoryChain(categories, id).reverse().map(c => c.name).join(sep);
}

// Finds a category from CSV text: a full path ("Fashion > Men"), a slug, or a name that is unique. Returns
// { category } or { error }.
export function findCategoryByText(categories, text) {
  const t = String(text || '').trim();
  if (!t) return { category: null };
  const norm = (s) => String(s).replace(/\s*[>/›»]\s*/g, ' > ').trim().toLowerCase();
  const wanted = norm(t);
  const list = categories || [];
  const byPath = list.filter(c => norm(categoryPath(list, c.id)) === wanted);
  if (byPath.length === 1) return { category: byPath[0] };
  const byName = list.filter(c => String(c.name).trim().toLowerCase() === wanted);
  if (byName.length === 1) return { category: byName[0] };
  if (byName.length > 1) return { error: `"${t}" matches ${byName.length} categories - use the full path, e.g. "${categoryPath(list, byName[0].id)}".` };
  const bySlug = list.filter(c => String(c.slug).toLowerCase() === wanted);
  if (bySlug.length === 1) return { category: bySlug[0] };
  return { error: `Unknown category "${t}".` };
}

// -------------------------------------------------------------------------------------------- re-ordering
// Moves `id` one place up (-1) or down (+1) among its siblings and returns the sort_order patches
// [{ id, sort_order }] that renumber the whole sibling set 1..n (so equal or gappy values can never make a
// move a no-op). Only rows whose number changes are returned.
export function reorderPatches(categories, id, dir) {
  const me = (categories || []).find(c => c.id === id);
  if (!me) return [];
  const siblings = treeSiblings(categories, me.parent_id || null);
  const i = siblings.findIndex(c => c.id === id);
  const j = i + dir;
  if (i === -1 || j < 0 || j >= siblings.length) return [];
  const order = [...siblings];
  [order[i], order[j]] = [order[j], order[i]];
  return order.map((c, k) => ({ id: c.id, sort_order: k + 1 })).filter((p) => {
    const cur = siblings.find(c => c.id === p.id);
    return Number(cur.sort_order) !== p.sort_order;
  });
}

// Siblings in display order (sort_order, then name -- the same order the storefront menu uses).
export function treeSiblings(categories, parentId) {
  const list = (categories || []).filter(c => (c.parent_id || null) === (parentId || null));
  return list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name).localeCompare(String(b.name)));
}

// The sort_order a new category gets so it lands last among its siblings.
export const nextSortOrder = (categories, parentId) =>
  treeSiblings(categories, parentId).reduce((m, c) => Math.max(m, Number(c.sort_order) || 0), 0) + 1;

// ----------------------------------------------------------------------------------------- parent / delete rules
// Where a category may be moved: only to a root (two levels), never under itself, and a category that has
// sub-categories must stay a root (it would otherwise create a third level).
export function parentChoices(categories, id) {
  const list = categories || [];
  const hasKids = !!id && list.some(c => c.parent_id === id);
  if (hasKids) return [];
  return list.filter(c => !c.parent_id && c.id !== id);
}

export function wouldCycle(categories, id, parentId) {
  if (!parentId) return false;
  if (parentId === id) return true;
  return descendantIds(categories, id).includes(parentId);
}

// null when it can be deleted, else a sentence for the admin.
export function deleteBlocker({ name, childCount = 0, productCount = 0 }) {
  const parts = [];
  if (childCount > 0) parts.push(`${childCount} sub-categor${childCount === 1 ? 'y' : 'ies'}`);
  if (productCount > 0) parts.push(`${productCount} product${productCount === 1 ? '' : 's'}`);
  if (!parts.length) return null;
  const what = parts.join(' and ');
  if (childCount > 0 && productCount > 0) return `"${name}" still has ${what}. Move or delete the sub-categories, and move the products to another category first.`;
  if (childCount > 0) return `"${name}" still has ${what}. Move or delete the sub-categories first.`;
  return `"${name}" still has ${what}. Move the products to another category first.`;
}

// Product counts: own[id] = products directly in the category -> { own, total (with all descendants) } per id.
export function rollUpCounts(categories, own) {
  const out = {};
  for (const c of categories || []) {
    const ids = descendantIds(categories, c.id);
    out[c.id] = { own: own[c.id] || 0, total: ids.reduce((s, x) => s + (own[x] || 0), 0) };
  }
  return out;
}
