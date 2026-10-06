import {
  formatMoney, discountPercent, priceRange, isVariantPurchasable, variantStock, maxPurchasableQty, stockStatus,
  variantLabelFromOptions, findVariantBySelection, defaultSelection, optionValueState, reconcileSelection,
  cartLineFromVariant, lineKey, buildCategoryTree, categoryChain, descendantIds, attributeSchemaFor, specRows,
  productBadges, slugify,
} from './catalog';
import { shippingFor, shippingSummary } from './shipping';
import { computeTax, resolveGstRate } from './tax';
import { couponDiscountOf, couponEligibleFor, couponProblem } from './pricing';
import { canCancel, nextStatuses, trackerSteps, returnableLines, returnRefundAmount, normalizeStatus, refundCapBeforeDelivery, refundBeforeDeliveryMessage } from './orderStatus';

const brand = { free_shipping_threshold: 499, shipping_fee_metro: 40, shipping_fee_other: 60, cod_fee: 30, delivery_metro_cities: 'Chennai, Mumbai' };

describe('catalog: money and discounts', () => {
  test('formatMoney shows whole rupees without decimals and fractions with two', () => {
    expect(formatMoney(1299)).toBe('₹1,299');
    expect(formatMoney(1299.5)).toBe('₹1,299.50');
    expect(formatMoney('abc')).toBe('');
  });
  test('discountPercent only when mrp is above price', () => {
    expect(discountPercent(799, 999)).toBe(20);
    expect(discountPercent(999, 999)).toBe(0);
    expect(discountPercent(999, null)).toBe(0);
  });
  test('priceRange uses the rollup columns', () => {
    expect(priceRange({ price: 450, price_max: 600, mrp: 650 })).toMatchObject({ from: 450, to: 600, mrp: 650, percentOff: 31, isRange: true });
    expect(priceRange({ price: 450, price_max: 450, mrp: null })).toMatchObject({ from: 450, to: null, mrp: null, percentOff: 0, isRange: false });
  });
  test('productBadges: one merchandising badge plus an automatic % OFF', () => {
    expect(productBadges({ badge: 'Bestseller | Rare', price: 80, mrp: 100 })).toEqual(['Bestseller', '20% OFF']);
    expect(productBadges({ price: 99, mrp: 100 })).toEqual([]); // <5% is noise
  });
});

describe('catalog: inventory', () => {
  test('purchasable respects tracking, stock and active', () => {
    expect(isVariantPurchasable({ track_inventory: true, stock: 0 })).toBe(false);
    expect(isVariantPurchasable({ track_inventory: true, stock: 2 })).toBe(true);
    expect(isVariantPurchasable({ track_inventory: false, stock: 0 })).toBe(true);
    expect(isVariantPurchasable({ track_inventory: false, stock: 9, active: false })).toBe(false);
  });
  test('variantStock is null when untracked', () => {
    expect(variantStock({ track_inventory: false, stock: 5 })).toBeNull();
    expect(variantStock({ track_inventory: true, stock: 5 })).toBe(5);
  });
  test('maxPurchasableQty = min(stock, per-order cap)', () => {
    expect(maxPurchasableQty({ track_inventory: true, stock: 3 }, { max_qty_per_order: 10 })).toBe(3);
    expect(maxPurchasableQty({ track_inventory: true, stock: 50 }, { max_qty_per_order: 4 })).toBe(4);
    expect(maxPurchasableQty({ track_inventory: false }, {})).toBe(10);
  });
  test('stockStatus: in / low / out', () => {
    expect(stockStatus({ track_inventory: true, stock: 50 }, 5).state).toBe('in');
    expect(stockStatus({ track_inventory: true, stock: 3 }, 5)).toMatchObject({ state: 'low', text: 'Only 3 left' });
    expect(stockStatus({ track_inventory: true, stock: 0 }, 5).state).toBe('out');
  });
});

