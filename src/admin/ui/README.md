# Admin UI kit

Everything an admin screen needs, so a new screen is mostly composition. Styles live in `src/styles/admin.css`
(scoped under `.adm`). A screen is a default-exported React component rendered by `src/admin/routes.jsx` inside
`AdminLayout` (sidebar, top bar, confirm dialog, unsaved-changes guard, shared counts).

```jsx
import { PageHeader, Card, DataTable, Pagination, FilterBar, StatusPill, Button, Money, DateTime } from '../ui';
import { useServerList, useUrlFilters, adminWrite, useConfirm } from '../hooks';
```

* `../ui` = components + formatters (this folder). `../hooks` = hooks and non-visual helpers (`adminWrite`, `exportCsv`).
* Rules of the house: no `select('*')` of a whole table (use `useServerList`), no silent writes (use `adminWrite`),
  every list has loading / empty / error states (DataTable does it), every destructive action asks first (`useConfirm`).
* **Controls call `onChange(value)`, not the DOM event**; text-like controls hold their value as a **string**.

---

## A typical list screen (copy this)

```jsx
export default function CouponsList() {
  const confirm = useConfirm();
  const { values, set, reset, active } = useUrlFilters({ q: '', status: '', page: 1 });   // state lives in the URL
  const list = useServerList({
    table: 'coupons', search: values.q, searchColumns: ['code', 'description'],
    filters: { active: values.status === 'on' ? true : values.status === 'off' ? false : '' },
    orderBy: { column: 'created_at', ascending: false }, pageSize: 25,
    page: values.page, onPageChange: p => set({ page: p }),
  });
  async function remove(c) {
    if (!(await confirm({ title: `Delete ${c.code}?`, confirmLabel: 'Delete', tone: 'danger' }))) return;
    const { ok } = await adminWrite(supabase.from('coupons').delete().eq('id', c.id), { success: 'Coupon deleted.' });
    if (ok) list.reload();
  }
  return (
    <>
      <PageHeader title="Coupons" actions={<Button variant="primary" icon="plus" to="/admin/coupons/new">New coupon</Button>} />
      <FilterBar search={values.q} onSearch={q => set({ q })} showClear={active} onClear={reset}
        selects={[{ key: 'status', label: 'Status', value: values.status, onChange: v => set({ status: v }), allLabel: 'All',
                    options: [{ value: 'on', label: 'Active' }, { value: 'off', label: 'Inactive' }] }]} />
      <DataTable
        columns={[{ key: 'code', header: 'Code' }, { key: 'active', header: 'Status', render: c => <StatusPill kind="generic" status={c.active ? 'active' : 'inactive'} /> }]}
        rows={list.rows} loading={list.loading} error={list.error} onRetry={list.reload} rowHref={c => `/admin/coupons/${c.id}`}
        empty={{ icon: 'tag', title: 'No coupons yet' }}
        footer={<Pagination page={list.page} pageSize={list.pageSize} total={list.count} onPage={list.setPage} />} />
    </>
  );
}
```

A form/edit screen: `useRecord(table, id)` to load, local `form` state, `useUnsavedChanges(dirty)`, `<SaveBar>` at the bottom,
`adminWrite` to save. See `src/admin/content/BlogManager.jsx` (editor) and `src/admin/settings/*` (forms over `settings`).

---

## What the shell already does for you

* Sidebar, top bar (search by order number / customer / product name, "needs attention" bell, View store, Sign out), mobile drawer, breadcrumbs,
  scroll-to-top, a crash boundary per screen, a 404 for unknown `/admin/...` URLs.
* Asks the database (`is_admin()`) whether the signed-in login really is the store admin. If not, an "Please sign in again" screen replaces the
  admin — because row-level security would otherwise return EMPTY lists and silently ignore writes, which looks like an empty store.
* Provides `useConfirm`, `useUnsavedChanges` and `useAdminCounts` to every screen, and signs out + redirects when a request finds the session expired.

---

## URL conventions (links between screens)

List screens keep their filters in the query string so links, refresh and the browser Back button all work.
The dashboard and the top-bar bell link with these:

