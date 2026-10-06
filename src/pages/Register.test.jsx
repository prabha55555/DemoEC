import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockRegister = jest.fn();
const mockGoogle = jest.fn();
jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({ registerWithEmail: mockRegister, loginWithGoogle: mockGoogle }),
}));
jest.mock('../supabase', () => ({ supabase: { auth: { resend: jest.fn(async () => ({ error: null })) } } }));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));

import Register from './Register';
import toast from 'react-hot-toast';

let container, root;
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const render = async (entry = { pathname: '/register', state: { from: { pathname: '/checkout', search: '?x=1' } } }) => {
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter initialEntries={[entry]}><Register /></MemoryRouter>); });
};
const type = async (id, value) => {
  const el = container.querySelector(id);
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const fillAndSubmit = async () => {
  await type('#register-name', 'Asha Rao');
  await type('#register-email', 'asha@example.com');
  await type('#register-phone', '9876543210');
  await type('#register-password', 'longenough1');
  await type('#register-confirm', 'longenough1');
  await act(async () => { container.querySelector('input[type=checkbox]').click(); });
  await act(async () => { container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await flush();
};

beforeEach(() => { jest.clearAllMocks(); });
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); root = null; });

test('when email confirmation is required (no session) the customer is told to check their inbox, not welcomed', async () => {
  mockRegister.mockResolvedValue({ user: { id: 'u1' }, session: null });
  await render();
  await fillAndSubmit();
  expect(mockRegister).toHaveBeenCalledWith('Asha Rao', 'asha@example.com', 'longenough1', '9876543210', false);
  expect(container.textContent).toMatch(/check your email/i);
  expect(container.textContent).toContain('asha@example.com');
  expect(toast.success).not.toHaveBeenCalled();
  expect(container.querySelector('a[href="/login"]')).toBeTruthy();
});

test('with an immediate session the customer is welcomed', async () => {
  mockRegister.mockResolvedValue({ user: { id: 'u1' }, session: { access_token: 't' } });
  await render();
  await fillAndSubmit();
  expect(toast.success).toHaveBeenCalledWith('Welcome, Asha Rao!');
  expect(container.textContent).not.toMatch(/check your email/i);
});

test('Google sign-up carries the page the customer came from', async () => {
  await render();
  await type('#register-name', 'x');
  await act(async () => { container.querySelector('input[type=checkbox]').click(); });
  const google = [...container.querySelectorAll('button')].find(b => /continue with google/i.test(b.textContent));
  await act(async () => { google.click(); });
  expect(mockGoogle).toHaveBeenCalledWith('/checkout?x=1');
});
