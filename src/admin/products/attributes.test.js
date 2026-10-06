import {
  attributeKeyFromLabel, displayValue, isFilled, mergeAttributes, normalizeSchema, reconcileOnCategoryChange, splitAttributes, toFormValue,
  toStoredValue, validateSchemaRows,
} from './attributes';

describe('attributeKeyFromLabel', () => {
  test('lowercases and joins words with underscores', () => {
    expect(attributeKeyFromLabel('Fabric & Finish')).toBe('fabric_and_finish');
    expect(attributeKeyFromLabel('  Screen size (inches) ')).toBe('screen_size_inches');
  });
  test('falls back for empty / numeric-leading labels', () => {
    expect(attributeKeyFromLabel('')).toBe('attribute');
    expect(attributeKeyFromLabel('???')).toBe('attribute');
    expect(attributeKeyFromLabel('3D effect')).toBe('a_3d_effect');
  });
  test('is unique among the keys already taken', () => {
    expect(attributeKeyFromLabel('Colour', ['colour'])).toBe('colour_2');
    expect(attributeKeyFromLabel('Colour', ['colour', 'colour_2'])).toBe('colour_3');
  });
});

describe('normalizeSchema', () => {
  test('drops blank rows, validates keys, scopes options / unit by type', () => {
    const out = normalizeSchema([
      { key: 'fit', label: ' Fit ', type: 'select', options: ['Slim', 'slim', ' Regular ', ''], required: true, filterable: true, unit: 'cm' },
      { key: 'Bad Key', label: 'Weight', type: 'number', unit: ' g ', options: ['x'] },
      { key: '', label: '' },
      { key: 'fit', label: 'Fit again', type: 'text' },
      { label: 'Tags', type: 'multiselect', options: ['a'], filterable: true },
      { label: 'Waterproof', type: 'nonsense' },
    ]);
    expect(out[0]).toEqual({ key: 'fit', label: 'Fit', type: 'select', options: ['Slim', 'Regular'], required: true, filterable: true });
    expect(out[1]).toEqual({ key: 'weight', label: 'Weight', type: 'number', unit: 'g' });
    expect(out[2]).toEqual({ key: 'fit_again', label: 'Fit again', type: 'text' });
    expect(out[3]).toEqual({ key: 'tags', label: 'Tags', type: 'multiselect', options: ['a'] }); // multi-select is not filterable
    expect(out[4]).toEqual({ key: 'waterproof', label: 'Waterproof', type: 'text' });
  });
});

describe('validateSchemaRows', () => {
  test('flags blank labels, repeated labels / keys, inherited keys and empty choice lists', () => {
    const errs = validateSchemaRows([
      { key: 'a', label: '', type: 'text' },
      { key: 'b', label: 'Size', type: 'select', options: [] },
      { key: 'b', label: 'size', type: 'text' },
      { key: 'material', label: 'Material', type: 'text' },
      { key: 'ok', label: 'Fine', type: 'select', options: ['x'] },
      { key: 'finish_2', label: 'Finish', type: 'text' },
    ], ['material'], ['Finish']);
    expect(errs[5].label).toMatch(/parent/);
    expect(errs[0].label).toBeTruthy();
    expect(errs[1].options).toBeTruthy();
    expect(errs[2].label).toBeTruthy();
    expect(errs[2].key).toBeTruthy();
    expect(errs[3].key).toMatch(/parent/);
    expect(errs[4]).toEqual({});
  });
});

