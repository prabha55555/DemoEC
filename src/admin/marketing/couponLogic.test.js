import {
  EMPTY_COUPON_FORM, couponPayload, couponStatus, couponStatusFilters, couponToForm, couponUsageStats, couponWarnings, deleteBlocker, describeLimits, describeOffer,
  describeScope, describeUsage, duplicateForm, generateCode, istInputToISO, istInputValue, normaliseCode, validateCoupon,
} from './couponLogic';
import { applyFilters } from '../hooks/serverList';

const NOW = new Date('2026-10-06T10:00:00Z');
const coupon = (o = {}) => ({ code: 'SAVE10', type: 'percent', value: 10, applies_to: 'all', active: true, max_uses: null, times_used: 0, starts_at: null, expires_at: null, ...o });

describe('couponStatus', () => {
  test('a plain active coupon is active', () => {
    expect(couponStatus(coupon(), NOW)).toBe('active');
  });
  test('switched off wins over everything', () => {
    expect(couponStatus(coupon({ active: false, expires_at: '2026-01-01T00:00:00Z' }), NOW)).toBe('inactive');
  });
  test('expired: the end date has passed', () => {
    expect(couponStatus(coupon({ expires_at: '2026-10-05T00:00:00Z' }), NOW)).toBe('expired');
    expect(couponStatus(coupon({ expires_at: '2026-10-07T00:00:00Z' }), NOW)).toBe('active');
  });
  test('scheduled: the start date is still ahead', () => {
    expect(couponStatus(coupon({ starts_at: '2026-10-08T00:00:00Z' }), NOW)).toBe('scheduled');
    expect(couponStatus(coupon({ starts_at: '2026-10-01T00:00:00Z' }), NOW)).toBe('active');
  });
  test('used up: max uses reached (and 0 / blank means unlimited)', () => {
    expect(couponStatus(coupon({ max_uses: 5, times_used: 5 }), NOW)).toBe('exhausted');
    expect(couponStatus(coupon({ max_uses: 5, times_used: 4 }), NOW)).toBe('active');
    expect(couponStatus(coupon({ max_uses: 0, times_used: 99 }), NOW)).toBe('active');
    expect(couponStatus(coupon({ max_uses: null, times_used: 99 }), NOW)).toBe('active');
  });
  test('when several apply the order is inactive > expired > scheduled > used up', () => {
    expect(couponStatus(coupon({ expires_at: '2026-10-05T00:00:00Z', max_uses: 1, times_used: 1 }), NOW)).toBe('expired');
    expect(couponStatus(coupon({ starts_at: '2026-10-08T00:00:00Z', max_uses: 1, times_used: 1 }), NOW)).toBe('scheduled');
  });
});

describe('couponStatusFilters', () => {
  test('no status means no filter', () => {
    expect(couponStatusFilters('', NOW)).toEqual({});
  });
  test('each bucket asks the database for exactly its coupons', () => {
    const iso = NOW.toISOString();
    expect(couponStatusFilters('inactive', NOW)).toEqual({ active: false });
    expect(couponStatusFilters('expired', NOW)).toEqual({ active: true, expires_at: { lt: iso } });
    expect(couponStatusFilters('scheduled', NOW)).toEqual({ active: true, starts_at: { gt: iso }, $or: `expires_at.is.null,expires_at.gte.${iso}` });
  });
  test('used-up coupons are picked by id (the database cannot compare two columns)', () => {
    const f = couponStatusFilters('exhausted', NOW, ['a', 'b']);
    expect(f.id).toEqual(['a', 'b']);
    expect(f.active).toBe(true);
    expect(f.$or).toMatch(/^and\(or\(expires_at\.is\.null,expires_at\.gte\.[^)]+\),or\(starts_at\.is\.null,starts_at\.lte\.[^)]+\)\)$/);
  });
  test('no used-up coupons: the exhausted filter matches nothing instead of everything', () => {
    expect(couponStatusFilters('exhausted', NOW, []).id).toEqual(['00000000-0000-0000-0000-000000000000']);
  });
  test('the active bucket leaves the used-up ones out', () => {
    expect(couponStatusFilters('active', NOW, ['a', 'b']).id).toEqual({ not: ['in', '(a,b)'] });
    expect(couponStatusFilters('active', NOW, []).id).toBeUndefined();
  });
  test('the filters turn into the right PostgREST calls', () => {
    const calls = [];
    const q = new Proxy({}, { get: (_, m) => (...a) => { calls.push([m, ...a]); return q; } });
    applyFilters(q, couponStatusFilters('active', NOW, ['a']));
    expect(calls.map(c => c[0])).toEqual(['eq', 'not', 'or']);
    expect(calls[1]).toEqual(['not', 'id', 'in', '(a)']);
  });
});

