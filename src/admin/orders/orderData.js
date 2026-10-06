// What the order screens read, and the small data hooks they share. Columns are always named (never select('*')).
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../supabase';
import { withTimeout } from '../../utils/withTimeout';
import { ORDER_STATUSES } from '../../utils/orderStatus';
import { buildCountQuery } from '../hooks/serverList';
import { orderListFilters, statusValues } from './orderLogic';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The list: every column a row, a printed invoice / packing slip and the CSV exports need, so selecting rows never
// means a second fetch.
export const ORDER_LIST_COLUMNS = [
  'id', 'order_id', 'created_at', 'user_id', 'user_name', 'user_email', 'user_phone', 'address', 'items',
  'subtotal', 'shipping', 'cod_fee', 'discount', 'coupon_code', 'gift_card_code', 'gift_card_applied', 'tax_total', 'total',
  'payment_method', 'payment_status', 'status', 'payment_id', 'estimated_delivery', 'shipping_carrier', 'tracking_number', 'tracking_url',
  'refunded_amount', 'inventory_issue', 'deleted_at',
].join(', ');

// The detail page: the list's columns plus the history and bookkeeping.
export const ORDER_DETAIL_COLUMNS = `${ORDER_LIST_COLUMNS}, razorpay_order_id, package_image_url, confirmed_at, shipped_at, delivered_at, cancelled_at, cancel_reason, cancelled_by, refunds, timeline, restocked_at, updated_at`;

export const ORDER_SEARCH_COLUMNS = ['order_id', 'user_name', 'user_email', 'user_phone'];

export const RETURN_COLUMNS = 'id, order_uuid, order_id, user_id, type, items, reason, details, status, refund_amount, refund_ref, restock, admin_note, created_at, updated_at, resolved_at';

// Live counts for a row of tabs: one count-only request per tab (no rows travel), each under every OTHER active filter, so
// "Shipped (4)" is the number you would get by clicking it. `filtersFor(key)` returns that tab's filters ('' = All).
//   const { counts } = useTabCounts({ table: 'orders', keys: ['', 'Placed'], filtersFor: k => ({ … }), search, searchColumns, nonce });
// `nonce` re-counts after an action; a reply to an older request is dropped.
export function useTabCounts({ table, keys, filtersFor, search = '', searchColumns, nonce = 0 }) {
  const [state, setState] = useState({ counts: {}, loading: true });
  const request = useRef(0);
  const specKey = JSON.stringify({ table, keys, filters: keys.map(filtersFor), search, searchColumns });

  useEffect(() => {
    const spec = JSON.parse(specKey);
    const id = ++request.current;
    setState(s => ({ ...s, loading: true }));
    Promise.all(spec.keys.map(async (key, i) => {
      try {
        const { count, error } = await withTimeout(buildCountQuery(supabase, { table: spec.table, filters: spec.filters[i], search: spec.search, searchColumns: spec.searchColumns }), 15000);
        return [key, error ? null : (count ?? 0)];
      } catch { return [key, null]; }
    })).then(pairs => { if (id === request.current) setState({ counts: Object.fromEntries(pairs), loading: false }); });
  }, [specKey, nonce]);

  return state;
}

// The order status tabs: All + every status, plus any custom list the URL carries (the dashboard's Placed,Confirmed,Packed).
export function useOrderCounts(values, { extra = [], nonce = 0 } = {}) {
  const base = orderListFilters(values, { withStatus: false });
  return useTabCounts({
    table: 'orders', keys: ['', ...ORDER_STATUSES, ...extra], nonce, search: values.q, searchColumns: ORDER_SEARCH_COLUMNS,
    filtersFor: (key) => (key ? { ...base, status: statusValues(key) } : base),
  });
}
