import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../../supabase';
import { useBrand } from '../../context/BrandContext';
import { callOrdersApi } from '../../utils/orderApi';
import { ORDER_STATUSES } from '../../utils/orderStatus';
import { thumb } from '../../utils/thumbnail';
import { lineVariantLabel } from '../../utils/orderFormat';
import { Button, DataTable, FilterBar, Icon, Money, PageHeader, Pagination, StatusPill, Tabs, formatDateTime } from '../ui';
import { exportCsv, useServerList, useUrlFilters } from '../hooks';
import { applyFilters, applyOrder, buildSearchOr } from '../hooks/serverList';
import { useAdminCounts } from '../hooks/useAdminCounts';
import { fetchAllCapped } from '../lib/queries';
import { istDateKey } from '../lib/format';
import ActionMenu from './ActionMenu';
import BulkAdvanceDialog, { MAX_BULK } from './BulkAdvanceDialog';
import PrintDialog from './PrintDialog';
import StatusChangeDialog from './StatusChangeDialog';
import { ORDER_CSV_COLUMNS, ORDER_LINE_CSV_COLUMNS, orderLineRows } from './orderCsv';
import { ORDER_LIST_COLUMNS, ORDER_SEARCH_COLUMNS, useOrderCounts } from './orderData';
import {
  ADVANCE_LABEL, METHOD_LABEL, PAYMENT_METHOD_OPTIONS, PAYMENT_STATUS_OPTIONS, customerName, itemsHeadline, nextStep,
  orderListFilters, planBulkAdvance, statusValues,
} from './orderLogic';
import './orders.css';

const EXPORT_CAP = 5000;
const TO_PROCESS = 'Placed,Confirmed,Packed';
const FLAG_OPTIONS = [{ value: 'inventory_issue', label: 'Needs attention (stock issue)' }, { value: 'deleted', label: 'Deleted orders' }];
// Steps that send the customer nothing: one click is enough. The others open a dialog (messages / tracking).
const INSTANT = ['Confirmed', 'Packed'];

// A custom status list in the URL (the dashboard's "Placed,Confirmed,Packed") that matches no single tab.
function customTabLabel(csv) {
  if (csv === TO_PROCESS) return 'To process';
  return csv.split(',').map(s => s.trim()).filter(Boolean).join(' + ');
}

