import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../supabase';
import { withTimeout } from '../../utils/withTimeout';
import { isAuthExpiredError } from '../../utils/safeFetch';
import { buildListQuery, clampPage, DEFAULT_PAGE_SIZE, isRangeError, pageCount, pageWindow } from './serverList';
import { notifyAuthExpired, friendlyDbError } from './adminWrite';

// Real server-side pagination for an admin list. One request per page: `select … { count: 'exact' }` +
// `.range(from, to)`, so a table of 50,000 rows costs the same as one of 50 (and nothing is silently
// truncated at the API's 1,000-row cap, which is what a whole-table `select('*')` used to hit).
//
//   const { rows, count, loading, error, page, setPage, reload } = useServerList({
//     table: 'orders',
//     select: 'id, order_id, user_name, total, status, created_at',
//     filters: { status: 'Placed', deleted_at: null },     // see applyFilters in ./serverList.js
//     search, searchColumns: ['order_id', 'user_name', 'user_email'],
//     orderBy: { column: 'created_at', ascending: false },
//     pageSize: 25,
//   });
//
// Changing filters / search / ordering / page size drops back to page 1 by itself. A page that no longer
// exists (you deleted the last row of the last page) steps back to the last real page. A response that
// arrives after a newer request was sent is ignored. Pass `page` + `onPageChange` to keep the page in the
// URL (see useUrlFilters); `enabled: false` pauses the query.
export default function useServerList({
  table, select = '*', filters, search = '', searchColumns, orderBy,
  pageSize = DEFAULT_PAGE_SIZE, page: controlledPage, onPageChange, enabled = true,
}) {
  // The whole query spec as one string: the effect below depends on it (and re-parses it), so callers can
  // pass fresh `filters` / `orderBy` object literals every render without causing a refetch loop.
  const specKey = JSON.stringify({ table, select, filters, search, searchColumns, orderBy, pageSize });

  const controlled = controlledPage !== undefined;
  const [pageInfo, setPageInfo] = useState({ key: specKey, page: 1 });
  // Uncontrolled: the stored page only counts for the spec it was set under, so any filter change is page 1
  // immediately (no wasted request for "page 4 of the new filter").
  const page = controlled ? Math.max(1, Number(controlledPage) || 1) : (pageInfo.key === specKey ? pageInfo.page : 1);

  const setPage = useCallback((p) => {
    const next = Math.max(1, Math.floor(Number(p)) || 1);
    if (controlled) { if (onPageChange) onPageChange(next); } else setPageInfo({ key: specKey, page: next });
  }, [controlled, onPageChange, specKey]);

  const [state, setState] = useState({ rows: [], count: 0, loading: !!enabled, error: null });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce(n => n + 1), []);
  const requestId = useRef(0);
  const setPageRef = useRef(setPage);
  useEffect(() => { setPageRef.current = setPage; }, [setPage]);

  useEffect(() => {
    if (!enabled) { setState(s => (s.loading ? { ...s, loading: false } : s)); return undefined; }
    const id = ++requestId.current;
    const spec = JSON.parse(specKey);
    setState(s => ({ ...s, loading: true, error: null }));
    (async () => {
      try {
        const res = await withTimeout(buildListQuery(supabase, { ...spec, page }), 20000);
        if (id !== requestId.current) return;
        if (res.error) {
          if (isRangeError(res.error) && page > 1) { setPageRef.current(1); return; }
          if (isAuthExpiredError(res.error)) notifyAuthExpired();
          setState(s => ({ ...s, loading: false, error: res.error }));
          return;
        }
        const count = res.count ?? (res.data || []).length;
        // The last page was emptied (or the filter shrank the list): step back instead of showing "no results".
        if (page > 1 && clampPage(page, count, spec.pageSize) < page) { setPageRef.current(clampPage(page, count, spec.pageSize)); return; }
        setState({ rows: res.data || [], count, loading: false, error: null });
      } catch (e) {
        if (id !== requestId.current) return;
        setState(s => ({ ...s, loading: false, error: { message: friendlyDbError(e) } }));
      }
    })();
    return () => { /* a superseded request is ignored through requestId */ };
  }, [specKey, page, nonce, enabled]);

  // Optimistic edits: setRows(rows => rows.map(…)) updates what is on screen until the next reload().
  const setRows = useCallback((fn) => setState(s => ({ ...s, rows: typeof fn === 'function' ? fn(s.rows) : fn })), []);

  const size = pageSize;
  return {
    rows: state.rows,
    count: state.count,
    loading: state.loading,
    error: state.error,
    page,
    setPage,
    pageSize: size,
    pageCount: pageCount(state.count, size),
    showing: pageWindow(page, state.count, size), // { from, to, total } for "Showing 26–50 of 132"
    reload,
    setRows,
  };
}
