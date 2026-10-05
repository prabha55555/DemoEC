import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockLoginMobile = jest.fn();
const mockLoginEmail = jest.fn();
jest.mock('../context/AuthContext', () => ({
  useAuth: () => ({ loginWithEmail: mockLoginEmail, loginWithMobileToken: mockLoginMobile, loginWithGoogle: jest.fn(), resetPassword: jest.fn() }),
}));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { success: jest.fn(), error: jest.fn() } }));
const mockOpen = jest.fn();
const mockCancel = jest.fn();
jest.mock('../utils/msg91Widget', () => ({
  msg91Configured: () => true,
  openMsg91Widget: (...a) => mockOpen(...a),
  cancelMsg91Session: () => mockCancel(),
  msg91WidgetOpen: () => false,
}));

import Login from './Login';

let container, root;
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const renderLogin = async () => {
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter initialEntries={['/login']}><Login /></MemoryRouter>); });
};
const byText = (sel, re) => [...container.querySelectorAll(sel)].find(e => re.test(e.textContent || e.getAttribute('aria-label') || ''));
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await flush(); };
const type = async (el, value) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => { jest.clearAllMocks(); global.fetch = jest.fn(); });
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); root = null; });

test('renders both options with the existing email form, register link and forgot-password intact', async () => {
  await renderLogin();
  expect(byText('[role=tab]', /^email$/i)).toBeTruthy();
  expect(byText('[role=tab]', /mobile number/i)).toBeTruthy();
  expect(container.querySelector('#login-email')).toBeTruthy();
  expect(container.querySelector('#login-password')).toBeTruthy();
  expect(byText('button', /sign in/i)).toBeTruthy();
  expect(container.querySelector('a[href="/register"]')).toBeTruthy();
  expect(byText('button', /forgot password/i)).toBeTruthy();
});

test('email login still calls the existing loginWithEmail', async () => {
  mockLoginEmail.mockResolvedValue({});
  await renderLogin();
  await type(container.querySelector('#login-email'), 'a@b.co');
  await type(container.querySelector('#login-password'), 'pw123456');
  await click(container.querySelector('button[type=submit]'));
  expect(mockLoginEmail).toHaveBeenCalledWith('a@b.co', 'pw123456');
});

test('mobile tab opens the MSG91 widget only on tap, not on mount', async () => {
  await renderLogin();
  expect(mockOpen).not.toHaveBeenCalled();
  await click(byText('[role=tab]', /mobile number/i));
  expect(mockOpen).not.toHaveBeenCalled();
  await click(byText('button', /continue with mobile/i));
  expect(mockOpen).toHaveBeenCalledTimes(1);
});

test('a verified token is exchanged server-side, then completes the Supabase session', async () => {
  mockOpen.mockImplementation(async ({ onToken }) => { onToken('widget-access-token-value-123'); return true; });
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ tokenHash: 'th_1' }) });
  await renderLogin();
  await click(byText('[role=tab]', /mobile number/i));
  await click(byText('button', /continue with mobile/i));
  expect(mockLoginMobile).toHaveBeenCalledWith('th_1');
  const [url, opts] = global.fetch.mock.calls[0];
  expect(url).toBe('/api/msg91-login');
  expect(JSON.parse(opts.body)).toEqual({ accessToken: 'widget-access-token-value-123' });
});

test('server rejection shows a message and never creates a session', async () => {
  mockOpen.mockImplementation(async ({ onToken }) => { onToken('widget-access-token-value-123'); return true; });
  global.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'Could not verify your mobile number. Please try again.' }) });
  await renderLogin();
  await click(byText('[role=tab]', /mobile number/i));
  await click(byText('button', /continue with mobile/i));
  expect(container.querySelector('[role=alert]').textContent).toMatch(/could not verify your mobile number/i);
  expect(mockLoginMobile).not.toHaveBeenCalled();
});

test('widget failure is shown to the customer', async () => {
  mockOpen.mockImplementation(async ({ onError }) => { onError('script_failed'); return false; });
  await renderLogin();
  await click(byText('[role=tab]', /mobile number/i));
  await click(byText('button', /continue with mobile/i));
  expect(container.querySelector('[role=alert]').textContent).toMatch(/could not load mobile verification/i);
});

const conflictResponse = { ok: false, status: 409, json: async () => ({ code: 'ACCOUNT_EXISTS', error: 'This mobile number is already linked to an account.', hints: ['a•••••@gmail.com'], continueToken: 'ct-token' }) };
async function reachConflict() {
  mockOpen.mockImplementation(async ({ onToken }) => { onToken('widget-access-token-value-123'); return true; });
  global.fetch.mockResolvedValueOnce(conflictResponse);
  await renderLogin();
  await click(byText('[role=tab]', /mobile number/i));
  await click(byText('button', /continue with mobile/i));
}

test('number already linked to an account: shows the masked email and options, creates no session', async () => {
  await reachConflict();
  expect(container.textContent).toMatch(/already linked to an account/i);
  expect(container.textContent).toContain('a•••••@gmail.com');
  expect(byText('button', /sign in with email/i)).toBeTruthy();
  expect(byText('button', /email me a reset link/i)).toBeTruthy();
  expect(byText('button', /not my account/i)).toBeTruthy();
  expect(mockLoginMobile).not.toHaveBeenCalled();
});

test('conflict: "Sign in with email" returns to the email form', async () => {
  await reachConflict();
  await click(byText('button', /sign in with email/i));
  expect(container.querySelector('#login-email')).toBeTruthy();
  expect(container.textContent).not.toMatch(/already linked to an account/i);
});

test('conflict: reset link is requested with the server-issued token only', async () => {
  await reachConflict();
  global.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
  await click(byText('button', /email me a reset link/i));
  const [, opts] = global.fetch.mock.calls[1];
  expect(JSON.parse(opts.body)).toEqual({ action: 'email-reset', continueToken: 'ct-token' });
  expect(container.textContent).toMatch(/sent a password reset link/i);
  expect(mockLoginMobile).not.toHaveBeenCalled();
});

test('conflict: "not my account" continues with the number and completes a normal session', async () => {
  await reachConflict();
  global.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ tokenHash: 'th_new' }) });
  await click(byText('button', /not my account/i));
  const [, opts] = global.fetch.mock.calls[1];
  expect(JSON.parse(opts.body)).toEqual({ action: 'continue', continueToken: 'ct-token' });
  expect(mockLoginMobile).toHaveBeenCalledWith('th_new');
});

test('unconfirmed-email account: the server message is shown and no session is created', async () => {
  mockOpen.mockImplementation(async ({ onToken }) => { onToken('widget-access-token-value-123'); return true; });
  global.fetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: 'EMAIL_UNCONFIRMED', error: 'Please confirm your email address first, then sign in with your mobile number.' }) });
  await renderLogin();
  await click(byText('[role=tab]', /mobile number/i));
  await click(byText('button', /continue with mobile/i));
  expect(container.querySelector('[role=alert]').textContent).toMatch(/confirm your email/i);
  expect(mockLoginMobile).not.toHaveBeenCalled();
});

test('leaving the page cancels the widget session', async () => {
  await renderLogin();
  await act(async () => root.unmount()); root = null;
  expect(mockCancel).toHaveBeenCalled();
});
