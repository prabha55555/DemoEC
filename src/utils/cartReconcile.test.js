import { reconcileCart, storedKey } from './cartReconcile';

const product = (over = {}) => ({ id: 'p1', status: 'active', name: 'Tee', brand: 'Acme', cat: 'Men', category_id: 'c1', images: ['/a.jpg'], max_qty_per_order: 5, free_shipping: false, cod_allowed: true, delivery_min_days: 3, delivery_max_days: 6, ...over });
const variant = (over = {}) => ({ id: 'v1', product_id: 'p1', sku: 'T-S', label: 'S', options: { Size: 'S' }, price: 500, mrp: 700, stock: 4, track_inventory: true, active: true, position: 0, ...over });
const line = (over = {}) => ({ id: 'p1', variantId: 'v1', name: 'Tee', price: 500, qty: 1, ...over });

describe('reconcileCart', () => {
  test('refreshes price, MRP, image and limits from the live variant', () => {
    const r = reconcileCart([line({ price: 450 })], [product()], [variant()]);
    expect(r.lines[0]).toMatchObject({ variantId: 'v1', price: 500, mrp: 700, image: '/a.jpg', maxQty: 4, stock: 4, soldOut: false });
    expect(r.repriced).toBe(1);
  });

  test('drops lines whose product is gone, unpublished or whose variant is gone/inactive', () => {
    expect(reconcileCart([line()], [], []).removed).toBe(1);
    expect(reconcileCart([line()], [product({ status: 'draft' })], [variant()]).removed).toBe(1);
    expect(reconcileCart([line()], [product()], [variant({ active: false })]).removed).toBe(1);
    expect(reconcileCart([line({ variantId: 'gone' })], [product()], [variant()]).removed).toBe(1);
  });

  test('lowers quantity to what is in stock (and to the per-order cap)', () => {
    const r = reconcileCart([line({ qty: 9 })], [product()], [variant({ stock: 3 })]);
    expect(r.lines[0].qty).toBe(3);
    expect(r.adjusted).toBe(1);
    const capped = reconcileCart([line({ qty: 9 })], [product({ max_qty_per_order: 2 })], [variant({ stock: 50 })]);
    expect(capped.lines[0].qty).toBe(2);
  });

  test('keeps a sold-out line, flagged, so the cart can say so', () => {
    const r = reconcileCart([line({ qty: 2 })], [product()], [variant({ stock: 0 })]);
    expect(r.lines[0]).toMatchObject({ soldOut: true, qty: 2, stock: 0 });
    expect(r.removed).toBe(0);
  });

  test('untracked stock is never limited', () => {
    const r = reconcileCart([line({ qty: 4 })], [product({ max_qty_per_order: 10 })], [variant({ track_inventory: false, stock: 0 })]);
    expect(r.lines[0]).toMatchObject({ soldOut: false, stock: null, qty: 4 });
  });

  test('upgrades a legacy (id + size) line by matching the migrated variant label', () => {
    const legacy = { id: 'p1', size: 'M', name: 'Tee', price: 500, qty: 1 };
    const r = reconcileCart([legacy], [product()], [variant({ id: 'vS', label: 'S' }), variant({ id: 'vM', label: 'M', options: { Size: 'M' } })]);
    expect(r.lines[0].variantId).toBe('vM');
  });

  test('a legacy line for a single-variant product maps to it; an ambiguous one is dropped', () => {
    const legacy = { id: 'p1', name: 'Tee', price: 500, qty: 1 };
    expect(reconcileCart([legacy], [product()], [variant({ label: 'Default' })]).lines[0].variantId).toBe('v1');
    const two = [variant({ id: 'a', label: 'A' }), variant({ id: 'b', label: 'B' })];
    expect(reconcileCart([legacy], [product()], two).removed).toBe(1);
  });

  test('gift cards pass through untouched', () => {
    const gift = { isGiftCard: true, id: 'g1', price: 1000, qty: 1, name: 'Gift card' };
    expect(reconcileCart([gift], [], []).lines).toEqual([gift]);
  });

  test('category ids for category coupons come from the callback', () => {
    const r = reconcileCart([line()], [product()], [variant()], () => ['c1', 'g1']);
    expect(r.lines[0].categoryIds).toEqual(['c1', 'g1']);
  });

  test('entries pair every original with its result (null = dropped), so a caller can merge safely', () => {
    const a = line(); const b = line({ variantId: 'gone' });
    const r = reconcileCart([a, b], [product()], [variant()]);
    expect(r.entries.map(e => [storedKey(e.original), !!e.line])).toEqual([['v1', true], ['gone', false]]);
  });

  test('storedKey: variant id, gift id, or product+size for legacy lines', () => {
    expect(storedKey({ variantId: 'v9' })).toBe('v9');
    expect(storedKey({ isGiftCard: true, id: 'g' })).toBe('gc:g');
    expect(storedKey({ id: 'p1', size: 'M' })).toBe('p1::M');
  });
});
