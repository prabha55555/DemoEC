import { buildSeries, istParts, niceMax, orderRevenue, ordersOnDays, statusBreakdown, summarise } from './dashboardMath';

const at = (iso, o = {}) => ({ created_at: iso, total: 100, refunded_amount: 0, status: 'Placed', ...o });

describe('revenue rules', () => {
  test('cancelled and returned orders add nothing', () => {
    expect(orderRevenue(at('2026-10-06T10:00:00Z', { status: 'Cancelled' }))).toBe(0);
    expect(orderRevenue(at('2026-10-06T10:00:00Z', { status: 'Returned' }))).toBe(0);
  });
  test('a partial refund is subtracted, never below zero', () => {
    expect(orderRevenue(at('2026-10-06T10:00:00Z', { total: 500, refunded_amount: 120 }))).toBe(380);
    expect(orderRevenue(at('2026-10-06T10:00:00Z', { total: 500, refunded_amount: 900 }))).toBe(0);
  });
  test('legacy Paid / Pending still count; missing numbers are 0', () => {
    expect(orderRevenue(at('2026-10-06T10:00:00Z', { status: 'Paid' }))).toBe(100);
    expect(orderRevenue({ status: 'Placed' })).toBe(0);
  });
  test('summarise totals counted orders and the average order value', () => {
    const s = summarise([at('2026-10-06T10:00:00Z', { total: 300 }), at('2026-10-06T11:00:00Z', { total: 100 }), at('2026-10-06T12:00:00Z', { status: 'Cancelled', total: 999 })]);
    expect(s).toEqual({ revenue: 400, orders: 2, aov: 200 });
    expect(summarise([])).toEqual({ revenue: 0, orders: 0, aov: 0 });
  });
});

describe('IST bucketing', () => {
  test('istParts reads the Indian date and hour', () => {
    expect(istParts('2026-10-06T18:30:00Z')).toEqual({ key: '2026-10-07', hour: 0 });
    expect(istParts('2026-10-06T10:12:00Z')).toEqual({ key: '2026-10-06', hour: 15 });
    expect(istParts('nope')).toBeNull();
  });
  test('ordersOnDays selects by IST day', () => {
    const orders = [at('2026-10-06T18:29:00Z'), at('2026-10-06T18:31:00Z')];
    expect(ordersOnDays(orders, ['2026-10-06'])).toHaveLength(1);
    expect(ordersOnDays(orders, ['2026-10-07'])).toHaveLength(1);
  });
  const now = new Date('2026-10-06T10:00:00Z'); // 15:30 IST on 6 Oct
  test('daily series: one bucket per day, oldest first, ending today', () => {
    const s = buildSeries([at('2026-10-06T09:00:00Z', { total: 200 }), at('2026-10-04T09:00:00Z', { total: 50 }), at('2026-09-01T09:00:00Z')], 3, now);
    expect(s.map(b => b.key)).toEqual(['2026-10-04', '2026-10-05', '2026-10-06']);
    expect(s.map(b => b.revenue)).toEqual([50, 0, 200]);
    expect(s.map(b => b.orders)).toEqual([1, 0, 1]);
  });
  test('"today" series is 24 hourly IST buckets', () => {
    const s = buildSeries([at('2026-10-06T09:00:00Z', { total: 200 }), at('2026-10-05T09:00:00Z'), at('2026-10-06T10:05:00Z', { total: 30 })], 1, now);
    expect(s).toHaveLength(24);
    expect(s[14]).toMatchObject({ revenue: 200, orders: 1 }); // 09:00Z = 14:30 IST
    expect(s[15]).toMatchObject({ revenue: 30, orders: 1 });
    expect(s.reduce((a, b) => a + b.orders, 0)).toBe(2);
  });
  test('cancelled orders never reach the chart', () => {
    const s = buildSeries([at('2026-10-06T09:00:00Z', { status: 'Cancelled' })], 7, now);
    expect(s.every(b => b.orders === 0 && b.revenue === 0)).toBe(true);
  });
});

describe('status breakdown', () => {
  test('lists every status, folding legacy names into Placed', () => {
    const b = statusBreakdown([{ status: 'Placed' }, { status: 'Paid' }, { status: 'Delivered' }, { status: 'Weird' }]);
    expect(b).toHaveLength(8);
    expect(b.find(x => x.status === 'Placed').count).toBe(2);
    expect(b.find(x => x.status === 'Delivered').count).toBe(1);
    expect(b.find(x => x.status === 'Cancelled').count).toBe(0);
  });
});

test('niceMax rounds up to a tidy axis maximum', () => {
  expect(niceMax(0)).toBe(100);
  expect(niceMax(430)).toBe(500);
  expect(niceMax(4632)).toBe(5000);
  expect(niceMax(1200)).toBe(2000);
  expect(niceMax(10)).toBe(10);
  expect(niceMax(78000)).toBe(100000);
});
