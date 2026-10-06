// Pure catalogue helpers shared by the storefront, the admin and the server (api/*.js).
// No React, no network. See docs/ECOMMERCE_REDESIGN.md (Part B1).
//
// Vocabulary
//   product   -> marketing data + list-page rollups (price, mrp, in_stock, has_variants ...)
//   variant   -> the purchasable item: { id, product_id, sku, options, label, price, mrp,
//                stock, track_inventory, active, image_url, weight_g, position }
//   options   -> { Size: 'M', Colour: 'Red' }   (keys = product.option_types[].name)
//   selection -> the options the shopper has picked so far (may be partial)

// ---------------------------------------------------------------------------- money
// Whole rupees show without decimals, fractions with two ('₹1,299' / '₹1,299.50').
export function formatMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  const whole = Math.abs(v - Math.round(v)) < 0.005;
  return '₹' + v.toLocaleString('en-IN', whole ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function discountPercent(price, mrp) {
  const p = Number(price), m = Number(mrp);
  if (!Number.isFinite(p) || !Number.isFinite(m) || m <= 0 || p >= m) return 0;
  return Math.round(((m - p) / m) * 100);
}

export function savingsAmount(price, mrp) {
  const p = Number(price), m = Number(mrp);
  return Number.isFinite(p) && Number.isFinite(m) && m > p ? Math.round((m - p) * 100) / 100 : 0;
}

// What a product card / search row shows. Uses the rollup columns the database keeps current.
//   { from, to, mrp, percentOff, isRange }  -- `from` is the lowest selling price.
export function priceRange(product) {
  const from = Number(product?.price);
  const to = Number(product?.price_max);
  const mrp = Number(product?.mrp);
  const hasFrom = Number.isFinite(from) && from > 0;
  return {
    from: hasFrom ? from : null,
    to: Number.isFinite(to) && to > from ? to : null,
    mrp: Number.isFinite(mrp) && mrp > from ? mrp : null,
    percentOff: hasFrom ? discountPercent(from, mrp) : 0,
    isRange: Number.isFinite(to) && to > from,
  };
}

// ------------------------------------------------------------------------ inventory
export function isVariantPurchasable(v) {
  if (!v || v.active === false) return false;
  return v.track_inventory === false || Number(v.stock) > 0;
}

// Units still available, or null when the variant is not stock-tracked.
export function variantStock(v) {
  if (!v || v.track_inventory === false) return null;
  const n = Number(v.stock);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

// The most a shopper may put in the cart for one variant: stock (if tracked) and the product's
// per-order cap, whichever is lower.
export function maxPurchasableQty(variant, product) {
  const cap = Number(product?.max_qty_per_order);
  const orderCap = Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : 10;
  const stock = variantStock(variant);
  return stock === null ? orderCap : Math.min(stock, orderCap);
}

// { state: 'in' | 'low' | 'out', left, text } for the buy box. `threshold` is the store/product
// low-stock level; untracked variants are always 'in' with no count shown.
export function stockStatus(variant, threshold = 5) {
  if (!isVariantPurchasable(variant)) return { state: 'out', left: 0, text: 'Out of stock' };
  const left = variantStock(variant);
  if (left === null) return { state: 'in', left: null, text: 'In stock' };
  const t = Number(threshold);
  if (left <= (Number.isFinite(t) && t > 0 ? t : 5)) return { state: 'low', left, text: `Only ${left} left` };
  return { state: 'in', left, text: 'In stock' };
}

// A product is sold out when every purchasable option is. Prefer the database rollup.
export function isProductSoldOut(product, variants) {
  if (Array.isArray(variants) && variants.length) return !variants.some(isVariantPurchasable);
  return product?.in_stock === false;
}

// ------------------------------------------------------------------- option selection
export function optionNames(product) {
  return (Array.isArray(product?.option_types) ? product.option_types : []).map(o => o.name).filter(Boolean);
}

// 'M / Red' -- ordered like product.option_types. No options -> 'Default'.
export function variantLabelFromOptions(options, optionTypes) {
  const opts = options && typeof options === 'object' ? options : {};
  const order = (Array.isArray(optionTypes) ? optionTypes : []).map(o => o.name);
  const keys = [...order.filter(k => k in opts), ...Object.keys(opts).filter(k => !order.includes(k))];
  const parts = keys.map(k => String(opts[k] ?? '').trim()).filter(Boolean);
  return parts.length ? parts.join(' / ') : 'Default';
}

// The variant whose options equal `selection` exactly (every option chosen). Else undefined.
export function findVariantBySelection(variants, selection) {
  const sel = selection || {};
  const keys = Object.keys(sel);
  return (variants || []).find(v => {
    if (v.active === false) return false;
    const o = v.options || {};
    const vk = Object.keys(o);
    return vk.length === keys.length && vk.every(k => String(o[k]) === String(sel[k]));
  });
}

// Initial selection for a product page: the first purchasable variant (so the page opens on
// something the shopper can buy), else the first variant. Returns { selection, variant }.
export function defaultSelection(variants) {
  const list = (variants || []).filter(v => v.active !== false).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const v = list.find(isVariantPurchasable) || list[0];
  return { selection: v ? { ...(v.options || {}) } : {}, variant: v || null };
}

// How a single option value should look given what is already chosen for the OTHER options:
//   'available' - at least one in-stock variant has it
//   'soldout'   - variants exist but none can be bought (show struck-through, still clickable)
//   'invalid'   - no variant has this combination (hide or disable)
export function optionValueState(variants, optionName, value, selection) {
  const others = Object.entries(selection || {}).filter(([k]) => k !== optionName);
  const candidates = (variants || []).filter(v => {
    if (v.active === false) return false;
    const o = v.options || {};
    if (String(o[optionName]) !== String(value)) return false;
    return others.every(([k, val]) => String(o[k]) === String(val));
  });
  if (!candidates.length) return 'invalid';
  return candidates.some(isVariantPurchasable) ? 'available' : 'soldout';
}

// Picking a value may make the rest of the selection impossible (e.g. Red does not come in XL).
// Returns a selection that is valid, keeping as much of the current one as possible.
export function reconcileSelection(variants, optionName, value, selection) {
  const next = { ...(selection || {}), [optionName]: value };
  if (findVariantBySelection(variants, next)) return next;
  const v = (variants || []).filter(x => x.active !== false && String((x.options || {})[optionName]) === String(value))
    .sort((a, b) => Number(isVariantPurchasable(b)) - Number(isVariantPurchasable(a)) || (a.position ?? 0) - (b.position ?? 0))[0];
  return v ? { ...(v.options || {}) } : next;
}

// ------------------------------------------------------------------------------ cart
// A cart line is identified by its variant; gift cards by their own id.
export const lineKey = (item) => (item?.isGiftCard ? `gc:${item.id}` : String(item?.variantId ?? ''));

// The snapshot kept in the cart. Prices are for DISPLAY only -- the server re-prices from the
// database at checkout.
export function cartLineFromVariant(product, variant, { categoryIds = [], qty = 1 } = {}) {
  const images = Array.isArray(product?.images) ? product.images : [];
  return {
    id: product.id,
    variantId: variant.id,
    sku: variant.sku || null,
    name: product.name,
    variantLabel: variant.label && variant.label !== 'Default' ? variant.label : '',
    options: variant.options || {},
    price: Number(variant.price),
    mrp: variant.mrp != null && Number(variant.mrp) > Number(variant.price) ? Number(variant.mrp) : null,
    image: variant.image_url || images[0] || null,
    brand: product.brand || null,
    cat: product.cat || null,
    categoryIds,
    stock: variantStock(variant),
    maxQty: maxPurchasableQty(variant, product),
    freeShipping: !!product.free_shipping,
    codAllowed: product.cod_allowed !== false,
    deliveryMinDays: product.delivery_min_days ?? null,
    deliveryMaxDays: product.delivery_max_days ?? null,
    qty,
  };
}

// ------------------------------------------------------------------------- categories
export function slugify(name) {
  return String(name || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'category';
}

export function buildCategoryTree(categories) {
  const list = (categories || []).map(c => ({ ...c, children: [] }));
  const byId = new Map(list.map(c => [c.id, c]));
  const roots = [];
  for (const c of list) {
    const parent = c.parent_id ? byId.get(c.parent_id) : null;
    (parent ? parent.children : roots).push(c);
  }
  const sort = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name).localeCompare(String(b.name));
  roots.sort(sort);
  list.forEach(c => c.children.sort(sort));
  return roots;
}

// [leaf, parent, grandparent ...]
export function categoryChain(categories, id) {
  const byId = new Map((categories || []).map(c => [c.id, c]));
  const chain = [];
  const seen = new Set();
  let cur = id ? byId.get(id) : null;
  while (cur && !seen.has(cur.id)) {
    chain.push(cur);
    seen.add(cur.id);
    cur = cur.parent_id ? byId.get(cur.parent_id) : null;
  }
  return chain;
}

export const categoryIdsWithAncestors = (categories, id) => categoryChain(categories, id).map(c => c.id);

// The category and everything beneath it -- what "show me Fashion" must match.
export function descendantIds(categories, id) {
  const out = [id];
  const walk = (pid) => (categories || []).filter(c => c.parent_id === pid).forEach(c => { out.push(c.id); walk(c.id); });
  walk(id);
  return out;
}

// Attribute definitions that apply to a category: the root's first, then each child's, de-duplicated by key.
export function attributeSchemaFor(categories, id) {
  const seen = new Set();
  const out = [];
  for (const c of categoryChain(categories, id).reverse()) {
    for (const a of Array.isArray(c.attribute_schema) ? c.attribute_schema : []) {
      if (a?.key && !seen.has(a.key)) { seen.add(a.key); out.push(a); }
    }
  }
  return out;
}

const prettyKey = (k) => String(k).replace(/[_-]+/g, ' ').replace(/^\w/, c => c.toUpperCase());

// Rows for the product page's specification table: schema attributes first (in schema order),
// then any extra keys the product carries. Empty values are dropped.
export function specRows(product, categories) {
  const attrs = product?.attributes && typeof product.attributes === 'object' ? product.attributes : {};
  const schema = attributeSchemaFor(categories, product?.category_id);
  const rows = [];
  const used = new Set();
  const show = (v) => (Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v ?? '').trim());
  for (const a of schema) {
    const v = show(attrs[a.key]);
    used.add(a.key);
    if (v) rows.push({ key: a.key, label: a.label || prettyKey(a.key), value: a.unit ? `${v} ${a.unit}` : v });
  }
  for (const [k, raw] of Object.entries(attrs)) {
    if (used.has(k)) continue;
    const v = show(raw);
    if (v) rows.push({ key: k, label: prettyKey(k), value: v });
  }
  return rows;
}

// ---------------------------------------------------------------------------- badges
// One merchandising badge (e.g. "Bestseller") plus the automatic "% OFF" -- never more than two pills.
export function productBadges(product) {
  const badge = String(product?.badge || '').split('|')[0].trim();
  const off = discountPercent(product?.price, product?.mrp);
  return [badge, off >= 5 ? `${off}% OFF` : ''].filter(Boolean);
}
