import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabase';
import { buildCategoryTree, categoryChain, descendantIds } from '../../utils/catalog';
import { fetchAllCapped } from '../lib/queries';
import { friendlyDbError } from '../hooks/adminWrite';

// Every category INCLUDING the hidden (inactive) ones -- the storefront's CatalogContext only loads active ones, but
// the admin must be able to file a product under, edit or re-activate a hidden category. A handful of rows, read once
// per screen with an explicit column list.
export const CATEGORY_COLUMNS = 'id, parent_id, name, slug, description, image_url, sort_order, active, attribute_schema, gst_rate, hsn_code';

export default function useAdminCategories() {
  const [state, setState] = useState({ categories: [], loading: true, error: null });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce(n => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState(s => ({ ...s, loading: true, error: null }));
    fetchAllCapped(() => supabase.from('categories').select(CATEGORY_COLUMNS).order('sort_order', { ascending: true }).order('name', { ascending: true }).order('id', { ascending: true }), { maxRows: 3000 })
      .then(({ rows }) => { if (!cancelled) setState({ categories: rows, loading: false, error: null }); })
      .catch((e) => { if (!cancelled) setState(s => ({ ...s, loading: false, error: { message: friendlyDbError(e) } })); });
    return () => { cancelled = true; };
  }, [nonce]);

  const { categories } = state;
  return useMemo(() => ({
    categories,
    tree: buildCategoryTree(categories),
    byId: new Map(categories.map(c => [c.id, c])),
    loading: state.loading,
    error: state.error,
    reload,
    chain: (id) => categoryChain(categories, id),
    descendantIds: (id) => descendantIds(categories, id),
  }), [categories, state.loading, state.error, reload]);
}
