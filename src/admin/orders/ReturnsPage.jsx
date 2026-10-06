import React, { useMemo } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { supabase } from '../../supabase';
import { Button, DataTable, DateTime, FilterBar, Money, PageHeader, Pagination, StatusPill, Tabs } from '../ui';
import { useServerList, useUrlFilters } from '../hooks';
import ReturnDetail from './ReturnDetail';
import { RETURN_COLUMNS, useTabCounts } from './orderData';
import useLoad, { rowsOf } from './useLoad';
import { itemsSummaryText, shortReturnId } from './orderLogic';
import './orders.css';

// The tabs, in the order a return moves through them.
const TABS = ['Requested', 'Approved', 'Pickup Scheduled', 'Received', 'Refunded', 'Rejected', 'Closed'];

// /admin/returns (list)  and  /admin/returns/:id (one request). The shell registers this section as returns/*.
export default function ReturnsPage() {
  return (
    <Routes>
      <Route index element={<ReturnsList />} />
      <Route path=":id" element={<ReturnDetail />} />
    </Routes>
  );
}

function ReturnsList() {
  const { values, set, reset, active } = useUrlFilters({ q: '', status: '', page: 1 });
  const statuses = values.status ? values.status.split(',').map(s => s.trim()).filter(s => TABS.includes(s)) : [];
  const custom = statuses.length > 1 ? statuses.join(',') : '';
  const list = useServerList({
    table: 'order_returns', select: RETURN_COLUMNS, filters: { status: statuses }, search: values.q, searchColumns: ['order_id', 'reason'],
    orderBy: { column: 'created_at', ascending: false }, pageSize: 25, page: values.page, onPageChange: p => set({ page: p }),
  });
  const { counts } = useTabCounts({
    table: 'order_returns', keys: ['', ...(custom ? [custom] : []), ...TABS], search: values.q, searchColumns: ['order_id', 'reason'],
    filtersFor: k => (k ? { status: k.split(',') } : {}),
  });
  const tabs = [
    { key: '', label: 'All', count: counts[''] },
    ...(custom ? [{ key: custom, label: custom.split(',').join(' + '), count: counts[custom] }] : []),
    ...TABS.map(s => ({ key: s, label: s, count: counts[s] })),
  ];

  // The customer's name lives on the order: one small query for the rows on screen (embedded selects are not available).
  const ids = Array.from(new Set(list.rows.map(r => r.order_uuid))).sort().join(',');
  const orders = useLoad(() => rowsOf(supabase.from('orders').select('id, order_id, user_name, user_email, user_phone, status, total, refunded_amount').in('id', ids.split(','))), [ids], { enabled: !!ids, initial: [] });
  const byId = useMemo(() => Object.fromEntries((orders.data || []).map(o => [o.id, o])), [orders.data]);

  return (
    <>
      <PageHeader title="Returns" subtitle="Review return and replacement requests, collect the goods and refund" actions={<Button icon="refresh" onClick={list.reload}>Refresh</Button>} />
      <Tabs label="Return status" items={tabs} value={values.status} onChange={k => set({ status: k })} />
      <FilterBar search={values.q} onSearch={q => set({ q })} searchPlaceholder="Search order number or reason…" showClear={active} onClear={reset} />
      <DataTable
        caption="Return requests" rowKey="id" rowHref={r => `/admin/returns/${r.id}`}
        columns={[
          { key: 'id', header: 'Return', className: 'ord-nowrap', render: r => <span><strong>{shortReturnId(r.id)}</strong>{r.type === 'replacement' && <span className="ord-flag is-muted">Replacement</span>}</span> },
          { key: 'order', header: 'Order', className: 'ord-nowrap', render: r => <Link to={`/admin/orders/${encodeURIComponent(r.order_id)}`}>{r.order_id}</Link> },
          { key: 'customer', header: 'Customer', render: r => {
            const o = byId[r.order_uuid];
            return o ? <span className="ord-cust">{o.user_name || o.user_email || 'Guest'}<span className="adm-cell-sub">{o.user_phone || o.user_email || ''}</span></span> : <span className="adm-muted">{orders.loading ? '…' : '—'}</span>;
          } },
          { key: 'items', header: 'Items', render: r => <span className="ord-clamp" title={itemsSummaryText(r.items)}>{itemsSummaryText(r.items) || '—'}</span> },
          { key: 'reason', header: 'Reason', hideOnMobile: true, render: r => <span className="ord-clamp" title={r.details || r.reason}>{r.reason || '—'}</span> },
          { key: 'created_at', header: 'Requested', className: 'ord-nowrap', render: r => <DateTime value={r.created_at} relative /> },
          { key: 'refund', header: 'Refund', align: 'right', className: 'ord-nowrap', render: r => <Money value={r.refund_amount} /> },
          { key: 'status', header: 'Status', render: r => <StatusPill status={r.status} kind="return" /> },
        ]}
        rows={list.rows} loading={list.loading} error={list.error} onRetry={list.reload}
        empty={active
          ? { icon: 'search', title: 'No returns match your filters', hint: 'Try another tab or a different search.', action: <Button onClick={reset}>Clear filters</Button> }
          : { icon: 'undo', title: 'No return requests yet', hint: 'When a customer asks to return or replace something from a delivered order, it shows up here.' }}
        footer={<Pagination page={list.page} pageSize={list.pageSize} total={list.count} onPage={list.setPage} />}
      />
    </>
  );
}
