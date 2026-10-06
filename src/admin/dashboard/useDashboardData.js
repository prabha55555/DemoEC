import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../supabase';
import { withTimeout } from '../../utils/withTimeout';
import { addDaysToKey, istDateKey, istStartOfDayISO } from '../lib/format';
import { fetchAllCapped } from '../lib/queries';

// The dashboard's three independent reads. Each has its own loading / error / retry, so one slow or failed query
// never blanks the others, and a failure shows "Unable to load" -- never a misleading 0.
//
//   sales   orders of the last 30 IST days, three narrow columns (revenue, tiles, chart and status breakdown all derive
//           from this one bounded read; capped at 5,000 rows)
//   top     the 5 best-selling active products (products.sales_count)
//   latest  the 8 newest orders
// The "needs attention" figures are NOT fetched here: they come from useAdminCounts, shared with the bell and sidebar.
const initial = { data: null, loading: true, error: null };
const SALES_COLUMNS = 'created_at, total, refunded_amount, status';

export default function useDashboardData() {
  const [sales, setSales] = useState({ ...initial, truncated: false });
  const [top, setTop] = useState(initial);
  const [latest, setLatest] = useState(initial);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const loadSales = useCallback(async () => {
    setSales(s => ({ ...s, loading: true, error: null }));
    try {
      const since = istStartOfDayISO(addDaysToKey(istDateKey(), -29));
      const { rows, truncated } = await fetchAllCapped(() => supabase.from('orders').select(SALES_COLUMNS)
        .is('deleted_at', null).gte('created_at', since).order('created_at', { ascending: false }));
      if (mounted.current) setSales({ data: rows, loading: false, error: null, truncated });
    } catch (e) { if (mounted.current) setSales({ data: null, loading: false, error: e, truncated: false }); }
  }, []);

  const loadTop = useCallback(async () => {
    setTop(s => ({ ...s, loading: true, error: null }));
    try {
      const { data, error } = await withTimeout(supabase.from('products').select('id, name, images, price, sales_count')
        .eq('status', 'active').gt('sales_count', 0).order('sales_count', { ascending: false }).limit(5), 15000);
      if (error) throw error;
      if (mounted.current) setTop({ data: data || [], loading: false, error: null });
    } catch (e) { if (mounted.current) setTop({ data: null, loading: false, error: e }); }
  }, []);

  const loadLatest = useCallback(async () => {
    setLatest(s => ({ ...s, loading: true, error: null }));
    try {
      const { data, error } = await withTimeout(supabase.from('orders').select('id, order_id, user_name, user_email, total, status, payment_method, created_at')
        .is('deleted_at', null).order('created_at', { ascending: false }).limit(8), 15000);
      if (error) throw error;
      if (mounted.current) setLatest({ data: data || [], loading: false, error: null });
    } catch (e) { if (mounted.current) setLatest({ data: null, loading: false, error: e }); }
  }, []);

  useEffect(() => { loadSales(); loadTop(); loadLatest(); }, [loadSales, loadTop, loadLatest]);

  return { sales, top, latest, reload: { sales: loadSales, top: loadTop, latest: loadLatest } };
}
