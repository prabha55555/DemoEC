import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../supabase';
import { callOrdersApi } from '../../utils/orderApi';
import { thumb } from '../../utils/thumbnail';
import { lineVariantLabel } from '../../utils/orderFormat';
import { Button, Card, CopyButton, DateTime, EmptyState, ErrorState, Field, Icon, Money, PageHeader, Skeleton, StatusPill, Textarea } from '../ui';
import { useRecord } from '../hooks';
import { formatMoney } from '../lib/format';
import { useAdminCounts } from '../hooks/useAdminCounts';
import ReturnActionDialog from './ReturnActionDialog';
import { ORDER_DETAIL_COLUMNS, RETURN_COLUMNS } from './orderData';
import useLoad, { rowsOf } from './useLoad';
import { RETURN_ACTION_LABEL, RETURN_TERMINAL, customerName, refundSummary, returnNextStatuses, returnWindows, shortReturnId, waNumber } from './orderLogic';
import './orders.css';

const WINDOW_TEXT = {
  open: (w) => `Return window open until ${new Date(w.deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} (${w.daysLeft} day${w.daysLeft === 1 ? '' : 's'} left)`,
  closed: (w) => `Return window closed on ${new Date(w.deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`,
  none: () => 'Sold as non-returnable',
  unknown: () => 'Delivery date not recorded',
};

