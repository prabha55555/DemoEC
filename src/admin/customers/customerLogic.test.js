import { toCsv } from '../lib/csv';
import { CUSTOMER_CSV_COLUMNS, addressText, customerStats } from './customerLogic';

describe('customerStats', () => {
  const orders = [
    { total: 1000, refunded_amount: 0, status: 'Delivered', created_at: '2026-09-01T10:00:00Z' },
    { total: 500, refunded_amount: 200, status: 'Delivered', created_at: '2026-09-20T10:00:00Z' },
    { total: 800, refunded_amount: 800, status: 'Cancelled', created_at: '2026-10-02T10:00:00Z' },
    { total: '300', refunded_amount: '0', status: 'Placed', created_at: '2026-10-05T10:00:00Z' },
  ];
  const s = customerStats(orders);
  test('cancelled orders are not counted, a partial refund lowers the value', () => {
    expect(s.orders).toBe(3);
    expect(s.placed).toBe(4);
    expect(s.cancelled).toBe(1);
    expect(s.lifetime).toBe(1600); // 1000 + (500 - 200) + 300
    expect(s.refunded).toBe(200);
  });
  test('average order value is lifetime value over counted orders', () => {
    expect(s.average).toBe(533.33);
  });
  test('first and last order dates come from every order', () => {
    expect(s.firstAt).toBe('2026-09-01T10:00:00.000Z');
    expect(s.lastAt).toBe('2026-10-05T10:00:00.000Z');
  });
  test('a customer with no orders has zeros, not NaN', () => {
    expect(customerStats([])).toEqual({ placed: 0, orders: 0, cancelled: 0, lifetime: 0, average: 0, refunded: 0, firstAt: null, lastAt: null });
    expect(customerStats(null).orders).toBe(0);
  });
});

describe('customer CSV', () => {
  const rows = [
    { id: 'u1', name: 'Asha K', email: 'asha@example.test', phone: '9876543210', order_count: '3', total_spent: '1600.5', last_order_at: '2026-10-05T10:00:00Z', created_at: '2026-08-01T00:00:00Z', marketing_opt_in: true },
    { id: 'u2', name: '=cmd()', email: '', phone: null, order_count: 0, total_spent: 0, last_order_at: null, created_at: '2026-09-01T00:00:00Z', marketing_opt_in: false },
    { id: 'u3', name: 'No profile row', order_count: 1, total_spent: 10 },
  ];
  const lines = toCsv(CUSTOMER_CSV_COLUMNS, rows).slice(1).split('\r\n');
  test('has a marketing opt-in column and does not filter on it', () => {
    expect(lines[0].split(',')).toContain('Marketing opt-in');
    expect(lines).toHaveLength(4);
    expect(lines[1].split(',')[7]).toBe('Yes');
    expect(lines[2].split(',')[7]).toBe('No');
    expect(lines[3].split(',')[7]).toBe('');
  });
  test('numbers are plain, dates are dates, formulas are neutralised', () => {
    expect(lines[1]).toContain(',3,1600.5,2026-10-05,2026-08-01,');
    expect(lines[2]).toContain("'=cmd()");
  });
});

describe('addressText', () => {
  test('joins the lines like an address label', () => {
    expect(addressText({ name: 'Asha', line1: '12 Road', line2: 'Anna Nagar', city: 'Chennai', state: 'Tamil Nadu', pincode: '600040', phone: '98' }))
      .toBe('Asha\n12 Road, Anna Nagar\nChennai, Tamil Nadu 600040\nPhone: 98');
    expect(addressText(null)).toBe('');
  });
});
