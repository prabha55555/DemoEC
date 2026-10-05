import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let mockAuth;
jest.mock('../supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) },
    from: () => ({ update: () => ({ eq: async () => ({}) }) }),
  },
}));
jest.mock('../context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../context/CartContext', () => ({
  useCart: () => ({ cart: [{ id: 'p1', name: 'Bowl', price: 500, qty: 1, stock: 5, cat: 'Home' }], cartSubtotal: 500, clearCart: jest.fn() }),
}));
jest.mock('../context/BrandContext', () => ({ useBrand: () => ({ brand: {} }) }));
jest.mock('../utils/indianAddress', () => ({ INDIAN_STATES: ['Maharashtra', 'Kerala'], lookupPincode: jest.fn(async () => null), isPincodeConfirmedInvalid: jest.fn(async () => false) }));
jest.mock('react-hot-toast', () => {
  const t = jest.fn(); t.success = jest.fn(); t.error = jest.fn();
  return { __esModule: true, default: t };
});

import Checkout from './Checkout';
import { lookupPincode, isPincodeConfirmedInvalid } from '../utils/indianAddress';
import toast from 'react-hot-toast';

const PLACEHOLDER = 'p919876543210@phone.brightlightsolutions.invalid';
const SAVED = [{ name: 'Saved Name', phone: '9876543210', line1: '1 Road', line2: '', city: 'Pune', state: 'Maharashtra', pincode: '411001' }];

const mobileUser = { id: 'm1', email: PLACEHOLDER, app_metadata: { msg91_phone: '919876543210' } };
const normalUser = { id: 'u1', email: 'normal@customer.in', app_metadata: {} };

let container;
let root;
let createOrderCalls;
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

async function renderCheckout({ user, profile = null }) {
  mockAuth = { currentUser: user, userProfile: profile, refreshProfile: jest.fn() };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter initialEntries={['/checkout']}><Checkout /></MemoryRouter>); });
}
const setValue = async (el, value) => {
  await act(async () => {
    const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  });
};
const submit = async () => {
  const btn = [...container.querySelectorAll('button')].find(b => /proceed to payment/i.test(b.textContent));
  await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await flush();
  await flush();
};
const fillNewAddress = async (email) => {
  await setValue(container.querySelector('#ship-name'), 'Asha Rao');
  await setValue(container.querySelector('#ship-phone'), '9876543210');
  if (email !== undefined) await setValue(container.querySelector('#ship-email'), email);
  await setValue(container.querySelector('#ship-line1'), '12 Main Road');
  await setValue(container.querySelector('#ship-city'), 'Pune');
  await setValue(container.querySelector('#ship-state'), 'Maharashtra');
  await setValue(container.querySelector('#ship-pincode'), '411001');
};
const sentBody = () => JSON.parse(createOrderCalls[0][1].body);
const sentHeaders = () => createOrderCalls[0][1].headers;

beforeEach(() => {
  createOrderCalls = [];
  lookupPincode.mockResolvedValue(null); // CRA resets mock implementations between tests
  isPincodeConfirmedInvalid.mockResolvedValue(false);
  Object.defineProperty(globalThis, 'crypto', { value: { randomUUID: () => 'attempt-key-1' }, configurable: true });
  global.fetch = jest.fn(async (url, opts) => {
    if (String(url).includes('/api/razorpay-create-order')) {
      createOrderCalls.push([url, opts]);
      return { ok: false, json: async () => ({ error: 'stop here' }) };
    }
    return { ok: false, json: async () => ({}) };
  });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  if (container) container.remove();
  root = null;
  jest.clearAllMocks();
});

test('mobile-OTP + new address + valid email: the typed email is what checkout sends', async () => {
  await renderCheckout({ user: mobileUser });
  expect(container.querySelector('#ship-email').value).toBe(''); // the placeholder is never prefilled
  await fillNewAddress('asha@example.com');
  await submit();
  expect(createOrderCalls.length).toBe(1);
  expect(sentBody().userEmail).toBe('asha@example.com');
  expect(sentHeaders().Authorization).toBe('Bearer test-token'); // identity still rides on the bearer token
});

test('mobile-OTP + saved address: the email field is still shown and its value is submitted', async () => {
  await renderCheckout({ user: mobileUser, profile: { name: 'A', phone: '9876543210', addresses: SAVED } });
  const field = container.querySelector('#ship-email');
  expect(field).toBeTruthy();
  expect(container.querySelector('#ship-name')).toBeNull(); // saved-address view: new-address grid hidden
  await setValue(field, 'asha@example.com');
  await submit();
  expect(createOrderCalls.length).toBe(1);
  expect(sentBody().userEmail).toBe('asha@example.com');
  expect(sentBody().addr.line1).toBe('1 Road');
});

