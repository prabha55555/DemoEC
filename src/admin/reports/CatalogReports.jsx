import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, DataTable, ErrorState, Money, Stat } from '../ui';
import { exportCsv } from '../hooks';
import { formatMoney } from '../lib/format';
import useLoad from '../orders/useLoad';
import { rpcRows } from './reportData';
import { CATEGORY_CSV_COLUMNS, PRODUCT_CSV_COLUMNS, num, withShare } from './reportMath';

function ShareBar({ value }) {
  return (
    <span className="rep-share" title={`${value}% of revenue`}>
      <span className="adm-bar-track" aria-hidden="true"><span className="adm-bar-fill" style={{ display: 'block', width: `${Math.min(100, value)}%` }} /></span>
      <span className="rep-share-val">{value}%</span>
    </span>
  );
}

// Best sellers by revenue (admin_sales_by_product). Share is of ALL merchandise revenue in the period, which comes from the
// category report (it has no row limit), so a long tail of small products never inflates the percentages.
export function ProductsReport({ range, bounds }) {
  const args = { p_from: bounds.fromISO, p_to: bounds.toISO };
  const res = useLoad(async () => {
    const [products, categories] = await Promise.all([rpcRows('admin_sales_by_product', { ...args, p_limit: 200 }), rpcRows('admin_sales_by_category', args)]);
    return { products, total: categories.reduce((s, c) => s + num(c.revenue), 0) };
  }, [bounds.fromISO, bounds.toISO]);
  const rows = useMemo(() => (res.data ? withShare(res.data.products, res.data.total) : []), [res.data]);

  if (res.error) return <Card pad={false}><ErrorState error={res.error} onRetry={res.reload} /></Card>;
  const loading = res.loading && !res.data;
  const top = rows[0];
  const units = rows.reduce((s, r) => s + r.units, 0);
  return (
    <div className="adm-stack loose">
      <div className="adm-kpis c3">
        <Stat label="Products sold" icon="box" tone="primary" loading={loading} value={rows.length.toLocaleString('en-IN')} hint={res.data && res.data.products.length >= 200 ? 'Top 200 by revenue' : 'Different products'} />
        <Stat label="Units sold" icon="cart" tone="info" loading={loading} value={units.toLocaleString('en-IN')} hint="Gift cards are not counted" />
        <Stat label="Best seller" icon="star" tone="success" loading={loading} value={top ? top.name : '—'} hint={top ? `${formatMoney(top.revenue)} · ${top.units} sold` : undefined} />
      </div>
      <Card title="Products by revenue" subtitle="Cancelled orders are left out. Revenue is the price paid per item before coupons and delivery."
        actions={<Button icon="download" disabled={loading || rows.length === 0} onClick={() => exportCsv(`products-${range.from}-to-${range.to}.csv`, PRODUCT_CSV_COLUMNS, rows)}>Export CSV</Button>} pad={false}>
        <DataTable
          caption="Sales by product" stickyHeader={false} rowKey="product_id" className="ord-bare" loading={loading}
          columns={[
            { key: 'rank', header: '#', width: 48, render: (r, i) => <span className="adm-muted">{i + 1}</span> },
            { key: 'name', header: 'Product', render: r => (r.product_id ? <Link to={`/admin/products/${r.product_id}`}>{r.name || 'Product'}</Link> : (r.name || 'Product')) },
            { key: 'units', header: 'Units', align: 'right', render: r => r.units.toLocaleString('en-IN') },
            { key: 'revenue', header: 'Revenue', align: 'right', render: r => <Money value={r.revenue} /> },
            { key: 'share', header: 'Share', hideOnMobile: true, width: 190, render: r => <ShareBar value={r.share} /> },
          ]}
          rows={rows} empty={{ icon: 'box', title: 'No products sold in this period', hint: 'Try a longer date range.' }}
        />
      </Card>
    </div>
  );
}

// Sales by category name (admin_sales_by_category).
export function CategoriesReport({ range, bounds }) {
  const res = useLoad(() => rpcRows('admin_sales_by_category', { p_from: bounds.fromISO, p_to: bounds.toISO }), [bounds.fromISO, bounds.toISO]);
  const rows = useMemo(() => (res.data ? withShare(res.data) : []), [res.data]);

  if (res.error) return <Card pad={false}><ErrorState error={res.error} onRetry={res.reload} /></Card>;
  const loading = res.loading && !res.data;
  const revenue = rows.reduce((s, r) => s + r.revenue, 0);
  const top = rows[0];
  return (
    <div className="adm-stack loose">
      <div className="adm-kpis c3">
        <Stat label="Categories with sales" icon="folder" tone="primary" loading={loading} value={rows.length.toLocaleString('en-IN')} />
        <Stat label="Merchandise revenue" icon="receipt" tone="info" loading={loading} value={formatMoney(revenue) || '₹0'} hint="Before coupons and delivery" />
        <Stat label="Top category" icon="star" tone="success" loading={loading} value={top ? top.category : '—'} hint={top ? `${formatMoney(top.revenue)} · ${top.share}%` : undefined} />
      </div>
      <Card title="Sales by category" subtitle="The category each item was in when it was sold. Cancelled orders are left out."
        actions={<Button icon="download" disabled={loading || rows.length === 0} onClick={() => exportCsv(`categories-${range.from}-to-${range.to}.csv`, CATEGORY_CSV_COLUMNS, rows)}>Export CSV</Button>} pad={false}>
        <DataTable
          caption="Sales by category" stickyHeader={false} rowKey="category" className="ord-bare" loading={loading}
          columns={[
            { key: 'category', header: 'Category', render: r => r.category },
            { key: 'units', header: 'Units', align: 'right', render: r => r.units.toLocaleString('en-IN') },
            { key: 'revenue', header: 'Revenue', align: 'right', render: r => <Money value={r.revenue} /> },
            { key: 'share', header: 'Share', hideOnMobile: true, width: 190, render: r => <ShareBar value={r.share} /> },
          ]}
          rows={rows} empty={{ icon: 'folder', title: 'No sales in this period', hint: 'Try a longer date range.' }}
        />
      </Card>
    </div>
  );
}
