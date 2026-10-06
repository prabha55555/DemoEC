import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../../supabase';
import { WHATSAPP_EVENTS } from '../../utils/whatsappEvents';
import { WHATSAPP_VARIABLES } from '../../utils/whatsappVariables';
import { Button, Card, CopyButton, ErrorState, Field, PageHeader, SkeletonRows, StatusPill, Textarea, TextInput, Toggle } from '../ui';
import { adminWrite, useServerList, useUnsavedChanges } from '../hooks';

// WhatsApp templates (`whatsapp_templates`): one message per event. They send AUTOMATICALLY -- when an order is
// placed, shipped, out for delivery, delivered, cancelled or refunded -- provided an ENABLED template exists for the
// event (defaults are already set up). event_type is unique, so saving is an upsert keyed on it.
// A customer-query message only knows {{product_name}}; every order message knows the order variables.
const variablesFor = (type) => (type === 'PRODUCT_ENQUIRY_RECEIVED'
  ? WHATSAPP_VARIABLES.filter(v => v.key === 'product_name')
  : WHATSAPP_VARIABLES.filter(v => v.key !== 'product_name'));

export default function WhatsAppTemplatesPage() {
  const list = useServerList({ table: 'whatsapp_templates', orderBy: { column: 'event_type', ascending: true }, pageSize: 50 });
  const saved = Object.fromEntries(list.rows.map(t => [t.event_type, t]));
  const [drafts, setDrafts] = useState({}); // event_type -> edited copy, present only while it differs
  const [savingType, setSavingType] = useState(null);

  const view = (type) => drafts[type] || saved[type] || { event_type: type, name: '', message: '', enabled: true };
  const edit = (type, patch) => setDrafts(d => ({ ...d, [type]: { ...view(type), ...patch } }));
  useUnsavedChanges(Object.keys(drafts).length > 0);

  async function save(evt) {
    const t = view(evt.type);
    if (!t.message.trim()) { toast.error('The message cannot be empty.'); return; }
    setSavingType(evt.type);
    const { ok } = await adminWrite(
      supabase.from('whatsapp_templates').upsert({ event_type: evt.type, name: (t.name || evt.label).trim(), message: t.message, enabled: t.enabled !== false, updated_at: new Date().toISOString() }, { onConflict: 'event_type' }),
      { success: `${evt.label} message saved.` },
    );
    setSavingType(null);
    if (!ok) return;
    setDrafts(d => { const next = { ...d }; delete next[evt.type]; return next; });
    list.reload();
  }

  return (
    <>
      <PageHeader title="WhatsApp templates" subtitle="Messages customers get on WhatsApp as their order moves along" />
      <div className="adm-note info" style={{ marginBottom: 14 }}>
        These messages send <strong>automatically</strong> when an order is placed, shipped, out for delivery, delivered, cancelled or refunded — as long as an
        <strong> enabled</strong> template exists for that event. Default messages are already set up; edit the wording here or switch one off to stop it.
        Customers need a saved phone number to receive them.
      </div>
      {list.error ? <Card pad={false}><ErrorState error={list.error} onRetry={list.reload} /></Card>
        : list.loading && list.rows.length === 0 ? <Card><SkeletonRows rows={4} thumb={false} /></Card>
          : (
            <div className="adm-stack" style={{ maxWidth: 940 }}>
              {WHATSAPP_EVENTS.map(evt => {
                const t = view(evt.type);
                const exists = !!saved[evt.type];
                const dirty = !!drafts[evt.type];
                const vars = variablesFor(evt.type);
                return (
                  <Card key={evt.type}
                    title={<span>{evt.label} <StatusPill kind="generic" status={!exists ? 'draft' : t.enabled !== false ? 'enabled' : 'disabled'} label={!exists ? 'Not set up' : undefined} /></span>}
                    subtitle={evt.description}
                    footer={(
                      <>
                        <Button variant="primary" loading={savingType === evt.type} disabled={!dirty} onClick={() => save(evt)}>{exists ? 'Save message' : 'Create message'}</Button>
                        <Button disabled={!dirty || savingType === evt.type} onClick={() => setDrafts(d => { const n = { ...d }; delete n[evt.type]; return n; })}>Discard</Button>
                        {dirty && <span className="adm-hint">Unsaved changes.</span>}
                      </>
                    )}>
                    <div className="adm-stack">
                      <Toggle checked={t.enabled !== false} onChange={v => edit(evt.type, { enabled: v })} label="Send this message" hint="Off = customers do not get this message." />
                      <Field label="Template name"><TextInput value={t.name || ''} onChange={v => edit(evt.type, { name: v })} placeholder={evt.label} /></Field>
                      <Field label="Message">
                        <Textarea rows={7} value={t.message} onChange={v => edit(evt.type, { message: v })} placeholder="Hi {{customer_name}}, your order {{order_id}} …" className="adm-mono" />
                      </Field>
                      <div>
                        <div className="adm-label" style={{ marginBottom: 6 }}>Variables <span className="adm-opt">— click to copy</span></div>
                        <div className="adm-vars">
                          {vars.map(v => (
                            <span className="adm-var" key={v.key} title={v.note ? `${v.label} — ${v.note}` : v.label}>{`{{${v.key}}}`}<CopyButton text={`{{${v.key}}}`} /></span>
                          ))}
                        </div>
                        <p className="adm-hint" style={{ marginTop: 6 }}>Hover a variable to see what it fills in. Amounts are numbers only — put the ₹ in your own text.</p>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
    </>
  );
}
