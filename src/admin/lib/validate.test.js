import { checkEmail, checkNumber, checkPhone, hasErrors } from './validate';

describe('checkNumber', () => {
  test('blank is fine unless required', () => {
    expect(checkNumber('')).toBe('');
    expect(checkNumber('', { required: true, label: 'The fee' })).toBe('The fee is required.');
  });
  test('rejects non-numbers, negatives, decimals where integers are needed, and out-of-range', () => {
    expect(checkNumber('abc', { label: 'Fee' })).toMatch(/must be a number/);
    expect(checkNumber('-1', { min: 0, label: 'Fee' })).toBe('Fee cannot be negative.');
    expect(checkNumber('2.5', { integer: true, label: 'Days' })).toBe('Days must be a whole number.');
    expect(checkNumber('0', { min: 1, label: 'Months' })).toBe('Months must be at least 1.');
    expect(checkNumber('400', { max: 365, label: 'Days' })).toBe('Days must be at most 365.');
  });
  test('accepts valid values including 0', () => {
    expect(checkNumber('0', { min: 0 })).toBe('');
    expect(checkNumber('12.5', { min: 0 })).toBe('');
    expect(checkNumber(' 7 ', { integer: true, min: 0, max: 30 })).toBe('');
  });
});

describe('email / phone', () => {
  test('checkEmail', () => {
    expect(checkEmail('')).toBe('');
    expect(checkEmail('', { required: true })).toMatch(/required/);
    expect(checkEmail('a@b')).toMatch(/valid/);
    expect(checkEmail('help@store.in')).toBe('');
  });
  test('checkPhone accepts common Indian mobile formats', () => {
    expect(checkPhone('98765 43210')).toBe('');
    expect(checkPhone('+91 98765-43210')).toBe('');
    expect(checkPhone('09876543210')).toBe('');
    expect(checkPhone('12345')).toMatch(/10-digit/);
    expect(checkPhone('5876543210')).toMatch(/10-digit/);
    expect(checkPhone('')).toBe('');
  });
  test('hasErrors', () => {
    expect(hasErrors({ a: '', b: '' })).toBe(false);
    expect(hasErrors({ a: '', b: 'bad' })).toBe(true);
    expect(hasErrors(undefined)).toBe(false);
  });
});
