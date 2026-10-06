import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../supabase';
import { useAuth } from '../context/AuthContext';
import { useBrand } from '../context/BrandContext';
import { useCartActions } from '../context/CartContext';
import { safeQuery, isAuthExpiredError } from '../utils/safeFetch';
import { fetchVariantsForProducts } from '../utils/catalogApi';
import { isVariantPurchasable, formatMoney } from '../utils/catalog';
import { canCancel, normalizeStatus, returnableLines } from '../utils/orderStatus';
import {
  addressLines, fmtDate, fmtDateTime, formatDeliveryLabel, GIFT_CARD_CANCEL_NOTE, hasGiftCardItem, hasPhysicalItems, isDigitalOrder, orderItemsOf,
  paymentMethodLabel, paymentStatusLabel,
} from '../utils/orderFormat';
import { addressKey } from '../utils/addressBook';
import { whatsappLink } from '../config/company';
import { safeHref } from '../utils/safeUrl';
import { usePageMeta } from '../utils/usePageMeta';
import OrderStatusTracker, { StatusBadge } from '../components/OrderStatusTracker';
import OrderItemsList from '../components/OrderItemsList';
import PriceSummary from '../components/PriceSummary';
import CancelOrderDialog from '../components/CancelOrderDialog';
import ReturnRequestDialog from '../components/ReturnRequestDialog';
import { EmptyState, LoadError, Loading } from '../components/AccountParts';
import '../components/orderUi.css';

// Explicit columns -- never `select *`: inventory_issue, payment ids, the package photo and the soft-delete
// flag are internal and not for the customer's screen.
const ORDER_COLUMNS = 'id, order_id, user_id, user_email, user_name, user_phone, address, items, subtotal, shipping, cod_fee, discount, coupon_code, gift_card_code, gift_card_applied, tax_total, total, payment_method, payment_status, status, estimated_delivery, shipping_carrier, tracking_number, tracking_url, confirmed_at, shipped_at, delivered_at, cancelled_at, cancel_reason, cancelled_by, refunded_amount, refunds, timeline, created_at, updated_at';
const RETURN_COLUMNS = 'id, order_id, type, items, reason, details, status, refund_amount, refund_ref, admin_note, created_at, resolved_at';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REFUND_KIND = { online: 'Original payment method', gift_card: 'Gift card', manual: 'Refunded by the store' };

// Units of each line already inside a request that is still alive (anything not rejected/closed).
export function returnedQtyOf(returns) {
  const map = {};
  for (const r of returns || []) {
    if (r.status === 'Rejected' || r.status === 'Closed') continue;
    for (const it of r.items || []) {
      const key = it.variantId || `${it.id}::${it.size || ''}`;
      map[key] = (map[key] || 0) + Number(it.qty || 0);
    }
  }
  return map;
}

const Card = ({ title, children, className = '', actions }) => (
  <section className={`od-card ${className}`.trim()}>
    {(title || actions) && <div className="od-card-head">{title && <h2 className="od-h">{title}</h2>}{actions}</div>}
    <div className="od-card-body">{children}</div>
  </section>
);

