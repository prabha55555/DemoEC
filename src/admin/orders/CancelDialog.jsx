import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Field, Icon, Modal, Textarea } from '../ui';
import { callOrdersApi } from '../../utils/orderApi';
import { CANCEL_PRESETS, cancelConsequences } from './orderLogic';
import NotifyPlan from './NotifyPlan';

// "Cancel order": says exactly what WILL happen for this order (derived from the order itself: stock, coupon, gift card,
// payment), then calls api/orders admin_cancel. A gift-card order is refused by the server while its card is partly spent;
// that explanation is shown here as the server wrote it.
export default function CancelDialog({ order, open, onClose, onDone, onFailed }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (open) { setReason(''); setError(''); setBusy(false); } }, [open]);
  if (!open || !order) return null;
  const consequences = cancelConsequences(order);

  async function submit() {
    if (busy) return;
    setBusy(true); setError('');
    const res = await callOrdersApi('admin_cancel', { orderId: order.order_id, reason: reason.trim() || undefined });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      if (onFailed) onFailed(res);
      return;
    }
    if (res.refundFailed) toast.error(`${order.order_id} is cancelled, but the automatic refund failed.`, { duration: 8000 });
    else toast.success(`${order.order_id} is cancelled.`);
    onDone(res);
  }

  return (
    <Modal open onClose={onClose} busy={busy} size="md" role="alertdialog" title={`Cancel ${order.order_id}?`} subtitle={`Currently ${order.status}`}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Keep order</Button>
          <Button variant="danger" loading={busy} onClick={submit}>Cancel this order</Button>
        </>
      )}>
      <div className="adm-stack">
        <div>
          <div className="adm-label" style={{ marginBottom: 8 }}>What will happen</div>
          <ul className="ord-cons">
            {consequences.map(c => (
              <li key={c.kind} className={c.kind === 'status' || c.kind === 'gift-void' ? 'is-warn' : ''}>
                <Icon name={c.kind === 'status' || c.kind === 'gift-void' ? 'warning' : 'check'} size={16} /><span>{c.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <Field label="Reason" optional hint="Saved on the order and shown in the cancellation message to the customer.">
          <Textarea rows={2} value={reason} onChange={setReason} maxLength={300} placeholder="Why is this order being cancelled?" />
        </Field>
        <div className="ord-chips" aria-label="Common reasons">
          {CANCEL_PRESETS.map(p => <button key={p} type="button" className="ord-chip-btn" onClick={() => setReason(p)}>{p}</button>)}
        </div>
        <NotifyPlan eventType="ORDER_CANCELLED" order={order} fixed />
        {error && <div className="adm-note danger" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
