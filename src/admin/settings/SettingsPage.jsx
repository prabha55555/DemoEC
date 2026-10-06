import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { PageHeader, Tabs } from '../ui';
import { AdminNotFound } from '../ErrorPages';
import GeneralSettings from './GeneralSettings';
import MediaSettings from './MediaSettings';
import HelpSettings from './HelpSettings';
import ShippingSettings from './ShippingSettings';
import PaymentsSettings from './PaymentsSettings';
import TaxSettings from './TaxSettings';
import ReturnsSettings from './ReturnsSettings';

// Store settings: one screen per topic, each its own URL (/admin/settings/<tab>) so a tab survives refresh and can
// be linked to. Every form saves to the single `settings` row through BrandContext.updateBrand and warns before
// you leave with unsaved changes.
const TABS = [
  { to: '/admin/settings/general', label: 'General' },
  { to: '/admin/settings/media', label: 'About & media' },
  { to: '/admin/settings/help', label: 'Help Centre' },
  { to: '/admin/settings/shipping', label: 'Shipping & delivery' },
  { to: '/admin/settings/payments', label: 'Payments' },
  { to: '/admin/settings/tax', label: 'Tax & invoice' },
  { to: '/admin/settings/returns', label: 'Returns & stock' },
];

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Store settings" subtitle="Your brand, delivery fees, payments, tax and policies" />
      <Tabs items={TABS} label="Store settings sections" />
      <Routes>
        <Route index element={<Navigate to="general" replace />} />
        <Route path="general" element={<GeneralSettings />} />
        <Route path="media" element={<MediaSettings />} />
        <Route path="help" element={<HelpSettings />} />
        <Route path="shipping" element={<ShippingSettings />} />
        <Route path="payments" element={<PaymentsSettings />} />
        <Route path="tax" element={<TaxSettings />} />
        <Route path="returns" element={<ReturnsSettings />} />
        <Route path="*" element={<AdminNotFound />} />
      </Routes>
    </>
  );
}
