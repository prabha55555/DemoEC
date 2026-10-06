import { ADJUST_REASONS, isOrderRef, lowStockLevel, planAdjustment, planBulk, reasonLabel, signed, stockErrorMessage, variantStockState } from './inventoryLogic';

describe('lowStockLevel', () => {
  test('a product level wins over the store level, which wins over 5', () => {
    expect(lowStockLevel({ low_stock_threshold: 12 }, { low_stock_threshold: 3 })).toBe(12);
    expect(lowStockLevel({ low_stock_threshold: 0 }, { low_stock_threshold: 3 })).toBe(0);
    expect(lowStockLevel({ low_stock_threshold: null }, { low_stock_threshold: 3 })).toBe(3);
    expect(lowStockLevel({}, {})).toBe(5);
    expect(lowStockLevel(null, null)).toBe(5);
  });
});

describe('variantStockState', () => {
  test('unlimited, out, low and in', () => {
    expect(variantStockState({ track_inventory: false, stock: 0 }, 5)).toBe('untracked');
    expect(variantStockState({ track_inventory: true, stock: 0 }, 5)).toBe('out');
    expect(variantStockState({ track_inventory: true, stock: 5 }, 5)).toBe('low');
    expect(variantStockState({ track_inventory: true, stock: 6 }, 5)).toBe('in');
    expect(variantStockState({ track_inventory: true, stock: '3' }, 5)).toBe('low');
  });
});

describe('planAdjustment', () => {
  test('add and remove send a delta; set sends an absolute number', () => {
    expect(planAdjustment({ mode: 'add', qty: '10', current: 4 })).toEqual({ ok: true, args: { p_delta: 10 }, delta: 10, resulting: 14 });
    expect(planAdjustment({ mode: 'remove', qty: '3', current: 4 })).toEqual({ ok: true, args: { p_delta: -3 }, delta: -3, resulting: 1 });
    expect(planAdjustment({ mode: 'set', qty: '0', current: 4 })).toEqual({ ok: true, args: { p_set_to: 0 }, delta: -4, resulting: 0 });
  });
  test('refuses to go below zero, and blank / fractional / zero input', () => {
    expect(planAdjustment({ mode: 'remove', qty: '5', current: 4 })).toMatchObject({ ok: false, error: expect.stringMatching(/more than the 4/) });
    expect(planAdjustment({ mode: 'add', qty: '', current: 4 })).toMatchObject({ ok: false });
    expect(planAdjustment({ mode: 'add', qty: '1.5', current: 4 })).toMatchObject({ ok: false });
    expect(planAdjustment({ mode: 'add', qty: '0', current: 4 })).toMatchObject({ ok: false });
    expect(planAdjustment({ mode: 'add', qty: '-2', current: 4 })).toMatchObject({ ok: false });
  });
});

describe('planBulk', () => {
  const rows = [
    { id: 'a', stock: 3, track_inventory: true }, { id: 'b', stock: 0, track_inventory: true },
    { id: 'c', stock: 9, track_inventory: false }, { id: 'd', stock: 10, track_inventory: true },
  ];
  test('set exact skips untracked rows and rows already at the level', () => {
    const { plan, skipped } = planBulk({ mode: 'set', qty: '10', rows });
    expect(plan.map(p => p.row.id)).toEqual(['a', 'b']);
    expect(skipped.map(s => [s.row.id, s.reason])).toEqual([['c', 'Not stock-tracked'], ['d', 'Already at that level']]);
  });
  test('remove skips rows that would go negative', () => {
    const { plan, skipped } = planBulk({ mode: 'remove', qty: '5', rows });
    expect(plan.map(p => p.row.id)).toEqual(['d']);
    expect(skipped.find(s => s.row.id === 'a').reason).toMatch(/more than/);
  });
});

describe('labels', () => {
  test('reasons, signs and order references', () => {
    expect(ADJUST_REASONS.map(r => r.value)).toEqual(['restock', 'recount', 'damaged', 'return', 'correction', 'other']);
    expect(reasonLabel('restock')).toBe('Received stock');
    expect(reasonLabel('cancel')).toBe('Order cancelled');
    expect(reasonLabel('custom_thing')).toBe('Custom thing');
    expect(signed(5)).toBe('+5');
    expect(signed(-3)).toBe('−3');
    expect(signed(0)).toBe('0');
    expect(isOrderRef('BL-20001')).toBe(true);
    expect(isOrderRef('Edited in product form')).toBe(false);
    expect(isOrderRef('')).toBe(false);
  });
});

describe('stockErrorMessage', () => {
  test('explains the "below zero" refusal from the database function', () => {
    expect(stockErrorMessage({ code: '22023', message: 'stock cannot go below zero (would be -3)' })).toBe("Stock can't go below zero (that would leave -3).");
  });
  test('permission, missing variant and anything else', () => {
    expect(stockErrorMessage({ code: '42501', message: 'not authorized' })).toMatch(/permission/);
    expect(stockErrorMessage({ code: 'P0002', message: 'VARIANT_NOT_FOUND: abc' })).toMatch(/no longer exists/);
    expect(stockErrorMessage({ message: 'Request timed out' })).toMatch(/Timed out/);
  });
});
