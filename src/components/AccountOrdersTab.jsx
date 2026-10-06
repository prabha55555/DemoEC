import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../supabase';
import { safeQuery, isAuthExpiredError } from '../utils/safeFetch';
import { formatMoney } from '../utils/catalog';
import { canCancel, normalizeStatus, returnableLines } from '../utils/orderStatus';
import { fmtDate, formatDeliveryLabel, hasGiftCardItem, isDigitalOrder, lineVariantLabel, orderItemsOf, paymentStatusLabel } from '../utils/orderFormat';
import { thumb } from '../utils/thumbnail';
import OrderStatusTracker, { StatusBadge } from './OrderStatusTracker';
import CancelOrderDialog from './CancelOrderDialog';
import { EmptyState, LoadError, Loading, TabHead } from './AccountParts';

export const PAGE_SIZE = 10;

// What the list needs -- never `select *` (inventory_issue, payment ids and the package photo are internal).
export const ORDER_LIST_COLUMNS = 'id, order_id, status, payment_status, payment_method, items, total, estimated_delivery, created_at, delivered_at, cancelled_at, timeline, address';

// Legacy 'Paid' / 'Pending' rows count as in progress, like normalizeStatus() reads them.
export const STATUS_GROUPS = {
  active: ['Placed', 'Confirmed', 'Packed', 'Shipped', 'Out for Delivery', 'Paid', 'Pending'],
  delivered: ['Delivered'],
  closed: ['Cancelled', 'Returned'],
};
const FILTERS = [['all', 'All'], ['active', 'In progress'], ['delivered', 'Delivered'], ['closed', 'Cancelled & returned']];

// PostgREST list separators and ILIKE wildcards are stripped so typing "BL-1%" searches for exactly that.
export const cleanOrderSearch = (text) => String(text || '').replace(/[%_\\,()*]/g, '').trim().slice(0, 30);

function Thumbs({ items }) {
  const list = orderItemsOf({ items });
  const shown = list.slice(0, 4);
  return (
    <div className="ord-thumbs" aria-hidden="true">
      {shown.map((it, i) => (
        <span key={i} className="ord-thumb">
          {it.image ? <img src={thumb(it.image, 120)} alt="" loading="lazy" decoding="async" /> : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" /></svg>
          )}
        </span>
      ))}
      {list.length > shown.length && <span className="ord-thumb ord-more">+{list.length - shown.length}</span>}
    </div>
  );
}

function OrderCard({ order, onCancel }) {
  const items = orderItemsOf(order);
  const first = items[0];
  const status = normalizeStatus(order.status);
  const digital = isDigitalOrder(order);
  const returnable = status === 'Delivered' && returnableLines(order, {}).eligible;
  const cancellable = canCancel(order, 'customer') && !hasGiftCardItem(order); // the server refuses to cancel gift-card orders
  const href = `/account/orders/${encodeURIComponent(order.order_id)}`;
  const qty = items.reduce((s, i) => s + (Number(i.qty) || 1), 0);
  const delivered = status === 'Delivered';
  const closed = status === 'Cancelled' || status === 'Returned';
  const payLabel = order.payment_method === 'cod' && order.payment_status === 'cod_pending' ? 'Pay on delivery' : paymentStatusLabel(order);
  return (
    <article className="acc-card ord-card" aria-label={`Order ${order.order_id}`}>
      <div className="ord-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <Link to={href} className="ord-num">Order {order.order_id}</Link>
          <div className="acc-muted">Placed on {fmtDate(order.created_at) || '—'}</div>
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="ord-body">
        <Thumbs items={items} />
        <div className="ord-info">
          <Link to={href} className="ord-first">{first?.name || 'Order'}</Link>
          <div className="acc-muted">
            {[first ? lineVariantLabel(first) : '', items.length > 1 ? `+ ${items.length - 1} more ${items.length - 1 === 1 ? 'item' : 'items'}` : `Qty ${qty}`].filter(Boolean).join(' · ')}
          </div>
          <div className="ord-pay">
            <strong>{formatMoney(order.total)}</strong>
            {payLabel && <span className={`ord-paytag${order.payment_status === 'cod_pending' ? ' is-cod' : ''}`}>{payLabel}</span>}
          </div>
        </div>
      </div>
      <div className="ord-track">
        {digital
          ? <div className="trkc-text"><strong style={{ fontWeight: 600 }}>Gift card</strong> <span>· delivered to your email</span></div>
          : <OrderStatusTracker order={order} compact />}
        {!digital && !closed && (
          <div className="acc-muted" style={{ marginTop: 4 }}>
            {delivered ? (order.delivered_at ? `Delivered on ${fmtDate(order.delivered_at)}` : '') : order.estimated_delivery ? `Arriving ${formatDeliveryLabel(order.estimated_delivery)}` : 'Delivery date will be shared once shipped'}
          </div>
        )}
      </div>
      <div className="ord-foot">
        <Link to={href} className="btn btn-gold btn-sm">View details</Link>
        {cancellable && <button type="button" className="btn btn-outline btn-sm" onClick={() => onCancel(order)}>Cancel</button>}
        {returnable && <Link to={`${href}?action=return`} className="btn btn-outline btn-sm">Return / replace</Link>}
        <a href={`/invoice/${encodeURIComponent(order.order_id)}`} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">Invoice</a>
      </div>
    </article>
  );
}

