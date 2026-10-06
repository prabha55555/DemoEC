import React, { useEffect, useState } from 'react';
import { useMatch, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../supabase';
import { EMAIL_EVENTS, EMAIL_EVENT_TYPES, emailEventLabel } from '../../utils/emailEvents';
import { BLOCK_TYPES, emptyBlock } from '../../utils/emailBlocks';
import { variablesForEvent } from '../../utils/emailVariables';
import { Button, Card, CopyButton, DataTable, DateTime, ErrorState, Field, FieldRow, FilterBar, Icon, PageHeader, Pagination, SaveBar, Select, Skeleton, StatusPill, Textarea, TextInput, Toggle } from '../ui';
import { adminWrite, useConfirm, useRecord, useServerList, useUnsavedChanges, useUrlFilters } from '../hooks';
import { isEmail } from '../lib/validate';
import { safeHref } from '../../utils/safeUrl';

// Email templates (`email_templates`). Order and return emails now go out AUTOMATICALLY: when an order changes status,
// is cancelled or refunded, or a return is decided, the store sends the message for that event provided an ENABLED
// template exists for it (default templates are already set up). Switch a template off to stop that message.
// If several enabled templates exist for one event, the "System template" is used (otherwise the oldest).
//   /admin/templates/email   the list     /admin/templates/email/new, /admin/templates/email/:id   the editor
const DUPLICATE_ERRORS = { 23505: 'Another template is already the system template for this event. Turn off "System template" on that one first.' };
const FIELD_LABELS = { text: 'Text', label: 'Button label', url: 'Link URL', alt: 'Image description (alt text)' };
const blank = () => ({ event_type: EMAIL_EVENTS[0].type, name: '', subject: '', preview_text: '', sender_name: '', sender_email: '', body_blocks: [], enabled: true, is_system: false });

export default function EmailTemplatesPage() {
  const { id } = useParams();
  const isNew = useMatch('/admin/templates/email/new');
  if (isNew) return <TemplateEditor key="new" />;
  if (id) return <TemplateEditor key={id} id={id} />;
  return <TemplateList />;
}

// ── LIST ──────────────────────────────────────────────────
function TemplateList() {
  const confirm = useConfirm();
  const { values, set, reset, active } = useUrlFilters({ q: '', event: '', status: '', page: 1 });
  const list = useServerList({
    table: 'email_templates', search: values.q, searchColumns: ['name', 'subject'],
    filters: { event_type: values.event, enabled: values.status === 'on' ? true : values.status === 'off' ? false : '' },
    orderBy: { column: 'updated_at', ascending: false }, pageSize: 25, page: values.page, onPageChange: p => set({ page: p }),
  });

  async function toggle(t) {
    const { ok } = await adminWrite(supabase.from('email_templates').update({ enabled: !t.enabled, updated_at: new Date().toISOString() }).eq('id', t.id), { success: t.enabled ? 'Template switched off.' : 'Template switched on.' });
    if (ok) list.reload();
  }
  async function duplicate(t) {
    const copy = {
      event_type: t.event_type, name: `${t.name} (Copy)`, subject: t.subject, preview_text: t.preview_text, sender_name: t.sender_name,
      sender_email: t.sender_email, body_blocks: t.body_blocks, enabled: false, is_system: false,
    };
    const { ok } = await adminWrite(supabase.from('email_templates').insert(copy), { success: 'Template duplicated (switched off).' });
    if (ok) list.reload();
  }
  async function remove(t) {
    if (t.is_system) { toast.error('A system template cannot be deleted. Turn off "System template" on it first.'); return; }
    if (!(await confirm({ title: `Delete “${t.name}”?`, message: 'This template is removed permanently.', confirmLabel: 'Delete template', tone: 'danger' }))) return;
    const { ok } = await adminWrite(supabase.from('email_templates').delete().eq('id', t.id), { success: 'Template deleted.' });
    if (ok) list.reload();
  }

  return (
    <>
      <PageHeader title="Email templates" subtitle="Order and return emails customers receive" actions={<Button variant="primary" icon="plus" to="/admin/templates/email/new">New template</Button>} />
      <div className="adm-note info" style={{ marginBottom: 14 }}>
        Order and return emails send <strong>automatically</strong> — when an order changes status, is cancelled or refunded, or a return is decided — as long as an
        <strong> enabled</strong> template exists for that event. Default templates are already set up; edit the wording here, or switch a template off to stop that email.
        If two enabled templates exist for one event, the System template is the one used.
      </div>
      <FilterBar
        search={values.q} onSearch={q => set({ q })} searchPlaceholder="Search name or subject…"
        selects={[
          { key: 'event', label: 'Event', value: values.event, onChange: v => set({ event: v }), allLabel: 'All events', options: EMAIL_EVENTS.map(e => ({ value: e.type, label: e.label })) },
          { key: 'status', label: 'Status', value: values.status, onChange: v => set({ status: v }), allLabel: 'Any status', options: [{ value: 'on', label: 'Enabled' }, { value: 'off', label: 'Disabled' }] },
        ]}
        showClear={active} onClear={reset}
      />
      <DataTable
        caption="Email templates" rowHref={t => `/admin/templates/email/${t.id}`}
        columns={[
          { key: 'name', header: 'Name', render: t => <span>{t.name}{t.is_system && <span className="adm-chip" style={{ marginLeft: 8 }}>System</span>}</span> },
          { key: 'event_type', header: 'Event', render: t => emailEventLabel(t.event_type) },
          { key: 'subject', header: 'Subject', hideOnMobile: true, render: t => <span className="adm-muted">{t.subject}</span> },
          { key: 'enabled', header: 'Status', render: t => <StatusPill kind="generic" status={t.enabled ? 'enabled' : 'disabled'} /> },
          { key: 'updated_at', header: 'Updated', hideOnMobile: true, render: t => <DateTime value={t.updated_at} dateOnly /> },
          { key: 'actions', header: '', mobileLabel: '', align: 'right', render: t => (
            <div className="adm-cell-actions">
              <Button size="sm" onClick={() => toggle(t)}>{t.enabled ? 'Switch off' : 'Switch on'}</Button>
              <Button size="sm" icon="copy" onClick={() => duplicate(t)}>Duplicate</Button>
              {!t.is_system && <Button size="sm" variant="danger" iconOnly icon="trash" aria-label={`Delete ${t.name}`} onClick={() => remove(t)} />}
            </div>
          ) },
        ]}
        rows={list.rows} loading={list.loading} error={list.error} onRetry={list.reload}
        empty={active ? { icon: 'search', title: 'No templates match your filters' } : { icon: 'mail', title: 'No email templates yet', hint: 'Create a template to start sending emails for an event.', action: <Button variant="primary" icon="plus" to="/admin/templates/email/new">New template</Button> }}
        footer={<Pagination page={list.page} pageSize={list.pageSize} total={list.count} onPage={list.setPage} />}
      />
    </>
  );
}

// ── EDITOR ────────────────────────────────────────────────
function TemplateEditor({ id }) {
  const navigate = useNavigate();
  const { record, loading, error, notFound, reload } = useRecord('email_templates', id);
  const [form, setForm] = useState(() => (id ? null : blank()));
  const [saved, setSaved] = useState(() => (id ? null : blank()));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [addType, setAddType] = useState('');

  useEffect(() => {
    if (!id || !record) return;
    // A saved template can hold NULL for the optional fields; spreading it over the blank form would let null replace '' and crash .trim().
    const f = { ...blank(), ...record, name: record.name ?? '', subject: record.subject ?? '', preview_text: record.preview_text ?? '', sender_name: record.sender_name ?? '', sender_email: record.sender_email ?? '', body_blocks: Array.isArray(record.body_blocks) ? record.body_blocks : [] };
    delete f.id; delete f.created_at; delete f.updated_at;
    setForm(f); setSaved(f);
  }, [id, record]);

  const dirty = !!form && JSON.stringify(form) !== JSON.stringify(saved);
  useUnsavedChanges(dirty);
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: '' })); };
  const setBlock = (i, k, v) => setForm(f => ({ ...f, body_blocks: f.body_blocks.map((b, idx) => (idx === i ? { ...b, [k]: v } : b)) }));
  const moveBlock = (i, dir) => setForm(f => {
    const blocks = [...f.body_blocks]; const j = i + dir;
    if (j < 0 || j >= blocks.length) return f;
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
    return { ...f, body_blocks: blocks };
  });

  // Non-blocking: flags a {{token}} that is not a known variable so a typo is caught now, not rendered literally in a customer's inbox.
  function warnUnknownTokens() {
    const valid = variablesForEvent(form.event_type).map(v => v.key);
    const texts = [form.subject, form.preview_text, ...form.body_blocks.flatMap(b => [b.text, b.label, b.url].filter(Boolean))];
    const found = new Set();
    for (const t of texts) for (const m of String(t || '').matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi)) if (!valid.includes(m[1])) found.add(m[1]);
    if (found.size) toast(`Unrecognised variable${found.size > 1 ? 's' : ''}: ${[...found].map(k => `{{${k}}}`).join(', ')}`, { duration: 6000 });
  }

  async function save() {
    const e = {};
    if (!form.name.trim()) e.name = 'Give the template a name.';
    if (!form.subject.trim()) e.subject = 'A subject is required.';
    if (!EMAIL_EVENT_TYPES.includes(form.event_type)) e.event_type = 'Choose an event.';
    if (form.sender_email.trim() && !isEmail(form.sender_email)) e.sender_email = 'This does not look like a valid email address.';
    // A button / image link ends up as a real href / src in the email: only web, site-relative and mailto links are allowed
    // (a {{variable}} such as {{tracking_url}} is filled in later, so it passes).
    const badLink = form.body_blocks.find(b => b.url && b.url.trim() && !/\{\{/.test(b.url) && !(safeHref(b.url.trim()) && !/^tel:/i.test(b.url.trim())));
    if (badLink) e.blocks = `The ${badLink.type === 'image' ? 'image' : 'button'} link "${badLink.url}" is not a valid web address. Use https://… or a {{variable}}.`;
    setErrors(e);
    if (Object.keys(e).length) { toast.error('Please fix the highlighted fields.'); return; }
    setSaving(true);
    const payload = {
      event_type: form.event_type, name: form.name.trim(), subject: form.subject.trim(), preview_text: form.preview_text.trim(),
      sender_name: form.sender_name.trim() || null, sender_email: form.sender_email.trim() || null,
      body_blocks: form.body_blocks, enabled: !!form.enabled, is_system: !!form.is_system, updated_at: new Date().toISOString(),
    };
    const { ok } = await adminWrite(id ? supabase.from('email_templates').update(payload).eq('id', id) : supabase.from('email_templates').insert(payload),
      { success: id ? 'Template saved.' : 'Template created.', errors: DUPLICATE_ERRORS });
    setSaving(false);
    if (!ok) return;
    warnUnknownTokens();
    setSaved(form);
    navigate('/admin/templates/email');
  }

  const back = { to: '/admin/templates/email', label: 'All templates' };
  if (id && loading) return <><PageHeader title="Edit template" back={back} /><Card><Skeleton height={300} radius={10} /></Card></>;
  if (id && error) return <><PageHeader title="Edit template" back={back} /><Card pad={false}><ErrorState error={error} onRetry={reload} /></Card></>;
  if (id && notFound) return <><PageHeader title="Template not found" back={back} /><Card pad={false}><ErrorState title="Template not found" message="This template does not exist any more." /></Card></>;
  if (!form) return null;

  const event = EMAIL_EVENTS.find(ev => ev.type === form.event_type);
  const vars = variablesForEvent(form.event_type);

  return (
    <>
      <PageHeader title={id ? 'Edit email template' : 'New email template'} crumbLabel={form.name || undefined} />
      <div className="adm-stack" style={{ maxWidth: 940 }}>
        <Card title="Details">
          <div className="adm-stack">
            <FieldRow>
              <Field label="Template name" required error={errors.name}><TextInput value={form.name} onChange={v => set('name', v)} /></Field>
              <Field label="Event" error={errors.event_type} hint={event?.description}><Select value={form.event_type} onChange={v => set('event_type', v)} options={EMAIL_EVENTS.map(ev => ({ value: ev.type, label: ev.label }))} /></Field>
            </FieldRow>
            <Field label="Subject" required error={errors.subject}><TextInput value={form.subject} onChange={v => set('subject', v)} placeholder="e.g. Your order {{order_number}} is confirmed" /></Field>
            <Field label="Preview text" optional hint="Shown as the inbox preview line in most email apps."><TextInput value={form.preview_text} onChange={v => set('preview_text', v)} /></Field>
            <FieldRow>
              <Field label="Sender name" optional><TextInput value={form.sender_name} onChange={v => set('sender_name', v)} placeholder="Your store name" /></Field>
              <Field label="Sender email" optional error={errors.sender_email} hint="Leave blank to use the store's default sender."><TextInput value={form.sender_email} onChange={v => set('sender_email', v)} type="email" /></Field>
            </FieldRow>
            <div className="adm-row" style={{ gap: 32, alignItems: 'flex-start' }}>
              <Toggle checked={form.enabled} onChange={v => set('enabled', v)} label="Enabled" hint="Off = this email is not sent." />
              <Toggle checked={form.is_system} onChange={v => set('is_system', v)} label="System template for this event" hint="Used first when several enabled templates exist for the event. Only one per event." />
            </div>
          </div>
        </Card>

        <Card title="Content" subtitle="Build the email from blocks, top to bottom.">
          <div className="adm-stack">
            <div>
              <div className="adm-label" style={{ marginBottom: 6 }}>Variables you can use in the subject and text <span className="adm-opt">— click to copy</span></div>
              <div className="adm-vars">
                {vars.map(v => (
                  <span className="adm-var" key={v.key} title={v.note ? `${v.label} — ${v.note}` : v.label}>
                    {`{{${v.key}}}`}<CopyButton text={`{{${v.key}}}`} />
                  </span>
                ))}
              </div>
              <p className="adm-hint" style={{ marginTop: 6 }}>Hover a variable for what it fills in. A variable with no value yet (like a tracking number before dispatch) is left blank; one that is not in this list stays visible as typed.</p>
            </div>
            {form.body_blocks.length === 0 && <div className="adm-note">No blocks yet — add one below.</div>}
            {form.body_blocks.map((block, i) => {
              const def = BLOCK_TYPES.find(b => b.type === block.type);
              return (
                <div className="adm-block" key={i}>
                  <div className="adm-block-head">
                    <span className="adm-block-title">{def?.label || block.type}</span>
                    <div className="adm-block-tools">
                      <Button size="sm" iconOnly icon="arrowUp" aria-label={`Move block ${i + 1} up`} disabled={i === 0} onClick={() => moveBlock(i, -1)} />
                      <Button size="sm" iconOnly icon="arrowDown" aria-label={`Move block ${i + 1} down`} disabled={i === form.body_blocks.length - 1} onClick={() => moveBlock(i, 1)} />
                      <Button size="sm" variant="danger" iconOnly icon="trash" aria-label={`Remove block ${i + 1}`} onClick={() => set('body_blocks', form.body_blocks.filter((_, idx) => idx !== i))} />
                    </div>
                  </div>
                  {(def?.fields || []).map(fld => (
                    <Field key={fld} label={FIELD_LABELS[fld] || fld}>
                      {fld === 'text' ? <Textarea rows={3} value={block[fld] || ''} onChange={v => setBlock(i, fld, v)} /> : <TextInput value={block[fld] || ''} onChange={v => setBlock(i, fld, v)} />}
                    </Field>
                  ))}
                  {(def?.fields || []).length === 0 && <p className="adm-hint">Filled in automatically from the order — nothing to enter.</p>}
                </div>
              );
            })}
            {errors.blocks && <div className="adm-error" role="alert">{errors.blocks}</div>}
            <div className="adm-row">
              <div style={{ minWidth: 220, flex: '0 1 280px' }}><Select value={addType} onChange={setAddType} placeholder="Add a block…" options={BLOCK_TYPES.map(b => ({ value: b.type, label: b.label }))} aria-label="Block type to add" /></div>
              <Button icon="plus" disabled={!addType} onClick={() => { set('body_blocks', [...form.body_blocks, emptyBlock(addType)]); setAddType(''); }}>Add block</Button>
            </div>
          </div>
        </Card>
        <SaveBar dirty={dirty} saving={saving} onSave={save} onDiscard={() => { setForm(saved); setErrors({}); }} saveLabel={id ? 'Save template' : 'Create template'} />
        <p className="adm-hint"><Icon name="info" size={13} /> Saving does not send anything. Use the Email test page to check your sender setup.</p>
      </div>
    </>
  );
}
