import { withTimeout } from '../../utils/withTimeout';

// Reads every row a query matches, one 1,000-row page at a time (the API's hard cap per request), up to `maxRows`.
// For BOUNDED aggregates only -- e.g. "orders in the last 30 days, three narrow columns" for a revenue figure.
// Never point it at a whole table. `makeQuery` must return a FRESH Supabase builder each call (a builder cannot be
// re-used once awaited), already filtered and ordered so paging is stable:
//   const { rows, truncated } = await fetchAllCapped(() => supabase.from('orders').select('total,status').gte('created_at', since).order('created_at'));
// truncated = there were more rows than maxRows, so any total built from `rows` is a lower bound.
export async function fetchAllCapped(makeQuery, { pageSize = 1000, maxRows = 5000, timeoutMs = 20000 } = {}) {
  const rows = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const to = Math.min(from + pageSize, maxRows) - 1;
    const { data, error } = await withTimeout(makeQuery().range(from, to), timeoutMs);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < to - from + 1) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}
