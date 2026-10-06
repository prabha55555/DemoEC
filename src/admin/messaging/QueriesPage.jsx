import React, { useState } from 'react';
import { supabase } from '../../supabase';
import { Button, DataTable, DateTime, FilterBar, Modal, PageHeader, Pagination, Select, StatusPill } from '../ui';
import { adminWrite, useConfirm, useServerList, useUrlFilters } from '../hooks';

// Customer queries (the `enquiries` table): questions from the product page, the contact form and WhatsApp.
// The stored status values are unchanged (Received · Contacted · Quoted · Closed) so nothing downstream breaks, but
// the screen only offers New / Contacted / Closed; an old "Quoted" row shows as Contacted until you change it.
const STATUS_OPTIONS = [{ value: 'Received', label: 'New' }, { value: 'Contacted', label: 'Contacted' }, { value: 'Closed', label: 'Closed' }];
const shownStatus = (s) => (s === 'Quoted' ? 'Contacted' : (s || 'Received'));
const statusLabel = (s) => STATUS_OPTIONS.find(o => o.value === shownStatus(s)).label;
const TONES = { Received: 'warning', Contacted: 'info', Closed: 'neutral' };
const FILTER_STATUSES = { Received: 'Received', Contacted: ['Contacted', 'Quoted'], Closed: 'Closed' };

// Indian mobile -> wa.me number (10 digits get the 91 prefix).
const waNumber = (phone) => { const d = String(phone || '').replace(/\D/g, ''); return d.length === 10 ? `91${d}` : d.replace(/^0+/, ''); };

export default function QueriesPage() {
  const confirm = useConfirm();
  const { values, set, reset, active } = useUrlFilters({ q: '', status: '', page: 1 });
  const list = useServerList({
    table: 'enquiries', search: values.q, searchColumns: ['product', 'user_name', 'user_email', 'user_phone', 'message'],
    filters: { status: FILTER_STATUSES[values.status] || '' }, orderBy: { column: 'created_at', ascending: false }, pageSize: 25,
    page: values.page, onPageChange: p => set({ page: p }),
  });
  const [open, setOpen] = useState(null);

  async function setStatus(q, status) {
    if (shownStatus(q.status) === status) return;
    const previous = q.status;
    list.setRows(rows => rows.map(r => (r.id === q.id ? { ...r, status } : r)));
    setOpen(o => (o && o.id === q.id ? { ...o, status } : o));
    const { ok } = await adminWrite(supabase.from('enquiries').update({ status }).eq('id', q.id), { success: `Marked ${statusLabel(status).toLowerCase()}.` });
    if (!ok) { list.setRows(rows => rows.map(r => (r.id === q.id ? { ...r, status: previous } : r))); setOpen(o => (o && o.id === q.id ? { ...o, status: previous } : o)); }
  }

  async function remove(q) {
    const yes = await confirm({ title: 'Delete this query?', message: 'It is removed permanently and cannot be recovered.', confirmLabel: 'Delete query', tone: 'danger' });
    if (!yes) return;
    const { ok } = await adminWrite(supabase.from('enquiries').delete().eq('id', q.id), { success: 'Query deleted.' });
    if (ok) { setOpen(null); list.reload(); }
  }

  return (
    <>
      <PageHeader title="Customer queries" subtitle="Questions from shoppers, by contact form and WhatsApp" />
      <FilterBar
        search={values.q} onSearch={q => set({ q })} searchPlaceholder="Search name, email, phone, product or message…"
        selects={[{ key: 'status', label: 'Status', value: values.status, onChange: v => set({ status: v }), allLabel: 'All queries', options: STATUS_OPTIONS }]}
        showClear={active} onClear={reset}
      />
      <DataTable
        caption="Customer queries" onRowClick={setOpen}
        columns={[
          { key: 'customer', header: 'Customer', render: q => (
            <span style={{ overflowWrap: 'anywhere' }}>{q.user_name || 'Guest'}<span className="adm-cell-sub" style={{ display: 'block' }}>{q.user_email}{q.user_phone ? ` · ${q.user_phone}` : ''}</span></span>
          ) },
          { key: 'product', header: 'About', render: q => q.product || <span className="adm-muted">General</span> },
          { key: 'message', header: 'Message', hideOnMobile: true, render: q => <span className="adm-muted" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', maxWidth: 360 }}>{q.message || '—'}</span> },
          { key: 'created_at', header: 'Received', hideOnMobile: true, render: q => <DateTime value={q.created_at} relative /> },
          { key: 'type', header: 'Via', hideOnMobile: true, render: q => <span className="adm-chip">{q.type || 'Email'}</span> },
          { key: 'status', header: 'Status', render: q => (
            <Select aria-label={`Status of the query from ${q.user_name || 'a guest'}`} value={shownStatus(q.status)} onChange={v => setStatus(q, v)} options={STATUS_OPTIONS} />
          ) },
        ]}
        rows={list.rows} loading={list.loading} error={list.error} onRetry={list.reload}
        empty={active ? { icon: 'search', title: 'No queries match your filters', hint: 'Try clearing a filter.' } : { icon: 'chat', title: 'No customer queries yet', hint: 'Questions from shoppers will show up here.' }}
        footer={<Pagination page={list.page} pageSize={list.pageSize} total={list.count} onPage={list.setPage} />}
      />

      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `Query from ${open.user_name || 'a guest'}` : ''} subtitle={open ? (open.product ? `About: ${open.product}` : 'General query') : ''}
        footer={open && (
          <>
            <Button variant="danger" icon="trash" onClick={() => remove(open)}>Delete</Button>
            <Button variant="primary" onClick={() => setOpen(null)}>Done</Button>
          </>
        )}>
        {open && (
          <div className="adm-stack">
            <div className="adm-row">
              <StatusPill kind="generic" tone={TONES[shownStatus(open.status)]} status={shownStatus(open.status)} label={statusLabel(open.status)} />
              <span className="adm-chip">{open.type || 'Email'}</span>
              <span className="adm-muted"><DateTime value={open.created_at} /></span>
            </div>
            <div className="adm-note" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 260, overflowY: 'auto' }}>{open.message || 'No message.'}</div>
            <div className="adm-row">
              {open.user_email && <Button size="sm" icon="mail" href={`mailto:${open.user_email}?subject=${encodeURIComponent(`Re: ${open.product || 'your query'}`)}`}>Email {open.user_email}</Button>}
              {open.user_phone && <Button size="sm" icon="wa" href={`https://wa.me/${waNumber(open.user_phone)}`} target="_blank">WhatsApp</Button>}
              {open.user_phone && <Button size="sm" href={`tel:${open.user_phone}`}>Call {open.user_phone}</Button>}
            </div>
            <div className="adm-field" style={{ maxWidth: 240 }}>
              <label className="adm-label" htmlFor="q-status">Status</label>
              <Select id="q-status" value={shownStatus(open.status)} onChange={v => setStatus(open, v)} options={STATUS_OPTIONS} />
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
