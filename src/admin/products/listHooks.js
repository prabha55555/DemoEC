import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabase';
import { withTimeout } from '../../utils/withTimeout';
import { buildCountQuery } from '../hooks/serverList';
import { lowStockGroups } from './queryTools';

// Small data hooks for the product list and the inventory screens.

// Product ids that own a variant whose SKU contains `text` (so searching a SKU finds its product). `ready` is false
// while the lookup for the current text is running -- the list waits for it instead of flashing unfiltered rows.
export function useSkuMatches(text) {
  const term = String(text || '').trim();
  const [state, setState] = useState({ term: '', ids: [] });
  useEffect(() => {
    if (term.length < 2) return undefined;
    let cancelled = false;
    withTimeout(supabase.from('product_variants').select('product_id').ilike('sku', `%${term.replace(/[%_\\]/g, m => `\\${m}`)}%`).limit(300), 15000)
      .then(({ data }) => { if (!cancelled) setState({ term, ids: Array.from(new Set((data || []).map(r => r.product_id))) }); })
      .catch(() => { if (!cancelled) setState({ term, ids: [] }); });
    return () => { cancelled = true; };
  }, [term]);
  if (term.length < 2) return { ids: [], ready: true };
  return { ids: state.term === term ? state.ids : [], ready: state.term === term };
}

// Products that set their own low-stock level (a handful, normally). Loaded once while `enabled`.
export function useLevelOverrides(enabled) {
  const [state, setState] = useState({ rows: null, error: false });
  useEffect(() => {
    if (!enabled || state.rows) return undefined;
    let cancelled = false;
    withTimeout(supabase.from('products').select('id, low_stock_threshold').not('low_stock_threshold', 'is', null).limit(500), 15000)
      .then(({ data, error }) => { if (!cancelled) setState({ rows: error ? [] : (data || []).map(r => ({ id: r.id, level: Number(r.low_stock_threshold) })), error: !!error }); })
      .catch(() => { if (!cancelled) setState({ rows: [], error: true }); });
    return () => { cancelled = true; };
  }, [enabled, state.rows]);
  return { overrides: state.rows || [], ready: !enabled || !!state.rows };
}

// "Low stock" as OR-alternatives for the product list (total_stock) or the inventory list (stock).
export function useLowStockGroups({ enabled, storeLevel, column, idColumn, extra }) {
  const { overrides, ready } = useLevelOverrides(enabled);
  const groups = enabled ? lowStockGroups({ column, idColumn, storeLevel, overrides, extra }) : [];
  return { groups, ready, truncated: overrides.length > 120 };
}

// Counts per product status for the tabs above the list (global, not filtered).
export function useStatusCounts() {
  const [counts, setCounts] = useState({ all: null, active: null, draft: null, archived: null });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce(n => n + 1), []);
  useEffect(() => {
    let cancelled = false;
    const one = async (filters) => {
      try { const { count, error } = await withTimeout(buildCountQuery(supabase, { table: 'products', filters }), 15000); return error ? null : (count ?? 0); } catch { return null; }
    };
    Promise.all([one({}), one({ status: 'active' }), one({ status: 'draft' }), one({ status: 'archived' })])
      .then(([all, active, draft, archived]) => { if (!cancelled) setCounts({ all, active, draft, archived }); });
    return () => { cancelled = true; };
  }, [nonce]);
  return { counts, reload };
}