describe('wording', () => {
  test('offers', () => {
    expect(describeOffer({ type: 'percent', value: 10, max_discount: 150 })).toBe('10% off up to ₹150');
    expect(describeOffer({ type: 'percent', value: 10, max_discount: null })).toBe('10% off');
    expect(describeOffer({ type: 'flat', value: 100 })).toBe('₹100 off');
    expect(describeOffer({ type: 'flat', value: 1250.5 })).toBe('₹1,250.5 off');
  });
  test('scope', () => {
    expect(describeScope({ applies_to: 'all' })).toBe('All products');
    expect(describeScope({ applies_to: 'products', product_ids: ['a'] })).toBe('1 product');
    expect(describeScope({ applies_to: 'products', product_ids: ['a', 'b', 'c'] })).toBe('3 products');
    expect(describeScope({ applies_to: 'bundle', product_ids: ['a', 'b'] })).toBe('Bundle of 2 products');
    expect(describeScope({ applies_to: 'categories', category_ids: ['x', 'y', 'z'] })).toBe('3 categories');
    expect(describeScope({ applies_to: 'categories', category_ids: ['x'] }, { x: 'Fashion' })).toBe('Fashion');
  });
  test('usage and limits', () => {
    expect(describeUsage({ times_used: 3, max_uses: 10 })).toBe('3 / 10');
    expect(describeUsage({ times_used: 3, max_uses: null })).toBe('3 / ∞');
    expect(describeLimits({})).toBe('No limit');
    expect(describeLimits({ first_order_only: true, per_user_limit: 2 })).toBe('First order only · 2 per customer');
  });
});

