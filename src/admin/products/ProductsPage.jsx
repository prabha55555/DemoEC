import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../supabase';
import { useBrand } from '../../context/BrandContext';
import { priceRange } from '../../utils/catalog';
import { Button, DataTable, EmptyState, FilterBar, Icon, Money, PageHeader, Pagination, StatusPill, Tabs, Thumb } from '../ui';
import { adminWrite, exportCsv, useConfirm, useServerList, useUrlFilters } from '../hooks';
import { lowStockLevel } from '../inventory/inventoryLogic';
import useAdminCategories from './useAdminCategories';
import Menu from './Menu';
import ProductImportDialog from './ProductImportDialog';
import { treeOptions } from './categoryTools';
import { exportColumns, exportRecords } from './productCsv';
import { checkDeletable, deleteProducts, duplicateProduct, fetchCatalogForExport, setProductsFeatured, setProductsStatus } from './productApi';
import { combineOr, productOrder, productSearchGroups, searchTerms, SORT_CHOICES, sortState, toggleSort } from './queryTools';
import { useLowStockGroups, useSkuMatches, useStatusCounts } from './listHooks';
import './products.css';

// Products: the catalogue list. Everything about the list lives in the URL (search, status, category, stock, featured,
// sort, page), so a filtered list can be shared, refreshed and linked to. One page of rows is fetched at a time.
const LIST_SELECT = 'id, product_number, name, brand, category_id, cat, status, featured, images, price, price_max, mrp, discount_pct, in_stock, has_variants, total_stock, low_stock_threshold, rating_avg, rating_count, sales_count, created_at';
const STOCK_FILTERS = [{ value: 'in', label: 'In stock' }, { value: 'low', label: 'Low stock' }, { value: 'out', label: 'Out of stock' }];
const STATUS_ACTIONS = { active: ['Activate', 'is now active', 'check'], draft: ['Move to draft', 'moved to draft', 'edit'], archived: ['Archive', 'archived', 'folder'] };

