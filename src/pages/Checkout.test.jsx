import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let mockAuth;
let mockCart;
let mockBrand;
let mockOffers;
const mockClearCart = jest.fn();
jest.mock('../supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) },
    from: () => ({
      update: () => ({ eq: async () => ({}) }),
      select: () => ({ order: () => ({ limit: async () => ({ data: mockOffers, error: null }) }) }),
    }),
  },
}));
jest.mock('../context/AuthContext', () => ({ useAuth: () => mockAuth }));
jest.mock('../context/CartContext', () => ({
  useCart: () => ({ cart: mockCart, clearCart: mockClearCart, refreshCart: async () => ({}), hasUnavailable: mockCart.some(l => l.soldOut) }),
}));
jest.mock('../context/BrandContext', () => ({ useBrand: () => ({ brand: mockBrand }) }));
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
const LINE = { id: 'p1', variantId: 'v1', name: 'Bowl', variantLabel: 'Large', price: 500, mrp: 600, qty: 1, stock: 5, maxQty: 5, cat: 'Home', codAllowed: true, image: null };
const GIFT = { id: 'g1', isGiftCard: true, name: 'Gift card', price: 1000, qty: 1 };
const BRAND = { free_shipping_threshold: 499, shipping_fee_metro: 40, shipping_fee_other: 60, delivery_metro_cities: 'Pune, Mumbai', cod_enabled: false, cod_fee: 25, cod_max_order: 5000 };

const mobileUser = { id: 'm1', email: PLACEHOLDER, app_metadata: { msg91_phone: '919876543210' } };
const normalUser = { id: 'u1', email: 'normal@customer.in', app_metadata: {} };

let container;
let root;
let createOrderCalls;
let freeOrderCalls;
let createOrderResponse;
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