test('mobile-OTP + saved address + missing email: blocked with a message, nothing sent', async () => {
  await renderCheckout({ user: mobileUser, profile: { addresses: SAVED } });
  await submit();
  expect(createOrderCalls.length).toBe(0);
  expect(container.textContent).toMatch(/required/i);
});

test('mobile-OTP + saved address + invalid email: blocked, nothing sent', async () => {
  await renderCheckout({ user: mobileUser, profile: { addresses: SAVED } });
  await setValue(container.querySelector('#ship-email'), 'not-an-email');
  await submit();
  expect(createOrderCalls.length).toBe(0);
  expect(container.textContent).toMatch(/valid email/i);
});

test('mobile-OTP + new address + invalid email: blocked, nothing sent', async () => {
  await renderCheckout({ user: mobileUser });
  await fillNewAddress('nope');
  await submit();
  expect(createOrderCalls.length).toBe(0);
  expect(container.textContent).toMatch(/valid email/i);
});

test('the placeholder address can never be submitted as the contact email (saved address)', async () => {
  await renderCheckout({ user: mobileUser, profile: { addresses: SAVED } });
  await setValue(container.querySelector('#ship-email'), PLACEHOLDER);
  await submit();
  expect(createOrderCalls.length).toBe(0);
  expect(container.textContent).toMatch(/valid email/i);
});

test('the placeholder address can never be submitted as the contact email (new address)', async () => {
  await renderCheckout({ user: mobileUser });
  await fillNewAddress(PLACEHOLDER);
  await submit();
  expect(createOrderCalls.length).toBe(0);
});

test('detection also works from the placeholder address alone (no marker present)', async () => {
  await renderCheckout({ user: { id: 'm2', email: PLACEHOLDER, app_metadata: {} }, profile: { addresses: SAVED } });
  expect(container.querySelector('#ship-email')).toBeTruthy();
});

test('normal email/password customer + new address: unchanged (account email is sent, field prefilled)', async () => {
  await renderCheckout({ user: normalUser });
  expect(container.querySelector('#ship-email').value).toBe('normal@customer.in');
  await fillNewAddress('typed-other@example.com');
  await submit();
  expect(createOrderCalls.length).toBe(1);
  expect(sentBody().userEmail).toBe('normal@customer.in');
});

test('normal customer + saved address: unchanged (no extra email field, account email sent)', async () => {
  await renderCheckout({ user: normalUser, profile: { addresses: SAVED } });
  expect(container.querySelector('#ship-email')).toBeNull();
  await submit();
  expect(createOrderCalls.length).toBe(1);
  expect(sentBody().userEmail).toBe('normal@customer.in');
});

test('guest checkout: unchanged (typed email sent, no Authorization header)', async () => {
  await renderCheckout({ user: null });
  await fillNewAddress('guest@example.com');
  await submit();
  expect(createOrderCalls.length).toBe(1);
  expect(sentBody().userEmail).toBe('guest@example.com');
  expect(sentHeaders().Authorization).toBeUndefined();
});

test('India-only: a pincode India Post confirms does not exist blocks checkout with the expected message, no order created', async () => {
  isPincodeConfirmedInvalid.mockResolvedValue(true);
  await renderCheckout({ user: null });
  await fillNewAddress('guest@example.com');
  await submit();
  expect(createOrderCalls.length).toBe(0);
  expect(toast.error).toHaveBeenCalledWith('Unable to purchase -- we currently ship within India only. For international orders, please contact us on WhatsApp.');
});

test('India-only: the check also runs for a saved address, not just a freshly typed one', async () => {
  isPincodeConfirmedInvalid.mockResolvedValue(true);
  await renderCheckout({ user: normalUser, profile: { addresses: SAVED } });
  await submit();
  expect(createOrderCalls.length).toBe(0);
  expect(toast.error).toHaveBeenCalledWith('Unable to purchase -- we currently ship within India only. For international orders, please contact us on WhatsApp.');
});

test('India-only: a network hiccup/unrecognized response (not a confirmed rejection) never blocks checkout', async () => {
  isPincodeConfirmedInvalid.mockResolvedValue(false); // lookupPincode/isPincodeConfirmedInvalid both fail open on anything short of a real Status:"Error"
  await renderCheckout({ user: null });
  await fillNewAddress('guest@example.com');
  await submit();
  expect(createOrderCalls.length).toBe(1);
});
