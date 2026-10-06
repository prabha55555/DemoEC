import { crumbsFor, NAV_GROUPS, ROUTE_DEFS, titleFor } from './navConfig';

describe('breadcrumbs', () => {
  test('the dashboard has none', () => {
    expect(crumbsFor('/admin')).toEqual([]);
    expect(crumbsFor('/admin/')).toEqual([]);
  });
  test('a list page: Dashboard > group > page', () => {
    expect(crumbsFor('/admin/orders')).toEqual([{ label: 'Dashboard', to: '/admin' }, { label: 'Sales' }, { label: 'Orders' }]);
  });
  test('a detail page links back to its list, and the last crumb can be renamed', () => {
    expect(crumbsFor('/admin/orders/BL-20001')).toEqual([{ label: 'Dashboard', to: '/admin' }, { label: 'Sales' }, { label: 'Orders', to: '/admin/orders' }, { label: 'Order' }]);
    expect(crumbsFor('/admin/orders/BL-20001', 'BL-20001').pop()).toEqual({ label: 'BL-20001' });
  });
  test('"new" wins over ":id"', () => {
    expect(crumbsFor('/admin/products/new').pop()).toEqual({ label: 'New product' });
    expect(crumbsFor('/admin/products/abc-123').pop()).toEqual({ label: 'Edit product' });
  });
  test('settings tabs sit under Store settings', () => {
    const t = crumbsFor('/admin/settings/shipping');
    expect(t.map(c => c.label)).toEqual(['Dashboard', 'Storefront', 'Store settings', 'Shipping & delivery']);
    expect(t[2].to).toBe('/admin/settings');
  });
  test('unknown sub-paths of a sectional route still resolve to the section', () => {
    expect(crumbsFor('/admin/customers/abc').map(c => c.label)).toEqual(['Dashboard', 'Sales', 'Customers', 'Details']);
    expect(crumbsFor('/admin/customers/abc', 'Asha K').pop()).toEqual({ label: 'Asha K' });
  });
  test('a path that matches nothing has no trail', () => {
    expect(crumbsFor('/admin/nope')).toEqual([]);
    expect(titleFor('/admin/nope')).toBe('Page not found');
    expect(titleFor('/admin/orders')).toBe('Orders');
  });
});

test('every sidebar link points at a known route', () => {
  const paths = ROUTE_DEFS.map(d => d.path);
  for (const g of NAV_GROUPS) for (const it of g.items) expect(paths).toContain(it.to);
});
