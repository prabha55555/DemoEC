import React, { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Field, FieldRow, Modal, Select, Textarea, TextInput } from '../ui';
import { callOrdersApi } from '../../utils/orderApi';
import { safeHref } from '../../utils/safeUrl';
import { COURIERS, needsShippingDetails, notifiedSentence } from './orderLogic';
import NotifyPlan from './NotifyPlan';

const OTHER = '__other';
const isHttp = (u) => /^https?:\/\//i.test(u) && !!safeHref(u);

// Carrier + tracking number + tracking link, as typed in the Shipped dialog. Pure, so the form's rules are one place.
export function shippingErrors({ number, url }) {
  const e = {};
  if (number.length > 80) e.number = 'Keep the tracking number under 80 characters.';
  if (url.trim() && !isHttp(url.trim())) e.url = 'Use a full https:// link.';
  return e;
}

// Moves one order to its next status through api/orders (admin_status): restocks / stamps the timeline / sends the
// customer's messages exactly once, on the server. Moving to Shipped asks for carrier, tracking number and link first.
//   <StatusChangeDialog order={order} to="Shipped" onClose={…} onDone={(res) => reload()} />
export default function StatusChangeDialog({ order, to, onClose, onDone, onFailed }) {
  const open = !!(order && to);
  const shipping = needsShippingDetails(to);
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(true);
  const [carrierChoice, setCarrierChoice] = useState('');
  const [carrierOther, setCarrierOther] = useState('');
  const [number, setNumber] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Start fresh (pre-filled with any tracking already saved) every time the dialog OPENS -- not whenever the order is
  // re-read (a refused move re-reads it, and that must not wipe the error or what was typed).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      const saved = order.shipping_carrier || '';
      setNote(''); setNotify(true); setError(''); setBusy(false);
      setCarrierChoice(!saved ? '' : COURIERS.includes(saved) ? saved : OTHER);
      setCarrierOther(saved && !COURIERS.includes(saved) ? saved : '');
      setNumber(order.tracking_number || ''); setUrl(order.tracking_url || '');
    }
    wasOpen.current = open;
  }, [open, order]);

  if (!open) return null;
  const carrier = carrierChoice === OTHER ? carrierOther.trim() : carrierChoice;
  const errors = shipping ? shippingErrors({ number, url }) : {};
  const invalid = Object.keys(errors).length > 0 || (shipping && carrierChoice === OTHER && !carrierOther.trim());

  async function submit() {
    if (busy || invalid) return;
    setBusy(true); setError('');
    const res = await callOrdersApi('admin_status', {
      orderId: order.order_id, status: to, note: note.trim() || undefined, notify,
      tracking: shipping ? { carrier, number: number.trim(), url: url.trim() } : undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      if (onFailed) onFailed(res);
      return;
    }
    const sent = notifiedSentence(res.notified);
    toast.success(`${order.order_id} is now ${to}.${sent ? ` ${sent}.` : ''}`, { duration: 5000 });
    onDone(res);
  }

  return (
    <Modal open onClose={onClose} busy={busy} size="md" title={`Mark ${order.order_id} as ${to}`} subtitle={`Currently ${order.status}`}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={invalid} onClick={submit}>{`Mark as ${to}`}</Button>
        </>
      )}>
      <div className="adm-stack">
        {shipping && (
          <>
            <p className="adm-hint" style={{ margin: 0 }}>Shown to the customer on their order page and in the shipped message. All three are optional, but customers ask about them.</p>
            <FieldRow cols={2}>
              <Field label="Carrier" optional>
                <Select value={carrierChoice} onChange={setCarrierChoice} placeholder="Choose a courier…" options={[...COURIERS, { value: OTHER, label: 'Other…' }]} />
              </Field>
              {carrierChoice === OTHER
                ? <Field label="Carrier name" required><TextInput value={carrierOther} onChange={setCarrierOther} maxLength={80} placeholder="e.g. Local courier" /></Field>
                : <Field label="Tracking number" optional error={errors.number}><TextInput value={number} onChange={setNumber} maxLength={90} placeholder="e.g. 1234567890" /></Field>}
            </FieldRow>
            {carrierChoice === OTHER && <Field label="Tracking number" optional error={errors.number}><TextInput value={number} onChange={setNumber} maxLength={90} placeholder="e.g. 1234567890" /></Field>}
            <Field label="Tracking link" optional error={errors.url} hint="The courier's tracking page for this parcel.">
              <TextInput type="url" value={url} onChange={setUrl} placeholder="https://…" inputMode="url" autoCapitalize="none" spellCheck={false} />
            </Field>
          </>
        )}
        <Field label="Note" optional hint="Goes in the order timeline, which the customer can see. For private notes use Internal notes.">
          <Textarea rows={2} value={note} onChange={setNote} maxLength={300} />
        </Field>
        <NotifyPlan to={to} order={order} notify={notify} onNotify={setNotify} />
        {error && <div className="adm-note danger" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
