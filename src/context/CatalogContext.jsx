import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '../supabase';
import { withTimeout } from '../utils/withTimeout';
import { buildCategoryTree, categoryChain, categoryIdsWithAncestors, descendantIds } from '../utils/catalog';

// The category tree, loaded once for the whole app (header menu, shop filters, product pages, cart
// categories). Categories are a handful of rows, so one small query is cheaper than asking per page.
//
//   categories   flat, active only, ordered
//   tree         roots with .children (two levels in the UI, deeper allowed by the schema)
//   byId / bySlug
//   chain(id)               [leaf, parent, ...]
//   idsWithAncestors(id)    ids for coupon matching
//   descendantIds(id)       the category and everything beneath it (what "show Fashion" must match)
//   refresh()               re-fetch (the admin calls it after editing categories)
const CatalogContext = createContext({
  categories: [], tree: [], byId: new Map(), bySlug: new Map(), loading: true,
  chain: () => [], idsWithAncestors: () => [], descendantIds: (id) => [id], refresh: () => {},
});
export const useCatalog = () => useContext(CatalogContext);

export function CatalogProvider({ children }) {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data } = await withTimeout(
        supabase.from('categories').select('*').eq('active', true).order('sort_order', { ascending: true }).order('name', { ascending: true }),
        8000
      );
      if (Array.isArray(data)) setCategories(data);
    } catch { /* keep whatever we had; the shop still works without a menu */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const value = useMemo(() => ({
    categories,
    tree: buildCategoryTree(categories),
    byId: new Map(categories.map(c => [c.id, c])),
    bySlug: new Map(categories.map(c => [c.slug, c])),
    loading,
    chain: (id) => categoryChain(categories, id),
    idsWithAncestors: (id) => categoryIdsWithAncestors(categories, id),
    descendantIds: (id) => descendantIds(categories, id),
    refresh: load,
  }), [categories, loading, load]);

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}
