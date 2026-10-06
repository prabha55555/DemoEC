import React, { useMemo, useState } from 'react';
import { Button, Card, Checkbox, DataTable, ErrorState, Money, Skeleton, Stat, formatDate } from '../ui';
import { exportCsv } from '../hooks';
import { formatMoney, keyToDate } from '../lib/format';
import RevenueChart from '../dashboard/RevenueChart';
import useLoad from '../orders/useLoad';
import { rpcRows } from './reportData';
import { SALES_CSV_COLUMNS, buildSalesSeries, chartBuckets, salesTotals } from './reportMath';
import { daysInRange } from './dateRange';

// Sales per day from admin_sales_daily(): orders, sales, refunds, net, units and the average order value.
//   sales = what the goods + delivery cost before any gift card; refunds are their own column; net = sales - refunds.
export default function SalesReport({ range, bounds }) {
  const [quiet, setQuiet] = useState(false);
  const res = useLoad(() => rpcRows('admin_sales_daily', { p_from: bounds.fromISO, p_to: bounds.toISO }), [bounds.fromISO, bounds.toISO]);
  const series = useMemo(() => (res.data ? buildSalesSeries(res.data, range) : []), [res.data, range]);
  const totals = useMemo(() => salesTotals(series), [series]);
  const buckets = useMemo(() => chartBuckets(series), [series]);
  const weekly = series.length > 92;
  const rows = useMemo(() => series.filter(d => quiet || d.orders > 0).slice().reverse(), [series, quiet]);
  const days = daysInRange(range);

  if (res.error) return <Card pad={false}><ErrorState error={res.error} onRetry={res.reload} /></Card>;
  const loading = res.loading && !res.data;
  const tile = (props) => <Stat loading={loading} {...props} />;

  return (
    <div className="adm-stack loose">
      <div className="adm-kpis c3">
        {tile({ label: 'Net sales', icon: 'receipt', tone: 'primary', value: formatMoney(totals.net) || '₹0', hint: 'Sales minus refunds' })}
        {tile({ label: 'Orders', icon: 'cart', tone: 'info', value: totals.orders.toLocaleString('en-IN'), hint: `${totals.units.toLocaleString('en-IN')} unit${totals.units === 1 ? '' : 's'} sold` })}
        {tile({ label: 'Average order value', icon: 'card', tone: 'success', value: totals.orders ? formatMoney(totals.aov) : '—', hint: 'Net sales per order' })}
        {tile({ label: 'Sales (before refunds)', icon: 'chart', tone: 'neutral', value: formatMoney(totals.sales) || '₹0', hint: 'Goods + delivery, before any gift card' })}
        {tile({ label: 'Refunds', icon: 'undo', tone: totals.refunds > 0 ? 'warning' : 'neutral', value: formatMoney(totals.refunds) || '₹0', hint: 'Refunded on these orders' })}
        {tile({ label: 'Units sold', icon: 'box', tone: 'neutral', value: totals.units.toLocaleString('en-IN'), hint: 'Gift cards are not counted' })}
      </div>

      <Card title="Net sales" subtitle={`${weekly ? 'Per week (Monday start)' : 'Per day'} · cancelled orders are left out`}>
        {loading ? <Skeleton height={220} radius={10} /> : totals.orders === 0
          ? <p className="adm-muted" style={{ margin: 0 }}>No orders in this period. Try a longer date range.</p>
          : <RevenueChart buckets={buckets} />}
      </Card>

      <Card title="Day by day" subtitle={days > 1 ? `${rows.length} of ${days} days` : undefined}
        actions={(
          <>
            <Checkbox checked={quiet} onChange={setQuiet} label="Show days with no orders" />
            <Button icon="download" disabled={loading || series.length === 0} onClick={() => exportCsv(`sales-${range.from}-to-${range.to}.csv`, SALES_CSV_COLUMNS, series)}>Export CSV</Button>
          </>
        )} pad={false}>
        <DataTable
          caption="Sales by day" stickyHeader={false} rowKey="key" className="ord-bare" dense loading={loading}
          columns={[
            { key: 'key', header: 'Date', className: 'ord-nowrap', render: d => formatDate(keyToDate(d.key)) },
            { key: 'orders', header: 'Orders', align: 'right', render: d => d.orders },
            { key: 'units', header: 'Units', align: 'right', hideOnMobile: true, render: d => d.units },
            { key: 'sales', header: 'Sales', align: 'right', render: d => <Money value={d.sales} /> },
            { key: 'refunds', header: 'Refunds', align: 'right', render: d => (d.refunds > 0 ? <Money value={d.refunds} /> : <span className="adm-muted">—</span>) },
            { key: 'net', header: 'Net sales', align: 'right', render: d => <strong><Money value={d.net} /></strong> },
            { key: 'aov', header: 'Avg order', align: 'right', hideOnMobile: true, render: d => (d.orders ? <Money value={d.aov} /> : <span className="adm-muted">—</span>) },
          ]}
          rows={rows}
          empty={{ icon: 'chart', title: 'No sales in this period', hint: 'Orders placed in the chosen dates will be listed here, day by day.' }}
          footer={rows.length > 0 && (
            <div className="rep-total" role="group" aria-label="Totals">
              <strong>Total</strong>
              <span>{totals.orders} orders</span>
              <span>Sales <Money value={totals.sales} /></span>
              <span>Refunds <Money value={totals.refunds} /></span>
              <span>Net <strong><Money value={totals.net} /></strong></span>
            </div>
          )}
        />
      </Card>
    </div>
  );
}