export default function ProductsPage() {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { brand } = useBrand();
  const cats = useAdminCategories();
  const { counts, reload: reloadCounts } = useStatusCounts();
  const { values, set, reset, active } = useUrlFilters({ q: '', status: '', category: '', stock: '', featured: '', sort: 'newest', page: 1 });
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState([]);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);

  // ---- the list query
  const storeLevel = Number(brand.low_stock_threshold) >= 0 ? Number(brand.low_stock_threshold) : 5;
  const sku = useSkuMatches(values.q);
  const low = useLowStockGroups({ enabled: values.stock === 'low', storeLevel, column: 'total_stock', idColumn: 'id', extra: ['in_stock.eq.true', 'total_stock.gt.0'] });
  const categoryReady = !values.category || !cats.loading;
  const catIds = values.category && cats.byId.has(values.category) ? cats.descendantIds(values.category) : '';
  const words = searchTerms(values.q);
  const or = combineOr(values.stock === 'low' ? low.groups : [], words.length || sku.ids.length ? productSearchGroups({ words, ids: sku.ids }) : []);
  const filters = {
    status: values.status, category_id: catIds, featured: values.featured === '1' ? true : '',
    in_stock: values.stock === 'in' ? true : values.stock === 'out' ? false : '',
    ...(or ? { $or: or } : {}),
  };
  const orderBy = productOrder(values.sort);
  const list = useServerList({
    table: 'products', select: LIST_SELECT, filters, orderBy, pageSize,
    page: values.page, onPageChange: p => set({ page: p }), enabled: sku.ready && low.ready && categoryReady,
  });

  // A different filter means a different set of rows: forget the ticked ones.
  useEffect(() => { setSelected([]); }, [values.q, values.status, values.category, values.stock, values.featured]);

  const refresh = () => { list.reload(); reloadCounts(); };
  const catOptions = useMemo(() => treeOptions(cats.categories).map(o => ({ value: o.value, label: o.label })), [cats.categories]);
  const levelOf = (p) => lowStockLevel(p, brand);

  // ---- row actions
  async function toggleFeatured(p) {
    const next = !p.featured;
    list.setRows(rows => rows.map(r => (r.id === p.id ? { ...r, featured: next } : r)));
    const { ok } = await adminWrite(supabase.from('products').update({ featured: next }).eq('id', p.id), { success: next ? 'Marked as featured.' : 'Removed from featured.' });
    if (!ok) list.setRows(rows => rows.map(r => (r.id === p.id ? { ...r, featured: p.featured } : r)));
  }

  async function changeStatus(p, status) {
    const [verb, done] = STATUS_ACTIONS[status];
    if (status === 'archived' && !(await confirm({ title: `Archive “${p.name}”?`, message: 'It disappears from the store but is kept, with its sales history. You can restore it any time.', confirmLabel: 'Archive' }))) return;
    const r = await setProductsStatus([p.id], status);
    if (r.skipped?.length) toast.error(`“${p.name}” can't be activated yet: ${r.skipped[0].why}. Open it to finish setting it up.`);
    else if (!r.ok) toast.error(r.error || `${verb} failed.`);
    else toast.success(`“${p.name}” ${done}.`);
    refresh();
  }

  async function duplicate(p) {
    const t = toast.loading('Duplicating…');
    const r = await duplicateProduct(p.id);
    toast.dismiss(t);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('Duplicated as a draft. Add its SKUs and stock before publishing.');
    navigate(`/admin/products/${r.id}`);
  }

  async function removeOne(p) {
    if (Number(p.sales_count) > 0) {
      const yes = await confirm({
        title: `“${p.name}” can't be deleted`, confirmLabel: 'Archive instead', cancelLabel: 'Close',
        message: `It has sold ${p.sales_count} unit${Number(p.sales_count) === 1 ? '' : 's'}, and past orders refer to it. Archive it instead: it leaves the store but its history stays.`,
      });
      if (yes) await changeStatus(p, 'archived');
      return;
    }
    if (!(await confirm({ title: `Delete “${p.name}”?`, message: 'The product, its variants and its uploaded photos are removed permanently. This cannot be undone.', confirmLabel: 'Delete product', tone: 'danger' }))) return;
    try {
      const { sold } = await checkDeletable([p.id]);
      if (sold.length) { toast.error('This product has just been sold, so it can no longer be deleted. Archive it instead.'); refresh(); return; }
    } catch { /* the delete below reports its own failure */ }
    const r = await deleteProducts([p.id]);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success('Product deleted.');
    refresh();
  }

  // ---- bulk actions
  async function bulkStatus(status) {
    const [verb] = STATUS_ACTIONS[status];
    if (!(await confirm({ title: `${verb} ${selected.length} product${selected.length === 1 ? '' : 's'}?`, message: status === 'archived' ? 'Archived products leave the store but keep their history.' : status === 'active' ? 'Products that have no category, photo or active variant are skipped.' : 'Draft products are hidden from the store.', confirmLabel: verb }))) return;
    setBusy(true);
    const r = await setProductsStatus(selected, status);
    setBusy(false);
    if (!r.ok) toast.error(r.error || 'Could not update the products.');
    else toast.success(`${r.updated} product${r.updated === 1 ? '' : 's'} updated.`);
    if (r.skipped?.length) {
      toast.error(`${r.skipped.length} skipped: ${r.skipped.slice(0, 3).map(s => `${s.name} (${s.why})`).join('; ')}${r.skipped.length > 3 ? '…' : ''}`, { duration: 8000 });
    }
    setSelected([]);
    refresh();
  }

  async function bulkFeatured(flag) {
    setBusy(true);
    const r = await setProductsFeatured(selected, flag);
    setBusy(false);
    if (!r.ok) toast.error(r.error); else toast.success(`${r.updated} product${r.updated === 1 ? '' : 's'} ${flag ? 'marked as featured' : 'removed from featured'}.`);
    setSelected([]);
    refresh();
  }

  async function bulkDelete() {
    setBusy(true);
    let sold = [];
    let deletable = selected;
    try { ({ sold, deletable } = await checkDeletable(selected)); } catch { /* fall back to the ticked rows */ }
    setBusy(false);
    if (!deletable.length) {
      await confirm({ title: 'Nothing can be deleted', message: `${sold.length === 1 ? 'That product has' : 'Those products have'} been sold, so ${sold.length === 1 ? 'it' : 'they'} can't be deleted. Archive ${sold.length === 1 ? 'it' : 'them'} instead.`, confirmLabel: 'OK', cancelLabel: 'Close' });
      return;
    }
    const names = sold.slice(0, 3).map(s => s.name).join(', ');
    const yes = await confirm({
      title: `Delete ${deletable.length} product${deletable.length === 1 ? '' : 's'}?`, tone: 'danger', confirmLabel: 'Delete',
      message: `They, their variants and their uploaded photos are removed permanently.${sold.length ? ` ${sold.length} sold product${sold.length === 1 ? ' is' : 's are'} skipped (${names}${sold.length > 3 ? '…' : ''}); archive ${sold.length === 1 ? 'it' : 'them'} instead.` : ''}`,
    });
    if (!yes) return;
    setBusy(true);
    const r = await deleteProducts(deletable);
    setBusy(false);
    if (!r.ok) toast.error(`${r.error}${r.count ? ` (${r.count} were deleted first.)` : ''}`); else toast.success(`${r.count} product${r.count === 1 ? '' : 's'} deleted.`);
    setSelected([]);
    refresh();
  }

  // ---- export
  async function runExport(ids) {
    setExporting(true);
    const t = toast.loading('Preparing the export…');
    try {
      const { products, variantsByProduct } = await fetchCatalogForExport({
        filters, orderBy, ids,
        onProgress: ({ stage, done, total }) => toast.loading(`${stage === 'products' ? 'Reading products' : 'Reading variants'}… ${done.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')}`, { id: t }),
      });
      const rows = products.flatMap(p => exportRecords(p, variantsByProduct.get(p.id) || [], cats.categories));
      exportCsv(`products-${new Date().toISOString().slice(0, 10)}.csv`, exportColumns(), rows);
      const noNumber = products.filter(p => !p.product_number).length;
      toast.success(`Exported ${products.length.toLocaleString('en-IN')} product${products.length === 1 ? '' : 's'} (${rows.length.toLocaleString('en-IN')} rows).${noNumber ? ` ${noNumber} have no product number, so importing this file again would create copies of them - give them one first.` : ''}`, { id: t, duration: noNumber ? 9000 : 4000 });
    } catch (e) {
      toast.error(`The export failed: ${e.message || e}`, { id: t });
    }
    setExporting(false);
  }

  const columns = [
    { key: 'name', header: 'Product', sortable: true, width: '30%', render: p => (
      <span className="adm-cell-thumb">
        <Thumb src={p.images?.[0]} width={96} size={44} />
        <span className="pm-name">
          <span className="pm-name-main">{p.name}</span>
          <span className="adm-cell-sub">{[p.brand, p.product_number].filter(Boolean).join(' · ') || 'No brand or number'}</span>
        </span>
      </span>
    ) },
    { key: 'category', header: 'Category', hideOnMobile: true, render: p => {
      const chain = p.category_id ? cats.chain(p.category_id) : [];
      return p.cat || chain[0]?.name ? (
        <span>{p.cat || chain[0].name}{chain[1] && <span className="adm-cell-sub" style={{ display: 'block' }}>{chain[1].name}</span>}</span>
      ) : <span className="adm-muted">None</span>;
    } },
    { key: 'price', header: 'Price', sortable: true, align: 'right', render: p => <PriceCell p={p} /> },
    { key: 'stock', header: 'Stock', sortable: true, render: p => <StockCell p={p} level={levelOf(p)} /> },
    { key: 'status', header: 'Status', render: p => <StatusPill kind="product" status={p.status} /> },
    { key: 'featured', header: 'Featured', align: 'center', hideOnMobile: true, render: p => (
      <button type="button" className={`pm-star${p.featured ? ' is-on' : ''}`} aria-pressed={!!p.featured}
        aria-label={`${p.featured ? 'Remove' : 'Mark'} ${p.name} ${p.featured ? 'from' : 'as'} featured`} title={p.featured ? 'Featured' : 'Not featured'} onClick={() => toggleFeatured(p)}>
        <Icon name="star" size={18} filled={!!p.featured} />
      </button>
    ) },
    { key: 'rating', header: 'Rating', hideOnMobile: true, render: p => (Number(p.rating_count) > 0 ? <span className="adm-money">{Number(p.rating_avg).toFixed(1)} <span className="adm-muted">({p.rating_count})</span></span> : <span className="adm-muted">—</span>) },
    { key: 'sales', header: 'Sold', sortable: true, align: 'right', hideOnMobile: true, render: p => <span className="adm-money">{Number(p.sales_count || 0).toLocaleString('en-IN')}</span> },
    { key: 'actions', header: '', mobileLabel: '', align: 'right', render: p => (
      <div className="adm-cell-actions">
        <Menu label={`Actions for ${p.name}`} items={[
          { label: 'Edit', icon: 'edit', to: `/admin/products/${p.id}` },
          { label: 'Duplicate', icon: 'copy', onClick: () => duplicate(p) },
          p.status !== 'active' ? { label: 'Activate', icon: 'check', onClick: () => changeStatus(p, 'active') } : { label: 'Move to draft', icon: 'edit', onClick: () => changeStatus(p, 'draft') },
          p.status !== 'archived' ? { label: 'Archive', icon: 'folder', onClick: () => changeStatus(p, 'archived') } : null,
          p.status === 'active' ? { label: 'View in store', icon: 'external', to: `/product/${p.id}` } : null,
          'divider',
          { label: 'Delete', icon: 'trash', danger: true, onClick: () => removeOne(p) },
        ]} />
      </div>
    ) },
  ];

  const first = !active && !list.loading && !list.error && list.count === 0;
  const tabItems = [
    { key: 'all', label: 'All', count: counts.all ?? undefined },
    { key: 'active', label: 'Active', count: counts.active ?? undefined },
    { key: 'draft', label: 'Draft', count: counts.draft ?? undefined },
    { key: 'archived', label: 'Archived', count: counts.archived ?? undefined },
  ];

  return (
    <>
      <PageHeader
        title="Products" subtitle="Your catalogue: search, filter and edit products"
        actions={(
          <>
            <Button icon="upload" onClick={() => setImportOpen(true)}>Import CSV</Button>
            <Button icon="download" loading={exporting} onClick={() => runExport(null)}>Export CSV</Button>
            <Button variant="primary" icon="plus" to="/admin/products/new">Add product</Button>
          </>
        )}
      />
      {!first && <div className="pm-tabs"><Tabs label="Product status" items={tabItems} value={values.status || 'all'} onChange={k => set({ status: k === 'all' ? '' : k })} /></div>}
      {!first && (
        <FilterBar
          search={values.q} onSearch={q => set({ q })} searchPlaceholder="Search name, brand, product number or SKU…"
          selects={[
            { key: 'category', label: 'Category', value: values.category, onChange: v => set({ category: v }), allLabel: 'All categories', options: catOptions },
            { key: 'stock', label: 'Stock', value: values.stock, onChange: v => set({ stock: v }), allLabel: 'Any stock', options: STOCK_FILTERS },
            { key: 'featured', label: 'Featured', value: values.featured, onChange: v => set({ featured: v }), allLabel: 'Featured or not', options: [{ value: '1', label: 'Featured only' }] },
            { key: 'sort', label: 'Sort by', value: values.sort, onChange: v => set({ sort: v }), options: SORT_CHOICES },
          ]}
          showClear={active} onClear={reset}
        />
      )}
      {values.stock === 'low' && low.truncated && <p className="adm-hint" style={{ marginBottom: 10 }}>Many products have their own low-stock level; only the first 120 are taken into account here.</p>}

      {selected.length > 0 && (
        <div className="pm-bulk" role="region" aria-label="Bulk actions">
          <strong>{selected.length} selected</strong>
          <Menu label="Set status" trigger={{ children: 'Set status', icon: 'check', iconRight: 'chevronDown', size: 'sm', disabled: busy }} align="left" items={[
            { label: 'Activate', icon: 'check', onClick: () => bulkStatus('active') },
            { label: 'Move to draft', icon: 'edit', onClick: () => bulkStatus('draft') },
            { label: 'Archive', icon: 'folder', onClick: () => bulkStatus('archived') },
          ]} />
          <Button size="sm" icon="star" disabled={busy} onClick={() => bulkFeatured(true)}>Feature</Button>
          <Button size="sm" disabled={busy} onClick={() => bulkFeatured(false)}>Unfeature</Button>
          <Button size="sm" icon="download" disabled={busy || exporting} onClick={() => runExport(selected)}>Export selection</Button>
          <Button size="sm" variant="danger" icon="trash" disabled={busy} onClick={bulkDelete}>Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear selection</Button>
        </div>
      )}

      {first ? (
        <div className="adm-dt-card">
          <EmptyState
            icon="box" title="Add your first product" hint="Create a product with its photos, options and stock, or bring a whole catalogue in from a spreadsheet."
            action={<><Button variant="primary" icon="plus" to="/admin/products/new">Add your first product</Button><Button icon="upload" onClick={() => setImportOpen(true)}>Import from CSV</Button></>}
          />
        </div>
      ) : (
        <DataTable
          caption="Products" rowHref={p => `/admin/products/${p.id}`} stickyHeader={false}
          columns={columns} rows={list.rows} loading={list.loading} error={list.error} onRetry={list.reload}
          sort={sortState(values.sort)} onSort={key => set({ sort: toggleSort(values.sort, key) })}
          selectable selectedKeys={selected} onSelectionChange={setSelected}
          empty={{ icon: 'search', title: 'No products match your filters', hint: 'Try a different search, or clear the filters.', action: <Button onClick={reset}>Clear filters</Button> }}
          footer={<Pagination page={list.page} pageSize={list.pageSize} total={list.count} onPage={list.setPage} pageSizes={[25, 50, 100]} onPageSize={setPageSize} />}
        />
      )}

      <ProductImportDialog open={importOpen} onClose={() => setImportOpen(false)} categories={cats.categories} onDone={refresh} />
    </>
  );
}

function PriceCell({ p }) {
  if (p.price === null || p.price === undefined) return <span className="adm-muted">No variants</span>;
  const r = priceRange(p);
  return (
    <span className="pm-price">
      <span className="pm-price-main"><Money value={r.from ?? p.price} />{r.isRange && r.to ? <> – <Money value={r.to} /></> : null}</span>
      {r.mrp && <span className="pm-price-sub"><Money value={r.mrp} strike muted /> <span className="pm-off">{p.discount_pct || r.percentOff}% off</span></span>}
    </span>
  );
}

function StockCell({ p, level }) {
  if (p.price === null || p.price === undefined) return <span className="adm-muted">—</span>;
  if (!p.in_stock) return <StatusPill kind="stock" status="out" />;
  const n = Number(p.total_stock) || 0;
  if (n === 0) return <StatusPill kind="stock" status="untracked" label="Unlimited" />;
  if (n <= level) return <StatusPill kind="stock" status="low" label={`Low · ${n}`} />;
  return <span className="adm-money">{n.toLocaleString('en-IN')} <span className="adm-muted">in stock</span></span>;
}
