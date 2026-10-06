import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../../supabase';
import { useBrand } from '../../context/BrandContext';
import { withTimeout } from '../../utils/withTimeout';
import { buildCountQuery } from './serverList';

// The "needs attention" figures, fetched ONCE for the whole admin and shared by the top-bar bell, the sidebar
// badges and the dashboard tiles (so they can never disagree). Every figure is a count-only `head` query: no rows travel.
//
//   const { counts, loading, refresh } = useAdminCounts();   counts.ordersAwaiting -> number | null (null = failed to load)
//
// Call refresh() after you change something that moves a count (an order status, a return decision, a moderated review).
// They also refresh themselves every minute, when the tab regains focus, and on navigation (at most every 20 s).
const REFRESH_MS = 60000;
const MIN_GAP_MS = 20000;

// Order statuses that mean "the store has something to do" (legacy Paid / Pending count as Placed).
export const AWAITING_STATUSES = ['Placed', 'Confirmed', 'Packed', 'Paid', 'Pending'];

// One entry per figure: used by the bell menu and the dashboard tiles so the wording and links stay identical.
export const ATTENTION_ITEMS = [
  { key: 'ordersAwaiting', label: 'Orders awaiting action', hint: 'Placed, confirmed or packed', to: '/admin/orders?status=Placed,Confirmed,Packed', icon: 'cart', tone: 'warning' },
  { key: 'returnsToReview', label: 'Returns to review', hint: 'Waiting for your decision', to: '/admin/returns?status=Requested', icon: 'undo', tone: 'info' },
  { key: 'lowStock', label: 'Low-stock items', hint: 'At or below the low-stock level', to: '/admin/inventory?filter=low', icon: 'layers', tone: 'danger' },
  { key: 'reviewsToModerate', label: 'Reviews to moderate', hint: 'Pending approval', to: '/admin/reviews?status=pending', icon: 'star', tone: 'primary' },
  { key: 'inventoryIssues', label: 'Orders flagged for stock', hint: 'Paid but no stock was reserved', to: '/admin/orders?flag=inventory_issue', icon: 'warning', tone: 'danger' },
  { key: 'newQueries', label: 'New customer queries', hint: 'Not answered yet', to: '/admin/queries?status=Received', icon: 'chat', tone: 'success' },
];

const EMPTY = { ordersAwaiting: null, returnsToReview: null, lowStock: null, reviewsToModerate: null, inventoryIssues: null, newQueries: null, stockAlerts: null };

async function count(spec) {
  try {
    const { count: n, error } = await withTimeout(buildCountQuery(supabase, spec), 15000);
    return error ? null : (n ?? 0);
  } catch {
    return null;
  }
}

const CountsCtx = createContext(null);

export function AdminCountsProvider({ children }) {
  const { brand } = useBrand();
  const lowLevel = Number(brand.low_stock_threshold) >= 0 ? Number(brand.low_stock_threshold) : 5;
  const [state, setState] = useState({ counts: EMPTY, loading: true, updatedAt: 0 });
  const lastRun = useRef(0);
  const inflight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    lastRun.current = Date.now();
    const [ordersAwaiting, returnsToReview, lowStock, reviewsToModerate, inventoryIssues, newQueries, stockAlerts] = await Promise.all([
      count({ table: 'orders', filters: { status: AWAITING_STATUSES, deleted_at: null } }),
      count({ table: 'order_returns', filters: { status: 'Requested' } }),
      count({ table: 'product_variants', filters: { active: true, track_inventory: true, stock: { lte: lowLevel } } }),
      count({ table: 'reviews', filters: { status: 'pending' } }),
      count({ table: 'orders', filters: { inventory_issue: { not: ['is', null] }, deleted_at: null } }),
      count({ table: 'enquiries', filters: { status: 'Received' } }),
      count({ table: 'product_notifications', filters: { status: 'waiting' } }),
    ]);
    inflight.current = false;
    if (!mounted.current) return;
    setState({ counts: { ordersAwaiting, returnsToReview, lowStock, reviewsToModerate, inventoryIssues, newQueries, stockAlerts }, loading: false, updatedAt: Date.now() });
  }, [lowLevel]);

  // First load, then once a minute while the tab is visible.
  useEffect(() => {
    refresh();
    const t = setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
    const onFocus = () => { if (Date.now() - lastRun.current > MIN_GAP_MS) refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [refresh]);

  // Moving between screens is when the figures are most likely to have changed.
  const { pathname } = useLocation();
  useEffect(() => { if (Date.now() - lastRun.current > MIN_GAP_MS) refresh(); }, [pathname, refresh]);

  const { counts } = state;
  const attentionTotal = ATTENTION_ITEMS.reduce((sum, it) => sum + (counts[it.key] || 0), 0);
  return <CountsCtx.Provider value={{ counts, loading: state.loading, updatedAt: state.updatedAt, attentionTotal, refresh, lowStockLevel: lowLevel }}>{children}</CountsCtx.Provider>;
}

// Outside the provider (a unit test, a stray render) the hook returns empty figures rather than throwing.
const FALLBACK = { counts: EMPTY, loading: false, updatedAt: 0, attentionTotal: 0, refresh: () => {}, lowStockLevel: 5 };
export function useAdminCounts() {
  return useContext(CountsCtx) || FALLBACK;
}
