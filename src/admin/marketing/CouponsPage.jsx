import React, { useCallback, useMemo, useState } from 'react';
import { Route, Routes, useNavigate } from 'react-router-dom';
import { supabase } from '../../supabase';
import { useCatalog } from '../../context/CatalogContext';
import { Button, DataTable, FilterBar, PageHeader, Pagination, StatusPill, Tabs, Toggle, formatDate } from '../ui';
import { adminWrite, useConfirm, useServerList, useUrlFilters } from '../hooks';
import { buildCountQuery } from '../hooks/serverList';
import { useTabCounts } from '../orders/orderData';
import useLoad, { rowsOf } from '../orders/useLoad';
import CouponForm from './CouponForm';
import { COUPON_COLUMNS, STATUS_PILL } from './couponData';
import { COUPON_STATUSES, couponStatus, couponStatusFilters, deleteBlocker, describeLimits, describeOffer, describeScope, describeUsage, isExhausted } from './couponLogic';
import '../orders/orders.css';

// /admin/coupons (list), /admin/coupons/new and /admin/coupons/:id (the form). The shell registers this section as coupons/*.
export default function CouponsPage() {
  return (
    <Routes>
      <Route index element={<CouponsList />} />
      <Route path="new" element={<CouponForm />} />
      <Route path=":id" element={<CouponForm />} />
    </Routes>
  );
}

// PostgREST cannot compare two columns, so "used up" (times_used >= max_uses) is found from the coupons that HAVE a limit:
// three narrow columns, and only those coupons.
async function exhaustedCouponIds() {
  const rows = await rowsOf(supabase.from('coupons').select('id, max_uses, times_used').gt('max_uses', 0).limit(1000));
  return rows.filter(isExhausted).map(r => r.id);
}

