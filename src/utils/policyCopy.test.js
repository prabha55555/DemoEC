import { deliveryFeeText, codText, metroCities, returnWindowText } from './policyCopy';
import { shippingPromise } from './storeCopy';
import { normaliseGuides, buildHelpFaqs, CARE_GUIDES_DEFAULT } from '../data/careGuides';

const brand = { free_shipping_threshold: 499, shipping_fee_metro: 40, shipping_fee_other: 60, cod_enabled: false, cod_fee: 0, cod_max_order: 5000, return_window_days: 7, delivery_metro_cities: 'Delhi, Mumbai, Chennai', delivery_extra_days: 3 };

test('delivery fee wording follows the store settings and never contradicts the shipping promise', () => {
  const t = deliveryFeeText(brand);
  expect(t).toContain(shippingPromise(brand));
  expect(t).toContain('₹40');
  expect(t).toContain('₹60');
});

test('free delivery on every order when both fees are zero', () => {
  expect(deliveryFeeText({ ...brand, shipping_fee_metro: 0, shipping_fee_other: 0 })).toBe('Delivery is free on every order.');
});

test('a single flat fee with no threshold', () => {
  const t = deliveryFeeText({ ...brand, free_shipping_threshold: 0, shipping_fee_metro: 50, shipping_fee_other: 50 });
  expect(t).toBe('A delivery fee of ₹50 applies.');
});

test('COD wording only when enabled, with the fee and the limit', () => {
  expect(codText(brand)).toBeNull();
  const t = codText({ ...brand, cod_enabled: true, cod_fee: 25 });
  expect(t).toContain('₹5,000');
  expect(t).toContain('₹25');
  expect(codText({ ...brand, cod_enabled: true, cod_fee: 0 })).toContain('no extra charge');
});

test('metro cities and the return window are read from the settings', () => {
  expect(metroCities(brand)).toEqual(['Delhi', 'Mumbai', 'Chennai']);
  expect(returnWindowText(brand)).toBe('7 days');
  expect(returnWindowText({ ...brand, return_window_days: 0 })).toBeNull();
});

test('help FAQs quote the live return window and fees, in five groups', () => {
  const groups = buildHelpFaqs(brand);
  expect(groups.map(g => g.id)).toEqual(['orders', 'shipping', 'returns', 'payments', 'account']);
  const text = JSON.stringify(groups);
  expect(text).toContain('within 7 days of delivery');
  expect(text).toContain('₹40');
  expect(text).not.toMatch(/WhatsApp|unboxing|all sales are final|worldwide/i);
  expect(JSON.stringify(buildHelpFaqs({ ...brand, cod_enabled: true }))).toContain('Cash on Delivery is available');
});

test('custom help topics accept the current and the legacy shape', () => {
  const out = normaliseGuides([
    { title: 'Sizing', answer: 'Use the chart.' },
    { material: 'Cotton', icon: '◈', steps: ['Wash cold', 'Dry flat'] },
    { material: 'Silk', description: 'Dry clean only.' },
    { title: '', answer: 'no title' },
    null,
  ]);
  expect(out).toEqual([
    { title: 'Sizing', answer: 'Use the chart.', steps: [] },
    { title: 'Cotton', answer: '', steps: ['Wash cold', 'Dry flat'] },
    { title: 'Silk', answer: 'Dry clean only.', steps: [] },
  ]);
  expect(normaliseGuides(undefined)).toEqual([]);
  expect(normaliseGuides(CARE_GUIDES_DEFAULT).length).toBe(CARE_GUIDES_DEFAULT.length);
});
