// catalogApi talks to Supabase at import time; the pure URL logic under test never calls it.
jest.mock('../supabase', () => ({ supabase: {}, default: {} }));

import { parseShopParams, toShopSearch, applyPatch, clearFilters, activeFilterCount, effectiveSort, resultRange, pageWindow, toggleIn } from './shopQuery';

const parse = (qs) => parseShopParams(new URLSearchParams(qs));

test('an empty query string is the default view', () => {
  const s = parse('');
  expect(s).toMatchObject({ q: '', words: [], sort: '', priceMin: '', priceMax: '', brands: [], rating: 0, discount: 0, inStock: false, page: 1, attrs: {} });
  expect(toShopSearch(s)).toBe('');
  expect(effectiveSort(s)).toBe('popular');
});

test('searching defaults to newest-first ("relevance"), an explicit sort wins', () => {
  expect(effectiveSort(parse('q=kurta'))).toBe('newest');
  expect(effectiveSort(parse('q=kurta&sort=price_asc'))).toBe('price_asc');
});

test('search text becomes words, with wildcard characters stripped', () => {
  expect(parse('q=cotton%20kurta').words).toEqual(['cotton', 'kurta']);
  expect(parse('q=50%25_off').words).toEqual(['50off']);
});

test('round trip keeps every filter, and omits defaults', () => {
  const qs = '?q=kurta&sort=discount&min=300&max=900&brand=Kaveri+Weaves&brand=Urban+Thread&rating=4&discount=20&stock=1&attr.material=Cotton&attr.material=Linen&page=3';
  const s = parse(qs);
  expect(s.brands).toEqual(['Kaveri Weaves', 'Urban Thread']);
  expect(s.attrs).toEqual({ material: ['Cotton', 'Linen'] });
  expect(s).toMatchObject({ priceMin: '300', priceMax: '900', rating: 4, discount: 20, inStock: true, page: 3 });
  expect(parse(toShopSearch(s))).toEqual(s);
});

test('comma lists work, a comma followed by a space stays part of the name', () => {
  expect(parse('brand=Pixelon,Tonewave').brands).toEqual(['Pixelon', 'Tonewave']);
  expect(parse('brand=Foo,%20Inc.').brands).toEqual(['Foo, Inc.']);
});

test('junk values are ignored rather than trusted', () => {
  const s = parse('sort=bogus&min=abc&max=-5&rating=99&page=-2&attr.bad key=x&attr.ok_1=y');
  expect(s.sort).toBe('');
  expect(s.priceMin).toBe('');
  expect(s.priceMax).toBe('');
  expect(s.rating).toBe(5);
  expect(s.page).toBe(1);
  expect(s.attrs).toEqual({ ok_1: ['y'] });
});

test('changing a filter goes back to page 1; an explicit page is kept', () => {
  const s = parse('page=4&brand=Pixelon');
  expect(applyPatch(s, { inStock: true }).page).toBe(1);
  expect(applyPatch(s, { page: 5 }).page).toBe(5);
});

test('clear all drops filters but keeps what the shopper searched for and the sort', () => {
  const s = clearFilters(parse('q=watch&sort=rating&min=100&brand=Meraki&rating=3&discount=10&stock=1&attr.material=Alloy'));
  expect(toShopSearch(s)).toBe('?q=watch&sort=rating');
  expect(activeFilterCount(s)).toBe(0);
});

test('active filter count counts each chosen value', () => {
  expect(activeFilterCount(parse('min=100&brand=A&brand=B&rating=4&stock=1&attr.k=v'))).toBe(6);
});

test('toggleIn adds and removes', () => {
  expect(toggleIn(['a'], 'b')).toEqual(['a', 'b']);
  expect(toggleIn(['a', 'b'], 'a')).toEqual(['b']);
});

test('result range and pager window', () => {
  expect(resultRange(1, 24, 118)).toEqual({ from: 1, to: 24 });
  expect(resultRange(5, 24, 118)).toEqual({ from: 97, to: 118 });
  expect(resultRange(1, 24, 0)).toEqual({ from: 0, to: 0 });
  expect(pageWindow(1, 1)).toEqual([1]);
  expect(pageWindow(1, 5)).toEqual([1, 2, null, 5]);
  expect(pageWindow(6, 12)).toEqual([1, null, 5, 6, 7, null, 12]);
});
