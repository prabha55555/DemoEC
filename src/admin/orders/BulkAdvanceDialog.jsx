import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Icon, Modal, Toggle } from '../ui';
import { callOrdersApi } from '../../utils/orderApi';
import { EVENT_FOR_STATUS, emailEventLabel } from '../../utils/emailEvents';
import { notifiedSentence, planNotification, runBulkAdvance } from './orderLogic';
import useNotifyTemplates from './useNotifyTemplates';

// api/orders allows 60 requests per 10 minutes per address, and every order here is one request.
export const MAX_BULK = 50;

// One destination status: how many orders go there and which customer messages that sends.
function EventLine({ to, count, notify }) {
  const eventType = EVENT_FOR_STATUS[to] || null;
  const { loading, templates } = useNotifyTemplates(eventType);
  let text;
  if (!eventType) text = 'no customer message for this step';
  else if (loading) text = 'checking templates…';
  else if (templates.failed) text = 'could not check the templates';
  else {
    const plan = planNotification({ to, order: { user_email: 'x', user_phone: 'x' }, templates });
    const sends = plan.lines.filter(l => l.state === 'send').map(l => (l.channel === 'email' ? 'email' : 'WhatsApp'));
    text = notify && sends.length
      ? `${sends.join(' + ')} "${emailEventLabel(eventType)}" to each customer who has one`
      : sends.length ? 'customers are not told (notification switched off)' : `nothing is sent: no enabled "${emailEventLabel(eventType)}" template`;
  }
  return <li><strong>{count} order{count === 1 ? '' : 's'} → {to}</strong><span className="adm-muted"> · {text}</span></li>;
}

// Advance many orders one step each: confirm -> run one at a time with progress -> a per-order report of what failed.
//   <BulkAdvanceDialog plan={planBulkAdvance(selected)} onClose={…} onFinished={() => reload()} />
export default function BulkAdvanceDialog({ plan, onClose, onFinished }) {
  const [phase, setPhase] = useState('confirm');
  const [notify, setNotify] = useState(true);
  const [progress, setProgress] = useState({ index: 0, total: 0, orderId: '' });
  const [result, setResult] = useState(null);
  if (!plan) return null;
  const { moves, skipped, summary } = plan;
  const tooMany = moves.length > MAX_BULK;
  const toShipped = moves.some(m => m.to === 'Shipped');
  const anyMessage = summary.some(s => EVENT_FOR_STATUS[s.to]);

  async function run() {
    setPhase('running');
    const id = toast.loading(`Updating 1 of ${moves.length}…`);
    const res = await runBulkAdvance(
      moves,
      (m, o) => callOrdersApi('admin_status', { orderId: m.orderId, status: m.to, notify: o.notify }),
      {
        notify,
        onProgress: ({ index, total, move }) => {
          setProgress({ index, total, orderId: move.orderId });
          toast.loading(`Updating ${index + 1} of ${total}: ${move.orderId}…`, { id });
        },
      },
    );
    toast.dismiss(id);
    setResult(res);
    setPhase('done');
    if (res.failed.length === 0 && res.notAttempted.length === 0) toast.success(`${res.done.length} order${res.done.length === 1 ? '' : 's'} updated.`);
    else toast.error(`${res.done.length} updated, ${res.failed.length + res.notAttempted.length} not.`);
    onFinished(res);
  }

  const running = phase === 'running';
  const title = phase === 'done' ? 'Bulk update finished' : `Advance ${moves.length} order${moves.length === 1 ? '' : 's'}`;

  return (
    <Modal open onClose={onClose} busy={running} title={title} size="md"
      footer={phase === 'confirm' ? (
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" disabled={moves.length === 0 || tooMany} onClick={run}>{`Update ${moves.length} order${moves.length === 1 ? '' : 's'}`}</Button>
        </>
      ) : phase === 'done' ? <Button variant="primary" onClick={onClose}>Done</Button> : null}>
      {phase === 'confirm' && (
        <div className="adm-stack">
          <p className="adm-modal-text" style={{ margin: 0 }}>Each selected order moves one step along its own path. They are updated one after another.</p>
          {moves.length > 0 && <ul className="ord-bulk-list">{summary.map(s => <EventLine key={s.to} to={s.to} count={s.count} notify={notify} />)}</ul>}
          {skipped.length > 0 && (
            <div className="adm-note">
              <strong>{skipped.length} will be skipped</strong>: {skipped.slice(0, 6).map(s => `${s.orderId} (${s.reason.toLowerCase()})`).join(', ')}{skipped.length > 6 ? `, and ${skipped.length - 6} more` : ''}.
            </div>
          )}
          {tooMany && <div className="adm-note danger" role="alert">Select {MAX_BULK} orders or fewer at a time: the server allows 60 order requests per 10 minutes.</div>}
          {toShipped && <div className="adm-note warning">Orders moving to Shipped go out <strong>without a courier or tracking number</strong>. Add them on each order afterwards (that does not re-send the message), or ship them one by one to enter tracking first.</div>}
          {anyMessage && <Toggle checked={notify} onChange={setNotify} label="Notify the customers" hint="Email / WhatsApp, only where an enabled template exists and the customer has an address / number." />}
        </div>
      )}
      {running && (
        <div className="adm-stack" role="status" aria-live="polite">
          <div className="adm-progress" aria-hidden="true"><div style={{ width: `${Math.round(((progress.index) / Math.max(1, progress.total)) * 100)}%` }} /></div>
          <p className="adm-modal-text" style={{ margin: 0 }}>Updating {progress.index + 1} of {progress.total}: <strong>{progress.orderId}</strong>… Please keep this window open.</p>
        </div>
      )}
      {phase === 'done' && result && (
        <div className="adm-stack">
          <div className={`adm-note ${result.failed.length + result.notAttempted.length ? 'warning' : 'success'}`}>
            <strong>{result.done.length} of {moves.length} updated.</strong>
            {result.done.some(d => d.notified) && <> {notifiedSummary(result.done)}</>}
          </div>
          {result.failed.length > 0 && (
            <div>
              <div className="adm-label" style={{ marginBottom: 6 }}>Could not update ({result.failed.length})</div>
              <ul className="ord-bulk-fail">
                {result.failed.map(f => <li key={f.id}><Icon name="warning" size={15} /><span><strong>{f.orderId}</strong> ({f.from} → {f.to}): {f.error}</span></li>)}
              </ul>
            </div>
          )}
          {result.notAttempted.length > 0 && (
            <div className="adm-note danger" role="alert">
              Stopped because the server asked us to slow down. <strong>Not attempted:</strong> {result.notAttempted.map(m => m.orderId).join(', ')}. Wait a few minutes and run them again.
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// "Messages: 8 emails sent, 2 not sent (no template)." from every order's `notified`.
function notifiedSummary(done) {
  const counts = { emailSent: 0, waSent: 0, other: 0 };
  done.forEach(d => {
    if (!d.notified) return;
    if (d.notified.email === 'sent') counts.emailSent += 1;
    if (d.notified.whatsapp === 'sent') counts.waSent += 1;
    if (notifiedSentence(d.notified) && d.notified.email !== 'sent' && d.notified.whatsapp !== 'sent') counts.other += 1;
  });
  const bits = [];
  if (counts.emailSent) bits.push(`${counts.emailSent} email${counts.emailSent === 1 ? '' : 's'} sent`);
  if (counts.waSent) bits.push(`${counts.waSent} WhatsApp message${counts.waSent === 1 ? '' : 's'} sent`);
  if (!bits.length) return 'No customer messages went out.';
  return `${bits.join(', ')}.`;
}
