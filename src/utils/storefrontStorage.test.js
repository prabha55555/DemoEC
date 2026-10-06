import { readRecentIds, pushRecentId, readRecentSearches, pushRecentSearch, clearRecentSearches } from './storefrontStorage';

beforeEach(() => localStorage.clear());

test('recently viewed: newest first, no duplicates, at most 10, ids only', () => {
  for (let i = 1; i <= 12; i++) pushRecentId(`p${i}`);
  pushRecentId('p5');
  const ids = readRecentIds();
  expect(ids).toHaveLength(10);
  expect(ids[0]).toBe('p5');
  expect(ids.filter(x => x === 'p5')).toHaveLength(1);
  expect(JSON.parse(localStorage.getItem('tt_recent'))).toEqual(ids);
});

test('a corrupt value is ignored rather than thrown', () => {
  localStorage.setItem('tt_recent', '{not json');
  expect(readRecentIds()).toEqual([]);
  localStorage.setItem('tt_recent', '{"a":1}');
  expect(readRecentIds()).toEqual([]);
});

test('recent searches: trimmed, case-insensitive de-duplication, capped, clearable', () => {
  pushRecentSearch('  Cotton   Kurta ');
  pushRecentSearch('cotton kurta');
  expect(readRecentSearches()).toEqual(['cotton kurta']);
  for (let i = 0; i < 12; i++) pushRecentSearch(`q${i}`);
  expect(readRecentSearches()).toHaveLength(8);
  pushRecentSearch('   ');
  expect(readRecentSearches()[0]).toBe('q11');
  clearRecentSearches();
  expect(readRecentSearches()).toEqual([]);
});
