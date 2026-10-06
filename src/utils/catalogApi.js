// Browser-side queries for the public catalogue. One place for the column lists and the
// filter/sort/pagination logic, so Shop, Home, search, related products and the cart all read the
// same shape. See docs/ECOMMERCE_REDESIGN.md B1.
//
// Everything runs through PostgREST with the visitor's own (anon) key -- RLS already hides draft
// products and inactive variants, so no query here needs to re-check that. Queries stay as separate
// round trips (no embedded joins) on purpose: simple, cacheable and easy to reason about.
import { supabase } from '../supabase';

// What a product CARD / list row needs. Never `select *` for lists: descriptions, attributes and
// highlights are long and only the product page reads them.
export const LIST_COLUMNS = [
  'id', 'name', 'brand', 'cat', 'category_id', 'subtitle', 'price', 'price_max', 'mrp', 'discount_pct',
  'in_stock', 'has_variants', 'badge', 'featured', 'images', 'image_position', 'option_types',
  'video_url', 'video_cover_url', 'video_cover_position',
  'rating_avg', 'rating_count', 'sales_count', 'free_shipping', 'delivery_min_days', 'delivery_max_days',
  'status', 'created_at',
].join(',');

export const SORT_OPTIONS = [
  { value: 'popular', label: 'Popularity' },
  { value: 'newest', label: 'Newest first' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'discount', label: 'Discount' },
  { value: 'rating', label: 'Customer rating' },
];

const ORDER_BY = {
  popular: [['sales_count', false], ['created_at', false]],
  newest: [['created_at', false]],
  price_asc: [['price', true]],
  price_desc: [['price', false]],
  discount: [['discount_pct', false], ['sales_count', false]],
  rating: [['rating_avg', false], ['rating_count', false]],
};

// ILIKE wildcards (% _) and the PostgREST list separators are escaped so a shopper typing "50%" or
// "a,b" searches for exactly that text.
export const searchWords = (text) =>
  String(text || '').toLowerCase().split(/\s+/).map(w => w.replace(/[%_\\,()*]/g, '')).filter(Boolean).slice(0, 6);

// Products matching the shop filters, one page at a time.
//   categoryIds  -> category and its descendants (use CatalogContext.descendantIds)
//   words        -> every word must appear in the product's search_text (name, brand, category, tags ...)
//   brands       -> any of
//   priceMin/Max -> inclusive range on the "from" price
//   attrs        -> { material: ['Cotton','Linen'] }  any-of per key, all keys must match
//   inStockOnly, minRating, minDiscount, featured -> simple filters
// Resolves { rows, count } -- count is the TOTAL matching, for "Showing 1-24 of 118" and the pager.
export async function fetchProducts({
  categoryIds, words = [], brands = [], priceMin, priceMax, attrs = {},
  inStockOnly = false, minRating = 0, minDiscount = 0, featured = false, ids,
  sort = 'popular', page = 1, pageSize = 24, columns = LIST_COLUMNS,
} = {}) {
  let q = supabase.from('products').select(columns, { count: 'exact' }).eq('status', 'active');
  if (ids?.length) q = q.in('id', ids);
  if (categoryIds?.length) q = q.in('category_id', categoryIds);
  for (const w of words) q = q.ilike('search_text', `%${w}%`);
  if (brands.length) q = q.in('brand', brands);
  if (Number.isFinite(Number(priceMin)) && priceMin !== '' && priceMin !== null && priceMin !== undefined) q = q.gte('price', Number(priceMin));
  if (Number.isFinite(Number(priceMax)) && priceMax !== '' && priceMax !== null && priceMax !== undefined && Number(priceMax) > 0) q = q.lte('price', Number(priceMax));
  for (const [key, values] of Object.entries(attrs)) {
    const list = (values || []).filter(Boolean);
    if (!list.length) continue;
    // attributes->>key IN (...)   (JSON path filter; keys are schema keys, never user text)
    if (/^[a-z0-9_]+$/i.test(key)) q = q.in(`attributes->>${key}`, list);
  }
  if (inStockOnly) q = q.eq('in_stock', true);
  if (minRating > 0) q = q.gte('rating_avg', minRating);
  if (minDiscount > 0) q = q.gte('discount_pct', minDiscount);
  if (featured) q = q.eq('featured', true);

  // sold-out products sink to the bottom of every sort instead of vanishing when the sort changes
  q = q.order('in_stock', { ascending: false });
  for (const [col, asc] of ORDER_BY[sort] || ORDER_BY.popular) q = q.order(col, { ascending: asc, nullsFirst: false });

  const from = Math.max(0, (page - 1) * pageSize);
  const { data, error, count } = await q.range(from, from + pageSize - 1);
  if (error) throw error;
  return { rows: data || [], count: count ?? (data || []).length };
}

// Left-rail facets for a filter scope: total, price range, brands (with counts), attribute values.
export async function fetchFacets({ categoryIds, words = [] } = {}) {
  const { data, error } = await supabase.rpc('catalog_facets', { p_category_ids: categoryIds?.length ? categoryIds : null, p_words: words.length ? words : null });
  if (error) throw error;
  return data || { total: 0, price_min: null, price_max: null, brands: [], attributes: {} };
}

// One product (full row) and its purchasable variants, or null when it does not exist / is a draft.
export async function fetchProduct(id) {
  const { data: product, error } = await supabase.from('products').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!product) return null;
  const { data: variants, error: vErr } = await supabase.from('product_variants').select('*').eq('product_id', id).order('position', { ascending: true });
  if (vErr) throw vErr;
  return { product, variants: variants || [] };
}

export async function fetchVariantsForProducts(productIds) {
  if (!productIds?.length) return [];
  const { data, error } = await supabase.from('product_variants').select('*').in('product_id', productIds).order('position', { ascending: true });
  if (error) throw error;
  return data || [];
}

// Related products: same category first, topped up from the parent category, never the product itself.
export async function fetchRelated(product, categories, limit = 8) {
  if (!product) return [];
  const exclude = [product.id];
  const take = async (categoryIds) => {
    let q = supabase.from('products').select(LIST_COLUMNS).eq('status', 'active').eq('in_stock', true).not('id', 'in', `(${exclude.join(',')})`);
    if (categoryIds?.length) q = q.in('category_id', categoryIds);
    const { data } = await q.order('sales_count', { ascending: false }).limit(limit);
    return data || [];
  };
  let rows = product.category_id ? await take([product.category_id]) : [];
  if (rows.length < limit && product.category_id) {
    const parent = (categories || []).find(c => c.id === product.category_id)?.parent_id;
    if (parent) {
      rows.forEach(r => exclude.push(r.id));
      const more = await take([parent, ...(categories || []).filter(c => c.parent_id === parent).map(c => c.id)]);
      rows = [...rows, ...more.filter(r => !rows.some(x => x.id === r.id))].slice(0, limit);
    }
  }
  return rows;
}

// Approved reviews for a product page (newest first).
export async function fetchReviews(productId, { limit = 20 } = {}) {
  const { data, error } = await supabase.from('reviews').select('id, user_name, rating, title, body, verified_purchase, created_at')
    .eq('product_id', productId).eq('status', 'approved').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}