async function renderCheckout({ user, profile = null, cart = [LINE], brand = BRAND }) {
  mockAuth = { currentUser: user, userProfile: profile, refreshProfile: jest.fn() };
  mockCart = cart;
  mockBrand = brand;
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
const clickEl = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const submit = async () => {
  await clickEl(container.querySelector('[data-testid="place-order"]'));
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
const summaryText = () => container.querySelector('.pst')?.textContent || '';
const codRadio = () => container.querySelector('input[name="pay-method"][value="cod"]');

beforeEach(() => {
  createOrderCalls = [];
  freeOrderCalls = [];
  mockOffers = [];
  mockClearCart.mockClear();
  createOrderResponse = { ok: false, json: async () => ({ error: 'stop here' }) };
  lookupPincode.mockResolvedValue(null); // CRA resets mock implementations between tests
  isPincodeConfirmedInvalid.mockResolvedValue(false);
  localStorage.clear();
  Object.defineProperty(globalThis, 'crypto', { value: { randomUUID: () => 'attempt-key-1' }, configurable: true });
  global.fetch = jest.fn(async (url, opts) => {
    if (String(url).includes('/api/razorpay-create-order')) {
      createOrderCalls.push([url, opts]);
      return createOrderResponse;
    }
    if (String(url).includes('/api/verify-free-order')) {
      freeOrderCalls.push([url, opts]);
      return { ok: true, json: async () => ({ verified: true, order: { order_id: 'BL-1' } }) };
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
  expect(container.querySelector('#ship-name')).toBeNull(); // saved-address view: new-address form hidden
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

// ------------------------------------------------------------------------------------------------
// New model: variant lines, visible shipping, optional Cash on Delivery
// ------------------------------------------------------------------------------------------------
describe('request body', () => {
  test('lines go to the server by variant id, with the payment method (online by default)', async () => {
    await renderCheckout({ user: null });
    await fillNewAddress('guest@example.com');
    await submit();
    const body = sentBody();
    expect(body.items).toEqual([{ id: 'p1', variantId: 'v1', qty: 1, isGiftCard: false, price: 500 }]);
    expect(body.paymentMethod).toBe('online');
    expect(body.checkoutAttemptKey).toBe('attempt-key-1');
    expect(body.cart[0]).toMatchObject({ id: 'p1', variantId: 'v1', name: 'Bowl' });
    expect(JSON.stringify(body)).not.toMatch(/"size"|shipping_charge/);
  });

  test('choosing Cash on Delivery sends paymentMethod "cod"', async () => {
    await renderCheckout({ user: null, brand: { ...BRAND, cod_enabled: true } });
    await clickEl(codRadio());
    await fillNewAddress('guest@example.com');
    await submit();
    expect(sentBody().paymentMethod).toBe('cod');
  });
});

describe('Cash on Delivery option', () => {
  test('is not shown at all while the store has COD switched off', async () => {
    await renderCheckout({ user: null });
    expect(codRadio()).toBeNull();
    expect(container.textContent).not.toMatch(/cash on delivery/i);
    expect(container.querySelector('input[name="pay-method"][value="online"]').checked).toBe(true);
  });

  test('is offered, with its fee, when enabled and the cart qualifies', async () => {
    await renderCheckout({ user: null, brand: { ...BRAND, cod_enabled: true } });
    expect(codRadio()).toBeTruthy();
    expect(codRadio().disabled).toBe(false);
    expect(container.textContent).toMatch(/Cash on Delivery/);
    expect(container.textContent).toMatch(/₹25 fee/);
  });

  test('selecting it adds the COD fee row and changes the total', async () => {
    await renderCheckout({ user: null, brand: { ...BRAND, cod_enabled: true } });
    expect(summaryText()).not.toMatch(/Cash on Delivery fee/);
    await clickEl(codRadio());
    expect(summaryText()).toMatch(/Cash on Delivery fee/);
    expect(summaryText()).toMatch(/₹25/);
    expect(summaryText()).toMatch(/Amount payable on delivery/);
  });

  test('is shown disabled, with the reason, when the cart has a gift card', async () => {
    await renderCheckout({ user: null, cart: [LINE, GIFT], brand: { ...BRAND, cod_enabled: true } });
    expect(codRadio().disabled).toBe(true);
    expect(container.textContent).toMatch(/isn't available for gift cards/i);
  });

  test('is shown disabled when an item does not allow it', async () => {
    await renderCheckout({ user: null, cart: [{ ...LINE, codAllowed: false }], brand: { ...BRAND, cod_enabled: true } });
    expect(codRadio().disabled).toBe(true);
    expect(container.textContent).toMatch(/one of the items/i);
  });

  test('is shown disabled above the maximum order value, naming the limit', async () => {
    await renderCheckout({ user: null, cart: [{ ...LINE, price: 6000, mrp: null }], brand: { ...BRAND, cod_enabled: true, cod_max_order: 5000 } });
    expect(codRadio().disabled).toBe(true);
    expect(container.textContent).toMatch(/orders above ₹5,000/);
  });

  test('completes through verify-free-order and remembers a COD summary for the confirmation page', async () => {
    createOrderResponse = {
      ok: true,
      json: async () => ({
        cod: true, receipt: 'BL-30001', blob: 'blob', blobSig: 'sig',
        computedSubtotal: 500, computedShipping: 0, computedCodFee: 25, computedDiscount: 0, computedGiftCardApplied: 0, computedTax: 53, computedTotal: 525,
        couponCode: null, verifiedItems: [{ id: 'p1', variantId: 'v1', name: 'Bowl', variantLabel: 'Large', price: 500, mrp: 600, qty: 1, image: 'bowl.jpg' }],
      }),
    };
    await renderCheckout({ user: null, brand: { ...BRAND, cod_enabled: true } });
    await clickEl(codRadio());
    await fillNewAddress('guest@example.com');
    await clickEl(container.querySelector('[data-testid="place-order"]'));
    await flush();
    expect(freeOrderCalls.length).toBe(1);
    expect(JSON.parse(freeOrderCalls[0][1].body)).toMatchObject({ receipt: 'BL-30001', blob: 'blob', blobSig: 'sig' });
    await act(async () => { await new Promise(r => setTimeout(r, 900)); }); // the confirmation checkmark beat
    const saved = JSON.parse(localStorage.getItem('tt_last_order'));
    expect(saved).toMatchObject({ orderId: 'BL-30001', paymentMethod: 'cod', total: 525, codFee: 25, subtotal: 500 });
    expect(saved.items[0]).toMatchObject({ name: 'Bowl', variantLabel: 'Large', image: 'bowl.jpg' });
    expect(mockClearCart).toHaveBeenCalled();
  });
});

describe('delivery charge', () => {
  test('shows Free once the cart reaches the free-delivery threshold', async () => {
    await renderCheckout({ user: null });
    expect(summaryText()).toMatch(/DeliveryFree/);
  });

  test('shows the fee for the chosen address when below the threshold, and how much more makes it free', async () => {
    await renderCheckout({ user: normalUser, profile: { addresses: SAVED }, cart: [{ ...LINE, price: 300, mrp: 300 }] });
    expect(summaryText()).toMatch(/Delivery₹40/); // Pune is one of the metro cities
    expect(summaryText()).toMatch(/Add ₹199 more for free delivery/);
    expect(summaryText()).toMatch(/Total payable₹340/);
  });

  test('a non-metro address pays the higher fee', async () => {
    await renderCheckout({ user: normalUser, profile: { addresses: [{ ...SAVED[0], city: 'Shillong', state: 'Meghalaya' }] }, cart: [{ ...LINE, price: 300, mrp: 300 }] });
    expect(summaryText()).toMatch(/Delivery₹60/);
  });

  test('shows the MRP total, the discount and the savings line', async () => {
    await renderCheckout({ user: null });
    expect(summaryText()).toMatch(/Price \(1 item\)₹600/);
    expect(summaryText()).toMatch(/Discount− ₹100/);
    expect(summaryText()).toMatch(/You will save ₹100 on this order/);
    expect(summaryText()).toMatch(/Inclusive of all taxes/);
  });
});

describe('coupons', () => {
  const lookup = (coupon) => {
    const prev = global.fetch;
    global.fetch = jest.fn(async (url, opts) => (String(url).includes('/api/lookup') ? { ok: true, json: async () => ({ coupon }) } : prev(url, opts)));
  };
  const apply = async (code) => {
    await setValue(container.querySelector('input[aria-label="Coupon code"]'), code);
    await clickEl([...container.querySelectorAll('button')].find(b => b.textContent === 'Apply' && !b.getAttribute('aria-label')));
    await flush();
  };

  test('a minimum-order coupon says exactly how much more to add', async () => {
    lookup({ code: 'BIG', active: true, type: 'flat', value: 100, applies_to: 'all', min_order_value: 1200 });
    await renderCheckout({ user: null });
    await apply('big');
    expect(toast.error).toHaveBeenCalledWith('Add items worth ₹700 more to use this coupon.');
    expect(summaryText()).not.toMatch(/Coupon \(/);
  });

  test('an expired coupon is refused with that reason', async () => {
    lookup({ code: 'OLD', active: true, type: 'flat', value: 100, applies_to: 'all', expires_at: '2020-01-01T00:00:00Z' });
    await renderCheckout({ user: null });
    await apply('old');
    expect(toast.error).toHaveBeenCalledWith('This coupon has expired.');
  });

  test('a coupon that does not fit the cart explains why', async () => {
    lookup({ code: 'CAT', active: true, type: 'flat', value: 100, applies_to: 'categories', category_ids: ['other'] });
    await renderCheckout({ user: null });
    await apply('cat');
    expect(toast.error).toHaveBeenCalledWith("This coupon doesn't apply to the categories in your cart.");
  });

  test('a valid coupon is applied, shown in the price details and sent to the server', async () => {
    lookup({ code: 'FLAT100', active: true, type: 'flat', value: 100, applies_to: 'all', min_order_value: 0 });
    await renderCheckout({ user: null });
    await apply('flat100');
    expect(summaryText()).toMatch(/Coupon \(FLAT100\)− ₹100/);
    await fillNewAddress('guest@example.com');
    await submit();
    expect(sentBody().couponCode).toBe('FLAT100');
  });

  test('a coupon the server dropped (first order only ...) is explained with a toast', async () => {
    createOrderResponse = {
      ok: true,
      json: async () => ({ free: false, receipt: 'BL-1', id: 'order_x', blob: 'b', blobSig: 's', computedTotal: 500, couponNote: 'This coupon is only for your first order.', verifiedItems: [] }),
    };
    await renderCheckout({ user: null });
    await fillNewAddress('guest@example.com');
    await submit();
    expect(toast).toHaveBeenCalledWith('This coupon is only for your first order.', expect.anything());
  });

  test('signed-in customers see their public coupons and can apply one in a tap', async () => {
    mockOffers = [{ code: 'WELCOME10', type: 'percent', value: 10, max_discount: 150, min_order_value: 499, description: '', applies_to: 'all', active: true }];
    await renderCheckout({ user: normalUser });
    await flush();
    const offer = container.querySelector('.co-offer');
    expect(offer.textContent).toMatch(/WELCOME10/);
    expect(offer.textContent).toMatch(/10% off up to ₹150 on orders above ₹499/);
    await clickEl(container.querySelector('button[aria-label="Apply coupon WELCOME10"]'));
    await flush();
    expect(summaryText()).toMatch(/Coupon \(WELCOME10\)− ₹50/);
  });
});

test('a sold-out line blocks checkout: the pay button is disabled and nothing is sent', async () => {
  await renderCheckout({ user: null, cart: [{ ...LINE, soldOut: true }] });
  expect(container.querySelector('[data-testid="place-order"]').disabled).toBe(true);
  expect(container.textContent).toMatch(/out of stock/i);
  expect(createOrderCalls.length).toBe(0);
});
