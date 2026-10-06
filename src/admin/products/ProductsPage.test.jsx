// The Products list's states: the first-run empty state, the "filters hide everything" state, and rows with their
// price / stock / status cells. Data hooks are mocked; the page, the kit and the router are real.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

global.IS_REACT_ACT_ENVIRONMENT = true;

const mockList = { rows: [], count: 0, loading: false, error: null, page: 1, pageSize: 25, setPage: () => {}, reload: () => {}, setRows: () => {} };

jest.mock('../../supabase', () => {
  const chain = { select: () => chain, order: () => chain, range: () => chain, ilike: () => chain, not: () => chain, limit: () => chain, in: () => chain, eq: () => chain, then: (res) => Promise.resolve({ data: [], count: 0, error: null }).then(res) };
  return { supabase: { from: () => chain, rpc: async () => ({ data: 0, error: null }), storage: { from: () => ({ remove: async () => ({ error: null }) }) } } };
});
jest.mock('../../context/BrandContext', () => ({ useBrand: () => ({ brand: { low_stock_threshold: 5 } }) }));
jest.mock('../hooks/useServerList', () => ({ __esModule: true, default: () => mockList }));

// eslint-disable-next-line import/first
import ProductsPage from './ProductsPage';
// eslint-disable-next-line import/first
import { ConfirmProvider } from '../ui';

let container;
let root;

async function renderAt(url) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[url]}><ConfirmProvider><ProductsPage /></ConfirmProvider></MemoryRouter>);
  });
}
const text = () => container.textContent;
const bodyRows = () => [...container.querySelectorAll('tbody tr')];
const buttonLabelled = (re) => [...container.querySelectorAll('button, a')].find(el => re.test(el.textContent.trim()));

const row = (over) => ({
  id: 'p1', product_number: 'T-1', name: 'Cotton Tee', brand: 'Urban', category_id: null, cat: 'Men', status: 'active', featured: false, images: [],
  price: 499, price_max: 499, mrp: 699, discount_pct: 29, in_stock: true, has_variants: false, total_stock: 12, low_stock_threshold: null,
  rating_avg: 4.2, rating_count: 10, sales_count: 3, created_at: '2026-10-01T00:00:00Z', ...over,
});

beforeEach(() => { Object.assign(mockList, { rows: [], count: 0, loading: false, error: null }); });
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  if (container) container.remove();
  root = null;
});

test('an empty catalogue invites the first product or an import', async () => {
  await renderAt('/admin/products');
  expect(container.querySelector('.adm-empty-title').textContent).toBe('Add your first product');
  expect(buttonLabelled(/^Add your first product$/).getAttribute('href')).toBe('/admin/products/new');
  expect(buttonLabelled(/^Import from CSV$/)).toBeTruthy();
  // no filters or status tabs are offered before there is anything to filter
  expect(container.querySelector('[role=search]')).toBeNull();
  expect(container.querySelector('.adm-tabs')).toBeNull();
});

test('when filters hide everything the message says so and offers to clear them', async () => {
  await renderAt('/admin/products?q=zzz');
  expect(text()).toContain('No products match your filters');
  expect(buttonLabelled(/^Clear filters$/)).toBeTruthy();
  expect(container.querySelector('[role=search]')).toBeTruthy();
});

test('rows show the price range with the MRP struck through, stock, status and a featured toggle', async () => {
  Object.assign(mockList, {
    count: 3,
    rows: [
      row({ id: 'a', name: 'Range Tee', price: 499, price_max: 799, has_variants: true }),
      row({ id: 'b', name: 'Low Mug', total_stock: 3, price: 199, price_max: 199, mrp: null, discount_pct: 0 }),
      row({ id: 'c', name: 'Gone Lamp', in_stock: false, total_stock: 0, status: 'draft', featured: true }),
    ],
  });
  await renderAt('/admin/products');
  const rows = bodyRows();
  expect(rows).toHaveLength(3);
  expect(rows[0].textContent).toContain('Range Tee');
  expect(rows[0].textContent).toMatch(/₹499\s*–\s*₹799/);
  expect(rows[0].textContent).toMatch(/29% off/);
  expect(rows[1].textContent).toMatch(/Low · 3/);
  expect(rows[2].textContent).toMatch(/Out of stock/);
  expect(rows[2].textContent).toMatch(/Draft/);
  expect(rows[2].querySelector('button[aria-pressed]').getAttribute('aria-pressed')).toBe('true');
  expect(rows[0].querySelector('button[aria-pressed]').getAttribute('aria-pressed')).toBe('false');
  // the name links to the editor
  expect(rows[0].querySelector('a[href="/admin/products/a"]')).toBeTruthy();
});

test('a product with no tracked variants reads Unlimited, and one with no variants at all says so', async () => {
  Object.assign(mockList, { count: 2, rows: [row({ id: 'a', name: 'Digital Card', total_stock: 0 }), row({ id: 'b', name: 'Empty Shell', price: null, price_max: null, mrp: null, in_stock: false, total_stock: 0 })] });
  await renderAt('/admin/products');
  const rows = bodyRows();
  expect(rows[0].textContent).toMatch(/Unlimited/);
  expect(rows[1].textContent).toMatch(/No variants/);
});

test('ticking rows reveals the bulk bar with status, feature, export and delete', async () => {
  Object.assign(mockList, { count: 2, rows: [row({ id: 'a', name: 'One' }), row({ id: 'b', name: 'Two' })] });
  await renderAt('/admin/products');
  expect(container.querySelector('.pm-bulk')).toBeNull();
  await act(async () => { bodyRows()[0].querySelector('input[type=checkbox]').click(); });
  const bar = container.querySelector('.pm-bulk');
  expect(bar).toBeTruthy();
  expect(bar.textContent).toContain('1 selected');
  ['Set status', 'Feature', 'Export selection', 'Delete'].forEach(label => expect([...bar.querySelectorAll('button')].some(b => b.textContent.trim() === label)).toBe(true));
});
