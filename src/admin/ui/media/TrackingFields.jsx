import React, { useEffect, useState } from 'react';
import Button from '../Button';
import { Field, TextInput } from '../Field';
import { safeHref } from '../../../utils/safeUrl';

// Carrier + tracking number / URL, entered once an order ships. Free text on purpose: no fixed courier list
// to maintain. Local draft state with ONE explicit Save (nothing is written per keystroke).
//   <TrackingFields order={order} onSave={async (orderId, { shipping_carrier, tracking_number, tracking_url }) => …} />
// Resyncs when the order's saved values change (after a save, or when the order is reloaded).
export default function TrackingFields({ order, onSave, saveLabel = 'Save tracking' }) {
  const [carrier, setCarrier] = useState(order.shipping_carrier || '');
  const [number, setNumber] = useState(order.tracking_number || '');
  const [url, setUrl] = useState(order.tracking_url || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCarrier(order.shipping_carrier || '');
    setNumber(order.tracking_number || '');
    setUrl(order.tracking_url || '');
  }, [order.shipping_carrier, order.tracking_number, order.tracking_url]);

  const urlError = url.trim() && !safeHref(url.trim()) ? 'Use a full https:// link.' : '';
  const dirty = carrier !== (order.shipping_carrier || '') || number !== (order.tracking_number || '') || url !== (order.tracking_url || '');

  async function save() {
    if (saving || urlError) return;
    setSaving(true);
    try {
      await onSave(order.id, { shipping_carrier: carrier.trim() || null, tracking_number: number.trim() || null, tracking_url: url.trim() || null });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="adm-tracking">
      <Field label="Carrier"><TextInput value={carrier} onChange={setCarrier} placeholder="e.g. Delhivery" /></Field>
      <Field label="Tracking number"><TextInput value={number} onChange={setNumber} placeholder="e.g. 1234567890" /></Field>
      <Field label="Tracking URL" error={urlError}><TextInput value={url} onChange={setUrl} placeholder="https://…" type="url" /></Field>
      <Button variant="primary" loading={saving} disabled={!dirty || !!urlError} onClick={save}>{saveLabel}</Button>
    </div>
  );
}