export default function OrdersPage() {
  const { brand } = useBrand();
  const { refresh: refreshAttention, counts: attention } = useAdminCounts();
  const { values, set, reset, active } = useUrlFilters({ q: '', status: '', method: '', pay: '', from: '', to: '', flag: '', page: 1 });
  const [sort, setSort] = useState({ key: 'created_at', dir: 'desc' });
  const [pageSize, setPageSize] = useState(25);
  const [nonce, setNonce] = useState(0);
  const [selected, setSelected] = useState({});        // id -> order row, kept across pages
  const [advance, setAdvance] = useState(null);        // { order, to }  (single order dialog)
  const [bulk, setBulk] = useState(null);              // a planBulkAdvance() result
  const [printing, setPrinting] = useState(null);      // { kind, orders }
  const [busyId, setBusyId] = useState('');
  const [exporting, setExporting] = useState(false);
  const rowsRef = useRef([]);

  const filters = useMemo(() => orderListFilters(values), [values]);
  const orderBy = useMemo(() => [
    { column: sort.key, ascending: sort.dir === 'asc' },
    ...(sort.key === 'created_at' ? [] : [{ column: 'created_at', ascending: false }]),
  ], [sort]);
  const list = useServerList({
    table: 'orders', select: ORDER_LIST_COLUMNS, filters, search: values.q, searchColumns: ORDER_SEARCH_COLUMNS,
    orderBy, pageSize, page: values.page, onPageChange: p => set({ page: p }),
  });
  rowsRef.current = list.rows;

  // A status that is a list ("?status=Placed,Confirmed,Packed" from the dashboard) gets its own tab so it can be seen and left.
  const customStatus = values.status && !ORDER_STATUSES.includes(values.status) && statusValues(values.status).length > 0 ? values.status : '';
  const tabValue = customStatus || (ORDER_STATUSES.includes(values.status) ? values.status : '');   // an unknown word in the URL = no status filter = All
  const { counts } = useOrderCounts(values, { extra: customStatus ? [customStatus] : [], nonce });
  const tabs = useMemo(() => [
    { key: '', label: 'All', count: counts[''] },
    ...(customStatus ? [{ key: customStatus, label: customTabLabel(customStatus), count: counts[customStatus] }] : []),
    ...ORDER_STATUSES.map(s => ({ key: s, label: s, count: counts[s] })),
  ], [counts, customStatus]);

  const refreshAll = useCallback(() => { list.reload(); setNonce(n => n + 1); refreshAttention(); }, [list, refreshAttention]);

  // When the page's rows are re-read (after an action), the selected ones follow, so a later bulk step sees their NEW status.
  useEffect(() => {
    setSelected(prev => {
      const ids = Object.keys(prev);
      if (ids.length === 0) return prev;
      const fresh = new Map(list.rows.map(r => [r.id, r]));
      if (!ids.some(id => fresh.has(id))) return prev;
      const next = { ...prev };
      ids.forEach(id => { if (fresh.has(id)) next[id] = fresh.get(id); });
      return next;
    });
  }, [list.rows]);

  const selectedKeys = Object.keys(selected);
  const selectedRows = selectedKeys.map(k => selected[k]);
  function onSelectionChange(keys) {
    setSelected(prev => {
      const next = {};
      keys.forEach(k => { const row = rowsRef.current.find(r => r.id === k) || prev[k]; if (row) next[k] = row; });
      return next;
    });
  }

  // ---- one-click advance
  async function quickAdvance(order) {
    const to = nextStep(order);
    if (!to) return;
    if (!INSTANT.includes(to)) { setAdvance({ order, to }); return; }
    setBusyId(order.id);
    const res = await callOrdersApi('admin_status', { orderId: order.order_id, status: to, notify: false });
    setBusyId('');
    if (res.ok) toast.success(`${order.order_id} is now ${to}.`);
    else toast.error(res.error);
    refreshAll();
  }

  // ---- bulk
  function openBulk() {
    const plan = planBulkAdvance(selectedRows);
    if (plan.moves.length === 0) { toast.error('None of the selected orders can move forward.'); return; }
    setBulk(plan);
  }
  function openPrint(kind) {
    if (selectedRows.length > 100) { toast.error('Select 100 orders or fewer to print at once.'); return; }
    setPrinting({ kind, orders: selectedRows });
  }

  // ---- CSV
  const taxOpts = { defaultRate: Number(brand.default_gst_rate) >= 0 && brand.default_gst_rate !== '' && brand.default_gst_rate !== null ? Number(brand.default_gst_rate) : 18, sellerState: brand.seller_state || '' };
  function download(kind, rows) {
    const stamp = istDateKey();
    if (kind === 'orders') exportCsv(`orders-${stamp}.csv`, ORDER_CSV_COLUMNS, rows);
    else exportCsv(`order-items-${stamp}.csv`, ORDER_LINE_CSV_COLUMNS, orderLineRows(rows, taxOpts));
  }
  async function exportMatching(kind) {
    setExporting(true);
    const id = toast.loading('Preparing the export…');
    try {
      const { rows, truncated } = await fetchAllCapped(() => {
        let q = supabase.from('orders').select(ORDER_LIST_COLUMNS);
        q = applyFilters(q, filters);
        const or = buildSearchOr(ORDER_SEARCH_COLUMNS, values.q);
        if (or) q = q.or(or);
        return applyOrder(q, [{ column: 'created_at', ascending: false }, { column: 'id', ascending: false }]);
      }, { pageSize: 1000, maxRows: EXPORT_CAP });
      toast.dismiss(id);
      if (rows.length === 0) { toast.error('No orders match the current filters.'); return; }
      download(kind, rows);
      toast.success(`Exported ${rows.length.toLocaleString('en-IN')} order${rows.length === 1 ? '' : 's'}${kind === 'items' ? ' (one row per item)' : ''}.${truncated ? ` Limited to the first ${EXPORT_CAP.toLocaleString('en-IN')}: narrow the filters to export the rest.` : ''}`, { duration: truncated ? 8000 : 4000 });
    } catch (e) {
      toast.dismiss(id);
      toast.error(`Could not export: ${e?.message || 'please try again'}`);
    } finally { setExporting(false); }
  }

  const columns = [
    { key: 'order_id', header: 'Order', className: 'ord-nowrap', render: o => (
      <span>
        <strong>{o.order_id}</strong>
        {o.inventory_issue && <span className="ord-flag" title="Payment landed after the stock hold expired"><Icon name="warning" size={12} /> Stock issue</span>}
        {o.deleted_at && <span className="ord-flag is-muted">Deleted</span>}
      </span>
    ) },
    { key: 'created_at', header: 'Placed', sortable: true, className: 'ord-nowrap', render: o => <PlacedCell value={o.created_at} /> },
    { key: 'customer', header: 'Customer', render: o => (
      <span className="ord-cust">{customerName(o)}<span className="adm-cell-sub ord-nowrap">{o.user_phone || o.address?.phone || o.user_email || ''}</span></span>
    ) },
    { key: 'items', header: 'Items', className: 'ord-cell-center', render: o => <ItemsCell order={o} /> },
    { key: 'total', header: 'Total', align: 'right', sortable: true, className: 'ord-nowrap', render: o => (
      <span><Money value={o.total} />{Number(o.refunded_amount) > 0 && <span className="adm-cell-sub" style={{ display: 'block' }}>−<Money value={o.refunded_amount} /> refunded</span>}</span>
    ) },
    { key: 'payment', header: 'Payment', className: 'ord-cell-center', render: o => (
      <span className="ord-pay"><span className="adm-chip">{METHOD_LABEL[o.payment_method] || o.payment_method || '—'}</span><StatusPill status={o.payment_status} kind="payment" /></span>
    ) },
    { key: 'status', header: 'Status', className: 'ord-cell-center', render: o => {
      const to = nextStep(o);
      return (
        <span className="ord-status-cell">
          <StatusPill status={o.status} kind="order" />
          {to && (
            <Button size="sm" variant="secondary" icon="check" loading={busyId === o.id} disabled={!!busyId && busyId !== o.id} onClick={() => quickAdvance(o)}
              aria-label={`${ADVANCE_LABEL[to]} for order ${o.order_id}`}>{ADVANCE_LABEL[to]}</Button>
          )}
        </span>
      );
    } },
  ];

  const exportItems = (fn) => [
    { key: 'orders', label: 'Orders (one row per order)', icon: 'download', onSelect: () => fn('orders') },
    { key: 'items', label: 'Order items (one row per item, with GST)', icon: 'download', onSelect: () => fn('items') },
  ];
  const needsAttention = attention.inventoryIssues;

  return (
    <>
      <PageHeader
        title="Orders" subtitle="Confirm, pack, ship and look after every order"
        actions={<Button icon="refresh" onClick={refreshAll}>Refresh</Button>}
      />

      <Tabs label="Order status" items={tabs} value={tabValue} onChange={k => set({ status: k })} />

      <FilterBar
        search={values.q} onSearch={q => set({ q })} searchPlaceholder="Search order no., customer, email or phone…"
        selects={[
          { key: 'method', label: 'Payment method', value: values.method, onChange: v => set({ method: v }), allLabel: 'Any payment method', options: PAYMENT_METHOD_OPTIONS },
          { key: 'pay', label: 'Payment status', value: values.pay, onChange: v => set({ pay: v }), allLabel: 'Any payment status', options: PAYMENT_STATUS_OPTIONS },
          { key: 'flag', label: 'Show', value: values.flag, onChange: v => set({ flag: v }), allLabel: 'All orders',
            options: [{ value: 'inventory_issue', label: needsAttention ? `Needs attention (${needsAttention})` : FLAG_OPTIONS[0].label }, FLAG_OPTIONS[1]] },
        ]}
        dateRange={{ from: values.from, to: values.to }} onDateRange={({ from, to }) => set({ from, to })}
        showClear={active} onClear={reset}
        actions={<ActionMenu label="Export CSV" icon="download" disabled={exporting} items={exportItems(exportMatching)} />}
      />

      {selectedKeys.length > 0 && (
        <div className="ord-bulk" role="region" aria-label="Bulk actions">
          <strong>{selectedKeys.length} selected</strong>
          <Button size="sm" icon="check" onClick={openBulk}>Advance to next status…</Button>
          <Button size="sm" icon="doc" onClick={() => openPrint('invoice')}>Print invoices</Button>
          <Button size="sm" icon="box" onClick={() => openPrint('packing')}>Print packing slips</Button>
          <ActionMenu label="Export selected" icon="download" size="sm" items={exportItems(kind => download(kind, selectedRows))} />
          <Button size="sm" variant="ghost" onClick={() => setSelected({})}>Clear selection</Button>
          {selectedKeys.length > MAX_BULK && <span className="adm-hint">Advancing works on up to {MAX_BULK} orders at a time.</span>}
        </div>
      )}

      <DataTable
        caption="Orders" stickyHeader
        columns={columns} rows={list.rows} rowKey="id" loading={list.loading} error={list.error} onRetry={list.reload}
        rowHref={o => `/admin/orders/${o.order_id}`}
        selectable selectedKeys={selectedKeys} onSelectionChange={onSelectionChange}
        sort={sort} onSort={(key) => setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))}
        rowClassName={o => (o.inventory_issue ? 'ord-row-flag' : o.deleted_at ? 'ord-row-deleted' : '')}
        empty={active
          ? { icon: 'search', title: 'No orders match your filters', hint: 'Try another status tab, a wider date range or a different search.', action: <Button onClick={reset}>Clear filters</Button> }
          : { icon: 'cart', title: 'No orders yet', hint: 'Orders appear here the moment a customer checks out.' }}
        footer={<Pagination page={list.page} pageSize={list.pageSize} total={list.count} onPage={list.setPage} pageSizes={[25, 50, 100]} onPageSize={setPageSize} />}
      />

      <StatusChangeDialog
        order={advance?.order} to={advance?.to} onClose={() => setAdvance(null)}
        onDone={() => { setAdvance(null); refreshAll(); }} onFailed={(res) => { if (res.status === 409) refreshAll(); }}
      />
      <BulkAdvanceDialog
        key={bulk ? bulk.moves.map(m => m.id).join() : 'none'} plan={bulk} onClose={() => setBulk(null)}
        onFinished={() => { setSelected({}); refreshAll(); }}
      />
      {printing && <PrintDialog kind={printing.kind} orders={printing.orders} onClose={() => setPrinting(null)} />}
    </>
  );
}