describe('catalog: multi-axis variants', () => {
  const variants = [
    { id: 'a', options: { Size: 'S', Colour: 'Red' }, track_inventory: true, stock: 2, position: 0 },
    { id: 'b', options: { Size: 'M', Colour: 'Red' }, track_inventory: true, stock: 0, position: 1 },
    { id: 'c', options: { Size: 'M', Colour: 'Blue' }, track_inventory: true, stock: 4, position: 2 },
  ];
  test('label is ordered by option_types', () => {
    expect(variantLabelFromOptions({ Colour: 'Red', Size: 'S' }, [{ name: 'Size' }, { name: 'Colour' }])).toBe('S / Red');
    expect(variantLabelFromOptions({}, [])).toBe('Default');
  });
  test('findVariantBySelection needs the full selection', () => {
    expect(findVariantBySelection(variants, { Size: 'M', Colour: 'Blue' }).id).toBe('c');
    expect(findVariantBySelection(variants, { Size: 'M' })).toBeUndefined();
  });
  test('default selection prefers something purchasable', () => {
    expect(defaultSelection([variants[1], variants[2]]).variant.id).toBe('c');
  });
  test('option value state reflects the other chosen options', () => {
    expect(optionValueState(variants, 'Size', 'M', { Colour: 'Red' })).toBe('soldout');
    expect(optionValueState(variants, 'Size', 'M', { Colour: 'Blue' })).toBe('available');
    expect(optionValueState(variants, 'Size', 'S', { Colour: 'Blue' })).toBe('invalid');
  });
  test('reconcileSelection keeps the selection valid', () => {
    expect(reconcileSelection(variants, 'Colour', 'Blue', { Size: 'S', Colour: 'Red' })).toEqual({ Size: 'M', Colour: 'Blue' });
  });
});

describe('catalog: cart line + categories', () => {
  const product = { id: 'p1', name: 'Tee', images: ['/a.jpg'], brand: 'Acme', cat: 'Men', max_qty_per_order: 5, free_shipping: false, delivery_min_days: 3, delivery_max_days: 6 };
  const variant = { id: 'v1', sku: 'T-S', label: 'S', options: { Size: 'S' }, price: 500, mrp: 700, stock: 2, track_inventory: true };
  test('cart line is keyed by variant and carries a display snapshot', () => {
    const line = cartLineFromVariant(product, variant, { categoryIds: ['c1', 'g1'] });
    expect(lineKey(line)).toBe('v1');
    expect(line).toMatchObject({ id: 'p1', variantId: 'v1', variantLabel: 'S', price: 500, mrp: 700, stock: 2, maxQty: 2, image: '/a.jpg', deliveryMinDays: 3 });
    expect(lineKey({ isGiftCard: true, id: 'g' })).toBe('gc:g');
  });
  test('"Default" variant label is not shown to shoppers', () => {
    expect(cartLineFromVariant(product, { ...variant, label: 'Default', options: {} }).variantLabel).toBe('');
  });
  const cats = [
    { id: 'g1', parent_id: null, name: 'Fashion', sort_order: 1, attribute_schema: [{ key: 'material', label: 'Fabric' }] },
    { id: 'c1', parent_id: 'g1', name: 'Men', sort_order: 1, attribute_schema: [{ key: 'fit', label: 'Fit' }] },
    { id: 'c2', parent_id: 'g1', name: 'Kids', sort_order: 2, attribute_schema: [] },
  ];
  test('tree, chain and descendants', () => {
    expect(buildCategoryTree(cats)[0].children.map(c => c.name)).toEqual(['Men', 'Kids']);
    expect(categoryChain(cats, 'c1').map(c => c.id)).toEqual(['c1', 'g1']);
    expect(descendantIds(cats, 'g1').sort()).toEqual(['c1', 'c2', 'g1']);
  });
  test('attribute schema is inherited and spec rows follow it', () => {
    expect(attributeSchemaFor(cats, 'c1').map(a => a.key)).toEqual(['material', 'fit']);
    const rows = specRows({ category_id: 'c1', attributes: { fit: 'Slim', material: 'Cotton', extra_note: 'x', blank: '' } }, cats);
    expect(rows.map(r => [r.label, r.value])).toEqual([['Fabric', 'Cotton'], ['Fit', 'Slim'], ['Extra note', 'x']]);
  });
  test('slugify', () => { expect(slugify('Bags, Footwear & Jewellery')).toBe('bags-footwear-and-jewellery'); });
});

