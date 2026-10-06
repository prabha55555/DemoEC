import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../supabase';
import { withTimeout } from '../../utils/withTimeout';
import { Button, DataTable, DateTime, FilterBar, PageHeader, Pagination, StatusPill } from '../ui';
import { adminWrite, useServerList, useUrlFilters } from '../hooks';

// Back-in-stock requests: customers who asked to be told when a sold-out item returns (`product_notifications`).
// Each request now points at a specific variant (variant_id), so the variant label (e.g. "M / Red") is shown, along
// with that variant's current stock -- "Back in stock" tells you it is time to let them know. Older requests only
// have the legacy `size` text, which is shown instead.
export default function StockAlertsPage() {
  const { values, set, reset, active } = useUrlFilters({ q: '', status: '', page: 1 });
  const list = useServerList({
    table: 'product_notifications', search: values.q, searchColumns: ['product_name', 'user_name', 'user_email', 'user_phone'],
    filters: { status: values.status }, orderBy: { column: 'created_at', ascending: false }, pageSize: 25,
    page: values.page, onPageChange: p => set({ page: p }),
  });

  // Variant labels + live stock for the rows on screen (a second small query: embedded selects are not available).
  const [variants, setVariants] = useState({});
  const ids = Array.from(new Set(list.rows.map(r => r.variant_id).filter(Boolean))).sort().join(',');
  useEffect(() => {
    if (!ids) return undefined;
    let cancelled = false;
    withTimeout(supabase.from('product_variants').select('id, label, stock, track_inventory, active').in('id', ids.split(',')), 15000)
      .then(({ data }) => { if (!cancelled && data) setVariants(Object.fromEntries(data.map(v => [v.id, v]))); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [ids]);

  async function markNotified(n) {
    const { ok } = await adminWrite(supabase.from('product_notifications').update({ status: 'notified', notified_at: new Date().toISOString() }).eq('id', n.id), { success: 'Marked as notified.' });
    if (ok) list.reload();
  }

  const variantOf = (n) => (n.variant_id ? variants[n.variant_id] : null);

  return (
    <>
      <PageHeader title="Stock alerts" subtitle="Customers waiting for a sold-out item to come back. Tell them yourself, then mark the request as notified." />
      <FilterBar
        search={values.q} onSearch={q => set({ q })} searchPlaceholder="Search product, name, email or phone…"
        selects={[{ key: 'status', label: 'Status', value: values.status, onChange: v => set({ status: v }), allLabel: 'All requests', options: [{ value: 'waiting', label: 'Waiting for stock' }, { value: 'notified', label: 'Notified' }] }]}
        showClear={active} onClear={reset}
      />
      <DataTable
        caption="Back-in-stock requests"
        columns={[
          { key: 'customer', header: 'Customer', render: n => (
            <span>{n.user_name || '—'}<span className="adm-cell-sub" style={{ display: 'block' }}>{n.user_email}{n.user_phone ? ` · ${n.user_phone}` : ''}</span></span>
          ) },
          { key: 'product', header: 'Product', render: n => (
            <span>
              {n.product_id ? <Link to={`/admin/products/${n.product_id}`}>{n.product_name || 'Product'}</Link> : n.product_name}
              {(variantOf(n)?.label || n.size) && <span className="adm-cell-sub" style={{ display: 'block' }}>{variantOf(n)?.label || n.size}</span>}
            </span>
          ) },
          { key: 'stock', header: 'Stock now', hideOnMobile: true, render: n => {
            const v = variantOf(n);
            if (!v) return <span className="adm-muted">—</span>;
            if (!v.track_inventory) return <StatusPill kind="stock" status="untracked" />;
            return v.stock > 0 ? <StatusPill kind="generic" tone="success" status="in_stock" label={`Back in stock (${v.stock})`} /> : <StatusPill kind="stock" status="out" />;
          } },
          { key: 'created_at', header: 'Requested', hideOnMobile: true, render: n => <DateTime value={n.created_at} dateOnly /> },
          { key: 'status', header: 'Status', render: n => <StatusPill kind="generic" status={n.status === 'notified' ? 'notified' : 'waiting'} /> },
          { key: 'actions', header: '', mobileLabel: '', align: 'right', render: n => (n.status !== 'notified' ? <Button size="sm" icon="check" onClick={() => markNotified(n)}>Mark notified</Button> : null) },
        ]}
        rows={list.rows} loading={list.loading} error={list.error} onRetry={list.reload}
        empty={active
          ? { icon: 'search', title: 'No requests match your filters', hint: 'Try clearing a filter.' }
          : { icon: 'bell', title: 'No stock alerts yet', hint: 'When shoppers ask to be told about a sold-out item, they will appear here.' }}
        footer={<Pagination page={list.page} pageSize={list.pageSize} total={list.count} onPage={list.setPage} />}
      />
    </>
  );
}
