import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../supabase';
import { useBrand } from '../../context/BrandContext';
import { Button, Card, DataTable, ErrorState, Icon, Money, Skeleton, Stat } from '../ui';
import { exportCsv } from '../hooks';
import { fetchAllCapped } from '../lib/queries';
import { formatMoney } from '../lib/format';
import useLoad from '../orders/useLoad';
import { GST_ORDER_COLUMNS, REPORT_ROW_CAP } from './reportData';
import { GST_HSN_CSV_COLUMNS, GST_RATE_CSV_COLUMNS, aggregateGst, gstRateRows, hasSellerState } from './gstMath';

// GST summary for filing support. Reads the period's non-cancelled orders in 1,000-order pages (only the columns the tax
// needs, up to 20,000 orders), then splits every order into taxable value + CGST / SGST / IGST the way its invoice does.
export default function GstReport({ range, bounds }) {
  const { brand } = useBrand();
  const sellerState = brand.seller_state || '';
  const defaultRate = brand.default_gst_rate !== '' && brand.default_gst_rate !== null && brand.default_gst_rate !== undefined && Number(brand.default_gst_rate) >= 0 ? Number(brand.default_gst_rate) : 18;

  const res = useLoad(async () => {
    const { rows, truncated } = await fetchAllCapped(() => supabase.from('orders').select(GST_ORDER_COLUMNS)
      .gte('created_at', bounds.fromISO).lt('created_at', bounds.toISO).neq('status', 'Cancelled').is('deleted_at', null)
      .order('created_at').order('id'), { pageSize: 1000, maxRows: REPORT_ROW_CAP });
    return { rows, truncated };
  }, [bounds.fromISO, bounds.toISO]);
  const report = useMemo(() => (res.data ? aggregateGst(res.data.rows, { defaultRate, sellerState }) : null), [res.data, defaultRate, sellerState]);

  if (res.error) return <Card pad={false}><ErrorState error={res.error} onRetry={res.reload} /></Card>;
  const loading = res.loading && !res.data;
  const t = report ? report.totals : null;
  const rateRows = report ? gstRateRows(report) : [];
  const file = (kind) => `gst-${kind}-${range.from}-to-${range.to}.csv`;

  return (
    <div className="adm-stack loose">
      {!hasSellerState(brand) && (
        <div className="adm-note warning" role="note"><Icon name="warning" size={15} /> Your <strong>seller state</strong> is not set, so every order is treated as inter-state and shows IGST only. Set it under <Link to="/admin/settings/tax">Store settings → Tax &amp; invoice</Link>.</div>
      )}
      <div className="adm-kpis c3">
        <Stat label="Taxable value" icon="receipt" tone="primary" loading={loading} value={t ? (formatMoney(t.taxable) || '₹0') : ''} hint={report ? `${report.orders.toLocaleString('en-IN')} order${report.orders === 1 ? '' : 's'}, cancelled ones left out` : undefined} />
        <Stat label="Total GST" icon="card" tone="info" loading={loading} value={t ? (formatMoney(t.tax) || '₹0') : ''} hint="Already inside what customers paid" />
        <Stat label="Invoice value" icon="chart" tone="success" loading={loading} value={t ? (formatMoney(t.value) || '₹0') : ''} hint="Taxable value + GST, before gift cards" />
        <Stat label="CGST" icon="shield" tone="neutral" loading={loading} value={t ? (formatMoney(t.cgst) || '₹0') : ''} hint={report ? `${report.intraOrders} order${report.intraOrders === 1 ? '' : 's'} within ${sellerState || 'your state'}` : undefined} />
        <Stat label="SGST" icon="shield" tone="neutral" loading={loading} value={t ? (formatMoney(t.sgst) || '₹0') : ''} hint="The same as CGST, give or take rounding" />
        <Stat label="IGST" icon="shield" tone="neutral" loading={loading} value={t ? (formatMoney(t.igst) || '₹0') : ''} hint={report ? `${report.interOrders} order${report.interOrders === 1 ? '' : 's'} to other states` : undefined} />
      </div>

      {res.data && res.data.truncated && (
        <div className="adm-note warning" role="alert"><Icon name="warning" size={15} /> This period has more than {REPORT_ROW_CAP.toLocaleString('en-IN')} orders, so the report is <strong>limited to the first {REPORT_ROW_CAP.toLocaleString('en-IN')} orders</strong> and the totals are incomplete. Choose a shorter date range (one month at a time is safest for filing).</div>
      )}

      <Card title="By GST rate" subtitle={`Orders placed in the period, as invoiced. Seller state: ${sellerState || 'not set'}. Delivery and cash-on-delivery charges are taxed at ${defaultRate}%.`}
        actions={<Button icon="download" disabled={loading || !report || report.byRate.length === 0} onClick={() => exportCsv(file('by-rate'), GST_RATE_CSV_COLUMNS, rateRows)}>Export CSV</Button>} pad={false}>
        {loading ? <div style={{ padding: 20 }}><Skeleton height={14} /><div style={{ height: 10 }} /><Skeleton height={14} width="70%" /></div> : (
          <DataTable
            caption="GST by rate" stickyHeader={false} rowKey="rate" className="ord-bare" dense
            columns={[
              { key: 'rate', header: 'GST rate', render: l => (l.rate === 'Total' ? <strong>Total</strong> : `${l.rate}%`) },
              { key: 'taxable', header: 'Taxable value', align: 'right', render: l => <Money value={l.taxable} /> },
              { key: 'cgst', header: 'CGST', align: 'right', hideOnMobile: true, render: l => <Money value={l.cgst} /> },
              { key: 'sgst', header: 'SGST', align: 'right', hideOnMobile: true, render: l => <Money value={l.sgst} /> },
              { key: 'igst', header: 'IGST', align: 'right', hideOnMobile: true, render: l => <Money value={l.igst} /> },
              { key: 'tax', header: 'Total GST', align: 'right', render: l => <Money value={l.tax} /> },
              { key: 'value', header: 'Invoice value', align: 'right', render: l => <strong><Money value={l.value} /></strong> },
            ]}
            rows={rateRows.length > 1 ? rateRows : []} rowClassName={l => (l.rate === 'Total' ? 'ord-row-total' : '')}
            empty={{ icon: 'receipt', title: 'No taxable sales in this period', hint: 'Orders placed in the chosen dates will be split by GST rate here.' }}
          />
        )}
      </Card>

      {report && report.hsn.length > 0 && (
        <Card title="By HSN code" subtitle="Goods by HSN code and rate, as recorded on each order line"
          actions={<Button icon="download" onClick={() => exportCsv(file('by-hsn'), GST_HSN_CSV_COLUMNS, report.hsn)}>Export CSV</Button>} pad={false}>
          <DataTable
            caption="GST by HSN" stickyHeader={false} rowKey={(l) => `${l.hsn}|${l.rate}`} className="ord-bare" dense
            columns={[
              { key: 'hsn', header: 'HSN', render: l => <span className="adm-mono">{l.hsn}</span> },
              { key: 'rate', header: 'Rate', render: l => `${l.rate}%` },
              { key: 'qty', header: 'Units', align: 'right', hideOnMobile: true, render: l => (l.qty ? l.qty.toLocaleString('en-IN') : '—') },
              { key: 'taxable', header: 'Taxable value', align: 'right', render: l => <Money value={l.taxable} /> },
              { key: 'tax', header: 'Total GST', align: 'right', render: l => <Money value={l.tax} /> },
              { key: 'value', header: 'Invoice value', align: 'right', render: l => <Money value={l.value} /> },
            ]}
            rows={report.hsn}
          />
        </Card>
      )}

      {report && (report.refunded > 0 || report.giftCardSales > 0 || report.returnedOrders > 0) && (
        <Card title="Also in this period" subtitle="Shown so nothing is hidden. They are NOT netted off the figures above.">
          <dl className="ord-kv">
            <div><dt>Refunded to customers (these orders)</dt><dd><Money value={report.refunded} /></dd></div>
            {report.returnedOrders > 0 && <div><dt>Orders marked Returned</dt><dd>{report.returnedOrders}</dd></div>}
            {report.giftCardSales > 0 && <div><dt>Gift cards sold (vouchers, no GST when sold)</dt><dd><Money value={report.giftCardSales} /></dd></div>}
          </dl>
          <p className="adm-hint" style={{ margin: '10px 0 0' }}>GST is shown as invoiced. If goods were returned, issue the credit note in your accounts for the refunded part.</p>
        </Card>
      )}
    </div>
  );
}
