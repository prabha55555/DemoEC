import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../supabase';
import { Button, Card, CopyButton, DataTable, DateTime, ErrorState, FilterBar, Money, Pagination, Stat, StatusPill } from '../ui';
import { exportCsv, useServerList, useUrlFilters } from '../hooks';
import { applyFilters, applyOrder, buildSearchOr } from '../hooks/serverList';
import { fetchAllCapped } from '../lib/queries';
import { formatMoney } from '../lib/format';
import useLoad from '../orders/useLoad';
import { METHOD_LABEL, PAYMENT_METHOD_OPTIONS, PAYMENT_STATUS_OPTIONS } from '../orders/orderLogic';
import { PAYMENT_ROW_COLUMNS, PAYMENT_SUMMARY_COLUMNS, REPORT_ROW_CAP } from './reportData';
import { PAYMENT_CSV_COLUMNS, paymentFilters, summarisePayments } from './reportMath';

const SEARCH = ['order_id', 'payment_id', 'user_name', 'user_email'];
const REFUND_OPTIONS = [{ value: 'with', label: 'With refunds' }, { value: 'without', label: 'No refunds' }];
const CANCELLED_OPTIONS = [{ value: 'include', label: 'Including cancelled' }, { value: 'only', label: 'Cancelled only' }];

