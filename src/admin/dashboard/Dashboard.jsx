import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Button, Card, DataTable, DateTime, EmptyState, ErrorState, Icon, Money, PageHeader, Skeleton, Stat, StatusPill, Thumb } from '../ui';
import { ATTENTION_ITEMS, useAdminCounts } from '../hooks/useAdminCounts';
import { formatMoney, formatMoneyCompact, istDateKey, lastDayKeys } from '../lib/format';
import useDashboardData from './useDashboardData';
import RevenueChart from './RevenueChart';
import { buildSeries, ordersOnDays, statusBreakdown, summarise } from './dashboardMath';

const RANGES = [{ days: 1, label: 'Today' }, { days: 7, label: '7 days' }, { days: 30, label: '30 days' }];

const QUICK = [
  { to: '/admin/products/new', icon: 'plusCircle', t: 'Add a product', d: 'Create a new listing' },
  { to: '/admin/coupons', icon: 'tag', t: 'Create a coupon', d: 'Offer a discount code' },
  { to: '/admin/orders?status=Placed,Confirmed,Packed', icon: 'cart', t: 'Process orders', d: 'Confirm, pack and ship' },
  { to: '/admin/banners', icon: 'image', t: 'Edit banners', d: 'Refresh the home page' },
  { to: '/admin/inventory?filter=low', icon: 'layers', t: 'Restock items', d: 'See what is running low' },
  { to: '/admin/settings/shipping', icon: 'truck', t: 'Shipping & delivery', d: 'Fees and free-delivery level' },
];

const greeting = () => { const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(new Date())); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

