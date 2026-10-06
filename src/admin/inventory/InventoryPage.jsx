import React, { useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../supabase';
import { useBrand } from '../../context/BrandContext';
import { Button, DataTable, DateTime, FilterBar, Icon, PageHeader, Pagination, Stat, StatusPill, Tabs, Thumb, formatMoney, istRangeFilter, relativeTime } from '../ui';
import { buildSearchOr, exportCsv, useServerList, useUrlFilters } from '../hooks';
import { applyFilters, applyOrder } from '../hooks/serverList';
import { withTimeout } from '../../utils/withTimeout';
import useAdminCategories from '../products/useAdminCategories';
import { treeOptions } from '../products/categoryTools';
import { combineOr, productSearchGroups } from '../products/queryTools';
import { useLowStockGroups } from '../products/listHooks';
import AdjustStockDialog from './AdjustStockDialog';
import QuickRestockDialog from './QuickRestockDialog';
import { useInventorySummary, useLastMovements, useNames, useProductIds } from './inventoryHooks';
import { LEDGER_REASONS, STATE_LABELS, isOrderRef, lowStockLevel, reasonLabel, signed, variantStockState } from './inventoryLogic';
import '../products/products.css';

// Inventory: stock control at the VARIANT level (the thing that is actually bought) and the ledger of every movement.
//   /admin/inventory          the stock table + summary; ?filter=low|out|untracked
//   /admin/inventory/ledger   every movement (sale, restock, adjustment, cancel, return ...), filterable, exportable
// Every stock change is made through the admin_adjust_stock function, so it is atomic and lands in the ledger.
const NO_MATCH = '00000000-0000-0000-0000-000000000000';

const TABS = [{ to: '/admin/inventory', label: 'Stock', end: true }, { to: '/admin/inventory/ledger', label: 'Stock ledger' }];

export default function InventoryPage() {
  return (
    <Routes>
      <Route index element={<StockTab />} />
      <Route path="ledger" element={<LedgerTab />} />
      <Route path="*" element={<Navigate to="/admin/inventory" replace />} />
    </Routes>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════ STOCK
const FILTERS = [{ value: 'low', label: 'Low stock (incl. out)' }, { value: 'out', label: 'Out of stock' }, { value: 'untracked', label: 'Unlimited (not tracked)' }];

function StockTab() {
  const { brand } = useBrand();
  const cats = useAdminCategories();
  const { values, set, reset, active } = useUrlFilters({ q: '', filter: '', category: '', page: 1 });
  const [nonce, setNonce] = useState(0);
  const [adjust, setAdjust] = useState(null);
  const [restock, setRestock] = useState(false);
  const [selected, setSelected] = useState([]);

  const storeLevel = Number(brand.low_stock_threshold) >= 0 ? Number(brand.low_stock_threshold) : 5;
  const low = useLowStockGroups({ enabled: true, storeLevel, column: 'stock', idColumn: 'product_id', extra: ['active.eq.true', 'track_inventory.eq.true'] });
  const summary = useInventorySummary({ lowGroups: low.groups, ready: low.ready, nonce });

  const catIds = values.category && cats.byId.has(values.category) ? cats.descendantIds(values.category) : null;
  const catP = useProductIds({ categoryIds: catIds });
  const nameP = useProductIds({ text: values.q });
  const text = values.q.replace(/[,()%*"'\\]/g, ' ').replace(/\s+/g, ' ').trim();
  const searchGroups = text ? [`sku.ilike.%${text}%`, ...productSearchGroups({ ids: nameP.ids, idColumn: 'product_id' })] : [];
  const filters = {
    product_id: catIds ? (catP.ids.length ? catP.ids : [NO_MATCH]) : '',
    ...(values.filter === 'out' ? { active: true, track_inventory: true, stock: 0 } : {}),
    ...(values.filter === 'untracked' ? { track_inventory: false } : {}),
    $or: combineOr(values.filter === 'low' ? low.groups : [], searchGroups),
  };
  const list = useServerList({
    table: 'product_variants', select: 'id, product_id, sku, label, stock, track_inventory, active, price, updated_at', filters,
    orderBy: [{ column: 'stock', ascending: true }, { column: 'product_id', ascending: true }, { column: 'position', ascending: true }, { column: 'id', ascending: true }],
    pageSize: 25, page: values.page, onPageChange: p => set({ page: p }),
    enabled: low.ready && nameP.ready && catP.ready && (!values.category || !cats.loading),
  });

  const names = useNames({ productIds: list.rows.map(r => r.product_id), variantIds: [] });
  const last = useLastMovements(list.rows.map(r => r.id));
  const refresh = () => { list.reload(); setNonce(n => n + 1); };
  const productOf = (r) => names.products.get(r.product_id);
  const catOptions = useMemo(() => treeOptions(cats.categories).map(o => ({ value: o.value, label: o.label })), [cats.categories]);

  const toRow = (r) => { const p = productOf(r); return { ...r, productName: p?.name, image: p?.images?.[0] }; };
  const selectedRows = list.rows.filter(r => selected.includes(r.id)).map(toRow);

  const columns = [
    { key: 'product', header: 'Product', render: r => {
      const p = productOf(r);
      return (
        <span className="adm-cell-thumb">
          <Thumb src={p?.images?.[0]} width={96} size={40} />
          <span className="pm-name">
            {p ? <Link to={`/admin/products/${p.id}`} className="pm-name-main iv-link">{p.name}</Link> : <span className="pm-name-main adm-muted">Loading…</span>}
            <span className="adm-cell-sub">{[p?.brand, p?.status && p.status !== 'active' ? p.status : ''].filter(Boolean).join(' · ') || '\u00a0'}</span>
          </span>
        </span>
      );
    } },
    { key: 'variant', header: 'Variant', render: r => (
      <span>{r.label === 'Default' ? <span className="adm-muted">Default</span> : r.label}{r.active === false && <span className="adm-chip" style={{ marginLeft: 6 }}>Disabled</span>}
        {r.sku && <span className="adm-cell-sub adm-mono" style={{ display: 'block' }}>{r.sku}</span>}</span>
    ) },
    { key: 'stock', header: 'Stock', align: 'right', render: r => (r.track_inventory === false ? <span className="adm-muted">∞</span> : <strong className="adm-money">{Number(r.stock).toLocaleString('en-IN')}</strong>) },
    { key: 'status', header: 'Status', render: r => {
      const state = variantStockState(r, lowStockLevel(productOf(r), brand));
      return <StatusPill kind="stock" status={state === 'in' ? 'in_stock' : state} label={STATE_LABELS[state]} />;
    } },
    { key: 'last', header: 'Last movement', hideOnMobile: true, render: r => {
      const m = last[r.id];
      return m ? <span><span className={Number(m.delta) < 0 ? 'iv-neg' : 'iv-pos'}>{signed(m.delta)}</span> <span className="adm-muted">{reasonLabel(m.reason)} · {relativeTime(m.created_at)}</span></span> : <span className="adm-muted">None yet</span>;
    } },
    { key: 'actions', header: '', mobileLabel: '', align: 'right', className: 'iv-actions', render: r => (
      <div className="adm-cell-actions">
        <Button size="sm" icon="layers" aria-label={`Adjust stock for ${productOf(r)?.name || 'product'} ${r.label}`} onClick={() => setAdjust([toRow(r)])}>Adjust</Button>
        <Button size="sm" variant="ghost" iconOnly icon="clock" aria-label={`Stock history for ${productOf(r)?.name || 'product'} ${r.label}`} to={`/admin/inventory/ledger?variant=${r.id}`} />
      </div>
    ) },
  ];

  const empty = active
    ? { icon: 'search', title: 'No variants match', hint: 'Try another search or clear the filters.', action: <Button onClick={reset}>Clear filters</Button> }
    : { icon: 'layers', title: 'No variants yet', hint: 'Add products and their stock appears here.', action: <Button variant="primary" to="/admin/products/new">Add a product</Button> };

  return (
    <>
      <PageHeader title="Inventory" subtitle="Stock levels by variant, adjustments, and the ledger of every movement"
        actions={<Button variant="primary" icon="plus" onClick={() => setRestock(true)}>Quick restock</Button>} />
      <div className="pm-tabs"><Tabs label="Inventory" items={TABS} /></div>

      <div className="adm-kpis c4 iv-kpis">
        <Stat label="Units in stock" icon="layers" tone="primary" value={summary.units.toLocaleString('en-IN')} loading={summary.loading} error={summary.error} hint={summary.truncated ? 'First 5,000 variants' : 'Tracked, active variants'} />
        <Stat label="Low or out of stock" icon="warning" tone="warning" value={summary.low === null ? '—' : summary.low.toLocaleString('en-IN')} loading={summary.loading} to="/admin/inventory?filter=low" hint="At or below the low-stock level" />
        <Stat label="Out of stock" icon="x" tone="danger" value={summary.out === null ? '—' : summary.out.toLocaleString('en-IN')} loading={summary.loading} to="/admin/inventory?filter=out" hint="Nothing left to sell" />
        <Stat label="Stock value" icon="card" tone="success" value={formatMoney(summary.value) || '₹0'} loading={summary.loading} error={summary.error} hint="At selling price" />
      </div>

      {summary.out > 0 && values.filter !== 'out' && (
        <div className="adm-note warning iv-banner" role="status">
          <span><strong>{summary.out.toLocaleString('en-IN')} variant{summary.out === 1 ? ' is' : 's are'} out of stock.</strong> Received a delivery? Enter the quantities in one go.</span>
          <Button size="sm" onClick={() => setRestock(true)}>Restock now</Button>
        </div>
      )}

      <FilterBar
        search={values.q} onSearch={q => set({ q })} searchPlaceholder="Search SKU or product…"
        selects={[
          { key: 'filter', label: 'Stock status', value: values.filter, onChange: v => set({ filter: v }), allLabel: 'All variants', options: FILTERS },
          { key: 'category', label: 'Category', value: values.category, onChange: v => set({ category: v }), allLabel: 'All categories', options: catOptions },
        ]}
        showClear={active} onClear={reset}
      />
      {(nameP.truncated || catP.truncated) && <p className="adm-hint" style={{ marginBottom: 10 }}>This search matches a lot of products; only the first 300 are listed. Narrow it down to see the rest.</p>}

      {selected.length > 0 && (
        <div className="pm-bulk" role="region" aria-label="Bulk actions">
          <strong>{selected.length} selected</strong>
          <Button size="sm" icon="layers" onClick={() => setAdjust(selectedRows)}>Set stock…</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear selection</Button>
        </div>
      )}

      <DataTable
        caption="Stock by variant" columns={columns} rows={list.rows} loading={list.loading} error={list.error} onRetry={list.reload} stickyHeader={false}
        selectable selectedKeys={selected} onSelectionChange={setSelected} empty={empty}
        footer={<Pagination page={list.page} pageSize={list.pageSize} total={list.count} onPage={list.setPage} />}
      />

      <AdjustStockDialog rows={adjust} onClose={() => setAdjust(null)} onDone={() => { setSelected([]); refresh(); }} />
      <QuickRestockDialog open={restock} onClose={() => setRestock(false)} onDone={refresh} />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════ LEDGER
const LEDGER_COLUMNS = 'id, variant_id, product_id, delta, reason, ref, note, actor, stock_after, created_at';

function LedgerTab() {
  const { values, set, reset, active } = useUrlFilters({ q: '', reason: '', from: '', to: '', product: '', variant: '', page: 1 });
  const [exporting, setExporting] = useState(false);
  const filters = { reason: values.reason, product_id: values.product, variant_id: values.variant, created_at: istRangeFilter(values.from, values.to) };
  const orderBy = [{ column: 'created_at', ascending: false }, { column: 'id', ascending: false }];
  const list = useServerList({
    table: 'inventory_movements', select: LEDGER_COLUMNS, filters, search: values.q, searchColumns: ['ref', 'note', 'actor'], orderBy,
    pageSize: 25, page: values.page, onPageChange: p => set({ page: p }),
  });
  const names = useNames({
    productIds: [...list.rows.map(r => r.product_id), values.product],
    variantIds: [...list.rows.map(r => r.variant_id), values.variant],
  });
  const scopeVariant = values.variant ? names.variants.get(values.variant) : null;
  const scopeProduct = values.product ? names.products.get(values.product) : (scopeVariant ? names.products.get(scopeVariant.product_id) : null);
  const scopeName = scopeVariant ? `${scopeProduct?.name || 'Product'} · ${scopeVariant.label}` : (scopeProduct?.name || '');

  async function runExport() {
    setExporting(true);
    const t = toast.loading('Preparing the ledger export…');
    try {
      const rows = [];
      for (let from = 0; from < 20000; from += 1000) {
        let q = supabase.from('inventory_movements').select(LEDGER_COLUMNS);
        q = applyOrder(applyFilters(q, filters), orderBy);
        const or = buildSearchOr(['ref', 'note', 'actor'], values.q);
        if (or) q = q.or(or);
        // eslint-disable-next-line
        const { data, error } = await withTimeout(q.range(from, from + 999), 30000);
        if (error) throw error;
        rows.push(...(data || []));
        toast.loading(`Reading movements… ${rows.length.toLocaleString('en-IN')}`, { id: t });
        if (!data || data.length < 1000) break;
      }
      const vIds = Array.from(new Set(rows.map(r => r.variant_id).filter(Boolean)));
      const pIds = Array.from(new Set(rows.map(r => r.product_id).filter(Boolean)));
      const vMap = new Map(); const pMap = new Map();
      for (let i = 0; i < vIds.length; i += 60) {
        // eslint-disable-next-line
        const { data } = await withTimeout(supabase.from('product_variants').select('id, label, sku').in('id', vIds.slice(i, i + 60)), 15000);
        (data || []).forEach(v => vMap.set(v.id, v));
      }
      for (let i = 0; i < pIds.length; i += 60) {
        // eslint-disable-next-line
        const { data } = await withTimeout(supabase.from('products').select('id, name').in('id', pIds.slice(i, i + 60)), 15000);
        (data || []).forEach(p => pMap.set(p.id, p));
      }
      exportCsv(`stock-ledger-${new Date().toISOString().slice(0, 10)}.csv`, [
        { label: 'time', get: r => r.created_at },
        { label: 'product', get: r => pMap.get(r.product_id)?.name || '' },
        { label: 'variant', get: r => vMap.get(r.variant_id)?.label || '' },
        { label: 'sku', get: r => vMap.get(r.variant_id)?.sku || '' },
        { label: 'units_in', get: r => (Number(r.delta) > 0 ? r.delta : '') },
        { label: 'units_out', get: r => (Number(r.delta) < 0 ? Math.abs(Number(r.delta)) : '') },
        { label: 'reason', get: r => reasonLabel(r.reason) },
        { label: 'reference', get: r => r.ref || '' },
        { label: 'note', get: r => r.note || '' },
        { label: 'by', get: r => r.actor || '' },
        { label: 'stock_after', get: r => r.stock_after ?? '' },
      ], rows);
      toast.success(`Exported ${rows.length.toLocaleString('en-IN')} movement${rows.length === 1 ? '' : 's'}.`, { id: t });
    } catch (e) {
      toast.error(`The export failed: ${e.message || e}`, { id: t });
    }
    setExporting(false);
  }

  const columns = [
    { key: 'time', header: 'When', render: m => <span style={{ whiteSpace: 'nowrap' }}><DateTime value={m.created_at} /></span> },
    { key: 'item', header: 'Product', render: m => {
      const p = names.products.get(m.product_id);
      const v = names.variants.get(m.variant_id);
      return (
        <span className="pm-name">
          {p ? <Link to={`/admin/products/${p.id}`} className="pm-name-main iv-link">{p.name}</Link> : <span className="pm-name-main adm-muted">{m.product_id ? 'Loading…' : 'Deleted product'}</span>}
          <span className="adm-cell-sub">{v ? [v.label === 'Default' ? '' : v.label, v.sku].filter(Boolean).join(' · ') || 'Default' : (m.variant_id ? '' : 'Variant deleted')}</span>
        </span>
      );
    } },
    { key: 'delta', header: 'Change', align: 'right', render: m => <strong className={`adm-money ${Number(m.delta) < 0 ? 'iv-neg' : 'iv-pos'}`}>{signed(m.delta)}</strong> },
    { key: 'reason', header: 'Reason', render: m => <span className="adm-chip">{reasonLabel(m.reason)}</span> },
    { key: 'ref', header: 'Reference', hideOnMobile: true, render: m => (m.ref ? (isOrderRef(m.ref) ? <Link to={`/admin/orders/${m.ref}`}>{m.ref}</Link> : <span>{m.ref}</span>) : <span className="adm-muted">—</span>) },
    { key: 'note', header: 'Note', hideOnMobile: true, render: m => (m.note ? <span style={{ overflowWrap: 'anywhere' }}>{m.note}</span> : <span className="adm-muted">—</span>) },
    { key: 'actor', header: 'By', hideOnMobile: true, render: m => <span className="adm-muted" style={{ whiteSpace: 'nowrap' }}>{m.actor ? m.actor.split('@')[0] : 'system'}</span> },
    { key: 'after', header: 'Stock after', align: 'right', render: m => (m.stock_after === null || m.stock_after === undefined ? <span className="adm-muted">—</span> : <span className="adm-money">{Number(m.stock_after).toLocaleString('en-IN')}</span>) },
  ];

  return (
    <>
      <PageHeader title="Stock ledger" crumbLabel="Stock ledger" subtitle="Every change to stock: sales, restocks, adjustments, cancellations and returns"
        actions={<Button icon="download" loading={exporting} onClick={runExport}>Export CSV</Button>} />
      <div className="pm-tabs"><Tabs label="Inventory" items={TABS} /></div>
      <FilterBar
        search={values.q} onSearch={q => set({ q })} searchPlaceholder="Search reference, note or person…"
        selects={[{ key: 'reason', label: 'Reason', value: values.reason, onChange: v => set({ reason: v }), allLabel: 'All reasons', options: LEDGER_REASONS }]}
        dateRange={{ from: values.from, to: values.to }} onDateRange={({ from, to }) => set({ from, to })}
        showClear={active} onClear={reset}
      >
        {(values.product || values.variant) && (
          <span className="adm-chip iv-scope">
            {scopeName || 'One item'}
            <button type="button" className="pf-chip-x" aria-label="Show all items" onClick={() => set({ product: '', variant: '' })}><Icon name="close" size={12} /></button>
          </span>
        )}
      </FilterBar>
      <DataTable
        caption="Stock movements" columns={columns} rows={list.rows} loading={list.loading} error={list.error} onRetry={list.reload} stickyHeader={false}
        empty={active
          ? { icon: 'search', title: 'No movements match', hint: 'Try a wider date range or clear the filters.', action: <Button onClick={reset}>Clear filters</Button> }
          : { icon: 'clock', title: 'No stock movements yet', hint: 'Sales, restocks and adjustments will be listed here.' }}
        footer={<Pagination page={list.page} pageSize={list.pageSize} total={list.count} onPage={list.setPage} />}
      />
    </>
  );
}