// How the money came in: the split between online, cash on delivery and orders nothing was charged for, what is still to
// be collected, and every refund -- then each payment, order by order, for the chosen dates. Read only.
export default function PaymentsReport({ range, bounds }) {
  const { values, set, reset, active } = useUrlFilters({ q: '', method: '', pay: '', refunds: '', cancelled: '', page: 1 });
  const [exporting, setExporting] = useState(false);

  // The split covers every order in the period (cancelled ones are classified, but only their refunds are shown).
  const res = useLoad(async () => {
    const { rows, truncated } = await fetchAllCapped(() => supabase.from('orders').select(PAYMENT_SUMMARY_COLUMNS)
      .gte('created_at', bounds.fromISO).lt('created_at', bounds.toISO).is('deleted_at', null).order('created_at').order('id'), { pageSize: 1000, maxRows: REPORT_ROW_CAP });
    return { ...summarisePayments(rows), truncated };
  }, [bounds.fromISO, bounds.toISO]);

  const filters = useMemo(() => paymentFilters(values, bounds), [values, bounds]);
  const list = useServerList({
    table: 'orders', select: PAYMENT_ROW_COLUMNS, filters, search: values.q, searchColumns: SEARCH,
    orderBy: [{ column: 'created_at', ascending: false }, { column: 'id', ascending: false }], pageSize: 25, page: values.page, onPageChange: p => set({ page: p }),
  });

  async function exportAll() {
    setExporting(true);
    const id = toast.loading('Preparing the export…');
    try {
      const { rows, truncated } = await fetchAllCapped(() => {
        let q = supabase.from('orders').select(PAYMENT_ROW_COLUMNS);
        q = applyFilters(q, filters);
        const or = buildSearchOr(SEARCH, values.q);
        if (or) q = q.or(or);
        return applyOrder(q, [{ column: 'created_at', ascending: false }, { column: 'id', ascending: false }]);
      }, { pageSize: 1000, maxRows: REPORT_ROW_CAP });
      toast.dismiss(id);
      if (rows.length === 0) { toast.error('No payments match the current filters.'); return; }
      exportCsv(`payments-${range.from}-to-${range.to}.csv`, PAYMENT_CSV_COLUMNS, rows);
      toast.success(`Exported ${rows.length.toLocaleString('en-IN')} payment${rows.length === 1 ? '' : 's'}.${truncated ? ` Limited to the first ${REPORT_ROW_CAP.toLocaleString('en-IN')}: narrow the filters to export the rest.` : ''}`, { duration: truncated ? 8000 : 4000 });
    } catch (e) {
      toast.dismiss(id);
      toast.error(`Could not export: ${e?.message || 'please try again'}`);
    } finally { setExporting(false); }
  }

  const loading = res.loading && !res.data;
  const s = res.data;
  const total = s ? s.online.orders + s.cod.orders + s.free.orders : 0;
  const share = (n) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);

  return (
    <div className="adm-stack loose">
      {res.error ? <Card pad={false}><ErrorState error={res.error} onRetry={res.reload} /></Card> : (
        <>
          <div className="adm-kpis c3">
            <Stat label="Paid online" icon="card" tone="primary" loading={loading} value={s ? (formatMoney(s.online.amount) || '₹0') : ''} hint={s ? `${s.online.orders} order${s.online.orders === 1 ? '' : 's'} through Razorpay` : undefined} />
            <Stat label="Cash on delivery: collected" icon="receipt" tone="success" loading={loading} value={s ? (formatMoney(s.cod.collected.amount) || '₹0') : ''} hint={s ? `${s.cod.collected.orders} delivered order${s.cod.collected.orders === 1 ? '' : 's'}` : undefined} />
            <Stat label="Cash on delivery: still to collect" icon="truck" tone={s && s.cod.pending.amount > 0 ? 'warning' : 'neutral'} loading={loading} value={s ? (formatMoney(s.cod.pending.amount) || '₹0') : ''} hint={s ? `${s.cod.pending.orders} order${s.cod.pending.orders === 1 ? '' : 's'} not delivered yet` : undefined} />
            <Stat label="Nothing to pay" icon="gift" tone="info" loading={loading} value={s ? s.free.orders.toLocaleString('en-IN') : ''} hint={s ? `${formatMoney(s.giftCard) || '₹0'} gift cards · ${formatMoney(s.coupon) || '₹0'} coupons used across all orders` : undefined} />
            <Stat label="Refunded" icon="undo" tone={s && s.refunds > 0 ? 'danger' : 'neutral'} loading={loading} value={s ? (formatMoney(s.refunds) || '₹0') : ''} hint={s ? `${s.refundedOrders} order${s.refundedOrders === 1 ? '' : 's'} with a refund (not cancelled)` : undefined} />
            <Stat label="Refunded on cancelled orders" icon="close" tone={s && s.cancelled.refunds > 0 ? 'warning' : 'neutral'} loading={loading} value={s ? (formatMoney(s.cancelled.refunds) || '₹0') : ''} hint={s ? `${s.cancelled.orders} cancelled order${s.cancelled.orders === 1 ? '' : 's'}, left out of the figures above` : undefined} />
          </div>
          {s && s.truncated && <div className="adm-note warning" role="note">This period has more than {REPORT_ROW_CAP.toLocaleString('en-IN')} orders, so these totals cover the first {REPORT_ROW_CAP.toLocaleString('en-IN')} only. Choose a shorter date range.</div>}
          {s && total > 0 && (
            <Card title="Payment split" subtitle="Orders by how they were paid (cancelled orders left out)">
              <div className="rep-split" role="img" aria-label={`Online ${share(s.online.orders)}%, cash on delivery ${share(s.cod.orders)}%, nothing to pay ${share(s.free.orders)}%`}>
                {s.online.orders > 0 && <span className="is-online" style={{ width: `${share(s.online.orders)}%` }} />}
                {s.cod.orders > 0 && <span className="is-cod" style={{ width: `${share(s.cod.orders)}%` }} />}
                {s.free.orders > 0 && <span className="is-free" style={{ width: `${share(s.free.orders)}%` }} />}
              </div>
              <ul className="rep-legend">
                <li><i className="is-online" /> Online <strong>{s.online.orders}</strong> ({share(s.online.orders)}%)</li>
                <li><i className="is-cod" /> Cash on delivery <strong>{s.cod.orders}</strong> ({share(s.cod.orders)}%)</li>
                <li><i className="is-free" /> Nothing to pay <strong>{s.free.orders}</strong> ({share(s.free.orders)}%)</li>
              </ul>
            </Card>
          )}
        </>
      )}

      <div>
        <FilterBar
          search={values.q} onSearch={q => set({ q })} searchPlaceholder="Search order, payment id or customer…"
          selects={[
            { key: 'method', label: 'Payment method', value: values.method, onChange: v => set({ method: v }), allLabel: 'Any method', options: PAYMENT_METHOD_OPTIONS },
            { key: 'pay', label: 'Payment status', value: values.pay, onChange: v => set({ pay: v }), allLabel: 'Any status', options: PAYMENT_STATUS_OPTIONS },
            { key: 'refunds', label: 'Refunds', value: values.refunds, onChange: v => set({ refunds: v }), allLabel: 'Refunds: any', options: REFUND_OPTIONS },
            { key: 'cancelled', label: 'Cancelled orders', value: values.cancelled, onChange: v => set({ cancelled: v }), allLabel: 'Excluding cancelled', options: CANCELLED_OPTIONS },
          ]}
          showClear={active} onClear={reset}
          actions={<Button icon="download" loading={exporting} onClick={exportAll}>Export CSV</Button>}
        />
        <DataTable
          caption="Payments" rowKey="id"
          columns={[
            { key: 'order_id', header: 'Order', className: 'ord-nowrap', render: o => <Link to={`/admin/orders/${encodeURIComponent(o.order_id)}`}><strong>{o.order_id}</strong></Link> },
            { key: 'created_at', header: 'Date', className: 'ord-nowrap', render: o => <DateTime value={o.created_at} /> },
            { key: 'customer', header: 'Customer', render: o => <span className="ord-cust">{o.user_name || o.user_email || 'Guest'}{o.user_name && o.user_email && <span className="adm-cell-sub">{o.user_email}</span>}</span> },
            { key: 'method', header: 'Method', render: o => <span className="adm-chip">{METHOD_LABEL[o.payment_method] || o.payment_method || '—'}</span> },
            { key: 'payment_id', header: 'Razorpay payment', render: o => (o.payment_id ? <span className="ord-payid">{o.payment_id}<CopyButton text={o.payment_id} /></span> : <span className="adm-muted">—</span>) },
            { key: 'total', header: 'Charged', align: 'right', className: 'ord-nowrap', render: o => (
              <span><Money value={o.total} />{o.payment_status === 'cod_pending' && <span className="adm-cell-sub" style={{ display: 'block' }}>to collect</span>}</span>
            ) },
            { key: 'credit', header: 'Gift card / coupon', align: 'right', className: 'ord-nowrap', render: o => {
              const gift = Number(o.gift_card_applied) || 0; const off = Number(o.discount) || 0;
              if (!gift && !off) return <span className="adm-muted">—</span>;
              return <span><Money value={gift + off} /><span className="adm-cell-sub" style={{ display: 'block' }}>{[gift ? `card ${formatMoney(gift)}` : '', off ? `coupon ${formatMoney(off)}` : ''].filter(Boolean).join(' · ')}</span></span>;
            } },
            { key: 'refunded', header: 'Refunded', align: 'right', className: 'ord-nowrap', render: o => (Number(o.refunded_amount) > 0 ? <Money value={o.refunded_amount} /> : <span className="adm-muted">—</span>) },
            { key: 'status', header: 'Status', render: o => (
              <span className="ord-pay"><StatusPill status={o.payment_status} kind="payment" />{o.status === 'Cancelled' && <StatusPill status="Cancelled" kind="order" />}</span>
            ) },
          ]}
          rows={list.rows} loading={list.loading} error={list.error} onRetry={list.reload}
          empty={active
            ? { icon: 'search', title: 'No payments match your filters', hint: 'Try other filters or a longer date range.', action: <Button onClick={reset}>Clear filters</Button> }
            : { icon: 'card', title: 'No payments in this period', hint: 'Orders placed in the chosen dates are listed here with how they were paid.' }}
          footer={<Pagination page={list.page} pageSize={list.pageSize} total={list.count} onPage={list.setPage} />}
        />
      </div>
    </div>
  );
}
