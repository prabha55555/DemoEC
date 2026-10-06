import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabase';
import { withTimeout } from '../../utils/withTimeout';
import { buildCountQuery } from '../hooks/serverList';
import { fetchAllCapped } from '../lib/queries';
import { searchTerms } from '../products/queryTools';

const chunk = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };
const uniq = (list) => Array.from(new Set(list));

// Products (name, picture, level) and variants (label, SKU) for the ids on screen -- the lists only hold ids, and
// embedded selects are not available, so these are two small follow-up queries. Returns { products, variants } as Maps.
export function useNames({ productIds = [], variantIds = [] }) {
  const pKey = uniq(productIds.filter(Boolean)).sort().join(',');
  const vKey = uniq(variantIds.filter(Boolean)).sort().join(',');
  const [state, setState] = useState({ products: new Map(), variants: new Map() });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const vIds = vKey ? vKey.split(',') : [];
        const variants = new Map();
        for (const part of chunk(vIds, 60)) {
          // eslint-disable-next-line
          const { data } = await withTimeout(supabase.from('product_variants').select('id, product_id, label, sku, stock, track_inventory, active').in('id', part), 15000);
          (data || []).forEach(v => variants.set(v.id, v));
        }
        const pIds = uniq([...(pKey ? pKey.split(',') : []), ...Array.from(variants.values()).map(v => v.product_id)]);
        const products = new Map();
        for (const part of chunk(pIds, 60)) {
          // eslint-disable-next-line
          const { data } = await withTimeout(supabase.from('products').select('id, name, brand, images, status, low_stock_threshold, product_number').in('id', part), 15000);
          (data || []).forEach(p => products.set(p.id, p));
        }
        if (!cancelled) setState({ products, variants });
      } catch { /* the rows still show; names fall back to "Product" */ }
    })();
    return () => { cancelled = true; };
  }, [pKey, vKey]);
  return state;
}

// The most recent stock movement of each variant on screen: { variantId: { delta, reason, created_at } }.
export function useLastMovements(variantIds) {
  const key = uniq(variantIds.filter(Boolean)).sort().join(',');
  const [last, setLast] = useState({});
  useEffect(() => {
    if (!key) { setLast({}); return undefined; }
    let cancelled = false;
    withTimeout(supabase.from('inventory_movements').select('variant_id, delta, reason, created_at').in('variant_id', key.split(',')).order('created_at', { ascending: false }).limit(600), 15000)
      .then(({ data }) => {
        if (cancelled) return;
        const map = {};
        (data || []).forEach((m) => { if (!map[m.variant_id]) map[m.variant_id] = m; });
        setLast(map);
      })
      .catch(() => { if (!cancelled) setLast({}); });
    return () => { cancelled = true; };
  }, [key]);
  return last;
}

// Product ids matching a name search and / or a set of categories, for filtering the variant list. `ready` is false
// while the lookup runs. Capped at `limit` ids (the URL carries them); `truncated` says so.
export function useProductIds({ text, categoryIds, limit = 300 }) {
  const words = searchTerms(text);
  const wordKey = words.join(' ');
  const catKey = categoryIds && categoryIds.length ? categoryIds.join(',') : '';
  const need = !!wordKey || !!catKey;
  const key = `${wordKey}|${catKey}`;
  const [state, setState] = useState({ key: '', ids: [], truncated: false });
  useEffect(() => {
    if (!need) return undefined;
    let cancelled = false;
    let q = supabase.from('products').select('id').limit(limit + 1);
    if (catKey) q = q.in('category_id', catKey.split(','));
    for (const w of words) q = q.ilike('search_text', `%${w}%`);
    withTimeout(q, 15000)
      .then(({ data }) => { if (!cancelled) setState({ key, ids: (data || []).slice(0, limit).map(r => r.id), truncated: (data || []).length > limit }); })
      .catch(() => { if (!cancelled) setState({ key, ids: [], truncated: false }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [key]);
  if (!need) return { ids: [], ready: true, truncated: false, active: false };
  return { ids: state.key === key ? state.ids : [], ready: state.key === key, truncated: state.key === key && state.truncated, active: true };
}

// The figures above the stock table. Counts are head queries; units and value come from one capped read of the
// tracked, active variants that have stock (two narrow columns).
export function useInventorySummary({ lowGroups, ready, nonce }) {
  const [s, setS] = useState({ loading: true, error: false, units: 0, value: 0, truncated: false, low: null, out: null });
  const groupKey = lowGroups.join(',');
  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;
    (async () => {
      const count = async (spec) => {
        try { const { count: n, error } = await withTimeout(buildCountQuery(supabase, spec), 15000); return error ? null : (n ?? 0); } catch { return null; }
      };
      const [low, out, read] = await Promise.all([
        count({ table: 'product_variants', filters: { $or: groupKey } }),
        count({ table: 'product_variants', filters: { active: true, track_inventory: true, stock: 0 } }),
        fetchAllCapped(() => supabase.from('product_variants').select('stock, price').eq('active', true).eq('track_inventory', true).gt('stock', 0).order('id'), { maxRows: 5000 }).catch(() => null),
      ]);
      if (cancelled) return;
      setS({
        loading: false, error: !read && low === null, low, out, truncated: !!read?.truncated,
        units: read ? read.rows.reduce((t, r) => t + (Number(r.stock) || 0), 0) : 0,
        value: read ? read.rows.reduce((t, r) => t + (Number(r.stock) || 0) * (Number(r.price) || 0), 0) : 0,
      });
    })();
    return () => { cancelled = true; };
  }, [groupKey, ready, nonce]);
  return useMemo(() => s, [s]);
}