| Param | Meaning | Example |
|---|---|---|
| `status` | exact status; may be a **comma-separated list** | `/admin/orders?status=Placed,Confirmed,Packed` · `/admin/returns?status=Requested` · `/admin/reviews?status=pending` · `/admin/queries?status=Received` |
| `q` | text search | `/admin/products?q=kurta` · `/admin/orders?q=BL-20001` (the top-bar search links here) |
| `filter` | a named preset | `/admin/inventory?filter=low` (variants at or below the low-stock level) |
| `flag` | orders needing attention | `/admin/orders?flag=inventory_issue` (orders with `inventory_issue` set) |
| `page` | 1-based page | `?page=3` |

**The numbers on the dashboard / bell / sidebar** (`useAdminCounts`) are defined as: *orders awaiting action* = `status` in Placed/Confirmed/Packed (plus legacy Paid/Pending), not soft-deleted ·
*returns to review* = `order_returns.status = 'Requested'` · *low stock* = `product_variants` that are `active`, `track_inventory`, with `stock <= settings.low_stock_threshold` (sold-out included; the store-wide level, not the per-product override) ·
*reviews to moderate* = `status = 'pending'` · *flagged orders* = `inventory_issue is not null` · *new queries* = `enquiries.status = 'Received'`.
Make the list a tile links to use the same rule, so the figure and the list match.

The legacy cross-tab pushes (`setOrderStatusFilter('Pending')` …) are now these links: `<Link to="/admin/orders?status=Placed">`.
Routes: `/admin/orders/:id` takes the **human order number** (`BL-20001`) from links made by the shell; the detail screen should accept the
row uuid too. `/admin/products/new` and `/admin/products/:id` (uuid). Sections registered with `/*` in `routes.jsx`
(categories, inventory, returns, customers, reviews, coupons, reports) may render their own nested `<Routes>`.

---

## Hooks  (`import … from '../hooks'`)

| Export | Use |
|---|---|
| `useServerList({ table, select, filters, search, searchColumns, orderBy, pageSize, page, onPageChange, enabled })` | Real server-side pagination (`count: 'exact'` + `.range()`). Returns `{ rows, count, loading, error, page, setPage, pageSize, pageCount, showing, reload, setRows }`. Changing filters / search / order / page size resets to page 1; a vanished last page steps back; stale responses are ignored. |
| `adminWrite(builder, opts?)` | Wraps an insert / update / upsert / delete builder. Appends `.select()` and treats **0 rows affected as a failure** (RLS turns a forbidden write into a silent 200): "Nothing was saved — are you signed in as the store admin?". Never throws; toasts failures. Returns `{ ok, data, error }`. `opts`: `success` (toast text), `failure`, `errors` (`{ '23505': 'text' }`), `silent`, `noRowsMessage`, `expectRows` (default true). |
| `useUrlFilters({ q: '', status: '', page: 1 })` | Filter state in the URL. `{ values, set(patch), reset(), active }`. Any change other than `page` resets `page`. Defaults are not written to the URL; numeric defaults read back as numbers. |
| `useRecord(table, id, { column, select })` | Load one row for an edit screen: `{ record, loading, error, notFound, reload }`. |
| `useConfirm()` | `if (!(await confirm({ title, message, confirmLabel, cancelLabel, tone: 'danger' }))) return;` — replaces `window.confirm`. |
| `useUnsavedChanges(dirty)` | While `dirty`: the browser warns on tab close and in-app link clicks ask "Discard unsaved changes?". (Browser Back is not interceptable with this router.) |
| `useDebounce(value, ms)` · `useDocumentTitle(title)` | Small utilities. `PageHeader` already sets the title. |
| `useAdminCounts()` | `{ counts, loading, attentionTotal, refresh }` — the shared "needs attention" figures (`ordersAwaiting`, `returnsToReview`, `lowStock`, `reviewsToModerate`, `inventoryIssues`, `newQueries`, `stockAlerts`; `null` = failed to load). **Call `refresh()` after changing something that moves a count** (an order status, a return decision, a review). |
| `exportCsv(filename, columns, rows)` | Download rows as CSV (`columns: [{ label, get(row) }]`). Spreadsheet formulas are neutralised, UTF-8 BOM added. `toCsv` returns the text. |
| `friendlyDbError(error)` · `isPermissionError(error)` | Turn a database error into a sentence / detect an RLS refusal. |

