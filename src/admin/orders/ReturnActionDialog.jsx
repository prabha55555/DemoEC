import React, { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Checkbox, Field, Modal, MoneyInput, Textarea } from '../ui';
import { callOrdersApi } from '../../utils/orderApi';
import { formatMoney, parseNumber } from '../lib/format';
import { checkNumber } from '../lib/validate';
import { RETURN_EVENT, itemsSummaryText, refundSummary, round2, shortReturnId } from './orderLogic';
import NotifyPlan from './NotifyPlan';

const money = (n) => formatMoney(n) || '₹0';

const TITLES = {
  Approved: 'Approve this return', Rejected: 'Reject this return', 'Pickup Scheduled': 'Pickup scheduled', Received: 'Mark the goods as received',
  Refunded: 'Refund this return', Closed: 'Close without a refund',
};
const BLURBS = {
  Approved: 'The customer is told the return is approved. Next you arrange the pickup, receive the goods and refund.',
  Rejected: 'The customer is told the return was not approved, along with your note. This is final.',
  'Pickup Scheduled': 'Records that a pickup is arranged. Nothing is sent to the customer.',
  Received: 'Records that the goods are back with you. Nothing is sent to the customer. Refund next.',
  Closed: 'Closes the request with no refund (for example a replacement that was sent instead). This is final.',
};

// One move of a return through the flow, via api/orders return_update. Refunding also asks how much and whether the goods
// go back on the shelf; every other move just takes a note. The server's answer (a refused move, a failed gateway refund,
// "nothing left to refund") is shown here verbatim and the dialog stays open so the admin can fix it and retry.
export default function ReturnActionDialog({ ret, order, to, note: initialNote = '', onClose, onDone, onFailed }) {
  const open = !!(ret && order && to);
  const refund = to === 'Refunded';
  const summary = order ? refundSummary(order) : null;
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [restock, setRestock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Start fresh each time the dialog OPENS, not whenever the return / order is re-read (a refused move re-reads them and must keep its error).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      const s = refundSummary(order);
      setNote(initialNote); setBusy(false); setError('');
      setAmount(String(round2(Math.min(Number(ret.refund_amount) || 0, s.remaining))));
      setRestock(ret.restock !== false);
    }
    wasOpen.current = open;
  }, [open, ret, order, initialNote]);

  if (!open) return null;
  const remaining = summary.remaining;
  const amountError = refund ? checkNumber(amount, { required: true, min: 0.01, max: remaining, label: 'The amount' }) : '';
  const noteError = to === 'Rejected' && !note.trim() ? 'Tell the customer why: your note is included in the message they receive.' : '';
  const n = parseNumber(amount, 0);
  const cod = order.payment_method === 'cod';
  const blocked = refund && remaining <= 0;

  async function submit() {
    if (busy || amountError || noteError || blocked) return;
    setBusy(true); setError('');
    const res = await callOrdersApi('return_update', {
      returnId: ret.id, status: to, adminNote: note.trim(),
      ...(refund ? { refundAmount: n, restock } : {}),
    });
    setBusy(false);
    if (!res.ok) { setError(res.error); if (onFailed) onFailed(res); return; }
    if (refund) {
      const r = res.refund || {};
      toast.success(`${r.manual ? `${money(r.amount)} recorded as a manual refund` : `${money(r.amount)} refunded to the original payment method`}${restock ? ' and the items were restocked' : ''}.`, { duration: 6000 });
    } else toast.success(`Return ${shortReturnId(ret.id)}: ${to.toLowerCase()}.`);
    onDone(res);
  }

  return (
    <Modal open onClose={onClose} busy={busy} size="md" role={to === 'Rejected' || to === 'Closed' ? 'alertdialog' : 'dialog'}
      title={TITLES[to] || `Move to ${to}`} subtitle={`${ret.type === 'replacement' ? 'Replacement' : 'Return'} ${shortReturnId(ret.id)} · order ${order.order_id}`}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Back</Button>
          <Button variant={to === 'Rejected' ? 'danger' : 'primary'} loading={busy} disabled={!!amountError || !!noteError || blocked} onClick={submit}>
            {refund ? `Refund ${n > 0 ? money(n) : ''}`.trim() : TITLES[to]}
          </Button>
        </>
      )}>
      <div className="adm-stack">
        {!refund && <p className="adm-modal-text" style={{ margin: 0 }}>{BLURBS[to]}</p>}

        {refund && (
          <>
            {blocked && <div className="adm-note danger" role="alert">This order has no refundable balance left ({money(order.refunded_amount)} of {money(order.total)} is already refunded), so there is nothing to refund. Close the request instead.</div>}
            <Field label="Amount to refund" required error={amountError}
              hint={`Proposed ${money(ret.refund_amount)} for the returned items (what the customer paid for them, after any coupon). At most ${money(remaining)} is still refundable on this order.`}>
              <MoneyInput value={amount} onChange={setAmount} disabled={blocked} />
            </Field>
            <Checkbox checked={restock} onChange={setRestock} label="Restock the returned items"
              hint={`Puts ${itemsSummaryText(ret.items) || 'the items'} back into stock. Untick if they are damaged and cannot be resold.`} />
            {!amountError && n > 0 && (
              <ul className="ord-cons" aria-label="What this refund does">
                <li><span aria-hidden="true">•</span><span>{cod
                  ? `${money(n)} is recorded as a MANUAL refund: this was cash on delivery, so nothing goes through Razorpay and you pay the customer yourself (UPI or bank transfer).`
                  : `${money(n)} goes back to the customer's original payment method through Razorpay (usually 5–7 business days).`}</span></li>
                {round2(Number(order.refunded_amount) + n) >= round2(order.total) - 0.005 && order.status === 'Delivered' && <li><span aria-hidden="true">•</span><span>This refunds the whole order, so the order is marked <strong>Returned</strong>.</span></li>}
                <li><span aria-hidden="true">•</span><span>A refund cannot be undone.</span></li>
              </ul>
            )}
          </>
        )}

        <Field label={to === 'Rejected' ? 'Note to the customer' : 'Note'} required={to === 'Rejected'} optional={to !== 'Rejected'} error={noteError}
          hint={to === 'Approved' || to === 'Rejected' || refund ? 'Saved on the request and included in the message the customer receives.' : 'Saved on the request. The customer does not see it.'}>
          <Textarea rows={2} value={note} onChange={setNote} maxLength={1000} />
        </Field>

        {RETURN_EVENT[to]
          ? <NotifyPlan eventType={RETURN_EVENT[to]} order={order} fixed channels={refund ? undefined : ['email']} />
          : <div className="adm-note">Nothing is sent to the customer for this step.</div>}
        {error && <div className="adm-note danger" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
