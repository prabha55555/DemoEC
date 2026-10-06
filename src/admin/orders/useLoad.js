import { useCallback, useEffect, useRef, useState } from 'react';
import { withTimeout } from '../../utils/withTimeout';
import { isAuthExpiredError } from '../../utils/safeFetch';
import { friendlyDbError, notifyAuthExpired } from '../hooks/adminWrite';

// Awaits a Supabase query builder and returns its rows (throws the database error). For small, bounded reads that sit
// beside a record -- notes, a customer's returns -- NOT for lists (those use useServerList and its pagination).
export async function rowsOf(builder, ms = 15000) {
  const { data, error } = await withTimeout(builder, ms);
  if (error) throw error;
  return data || [];
}

// Runs an async loader and tracks { data, loading, error }, with reload(). A reply that arrives after a newer request was
// started is dropped. `loader` is called fresh each time (build the query INSIDE it); `deps` say when to run again.
//
//   const notes = useLoad(() => rowsOf(supabase.from('order_notes').select('id, note').eq('order_uuid', id)), [id], { enabled: !!id });
export default function useLoad(loader, deps = [], { enabled = true, initial = null } = {}) {
  const [state, setState] = useState({ data: initial, loading: !!enabled, error: null });
  const [nonce, setNonce] = useState(0);
  const request = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const reload = useCallback(() => setNonce(n => n + 1), []);
  const setData = useCallback((data) => setState(s => ({ ...s, data })), []);

  useEffect(() => {
    if (!enabled) { setState(s => (s.loading ? { ...s, loading: false } : s)); return undefined; }
    const id = ++request.current;
    setState(s => ({ ...s, loading: true, error: null }));
    (async () => {
      try {
        const data = await loaderRef.current();
        if (id === request.current) setState({ data, loading: false, error: null });
      } catch (e) {
        if (id !== request.current) return;
        if (isAuthExpiredError(e)) notifyAuthExpired();
        setState(s => ({ ...s, loading: false, error: { ...e, message: friendlyDbError(e) } }));
      }
    })();
  // `deps` is the caller's list of what to re-run on; the loader itself is read through a ref.
  // eslint-disable-next-line
  }, [...deps, nonce, enabled]);

  return { ...state, reload, setData };
}
