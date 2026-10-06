import { applyFilters, applyOrder, buildCountQuery, buildListQuery, buildSearchOr, clampPage, isRangeError, normaliseOrder, pageCount, pageRange, pageWindow, sanitizeSearch } from './serverList';

// A query builder that records every call, so we can assert exactly what would be sent to PostgREST.
function fakeBuilder(log = []) {
  const q = new Proxy({}, {
    get(_, method) {
      return (...args) => { log.push([method, ...args]); return q; };
    },
  });
  return q;
}
const fakeClient = (log) => ({ from: (t) => { log.push(['from', t]); return fakeBuilder(log); } });

describe('page range maths', () => {
  test('pageRange gives the inclusive [from, to] PostgREST wants', () => {
    expect(pageRange(1, 25)).toEqual([0, 24]);
    expect(pageRange(2, 25)).toEqual([25, 49]);
    expect(pageRange(4, 10)).toEqual([30, 39]);
  });
  test('pageRange survives nonsense input', () => {
    expect(pageRange(0, 25)).toEqual([0, 24]);
    expect(pageRange(-3, 25)).toEqual([0, 24]);
    expect(pageRange('2', '10')).toEqual([10, 19]);
    expect(pageRange(NaN, 0)).toEqual([0, 24]);
  });
  test('pageCount is never below 1', () => {
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(25, 25)).toBe(1);
    expect(pageCount(26, 25)).toBe(2);
    expect(pageCount(1001, 100)).toBe(11);
  });
  test('clampPage keeps the page inside the data', () => {
    expect(clampPage(9, 30, 25)).toBe(2);
    expect(clampPage(1, 0, 25)).toBe(1);
    expect(clampPage(2, 30, 25)).toBe(2);
  });
  test('pageWindow describes "Showing from-to of total"', () => {
    expect(pageWindow(1, 132, 25)).toEqual({ from: 1, to: 25, total: 132 });
    expect(pageWindow(6, 132, 25)).toEqual({ from: 126, to: 132, total: 132 });
    expect(pageWindow(1, 0, 25)).toEqual({ from: 0, to: 0, total: 0 });
  });
});

describe('search', () => {
  test('sanitizeSearch strips PostgREST syntax characters and collapses space', () => {
    expect(sanitizeSearch('  red,  (shirt) "x" 50% off*  ')).toBe('red shirt x 50 off');
    expect(sanitizeSearch(null)).toBe('');
  });
  test('buildSearchOr ORs an ilike per column', () => {
    expect(buildSearchOr(['name', 'sku'], 'shirt')).toBe('name.ilike.%shirt%,sku.ilike.%shirt%');
  });
  test('buildSearchOr returns an empty string when there is nothing to search', () => {
    expect(buildSearchOr(['name'], '   ')).toBe('');
    expect(buildSearchOr([], 'x')).toBe('');
    expect(buildSearchOr(undefined, 'x')).toBe('');
    expect(buildSearchOr(['name'], ',,()')).toBe('');
  });
});

describe('applyFilters', () => {
  const run = (filters) => { const log = []; applyFilters(fakeBuilder(log), filters); return log; };
  test('ignores empty values, so "no filter selected" adds nothing', () => {
    expect(run({ status: '', q: undefined, ids: [] })).toEqual([]);
  });
  test('plain value -> eq, null -> is null, array -> in', () => {
    expect(run({ status: 'Placed' })).toEqual([['eq', 'status', 'Placed']]);
    expect(run({ deleted_at: null })).toEqual([['is', 'deleted_at', null]]);
    expect(run({ status: ['Placed', 'Packed'] })).toEqual([['in', 'status', ['Placed', 'Packed']]]);
  });
  test('false and 0 are real values, not "no filter"', () => {
    expect(run({ active: false, stock: 0 })).toEqual([['eq', 'active', false], ['eq', 'stock', 0]]);
  });
  test('operator objects: ranges, not, is', () => {
    expect(run({ created_at: { gte: 'a', lt: 'b' } })).toEqual([['gte', 'created_at', 'a'], ['lt', 'created_at', 'b']]);
    expect(run({ inventory_issue: { not: ['is', null] } })).toEqual([['not', 'inventory_issue', 'is', null]]);
    expect(run({ stock: { lte: 5, gte: '' } })).toEqual([['lte', 'stock', 5]]);
  });
  test('unknown operators are ignored rather than sent', () => {
    expect(run({ x: { drop: 1 } })).toEqual([]);
  });
  test('$or passes a raw or-string through', () => {
    expect(run({ $or: 'a.eq.1,b.eq.2' })).toEqual([['or', 'a.eq.1,b.eq.2']]);
  });
});

describe('ordering', () => {
  test('normaliseOrder accepts objects, strings and arrays', () => {
    expect(normaliseOrder({ column: 'created_at' })).toEqual([{ column: 'created_at', ascending: false }]);
    expect(normaliseOrder('name.asc')).toEqual([{ column: 'name', ascending: true }]);
    expect(normaliseOrder(['a.desc', { column: 'b', ascending: true }])).toEqual([{ column: 'a', ascending: false }, { column: 'b', ascending: true }]);
    expect(normaliseOrder(undefined)).toEqual([]);
  });
  test('applyOrder issues one order() per column', () => {
    const log = [];
    applyOrder(fakeBuilder(log), [{ column: 'a', ascending: true }, { column: 'b', nullsFirst: false }]);
    expect(log).toEqual([['order', 'a', { ascending: true }], ['order', 'b', { ascending: false, nullsFirst: false }]]);
  });
});

describe('buildListQuery / buildCountQuery', () => {
  test('selects with an exact count, filters, search, order and the page range', () => {
    const log = [];
    buildListQuery(fakeClient(log), {
      table: 'orders', select: 'id, total', filters: { status: 'Placed' }, search: 'asha', searchColumns: ['user_name', 'order_id'],
      orderBy: { column: 'created_at', ascending: false }, page: 3, pageSize: 20,
    });
    expect(log).toEqual([
      ['from', 'orders'],
      ['select', 'id, total', { count: 'exact' }],
      ['eq', 'status', 'Placed'],
      ['or', 'user_name.ilike.%asha%,order_id.ilike.%asha%'],
      ['order', 'created_at', { ascending: false }],
      ['range', 40, 59],
    ]);
  });
  test('no search -> no or(); default select is *', () => {
    const log = [];
    buildListQuery(fakeClient(log), { table: 'x', searchColumns: ['a'], search: '' });
    expect(log.map(c => c[0])).toEqual(['from', 'select', 'range']);
    expect(log[1]).toEqual(['select', '*', { count: 'exact' }]);
    expect(log[2]).toEqual(['range', 0, 24]);
  });
  test('count queries are head-only and never ranged', () => {
    const log = [];
    buildCountQuery(fakeClient(log), { table: 'reviews', filters: { status: 'pending' } });
    expect(log).toEqual([['from', 'reviews'], ['select', '*', { count: 'exact', head: true }], ['eq', 'status', 'pending']]);
  });
});

test('isRangeError recognises the 416 error', () => {
  expect(isRangeError({ code: 'PGRST103' })).toBe(true);
  expect(isRangeError({ message: 'Requested range not satisfiable' })).toBe(true);
  expect(isRangeError({ code: '42501' })).toBe(false);
  expect(isRangeError(null)).toBe(false);
});
