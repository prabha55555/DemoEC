import { toCsv } from '../lib/csv';
import { ORDER_CSV_COLUMNS, ORDER_LINE_CSV_COLUMNS, istStamp, orderLineRows } from './orderCsv';
import { code39Bars, code39Text, CODE39_PATTERNS } from './code39';

const order = {
  order_id: 'BL-20001', created_at: '2026-10-06T10:12:00Z', status: 'Delivered', payment_method: 'razorpay', payment_status: 'paid',
  user_name: 'Asha K', user_email: 'asha@example.test', user_phone: '9876543210',
  address: { name: 'Asha K', city: 'Chennai', state: 'Tamil Nadu', pincode: '600001' },
  items: [
    { id: 'p1', variantId: 'v1', name: 'Cotton Kurta Set', variantLabel: 'M / Red', sku: 'KURTA-M-R', qty: 2, price: 799, mrp: 999, gstRate: 5, hsn: '6204', lineDiscount: 100, cat: 'Kurtas' },
    { id: 'p2', variantId: 'v2', name: '=EVIL()', variantLabel: 'Default', sku: null, qty: 1, price: 200, gstRate: 18, cat: 'Misc', lineDiscount: 0 },
  ],
  subtotal: 1798, discount: 100, shipping: 40, cod_fee: 0, gift_card_applied: 0, tax_total: 100, total: 1738, refunded_amount: 0,
  payment_id: 'pay_abc', shipping_carrier: 'Delhivery', tracking_number: 'DL1',
};

describe('istStamp', () => {
  test('prints the India-time wall clock, sortable', () => {
    expect(istStamp('2026-10-06T10:12:00Z')).toBe('2026-10-06 15:42');
    expect(istStamp('2026-10-06T18:30:00Z')).toBe('2026-10-07 00:00');
  });
  test('empty or invalid input is empty text', () => {
    expect(istStamp(null)).toBe('');
    expect(istStamp('nope')).toBe('');
  });
});

describe('orders CSV (one row per order)', () => {
  const csv = toCsv(ORDER_CSV_COLUMNS, [order, { ...order, order_id: 'BL-2', inventory_issue: { reason: 'x' }, user_name: '', address: {}, items: [] }]).slice(1).split('\r\n');
  const header = csv[0].split(',');
  const row = csv[1].split(',');
  const at = (label) => row[header.indexOf(label)];
  test('header and one row each', () => {
    expect(csv).toHaveLength(3);
    expect(header[0]).toBe('Order number');
  });
  test('money is plain numbers and dates are India time', () => {
    expect(at('Order number')).toBe('BL-20001');
    expect(at('Placed (IST)')).toBe('2026-10-06 15:42');
    expect(at('Total charged')).toBe('1738');
    expect(at('Discount')).toBe('100');
    expect(at('Units')).toBe('3');
    expect(at('Payment method')).toBe('Online');
    expect(at('Payment status')).toBe('Paid');
    expect(at('Razorpay payment id')).toBe('pay_abc');
  });
  test('the flag column marks stock issues', () => {
    expect(csv[2].split(',')[header.indexOf('Needs attention')]).toBe('Stock issue');
  });
});

describe('order lines CSV (one row per line, with GST)', () => {
  const rows = orderLineRows([order], { defaultRate: 18, sellerState: 'Tamil Nadu' });
  const csv = toCsv(ORDER_LINE_CSV_COLUMNS, rows).slice(1).split('\r\n');
  const header = csv[0].split(',');
  const cell = (r, label) => csv[r].split(',')[header.indexOf(label)];
  test('one row per line', () => {
    expect(rows).toHaveLength(2);
    expect(csv).toHaveLength(3);
  });
  test('quantity, price, variant and SKU', () => {
    expect(cell(1, 'Product')).toBe('Cotton Kurta Set');
    expect(cell(1, 'Variant')).toBe('M / Red');
    expect(cell(1, 'SKU')).toBe('KURTA-M-R');
    expect(cell(1, 'Quantity')).toBe('2');
    expect(cell(1, 'Unit price (incl. GST)')).toBe('799');
    expect(cell(1, 'HSN')).toBe('6204');
  });
  test('GST is worked out on the price after the line coupon share (prices include GST)', () => {
    // 2 x 799 = 1598, less 100 = 1498 incl. 5% GST -> taxable 1426.67, GST 71.33
    expect(cell(1, 'Line total')).toBe('1498');
    expect(cell(1, 'GST rate %')).toBe('5');
    expect(cell(1, 'Taxable value')).toBe('1426.67');
    expect(cell(1, 'GST amount')).toBe('71.33');
  });
  test('a "Default" variant label is blank, and spreadsheet formulas in names are neutralised', () => {
    expect(cell(2, 'Variant')).toBe('');
    expect(csv[2]).toContain("'=EVIL()");
  });
  test('a gift card line has no GST columns', () => {
    const gift = orderLineRows([{ ...order, items: [{ name: 'Gift card', qty: 1, price: 500, isGiftCard: true }] }]);
    const c = toCsv(ORDER_LINE_CSV_COLUMNS, gift).slice(1).split('\r\n')[1].split(',');
    expect(c[header.indexOf('GST rate %')]).toBe('');
    expect(c[header.indexOf('Gift card')]).toBe('Yes');
    expect(c[header.indexOf('Line total')]).toBe('500');
  });
});

describe('Code 39 barcode', () => {
  test('every character is 9 elements with exactly 3 wide ones (the Code 39 rule)', () => {
    Object.entries(CODE39_PATTERNS).forEach(([ch, p]) => {
      expect(p).toHaveLength(9);
      expect(p.split('').filter(c => c === 'w')).toHaveLength(3);
      expect(`${ch}:${p.replace(/[nw]/g, '')}`).toBe(`${ch}:`);
    });
    expect(Object.keys(CODE39_PATTERNS)).toHaveLength(44); // 10 digits + 26 letters + 8 symbols (- . space * $ / + %)
  });
  test('every pattern is different', () => {
    expect(new Set(Object.values(CODE39_PATTERNS)).size).toBe(44);
  });
  test('text is upper-cased and anything outside the set becomes a dash', () => {
    expect(code39Text('bl-20001')).toBe('BL-20001');
    expect(code39Text('a_b*c#')).toBe('A-B-C-');
    expect(code39Text(null)).toBe('');
  });
  test('width: each char is 15 modules (6 narrow + 3 wide x 3) + 1 gap, with the * start and stop around it', () => {
    const { bars, width } = code39Bars('BL-20001');
    expect(width).toBe(10 * 15 + 9);
    expect(bars[0].x).toBe(0);                    // starts with a bar
    expect(bars).toHaveLength(10 * 5);            // 5 bars per character, 8 chars + start + stop
    const last = bars[bars.length - 1];
    expect(last.x + last.w).toBe(width);          // ends with a bar
  });
  test('bars never overlap', () => {
    const { bars } = code39Bars('BL-12345');
    for (let i = 1; i < bars.length; i += 1) expect(bars[i].x).toBeGreaterThanOrEqual(bars[i - 1].x + bars[i - 1].w);
  });
});
