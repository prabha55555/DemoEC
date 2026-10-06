import { toCsv } from '../lib/csv';
import { buildInvoice } from '../../utils/invoiceData';
import { GST_HSN_CSV_COLUMNS, GST_RATE_CSV_COLUMNS, aggregateGst, gstRateRows, orderGst } from './gstMath';

const brand = { seller_state: 'Tamil Nadu', default_gst_rate: 18 };
const opts = { defaultRate: 18, sellerState: 'Tamil Nadu' };

const intra = {
  order_id: 'BL-1', status: 'Delivered', address: { state: 'Tamil Nadu' }, discount: 100, shipping: 40, cod_fee: 0, total: 1738, refunded_amount: 0,
  items: [
    { name: 'Kurta', qty: 2, price: 799, gstRate: 5, hsn: '6204', lineDiscount: 100 },
    { name: 'Charger', qty: 1, price: 200, gstRate: 18, hsn: '8504', lineDiscount: 0 },
  ],
};
const inter = {
  order_id: 'BL-2', status: 'Placed', address: { state: 'Karnataka' }, discount: 0, shipping: 0, cod_fee: 59, total: 559, refunded_amount: 100,
  items: [{ name: 'Charger', qty: 2, price: 250, gstRate: 18, hsn: '8504' }],
};

describe('orderGst', () => {
  test('matches the order\'s own invoice, line by line (same state: CGST + SGST)', () => {
    const g = orderGst(intra, opts);
    const inv = buildInvoice({ ...intra, items: intra.items }, brand);
    const sum = (k) => Math.round(g.parts.reduce((s, p) => s + p[k], 0) * 100) / 100;
    expect(sum('taxable')).toBe(inv.taxable);
    expect(sum('tax')).toBe(inv.tax);
    expect(sum('cgst')).toBe(inv.cgst);
    expect(sum('sgst')).toBe(inv.sgst);
    expect(sum('igst')).toBe(0);
    expect(g.intra).toBe(true);
  });
  test('another state: IGST, and the cash-on-delivery fee is taxed at the default rate like on the invoice', () => {
    const g = orderGst(inter, opts);
    const inv = buildInvoice(inter, brand);
    const sum = (k) => Math.round(g.parts.reduce((s, p) => s + p[k], 0) * 100) / 100;
    expect(sum('taxable')).toBe(inv.taxable);
    expect(sum('igst')).toBe(inv.igst);
    expect(sum('cgst')).toBe(0);
    expect(g.parts.map(p => p.kind)).toEqual(['goods', 'cod']);
    expect(g.intra).toBe(false);
  });
  test('a gift card line carries no GST', () => {
    const g = orderGst({ ...intra, items: [{ name: 'Gift card', qty: 1, price: 500, isGiftCard: true }], shipping: 0, discount: 0 }, opts);
    expect(g.parts).toEqual([]);
    expect(g.giftTotal).toBe(500);
  });
  test('an old line with no stored rate uses the store default', () => {
    const g = orderGst({ address: {}, discount: 0, shipping: 0, items: [{ name: 'Old', qty: 1, price: 118 }] }, opts);
    expect(g.parts[0]).toMatchObject({ rate: 18, taxable: 100, tax: 18 });
  });
});

describe('aggregateGst', () => {
  const report = aggregateGst([intra, inter, { ...intra, status: 'Cancelled' }], opts);
  test('cancelled orders are left out', () => {
    expect(report.orders).toBe(2);
  });
  test('one line per GST rate, lowest first, with CGST / SGST / IGST kept apart', () => {
    expect(report.byRate.map(r => r.rate)).toEqual([5, 18]);
    const five = report.byRate[0];
    // 2 x 799 - 100 = 1498 incl. 5% -> taxable 1426.67, GST 71.33 -> 35.67 + 35.66 (the halves)
    expect(five).toMatchObject({ taxable: 1426.67, tax: 71.33, igst: 0 });
    expect(five.cgst + five.sgst).toBeCloseTo(71.33, 2);
    const eighteen = report.byRate[1];
    expect(eighteen.igst).toBeGreaterThan(0);          // the Karnataka order
    expect(eighteen.cgst).toBeGreaterThan(0);          // the Tamil Nadu order
  });
  test('the totals are the sum of the rate lines', () => {
    const t = report.totals;
    expect(t.taxable).toBeCloseTo(report.byRate.reduce((s, r) => s + r.taxable, 0), 2);
    expect(t.tax).toBeCloseTo(report.byRate.reduce((s, r) => s + r.tax, 0), 2);
    expect(t.value).toBeCloseTo(t.taxable + t.tax, 2);
  });
  test('invoice value across the orders equals what they were billed (items - discount + delivery + COD fee)', () => {
    // intra: 1598 + 200 - 100 + 40 = 1738 ; inter: 500 + 59 = 559
    expect(report.totals.value).toBeCloseTo(1738 + 559, 2);
  });
  test('intra / inter counts, refunds and returns are shown explicitly', () => {
    expect(report.intraOrders).toBe(1);
    expect(report.interOrders).toBe(1);
    expect(report.refunded).toBe(100);
    expect(aggregateGst([{ ...intra, status: 'Returned' }], opts).returnedOrders).toBe(1);
  });
  test('HSN lines: goods per HSN + rate, delivery / COD charges together at the end', () => {
    expect(report.hsn.map(h => `${h.hsn}@${h.rate}`)).toEqual(['6204@5', '8504@18', 'Delivery / COD charges@18']);
    expect(report.hsn[1].qty).toBe(3);
  });
  test('no orders: an empty, valid report', () => {
    const empty = aggregateGst([], opts);
    expect(empty).toMatchObject({ byRate: [], hsn: [], orders: 0, totals: { taxable: 0, tax: 0, value: 0 } });
  });
  test('gift card sales are reported separately (not taxable)', () => {
    expect(aggregateGst([{ ...intra, items: [{ name: 'GC', qty: 2, price: 500, isGiftCard: true }], shipping: 0, discount: 0 }], opts).giftCardSales).toBe(1000);
  });
});

describe('GST CSV', () => {
  const report = aggregateGst([intra, inter], opts);
  test('by rate, with a Total row for filing', () => {
    const lines = toCsv(GST_RATE_CSV_COLUMNS, gstRateRows(report)).slice(1).split('\r\n');
    expect(lines[0]).toBe('GST rate %,Taxable value,CGST,SGST,IGST,Total GST,Invoice value (incl. GST)');
    expect(lines).toHaveLength(4);
    expect(lines[3].startsWith('Total,')).toBe(true);
  });
  test('by HSN', () => {
    const lines = toCsv(GST_HSN_CSV_COLUMNS, report.hsn).slice(1).split('\r\n');
    expect(lines[0]).toBe('HSN,GST rate %,Units,Taxable value,CGST,SGST,IGST,Total GST,Invoice value (incl. GST)');
    expect(lines).toHaveLength(4);
  });
});