// "06 Oct 2026" over "3:42 pm" (India time): two short lines instead of one that wraps.
function PlacedCell({ value }) {
  const full = formatDateTime(value);
  if (!full) return <span className="adm-muted">—</span>;
  const [day, clock] = full.split(', ');
  return <time dateTime={new Date(value).toISOString()} title="Indian Standard Time">{day}<span className="adm-cell-sub" style={{ display: 'block' }}>{clock}</span></time>;
}

// First item's picture, its name, and "+2 more".
function ItemsCell({ order }) {
  const { first, more, units } = itemsHeadline(order);
  if (!first) return <span className="adm-muted">—</span>;
  const label = lineVariantLabel(first);
  const names = (order.items || []).map(i => `${i.name} ×${i.qty}`).join('\n');
  return (
    <span className="ord-items" title={names}>
      {first.image ? <img className="adm-thumb" src={thumb(first.image, 88)} alt="" loading="lazy" /> : <span className="adm-thumb ord-thumb-empty"><Icon name={first.isGiftCard ? 'gift' : 'box'} size={18} /></span>}
      <span className="ord-items-text">
        <span className="ord-items-name">{first.name || 'Item'}{label ? ` · ${label}` : ''}</span>
        <span className="adm-cell-sub">{more > 0 ? `+${more} more · ` : ''}{units} unit{units === 1 ? '' : 's'}</span>
      </span>
    </span>
  );
}
