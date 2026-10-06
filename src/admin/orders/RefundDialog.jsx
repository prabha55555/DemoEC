import React, { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Field, Modal, MoneyInput, Textarea } from '../ui';
import { callOrdersApi } from '../../utils/orderApi';
import { formatMoney, parseNumber } from '../lib/format';
import { checkNumber } from '../lib/validate';
import { refundSummary, round2 } from './orderLogic';
import NotifyPlan from './NotifyPlan';

const money = (n) => formatMoney(n) || '₹0';

// What a refund of `amount` does, in plain words. The part of the amount above what is left to refund to the payment
// method spills onto the gift card the order was partly paid with (that is how the server splits it).
export function refundExplanation(order, summary, amount) {
  const a = round2(amount);
  const online = Math.min(a, summary.remaining);
  const gift = Math.min(Math.max(round2(a - online), 0), summary.giftLeft);
  const lines = [];
  if (online > 0) {
    lines.push(order.payment_method === 'cod'
      ? `${money(online)} is recorded as a MANUAL refund: this was cash on delivery, so nothing goes through Razorpay and you pay the customer yourself (UPI or bank transfer).`
      : `${money(online)} goes back to the customer's original payment method through Razorpay (usually 5–7 business days).`);
  }
  if (gift > 0) lines.push(`${money(gift)} is credited back onto gift card ${summary.giftCode}.`);
  return lines;
}

// "Issue refund": a goodwill or partial refund on any order that took payment. The server caps the amount at what was
// actually charged (even against a second admin refunding at the same moment) and reports what really moved.
export default function RefundDialog({ order, open, onClose, onDone, onFailed }) {
  const summary = order ? refundSummary(order) : null;
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Start fresh each time the dialog OPENS -- not whenever the order is re-read (a refused refund re-reads it, and that must not wipe the error).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && order && !wasOpen.current) { const s = refundSummary(order); setAmount(String(s.cap !== null ? s.cap : s.remaining)); setReason(''); setError(''); setBusy(false); }
    wasOpen.current = !!(open && order);
  }, [open, order]);

  if (!open || !order) return null;
  const max = summary.maxAmount;
  const capped = summary.cap !== null;   // not delivered yet: only part of the order can be refunded here
  const amountError = checkNumber(amount, { required: true, min: 0.01, max, label: 'The amount' });
  const n = parseNumber(amount, 0);

  async function submit() {
    if (busy || amountError) return;
    setBusy(true); setError('');
    const res = await callOrdersApi('admin_refund', { orderId: order.order_id, amount: n, reason: reason.trim() || undefined });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      if (onFailed) onFailed(res);
      return;
    }
    const r = res.refund || {};
    const parts = [];
    if (r.onlineRefunded > 0) parts.push(r.manual ? `${money(r.onlineRefunded)} recorded as a manual refund` : `${money(r.onlineRefunded)} refunded to the original payment method`);
    if (r.giftCardCredited > 0) parts.push(`${money(r.giftCardCredited)} credited to the gift card`);
    toast.success(`${parts.join(' · ') || `${money(r.amount)} refunded`}.`, { duration: 6000 });
    onDone(res);
  }

  return (
    <Modal open onClose={onClose} busy={busy} size="md" title={`Refund ${order.order_id}`} subtitle={`${money(summary.refunded)} already refunded of ${money(summary.total)} charged`}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!!amountError} onClick={submit}>{`Refund ${n > 0 ? money(n) : ''}`.trim()}</Button>
        </>
      )}>
      <div className="adm-stack">
        <Field label="Amount to refund" required error={amountError}
          hint={capped
            ? `This order has not been delivered yet, so only part of it can be refunded here: up to ${money(summary.cap)}. To give back all of it, cancel the order instead (that also puts the items back in stock).`
            : `Up to ${money(summary.remaining)} can go back to the payment method${summary.giftLeft > 0 ? `, and ${money(summary.giftLeft)} to gift card ${summary.giftCode}` : ''}. The server never refunds more than was charged.`}>
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        <div className="ord-chips">
          <button type="button" className="ord-chip-btn" onClick={() => setAmount(String(capped ? summary.cap : summary.remaining))}>{capped ? `The most you can refund now (${money(summary.cap)})` : `Everything left (${money(summary.remaining)})`}</button>
          {summary.remaining >= 2 && <button type="button" className="ord-chip-btn" onClick={() => setAmount(String(round2(Math.min(summary.remaining / 2, capped ? summary.cap : Infinity))))}>Half</button>}
        </div>
        <Field label="Reason" optional hint="Kept on the refund record and shown to you later. It is also quoted in the refund message to the customer.">
          <Textarea rows={2} value={reason} onChange={setReason} maxLength={300} placeholder="e.g. Goodwill refund for a late delivery" />
        </Field>
        {!amountError && n > 0 && (
          <ul className="ord-cons" aria-label="What this refund does">
            {refundExplanation(order, summary, n).map(t => <li key={t}><span aria-hidden="true">•</span><span>{t}</span></li>)}
            <li><span aria-hidden="true">•</span><span>A refund cannot be undone.</span></li>
          </ul>
        )}
        <NotifyPlan eventType="REFUND_PROCESSED" order={order} fixed />
        {error && <div className="adm-note danger" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
