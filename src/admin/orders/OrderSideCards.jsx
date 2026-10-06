import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../supabase';
import { useAuth } from '../../context/AuthContext';
import { callNotifyApi } from '../../utils/orderApi';
import { EVENT_FOR_STATUS, ORDER_EMAIL_EVENT_TYPES, emailEventLabel } from '../../utils/emailEvents';
import { ORDER_WHATSAPP_EVENT_TYPES } from '../../utils/whatsappEvents';
import { addressLines, formatDeliveryLabel, isPlaceholderEmail } from '../../utils/orderFormat';
import { safeHref } from '../../utils/safeUrl';
import { deleteFromStorage, staleMediaUrls } from '../../utils/supabaseStorage';
import { Button, Card, CopyButton, DateTime, Field, Icon, PackagePhotoField, Select, StatusPill, Textarea, TrackingFields } from '../ui';
import { adminWrite, useConfirm } from '../hooks';
import useLoad, { rowsOf } from './useLoad';
import { customerName, waNumber } from './orderLogic';

// ------------------------------------------------------------------------------------------ customer
export function CustomerCard({ order }) {
  const name = customerName(order);
  const email = order.user_email && !isPlaceholderEmail(order.user_email) ? order.user_email : '';
  const phone = order.user_phone || order.address?.phone || '';
  return (
    <Card title="Customer">
      <div className="ord-person">
        <span className="ord-person-name">{order.user_id ? <Link to={`/admin/customers/${order.user_id}`}>{name}</Link> : name}{!order.user_id && <> <span className="adm-chip">Guest</span></>}</span>
        {email && <span className="adm-row" style={{ gap: 2 }}><a href={`mailto:${email}`}>{email}</a><CopyButton text={email} /></span>}
        {phone && <span className="adm-row" style={{ gap: 2 }}><a href={`tel:${phone}`}>{phone}</a><CopyButton text={phone} /></span>}
        {!email && !phone && <span className="adm-muted">No contact details on this order.</span>}
        <div className="ord-actions-row" style={{ marginTop: 6 }}>
          {order.user_id && <Button size="sm" icon="user" to={`/admin/customers/${order.user_id}`}>View customer</Button>}
          {phone && <Button size="sm" icon="wa" href={`https://wa.me/${waNumber(phone)}`} target="_blank">WhatsApp</Button>}
          {email && <Button size="sm" icon="mail" href={`mailto:${email}`}>Email</Button>}
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------ addresses
function AddressBlock({ title, address, note }) {
  const lines = addressLines(address);
  return (
    <div className="ord-addr">
      <div className="ord-addr-head"><span>{title}</span>{lines.length > 0 && <CopyButton text={lines.join('\n')} label="Copy" />}</div>
      {lines.length ? <div className="ord-addr-body">{lines.join('\n')}</div> : <div className="adm-muted">{note || 'No address.'}</div>}
    </div>
  );
}

export function AddressesCard({ order }) {
  const ship = order.address || {};
  const bill = ship.billing && ship.billing.line1 ? ship.billing : null;
  const digital = (order.items || []).length > 0 && (order.items || []).every(i => i.isGiftCard);
  return (
    <Card title="Addresses">
      <AddressBlock title="Shipping address" address={ship} note={digital ? 'Nothing ships: this order only has a gift card.' : 'No shipping address was saved.'} />
      <AddressBlock title="Billing address" address={bill} note="Same as the shipping address." />
    </Card>
  );
}

// ------------------------------------------------------------------------------------------ shipping
export function ShippingCard({ order, onChanged }) {
  async function saveTracking(orderId, patch) {
    const { ok } = await adminWrite(supabase.from('orders').update(patch).eq('id', orderId), { success: 'Tracking saved. The customer was not messaged.' });
    if (ok) onChanged();
  }
  async function savePhoto(orderId, url) {
    const previous = order.package_image_url;
    const { ok } = await adminWrite(supabase.from('orders').update({ package_image_url: url }).eq('id', orderId), { success: url ? 'Package photo saved.' : 'Package photo removed.' });
    if (ok) {
      deleteFromStorage(staleMediaUrls(previous, url));   // the replaced / removed file is now orphaned (best effort)
      onChanged();
    }
  }
  const href = safeHref(order.tracking_url || '');
  const eta = formatDeliveryLabel(order.estimated_delivery);
  const closed = ['Cancelled', 'Returned'].includes(order.status);
  return (
    <Card title="Shipping" subtitle="Courier details are shown to the customer on their order page">
      <div className="adm-stack">
        <dl className="ord-kv">
          <div><dt>Estimated delivery</dt><dd>{eta || '—'}</dd></div>
          {order.shipping_carrier && <div><dt>Courier</dt><dd>{order.shipping_carrier}</dd></div>}
          {order.tracking_number && <div><dt>Tracking number</dt><dd><span className="ord-payid">{order.tracking_number}<CopyButton text={order.tracking_number} /></span></dd></div>}
          {href && <div><dt>Tracking page</dt><dd><a href={href} target="_blank" rel="noopener noreferrer">Open <Icon name="external" size={12} /></a></dd></div>}
          {order.shipped_at && <div><dt>Shipped</dt><dd><DateTime value={order.shipped_at} /></dd></div>}
          {order.delivered_at && <div><dt>Delivered</dt><dd><DateTime value={order.delivered_at} /></dd></div>}
        </dl>
        {!closed && (
          <div>
            <div className="adm-label" style={{ marginBottom: 8 }}>Update tracking</div>
            <p className="adm-hint" style={{ margin: '0 0 10px' }}>Saves the details only; it does not change the status or message the customer. To send the shipped message, mark the order Shipped.</p>
            <div className="ord-tracking"><TrackingFields order={order} onSave={saveTracking} /></div>
          </div>
        )}
        <div>
          <div className="adm-label" style={{ marginBottom: 8 }}>Package photo</div>
          <PackagePhotoField order={order} onSave={savePhoto} />
          <p className="adm-hint" style={{ margin: '8px 0 0' }}>Sent over WhatsApp in place of the product photo, for templates that use a photo.</p>
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------ internal notes
export function NotesCard({ order, notes, onAdded }) {
  const { currentUser } = useAuth();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  async function add() {
    const note = text.trim();
    if (!note || saving) return;
    setSaving(true);
    const { ok } = await adminWrite(supabase.from('order_notes').insert({ order_uuid: order.id, author: currentUser?.email || 'admin', note }), { success: 'Note added.' });
    setSaving(false);
    if (ok) { setText(''); onAdded(); }
  }

  const list = notes.data || [];
  return (
    <Card title="Internal notes" subtitle="Only the store team sees these">
      <Field label="Add a note" hint="e.g. “Customer asked to deliver after 6 pm”.">
        <Textarea rows={2} value={text} onChange={setText} maxLength={1000} />
      </Field>
      <div style={{ marginTop: 10 }}><Button variant="primary" size="sm" loading={saving} disabled={!text.trim()} onClick={add}>Add note</Button></div>
      {notes.error && <p className="adm-error" role="alert" style={{ marginTop: 10 }}>Could not load the notes. <button type="button" className="adm-link-btn" onClick={notes.reload}>Try again</button></p>}
      {list.length > 0 && (
        <ul className="ord-notes">
          {list.map(n => (
            <li key={n.id} className={`ord-note${n.author === 'system' ? ' is-system' : ''}`}>
              <div className="ord-note-text">{n.note}</div>
              <div className="ord-note-by">{n.author === 'system' ? 'Added automatically' : n.author} · <DateTime value={n.created_at} /></div>
            </li>
          ))}
        </ul>
      )}
      {!notes.error && !notes.loading && list.length === 0 && <p className="adm-muted" style={{ margin: '12px 0 0' }}>No notes yet.</p>}
    </Card>
  );
}

// ------------------------------------------------------------------------------------------ documents
export function DocumentsCard({ order, onPrint }) {
  return (
    <Card title="Documents">
      <div className="ord-actions-row">
        <Button icon="receipt" onClick={() => onPrint('invoice')}>Print invoice</Button>
        <Button icon="box" onClick={() => onPrint('packing')}>Packing slip</Button>
        <Button icon="external" href={`/invoice/${encodeURIComponent(order.order_id)}`} target="_blank">Invoice page</Button>
      </div>
      <p className="adm-hint" style={{ margin: '10px 0 0' }}>The invoice is the same GST tax invoice the customer can print. The packing slip has no prices.</p>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------ resend notification
export function NotificationsCard({ order, sends }) {
  const confirm = useConfirm();
  const emails = useLoad(() => rowsOf(supabase.from('email_templates').select('id, name, event_type').in('event_type', ORDER_EMAIL_EVENT_TYPES).eq('enabled', true).order('event_type').order('is_system', { ascending: false })), []);
  const whats = useLoad(() => rowsOf(supabase.from('whatsapp_templates').select('id, name, event_type').in('event_type', ORDER_WHATSAPP_EVENT_TYPES).eq('enabled', true).order('event_type')), []);
  const [emailId, setEmailId] = useState('');
  const [waId, setWaId] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const eventNow = EVENT_FOR_STATUS[order.status] || 'ORDER_CONFIRMED';
  const emailOptions = useMemo(() => (emails.data || []).map(t => ({ value: t.id, label: `${emailEventLabel(t.event_type)} — ${t.name || 'template'}` })), [emails.data]);
  const waOptions = useMemo(() => (whats.data || []).map(t => ({ value: t.id, label: `${emailEventLabel(t.event_type)} — ${t.name || 'template'}` })), [whats.data]);
  // Pre-pick the template that matches where the order is now.
  useEffect(() => {
    const e = (emails.data || []).find(t => t.event_type === eventNow) || (emails.data || [])[0];
    setEmailId(cur => ((emails.data || []).some(t => t.id === cur) ? cur : (e ? e.id : '')));
  }, [emails.data, eventNow]);
  useEffect(() => {
    const w = (whats.data || []).find(t => t.event_type === eventNow) || (whats.data || [])[0];
    setWaId(cur => ((whats.data || []).some(t => t.id === cur) ? cur : (w ? w.id : '')));
  }, [whats.data, eventNow]);

  async function send(kind) {
    const isEmail = kind === 'order-email';
    const templateId = isEmail ? emailId : waId;
    const label = (isEmail ? emailOptions : waOptions).find(o => o.value === templateId)?.label || 'this message';
    const to = isEmail ? order.user_email : order.user_phone;
    if (!to) { setError(isEmail ? 'This order has no email address.' : 'This order has no phone number.'); return; }
    const yes = await confirm({ title: `Send ${isEmail ? 'this email' : 'this WhatsApp message'} again?`, message: `“${label}” will be sent to ${to}. The customer receives it right away.`, confirmLabel: 'Send now' });
    if (!yes) return;
    setBusy(kind); setError('');
    const res = await callNotifyApi(kind, { orderId: order.id, templateId });
    setBusy('');
    if (!res.ok) { setError(res.error); toast.error(res.error); return; }
    toast.success(isEmail ? `Email sent to ${to}.` : `WhatsApp message sent to ${to}.`);
    sends.reload();
  }

  const log = sends.data || [];
  return (
    <Card title="Resend a notification" subtitle="Send any order message to the customer again">
      <div className="adm-stack">
        <div className="ord-send-row">
          <Field label="Email">
            {emailOptions.length
              ? <Select value={emailId} onChange={setEmailId} options={emailOptions} />
              : <div className="adm-muted">{emails.loading ? 'Loading templates…' : 'No enabled email templates.'}</div>}
          </Field>
          <Button icon="mail" loading={busy === 'order-email'} disabled={!emailId || !!busy} onClick={() => send('order-email')}>Send email</Button>
        </div>
        <div className="ord-send-row">
          <Field label="WhatsApp">
            {waOptions.length
              ? <Select value={waId} onChange={setWaId} options={waOptions} />
              : <div className="adm-muted">{whats.loading ? 'Loading templates…' : <>No enabled WhatsApp templates. <Link to="/admin/templates/whatsapp">Switch one on</Link>.</>}</div>}
          </Field>
          <Button icon="wa" loading={busy === 'order-whatsapp'} disabled={!waId || !!busy} onClick={() => send('order-whatsapp')}>Send WhatsApp</Button>
        </div>
        {error && <div className="adm-note danger" role="alert">{error}</div>}
        <div>
          <div className="adm-label">Emails sent for this order</div>
          {sends.error ? <p className="adm-error" role="alert">Could not load the email log.</p>
            : log.length === 0 ? <p className="adm-muted" style={{ margin: '6px 0 0' }}>{sends.loading ? 'Loading…' : 'No email has been recorded for this order yet.'}</p>
              : (
                <ul className="ord-sends">
                  {log.map(s => (
                    <li key={s.id} className={s.status === 'failed' ? 'is-failed' : ''} title={s.error_message || s.subject || ''}>
                      <span>{emailEventLabel(s.event_type)} · <StatusPill kind="generic" tone={s.status === 'failed' ? 'danger' : 'success'} status={s.status} label={s.status === 'failed' ? 'failed' : 'sent'} /></span>
                      <span className="adm-muted"><DateTime value={s.created_at} /></span>
                    </li>
                  ))}
                </ul>
              )}
        </div>
      </div>
    </Card>
  );
}
