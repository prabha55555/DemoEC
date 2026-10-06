import React, { useMemo, useState } from 'react';
import { supabase } from '../../supabase';
import { Button, Card, DataTable, DateTime, ErrorState, Money, Pagination, Stat, StatusPill } from '../ui';
import { exportCsv, useServerList } from '../hooks';
import { fetchAllCapped } from '../lib/queries';
import { formatMoney } from '../lib/format';
import useLoad from '../orders/useLoad';
import { COUPON_ORDER_COLUMNS, REPORT_ROW_CAP } from './reportData';
import { COUPON_CSV_COLUMNS, couponReport } from './reportMath';

// Orders that used a coupon in the period: one line per code (uses, what it cost, what those orders brought in), then the
// orders themselves. Cancelled orders are left out (the use was given back). Click a code to see just its orders.
export default function CouponsReport({ range, bounds }) {
  const [code, setCode] = useState('');
  const res = useLoad(async () => {
    const { rows, truncated } = await fetchAllCapped(() => supabase.from('orders').select(COUPON_ORDER_COLUMNS)
      .gte('created_at', bounds.fromISO).lt('created_at', bounds.toISO).not('coupon_code', 'is', null).neq('status', 'Cancelled').is('deleted_at', null)
      .order('created_at').order('id'), { pageSize: 1000, maxRows: REPORT_ROW_CAP });
    return { ...couponReport(rows), truncated };
  }, [bounds.fromISO, bounds.toISO]);
  const orders = useServerList({
    table: 'orders', select: 'id, order_id, created_at, user_name, user_email, coupon_code, discount, total, status',
    filters: { created_at: { gte: bounds.fromISO, lt: bounds.toISO }, coupon_code: code || { not: ['is', null] }, status: { neq: 'Cancelled' }, deleted_at: null },
    orderBy: [{ column: 'created_at', ascending: false }, { column: 'id', ascending: false }], pageSize: 15,
  });
  const lines = useMemo(() => (res.data ? res.data.lines : []), [res.data]);

  if (res.error) return <Card pad={false}><ErrorState error={res.error} onRetry={res.reload} /></Card>;
  const loading = res.loading && !res.data;
  const t = res.data ? res.data.totals : { uses: 0, discount: 0, revenue: 0 };

  return (
    <div className="adm-stack loose">
      <div className="adm-kpis c4">
        <Stat label="Orders with a coupon" icon="tag" tone="primary" loading={loading} value={t.uses.toLocaleString('en-IN')} hint={`${lines.length} different code${lines.length === 1 ? '' : 's'}`} />
        <Stat label="Discount given" icon="receipt" tone="warning" loading={loading} value={formatMoney(t.discount) || '₹0'} hint="What the coupons cost you" />
        <Stat label="Order value" icon="card" tone="success" loading={loading} value={formatMoney(t.revenue) || '₹0'} hint="Charged on those orders" />
        <Stat label="Average discount" icon="chart" tone="info" loading={loading} value={t.uses ? formatMoney(Math.round((t.discount / t.uses) * 100) / 100) : '—'} hint="Per order that used a coupon" />
      </div>
      {res.data && res.data.truncated && <div className="adm-note warning" role="note">This period has more than {REPORT_ROW_CAP.toLocaleString('en-IN')} coupon orders, so the totals cover the first {REPORT_ROW_CAP.toLocaleString('en-IN')} only. Choose a shorter date range.</div>}

      <Card title="By coupon code" subtitle="Click a code to see its orders below"
        actions={<Button icon="download" disabled={loading || lines.length === 0} onClick={() => exportCsv(`coupons-${range.from}-to-${range.to}.csv`, COUPON_CSV_COLUMNS, lines)}>Export CSV</Button>} pad={false}>
        <DataTable
          caption="Coupon usage" stickyHeader={false} rowKey="code" className="ord-bare" loading={loading} onRowClick={l => setCode(c => (c === l.code ? '' : l.code))}
          rowClassName={l => (l.code === code ? 'ord-row-picked' : '')}
          columns={[
            { key: 'code', header: 'Coupon', render: l => <span className="adm-mono"><strong>{l.code}</strong></span> },
            { key: 'uses', header: 'Orders', align: 'right', render: l => l.uses },
            { key: 'discount', header: 'Discount given', align: 'right', render: l => <Money value={l.discount} /> },
            { key: 'average', header: 'Avg discount', align: 'right', hideOnMobile: true, render: l => <Money value={l.average} /> },
            { key: 'revenue', header: 'Order value', align: 'right', render: l => <Money value={l.revenue} /> },
          ]}
          rows={lines} empty={{ icon: 'tag', title: 'No coupons were used in this period', hint: 'Orders that used a coupon code will be summed up here.' }}
        />
      </Card>

      <Card title={code ? `Orders that used ${code}` : 'Orders that used a coupon'} subtitle={code ? undefined : 'Newest first'}
        actions={code ? <Button size="sm" icon="close" onClick={() => setCode('')}>Show all codes</Button> : undefined} pad={false}>
        <DataTable
          caption="Orders that used a coupon" stickyHeader={false} rowKey="id" rowHref={o => `/admin/orders/${encodeURIComponent(o.order_id)}`} className="ord-bare"
          columns={[
            { key: 'order_id', header: 'Order', className: 'ord-nowrap', render: o => <strong>{o.order_id}</strong> },
            { key: 'created_at', header: 'Placed', className: 'ord-nowrap', render: o => <DateTime value={o.created_at} dateOnly /> },
            { key: 'customer', header: 'Customer', render: o => o.user_name || o.user_email || 'Guest' },
            { key: 'coupon_code', header: 'Coupon', render: o => <span className="adm-mono">{o.coupon_code}</span> },
            { key: 'discount', header: 'Discount', align: 'right', render: o => <Money value={o.discount} /> },
            { key: 'total', header: 'Total', align: 'right', render: o => <Money value={o.total} /> },
            { key: 'status', header: 'Status', render: o => <StatusPill status={o.status} kind="order" /> },
          ]}
          rows={orders.rows} loading={orders.loading} error={orders.error} onRetry={orders.reload}
          empty={{ icon: 'cart', title: 'No orders', hint: 'No order used a coupon in this period.' }}
          footer={<Pagination page={orders.page} pageSize={orders.pageSize} total={orders.count} onPage={orders.setPage} />}
        />
      </Card>
    </div>
  );
}
