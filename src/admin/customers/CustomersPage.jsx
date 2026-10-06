import React, { useEffect, useMemo, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../../supabase';
import { withTimeout } from '../../utils/withTimeout';
import { Button, DataTable, DateTime, FilterBar, Money, PageHeader, Pagination, StatusPill } from '../ui';
import { exportCsv, useUrlFilters } from '../hooks';
import { sanitizeSearch } from '../hooks/serverList';
import { istDateKey } from '../lib/format';
import useLoad, { rowsOf } from '../orders/useLoad';
import CustomerDetail from './CustomerDetail';
import { CUSTOMER_CSV_COLUMNS } from './customerLogic';
import '../orders/orders.css';

const PAGE_SIZE = 25;
const EXPORT_CAP = 10000;

// /admin/customers (list)  and  /admin/customers/:id (one customer). The shell registers this section as customers/*.
export default function CustomersPage() {
  return (
    <Routes>
      <Route index element={<CustomersList />} />
      <Route path=":id" element={<CustomerDetail />} />
    </Routes>
  );
}

// One page of admin_customers(): a SECURITY DEFINER function that joins accounts, profiles and orders (the browser cannot
// read other people's accounts any other way). total_count is on every row, so the page count costs nothing extra.
async function fetchCustomers({ search, limit, offset }) {
  const { data, error } = await withTimeout(supabase.rpc('admin_customers', { p_search: search || null, p_limit: limit, p_offset: offset }), 20000);
  if (error) throw error;
  return data || [];
}

function CustomersList() {
  const { values, set, reset, active } = useUrlFilters({ q: '', page: 1 });
  const [exporting, setExporting] = useState(false);
  const search = sanitizeSearch(values.q);
  const list = useLoad(() => fetchCustomers({ search, limit: PAGE_SIZE, offset: (values.page - 1) * PAGE_SIZE }), [search, values.page], { initial: [] });
  const rows = list.data || [];
  const total = rows.length ? Number(rows[0].total_count) || 0 : 0;

  // A page past the end (a shrunken list): go back to the first page.
  useEffect(() => { if (!list.loading && !list.error && values.page > 1 && rows.length === 0) set({ page: 1 }); }, [list.loading, list.error, values.page, rows.length, set]);

  // Marketing opt-in lives on `profiles` (admins may read them): one small lookup for the rows on screen.
  const ids = rows.map(r => r.id).sort().join(',');
  const opt = useLoad(() => rowsOf(supabase.from('profiles').select('id, marketing_opt_in').in('id', ids.split(','))), [ids], { enabled: !!ids, initial: [] });
  const optById = useMemo(() => Object.fromEntries((opt.data || []).map(p => [p.id, p.marketing_opt_in])), [opt.data]);

  async function exportAll() {
    setExporting(true);
    const id = toast.loading('Preparing the customer list…');
    try {
      const all = [];
      for (let offset = 0; offset < EXPORT_CAP; offset += 500) {
        const page = await fetchCustomers({ search, limit: 500, offset });
        all.push(...page);
        if (page.length < 500) break;
      }
      // Opt-in for everyone, in 1,000-row pages of two narrow columns (not one request per customer).
      const flags = {};
      for (let from = 0; from < EXPORT_CAP; from += 1000) {
        const page = await rowsOf(supabase.from('profiles').select('id, marketing_opt_in').order('id').range(from, from + 999), 20000);
        page.forEach(p => { flags[p.id] = p.marketing_opt_in; });
        if (page.length < 1000) break;
      }
      toast.dismiss(id);
      if (all.length === 0) { toast.error('There are no customers to export.'); return; }
      exportCsv(`customers-${istDateKey()}.csv`, CUSTOMER_CSV_COLUMNS, all.map(c => ({ ...c, marketing_opt_in: flags[c.id] })));
      toast.success(`Exported ${all.length.toLocaleString('en-IN')} customer${all.length === 1 ? '' : 's'}.${all.length >= EXPORT_CAP ? ` Limited to the first ${EXPORT_CAP.toLocaleString('en-IN')}.` : ''}`);
    } catch (e) {
      toast.dismiss(id);
      toast.error(`Could not export: ${e?.message || 'please try again'}`);
    } finally { setExporting(false); }
  }

  return (
    <>
      <PageHeader title="Customers" subtitle="Everyone with an account, with what they have bought"
        actions={<Button icon="download" loading={exporting} onClick={exportAll}>Export CSV</Button>} />
      <FilterBar search={values.q} onSearch={q => set({ q })} searchPlaceholder="Search name, email or phone…" showClear={active} onClear={reset} />
      <DataTable
        caption="Customers" rowKey="id" rowHref={c => `/admin/customers/${c.id}`}
        columns={[
          { key: 'name', header: 'Customer', render: c => <span className="ord-cust">{c.name || 'Unnamed'}<span className="adm-cell-sub">{c.email || '—'}</span></span> },
          { key: 'phone', header: 'Phone', hideOnMobile: true, className: 'ord-nowrap', render: c => c.phone || <span className="adm-muted">—</span> },
          { key: 'orders', header: 'Orders', align: 'right', render: c => Number(c.order_count).toLocaleString('en-IN') },
          { key: 'spent', header: 'Total spent', align: 'right', className: 'ord-nowrap', render: c => <Money value={c.total_spent} /> },
          { key: 'last', header: 'Last order', className: 'ord-nowrap', render: c => (c.last_order_at ? <DateTime value={c.last_order_at} dateOnly /> : <span className="adm-muted">Never</span>) },
          { key: 'joined', header: 'Joined', hideOnMobile: true, className: 'ord-nowrap', render: c => <DateTime value={c.created_at} dateOnly /> },
          { key: 'marketing', header: 'Marketing', hideOnMobile: true, render: c => (c.id in optById
            ? <StatusPill kind="generic" tone={optById[c.id] ? 'success' : 'neutral'} status={optById[c.id] ? 'yes' : 'no'} label={optById[c.id] ? 'Opted in' : 'No'} />
            : <span className="adm-muted">{opt.loading ? '…' : '—'}</span>) },
        ]}
        rows={rows} loading={list.loading} error={list.error} onRetry={list.reload}
        empty={active
          ? { icon: 'search', title: 'No customers match your search', hint: 'Try a different name, email or phone number.', action: <Button onClick={reset}>Clear search</Button> }
          : { icon: 'users', title: 'No customers yet', hint: 'People who create an account when they shop appear here.' }}
        footer={<Pagination page={values.page} pageSize={PAGE_SIZE} total={total} onPage={p => set({ page: p })} />}
      />
    </>
  );
}
