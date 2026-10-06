import React, { useState } from 'react';
import toast from 'react-hot-toast';
import DialogShell from './DialogShell';
import { callOrdersApi } from '../utils/orderApi';
import { CANCEL_REASONS } from '../utils/orderStatus';
import { cancelRefundMessage } from '../utils/orderFormat';

// "Cancel order" for a customer (only offered while canCancel(order, 'customer')). Asks for a reason,
// calls the orders API, then tells the customer exactly what happens to their money.
//   onCancelled(result)  called after a successful cancel, when the dialog is dismissed
export default function CancelOrderDialog({ order, onClose, onCancelled }) {
  const [reason, setReason] = useState(CANCEL_REASONS[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null); // the API result once cancelled

  async function submit() {
    if (busy) return;
    const finalReason = [reason, note.trim()].filter(Boolean).join(': ').slice(0, 280);
    setBusy(true); setError('');
    const res = await callOrdersApi('cancel', { orderId: order.order_id, reason: finalReason });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    toast.success('Order cancelled.');
    setDone(res);
  }

  function finish() { onClose?.(); if (done) onCancelled?.(done); }

  if (done) {
    return (
      <DialogShell title="Order cancelled" onClose={finish} labelId="cancel-title"
        footer={<button type="button" className="btn btn-gold" onClick={finish}>Done</button>}>
        <div className="dlg-ok">
          <div className="dlg-ok-ico" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg></div>
          <p style={{ margin: '0 0 6px', fontWeight: 500 }}>Order {order.order_id} has been cancelled.</p>
          {done.refundFailed || done.refund?.ok === false ? (
            <p className="dlg-note is-warn" role="alert" style={{ textAlign: 'left' }}>
              {done.message || 'Your order is cancelled, but the refund could not be completed automatically. Our team has been notified and will process it manually.'}
            </p>
          ) : (
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.55 }}>{cancelRefundMessage(done.order || order, done.refund)}</p>
          )}
        </div>
      </DialogShell>
    );
  }

  const paid = order.payment_method !== 'cod' && Number(order.total) > 0;
  return (
    <DialogShell title="Cancel this order?" onClose={onClose} busy={busy} labelId="cancel-title"
      footer={(
        <>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>Keep order</button>
          <button type="button" className="btn btn-gold" onClick={submit} disabled={busy} aria-busy={busy}>
            {busy ? <span className="spinner" role="status" aria-label="Cancelling" style={{ width: 18, height: 18, borderWidth: 2 }} /> : 'Cancel order'}
          </button>
        </>
      )}>
      {error && <div className="dlg-err" role="alert">{error}</div>}
      <fieldset style={{ border: 'none', margin: 0, padding: 0 }} className="dlg-field">
        <legend className="form-label" style={{ marginBottom: 8 }}>Why are you cancelling?</legend>
        {CANCEL_REASONS.map(r => (
          <label key={r} className="dlg-radio">
            <input type="radio" name="cancel-reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
            <span>{r}</span>
          </label>
        ))}
      </fieldset>
      <div className="dlg-field">
        <label className="form-label" htmlFor="cancel-note">Anything else we should know? (optional)</label>
        <textarea id="cancel-note" className="form-input form-textarea" rows={2} maxLength={200} value={note} onChange={e => setNote(e.target.value)} style={{ minHeight: 64 }} />
      </div>
      <div className="dlg-note">
        {paid
          ? `You paid ₹${Number(order.total).toLocaleString('en-IN')}. It will be refunded to your original payment method in 5–7 business days.`
          : 'No payment has been taken for this order, so there is nothing to refund.'}
      </div>
    </DialogShell>
  );
}
