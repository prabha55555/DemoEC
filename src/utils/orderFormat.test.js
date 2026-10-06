import {
  cancelRefundMessage, formatDeliveryLabel, hasGiftCardItem, isDigitalOrder, isPlaceholderEmail, isValidIndianMobile,
  lineVariantLabel, maskPhone, orderLineKey,
} from './orderFormat';

describe('order lines', () => {
  test('variant label falls back to the old `size` and hides "Default"', () => {
    expect(lineVariantLabel({ variantLabel: 'M / Red' })).toBe('M / Red');
    expect(lineVariantLabel({ size: 'L' })).toBe('L');
    expect(lineVariantLabel({ variantLabel: 'Default' })).toBe('');
    expect(lineVariantLabel({})).toBe('');
  });
  test('line keys work for new and old lines', () => {
    expect(orderLineKey({ variantId: 'v1' })).toBe('v1');
    expect(orderLineKey({ id: 'p1', size: 'M' })).toBe('p1::M');
  });
  test('digital / gift card detection', () => {
    expect(isDigitalOrder({ items: [{ isGiftCard: true }] })).toBe(true);
    expect(isDigitalOrder({ items: [{ isGiftCard: true }, { id: 'p' }] })).toBe(false);
    expect(isDigitalOrder({ items: [] })).toBe(false);
    expect(hasGiftCardItem({ items: [{ id: 'p' }, { isGiftCard: true }] })).toBe(true);
    expect(hasGiftCardItem({ items: [{ id: 'p' }] })).toBe(false);
  });
});

describe('formatting', () => {
  test('estimated delivery: dates are formatted, labels pass through', () => {
    expect(formatDeliveryLabel('20 Aug - 25 Aug')).toBe('20 Aug - 25 Aug');
    expect(formatDeliveryLabel('2026-10-12')).toMatch(/12 Oct 2026/);
    expect(formatDeliveryLabel(null)).toBe('');
  });
  test('masked phone keeps the first and last digits only', () => {
    expect(maskPhone('+91 98765 43210')).toBe('98••••3210');
    expect(maskPhone('123')).toBe('');
  });
  test('placeholder addresses of mobile-OTP accounts are recognised', () => {
    expect(isPlaceholderEmail('p919876543210@phone.brightlightsolutions.invalid')).toBe(true);
    expect(isPlaceholderEmail('asha@example.com')).toBe(false);
  });
  test('Indian mobile validation', () => {
    expect(isValidIndianMobile('98765 43210')).toBe(true);
    expect(isValidIndianMobile('+91 9876543210')).toBe(true);
    expect(isValidIndianMobile('1234567890')).toBe(false);
    expect(isValidIndianMobile('98765')).toBe(false);
  });
});

describe('cancelRefundMessage', () => {
  test('online refund names the amount and the timeline', () => {
    expect(cancelRefundMessage({ payment_method: 'razorpay' }, { onlineRefunded: 1299 })).toMatch(/₹1,299 will be refunded to your original payment method in 5–7 business days/);
  });
  test('gift card portion is reported separately', () => {
    const m = cancelRefundMessage({}, { onlineRefunded: 400, giftCardCredited: 100 });
    expect(m).toMatch(/₹400/);
    expect(m).toMatch(/₹100 has been added back to your gift card/);
  });
  test('COD: nothing was paid, nothing is refunded', () => {
    expect(cancelRefundMessage({ payment_method: 'cod' }, { amount: 0 })).toMatch(/nothing to refund/);
  });
});
