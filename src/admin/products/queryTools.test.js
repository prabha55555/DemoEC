import { combineOr, lowStockGroups, productOrder, productSearchGroups, searchTerms, sortState, toggleSort } from './queryTools';

describe('combineOr', () => {
  test('either side alone is just joined', () => {
    expect(combineOr(['a.eq.1', 'b.eq.2'], [])).toBe('a.eq.1,b.eq.2');
    expect(combineOr([], ['c.eq.3'])).toBe('c.eq.3');
    expect(combineOr([], [])).toBe('');
  });
  test('two OR lists become one OR of ANDs (their cross product)', () => {
    expect(combineOr(['and(x.eq.1,y.eq.2)', 'z.eq.3'], ['s.ilike.%a%', 'p.in.(1,2)'])).toBe(
      'and(x.eq.1,y.eq.2,s.ilike.%a%),and(x.eq.1,y.eq.2,p.in.(1,2)),and(z.eq.3,s.ilike.%a%),and(z.eq.3,p.in.(1,2))',
    );
  });
});

describe('lowStockGroups', () => {
  test('without overrides: one alternative at the store level', () => {
    expect(lowStockGroups({ column: 'stock', idColumn: 'product_id', storeLevel: 5, extra: ['active.eq.true', 'track_inventory.eq.true'] }))
      .toEqual(['and(active.eq.true,track_inventory.eq.true,stock.lte.5)']);
  });
  test('products with their own level are grouped by level; the rest use the store level', () => {
    const g = lowStockGroups({ column: 'total_stock', idColumn: 'id', storeLevel: 5, extra: ['in_stock.eq.true'], overrides: [{ id: 'a', level: 10 }, { id: 'b', level: 10 }, { id: 'c', level: 2 }] });
    expect(g).toEqual([
      'and(in_stock.eq.true,id.not.in.(a,b,c),total_stock.lte.5)',
      'and(in_stock.eq.true,id.in.(a,b),total_stock.lte.10)',
      'and(in_stock.eq.true,id.in.(c),total_stock.lte.2)',
    ]);
  });
  test('ignores overrides without a usable level and caps the list', () => {
    const g = lowStockGroups({ column: 'stock', idColumn: 'product_id', storeLevel: 3, overrides: [{ id: 'a', level: NaN }, { id: '', level: 1 }] });
    expect(g).toEqual(['and(stock.lte.3)']);
    const many = Array.from({ length: 200 }, (_, i) => ({ id: `p${i}`, level: 1 }));
    expect(lowStockGroups({ column: 'stock', idColumn: 'product_id', storeLevel: 3, overrides: many, maxOverrides: 5 })[0].match(/p\d+/g)).toHaveLength(5);
  });
});

describe('search groups', () => {
  test('searchTerms strips filter syntax characters', () => {
    expect(searchTerms('  Red, (Shirt) 50% ')).toEqual(['red', 'shirt', '50']);
    expect(searchTerms('')).toEqual([]);
  });
  test('words must all match; explicit ids are an alternative', () => {
    expect(productSearchGroups({ words: ['red'], ids: [] })).toEqual(['search_text.ilike.%red%']);
    expect(productSearchGroups({ words: ['red', 'shirt'], ids: ['1', '2', '1'] })).toEqual(['and(search_text.ilike.%red%,search_text.ilike.%shirt%)', 'id.in.(1,2)']);
    expect(productSearchGroups({ words: [], ids: ['9'], idColumn: 'product_id' })).toEqual(['product_id.in.(9)']);
    expect(productSearchGroups({ words: [], ids: [] })).toEqual([]);
  });
});

describe('sorting', () => {
  test('every sort ends on id so pages never repeat a row', () => {
    for (const k of ['newest', 'name_asc', 'price_desc', 'stock_asc', 'sales_desc']) {
      const o = productOrder(k);
      expect(o[o.length - 1]).toEqual({ column: 'id', ascending: true });
    }
    expect(productOrder('nope')[0]).toEqual({ column: 'created_at', ascending: false });
  });
  test('toggleSort flips direction on the same column and picks a sensible default on a new one', () => {
    expect(toggleSort('newest', 'name')).toBe('name_asc');
    expect(toggleSort('name_asc', 'name')).toBe('name_desc');
    expect(toggleSort('name_desc', 'name')).toBe('name_asc');
    expect(toggleSort('newest', 'sales')).toBe('sales_desc');
    expect(toggleSort('price_asc', 'stock')).toBe('stock_asc');
  });
  test('sortState reads the header state from the URL value', () => {
    expect(sortState('price_desc')).toEqual({ key: 'price', dir: 'desc' });
    expect(sortState('newest')).toBeUndefined();
  });
});
