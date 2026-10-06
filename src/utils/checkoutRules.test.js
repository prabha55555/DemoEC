import { checkoutTotals, codOption, mrpTotalOf, orderCartPayload, orderItemsPayload } from './checkoutRules';

const brand = {
  free_shipping_threshold: 499, shipping_fee_metro: 40, shipping_fee_other: 60,
  cod_enabled: true, cod_fee: 25, cod_max_order: 5000, delivery_metro_cities: 'Chennai, Mumbai',
};
const tee = { id: 'p1', variantId: 'v1', name: 'Tee', price: 300, mrp: 400, qty: 1, codAllowed: true };
const mug = { id: 'p2', variantId: 'v2', name: 'Mug', price: 150, mrp: null, qty: 2, codAllowed: true };
const giftCard = { id: 'g1', isGiftCard: true, name: 'Gift card', price: 1000, qty: 1 };

describe('checkoutTotals', () => {
  test('free delivery at or above the threshold, savings from MRP', () => {
    const t = checkoutTotals({ cart: [tee, mug], brand });
    expect(t.subtotal).toBe(600);
    expect(t.mrpTotal).toBe(700);
    expect(t.productSavings).toBe(100);
    expect(t.quote.free).toBe(true);
    expect(t.shipping).toBe(0);
    expect(t.total).toBe(600);
    expect(t.totalSavings).toBe(100);
  });

  test('below the threshold the fee depends on the delivery city', () => {
    const metro = checkoutTotals({ cart: [tee], brand, address: { city: 'Chennai' } });
    const other = checkoutTotals({ cart: [tee], brand, address: { city: 'Shillong' } });
    expect(metro.shipping).toBe(40);
    expect(metro.total).toBe(340);
    expect(other.shipping).toBe(60);
    expect(other.total).toBe(360);
    expect(metro.quote.away).toBe(199);
  });

  test('Cash on Delivery adds the COD fee as its own line', () => {
    const t = checkoutTotals({ cart: [tee], brand, address: { city: 'Chennai' }, paymentMethod: 'cod' });
    expect(t.codFee).toBe(25);
    expect(t.total).toBe(300 + 40 + 25);
  });

  test('a coupon lowers the total but never the free-delivery test (judged before coupons)', () => {
    const coupon = { code: 'FLAT100', type: 'flat', value: 100, applies_to: 'all' };
    const t = checkoutTotals({ cart: [tee, mug], brand, coupon });
    expect(t.discount).toBe(100);
    expect(t.shipping).toBe(0);
    expect(t.total).toBe(500);
    expect(t.totalSavings).toBe(200);
  });

  test('a gift card only pays what is still owed and total never goes negative', () => {
    const t = checkoutTotals({ cart: [tee], brand, address: { city: 'Chennai' }, giftCard: { code: 'GC', balance: 5000 } });
    expect(t.giftCardApplied).toBe(340);
    expect(t.total).toBe(0);
  });
});

describe('codOption', () => {
  test('hidden entirely when the store has not enabled COD', () => {
    expect(codOption({ brand: { ...brand, cod_enabled: false }, cart: [tee], totalWithCod: 365 })).toMatchObject({ visible: false, enabled: false });
    expect(codOption({ brand: {}, cart: [tee], totalWithCod: 365 }).visible).toBe(false);
  });

  test('enabled for an eligible cart, with its fee', () => {
    expect(codOption({ brand, cart: [tee], totalWithCod: 365 })).toEqual({ visible: true, enabled: true, reason: '', fee: 25 });
  });

  test('shown but disabled with a reason for gift cards', () => {
    const o = codOption({ brand, cart: [tee, giftCard], totalWithCod: 1365 });
    expect(o.visible).toBe(true);
    expect(o.enabled).toBe(false);
    expect(o.reason).toMatch(/gift cards/i);
  });

  test('shown but disabled when an item does not allow COD', () => {
    const o = codOption({ brand, cart: [tee, { ...mug, codAllowed: false }], totalWithCod: 625 });
    expect(o.enabled).toBe(false);
    expect(o.reason).toMatch(/one of the items/i);
  });

  test('shown but disabled above the maximum order value, naming the limit', () => {
    const o = codOption({ brand, cart: [tee], totalWithCod: 5001 });
    expect(o.enabled).toBe(false);
    expect(o.reason).toContain('₹5,000');
    expect(codOption({ brand, cart: [tee], totalWithCod: 5000 }).enabled).toBe(true);
  });

  test('a zero cod_max_order means no ceiling', () => {
    expect(codOption({ brand: { ...brand, cod_max_order: 0 }, cart: [tee], totalWithCod: 999999 }).enabled).toBe(true);
  });
});

describe('request payloads', () => {
  test('items carry the variant id, qty, gift-card flag and a (server-ignored) price', () => {
    expect(orderItemsPayload([tee, giftCard])).toEqual([
      { id: 'p1', variantId: 'v1', qty: 1, isGiftCard: false, price: 300 },
      { id: 'g1', variantId: null, qty: 1, isGiftCard: true, price: 1000 },
    ]);
  });
  test('cart payload keeps only identity + name (+ gift recipient)', () => {
    const out = orderCartPayload([{ ...tee, image: 'x.jpg', brand: 'B' }, { ...giftCard, recipientName: 'Asha', recipientEmail: 'a@b.co', giftMessage: 'Hi' }]);
    expect(out[0]).toEqual({ id: 'p1', variantId: 'v1', name: 'Tee', isGiftCard: false });
    expect(out[1]).toMatchObject({ isGiftCard: true, recipientName: 'Asha', recipientEmail: 'a@b.co', giftMessage: 'Hi' });
  });
  test('mrpTotalOf counts a line without an MRP at its price', () => {
    expect(mrpTotalOf([tee, mug])).toBe(400 + 300);
  });
});