`filters` for `useServerList`: `{ column: value }` is `=`; `null` is `IS NULL`; an array is `IN (…)`; `''` / `undefined` / `[]` are ignored (so an
unselected dropdown adds nothing); `{ gte, lte, gt, lt, neq, like, ilike, in, is, not: ['is', null] }` for operators; `$or: 'a.eq.1,b.eq.2'` for a raw
PostgREST `or`. `searchColumns` must be **text** columns (it ORs `ilike %text%` on each). **No embedded selects** (`select('*, other(*)')`) —
fetch related rows with a second query, as `StockAlertsPage` does for variant labels.

---

## Layout & content

| Component | Props / example |
|---|---|
| `PageHeader` | `<PageHeader title subtitle actions breadcrumb crumbLabel back />` — breadcrumb trail from the URL (override: `crumbLabel="BL-20001"` renames the last crumb, `breadcrumb={[{label,to?}]}`, `back={{to,label}}`). Sets the tab title. |
| `Card` | `<Card title subtitle actions footer pad={false}>` · `Section`: `<Section title description>` fields… `</Section>` (a titled form block). |
| `Tabs` | Route-aware: `<Tabs items={[{ to: '/admin/x/a', label: 'A' }]} />`; or state-driven `items={[{ key, label, count }]} value onChange`. |
| `Stat` | KPI tile: `<Stat label value hint icon tone to loading error onRetry />` (tone: primary info success warning danger neutral). |
| `EmptyState` / `ErrorState` | `<EmptyState icon title hint action />` · `<ErrorState error onRetry />` (a permission failure is shown as "Access denied"). |
| `Skeleton` / `SkeletonRows` | `<Skeleton width height />` · `<SkeletonRows rows={5} />`. |
| `Button` | `<Button variant="primary|secondary|danger|ghost|link" size="sm" icon="plus" loading to="/admin/x" href="https://…" iconOnly block>` (give `iconOnly` buttons an `aria-label`). |
| `Icon` | `<Icon name="box" size={18} />` — `ICON_NAMES` lists them (dashboard box layers folder plus bell cart chat tag gift image doc cog mail wa send edit trash copy download upload external filter undo users user chart barChart truck card receipt eye calendar clock refresh more star lock shield link grip play help info warning check …). |
| `CopyButton` | `<CopyButton text="BL-20001" />` or with `label="Copy"`. |
| `Thumb` | A small picture for a table row / list: `<Thumb src={p.images?.[0]} width={96} size={44} alt="" />`. Requests a resized rendition (`thumb()`), falls back to the original file when Image Transformations are unavailable, then to a placeholder — never a broken image. `originalOnError(url)` does the same for a raw `<img src={thumb(url, 300)}>`. |
| `Money` / `DateTime` | `<Money value={499} />` ₹499 · `<DateTime value={iso} />` 06 Oct 2026, 3:42 pm IST · `dateOnly` · `relative`. Plain functions: `formatMoney`, `formatMoneyCompact`, `formatDate`, `formatDateTime`, `relativeTime`. |
| `StatusPill` | `<StatusPill status={o.status} kind="order|payment|return|product|review|stock|generic" />` (kind defaults to auto-detect). Colours from `statusTone` in `utils/orderStatus.js`. `label` / `tone` override. |

## Lists

