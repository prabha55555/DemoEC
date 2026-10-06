import React, { useMemo } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { Icon, PageHeader, Tabs } from '../ui';
import { useUrlFilters } from '../hooks';
import { DEFAULT_PRESET, PRESETS, describeRange, rangeBounds, rangeFor } from './dateRange';
import { istDateKey } from '../lib/format';
import SalesReport from './SalesReport';
import { CategoriesReport, ProductsReport } from './CatalogReports';
import CouponsReport from './CouponsReport';
import PaymentsReport from './PaymentsReport';
import GstReport from './GstReport.jsx';
import '../orders/orders.css';

const TABS = [
  { path: '', label: 'Sales', title: 'Sales' },
  { path: 'products', label: 'Products', title: 'Products' },
  { path: 'categories', label: 'Categories', title: 'Categories' },
  { path: 'coupons', label: 'Coupons', title: 'Coupons' },
  { path: 'payments', label: 'Payments', title: 'Payments' },
  { path: 'gst', label: 'GST summary', title: 'GST summary' },
];

// /admin/reports/* -- the date range lives in the URL (?range=30d, or ?range=custom&from=…&to=…) and is kept when you switch
// tabs. Every day and every "today" is India time. Reports leave Cancelled orders out and show refunds as their own figure.
export default function ReportsPage() {
  const { pathname, search } = useLocation();
  const { values, set } = useUrlFilters({ range: DEFAULT_PRESET, from: '', to: '' });
  const preset = PRESETS.some(p => p.key === values.range) ? values.range : DEFAULT_PRESET;
  const range = useMemo(() => rangeFor(preset, new Date(), { from: values.from, to: values.to }), [preset, values.from, values.to]);
  const bounds = useMemo(() => rangeBounds(range), [range]);
  const today = istDateKey();

  const current = TABS.find(t => t.path && pathname.replace(/\/+$/, '').endsWith(`/reports/${t.path}`)) || TABS[0];
  const tabs = TABS.map(t => ({ to: `/admin/reports${t.path ? `/${t.path}` : ''}${search}`, label: t.label, end: true }));

  return (
    <>
      <PageHeader title="Reports" subtitle="Sales, products, coupons, payments and GST for any date range"
        breadcrumb={[{ label: 'Dashboard', to: '/admin' }, { label: 'Reports', to: '/admin/reports' }, { label: current.title }]} />

      <div className="rep-range">
        <div className="adm-seg" role="group" aria-label="Date range">
          {PRESETS.map(p => (
            <button key={p.key} type="button" aria-pressed={preset === p.key}
              onClick={() => (p.key === 'custom' ? set({ range: 'custom', from: values.from || range.from, to: values.to || range.to }) : set({ range: p.key, from: '', to: '' }))}>{p.label}</button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="adm-fb-dates" role="group" aria-label="Custom dates">
            <input type="date" value={range.from} max={range.to || today} aria-label="From date" onChange={e => set({ range: 'custom', from: e.target.value, to: range.to })} />
            <span aria-hidden="true">to</span>
            <input type="date" value={range.to} min={range.from} max={today} aria-label="To date" onChange={e => set({ range: 'custom', from: range.from, to: e.target.value })} />
          </div>
        )}
        <span className="rep-range-text"><Icon name="calendar" size={15} /> {describeRange(range)} <span className="adm-muted">· India time</span></span>
      </div>
      {preset === 'custom' && range.note && <div className="adm-note warning" role="status" style={{ marginBottom: 12 }}>{range.note}</div>}

      <Tabs label="Reports" items={tabs} />

      <Routes>
        <Route index element={<SalesReport range={range} bounds={bounds} />} />
        <Route path="products" element={<ProductsReport range={range} bounds={bounds} />} />
        <Route path="categories" element={<CategoriesReport range={range} bounds={bounds} />} />
        <Route path="coupons" element={<CouponsReport range={range} bounds={bounds} />} />
        <Route path="payments" element={<PaymentsReport range={range} bounds={bounds} />} />
        <Route path="gst" element={<GstReport range={range} bounds={bounds} />} />
        <Route path="*" element={<SalesReport range={range} bounds={bounds} />} />
      </Routes>
    </>
  );
}
