import { addDaysToKey, formatDate, formatDateTime, formatMoneyCompact, istDateKey, istRangeFilter, istStartOfDayISO, lastDayKeys, parseNumber, relativeTime, sanitizeDecimal } from './format';

describe('IST day arithmetic', () => {
  test('istDateKey puts late-evening UTC on the NEXT Indian day', () => {
    expect(istDateKey('2026-10-06T18:29:00Z')).toBe('2026-10-06'); // 23:59 IST
    expect(istDateKey('2026-10-06T18:30:00Z')).toBe('2026-10-07'); // 00:00 IST
    expect(istDateKey('2026-10-06T00:00:00Z')).toBe('2026-10-06'); // 05:30 IST
  });
  test('istStartOfDayISO is the UTC instant an IST day begins', () => {
    expect(istStartOfDayISO('2026-10-07')).toBe('2026-10-06T18:30:00.000Z');
  });
  test('addDaysToKey crosses month and year ends', () => {
    expect(addDaysToKey('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysToKey('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDaysToKey('2028-02-28', 1)).toBe('2028-02-29');
  });
  test('lastDayKeys ends today and runs oldest first', () => {
    expect(lastDayKeys(3, new Date('2026-10-06T10:00:00Z'))).toEqual(['2026-10-04', '2026-10-05', '2026-10-06']);
    expect(lastDayKeys(1, new Date('2026-10-06T19:00:00Z'))).toEqual(['2026-10-07']);
  });
  test('istRangeFilter covers the whole last day (exclusive upper bound)', () => {
    expect(istRangeFilter('2026-10-01', '2026-10-03')).toEqual({ gte: '2026-09-30T18:30:00.000Z', lt: '2026-10-03T18:30:00.000Z' });
    expect(istRangeFilter('', '')).toEqual({});
    expect(istRangeFilter('2026-10-01', '')).toEqual({ gte: '2026-09-30T18:30:00.000Z' });
  });
});

describe('formatting', () => {
  test('dates render in IST', () => {
    expect(formatDate('2026-10-06T20:00:00Z')).toBe('07 Oct 2026');
    expect(formatDateTime('2026-10-06T10:12:00Z')).toBe('06 Oct 2026, 3:42 pm');
    expect(formatDate(null)).toBe('');
    expect(formatDate('garbage')).toBe('');
  });
  test('formatMoneyCompact uses lakh / crore', () => {
    expect(formatMoneyCompact(950)).toBe('₹950');
    expect(formatMoneyCompact(1200)).toBe('₹1.2K');
    expect(formatMoneyCompact(2000)).toBe('₹2K');
    expect(formatMoneyCompact(340000)).toBe('₹3.4L');
    expect(formatMoneyCompact(21000000)).toBe('₹2.1Cr');
    expect(formatMoneyCompact('x')).toBe('');
  });
  test('relativeTime', () => {
    const now = new Date('2026-10-06T10:00:00Z').getTime();
    expect(relativeTime(new Date(now - 10 * 1000), now)).toBe('just now');
    expect(relativeTime(new Date(now - 5 * 60 * 1000), now)).toBe('5 min ago');
    expect(relativeTime(new Date(now - 3 * 3600 * 1000), now)).toBe('3 h ago');
    expect(relativeTime(new Date(now - 30 * 3600 * 1000), now)).toBe('yesterday');
    expect(relativeTime(new Date(now - 3 * 86400 * 1000), now)).toBe('3 days ago');
  });
});

describe('number input helpers', () => {
  test('sanitizeDecimal keeps digits and one dot with a decimal cap', () => {
    expect(sanitizeDecimal('₹1,299.567')).toBe('1299.56');
    expect(sanitizeDecimal('12.3.4')).toBe('12.34');
    expect(sanitizeDecimal('abc')).toBe('');
    expect(sanitizeDecimal('1.', 2)).toBe('1.');
    expect(sanitizeDecimal('45.9', 0)).toBe('45');
    expect(sanitizeDecimal(null)).toBe('');
  });
  test('parseNumber', () => {
    expect(parseNumber('12.5')).toBe(12.5);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('', 0)).toBe(0);
    expect(parseNumber('x', 7)).toBe(7);
    expect(parseNumber(0)).toBe(0);
  });
});