export default function Dashboard() {
  const { currentUser } = useAuth();
  const { counts, loading: countsLoading, refresh: refreshCounts } = useAdminCounts();
  const { sales, top, latest, reload } = useDashboardData();
  const [days, setDays] = useState(7);

  const orders = sales.data;
  const stats = useMemo(() => {
    if (!orders) return null;
    const today = istDateKey();
    const d7 = lastDayKeys(7);
    return {
      today: summarise(ordersOnDays(orders, [today])),
      week: summarise(ordersOnDays(orders, d7)),
      month: summarise(orders),
      range: summarise(ordersOnDays(orders, lastDayKeys(days))),
    };
  }, [orders, days]);
  const rangeOrders = useMemo(() => (orders ? ordersOnDays(orders, lastDayKeys(days)) : []), [orders, days]);
  const series = useMemo(() => (orders ? buildSeries(orders, days) : []), [orders, days]);
  const breakdown = useMemo(() => statusBreakdown(rangeOrders), [rangeOrders]);
  const maxStatus = Math.max(1, ...breakdown.map(b => b.count));
  const rangeLabel = RANGES.find(r => r.days === days).label.toLowerCase();
  const salesErr = !!sales.error;
  const salesLoading = sales.loading && !orders;
  const name = (currentUser?.user_metadata?.full_name || currentUser?.email || 'there').split('@')[0];
  const awaiting = counts.ordersAwaiting;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`${greeting()}, ${name}. ${countsLoading ? 'Checking what needs your attention…' : awaiting > 0 ? `${awaiting} order${awaiting === 1 ? '' : 's'} ${awaiting === 1 ? 'is' : 'are'} waiting for you.` : 'No orders are waiting for you right now.'}`}
        actions={<Button icon="refresh" onClick={() => { refreshCounts(); reload.sales(); reload.top(); reload.latest(); }}>Refresh</Button>}
      />

      <div className="adm-stack loose">
        <section aria-labelledby="dash-attn">
          <h2 id="dash-attn" className="adm-sr">Needs attention</h2>
          <div className="adm-kpis c3">
            {ATTENTION_ITEMS.map(it => (
              <Stat key={it.key} label={it.label} hint={it.hint} icon={it.icon} tone={counts[it.key] > 0 ? it.tone : 'neutral'} to={it.to}
                value={counts[it.key]} loading={countsLoading} error={!countsLoading && counts[it.key] === null} onRetry={refreshCounts} />
            ))}
          </div>
        </section>

        <section aria-labelledby="dash-sales">
          <h2 id="dash-sales" className="adm-sr">Sales</h2>
          <div className="adm-kpis c4">
            <Stat label="Today's revenue" icon="receipt" tone="primary" to="/admin/orders" hint={stats ? `${stats.today.orders} order${stats.today.orders === 1 ? '' : 's'} today` : undefined}
              value={stats ? formatMoney(stats.today.revenue) || '₹0' : ''} loading={salesLoading} error={salesErr} onRetry={reload.sales} />
            <Stat label="Last 7 days" icon="chart" tone="primary" hint={stats ? `${stats.week.orders} orders` : undefined}
              value={stats ? formatMoneyCompact(stats.week.revenue) : ''} loading={salesLoading} error={salesErr} onRetry={reload.sales} />
            <Stat label="Last 30 days" icon="barChart" tone="primary" hint={stats ? `${stats.month.orders} orders${sales.truncated ? ' (first 5,000)' : ''}` : undefined}
              value={stats ? formatMoneyCompact(stats.month.revenue) : ''} loading={salesLoading} error={salesErr} onRetry={reload.sales} />
            <Stat label={`Average order value (${rangeLabel})`} icon="card" tone="info" hint="Revenue ÷ orders, after refunds"
              value={stats ? (stats.range.orders ? formatMoney(Math.round(stats.range.aov)) : '—') : ''} loading={salesLoading} error={salesErr} onRetry={reload.sales} />
          </div>
        </section>

        <div className="adm-grid-2">
          <Card
            title="Revenue and orders"
            subtitle={stats ? `${formatMoney(stats.range.revenue) || '₹0'} from ${stats.range.orders} order${stats.range.orders === 1 ? '' : 's'} · ${rangeLabel}` : 'Loading…'}
            actions={(
              <div className="adm-seg" role="group" aria-label="Date range">
                {RANGES.map(r => <button key={r.days} type="button" aria-pressed={days === r.days} onClick={() => setDays(r.days)}>{r.label}</button>)}
              </div>
            )}
          >
            {salesErr ? <ErrorState error={sales.error} onRetry={reload.sales} compact />
              : salesLoading ? <Skeleton height={220} radius={10} />
                : <RevenueChart buckets={series} />}
            {sales.truncated && <p className="adm-hint" style={{ marginTop: 8 }}>Showing the most recent 5,000 orders of the last 30 days; older figures are partial.</p>}
          </Card>

          <Card title="Orders by status" subtitle={`Placed in the last ${days === 1 ? 'day (today)' : `${days} days`}`}>
            {salesErr ? <ErrorState error={sales.error} onRetry={reload.sales} compact />
              : salesLoading ? <Skeleton height={190} radius={10} />
                : (
                  <div className="adm-bars">
                    {breakdown.map(b => (
                      <div className="adm-bar-row" key={b.status}>
                        <Link to={`/admin/orders?status=${encodeURIComponent(b.status)}`} title={`See ${b.status} orders`}>{b.status}</Link>
                        <div className="adm-bar-track" aria-hidden="true"><div className="adm-bar-fill" style={{ width: `${(b.count / maxStatus) * 100}%` }} /></div>
                        <div className="adm-bar-val">{b.count}</div>
                      </div>
                    ))}
                  </div>
                )}
          </Card>
        </div>

        <div className="adm-quick" role="navigation" aria-label="Quick actions">
          {QUICK.map(q => (
            <Link key={q.t} to={q.to} className="adm-action">
              <span className="adm-action-ico"><Icon name={q.icon} size={19} /></span>
              <span><div className="adm-action-t">{q.t}</div><div className="adm-action-d">{q.d}</div></span>
            </Link>
          ))}
        </div>

        <div className="adm-grid-2" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.6fr)' }}>
          <Card title="Top-selling products" subtitle="By units sold, all time">
            {top.error ? <ErrorState error={top.error} onRetry={reload.top} compact />
              : top.loading ? <div className="adm-stack tight">{[0, 1, 2, 3].map(i => <Skeleton key={i} height={40} radius={8} />)}</div>
                : top.data.length === 0 ? <EmptyState compact icon="box" title="No sales yet" hint="Your best sellers will appear here once orders come in." />
                  : (
                    <ol className="adm-toplist">
                      {top.data.map((p, i) => {
                        const img = Array.isArray(p.images) ? p.images[0] : null;
                        return (
                          <li key={p.id}>
                            <span className="adm-toplist-rank">{i + 1}</span>
                            <Thumb src={img} width={88} />
                            <span className="adm-toplist-main">
                              <Link to={`/admin/products/${p.id}`}>{p.name}</Link>
                              <span className="adm-cell-sub"><Money value={p.price} /></span>
                            </span>
                            <strong className="adm-money">{p.sales_count} sold</strong>
                          </li>
                        );
                      })}
                    </ol>
                  )}
          </Card>

          <Card title="Latest orders" actions={<Button size="sm" to="/admin/orders" iconRight="arrowRight">View all</Button>} pad={false}>
            <DataTable
              caption="Latest orders" stickyHeader={false} dense
              columns={[
                { key: 'order_id', header: 'Order', render: o => <span>{o.order_id}</span> },
                { key: 'customer', header: 'Customer', render: o => <span>{o.user_name || o.user_email || 'Guest'}</span> },
                { key: 'created_at', header: 'Placed', hideOnMobile: true, render: o => <DateTime value={o.created_at} relative /> },
                { key: 'status', header: 'Status', render: o => <StatusPill status={o.status} kind="order" /> },
                { key: 'total', header: 'Total', align: 'right', render: o => <Money value={o.total} /> },
              ]}
              rows={latest.data || []} loading={latest.loading} error={latest.error} onRetry={reload.latest} skeletonRows={5}
              rowHref={o => `/admin/orders/${o.order_id}`}
              empty={{ icon: 'cart', title: 'No orders yet', hint: 'New orders will show up here as soon as customers check out.' }}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
