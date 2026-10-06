import { guidesToSave, normaliseGuides } from './guides';
import { draftBrand, shippingExamples } from './shippingPreview';

describe('help guides', () => {
  test('new-shape guides pass through', () => {
    expect(normaliseGuides([{ title: 'Returns', answer: '7 days.' }])).toEqual([{ title: 'Returns', answer: '7 days.' }]);
  });
  test('legacy guides become title = material, answer = steps (+ note)', () => {
    const out = normaliseGuides([{ material: 'Shipping', icon: '✦', tagline: 't', steps: ['One', 'Two'], note: 'See policy.' }]);
    expect(out).toEqual([{ title: 'Shipping', answer: 'One\nTwo\n\nSee policy.' }]);
  });
  test('legacy guide without steps falls back to description / tagline', () => {
    expect(normaliseGuides([{ material: 'A', description: 'About A' }])[0].answer).toBe('About A');
    expect(normaliseGuides([{ material: 'B', tagline: 'Tag B' }])[0].answer).toBe('Tag B');
  });
  test('nothing saved -> the built-in defaults, already in the new shape', () => {
    const out = normaliseGuides(null);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every(g => typeof g.title === 'string' && g.title && typeof g.answer === 'string')).toBe(true);
    expect(normaliseGuides([])).toEqual(out);
  });
  test('guidesToSave trims and drops half-filled topics', () => {
    expect(guidesToSave([{ title: ' A ', answer: ' x ' }, { title: '', answer: 'orphan' }, { title: 'B', answer: '  ' }])).toEqual([{ title: 'A', answer: 'x' }]);
  });
});

describe('shipping preview', () => {
  const values = { free_shipping_threshold: '499', shipping_fee_metro: '40', shipping_fee_other: '60', delivery_metro_cities: 'Chennai, Mumbai', delivery_extra_days: '3' };

  test('draftBrand turns the form strings into numbers', () => {
    expect(draftBrand(values, { x: 1 })).toMatchObject({ x: 1, free_shipping_threshold: 499, shipping_fee_metro: 40, shipping_fee_other: 60, delivery_extra_days: 3 });
    expect(draftBrand({ ...values, shipping_fee_metro: '' }).shipping_fee_metro).toBe(0);
  });

  test('default settings: ₹300 to Chennai costs ₹40, ₹600 is free', () => {
    const p = shippingExamples(draftBrand(values));
    expect(p.promise).toBe('Free delivery on orders above ₹499');
    expect(p.rows[0]).toMatchObject({ text: '₹300 cart to Chennai', result: '₹40' });
    expect(p.rows[1]).toMatchObject({ result: '₹60' });
    expect(p.rows[2]).toMatchObject({ text: '₹600 cart to Chennai', result: 'Free' });
  });

  test('no threshold: everyone pays the fee, and the promise says delivery from the lowest fee', () => {
    const p = shippingExamples(draftBrand({ ...values, free_shipping_threshold: '0' }));
    expect(p.promise).toBe('Delivery from ₹40');
    expect(p.rows.map(r => r.result)).toEqual(['₹40', '₹60', '₹40']);
  });

  test('both fees 0: free delivery on every order', () => {
    const p = shippingExamples(draftBrand({ ...values, shipping_fee_metro: '0', shipping_fee_other: '0' }));
    expect(p.promise).toBe('Free delivery on every order');
    expect(p.rows.every(r => r.result === 'Free')).toBe(true);
  });

  test('the examples scale with the threshold', () => {
    const p = shippingExamples(draftBrand({ ...values, free_shipping_threshold: '1000' }));
    expect(p.rows[0].text).toBe('₹600 cart to Chennai');
    expect(p.rows[2].text).toBe('₹1200 cart to Chennai');
    expect(p.rows[2].result).toBe('Free');
  });
});
