import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../supabase';
import { withTimeout } from '../../utils/withTimeout';
import { isAuthExpiredError } from '../../utils/safeFetch';
import { notifyAuthExpired, friendlyDbError } from './adminWrite';

// Loads ONE row for an edit screen: useRecord('stories', id) -> { record, loading, error, notFound, reload }.
// A null/undefined id (the "new" screen) does nothing and reports loading: false. `column` defaults to 'id'.
//   const { record, loading, notFound } = useRecord('coupons', id);
export default function useRecord(table, id, { column = 'id', select = '*' } = {}) {
  const [state, setState] = useState({ record: null, loading: !!id, error: null, notFound: false });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce(n => n + 1), []);

  useEffect(() => {
    if (!id) { setState({ record: null, loading: false, error: null, notFound: false }); return undefined; }
    let cancelled = false;
    setState(s => ({ ...s, loading: true, error: null, notFound: false }));
    (async () => {
      try {
        const { data, error } = await withTimeout(supabase.from(table).select(select).eq(column, id).maybeSingle(), 15000);
        if (cancelled) return;
        if (error) {
          if (isAuthExpiredError(error)) notifyAuthExpired();
          setState({ record: null, loading: false, error: { ...error, message: friendlyDbError(error) }, notFound: false });
        } else setState({ record: data, loading: false, error: null, notFound: !data });
      } catch (e) {
        if (!cancelled) setState({ record: null, loading: false, error: { message: friendlyDbError(e) }, notFound: false });
      }
    })();
    return () => { cancelled = true; };
  }, [table, id, column, select, nonce]);

  return { ...state, reload };
}