export default function OrderDetail() {
  const { orderId: ref } = useParams();
  const { currentUser } = useAuth();
  const { brand } = useBrand();
  const { addVariantToCart } = useCartActions();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const [state, setState] = useState({ order: null, returns: [], loading: true, error: '', notFound: false });
  const [dialog, setDialog] = useState(null); // 'cancel' | 'return' | null
  const [buying, setBuying] = useState(false);
  const autoActionDone = useRef(false);
  usePageMeta({ title: ref ? `Order ${ref}` : 'Order details', description: 'Order details, tracking and returns.' });

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setState(s => ({ ...s, loading: true, error: '', notFound: false }));
    const col = UUID.test(ref || '') ? 'id' : 'order_id';
    const res = await safeQuery(supabase.from('orders').select(ORDER_COLUMNS).eq(col, ref).is('deleted_at', null).maybeSingle());
    if (isAuthExpiredError(res.error)) { toast.error('Your session has expired — please sign in again.'); navigate('/login'); return; }
    if (res.error) { setState({ order: null, returns: [], loading: false, error: 'Please check your connection and try again.', notFound: false }); return; }
    // RLS only returns the customer's own orders (the admin can read all): no row = not theirs / not found.
    if (!res.data) { setState({ order: null, returns: [], loading: false, error: '', notFound: true }); return; }
    const rr = await safeQuery(supabase.from('order_returns').select(RETURN_COLUMNS).eq('order_uuid', res.data.id).order('created_at', { ascending: false }));
    setState({ order: res.data, returns: rr.data || [], loading: false, error: '', notFound: false });
  }, [ref, navigate]);

  useEffect(() => { load(); }, [load]);

  const { order, returns } = state;
  const status = normalizeStatus(order?.status);
  const returnedQty = useMemo(() => returnedQtyOf(returns), [returns]);
  const eligibility = useMemo(() => (order ? returnableLines(order, returnedQty) : null), [order, returnedQty]);
  const giftCardOrder = order ? hasGiftCardItem(order) : false;
  const cancellable = order ? canCancel(order, 'customer') && !giftCardOrder : false;
  const digital = order ? isDigitalOrder(order) : false;
  const items = orderItemsOf(order);

  // ?action=return / ?action=cancel (from the orders list) opens that dialog once the order is here.
  useEffect(() => {
    if (!order || autoActionDone.current) return;
    const action = search.get('action');
    if (!action) return;
    autoActionDone.current = true;
    if (action === 'return' && eligibility?.eligible) setDialog('return');
    else if (action === 'cancel' && cancellable) setDialog('cancel');
    const next = new URLSearchParams(search); next.delete('action'); setSearch(next, { replace: true });
  }, [order, eligibility, cancellable, search, setSearch]);

  async function buyAgain() {
    if (buying || !order) return;
    setBuying(true);
    try {
      const lines = items.filter(i => !i.isGiftCard && i.variantId);
      if (!lines.length) { toast.error('These items cannot be re-ordered from here.'); return; }
      const productIds = [...new Set(lines.map(l => l.id))];
      const [{ data: products }, variants] = await Promise.all([
        supabase.from('products').select('id, status, name, brand, cat, category_id, images, max_qty_per_order, cod_allowed, free_shipping, delivery_min_days, delivery_max_days').in('id', productIds).eq('status', 'active'),
        fetchVariantsForProducts(productIds),
      ]);
      const productById = new Map((products || []).map(p => [p.id, p]));
      const variantById = new Map((variants || []).map(v => [v.id, v]));
      let added = 0;
      const skipped = [];
      for (const l of lines) {
        const product = productById.get(l.id);
        const variant = variantById.get(l.variantId);
        if (!product || !variant || !isVariantPurchasable(variant)) { skipped.push(l.name || 'An item'); continue; }
        if (addVariantToCart(product, variant, Number(l.qty) || 1)) added++;
      }
      if (skipped.length) toast(`Not available right now: ${skipped.join(', ')}.`, { icon: 'ℹ️', duration: 6000 });
      if (added) navigate('/cart');
      else if (!skipped.length) toast.error('Nothing could be added to your cart.');
    } catch {
      toast.error('Could not add these items to your cart. Please try again.');
    } finally { setBuying(false); }
  }

  if (!currentUser) return null; // ProtectedRoute already redirects; this only guards the first render

  const back = <Link to="/account?tab=orders" className="od-back">← My orders</Link>;
  if (state.loading && !order) return <div className="od-page"><div className="bl-wrap od-wrap">{back}<Loading label="Loading your order" /></div><style>{PAGE_CSS}</style></div>;
  if (state.error) return <div className="od-page"><div className="bl-wrap od-wrap">{back}<LoadError message={state.error} onRetry={() => load()} /></div><style>{PAGE_CSS}</style></div>;
  if (state.notFound || !order) {
    return (
      <div className="od-page"><div className="bl-wrap od-wrap">
        {back}
        <EmptyState art="orders" title="We could not find this order" text="It may belong to a different account, or the order number may be wrong." cta="Go to my orders" onCta={() => navigate('/account?tab=orders')} />
      </div><style>{PAGE_CSS}</style></div>
    );
  }

  // ---- derived display values -----------------------------------------------------------------
  const delivered = status === 'Delivered';
  const closed = status === 'Cancelled' || status === 'Returned';
  const mrpTotal = items.reduce((s, i) => s + (Number(i.mrp) > Number(i.price) ? Number(i.mrp) : Number(i.price) || 0) * (Number(i.qty) || 0), 0);
  const subtotal = Number(order.subtotal) || 0;
  const productSavings = Math.max(0, Math.round((mrpTotal - subtotal) * 100) / 100);
  const itemCount = items.reduce((s, i) => s + (Number(i.qty) || 1), 0);
  const refunded = Number(order.refunded_amount) || 0;
  // Only refunds that really happened are shown to the customer (pending / failed attempts are the store's business).
  const refunds = (Array.isArray(order.refunds) ? order.refunds : []).filter(r => !r.status || r.status === 'processed' || r.status === 'manual');
  const isCod = order.payment_method === 'cod';
  const rows = [
    { key: 'price', label: `Price (${itemCount} ${itemCount === 1 ? 'item' : 'items'})`, value: formatMoney(mrpTotal || subtotal) },
    ...(productSavings > 0 ? [{ key: 'disc', label: 'Discount', value: `− ${formatMoney(productSavings)}`, tone: 'minus' }] : []),
    ...(Number(order.discount) > 0 ? [{ key: 'coupon', label: order.coupon_code ? `Coupon (${order.coupon_code})` : 'Coupon discount', value: `− ${formatMoney(order.discount)}`, tone: 'minus' }] : []),
    ...(digital ? [] : [{ key: 'ship', label: 'Delivery', value: Number(order.shipping) > 0 ? formatMoney(order.shipping) : 'Free', tone: Number(order.shipping) > 0 ? undefined : 'free' }]),
    ...(Number(order.cod_fee) > 0 ? [{ key: 'cod', label: 'Cash on Delivery fee', value: formatMoney(order.cod_fee) }] : []),
    ...(Number(order.gift_card_applied) > 0 ? [{ key: 'gc', label: order.gift_card_code ? `Gift card (${order.gift_card_code})` : 'Gift card', value: `− ${formatMoney(order.gift_card_applied)}`, tone: 'minus' }] : []),
    ...(Number(order.tax_total) > 0 ? [{ key: 'tax', label: 'GST included in total', value: formatMoney(order.tax_total) }] : []),
    ...(refunded > 0 ? [{ key: 'refund', label: 'Refunded', value: formatMoney(refunded), tone: 'free' }] : []),
  ];
  const totalLabel = isCod && order.payment_status === 'cod_pending' ? 'Amount to pay on delivery' : 'Order total';
  const hrefTrack = safeHref(order.tracking_url);
  const shipAddr = addressLines(order.address);
  const billing = order.address?.billing?.line1 && addressKey(order.address.billing) !== addressKey(order.address) ? order.address.billing : null;
  const earliestDeadline = eligibility?.eligible ? eligibility.lines.map(l => l.deadline).sort()[0] : null;
  const cancelNote = order.cancel_reason ? `Reason: ${order.cancel_reason}` : '';

  return (
    <div className="od-page">
      <div className="bl-wrap od-wrap">
        {back}

        {/* HEADER */}
        <section className="od-card od-top">
          <div className="od-top-main">
            <h1 className="od-title">Order {order.order_id}</h1>
            <div className="acc-muted">Placed on {fmtDateTime(order.created_at)}</div>
            <div className="od-badges">
              <StatusBadge status={status} />
              {paymentStatusLabel(order) && <StatusBadge status={order.payment_status === 'cod_pending' ? 'Placed' : order.payment_status === 'refunded' || order.payment_status === 'partially_refunded' ? 'Refunded' : 'paid'} label={paymentStatusLabel(order)} />}
              {paymentMethodLabel(order) && <span className="ob-badge is-plain">{paymentMethodLabel(order)}</span>}
            </div>
          </div>
          <div className="od-top-actions">
            <a className="btn btn-outline btn-sm" href={`/invoice/${encodeURIComponent(order.order_id)}`} target="_blank" rel="noreferrer">Download invoice</a>
            <a className="btn btn-outline btn-sm" href={whatsappLink(`Hi, I need help with order ${order.order_id}.`)} target="_blank" rel="noreferrer">Need help?</a>
          </div>
        </section>

        <div className="od-grid">
          <div className="od-col">
            {/* TRACKER */}
            <Card title={digital ? 'Delivery' : 'Order status'}>
              {digital ? (
                <p className="od-plain"><strong>Delivered to your email.</strong> Your gift card code is also shown below and is valid for the period printed on the email.</p>
              ) : (
                <>
                  <OrderStatusTracker order={order} />
                  {!closed && (
                    <div className="od-eta">
                      {delivered
                        ? (order.delivered_at ? <>Delivered on <strong>{fmtDate(order.delivered_at)}</strong></> : null)
                        : order.estimated_delivery
                          ? <>Estimated delivery: <strong>{formatDeliveryLabel(order.estimated_delivery)}</strong></>
                          : 'We will share the delivery date once your order ships.'}
                    </div>
                  )}
                  {status === 'Cancelled' && (
                    <div className="od-note is-danger" role="status">
                      This order was cancelled{order.cancelled_at ? ` on ${fmtDate(order.cancelled_at)}` : ''}. {cancelNote}
                      {refunded > 0 && <> {formatMoney(refunded)} {isCod ? 'was recorded as refunded.' : 'is being refunded to your original payment method (5–7 business days).'}</>}
                    </div>
                  )}
                  {(order.shipping_carrier || order.tracking_number || hrefTrack) && ['Shipped', 'Out for Delivery', 'Delivered'].includes(status) && (
                    <div className="od-track">
                      <div>
                        {order.shipping_carrier && <div><span className="acc-muted">Carrier</span> <strong>{order.shipping_carrier}</strong></div>}
                        {order.tracking_number && <div style={{ userSelect: 'text' }}><span className="acc-muted">Tracking number</span> <strong>{order.tracking_number}</strong></div>}
                      </div>
                      {hrefTrack && <a href={hrefTrack} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">Track shipment</a>}
                    </div>
                  )}
                </>
              )}
            </Card>

            {/* ITEMS */}
            <Card title={`Items (${itemCount})`}>
              <OrderItemsList items={items} reviewLinks={delivered} />
            </Card>

            {/* RETURNS */}
            {returns.length > 0 && (
              <Card title="Returns & replacements">
                <ul className="od-returns">
                  {returns.map(r => (
                    <li key={r.id} className="od-return">
                      <div className="od-return-head">
                        <strong>{r.type === 'replacement' ? 'Replacement' : 'Return'} · {String(r.id).slice(0, 8).toUpperCase()}</strong>
                        <StatusBadge status={r.status} />
                      </div>
                      <div className="acc-muted">Requested {fmtDate(r.created_at)}{r.resolved_at ? ` · closed ${fmtDate(r.resolved_at)}` : ''}</div>
                      <div className="od-return-items">{(r.items || []).map(i => `${i.qty} × ${i.name}${i.variantLabel ? ` (${i.variantLabel})` : ''}`).join(', ')}</div>
                      {r.reason && <div className="acc-muted">Reason: {r.reason}{r.details ? ` — ${r.details}` : ''}</div>}
                      {Number(r.refund_amount) > 0 && r.type !== 'replacement' && (
                        <div className="od-return-refund">{r.status === 'Refunded' ? 'Refunded' : 'Expected refund'}: <strong>{formatMoney(r.refund_amount)}</strong></div>
                      )}
                      {r.admin_note && <div className="od-note">From us: {r.admin_note}</div>}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>

          <div className="od-col">
            {/* ACTIONS */}
            <Card title="Manage this order">
              <div className="od-actions">
                {cancellable && <button type="button" className="btn btn-outline" onClick={() => setDialog('cancel')}>Cancel order</button>}
                {eligibility?.eligible && <button type="button" className="btn btn-gold" onClick={() => setDialog('return')}>Return / replace items</button>}
                {hasPhysicalItems(order) && <button type="button" className="btn btn-outline" onClick={buyAgain} disabled={buying} aria-busy={buying}>{buying ? 'Adding…' : 'Buy again'}</button>}
              </div>
              {cancellable && <p className="od-hint">{isCod ? 'You can cancel until the order is shipped. Nothing has been paid yet.' : 'You can cancel until the order is shipped. Anything you paid is refunded.'}</p>}
              {giftCardOrder && canCancel(order, 'customer') && <p className="od-hint" role="note">{GIFT_CARD_CANCEL_NOTE} <a href={whatsappLink(`Hi, I need help with order ${order.order_id}.`)} target="_blank" rel="noreferrer" className="oil-link">Contact support</a></p>}
              {eligibility?.eligible && <p className="od-hint">Return by <strong>{fmtDate(earliestDeadline)}</strong>. Items must be unused and in original packaging.</p>}
              {delivered && eligibility && !eligibility.eligible && <p className="od-hint">{eligibility.reason}</p>}
              {!cancellable && !giftCardOrder && !delivered && !closed && <p className="od-hint">This order has shipped, so it can no longer be cancelled. You can return it once it is delivered.</p>}
              {delivered && items.some(i => !i.isGiftCard) && <p className="od-hint">Enjoying your purchase? Use “Write a review” under any item.</p>}
            </Card>

            {/* PRICE */}
            <PriceSummary
              className="od-sum"
              title="Price details"
              rows={rows}
              total={{ label: totalLabel, value: formatMoney(order.total) }}
              savings={productSavings + (Number(order.discount) || 0)}
            />

            {/* ADDRESS */}
            <Card title={digital ? 'Billing details' : 'Delivery address'}>
              <div className="od-addr">
                {shipAddr.map((l, i) => (i === 0 ? <strong key={i}>{l}<br /></strong> : <React.Fragment key={i}>{l}<br /></React.Fragment>))}
                {order.user_email && <span className="acc-muted">{order.user_email}</span>}
              </div>
              {billing && !digital && (
                <>
                  <h3 className="od-sub">Billing address</h3>
                  <div className="od-addr">{addressLines(billing).map((l, i) => <React.Fragment key={i}>{l}<br /></React.Fragment>)}</div>
                </>
              )}
            </Card>

            {/* PAYMENT */}
            <Card title="Payment">
              <dl className="od-kv">
                <div><dt>Method</dt><dd>{paymentMethodLabel(order) || '—'}</dd></div>
                <div><dt>Status</dt><dd>{paymentStatusLabel(order) || '—'}</dd></div>
                {brand?.support_email && refunded > 0 && <div><dt>Questions</dt><dd>{brand.support_email}</dd></div>}
              </dl>
              {refunds.length > 0 && (
                <>
                  <h3 className="od-sub">Refunds</h3>
                  <ul className="od-refunds">
                    {refunds.map((r, i) => (
                      <li key={r.id || i}>
                        <span><strong>{formatMoney(r.amount)}</strong> · {REFUND_KIND[r.type] || 'Refund'}</span>
                        <span className="acc-muted">{fmtDate(r.at)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          </div>
        </div>
      </div>

      {dialog === 'cancel' && <CancelOrderDialog order={order} onClose={() => setDialog(null)} onCancelled={() => load({ quiet: true })} />}
      {dialog === 'return' && eligibility?.eligible && <ReturnRequestDialog order={order} lines={eligibility.lines} onClose={() => setDialog(null)} onRequested={() => load({ quiet: true })} />}

      <style>{PAGE_CSS}</style>
    </div>
  );
}

const PAGE_CSS = `
  .od-page { padding-top: var(--hdr-h); min-height: 80vh; background: var(--bg); }
  .od-wrap { padding-top: 12px; padding-bottom: 40px; }
  .od-back { display: inline-block; margin: 2px 0 10px; font-size: 13.5px; font-weight: 500; color: var(--primary); }
  .od-back:hover { text-decoration: underline; }
  .od-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; margin-bottom: 12px; }
  .od-card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
  .od-h { margin: 0; font-family: var(--font-head); font-size: 15px; font-weight: 600; color: var(--text); }
  .od-card-body { padding: 14px 16px; }
  .od-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px 20px; flex-wrap: wrap; padding: 16px; }
  .od-title { margin: 0 0 2px; font-family: var(--font-head); font-size: 20px; font-weight: 600; overflow-wrap: anywhere; }
  .od-badges { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
  .od-top-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .od-grid { display: grid; grid-template-columns: minmax(0, 1fr) 380px; gap: 12px; align-items: start; }
  .od-col { min-width: 0; }
  .od-plain { margin: 0; font-size: 14px; line-height: 1.6; color: var(--text); }
  .od-eta { margin-top: 16px; padding: 10px 12px; background: var(--primary-tint); border-radius: 6px; font-size: 13.5px; color: var(--text); }
  .od-eta:empty { display: none; }
  .od-note { margin-top: 12px; padding: 10px 12px; border-radius: 6px; background: #F4F6F6; font-size: 13px; line-height: 1.5; color: var(--text); }
  .od-note.is-danger { background: #FDEBE9; color: var(--error); }
  .od-track { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--border); font-size: 13.5px; }
  .od-actions { display: flex; flex-direction: column; gap: 8px; }
  .od-actions .btn { width: 100%; min-height: 42px; }
  .od-hint { margin: 10px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--text-muted); }
  .od-sum { margin-bottom: 12px; }
  .od-addr { font-size: 13.5px; line-height: 1.65; color: var(--text); overflow-wrap: anywhere; }
  .od-sub { margin: 14px 0 6px; font-size: 13px; font-weight: 600; color: var(--text-muted); }
  .od-kv { margin: 0; display: grid; gap: 8px; font-size: 13.5px; }
  .od-kv > div { display: flex; justify-content: space-between; gap: 12px; }
  .od-kv dt { margin: 0; color: var(--text-muted); }
  .od-kv dd { margin: 0; text-align: right; font-weight: 500; }
  .od-refunds { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; font-size: 13.5px; }
  .od-refunds li { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .od-returns { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
  .od-return { padding: 12px; border: 1px solid var(--border); border-radius: 6px; display: grid; gap: 4px; }
  .od-return-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; font-size: 14px; }
  .od-return-items { font-size: 13.5px; color: var(--text); overflow-wrap: anywhere; }
  .od-return-refund { font-size: 13.5px; }
  @media (max-width: 899px) {
    .od-grid { grid-template-columns: minmax(0, 1fr); }
    .od-title { font-size: 18px; }
  }
  @media (max-width: 520px) {
    .od-card-head, .od-card-body { padding-left: 12px; padding-right: 12px; }
    .od-top { padding: 14px 12px; }
    .od-top-actions { width: 100%; }
    .od-top-actions .btn { flex: 1; text-align: center; }
  }
`;
