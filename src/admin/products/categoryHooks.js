import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabase';
import { withTimeout } from '../../utils/withTimeout';
import { buildCountQuery } from '../hooks/serverList';
import { mapWithConcurrency } from '../lib/pool';
import { rollUpCounts } from './categoryTools';

// How many products sit in each category: one count-only (`head`) query per category, a few at a time, so no rows travel.
// Returns { own: {id: n}, totals: {id: {own, total}}, loading, error, reload }.
export default function useCategoryCounts(categories) {
  const [state, setState] = useState({ own: {}, loading: true, error: false });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce(n => n + 1), []);
  const key = categories.map(c => c.id).join(',');

  useEffect(() => {
    if (!categories.length) { setState({ own: {}, loading: false, error: false }); return undefined; }
    let cancelled = false;
    setState(s => ({ ...s, loading: true }));
    (async () => {
      const own = {};
      let failed = false;
      await mapWithConcurrency(categories, 6, async (c) => {
        try {
          const { count, error } = await withTimeout(buildCountQuery(supabase, { table: 'products', filters: { category_id: c.id } }), 15000);
          if (error) failed = true; else own[c.id] = count ?? 0;
        } catch { failed = true; }
      });
      if (!cancelled) setState({ own, loading: false, error: failed });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [key, nonce]);

  const totals = useMemo(() => rollUpCounts(categories, state.own), [categories, state.own]);
  return { own: state.own, totals, loading: state.loading, error: state.error, reload };
}

// A fresh count of the products directly in one category (used right before a delete, not the cached figure).
export async function countProductsIn(categoryId) {
  const { count, error } = await withTimeout(buildCountQuery(supabase, { table: 'products', filters: { category_id: categoryId } }), 15000);
  if (error) throw error;
  return count ?? 0;
}
