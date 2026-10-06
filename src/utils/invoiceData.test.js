import { buildInvoice } from './invoiceData';

const brand = { brand_name: 'Brightlight', seller_legal_name: 'Brightlight Solutions LLP', seller_gstin: '33ABCDE1234F1Z5', seller_state: 'Tamil Nadu', default_gst_rate: 18, registered_office: 'Tiruppur', support_email: 'help@x.in' };

const order = (over = {}) => ({
  order_id: 'BL-20001', status: 'Delivered', payment_method: 'razorpay', payment_status: 'paid',
  address: { name: 'Asha', state: 'Tamil Nadu', city: 'Chennai', line1: '1 Road', pincode: '600001' },
  items: [
    { id: 'p1', variantId: 'v1', name: 'Kurta', variantLabel: 'M / Red', qty: 2, price: 560, mrp: 700, gstRate: 12, hsn: '6104' },
    { id: 'p2', variantId: 'v2', name: 'Charger', qty: 1, price: 590, gstRate: 18, hsn: '8504' },
  ],
  subtotal: 1710, shipping: 0, cod_fee: 0, discount: 0, gift_card_applied: 0, total: 1710,
  ...over,
});

describe('buildInvoice', () => {
  test('numbers the invoice after the order', () => {
    expect(buildInvoice(order(), brand).number).toBe('INV-BL-20001');
  });

  test('same state as the seller -> CGST + SGST halves, no IGST', () => {
    const inv = buildInvoice(order(), brand);
    expect(inv.intraState).toBe(true);
    expect(inv.igst).toBe(0);
    expect(inv.cgst).toBeGreaterThan(0);
    expect(inv.cgst).toBe(inv.sgst);
    // 1120 @12% -> 120 tax ; 590 @18% -> 90 tax
    expect(inv.lines[0]).toMatchObject({ gross: 1120, rate: 12, tax: 120, taxable: 1000, hsn: '6104', variantLabel: 'M / Red' });
    expect(inv.lines[1]).toMatchObject({ rate: 18, tax: 90, taxable: 500 });
    expect(inv.tax).toBe(210);
    expect(inv.taxable).toBe(1500);
  });

  test('a buyer in another state is charged IGST', () => {
    const inv = buildInvoice(order({ address: { name: 'Ravi', state: 'Kerala' } }), brand);
    expect(inv.intraState).toBe(false);
    expect(inv.cgst).toBe(0);
    expect(inv.sgst).toBe(0);
    expect(inv.igst).toBe(210);
  });

  test('the order discount is spread over the goods and reduces taxable value', () => {
    const inv = buildInvoice(order({ discount: 171, total: 1539 }), brand);
    expect(inv.lines.reduce((s, l) => s + l.discount, 0)).toBe(171);
    expect(inv.invoiceValue).toBe(1539);
    expect(inv.lines[0].amount + inv.lines[1].amount).toBe(1539);
  });

  test('delivery and COD fee are separate taxed lines and add to the invoice value', () => {
    const inv = buildInvoice(order({ shipping: 40, cod_fee: 25, total: 1775, payment_method: 'cod', payment_status: 'cod_pending' }), brand);
    expect(inv.deliveryLine).toMatchObject({ label: 'Delivery charge', amount: 40, rate: 18 });
    expect(inv.codLine).toMatchObject({ label: 'Cash on Delivery fee', amount: 25 });
    expect(inv.invoiceValue).toBe(1775);
    expect(inv.mode).toBe('cod');
    // tax on goods 210 + on 40 (6.1) + on 25 (3.81)
    expect(inv.tax).toBeCloseTo(210 + 6.1 + 3.81, 2);
  });

  test('a gift card line is listed without GST and a redeemed gift card is shown as payment, not discount', () => {
    const inv = buildInvoice(order({
      items: [{ id: 'g', isGiftCard: true, name: 'Gift card', qty: 1, price: 1000 }, { id: 'p2', variantId: 'v2', name: 'Charger', qty: 1, price: 590, gstRate: 18, hsn: '8504' }],
      subtotal: 1590, gift_card_applied: 500, total: 1090,
    }), brand);
    expect(inv.giftLines).toHaveLength(1);
    expect(inv.giftTotal).toBe(1000);
    expect(inv.tax).toBe(90);                 // only the charger carries GST
    expect(inv.invoiceValue).toBe(1590);      // billed value before the gift card pays part of it
    expect(inv.total).toBe(1090);
    expect(inv.giftCardApplied).toBe(500);
  });

  test('a scoped coupon uses each lines own recorded share instead of a proportional spread', () => {
    const inv = buildInvoice(order({
      items: [
        { id: 'p1', variantId: 'v1', name: 'Kurta', qty: 2, price: 560, gstRate: 12, hsn: '6104', lineDiscount: 100 },
        { id: 'p2', variantId: 'v2', name: 'Charger', qty: 1, price: 590, gstRate: 18, hsn: '8504', lineDiscount: 0 },
      ],
      subtotal: 1710, discount: 100, total: 1610,
    }), brand);
    expect(inv.lines[0].discount).toBe(100);
    expect(inv.lines[1].discount).toBe(0);
    expect(inv.invoiceValue).toBe(1610);
  });

  test('old orders with no GST data fall back to the store default rate', () => {
    const inv = buildInvoice(order({ items: [{ id: 'p1', name: 'Old bowl', size: 'L', qty: 1, price: 118 }], subtotal: 118, total: 118 }), brand);
    expect(inv.lines[0]).toMatchObject({ rate: 18, tax: 18, taxable: 100, variantLabel: 'L' });
  });

  test('amount in words follows the amount actually payable', () => {
    expect(buildInvoice(order(), brand).inWords).toBe('Rupees One Thousand Seven Hundred Ten Only');
  });

  test('seller block prefers the legal name', () => {
    expect(buildInvoice(order(), brand).seller).toMatchObject({ name: 'Brightlight Solutions LLP', gstin: '33ABCDE1234F1Z5', address: 'Tiruppur' });
    expect(buildInvoice(order(), { brand_name: 'Shop' }).seller.name).toBe('Shop');
  });
});
