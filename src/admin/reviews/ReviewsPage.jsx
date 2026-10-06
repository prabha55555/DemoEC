import React, { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../supabase';
import { thumb } from '../../utils/thumbnail';
import StarRating from '../../components/StarRating';
import { Button, DataTable, DateTime, FilterBar, Icon, PageHeader, Pagination, Tabs } from '../ui';
import { adminWrite, useConfirm, useServerList, useUrlFilters } from '../hooks';
import { useAdminCounts } from '../hooks/useAdminCounts';
import { useTabCounts } from '../orders/orderData';
import useLoad, { rowsOf } from '../orders/useLoad';
import '../orders/orders.css';

const COLUMNS = 'id, product_id, user_id, user_name, order_id, rating, title, body, status, verified_purchase, created_at';
const TABS = [{ key: 'pending', label: 'Pending' }, { key: 'approved', label: 'Approved' }, { key: 'rejected', label: 'Rejected' }];
const RATINGS = [5, 4, 3, 2, 1].map(n => ({ value: String(n), label: `${n} star${n === 1 ? '' : 's'}` }));

// The review text, trimmed to a few lines with "Read more" (a long review should not blow up the row).
function ReviewText({ review }) {
  const [open, setOpen] = useState(false);
  const long = (review.body || '').length > 180;
  return (
    <span className="rev-text">
      {review.title && <strong className="rev-title">{review.title}</strong>}
      {review.body ? <span className={open || !long ? 'rev-body' : 'rev-body is-clamped'}>{review.body}</span> : <span className="adm-muted">No written review.</span>}
      {long && <button type="button" className="adm-link-btn rev-more" onClick={() => setOpen(o => !o)} aria-expanded={open}>{open ? 'Show less' : 'Read more'}</button>}
    </span>
  );
}

// /admin/reviews?status=pending -- the moderation queue. A product's rating_avg / rating_count are recomputed by a
// database trigger whenever a review is approved, rejected or deleted, and only APPROVED reviews count towards them
// (and are shown on the product page). Customers can only post a review for a product from a delivered order, and
// always start as Pending.
export default function ReviewsPage() {
  const confirm = useConfirm();
  const { refresh: refreshAttention } = useAdminCounts();
  const { values, set } = useUrlFilters({ q: '', status: 'pending', rating: '', page: 1 });
  const status = TABS.some(t => t.key === values.status) ? values.status : 'pending';
  const filtered = !!(values.q || values.rating);   // a search / rating filter (the tab itself is not a "filter" here)
  const [nonce, setNonce] = useState(0);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);

  const list = useServerList({
    table: 'reviews', select: COLUMNS, filters: { status, rating: values.rating }, search: values.q, searchColumns: ['title', 'body', 'user_name'],
    orderBy: { column: 'created_at', ascending: false }, pageSize: 20, page: values.page, onPageChange: p => set({ page: p }),
  });
  const { counts } = useTabCounts({
    table: 'reviews', keys: TABS.map(t => t.key), nonce, search: values.q, searchColumns: ['title', 'body', 'user_name'],
    filtersFor: k => ({ status: k, rating: values.rating }),
  });
  const tabs = TABS.map(t => ({ ...t, count: counts[t.key] }));

  // Product names for the rows on screen (embedded selects are not available): one small query.
  const pids = Array.from(new Set(list.rows.map(r => r.product_id))).sort().join(',');
  const products = useLoad(() => rowsOf(supabase.from('products').select('id, name, images').in('id', pids.split(','))), [pids], { enabled: !!pids, initial: [] });
  const byId = useMemo(() => Object.fromEntries((products.data || []).map(p => [p.id, p])), [products.data]);

  const refreshAll = useCallback(() => { list.reload(); setNonce(n => n + 1); refreshAttention(); }, [list, refreshAttention]);

  async function moderate(ids, to) {
    setBusy(true);
    const label = to === 'approved' ? 'approved' : 'rejected';
    const { ok } = await adminWrite(supabase.from('reviews').update({ status: to }).in('id', ids), { success: ids.length === 1 ? `Review ${label}.` : `${ids.length} reviews ${label}.` });
    setBusy(false);
    if (ok) { setSelected(s => s.filter(id => !ids.includes(id))); refreshAll(); }
  }
  async function remove(ids) {
    const many = ids.length > 1;
    const yes = await confirm({
      title: many ? `Delete ${ids.length} reviews?` : 'Delete this review?',
      message: 'It is removed permanently and cannot be recovered. If you only want it off the product page, reject it instead: you keep the record.',
      confirmLabel: many ? 'Delete reviews' : 'Delete review', tone: 'danger',
    });
    if (!yes) return;
    setBusy(true);
    const { ok } = await adminWrite(supabase.from('reviews').delete().in('id', ids), { success: many ? `${ids.length} reviews deleted.` : 'Review deleted.' });
    setBusy(false);
    if (ok) { setSelected(s => s.filter(id => !ids.includes(id))); refreshAll(); }
  }

  const actions = (r) => (
    <span className="rev-actions">
      {r.status !== 'approved' && <Button size="sm" variant="primary" icon="check" disabled={busy} onClick={() => moderate([r.id], 'approved')} aria-label={`Approve the review by ${r.user_name || 'a customer'}`}>Approve</Button>}
      {r.status !== 'rejected' && <Button size="sm" icon="close" disabled={busy} onClick={() => moderate([r.id], 'rejected')} aria-label={`Reject the review by ${r.user_name || 'a customer'}`}>Reject</Button>}
      <Button size="sm" variant="ghost" iconOnly icon="trash" disabled={busy} onClick={() => remove([r.id])} aria-label={`Delete the review by ${r.user_name || 'a customer'}`} title="Delete" />
    </span>
  );

  const columns = [
    { key: 'product', header: 'Product', render: r => {
      const p = byId[r.product_id];
      const img = p && Array.isArray(p.images) ? p.images[0] : null;
      return (
        <span className="ord-items">
          {img ? <img className="adm-thumb" src={thumb(img, 88)} alt="" loading="lazy" /> : <span className="adm-thumb ord-thumb-empty"><Icon name="box" size={18} /></span>}
          <span className="ord-items-text">
            {p ? <Link className="ord-items-name" to={`/admin/products/${r.product_id}`}>{p.name}</Link> : <span className="adm-muted">{products.loading ? '…' : 'Product removed'}</span>}
            <span className="rev-stars"><StarRating value={r.rating} size={13} /></span>
          </span>
        </span>
      );
    } },
    { key: 'review', header: 'Review', render: r => (
      <span className="rev-cell">
        <ReviewText review={r} />
        {actions(r)}
      </span>
    ) },
    { key: 'customer', header: 'Customer', render: r => (
      <span className="ord-cust">
        {r.user_id ? <Link to={`/admin/customers/${r.user_id}`}>{r.user_name || 'Customer'}</Link> : (r.user_name || 'Customer')}
        {r.verified_purchase
          ? <span className="rev-verified"><Icon name="checkCircle" size={13} /> Verified purchase</span>
          : <span className="adm-cell-sub">Not a verified purchase</span>}
        {r.order_id && <span className="adm-cell-sub">Order {r.order_id}</span>}
        <span className="adm-cell-sub"><DateTime value={r.created_at} dateOnly /></span>
      </span>
    ) },
  ];

  return (
    <>
      <PageHeader title="Reviews" subtitle="Approve or reject what customers write about your products"
        actions={<Button icon="refresh" onClick={refreshAll}>Refresh</Button>} />
      <div className="adm-note info" role="note" style={{ marginBottom: 14 }}>
        <Icon name="info" size={15} /> Only <strong>approved</strong> reviews appear on the product page and count towards its star rating. Ratings update by themselves when you approve, reject or delete a review.
      </div>
      <Tabs label="Review status" items={tabs} value={status} onChange={k => { setSelected([]); set({ status: k }); }} />
      <FilterBar
        search={values.q} onSearch={q => set({ q })} searchPlaceholder="Search review text or customer…"
        selects={[{ key: 'rating', label: 'Rating', value: values.rating, onChange: v => set({ rating: v }), allLabel: 'Any rating', options: RATINGS }]}
        showClear={filtered} onClear={() => set({ q: '', rating: '' })}
      />
      {selected.length > 0 && (
        <div className="ord-bulk" role="region" aria-label="Bulk actions">
          <strong>{selected.length} selected</strong>
          {status !== 'approved' && <Button size="sm" variant="primary" icon="check" disabled={busy} onClick={() => moderate(selected, 'approved')}>Approve</Button>}
          {status !== 'rejected' && <Button size="sm" icon="close" disabled={busy} onClick={() => moderate(selected, 'rejected')}>Reject</Button>}
          <Button size="sm" variant="danger" icon="trash" disabled={busy} onClick={() => remove(selected)}>Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear selection</Button>
        </div>
      )}
      <DataTable
        caption="Reviews" rowKey="id" columns={columns} rows={list.rows} loading={list.loading} error={list.error} onRetry={list.reload}
        selectable selectedKeys={selected} onSelectionChange={setSelected}
        empty={filtered
          ? { icon: 'search', title: 'No reviews match your filters', hint: 'Try another tab, rating or search.', action: <Button onClick={() => set({ q: '', rating: '' })}>Clear filters</Button> }
          : status === 'pending'
            ? { icon: 'star', title: 'Nothing waiting for you', hint: 'New reviews from customers with a delivered order land here for approval.' }
            : { icon: 'star', title: `No ${status} reviews`, hint: 'Reviews you moderate will be listed here.' }}
        footer={<Pagination page={list.page} pageSize={list.pageSize} total={list.count} onPage={list.setPage} />}
      />
    </>
  );
}