// /admin/returns/:id -- one return or replacement request: what is coming back, why, how it sits against the order, and the
// next moves allowed by the return flow (Approve / Reject -> Pickup scheduled -> Received -> Refund or Close).
export default function ReturnDetail() {
  const { id = '' } = useParams();
  const { refresh: refreshAttention } = useAdminCounts();
  const { record: ret, loading, error, notFound, reload } = useRecord('order_returns', id, { select: RETURN_COLUMNS });
  const orderRes = useLoad(async () => (await rowsOf(supabase.from('orders').select(ORDER_DETAIL_COLUMNS).eq('id', ret.order_uuid).limit(1)))[0] || null, [ret?.order_uuid], { enabled: !!ret });
  const order = orderRes.data;
  const [draft, setDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [action, setAction] = useState('');

  // The note box follows the saved note (after a save, a transition or a reload).
  useEffect(() => { setDraft(ret?.admin_note || ''); }, [ret?.admin_note, ret?.id]);

  const refreshAll = useCallback(() => { reload(); orderRes.reload(); refreshAttention(); }, [reload, orderRes, refreshAttention]);
  const staleCheck = useCallback((res) => { if (res.status === 409 || res.status === 502) refreshAll(); }, [refreshAll]);

  if (loading && !ret) {
    return (<><PageHeader title="Return" crumbLabel={id} /><Card><Skeleton height={20} width="40%" /><div style={{ height: 12 }} /><Skeleton height={90} /></Card></>);
  }
  if (error) return (<><PageHeader title="Return" crumbLabel={id} /><Card pad={false}><ErrorState error={error} onRetry={reload} /></Card></>);
  if (notFound || !ret) {
    return (<><PageHeader title="Return not found" crumbLabel={id} /><Card pad={false}><EmptyState icon="search" title="That return request does not exist" action={<Button variant="primary" to="/admin/returns">All returns</Button>} /></Card></>);
  }

  const code = shortReturnId(ret.id);
  const moves = returnNextStatuses(ret.status);
  const resolved = RETURN_TERMINAL.includes(ret.status);
  const items = Array.isArray(ret.items) ? ret.items : [];
  const windows = order ? returnWindows(order, items) : [];
  const money = order ? refundSummary(order) : null;
  const dirtyNote = draft.trim() !== (ret.admin_note || '').trim();

  async function saveNote() {
    setSavingNote(true);
    const res = await callOrdersApi('return_update', { returnId: ret.id, adminNote: draft.trim() });
    setSavingNote(false);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success('Note saved.');
    reload();
  }

  const phone = order?.user_phone || order?.address?.phone || '';
  return (
    <>
      <PageHeader
        title={`${ret.type === 'replacement' ? 'Replacement' : 'Return'} ${code}`} crumbLabel={code}
        subtitle={(
          <span className="ord-headline">
            <StatusPill status={ret.status} kind="return" />
            {ret.type === 'replacement' && <span className="adm-chip">Replacement</span>}
            <span>Requested <DateTime value={ret.created_at} /></span>
            {ret.resolved_at && <span>· Resolved <DateTime value={ret.resolved_at} /></span>}
          </span>
        )}
        actions={<Button icon="cart" to={`/admin/orders/${encodeURIComponent(ret.order_id)}`}>View order {ret.order_id}</Button>}
      />

      <div className="ord-detail">
        <div className="ord-main">
          <Card title="Items in this request" subtitle={`${items.reduce((s, i) => s + (Number(i.qty) || 0), 0)} unit(s) · refund proposed ${formatMoney(ret.refund_amount) || '₹0'}`} pad={false}>
            <ul className="ord-lines">
              {items.map((it, i) => {
                const w = windows[i];
                const label = lineVariantLabel(it);
                return (
                  <li key={`${it.variantId || it.id}-${i}`} className="ord-line">
                    {it.image ? <img src={thumb(it.image, 112)} alt="" loading="lazy" /> : <span className="ord-line-img"><Icon name="box" size={22} /></span>}
                    <div style={{ minWidth: 0 }}>
                      {it.id ? <Link className="ord-line-name" to={`/admin/products/${it.id}`}>{it.name || 'Item'}</Link> : <span className="ord-line-name">{it.name || 'Item'}</span>}
                      <div className="ord-line-meta">{label && <span>{label}</span>}<span>{Number(it.qty) || 1} × <Money value={it.price} /></span></div>
                      {it.reason && <div className="ord-line-meta"><span>Reason: {it.reason}</span></div>}
                      {w && <div className="ord-line-meta"><span className={w.state === 'closed' ? 'ord-window is-closed' : 'ord-window'}>{WINDOW_TEXT[w.state](w)}</span></div>}
                    </div>
                    <div className="ord-line-sum"><strong><Money value={(Number(it.qty) || 1) * (Number(it.price) || 0)} /></strong><small>before any coupon share</small></div>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card title="Why the customer is returning it">
            <div className="adm-stack tight">
              <div><div className="adm-label">Reason</div><div style={{ overflowWrap: 'anywhere' }}>{ret.reason || '—'}</div></div>
              {ret.details && <div><div className="adm-label">Details</div><div className="ord-note-text">{ret.details}</div></div>}
            </div>
          </Card>

          <Card title="Your decision" subtitle={resolved ? `This request is ${ret.status.toLowerCase()}. No further moves are possible.` : 'Add a note if you like, then choose the next step.'}>
            <div className="adm-stack">
              <Field label="Admin note" hint="Kept on the request. It is included in the message the customer gets when you approve, reject or refund.">
                <Textarea rows={3} value={draft} onChange={setDraft} maxLength={1000} />
              </Field>
              <div className="ord-actions-row">
                <Button size="sm" loading={savingNote} disabled={!dirtyNote} onClick={saveNote}>Save note</Button>
              </div>
              {!resolved && order && (
                <div>
                  <div className="adm-label" style={{ marginBottom: 8 }}>Next step</div>
                  <div className="ord-actions-row">
                    {moves.map(s => (
                      <Button key={s} variant={s === 'Refunded' || s === 'Approved' ? 'primary' : s === 'Rejected' ? 'danger' : 'secondary'}
                        icon={s === 'Refunded' ? 'undo' : s === 'Rejected' || s === 'Closed' ? 'close' : 'check'}
                        disabled={s === 'Refunded' && money && money.remaining <= 0}
                        title={s === 'Refunded' && money && money.remaining <= 0 ? 'Nothing is left to refund on this order.' : undefined}
                        onClick={() => setAction(s)}>{RETURN_ACTION_LABEL[s]}</Button>
                    ))}
                  </div>
                  {ret.type === 'replacement' && <p className="adm-hint" style={{ margin: '10px 0 0' }}>Replacement request: send the replacement yourself, then close the request. Use Refund only if you cannot replace it.</p>}
                </div>
              )}
              {ret.status === 'Refunded' && (
                <div className="adm-note success">
                  Refunded <strong><Money value={ret.refund_amount} /></strong>{ret.refund_ref ? (ret.refund_ref === 'manual' ? ' (recorded as a manual refund)' : <> · reference <span className="ord-payid">{ret.refund_ref}<CopyButton text={ret.refund_ref} /></span></>) : ''} · items {ret.restock ? 'restocked' : 'not restocked'}.
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="ord-side">
          <Card title="Order" actions={order && <StatusPill status={order.status} kind="order" />}>
            {orderRes.loading && !order ? <Skeleton height={80} /> : orderRes.error ? <ErrorState compact error={orderRes.error} onRetry={orderRes.reload} /> : !order ? <p className="adm-muted" style={{ margin: 0 }}>The order could not be found.</p> : (
              <dl className="ord-kv">
                <div><dt>Order</dt><dd><Link to={`/admin/orders/${encodeURIComponent(order.order_id)}`}>{order.order_id}</Link></dd></div>
                <div><dt>Payment</dt><dd><StatusPill status={order.payment_status} kind="payment" /></dd></div>
                <div><dt>Delivered</dt><dd>{order.delivered_at ? <DateTime value={order.delivered_at} dateOnly /> : '—'}</dd></div>
                <div><dt>Order total</dt><dd><Money value={order.total} /></dd></div>
                <div className="is-minus"><dt>Already refunded</dt><dd>{money.refunded > 0 ? <>−<Money value={money.refunded} /></> : <Money value={0} />}</dd></div>
                <div className="is-total"><dt>Still refundable</dt><dd><Money value={money.remaining} /></dd></div>
              </dl>
            )}
          </Card>
          {order && (
            <Card title="Customer">
              <div className="ord-person">
                <span className="ord-person-name">{order.user_id ? <Link to={`/admin/customers/${order.user_id}`}>{customerName(order)}</Link> : customerName(order)}</span>
                {order.user_email && <span className="adm-row" style={{ gap: 2 }}><a href={`mailto:${order.user_email}`}>{order.user_email}</a><CopyButton text={order.user_email} /></span>}
                {phone && <span className="adm-row" style={{ gap: 2 }}><a href={`tel:${phone}`}>{phone}</a><CopyButton text={phone} /></span>}
                <div className="ord-actions-row" style={{ marginTop: 6 }}>
                  {phone && <Button size="sm" icon="wa" href={`https://wa.me/${waNumber(phone)}`} target="_blank">WhatsApp</Button>}
                  {order.user_email && <Button size="sm" icon="mail" href={`mailto:${order.user_email}`}>Email</Button>}
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>

      <ReturnActionDialog ret={ret} order={order} to={action} note={draft} onClose={() => setAction('')} onFailed={staleCheck} onDone={() => { setAction(''); refreshAll(); }} />
    </>
  );
}
