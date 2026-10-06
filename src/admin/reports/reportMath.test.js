import { toCsv } from '../lib/csv';
import {
  COUPON_CSV_COLUMNS, PAYMENT_CSV_COLUMNS, PRODUCT_CSV_COLUMNS, SALES_CSV_COLUMNS, buildSalesSeries, chartBuckets, couponReport, methodOf, paymentFilters,
  salesTotals, summarisePayments, withShare,
} from './reportMath';

const range = { from: '2026-10-01', to: '2026-10-05' };

describe('sales series', () => {
  const rows = [
    { day: '2026-10-02', orders: '2', sales: '1500', refunds: '200', units: '3' },
    { day: '2026-10-04', orders: 1, sales: 998, refunds: 0, units: 2 },
    { day: '2026-09-30', orders: 9, sales: 9999, refunds: 0, units: 9 }, // outside the range: ignored
  ];
  const series = buildSalesSeries(rows, range);
  test('one entry per day of the range, quiet days are zeros', () => {
    expect(series.map(d => d.key)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']);
    expect(series[0]).toMatchObject({ orders: 0, sales: 0, refunds: 0, net: 0, aov: 0 });
  });
  test('net is sales minus refunds and the average is net per order', () => {
    expect(series[1]).toMatchObject({ orders: 2, sales: 1500, refunds: 200, net: 1300, units: 3, aov: 650 });
    expect(series[3]).toMatchObject({ net: 998, aov: 998 });
  });
  test('totals add the days up and show refunds explicitly', () => {
    expect(salesTotals(series)).toEqual({ orders: 3, units: 5, sales: 2498, refunds: 200, net: 2298, aov: 766 });
  });
  test('an empty range totals to zero without dividing by zero', () => {
    expect(salesTotals(buildSalesSeries([], range))).toEqual({ orders: 0, units: 0, sales: 0, refunds: 0, net: 0, aov: 0 });
  });
  test('the CSV has a row per day and plain numbers', () => {
    const lines = toCsv(SALES_CSV_COLUMNS, series).slice(1).split('\r\n');
    expect(lines).toHaveLength(6);
    expect(lines[0]).toBe('Date,Orders,Units,Sales,Refunds,Net sales,Average order value');
    expect(lines[2]).toBe('2026-10-02,2,3,1500,200,1300,650');
  });
});

describe('chart buckets', () => {
  test('a short range is a bar per day, charting NET sales', () => {
    const b = chartBuckets(buildSalesSeries([{ day: '2026-10-02', orders: 2, sales: 1500, refunds: 200, units: 3 }], range));
    expect(b).toHaveLength(5);
    expect(b[1]).toMatchObject({ key: '2026-10-02', revenue: 1300, orders: 2 });
  });
  test('a long range collapses into weeks that start on Monday and keep the totals', () => {
    const long = { from: '2026-01-01', to: '2026-12-31' };
    const series = buildSalesSeries([{ day: '2026-10-06', orders: 1, sales: 500, refunds: 0, units: 1 }, { day: '2026-10-11', orders: 2, sales: 700, refunds: 100, units: 2 }], long);
    const weeks = chartBuckets(series);
    expect(weeks.length).toBeLessThan(60);
    const w = weeks.find(x => x.key === '2026-10-05');
    expect(w).toMatchObject({ orders: 3, revenue: 1100, sales: 1200, refunds: 100 });
    expect(weeks.reduce((s, x) => s + x.revenue, 0)).toBe(1100);
  });
});

describe('product and category shares', () => {
  const rows = [{ product_id: 'a', name: 'A', units: '3', revenue: '750' }, { product_id: 'b', name: 'B', units: 1, revenue: 250 }];
  test('share is of the given total (the whole sales figure, not just the rows shown)', () => {
    expect(withShare(rows, 2000).map(r => r.share)).toEqual([37.5, 12.5]);
    expect(withShare(rows).map(r => r.share)).toEqual([75, 25]);
    expect(withShare(rows, 0).map(r => r.share)).toEqual([0, 0]);
  });
  test('CSV', () => {
    const lines = toCsv(PRODUCT_CSV_COLUMNS, withShare(rows)).slice(1).split('\r\n');
    expect(lines[1]).toBe('A,a,3,750,75');
  });
});

describe('coupon report', () => {
  const rows = [
    { coupon_code: 'SAVE', discount: 100, total: 900, status: 'Delivered' },
    { coupon_code: 'SAVE', discount: 50, total: 450, status: 'Placed' },
    { coupon_code: 'BIG', discount: 400, total: 1600, status: 'Delivered' },
    { coupon_code: 'SAVE', discount: 999, total: 1, status: 'Cancelled' },
    { coupon_code: null, discount: 5, total: 5, status: 'Placed' },
  ];
  const r = couponReport(rows);
  test('one line per code, cancelled orders and code-less rows left out', () => {
    expect(r.lines.map(l => `${l.code}:${l.uses}:${l.discount}`)).toEqual(['BIG:1:400', 'SAVE:2:150']);
    expect(r.lines[1]).toMatchObject({ revenue: 1350, average: 75 });
  });
  test('totals', () => {
    expect(r.totals).toEqual({ uses: 3, discount: 550, revenue: 2950 });
    expect(couponReport([]).totals).toEqual({ uses: 0, discount: 0, revenue: 0 });
  });
  test('CSV', () => {
    expect(toCsv(COUPON_CSV_COLUMNS, r.lines).slice(1).split('\r\n')[1]).toBe('BIG,1,400,400,1600');
  });
});

describe('payments', () => {
  const rows = [
    { payment_method: 'razorpay', payment_status: 'paid', status: 'Delivered', total: 1000, gift_card_applied: 0, discount: 100, refunded_amount: 0 },
    { payment_method: 'razorpay', payment_status: 'partially_refunded', status: 'Delivered', total: 2000, gift_card_applied: 500, discount: 0, refunded_amount: 300 },
    { payment_method: 'cod', payment_status: 'cod_pending', status: 'Placed', total: 1597, gift_card_applied: 0, discount: 0, refunded_amount: 0 },
    { payment_method: 'cod', payment_status: 'paid', status: 'Delivered', total: 800, gift_card_applied: 0, discount: 0, refunded_amount: 0 },
    { payment_method: 'free', payment_status: 'paid', status: 'Placed', total: 0, gift_card_applied: 700, discount: 0, refunded_amount: 0 },
    { payment_method: 'razorpay', payment_status: 'refunded', status: 'Cancelled', total: 799, gift_card_applied: 0, discount: 0, refunded_amount: 799 },
  ];
  const s = summarisePayments(rows);
  test('the split: online / COD (collected and pending) / free', () => {
    expect(s.online).toEqual({ orders: 2, amount: 3000, refunded: 300 });
    expect(s.cod.collected).toEqual({ orders: 1, amount: 800 });
    expect(s.cod.pending).toEqual({ orders: 1, amount: 1597 });
    expect(s.cod.orders).toBe(2);
    expect(s.free.orders).toBe(1);
    expect(s.orders).toBe(5);
  });
  test('refunds are explicit, and cancelled orders are not sales but their refunds are visible', () => {
    expect(s.refunds).toBe(300);
    expect(s.refundedOrders).toBe(1);
    expect(s.cancelled).toEqual({ orders: 1, refunds: 799 });
  });
  test('gift card and coupon money', () => {
    expect(s.giftCard).toBe(1200);
    expect(s.coupon).toBe(100);
  });
  test('methodOf copes with legacy rows', () => {
    expect(methodOf({ payment_method: 'razorpay', total: 5 })).toBe('online');
    expect(methodOf({ payment_method: null, total: 0 })).toBe('free');
    expect(methodOf({ payment_method: null, total: 100 })).toBe('online');
    expect(methodOf({ payment_method: 'cod', total: 100 })).toBe('cod');
  });
  test('table filters: range, method, status, refunds, cancelled handling', () => {
    const bounds = { fromISO: '2026-09-30T18:30:00.000Z', toISO: '2026-10-06T18:30:00.000Z' };
    expect(paymentFilters({}, bounds)).toEqual({ deleted_at: null, created_at: { gte: bounds.fromISO, lt: bounds.toISO }, status: { neq: 'Cancelled' } });
    expect(paymentFilters({ method: 'cod', pay: 'cod_pending', refunds: 'with', cancelled: 'include' }, bounds)).toEqual({
      deleted_at: null, created_at: { gte: bounds.fromISO, lt: bounds.toISO }, payment_method: 'cod', payment_status: 'cod_pending', refunded_amount: { gt: 0 },
    });
    expect(paymentFilters({ cancelled: 'only', refunds: 'without' }).status).toBe('Cancelled');
    expect(paymentFilters({ refunds: 'without' }).refunded_amount).toEqual({ lte: 0 });
  });
  test('payments CSV', () => {
    const o = { order_id: 'BL-1', created_at: '2026-10-06T10:12:00Z', user_name: 'Asha', user_email: 'a@b.test', payment_method: 'razorpay', payment_id: 'pay_1', total: 1000, gift_card_applied: 0, discount: 100, refunded_amount: 0, payment_status: 'paid', status: 'Delivered' };
    const lines = toCsv(PAYMENT_CSV_COLUMNS, [o]).slice(1).split('\r\n');
    expect(lines[1]).toBe('BL-1,2026-10-06 15:42,Asha,a@b.test,Online (Razorpay),pay_1,1000,0,100,0,paid,Delivered');
  });
});