| Component | Notes |
|---|---|
| `DataTable` | `columns` (`{ key, header, render, width, align, sortable, hideOnMobile, mobileLabel }`), `rows`, `rowKey`, `loading`, `error`, `onRetry`, `empty`, `footer`, `caption`, `rowHref(row)` / `onRowClick(row)`, `sort` + `onSort(key)`, `selectable` + `selectedKeys` + `onSelectionChange(keys)`, `dense`, `stickyHeader`. Skeleton rows while loading, empty and error states built in; under 720px it becomes stacked cards (the first column is each card's title; an actions column should have `header: ''`). |
| `Pagination` | `<Pagination page pageSize total onPage pageSizes onPageSize />` — "Showing 26–50 of 132" + numbered pages. |
| `FilterBar` | `search` / `onSearch` (debounced 300 ms), `selects: [{ key, label, value, onChange, options, allLabel }]`, `dateRange` / `onDateRange` (`'YYYY-MM-DD'` strings; convert with `istRangeFilter(from, to)` → `{ gte, lt }` for `created_at`), `onClear` + `showClear`, `actions`, `children`. |

## Forms

| Component | Notes |
|---|---|
| `Field` | `<Field label hint error required optional>` wraps ONE control and wires `id`, `aria-describedby`, `aria-invalid`. |
| `TextInput` | `value onChange(string) type prefix suffix placeholder maxLength …` (any native input prop). |
| `Textarea` | `value onChange(string) rows showCount maxLength`. |
| `Select` | `value onChange(string) options={['a'] or [{value,label,disabled}]} placeholder`. |
| `MoneyInput` | `value onChange(string) decimals={2} prefix="₹"` — digits + one dot, pasting "₹1,299" works. |
| `NumberInput` | `value onChange(string) integer min max suffix` — clamps on blur; no wheel/arrow accidents. |
| `Toggle` / `Checkbox` | `checked onChange(boolean) label hint disabled`. |
| `FieldRow` | `<FieldRow cols={2|3|4}>` side-by-side fields, stacked on a phone. |
| `SaveBar` | Sticky bottom strip: `<SaveBar dirty saving onSave onDiscard disabled saveLabel />`. |
| Helpers | `parseNumber(str, fallback)`; `lib/validate`: `checkNumber(raw, { required, min, max, integer, label })`, `checkEmail`, `checkPhone`, `hasErrors`; `lib/gstin`: `validateGstin`. |

Settings-style forms over the single `settings` row: `useBrandForm({ initial, validate, toPayload })` in
`src/admin/settings/useBrandForm.js` (re-seeds when the real row arrives; blocks save until then) + `SettingsForm`.

## Dialogs

| Component | Notes |
|---|---|
| `Modal` | `<Modal open onClose title subtitle footer size="sm|md|lg" dismissable busy>` — focus trap, Esc, backdrop click, focus returns, page scroll locked. |
| `ConfirmDialog` | `<ConfirmDialog open onClose onConfirm title message confirmLabel tone="danger">` — `onConfirm` may be async: spinner while it runs; return `false` or throw to keep it open. |

## Media  (`src/admin/ui/media`, also exported from `../ui`)

`MediaUrlField` (paste URL + upload one file) · `ImagePositionPicker` / `PositionGrid` (focal point) · `HeroImageField` ·
`PackagePhotoField({ order, onSave(orderId, url|null) })` · `TrackingFields({ order, onSave(orderId, { shipping_carrier, tracking_number, tracking_url }) })`
— the last two are for the order screen. For product / blog photos use `src/components/ImageUploader.jsx`
(`images onChange folder multiple video`), which uploads at most 3 files at a time. Storage helpers in `utils/supabaseStorage.js`:
`uploadToStorage`, `deleteFromStorage(urls)`, and `staleMediaUrls(before, after)` — after a **successful** save, delete the replaced / removed files:
`deleteFromStorage(staleMediaUrls(oldRow.images, form.images))`.

## Utility CSS classes

`adm-stack` (vertical gap; `tight` / `loose`) · `adm-row` (+ `between`) · `adm-grow` · `adm-grid-2` · `adm-muted` · `adm-mono` · `adm-sr` (screen-reader only) ·
`adm-note` (+ `info warning danger success`) · `adm-chip` · `adm-cell-thumb` / `adm-cell-sub` / `adm-cell-actions` (table cells) · `adm-kpis` (tile grid) ·
`adm-vars` / `adm-var` (variable chips).