describe('shipping rules', () => {
  const cart = (price, extra = {}) => [{ price, qty: 1, ...extra }];
  test('free at or above the threshold, judged on the cart value before coupons', () => {
    expect(shippingFor({ cart: cart(600), address: { city: 'Chennai' }, brand })).toMatchObject({ fee: 0, free: true, reason: 'threshold' });
    expect(shippingFor({ cart: cart(450), address: { city: 'Chennai' }, brand })).toMatchObject({ fee: 40, free: false, away: 49 });
  });
  test('metro vs rest of India fee', () => {
    expect(shippingFor({ cart: cart(100), address: { city: 'Mumbai' }, brand }).fee).toBe(40);
    expect(shippingFor({ cart: cart(100), address: { city: 'Shillong' }, brand }).fee).toBe(60);
  });
  test('no address yet: lower fee, marked estimated', () => {
    const s = shippingFor({ cart: cart(100), address: null, brand });
    expect(s).toMatchObject({ fee: 40, estimated: true });
    expect(shippingSummary({ shipping: s, brand })).toBe('₹40 - ₹60');
  });
  test('gift cards only, or all items free-shipping -> free', () => {
    expect(shippingFor({ cart: [{ price: 1000, qty: 1, isGiftCard: true }], brand }).free).toBe(true);
    expect(shippingFor({ cart: cart(100, { freeShipping: true }), address: { city: 'Mumbai' }, brand }).fee).toBe(0);
  });
  test('COD adds the COD fee, even when delivery is free', () => {
    expect(shippingFor({ cart: cart(900), address: { city: 'Mumbai' }, brand, paymentMethod: 'cod' })).toMatchObject({ fee: 0, codFee: 30 });
  });
  test('threshold 0 means no free-shipping threshold; both fees 0 = free everywhere', () => {
    expect(shippingFor({ cart: cart(5000), address: { city: 'Mumbai' }, brand: { ...brand, free_shipping_threshold: 0 } }).fee).toBe(40);
    expect(shippingFor({ cart: cart(1), address: { city: 'Mumbai' }, brand: { free_shipping_threshold: 0, shipping_fee_metro: 0, shipping_fee_other: 0 } }).free).toBe(true);
  });
});

describe('GST breakup (tax-inclusive)', () => {
  test('rate resolution: product -> category -> default', () => {
    expect(resolveGstRate({ product: { gst_rate: 5 }, categoryChain: [{ gst_rate: 12 }], defaultRate: 18 })).toBe(5);
    expect(resolveGstRate({ product: {}, categoryChain: [{ gst_rate: null }, { gst_rate: 12 }], defaultRate: 18 })).toBe(12);
    expect(resolveGstRate({ product: {}, categoryChain: [], defaultRate: 18 })).toBe(18);
  });
  test('intra-state splits into CGST + SGST; totals reconcile with the price', () => {
    const t = computeTax({ lines: [{ key: 'a', qty: 2, price: 590, gstRate: 18 }], discount: 0, shipping: 0, sellerState: 'Tamil Nadu', buyerState: 'tamil nadu' });
    expect(t.intraState).toBe(true);
    expect(t.lines[0]).toMatchObject({ gross: 1180, taxable: 1000, tax: 180, cgst: 90, sgst: 90, igst: 0 });
    expect(t.totals.taxable + t.totals.tax).toBeCloseTo(1180, 2);
  });
  test('inter-state is IGST', () => {
    const t = computeTax({ lines: [{ key: 'a', qty: 1, price: 118, gstRate: 18 }], sellerState: 'Tamil Nadu', buyerState: 'Kerala' });
    expect(t.lines[0]).toMatchObject({ taxable: 100, tax: 18, cgst: 0, sgst: 0, igst: 18 });
  });
  test('discount is allocated proportionally and shipping is taxed too', () => {
    const t = computeTax({ lines: [{ key: 'a', qty: 1, price: 600, gstRate: 18 }, { key: 'b', qty: 1, price: 400, gstRate: 5 }], discount: 100, shipping: 59, sellerState: 'X', buyerState: 'X' });
    expect(t.lines[0].discount).toBe(60);
    expect(t.lines[1].discount).toBe(40);
    expect(t.lines[0].net + t.lines[1].net).toBe(900);
    expect(t.shipping).toMatchObject({ gross: 59, taxable: 50, tax: 9 });
  });
});