// Account -> Orders: paginated, filterable by status, searchable by order number.
export default function AccountOrdersTab({ userId }) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ rows: [], count: 0, loading: true, error: '' });
  const [cancelling, setCancelling] = useState(null);
  const seq = useRef(0);

  // Search applies a moment after typing stops, from page 1.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(cleanOrderSearch(input)); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [input]);

  const load = useCallback(async () => {
    if (!userId) return;
    const mine = ++seq.current;
    setState(s => ({ ...s, loading: true, error: '' }));
    const from = (page - 1) * PAGE_SIZE;
    let q = supabase.from('orders').select(ORDER_LIST_COLUMNS, { count: 'exact' })
      .eq('user_id', userId).is('deleted_at', null)
      .order('created_at', { ascending: false }).range(from, from + PAGE_SIZE - 1);
    if (filter !== 'all') q = q.in('status', STATUS_GROUPS[filter]);
    if (search) q = q.ilike('order_id', `%${search}%`);
    const res = await safeQuery(q);
    if (mine !== seq.current) return; // a newer request superseded this one
    if (isAuthExpiredError(res.error)) { toast.error('Your session has expired — please sign in again.'); navigate('/login'); return; }
    if (res.error) { setState({ rows: [], count: 0, loading: false, error: 'Please check your connection and try again.' }); return; }
    // The query's count can come back null from some proxies; the row count is a safe floor.
    const rows = res.data || [];
    setState({ rows, count: typeof res.count === 'number' ? res.count : rows.length, loading: false, error: '' });
  }, [userId, filter, search, page, navigate]);

  useEffect(() => { load(); }, [load]);

  const pages = Math.max(1, Math.ceil(state.count / PAGE_SIZE));
  const filtered = filter !== 'all' || !!search;

  return (
    <>
      <TabHead title="My orders" sub={!state.loading && !state.error && state.count > 0 ? `${state.count} ${state.count === 1 ? 'order' : 'orders'}${filtered ? ' found' : ''}` : undefined} />

      <div className="acc-filters">
        <div className="acc-chips" role="group" aria-label="Filter orders by status">
          {FILTERS.map(([key, label]) => (
            <button key={key} type="button" className={`acc-chip${filter === key ? ' is-on' : ''}`} aria-pressed={filter === key} onClick={() => { setFilter(key); setPage(1); }}>{label}</button>
          ))}
        </div>
        <div className="acc-search">
          <label className="acc-sr" htmlFor="ord-search">Search orders by order number</label>
          <input id="ord-search" className="form-input" type="search" inputMode="search" placeholder="Search by order number" value={input} onChange={e => setInput(e.target.value)} autoComplete="off" />
        </div>
      </div>

      {state.error ? <LoadError message={state.error} onRetry={load} />
        : state.loading && state.rows.length === 0 ? <Loading label="Loading your orders" />
        : state.rows.length === 0 ? (
          filtered
            ? <EmptyState art="orders" title="No orders match" text="Try a different status or order number." cta="Clear filters" onCta={() => { setFilter('all'); setInput(''); setSearch(''); setPage(1); }} />
            : <EmptyState art="orders" title="No orders yet" text="When you place an order it will show up here, with live tracking." cta="Start shopping" onCta={() => navigate('/shop')} />
        ) : (
          <div className="acc-orders" aria-busy={state.loading}>
            {state.rows.map(o => <OrderCard key={o.id} order={o} onCancel={setCancelling} />)}
            {pages > 1 && (
              <nav className="acc-pager" aria-label="Orders pages">
                <button type="button" className="btn btn-outline btn-sm" disabled={page <= 1 || state.loading} onClick={() => setPage(p => p - 1)}>Previous</button>
                <span aria-live="polite">Page {page} of {pages}</span>
                <button type="button" className="btn btn-outline btn-sm" disabled={page >= pages || state.loading} onClick={() => setPage(p => p + 1)}>Next</button>
              </nav>
            )}
          </div>
        )}

      {cancelling && (
        <CancelOrderDialog order={cancelling} onClose={() => setCancelling(null)} onCancelled={() => load()} />
      )}
    </>
  );
}