function CouponsList() {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { byId } = useCatalog();
  const { values, set, reset, active } = useUrlFilters({ q: '', status: '', vis: '', page: 1 });
  const [now, setNow] = useState(() => new Date());   // fixed per visit / refresh, so the list and the counts agree
  const [nonce, setNonce] = useState(0);
  const exhausted = useLoad(exhaustedCouponIds, [nonce]);
  const ids = exhausted.data || [];
  const ready = !exhausted.loading || exhausted.data !== null;

  const vis = values.vis === 'public' ? { is_public: true } : values.vis === 'private' ? { is_public: false } : {};
  const filters = useMemo(() => ({ ...couponStatusFilters(values.status, now, ids), ...vis }), [values.status, values.vis, now, ids]); // eslint-disable-line
  const list = useServerList({
    table: 'coupons', select: COUPON_COLUMNS, filters, search: values.q, searchColumns: ['code', 'description'],
    orderBy: { column: 'created_at', ascending: false }, pageSize: 25, page: values.page, onPageChange: p => set({ page: p }), enabled: ready,
  });
  const { counts } = useTabCounts({
    table: 'coupons', keys: ['', ...COUPON_STATUSES.map(s => s.value)], nonce, search: values.q, searchColumns: ['code', 'description'],
    filtersFor: k => ({ ...couponStatusFilters(k, now, ids), ...vis }),
  });
  const tabs = [{ key: '', label: 'All', count: counts[''] }, ...COUPON_STATUSES.map(s => ({ key: s.value, label: s.label, count: counts[s.value] }))];
  const categoryNames = useMemo(() => Object.fromEntries([...byId.entries()].map(([id, c]) => [id, c.name])), [byId]);

  const refresh = useCallback(() => { setNow(new Date()); setNonce(n => n + 1); list.reload(); }, [list]);

  async function toggleActive(c, next) {
    list.setRows(rows => rows.map(r => (r.id === c.id ? { ...r, active: next } : r)));
    const { ok } = await adminWrite(supabase.from('coupons').update({ active: next }).eq('id', c.id), { success: next ? `${c.code} is switched on.` : `${c.code} is switched off.` });
    if (!ok) list.setRows(rows => rows.map(r => (r.id === c.id ? { ...r, active: c.active } : r)));
    else refresh();
  }

  async function remove(c) {
    let orderCount = 0;
    try {
      const { count } = await buildCountQuery(supabase, { table: 'orders', filters: { coupon_code: c.code } });
      orderCount = count || 0;
    } catch { /* if the check fails, times_used still protects a used coupon */ }
    const blocker = deleteBlocker(c, orderCount);
    if (blocker) {
      const off = await confirm({ title: `${c.code} can't be deleted`, message: blocker, confirmLabel: c.active ? 'Switch it off' : 'OK', cancelLabel: 'Close' });
      if (off && c.active) toggleActive(c, false);
      return;
    }
    const yes = await confirm({ title: `Delete ${c.code}?`, message: 'It has never been used. Customers can no longer use it, and this cannot be undone.', confirmLabel: 'Delete coupon', tone: 'danger' });
    if (!yes) return;
    const { ok } = await adminWrite(supabase.from('coupons').delete().eq('id', c.id), { success: `${c.code} deleted.` });
    if (ok) refresh();
  }

  const dates = (c) => {
    if (!c.starts_at && !c.expires_at) return <span className="adm-muted">Always</span>;
    return <span>{c.starts_at ? `From ${formatDate(c.starts_at)}` : 'Until'}{c.starts_at && c.expires_at ? <br /> : ' '}{c.expires_at ? `${c.starts_at ? 'to' : ''} ${formatDate(c.expires_at)}`.trim() : <span className="adm-cell-sub" style={{ display: 'inline' }}>no end</span>}</span>;
  };

  return (
    <>
      <PageHeader title="Coupons" subtitle="Discount codes customers can use at checkout"
        actions={(<><Button icon="refresh" onClick={refresh}>Refresh</Button><Button variant="primary" icon="plus" to="/admin/coupons/new">New coupon</Button></>)} />
      <Tabs label="Coupon status" items={tabs} value={values.status} onChange={k => set({ status: k })} />
      <FilterBar
        search={values.q} onSearch={q => set({ q })} searchPlaceholder="Search code or description…"
        selects={[{ key: 'vis', label: 'Visibility', value: values.vis, onChange: v => set({ vis: v }), allLabel: 'Public and private', options: [{ value: 'public', label: 'Public' }, { value: 'private', label: 'Private' }] }]}
        showClear={active} onClear={reset}
      />
      <DataTable
        caption="Coupons" rowKey="id" rowHref={c => `/admin/coupons/${c.id}`}
        columns={[
          { key: 'code', header: 'Code', render: c => (
            <span><span className="adm-mono"><strong>{c.code}</strong></span>{c.description && <span className="adm-cell-sub ord-clamp" style={{ display: '-webkit-box' }}>{c.description}</span>}</span>
          ) },
          { key: 'offer', header: 'Offer', className: 'ord-nowrap', render: c => (
            <span>{describeOffer(c)}{Number(c.min_order_value) > 0 && <span className="adm-cell-sub" style={{ display: 'block' }}>Min order ₹{Number(c.min_order_value).toLocaleString('en-IN')}</span>}</span>
          ) },
          { key: 'scope', header: 'Applies to', hideOnMobile: true, render: c => describeScope(c, categoryNames) },
          { key: 'usage', header: 'Used', className: 'ord-nowrap', render: c => (
            <span>{describeUsage(c)}<span className="adm-cell-sub" style={{ display: 'block' }}>{describeLimits(c)}</span></span>
          ) },
          { key: 'valid', header: 'Valid', className: 'ord-nowrap', hideOnMobile: true, render: dates },
          { key: 'vis', header: 'Visibility', hideOnMobile: true, render: c => <span className="adm-chip">{c.is_public ? 'Public' : 'Private'}</span> },
          { key: 'status', header: 'Status', render: c => { const s = couponStatus(c, now); return <StatusPill kind="generic" tone={STATUS_PILL[s].tone} status={s} label={STATUS_PILL[s].label} />; } },
          { key: 'on', header: 'On', render: c => <Toggle checked={c.active} onChange={v => toggleActive(c, v)} label={c.active ? 'On' : 'Off'} /> },
          { key: 'actions', header: '', mobileLabel: '', align: 'right', render: c => (
            <span className="adm-cell-actions">
              <Button size="sm" variant="ghost" iconOnly icon="copy" aria-label={`Duplicate ${c.code}`} title="Duplicate" onClick={() => navigate(`/admin/coupons/new?from=${c.id}`)} />
              <Button size="sm" variant="ghost" iconOnly icon="trash" aria-label={`Delete ${c.code}`} title="Delete" onClick={() => remove(c)} />
            </span>
          ) },
        ]}
        rows={list.rows} loading={list.loading || !ready} error={list.error || (exhausted.error && (values.status === 'active' || values.status === 'exhausted') ? exhausted.error : null)} onRetry={() => { exhausted.reload(); list.reload(); }}
        empty={active
          ? { icon: 'search', title: 'No coupons match your filters', hint: 'Try another status tab or a different search.', action: <Button onClick={reset}>Clear filters</Button> }
          : { icon: 'tag', title: 'No coupons yet', hint: 'Create a discount code to reward customers or run a promotion.', action: <Button variant="primary" icon="plus" to="/admin/coupons/new">Create your first coupon</Button> }}
        footer={<Pagination page={list.page} pageSize={list.pageSize} total={list.count} onPage={list.setPage} />}
      />
    </>
  );
}
