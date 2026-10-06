// The admin's navigation and route labels, in one place: the sidebar renders NAV_GROUPS, and PageHeader's
// breadcrumb trail is derived from ROUTE_DEFS. Pure data -- no React -- so it can be imported anywhere.
import { matchPath } from 'react-router-dom';

// countKey names a figure from useAdminCounts() shown as a badge on the item.
export const NAV_GROUPS = [
  { label: 'Overview', items: [
    { to: '/admin', label: 'Dashboard', icon: 'dashboard', end: true },
  ] },
  { label: 'Catalogue', items: [
    { to: '/admin/products', label: 'Products', icon: 'box' },
    { to: '/admin/categories', label: 'Categories', icon: 'folder' },
    { to: '/admin/inventory', label: 'Inventory', icon: 'layers', countKey: 'lowStock' },
  ] },
  { label: 'Sales', items: [
    { to: '/admin/orders', label: 'Orders', icon: 'cart', countKey: 'ordersAwaiting' },
    { to: '/admin/returns', label: 'Returns', icon: 'undo', countKey: 'returnsToReview' },
    { to: '/admin/customers', label: 'Customers', icon: 'users' },
    { to: '/admin/reviews', label: 'Reviews', icon: 'star', countKey: 'reviewsToModerate' },
    { to: '/admin/coupons', label: 'Coupons', icon: 'tag' },
    { to: '/admin/gift-cards', label: 'Gift cards', icon: 'gift' },
  ] },
  { label: 'Reports', items: [
    { to: '/admin/reports', label: 'Reports', icon: 'barChart' },
  ] },
  { label: 'Storefront', items: [
    { to: '/admin/banners', label: 'Banners', icon: 'image' },
    { to: '/admin/blog', label: 'Blog posts', icon: 'doc' },
    { to: '/admin/settings', label: 'Store settings', icon: 'cog' },
  ] },
  { label: 'Messaging', items: [
    { to: '/admin/templates/email', label: 'Email templates', icon: 'mail' },
    { to: '/admin/templates/whatsapp', label: 'WhatsApp templates', icon: 'wa' },
    { to: '/admin/queries', label: 'Customer queries', icon: 'chat', countKey: 'newQueries' },
    { to: '/admin/stock-alerts', label: 'Stock alerts', icon: 'bell' },
    { to: '/admin/email-test', label: 'Email test', icon: 'send' },
  ] },
];

// `parent` links a detail route back to its list for the breadcrumb. Order matters: a static segment
// ('new') must come before the ':id' sibling so it wins. `prefix: true` also matches anything below it
// (sections that render their own nested routes).
export const ROUTE_DEFS = [
  { path: '/admin', label: 'Dashboard', exact: true },
  { path: '/admin/products', label: 'Products', group: 'Catalogue', exact: true },
  { path: '/admin/products/new', label: 'New product', parent: '/admin/products' },
  { path: '/admin/products/:id', label: 'Edit product', parent: '/admin/products' },
  { path: '/admin/categories', label: 'Categories', group: 'Catalogue', prefix: true },
  { path: '/admin/inventory', label: 'Inventory', group: 'Catalogue', prefix: true },
  { path: '/admin/orders', label: 'Orders', group: 'Sales', exact: true },
  { path: '/admin/orders/:id', label: 'Order', parent: '/admin/orders' },
  { path: '/admin/returns', label: 'Returns', group: 'Sales', prefix: true },
  { path: '/admin/customers', label: 'Customers', group: 'Sales', prefix: true },
  { path: '/admin/reviews', label: 'Reviews', group: 'Sales', prefix: true },
  { path: '/admin/coupons', label: 'Coupons', group: 'Sales', prefix: true },
  { path: '/admin/gift-cards', label: 'Gift cards', group: 'Sales', exact: true },
  { path: '/admin/reports', label: 'Reports', group: 'Reports', prefix: true },
  { path: '/admin/banners', label: 'Banners', group: 'Storefront', exact: true },
  { path: '/admin/banners/new', label: 'New banner', parent: '/admin/banners' },
  { path: '/admin/banners/:id', label: 'Edit banner', parent: '/admin/banners' },
  { path: '/admin/blog', label: 'Blog posts', group: 'Storefront', exact: true },
  { path: '/admin/blog/new', label: 'New post', parent: '/admin/blog' },
  { path: '/admin/blog/:id', label: 'Edit post', parent: '/admin/blog' },
  { path: '/admin/settings', label: 'Store settings', group: 'Storefront', exact: true },
  { path: '/admin/settings/general', label: 'General', parent: '/admin/settings' },
  { path: '/admin/settings/media', label: 'About & media', parent: '/admin/settings' },
  { path: '/admin/settings/help', label: 'Help Centre', parent: '/admin/settings' },
  { path: '/admin/settings/shipping', label: 'Shipping & delivery', parent: '/admin/settings' },
  { path: '/admin/settings/payments', label: 'Payments', parent: '/admin/settings' },
  { path: '/admin/settings/tax', label: 'Tax & invoice', parent: '/admin/settings' },
  { path: '/admin/settings/returns', label: 'Returns & stock', parent: '/admin/settings' },
  { path: '/admin/templates/email', label: 'Email templates', group: 'Messaging', exact: true },
  { path: '/admin/templates/email/new', label: 'New template', parent: '/admin/templates/email' },
  { path: '/admin/templates/email/:id', label: 'Edit template', parent: '/admin/templates/email' },
  { path: '/admin/templates/whatsapp', label: 'WhatsApp templates', group: 'Messaging', exact: true },
  { path: '/admin/queries', label: 'Customer queries', group: 'Messaging', exact: true },
  { path: '/admin/stock-alerts', label: 'Stock alerts', group: 'Messaging', exact: true },
  { path: '/admin/email-test', label: 'Email test', group: 'Messaging', exact: true },
];

function findDef(pathname) {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const exact = ROUTE_DEFS.find(d => matchPath({ path: d.path, end: true }, clean));
  if (exact) return { def: exact, extra: null };
  // Nothing exact: the longest sectional prefix, so /admin/customers/abc still resolves to Customers.
  const prefixed = ROUTE_DEFS.filter(d => d.prefix && matchPath({ path: d.path, end: false }, clean))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return prefixed ? { def: prefixed, extra: 'Details' } : { def: null, extra: null };
}

// Breadcrumb trail for a pathname: [{ label, to? }] -- the last item is the current page and has no `to`.
// `currentLabel` replaces the last label (e.g. a product's own name instead of "Edit product").
export function crumbsFor(pathname, currentLabel) {
  const { def, extra } = findDef(pathname);
  if (!def || pathname === '/admin' || pathname === '/admin/') return [];
  const byPath = (path) => ROUTE_DEFS.find(d => d.path === path);
  const chain = [];
  for (let cur = def; cur; cur = cur.parent ? byPath(cur.parent) : null) chain.unshift(cur);
  const trail = [{ label: 'Dashboard', to: '/admin' }];
  const root = chain[0];
  if (root.group) trail.push({ label: root.group });
  chain.forEach((d, i) => {
    const last = i === chain.length - 1 && !extra;
    trail.push({ label: last && currentLabel ? currentLabel : d.label, ...(last ? {} : { to: d.path }) });
  });
  if (extra) trail.push({ label: currentLabel || extra });
  return trail;
}

// The page's own name for the document title when a screen has not set one.
export function titleFor(pathname) {
  const { def } = findDef(pathname);
  return def ? def.label : 'Page not found';
}
