import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import Admin from './Admin';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabase';
import { resetServerAdminCheck } from '../admin/useServerAdminCheck';

window.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('../admin/AdminLayout', () => ({ __esModule: true, default: ({ children }) => <div data-testid="layout">{children}</div> }));
jest.mock('../admin/routes', () => ({ __esModule: true, default: () => <div>admin routes</div> }));
jest.mock('../components/BufferingLogo', () => ({ __esModule: true, default: () => <div>loading</div> }));
jest.mock('../styles/admin.css', () => ({}));

let root; let container;
async function renderAdmin() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin/login" element={<div>login page</div>} />
          <Route path="/admin/*" element={<Admin />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  await act(async () => { await new Promise(r => setTimeout(r, 5)); });
  return container;
}

beforeEach(() => { resetServerAdminCheck(); supabase.rpc.mockReset(); });
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  root = null;
});

const user = { id: 'u1', email: 'admin@example.test' };

test('a signed-out visitor is sent to the admin login and never asks the database anything', async () => {
  useAuth.mockReturnValue({ currentUser: null, isAdmin: false });
  const c = await renderAdmin();
  expect(c.textContent).toContain('login page');
  expect(supabase.rpc).not.toHaveBeenCalled();
});

test('a signed-in customer sees the access-denied screen, not the admin', async () => {
  useAuth.mockReturnValue({ currentUser: { id: 'c1', email: 'shopper@example.test' }, isAdmin: false, logout: jest.fn() });
  const c = await renderAdmin();
  expect(c.textContent).toContain('Admin access only');
  expect(c.querySelector('[data-testid=layout]')).toBeNull();
  expect(supabase.rpc).not.toHaveBeenCalled();
});

test('the admin whose login the database accepts gets the admin', async () => {
  useAuth.mockReturnValue({ currentUser: user, isAdmin: true, logout: jest.fn() });
  supabase.rpc.mockResolvedValue({ data: true, error: null });
  const c = await renderAdmin();
  expect(supabase.rpc).toHaveBeenCalledWith('is_admin');
  expect(c.querySelector('[data-testid=layout]')).not.toBeNull();
  expect(c.textContent).toContain('admin routes');
});

test('the admin address with a session the database does NOT recognise is told to sign in again (instead of empty lists)', async () => {
  useAuth.mockReturnValue({ currentUser: user, isAdmin: true, logout: jest.fn() });
  supabase.rpc.mockResolvedValue({ data: false, error: null });
  const c = await renderAdmin();
  expect(c.textContent).toContain('Please sign in again');
  expect(c.textContent).toContain('admin@example.test');
  expect(c.querySelector('[data-testid=layout]')).toBeNull();
});

test('if the check itself cannot be made, the admin is not blocked (screens still report their own errors)', async () => {
  useAuth.mockReturnValue({ currentUser: user, isAdmin: true, logout: jest.fn() });
  supabase.rpc.mockResolvedValue({ data: null, error: { message: 'function is_admin() does not exist' } });
  const c = await renderAdmin();
  expect(c.querySelector('[data-testid=layout]')).not.toBeNull();
});

test('a confirmed login is not re-checked on the next mount', async () => {
  useAuth.mockReturnValue({ currentUser: user, isAdmin: true, logout: jest.fn() });
  supabase.rpc.mockResolvedValue({ data: true, error: null });
  await renderAdmin();
  await act(async () => root.unmount());
  container.remove();
  await renderAdmin();
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
});
