import React, { useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../supabase';
import { nextStatuses } from '../../utils/orderStatus';
import { Button, Card, DateTime, EmptyState, ErrorState, Icon, PageHeader, Skeleton, StatusPill } from '../ui';
import { adminWrite, useConfirm, useRecord } from '../hooks';
import { useAdminCounts } from '../hooks/useAdminCounts';
import ActionMenu from './ActionMenu';
import CancelDialog from './CancelDialog';
import PrintDialog from './PrintDialog';
import RefundDialog from './RefundDialog';
import StatusChangeDialog from './StatusChangeDialog';
import { ItemsCard, PaymentCard, ReturnsCard, TimelineCard } from './OrderMainCards';
import { AddressesCard, CustomerCard, DocumentsCard, NotesCard, NotificationsCard, ShippingCard } from './OrderSideCards';
import { ORDER_DETAIL_COLUMNS, UUID } from './orderData';
import useLoad, { rowsOf } from './useLoad';
import { ADVANCE_LABEL, nextStep, refundSummary } from './orderLogic';
import './orders.css';

// /admin/orders/:id -- one order, start to finish. `id` is the order number (BL-20001) from links made by the admin shell,
// or the row uuid. Everything that changes an order's status, money or stock goes through api/orders (callOrdersApi): that is
// what restocks, releases coupons and gift cards, refunds through Razorpay, stamps the timeline and sends the customer's
// messages exactly once. The only direct writes here are the ones the brief allows: tracking details, the package photo,
// soft delete / restore and clearing the stock-issue flag; internal notes live in their own table.
export default function OrderDetailPage() {
  const { id: rawId = '' } = useParams();
  const id = UUID.test(rawId) ? rawId : rawId.trim().toUpperCase();   // order numbers are upper-case (bl-10004 in a typed URL works too)
  const confirm = useConfirm();
  const { refresh: refreshAttention } = useAdminCounts();
  const { record: order, loading, error, notFound, reload } = useRecord('orders', id, { column: UUID.test(id) ? 'id' : 'order_id', select: ORDER_DETAIL_COLUMNS });
  const orderUuid = order?.id;
  const notes = useLoad(() => rowsOf(supabase.from('order_notes').select('id, author, note, created_at').eq('order_uuid', orderUuid).order('created_at', { ascending: false }).limit(100)), [orderUuid], { enabled: !!orderUuid, initial: [] });
  const returns = useLoad(() => rowsOf(supabase.from('order_returns').select('id, type, items, reason, status, refund_amount, admin_note, created_at, updated_at, resolved_at').eq('order_uuid', orderUuid).order('created_at', { ascending: false })), [orderUuid], { enabled: !!orderUuid, initial: [] });
  const orderNumber = order?.order_id;
  const sends = useLoad(() => rowsOf(supabase.from('email_sends').select('id, event_type, status, created_at, error_message, subject').eq('order_number', orderNumber).order('created_at', { ascending: false }).limit(10)), [orderNumber], { enabled: !!orderNumber, initial: [] });

  const [statusTo, setStatusTo] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [printKind, setPrintKind] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelResult, setCancelResult] = useState(null);

  const refreshAll = useCallback(() => {
    reload(); notes.reload(); returns.reload(); sends.reload(); refreshAttention();
  }, [reload, notes, returns, sends, refreshAttention]);
  // A dialog refused because the order moved on (409), or a refund half-happened (502): show the real state.
  const staleCheck = useCallback((res) => { if (res.status === 409 || res.status === 502) refreshAll(); }, [refreshAll]);

  if (loading && !order) {
    return (
      <>
        <PageHeader title="Order" crumbLabel={id} />
        <div className="ord-detail"><div className="ord-main"><Card><Skeleton height={20} width="40%" /><div style={{ height: 12 }} /><Skeleton height={80} /></Card><Card><Skeleton height={140} /></Card></div><div className="ord-side"><Card><Skeleton height={100} /></Card></div></div>
      </>
    );
  }
  if (error) return (<><PageHeader title="Order" crumbLabel={id} back={{ to: '/admin/orders', label: 'All orders' }} /><Card pad={false}><ErrorState error={error} onRetry={reload} /></Card></>);
  if (notFound || !order) {
    return (
      <>
        <PageHeader title="Order not found" crumbLabel={id} back={{ to: '/admin/orders', label: 'All orders' }} />
        <Card pad={false}><EmptyState icon="search" title={`No order "${id}"`} hint="Check the order number, or search for it from the Orders list." action={<Button variant="primary" to="/admin/orders">Back to orders</Button>} /></Card>
      </>
    );
  }

  const next = nextStep(order);
  const forward = nextStatuses(order);
  const money = refundSummary(order);
  const deleted = !!order.deleted_at;
  const issue = order.inventory_issue;

  const statusItems = forward.map(s => (s === 'Cancelled'
    ? { key: s, label: 'Cancel order…', icon: 'close', tone: 'danger', hint: 'Restock, release the coupon, refund the payment', onSelect: () => setCancelOpen(true) }
    : { key: s, label: `Mark as ${s}`, icon: 'check', onSelect: () => setStatusTo(s) }));
  if (statusItems.length > 1 && statusItems[statusItems.length - 1].key === 'Cancelled') statusItems.splice(statusItems.length - 1, 0, { separator: true });

  async function clearIssue() {
    const yes = await confirm({
      title: 'Mark the stock issue as resolved?',
      message: 'Only do this once you have dealt with the stock (for example by adjusting inventory). Note: if you cancel this order afterwards, its items WILL be added back to stock, because the flag that said "stock was never taken" is gone.',
      confirmLabel: 'Mark resolved',
    });
    if (!yes) return;
    setBusy(true);
    const { ok } = await adminWrite(supabase.from('orders').update({ inventory_issue: null }).eq('id', order.id), { success: 'Marked as resolved.' });
    setBusy(false);
    if (ok) refreshAll();
  }

  async function setDeleted(flag) {
    if (flag) {
      const active = !['Cancelled', 'Returned', 'Delivered'].includes(order.status);
      const yes = await confirm({
        title: `Delete ${order.order_id}?`,
        message: `${active ? `This order is still ${order.status}: deleting it does NOT cancel it, restock it or refund it. ` : ''}It disappears from the orders list, the counts and the reports, but the record is kept and you can restore it any time.`,
        confirmLabel: 'Delete order', tone: 'danger',
      });
      if (!yes) return;
    }
    setBusy(true);
    const { ok } = await adminWrite(supabase.from('orders').update({ deleted_at: flag ? new Date().toISOString() : null }).eq('id', order.id), { success: flag ? 'Order deleted. You can restore it from here.' : 'Order restored.' });
    setBusy(false);
    if (ok) refreshAll();
  }

  const moreItems = [
    { key: 'invoice', label: 'Open invoice page', icon: 'external', onSelect: () => window.open(`/invoice/${encodeURIComponent(order.order_id)}`, '_blank', 'noopener') },
    { separator: true },
    deleted
      ? { key: 'restore', label: 'Restore order', icon: 'undo', hint: 'Show it in lists and reports again', onSelect: () => setDeleted(false) }
      : { key: 'delete', label: 'Delete order…', icon: 'trash', tone: 'danger', hint: 'Hide it from lists and reports', onSelect: () => setDeleted(true) },
  ];

  return (
    <>
      <PageHeader
        title={order.order_id} crumbLabel={order.order_id}
        subtitle={(
          <span className="ord-headline">
            <StatusPill status={order.status} kind="order" />
            <StatusPill status={order.payment_status} kind="payment" />
            {deleted && <StatusPill kind="generic" tone="neutral" status="deleted" label="Deleted" />}
            <span>Placed <DateTime value={order.created_at} /></span>
          </span>
        )}
        actions={(
          <>
            {next && !deleted && <Button variant="primary" icon="check" onClick={() => setStatusTo(next)}>{ADVANCE_LABEL[next]}</Button>}
            {statusItems.length > 0 && !deleted && <ActionMenu label="Update status" icon="truck" items={statusItems} />}
            <ActionMenu label="Print" icon="doc" items={[
              { key: 'invoice', label: 'Invoice', icon: 'receipt', hint: 'GST tax invoice', onSelect: () => setPrintKind('invoice') },
              { key: 'packing', label: 'Packing slip', icon: 'box', hint: 'Items, address and barcode, no prices', onSelect: () => setPrintKind('packing') },
            ]} />
            <ActionMenu label="More" icon="more" items={moreItems} disabled={busy} />
          </>
        )}
      />

      <div className="adm-stack">
        {deleted && (
          <div className="ord-banner info" role="status">
            <Icon name="trash" size={20} />
            <div className="ord-banner-body">
              <div className="ord-banner-title">This order is deleted</div>
              <p>It is hidden from the orders list, the counts and the reports. Nothing was cancelled or refunded.</p>
              <div className="ord-banner-actions"><Button size="sm" icon="undo" loading={busy} onClick={() => setDeleted(false)}>Restore order</Button></div>
            </div>
          </div>
        )}

        {issue && (
          <div className="ord-banner danger" role="alert">
            <Icon name="warning" size={20} />
            <div className="ord-banner-body">
              <div className="ord-banner-title">Stock problem: paid, but no stock was reserved</div>
              <p>The payment landed after the customer's stock hold expired, so <strong>stock was not taken out</strong> for this order. {issue.reason ? <>The system recorded: “{issue.reason}” </> : null}{issue.detected_at ? <>(<DateTime value={issue.detected_at} />).</> : null}</p>
              <p>Check you can still supply the items and ship as normal, or cancel the order to refund the customer (cancelling does not add stock back, because none was taken). Then mark this resolved.</p>
              <div className="ord-banner-actions"><Button size="sm" icon="check" loading={busy} onClick={clearIssue}>Mark resolved</Button></div>
            </div>
          </div>
        )}

        {(cancelResult?.refundFailed || money.needsAttention) && (
          <div className="ord-banner warning" role="alert">
            <Icon name="warning" size={20} />
            <div className="ord-banner-body">
              <div className="ord-banner-title">The automatic refund did not go through</div>
              <p>
                {cancelResult?.refundFailed
                  ? <>The order <strong>is cancelled</strong>, and stock, coupon and gift card were put back, but the Razorpay refund failed{cancelResult.refundError ? <>: “{String(cancelResult.refundError).replace(/\.+$/, '')}”</> : ''}.</>
                  : <>A refund of this order failed at the payment gateway, and {money.remaining > 0 ? <strong>₹{money.remaining.toLocaleString('en-IN')} is still owed to the customer</strong> : 'money may still be owed'}.</>}
              </p>
              <p>Refund it from the Razorpay dashboard, or retry with <strong>Issue refund</strong>. An internal note with the details was added to this order.</p>
              <div className="ord-banner-actions">
                {money.canRefund && <Button size="sm" icon="undo" onClick={() => setRefundOpen(true)}>Retry with Issue refund</Button>}
                {cancelResult && <Button size="sm" variant="ghost" onClick={() => setCancelResult(null)}>Dismiss</Button>}
              </div>
            </div>
          </div>
        )}

        <div className="ord-detail">
          <div className="ord-main">
            <ItemsCard order={order} />
            <PaymentCard order={order} onRefund={() => setRefundOpen(true)} onCancel={() => setCancelOpen(true)} />
            <TimelineCard order={order} returns={returns.data || []} />
            <ReturnsCard returns={returns.data || []} />
          </div>
          <div className="ord-side">
            <CustomerCard order={order} />
            <AddressesCard order={order} />
            <ShippingCard order={order} onChanged={reload} />
            <DocumentsCard order={order} onPrint={setPrintKind} />
            <NotesCard order={order} notes={notes} onAdded={notes.reload} />
            <NotificationsCard order={order} sends={sends} />
          </div>
        </div>
      </div>

      <StatusChangeDialog order={order} to={statusTo} onClose={() => setStatusTo('')} onDone={() => { setStatusTo(''); refreshAll(); }} onFailed={staleCheck} />
      <CancelDialog
        order={order} open={cancelOpen} onClose={() => setCancelOpen(false)} onFailed={staleCheck}
        onDone={(res) => { setCancelOpen(false); setCancelResult(res.refundFailed ? res : null); refreshAll(); }}
      />
      <RefundDialog order={order} open={refundOpen} onClose={() => setRefundOpen(false)} onFailed={staleCheck} onDone={() => { setRefundOpen(false); refreshAll(); }} />
      {printKind && <PrintDialog kind={printKind} orders={[order]} onClose={() => setPrintKind('')} />}
    </>
  );
}