describe('values', () => {
  test('toStoredValue coerces per type and drops empties', () => {
    expect(toStoredValue({ type: 'number' }, '12.5')).toBe(12.5);
    expect(toStoredValue({ type: 'number' }, '')).toBeUndefined();
    expect(toStoredValue({ type: 'number' }, 'abc')).toBeUndefined();
    expect(toStoredValue({ type: 'text' }, '  cotton  ')).toBe('cotton');
    expect(toStoredValue({ type: 'multiselect' }, ['a', ' ', 'b'])).toEqual(['a', 'b']);
    expect(toStoredValue({ type: 'multiselect' }, [])).toBeUndefined();
    expect(toStoredValue({ type: 'boolean' }, false)).toBe(false);
    expect(toStoredValue({ type: 'boolean' }, undefined)).toBeUndefined();
  });
  test('toFormValue / displayValue', () => {
    expect(toFormValue({ type: 'multiselect' }, 'a, b')).toEqual(['a', 'b']);
    expect(toFormValue({ type: 'boolean' }, 'yes')).toBe(true);
    expect(toFormValue({ type: 'boolean' }, undefined)).toBeUndefined();
    expect(toFormValue({ type: 'number' }, 5)).toBe('5');
    expect(displayValue(['a', 'b'])).toBe('a, b');
    expect(displayValue(true)).toBe('Yes');
    expect(displayValue(null)).toBe('');
  });
  test('isFilled treats a set boolean (even false) as filled', () => {
    expect(isFilled({ type: 'boolean' }, false)).toBe(true);
    expect(isFilled({ type: 'boolean' }, undefined)).toBe(false);
    expect(isFilled({ type: 'text' }, '  ')).toBe(false);
  });
});

describe('split / merge', () => {
  const schema = [{ key: 'material', label: 'Material', type: 'text' }, { key: 'weight', label: 'Weight', type: 'number' }, { key: 'wp', label: 'Waterproof', type: 'boolean' }];
  test('splitAttributes separates schema fields from free rows', () => {
    const { values, extras } = splitAttributes({ material: 'Cotton', weight: 12, wp: false, 'Country of origin': 'India', blank: '' }, schema);
    expect(values).toEqual({ material: 'Cotton', weight: '12', wp: false });
    expect(extras.map(e => [e.key, e.value])).toEqual([['Country of origin', 'India']]);
    expect(extras[0].id).toBeTruthy();
  });
  test('mergeAttributes writes typed values and reports problems instead of dropping them silently', () => {
    const { attributes, problems } = mergeAttributes(
      { material: ' Cotton ', weight: 'x', wp: true },
      [{ id: '1', key: 'Country', value: 'India' }, { id: '2', key: 'material', value: 'dup' }, { id: '3', key: '', value: 'orphan' }, { id: '4', key: '', value: '' }],
      schema,
    );
    expect(attributes).toEqual({ material: 'Cotton', wp: true, Country: 'India' });
    expect(problems.some(p => /Weight must be a number/.test(p))).toBe(true);
    expect(problems.some(p => /listed twice/.test(p))).toBe(true);
    expect(problems.some(p => /no name/.test(p))).toBe(true);
  });
  test('a round trip keeps the data', () => {
    const stored = { material: 'Cotton', weight: 12, wp: true, extra: 'x' };
    const { values, extras } = splitAttributes(stored, schema);
    expect(mergeAttributes(values, extras, schema).attributes).toEqual(stored);
  });
});

describe('reconcileOnCategoryChange', () => {
  const oldSchema = [{ key: 'material', label: 'Material', type: 'text' }, { key: 'fit', label: 'Fit', type: 'select', options: ['Slim', 'Regular'] }];
  const newSchema = [{ key: 'material', label: 'Material', type: 'text' }, { key: 'warranty', label: 'Warranty', type: 'text' }, { key: 'color', label: 'Colour', type: 'select', options: ['Red', 'Blue'] }];
  test('keeps matching keys, moves the others to free rows, and pulls matching free rows in', () => {
    const r = reconcileOnCategoryChange(
      { material: 'Cotton', fit: 'Slim' },
      [{ id: 'e1', key: 'warranty', value: '1 year' }, { id: 'e2', key: 'color', value: 'blue' }, { id: 'e3', key: 'color2', value: 'x' }],
      oldSchema, newSchema,
    );
    expect(r.values).toEqual({ material: 'Cotton', warranty: '1 year', color: 'Blue' });
    expect(r.extras.map(e => [e.key, e.value])).toEqual([['fit', 'Slim'], ['color2', 'x']]);
  });
  test('a free row whose value does not fit a select stays a free row', () => {
    const r = reconcileOnCategoryChange({}, [{ id: 'e', key: 'color', value: 'Green' }], [], newSchema);
    expect(r.values).toEqual({});
    expect(r.extras.map(e => e.key)).toEqual(['color']);
  });
});
