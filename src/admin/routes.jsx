import React, { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AdminNotFound } from './ErrorPages';
import { SkeletonRows } from './ui';

// Every admin screen, lazy-loaded so the shell loads fast and each screen is fetched only when visited. Mounted by
// pages/Admin.jsx under /admin/*, so every path here is relative to /admin.
//
// Screens that own several URLs end in /*: they render their OWN nested <Routes> (relative to their base), so a
// section can add sub-pages (e.g. /admin/customers/:id) without touching this file. navConfig.js lists the labels
// used for breadcrumbs; unknown sub-paths of a /* section still get a "Section › Details" trail.
const Dashboard = lazy(() => import('./dashboard/Dashboard'));
const ProductsPage = lazy(() => import('./products/ProductsPage'));
const ProductEditPage = lazy(() => import('./products/ProductEditPage'));
const CategoriesPage = lazy(() => import('./products/CategoriesPage'));
const InventoryPage = lazy(() => import('./inventory/InventoryPage'));
const OrdersPage = lazy(() => import('./orders/OrdersPage'));
const OrderDetailPage = lazy(() => import('./orders/OrderDetailPage'));
const ReturnsPage = lazy(() => import('./orders/ReturnsPage'));
const CustomersPage = lazy(() => import('./customers/CustomersPage'));
const ReviewsPage = lazy(() => import('./reviews/ReviewsPage'));
const CouponsPage = lazy(() => import('./marketing/CouponsPage'));
const GiftCardsPage = lazy(() => import('./marketing/GiftCardsPage'));
const ReportsPage = lazy(() => import('./reports/ReportsPage'));
const BannersManager = lazy(() => import('./content/BannersManager'));
const BlogManager = lazy(() => import('./content/BlogManager'));
const SettingsPage = lazy(() => import('./settings/SettingsPage'));
const EmailTemplatesPage = lazy(() => import('./messaging/EmailTemplatesPage'));
const WhatsAppTemplatesPage = lazy(() => import('./messaging/WhatsAppTemplatesPage'));
const QueriesPage = lazy(() => import('./messaging/QueriesPage'));
const StockAlertsPage = lazy(() => import('./inventory/StockAlertsPage'));
const EmailTestPage = lazy(() => import('./messaging/EmailTestPage'));

export default function AdminRoutes() {
  return (
    <Suspense fallback={<div className="adm-card"><SkeletonRows rows={6} /></div>}>
      <Routes>
        <Route index element={<Dashboard />} />

        <Route path="products" element={<ProductsPage />} />
        <Route path="products/new" element={<ProductEditPage />} />
        <Route path="products/:id" element={<ProductEditPage />} />
        <Route path="categories/*" element={<CategoriesPage />} />
        <Route path="inventory/*" element={<InventoryPage />} />

        <Route path="orders" element={<OrdersPage />} />
        <Route path="orders/:id" element={<OrderDetailPage />} />
        <Route path="returns/*" element={<ReturnsPage />} />
        <Route path="customers/*" element={<CustomersPage />} />
        <Route path="reviews/*" element={<ReviewsPage />} />
        <Route path="coupons/*" element={<CouponsPage />} />
        <Route path="gift-cards" element={<GiftCardsPage />} />

        <Route path="reports/*" element={<ReportsPage />} />

        <Route path="banners" element={<BannersManager />} />
        <Route path="banners/new" element={<BannersManager />} />
        <Route path="banners/:id" element={<BannersManager />} />
        <Route path="blog" element={<BlogManager />} />
        <Route path="blog/new" element={<BlogManager />} />
        <Route path="blog/:id" element={<BlogManager />} />
        <Route path="settings/*" element={<SettingsPage />} />

        <Route path="templates/email" element={<EmailTemplatesPage />} />
        <Route path="templates/email/new" element={<EmailTemplatesPage />} />
        <Route path="templates/email/:id" element={<EmailTemplatesPage />} />
        <Route path="templates/whatsapp" element={<WhatsAppTemplatesPage />} />
        <Route path="queries" element={<QueriesPage />} />
        <Route path="stock-alerts" element={<StockAlertsPage />} />
        <Route path="email-test" element={<EmailTestPage />} />

        <Route path="*" element={<AdminNotFound />} />
      </Routes>
    </Suspense>
  );
}
