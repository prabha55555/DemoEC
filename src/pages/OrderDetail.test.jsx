import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let mockOrder;
let mockReturns;
jest.mock('../supabase', () => {
  const chain = (table) => {
    const q = {
      select: () => q, eq: () => q, is: () => q, order: () => q,
      maybeSingle: async () => ({ data: mockOrder, error: null }),
      then: (res) => res({ data: table === 'order_returns' ? mockReturns : [], error: null }),
    };
    return q;
  };
  return { supabase: { from: (t) => chain(t), auth: { getSession: async () => ({ data: { session: null } }) } } };
});
jest.mock('../context/AuthContext', () => ({ useAuth: () => ({ currentUser: { id: 'u1' } }) }));
jest.mock('../context/BrandContext', () => ({ useBrand: () => ({ brand: { support_email: 'help@x.in' } }) }));
jest.mock('../context/CartContext', () => ({ useCartActions: () => ({ addVariantToCart: jest.fn() }) }));
jest.mock('../utils/catalogApi', () => ({ fetchVariantsForProducts: jest.fn(async () => []) }));
jest.mock('react-hot-toast', () => { const t = jest.fn(); t.success = jest.fn(); t.error = jest.fn(); return { __esModule: true, default: t }; });

import OrderDetail, { returnedQtyOf } from './OrderDetail';

let container, root;
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const renderAt = async (path = '/account/orders/BL-1') => {
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/account/orders/:orderId" element={<OrderDetail />} /></Routes></MemoryRouter>);
  });
  await flush(); await flush();
};
const base = (over = {}) => ({
  id: '11111111-1111-4111-8111-111111111111', order_id: 'BL-1', status: 'Placed', payment_method: 'razorpay', payment_status: 'paid',
  created_at: '2026-10-01T10:00:00Z', timeline: [{ status: 'Placed', at: '2026-10-01T10:00:00Z' }],
  address: { name: 'Asha', line1: '1 Road', city: 'Chennai', state: 'Tamil Nadu', pincode: '600001', phone: '9876543210' },
  items: [{ id: 'p1', variantId: 'v1', name: 'Kurta', variantLabel: 'M / Red', qty: 1, price: 700, mrp: 900 }],
  subtotal: 700, shipping: 0, cod_fee: 0, discount: 0, gift_card_applied: 0, tax_total: 75, total: 700, refunded_amount: 0, refunds: [],
  ...over,
});

beforeEach(() => { mockReturns = []; });
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); root = null; });

test('an order that is not the customer\'s (no row) shows a not-found state', async () => {
  mockOrder = null;
  await renderAt();
  expect(container.textContent).toMatch(/could not find this order/i);
});

test('a placed order can be cancelled and shows its price breakdown', async () => {
  mockOrder = base();
  await renderAt();
  expect(container.textContent).toContain('Order BL-1');
  expect([...container.querySelectorAll('button')].some(b => /cancel order/i.test(b.textContent))).toBe(true);
  expect(container.textContent).toMatch(/Discount\s*− ₹200/);
  expect(container.textContent).toMatch(/GST included in total\s*₹75/);
  expect(container.querySelector('a[href="/invoice/BL-1"]')).toBeTruthy();
});

test('an order with a gift card cannot be cancelled by the customer and says so', async () => {
  mockOrder = base({ items: [{ id: 'g1', isGiftCard: true, name: 'Gift card', qty: 1, price: 1000, giftCode: 'BL-GC-AAAA-BBBB-CCCC' }, base().items[0]] });
  await renderAt();
  expect([...container.querySelectorAll('button')].some(b => /cancel order/i.test(b.textContent))).toBe(false);
  expect(container.textContent).toMatch(/Orders with a gift card can't be cancelled/);
  expect(container.textContent).toContain('BL-GC-AAAA-BBBB-CCCC');
});

test('a gift-card-only order has no tracker: it is delivered to the email', async () => {
  mockOrder = base({ items: [{ id: 'g1', isGiftCard: true, name: 'Gift card', qty: 1, price: 1000, giftCode: 'BL-GC-AAAA-BBBB-CCCC' }], subtotal: 1000, total: 1000 });
  await renderAt();
  expect(container.textContent).toMatch(/Delivered to your email/);
  expect(container.querySelector('.trk')).toBeNull();
  expect(container.textContent).not.toMatch(/Delivery\s*(Free|₹)/);
});

test('a Cash on Delivery order shows what to pay on delivery', async () => {
  mockOrder = base({ payment_method: 'cod', payment_status: 'cod_pending', cod_fee: 25, total: 725 });
  await renderAt();
  expect(container.textContent).toMatch(/Amount to pay on delivery\s*₹725/);
  expect(container.textContent).toMatch(/Cash on Delivery fee\s*₹25/);
});

test('only refunds that really happened are listed (pending / failed attempts are hidden)', async () => {
  mockOrder = base({
    status: 'Cancelled', payment_status: 'refunded', refunded_amount: 700, cancelled_at: '2026-10-02T10:00:00Z', cancel_reason: 'Ordered by mistake',
    refunds: [
      { id: 'r1', amount: 700, at: '2026-10-02T10:05:00Z', type: 'online', status: 'processed' },
      { id: 'r2', amount: 50, at: '2026-10-02T10:06:00Z', type: 'online', status: 'failed' },
      { id: 'r3', amount: 20, at: '2026-10-02T10:07:00Z', type: 'online', status: 'pending' },
    ],
  });
  await renderAt();
  const items = [...container.querySelectorAll('.od-refunds li')];
  expect(items).toHaveLength(1);
  expect(items[0].textContent).toContain('₹700');
  expect(container.textContent).toMatch(/This order was cancelled/);
});

test('a delivered order inside its return window offers a return, and existing requests are listed', async () => {
  const delivered = new Date(Date.now() - 2 * 86400000).toISOString();
  mockOrder = base({ status: 'Delivered', delivered_at: delivered, timeline: [], items: [{ ...base().items[0], returnWindowDays: 7 }] });
  mockReturns = [{ id: 'aaaaaaaa-0000-4000-8000-000000000000', type: 'return', status: 'Requested', items: [{ variantId: 'other', qty: 1, name: 'Other' }], reason: 'Damaged or defective', refund_amount: 700, created_at: delivered }];
  await renderAt();
  expect([...container.querySelectorAll('button')].some(b => /return \/ replace/i.test(b.textContent))).toBe(true);
  expect(container.textContent).toMatch(/Returns & replacements/);
  expect(container.textContent).toMatch(/Expected refund: ₹700/);
  expect(container.querySelector('a[href="/product/p1#reviews"]')).toBeTruthy();
});

test('returnedQtyOf ignores rejected and closed requests', () => {
  expect(returnedQtyOf([
    { status: 'Requested', items: [{ variantId: 'v1', qty: 1 }] },
    { status: 'Rejected', items: [{ variantId: 'v1', qty: 5 }] },
    { status: 'Closed', items: [{ variantId: 'v2', qty: 2 }] },
    { status: 'Refunded', items: [{ variantId: 'v1', qty: 1 }] },
  ])).toEqual({ v1: 2 });
});
