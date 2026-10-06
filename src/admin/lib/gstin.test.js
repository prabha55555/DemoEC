import { normaliseGstin, validateGstin } from './gstin';

describe('validateGstin', () => {
  test('empty is valid (the field is optional)', () => {
    expect(validateGstin('')).toMatchObject({ valid: true, value: '' });
    expect(validateGstin(null)).toMatchObject({ valid: true });
    expect(validateGstin('   ')).toMatchObject({ valid: true, value: '' });
  });
  test('accepts a well-formed GSTIN and names its state', () => {
    expect(validateGstin('33AAAAA0000A1Z5')).toMatchObject({ valid: true, stateName: 'Tamil Nadu', value: '33AAAAA0000A1Z5' });
    expect(validateGstin('27AAPFU0939F1ZV')).toMatchObject({ valid: true, stateName: 'Maharashtra' });
  });
  test('normalises case and spaces before checking', () => {
    expect(validateGstin(' 33aaaaa0000a1z5 ')).toMatchObject({ valid: true, value: '33AAAAA0000A1Z5' });
    expect(normaliseGstin('33 aaaaa 0000 a1z5')).toBe('33AAAAA0000A1Z5');
  });
  test('rejects the wrong length with a helpful count', () => {
    const r = validateGstin('33AAAAA0000A1Z');
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/15 characters.*14/);
  });
  test('rejects a wrong pattern', () => {
    expect(validateGstin('33AAAAA0000A1X5').valid).toBe(false); // 14th char must be Z
    expect(validateGstin('AAAAAAAAAAAAAAA').valid).toBe(false);
    expect(validateGstin('33AAAAA00001A1Z5').valid).toBe(false);
    expect(validateGstin('33AAAAA0000A0Z5').valid).toBe(false); // entity digit cannot be 0
  });
  test('rejects an unknown state code', () => {
    const r = validateGstin('00AAAAA0000A1Z5');
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/state code/);
    expect(validateGstin('25AAAAA0000A1Z5').valid).toBe(false); // 25 is not issued
  });
});