describe('coupons', () => {
  const cart = [
    { id: 'p1', price: 500, qty: 2, categoryIds: ['c1', 'g1'] },
    { id: 'p2', price: 300, qty: 1, categoryIds: ['c9'] },
    { id: 'gc', price: 1000, qty: 1, isGiftCard: true },
  ];
  test('percent coupon never discounts a gift card; max_discount caps it', () => {
    expect(couponDiscountOf(cart, { type: 'percent', value: 10, applies_to: 'all' })).toBe(130);
    expect(couponDiscountOf(cart, { type: 'percent', value: 10, applies_to: 'all', max_discount: 100 })).toBe(100);
    expect(couponDiscountOf(cart, { type: 'percent', value: 150, applies_to: 'all' })).toBe(1300);
  });
  test('category-scoped coupons use the category + ancestors on each line', () => {
    const c = { type: 'flat', value: 200, applies_to: 'categories', category_ids: ['g1'] };
    expect(couponEligibleFor(cart, c)).toBe(c);
    expect(couponDiscountOf(cart, c)).toBe(200);
    expect(couponEligibleFor(cart, { ...c, category_ids: ['zzz'] })).toBeNull();
  });
  test('couponProblem: dates, usage, minimum order, first order, per-user', () => {
    const base = { type: 'percent', value: 10, applies_to: 'all', active: true };
    expect(couponProblem(cart, base)).toBeNull();
    expect(couponProblem(cart, { ...base, expires_at: '2000-01-01' })).toMatch(/expired/);
    expect(couponProblem(cart, { ...base, starts_at: '2999-01-01' })).toMatch(/not active yet/);
    expect(couponProblem(cart, { ...base, max_uses: 5, times_used: 5 })).toMatch(/usage limit/);
    expect(couponProblem(cart, { ...base, min_order_value: 2000 })).toMatch(/Add items worth ₹700 more/);
    expect(couponProblem(cart, { ...base, first_order_only: true }, { userOrderCount: 2 })).toMatch(/first order/);
    expect(couponProblem(cart, { ...base, per_user_limit: 1 }, { userUses: 1 })).toMatch(/maximum number/);
  });
});

