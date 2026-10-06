import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let mockUser = null;
let mockInsert;
let mockExisting = null;
jest.mock('../context/AuthContext', () => ({ useAuth: () => ({ currentUser: mockUser, userProfile: { name: 'Asha', phone: '9000000000' } }) }));
jest.mock('../supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: mockExisting, error: null }) }) }) }) }),
      insert: (row) => mockInsert(row),
    }),
  },
}));
jest.mock('react-hot-toast', () => { const t = jest.fn(); t.success = jest.fn(); t.error = jest.fn(); return { __esModule: true, default: t }; });

import NotifyWhenAvailable from './NotifyWhenAvailable';

const product = { id: 'p1', name: 'Cotton Kurta Set' };
const variant = { id: 'v1', label: 'M / Maroon' };
let container; let root;
async function render(v = variant) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><NotifyWhenAvailable product={product} variant={v} /></MemoryRouter>); });
}

beforeEach(() => { mockUser = null; mockExisting = null; mockInsert = jest.fn(() => Promise.resolve({ error: null })); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

test('a guest gets a sign-in prompt, not a crash', async () => {
  await render();
  const a = container.querySelector('a');
  expect(a.textContent).toContain('Sign in to get notified');
  expect(a.getAttribute('href')).toBe('/login');
});

test('a signed-in customer subscribes to the specific variant', async () => {
  mockUser = { id: 'u1', email: 'a@b.test' };
  await render();
  await act(async () => { container.querySelector('button').click(); });
  expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u1', product_id: 'p1', variant_id: 'v1', size: 'M / Maroon' }));
  expect(container.textContent).toContain('We will notify you');
});

test('a simple product (label "Default") stores no size text', async () => {
  mockUser = { id: 'u1', email: 'a@b.test' };
  await render({ id: 'v9', label: 'Default' });
  await act(async () => { container.querySelector('button').click(); });
  expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ variant_id: 'v9', size: null }));
});

test('an existing subscription is shown as done (the database is the source of truth)', async () => {
  mockUser = { id: 'u1', email: 'a@b.test' };
  mockExisting = { id: 'n1' };
  await render();
  expect(container.textContent).toContain('We will notify you');
  expect(container.querySelector('button')).toBeNull();
});

test('a duplicate-subscription race is treated as subscribed, not an error', async () => {
  mockUser = { id: 'u1', email: 'a@b.test' };
  mockInsert = jest.fn(() => Promise.resolve({ error: { code: '23505' } }));
  await render();
  await act(async () => { container.querySelector('button').click(); });
  expect(container.textContent).toContain('We will notify you');
});