describe('validateCoupon', () => {
  const ok = { ...EMPTY_COUPON_FORM, code: 'SAVE10', value: '10' };
  test('a minimal percent coupon is valid', () => {
    expect(validateCoupon(ok)).toEqual({});
  });
  test('the code: required, upper-case letters / numbers / - _ , 3 to 20 characters', () => {
    expect(validateCoupon({ ...ok, code: '' }).code).toBeTruthy();
    expect(validateCoupon({ ...ok, code: 'ab' }).code).toBeTruthy();
    expect(validateCoupon({ ...ok, code: 'HAS SPACE' }).code).toBeUndefined(); // spaces are stripped by normaliseCode
    expect(validateCoupon({ ...ok, code: 'bad!code' }).code).toBeTruthy();
    expect(validateCoupon({ ...ok, code: 'x'.repeat(21) }).code).toBeTruthy();
    expect(validateCoupon({ ...ok, code: 'save-10_a' }).code).toBeUndefined();
  });
  test('percent is 1 to 100; flat is more than zero', () => {
    expect(validateCoupon({ ...ok, value: '0' }).value).toBeTruthy();
    expect(validateCoupon({ ...ok, value: '101' }).value).toBeTruthy();
    expect(validateCoupon({ ...ok, value: '100' }).value).toBeUndefined();
    expect(validateCoupon({ ...ok, value: '' }).value).toBeTruthy();
    expect(validateCoupon({ ...ok, type: 'flat', value: '0' }).value).toBeTruthy();
    expect(validateCoupon({ ...ok, type: 'flat', value: '250' }).value).toBeUndefined();
  });
  test('the cap only applies to percent coupons and must be positive', () => {
    expect(validateCoupon({ ...ok, max_discount: '0' }).max_discount).toBeTruthy();
    expect(validateCoupon({ ...ok, max_discount: '150' }).max_discount).toBeUndefined();
    expect(validateCoupon({ ...ok, type: 'flat', value: '50', max_discount: '-5' }).max_discount).toBeUndefined();
  });
  test('scope needs its products / categories; a bundle needs two or more', () => {
    expect(validateCoupon({ ...ok, applies_to: 'products', product_ids: [] }).applies_to).toBeTruthy();
    expect(validateCoupon({ ...ok, applies_to: 'products', product_ids: ['a'] }).applies_to).toBeUndefined();
    expect(validateCoupon({ ...ok, applies_to: 'bundle', product_ids: ['a'] }).applies_to).toMatch(/at least two/);
    expect(validateCoupon({ ...ok, applies_to: 'bundle', product_ids: ['a', 'b'] }).applies_to).toBeUndefined();
    expect(validateCoupon({ ...ok, applies_to: 'categories', category_ids: [] }).applies_to).toBeTruthy();
  });
  test('the end must be after the start', () => {
    expect(validateCoupon({ ...ok, starts_at: '2026-10-10T10:00', expires_at: '2026-10-09T10:00' }).expires_at).toMatch(/after the start/);
    expect(validateCoupon({ ...ok, starts_at: '2026-10-10T10:00', expires_at: '2026-10-10T10:00' }).expires_at).toBeTruthy();
    expect(validateCoupon({ ...ok, starts_at: '2026-10-10T10:00', expires_at: '2026-10-11T10:00' })).toEqual({});
    expect(validateCoupon({ ...ok, expires_at: 'garbage' }).expires_at).toBeTruthy();
  });
  test('limits are whole numbers (blank = no limit)', () => {
    expect(validateCoupon({ ...ok, max_uses: '2.5' }).max_uses).toBeTruthy();
    expect(validateCoupon({ ...ok, per_user_limit: '-1' }).per_user_limit).toBeTruthy();
    expect(validateCoupon({ ...ok, max_uses: '100', per_user_limit: '1' })).toEqual({});
    expect(validateCoupon({ ...ok, min_order_value: '-1' }).min_order_value).toBeTruthy();
  });
});

describe('warnings', () => {
  const ok = { ...EMPTY_COUPON_FORM, code: 'SAVE10', value: '10' };
  test('first-order and per-customer coupons say guests must sign in', () => {
    expect(couponWarnings({ ...ok, first_order_only: true }, NOW).join(' ')).toMatch(/Sign in to use this coupon/);
    expect(couponWarnings({ ...ok, per_user_limit: '1' }, NOW).join(' ')).toMatch(/signed in/);
    expect(couponWarnings(ok, NOW)).toEqual([]);
  });
  test('a past end date and a switched-off coupon are flagged', () => {
    expect(couponWarnings({ ...ok, expires_at: '2026-10-01T10:00' }, NOW).join(' ')).toMatch(/in the past/);
    expect(couponWarnings({ ...ok, active: false }, NOW).join(' ')).toMatch(/switched off/);
  });
});

describe('IST date inputs', () => {
  test('the admin types India time and the instant is stored', () => {
    expect(istInputToISO('2026-10-06T15:30')).toBe('2026-10-06T10:00:00.000Z');
    expect(istInputToISO('2026-10-06T00:00')).toBe('2026-10-05T18:30:00.000Z');
    expect(istInputToISO('')).toBeNull();
    expect(istInputToISO('nope')).toBeNull();
  });
  test('and back again', () => {
    expect(istInputValue('2026-10-06T10:00:00Z')).toBe('2026-10-06T15:30');
    expect(istInputValue('2026-10-05T18:30:00Z')).toBe('2026-10-06T00:00');
    expect(istInputValue(null)).toBe('');
    expect(istInputValue(istInputToISO('2026-12-31T23:59'))).toBe('2026-12-31T23:59');
  });
});