describe('order lifecycle', () => {
  test('legacy statuses normalise to Placed', () => {
    expect(normalizeStatus('Paid')).toBe('Placed');
    expect(normalizeStatus('Pending')).toBe('Placed');
  });
  test('customers can cancel only before dispatch; admins until delivered', () => {
    expect(canCancel({ status: 'Packed' })).toBe(true);
    expect(canCancel({ status: 'Shipped' })).toBe(false);
    expect(canCancel({ status: 'Shipped' }, 'admin')).toBe(true);
    expect(canCancel({ status: 'Delivered' }, 'admin')).toBe(false);
  });
  test('admin may only move forward, or cancel', () => {
    expect(nextStatuses({ status: 'Confirmed' })).toEqual(['Packed', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled']);
    expect(nextStatuses({ status: 'Delivered' })).toEqual([]);
    expect(nextStatuses({ status: 'Cancelled' })).toEqual([]);
  });
  test('tracker marks done/current and stops at cancellation', () => {
    const steps = trackerSteps({ status: 'Shipped', timeline: [{ status: 'Placed', at: 't1' }] });
    expect(steps.filter(s => s.done).map(s => s.label)).toEqual(['Placed', 'Confirmed', 'Packed', 'Shipped']);
    expect(steps.find(s => s.current).label).toBe('Shipped');
    expect(steps[0].at).toBe('t1');
    const cancelled = trackerSteps({ status: 'Cancelled', timeline: [{ status: 'Placed', at: 't1' }, { status: 'Cancelled', at: 't2' }] });
    expect(cancelled.map(s => s.label)).toEqual(['Placed', 'Cancelled']);
  });
  test('returns: only delivered orders, inside each line\'s window, minus what was already requested', () => {
    const day = 86400000;
    const order = { status: 'Delivered', delivered_at: new Date(Date.now() - 3 * day).toISOString(), discount: 100, items: [
      { id: 'p1', variantId: 'v1', qty: 2, price: 500, returnWindowDays: 7 },
      { id: 'p2', variantId: 'v2', qty: 1, price: 500, returnWindowDays: 2 },
      { id: 'p3', variantId: 'v3', qty: 1, price: 500, returnWindowDays: 0 },
      { id: 'g', isGiftCard: true, qty: 1, price: 100 },
    ] };
    const r = returnableLines(order, { v1: 1 });
    expect(r.eligible).toBe(true);
    expect(r.lines.map(l => [l.key, l.returnableQty])).toEqual([['v1', 1]]);
    expect(returnableLines({ ...order, status: 'Shipped' }).eligible).toBe(false);
    expect(returnableLines(order, { v1: 2 }).eligible).toBe(false);
    // refund: price minus the line's share of the order discount (100 over 2000 merchandise = 5%)
    expect(returnRefundAmount(order, [{ price: 500, qty: 1 }])).toBe(475);
  });
  test('before delivery an admin refund may only be partial (Rs 1 stays); after delivery there is no cap', () => {
    expect(refundCapBeforeDelivery({ status: 'Placed', total: 1000, refunded_amount: 0 })).toBe(999);
    expect(refundCapBeforeDelivery({ status: 'Out for Delivery', total: 1000, refunded_amount: 400 })).toBe(599);
    expect(refundCapBeforeDelivery({ status: 'Paid', total: 500, refunded_amount: 0 })).toBe(499);   // legacy status = Placed
    expect(refundCapBeforeDelivery({ status: 'Shipped', total: 1000, refunded_amount: 999.5 })).toBe(0);   // never negative
    for (const status of ['Delivered', 'Cancelled', 'Returned']) expect(refundCapBeforeDelivery({ status, total: 1000, refunded_amount: 0 })).toBeNull();
  });
  test('the "cancel instead" message names the limit and the way out', () => {
    expect(refundBeforeDeliveryMessage(999)).toMatch(/up to ₹999\b/);
    expect(refundBeforeDeliveryMessage(999)).toMatch(/cancel the order instead/);
    expect(refundBeforeDeliveryMessage(0)).not.toMatch(/up to/);
  });
});

describe('per-line coupon discounts (a scoped coupon must not leak onto other lines)', () => {
  const { couponLineDiscounts } = require('./pricing');
  const { returnRefundAmount: refundFor } = require('./orderStatus');
  const { computeTax: taxFor } = require('./tax');
  const cart = [{ id: 'A', variantId: 'vA', price: 1000, qty: 1 }, { id: 'B', variantId: 'vB', price: 1000, qty: 1 }];
  const half = { type: 'percent', value: 50, applies_to: 'products', product_ids: ['A'] };

  test('allocation covers only the lines the coupon applies to and sums to the discount', () => {
    expect(couponLineDiscounts(cart, half, 500)).toEqual({ vA: 500 });
    const all = couponLineDiscounts([{ id: 'A', variantId: 'vA', price: 700, qty: 1 }, { id: 'B', variantId: 'vB', price: 300, qty: 1 }], { applies_to: 'all' }, 100);
    expect(all).toEqual({ vA: 70, vB: 30 });
    expect(Object.values(couponLineDiscounts([{ id: 'A', variantId: 'v1', price: 333, qty: 1 }, { id: 'B', variantId: 'v2', price: 333, qty: 1 }, { id: 'C', variantId: 'v3', price: 333, qty: 1 }], { applies_to: 'all' }, 100)).reduce((s, n) => s + n, 0)).toBeCloseTo(100, 2);
  });

  test('returning the discounted item refunds what was paid for it; the other item is full price', () => {
    const order = { discount: 500, items: [{ variantId: 'vA', qty: 1, price: 1000, lineDiscount: 500 }, { variantId: 'vB', qty: 1, price: 1000, lineDiscount: 0 }] };
    expect(refundFor(order, [{ variantId: 'vA', price: 1000, qty: 1 }])).toBe(500);
    expect(refundFor(order, [{ variantId: 'vB', price: 1000, qty: 1 }])).toBe(1000);
  });

  test('part of a discounted multi-unit line gets its pro-rata share', () => {
    const order = { discount: 200, items: [{ variantId: 'vA', qty: 4, price: 500, lineDiscount: 200 }] };
    expect(refundFor(order, [{ variantId: 'vA', price: 500, qty: 1 }])).toBe(450);
  });

  test('tax uses the recorded line discounts', () => {
    const t = taxFor({ lines: [{ key: 'vA', qty: 1, price: 1000, gstRate: 18, lineDiscount: 500 }, { key: 'vB', qty: 1, price: 1000, gstRate: 18, lineDiscount: 0 }], discount: 500, sellerState: 'X', buyerState: 'Y' });
    expect(t.lines[0].net).toBe(500);
    expect(t.lines[1].net).toBe(1000);
  });
});
