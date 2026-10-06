import { MAX_RANGE_DAYS, daysInRange, describeRange, eachDayKey, lastDayOfPreviousMonth, monthStartKey, normaliseCustom, rangeBounds, rangeFor, weekStartKey } from './dateRange';

// 06 Oct 2026, 3:42 pm IST  =  10:12 UTC
const NOW = new Date('2026-10-06T10:12:00Z');

describe('presets (India time)', () => {
  test('today, 7 days and 30 days end today and include it', () => {
    expect(rangeFor('today', NOW)).toEqual({ from: '2026-10-06', to: '2026-10-06' });
    expect(rangeFor('7d', NOW)).toEqual({ from: '2026-09-30', to: '2026-10-06' });
    expect(rangeFor('30d', NOW)).toEqual({ from: '2026-09-07', to: '2026-10-06' });
    expect(daysInRange(rangeFor('7d', NOW))).toBe(7);
    expect(daysInRange(rangeFor('30d', NOW))).toBe(30);
  });
  test('this month starts on the 1st; last month is the whole previous month', () => {
    expect(rangeFor('month', NOW)).toEqual({ from: '2026-10-01', to: '2026-10-06' });
    expect(rangeFor('last-month', NOW)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });
  test('last month across a year end and in a leap year', () => {
    expect(rangeFor('last-month', new Date('2027-01-15T10:00:00Z'))).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(rangeFor('last-month', new Date('2028-03-10T10:00:00Z'))).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(lastDayOfPreviousMonth('2026-03-05')).toBe('2026-02-28');
    expect(monthStartKey('2026-10-06')).toBe('2026-10-01');
  });
  test('"today" is the INDIAN day: 00:10 IST on the 7th is still the 6th in UTC', () => {
    const justAfterMidnightIst = new Date('2026-10-06T18:40:00Z'); // 00:10 on 7 Oct in India
    expect(rangeFor('today', justAfterMidnightIst).from).toBe('2026-10-07');
    const lateEveningIst = new Date('2026-10-06T18:20:00Z');       // 23:50 on 6 Oct in India
    expect(rangeFor('today', lateEveningIst).from).toBe('2026-10-06');
  });
  test('an unknown preset falls back to 30 days', () => {
    expect(rangeFor('nonsense', NOW)).toEqual(rangeFor('30d', NOW));
  });
});

describe('rangeBounds', () => {
  test('starts at 00:00 IST on the first day and ends (exclusive) at 00:00 IST on the day after the last', () => {
    expect(rangeBounds({ from: '2026-10-01', to: '2026-10-06' })).toEqual({
      fromISO: '2026-09-30T18:30:00.000Z',
      toISO: '2026-10-06T18:30:00.000Z',
    });
  });
  test('one day is a 24-hour window', () => {
    const { fromISO, toISO } = rangeBounds({ from: '2026-10-06', to: '2026-10-06' });
    expect(new Date(toISO) - new Date(fromISO)).toBe(24 * 3600 * 1000);
  });
  test('an order at 23:59 IST on the last day is inside; at 00:00 IST the next day it is outside', () => {
    const { toISO } = rangeBounds({ from: '2026-10-01', to: '2026-10-06' });
    expect(new Date('2026-10-06T18:29:59Z') < new Date(toISO)).toBe(true);
    expect(new Date('2026-10-06T18:30:00Z') < new Date(toISO)).toBe(false);
  });
});

describe('custom ranges', () => {
  const today = '2026-10-06';
  test('a good range is kept', () => {
    expect(normaliseCustom({ from: '2026-09-01', to: '2026-09-15' }, today)).toEqual({ from: '2026-09-01', to: '2026-09-15', note: '' });
  });
  test('swapped dates are put right, with a note', () => {
    const r = normaliseCustom({ from: '2026-09-15', to: '2026-09-01' }, today);
    expect(r.from).toBe('2026-09-01');
    expect(r.to).toBe('2026-09-15');
    expect(r.note).toMatch(/swapped/);
  });
  test('a missing end means today; a missing start means the end day; nothing at all means the last 30 days', () => {
    expect(normaliseCustom({ from: '2026-10-01', to: '' }, today)).toMatchObject({ from: '2026-10-01', to: today });
    expect(normaliseCustom({ from: '', to: '2026-10-03' }, today)).toMatchObject({ from: '2026-10-03', to: '2026-10-03' });
    expect(normaliseCustom({}, today)).toMatchObject({ from: '2026-09-07', to: today });
  });
  test('the future is cut off at today', () => {
    expect(normaliseCustom({ from: '2026-10-01', to: '2026-12-31' }, today)).toMatchObject({ from: '2026-10-01', to: today });
    expect(normaliseCustom({ from: '2026-11-01', to: '2026-12-31' }, today)).toMatchObject({ from: today, to: today });
  });
  test('garbage dates are ignored', () => {
    expect(normaliseCustom({ from: 'abc', to: '2026-13-45' }, today).to).toBe(today);
  });
  test('a range is at most a year', () => {
    const r = normaliseCustom({ from: '2024-01-01', to: '2026-10-01' }, today);
    expect(daysInRange(r)).toBe(MAX_RANGE_DAYS);
    expect(r.to).toBe('2026-10-01');
    expect(r.note).toMatch(/at most 366 days/);
  });
});

describe('helpers', () => {
  test('eachDayKey lists every day, oldest first', () => {
    expect(eachDayKey({ from: '2026-09-29', to: '2026-10-02' })).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(eachDayKey({ from: '2026-10-02', to: '2026-10-02' })).toEqual(['2026-10-02']);
  });
  test('describeRange', () => {
    expect(describeRange({ from: '2026-10-06', to: '2026-10-06' })).toBe('06 Oct 2026');
    expect(describeRange({ from: '2026-10-01', to: '2026-10-06' })).toBe('01 Oct – 06 Oct 2026');
    expect(describeRange({ from: '2025-12-20', to: '2026-01-05' })).toBe('20 Dec 2025 – 05 Jan 2026');
  });
  test('weeks start on Monday', () => {
    expect(weekStartKey('2026-10-06')).toBe('2026-10-05'); // Tuesday -> Monday
    expect(weekStartKey('2026-10-05')).toBe('2026-10-05');
    expect(weekStartKey('2026-10-11')).toBe('2026-10-05'); // Sunday belongs to the week that began the Monday before
  });
});