describe('couponPayload', () => {
  test('a percent coupon for categories', () => {
    const p = couponPayload({ ...EMPTY_COUPON_FORM, code: ' save 10 ', description: ' 10% off ', value: '10', max_discount: '150', min_order_value: '499', applies_to: 'categories', category_ids: ['c1', 'c1', 'c2'], product_ids: ['stale'], max_uses: '50', per_user_limit: '1', first_order_only: true, is_public: false, starts_at: '2026-10-06T15:30' });
    expect(p).toEqual({
      code: 'SAVE10', description: '10% off', type: 'percent', value: 10, max_discount: 150, min_order_value: 499, applies_to: 'categories',
      product_ids: [], category_ids: ['c1', 'c2'], starts_at: '2026-10-06T10:00:00.000Z', expires_at: null, max_uses: 50, per_user_limit: 1,
      first_order_only: true, is_public: false, active: true,
    });
  });
  test('a flat coupon never carries a cap; blank limits are NULL (unlimited)', () => {
    const p = couponPayload({ ...EMPTY_COUPON_FORM, code: 'FLAT100', type: 'flat', value: '100', max_discount: '999', max_uses: '', per_user_limit: '0' });
    expect(p.max_discount).toBeNull();
    expect(p.max_uses).toBeNull();
    expect(p.per_user_limit).toBeNull();
    expect(p.min_order_value).toBe(0);
    expect(p.applies_to).toBe('all');
  });
  test('product lists only travel with the scopes that use them', () => {
    expect(couponPayload({ ...EMPTY_COUPON_FORM, code: 'AAA', value: '5', applies_to: 'bundle', product_ids: ['a', 'b'], category_ids: ['x'] })).toMatchObject({ product_ids: ['a', 'b'], category_ids: [] });
    expect(couponPayload({ ...EMPTY_COUPON_FORM, code: 'AAA', value: '5', applies_to: 'all', product_ids: ['a'] }).product_ids).toEqual([]);
  });
  test('couponToForm and couponPayload round-trip', () => {
    const row = { code: 'WELCOME10', description: 'Welcome', type: 'percent', value: 10, max_discount: 150, min_order_value: 499, applies_to: 'all', product_ids: [], category_ids: [], starts_at: null, expires_at: '2026-12-31T18:29:00Z', max_uses: null, per_user_limit: 1, first_order_only: true, is_public: true, active: true };
    expect(couponPayload(couponToForm(row))).toEqual({ ...row, expires_at: '2026-12-31T18:29:00.000Z', max_uses: null });
  });
});

describe('codes, duplicates and deletion', () => {
  test('normaliseCode upper-cases and strips spaces', () => {
    expect(normaliseCode('  save 10 ')).toBe('SAVE10');
    expect(normaliseCode(null)).toBe('');
  });
  test('generated codes are valid, readable and different', () => {
    let seed = 0;
    const rng = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const a = generateCode('SAVE', rng);
    const b = generateCode('SAVE', rng);
    expect(a).toMatch(/^SAVE-[A-HJ-NP-Z2-9]{6}$/);
    expect(a).not.toBe(b);
    expect(validateCoupon({ ...EMPTY_COUPON_FORM, code: a, value: '5' }).code).toBeUndefined();
  });
  test('a duplicate keeps the rules, gets a fresh code and starts switched off', () => {
    const d = duplicateForm({ code: 'WELCOME10', type: 'percent', value: 10, applies_to: 'all', active: true, is_public: true });
    expect(d.code).toMatch(/^COPY-/);
    expect(d.active).toBe(false);
    expect(d.value).toBe('10');
  });
  test('a used coupon cannot be deleted; an unused one can', () => {
    expect(deleteBlocker({ code: 'A', times_used: 3 })).toMatch(/Switch it off instead/);
    expect(deleteBlocker({ code: 'A', times_used: 0 }, 2)).toMatch(/used on 2 orders/);
    expect(deleteBlocker({ code: 'A', times_used: 0 }, 0)).toBe('');
  });
  test('usage stats ignore cancelled orders (their use was given back)', () => {
    expect(couponUsageStats([
      { discount: 100, total: 900, status: 'Delivered' }, { discount: 50, total: 450, status: 'Placed' }, { discount: 80, total: 700, status: 'Cancelled' },
    ])).toEqual({ orders: 2, cancelled: 1, discount: 150, revenue: 1350 });
    expect(couponUsageStats([])).toEqual({ orders: 0, cancelled: 0, discount: 0, revenue: 0 });
  });
});
