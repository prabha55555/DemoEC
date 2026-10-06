import {
  MAX_VARIANTS, addType, addValue, applyToAll, blankType, blankVariant, cartesian, comboCount, diffVariants, disableOptions, effectiveTypes,
  mergeVariantIds, moveType, optionTypesPayload, optionsKey, reconcileVariants, removeType, removeValue, removedWithStock, renameValue, setTypeName, suggestSku, typesFromRecord,
} from './variantMatrix';

const T = (name, values) => blankType({ name, values });
const state = (types, variants = []) => ({ types, variants });
const row = (options, over = {}) => blankVariant({ options, label: Object.values(options).join(' / ') || 'Default', price: '100', stock: '5', ...over });

describe('effectiveTypes / cartesian', () => {
  test('keeps named types with values, trims, de-duplicates and caps at three', () => {
    const t = effectiveTypes([T(' Size ', ['S', 'M', 's', ' ']), T('', ['x']), T('Colour', []), T('Colour', ['Red']), T('size', ['L']), T('A', ['1']), T('B', ['2']), T('C', ['3'])]);
    expect(t.map(x => x.name)).toEqual(['Size', 'Colour', 'A']);
    expect(t[0].values).toEqual(['S', 'M']);
  });
  test('cartesian product has the first option as the outer loop; no options -> one empty combination', () => {
    expect(cartesian(effectiveTypes([T('Size', ['S', 'M']), T('Colour', ['Red', 'Blue'])]))).toEqual([
      { Size: 'S', Colour: 'Red' }, { Size: 'S', Colour: 'Blue' }, { Size: 'M', Colour: 'Red' }, { Size: 'M', Colour: 'Blue' },
    ]);
    expect(cartesian([])).toEqual([{}]);
  });
  test('comboCount multiplies the value counts', () => {
    expect(comboCount([T('Size', ['S', 'M', 'L']), T('Colour', ['R', 'B'])])).toBe(6);
    expect(comboCount([])).toBe(1);
  });
  test('optionsKey ignores key order', () => {
    expect(optionsKey({ a: '1', b: '2' })).toBe(optionsKey({ b: '2', a: '1' }));
    expect(optionsKey({ a: '1' })).not.toBe(optionsKey({ a: '2' }));
  });
});

describe('typesFromRecord / optionTypesPayload', () => {
  test('round-trips saved option_types', () => {
    const types = typesFromRecord([{ name: 'Size', values: ['S', ' M '] }, { name: '', values: ['x'] }]);
    expect(optionTypesPayload(types)).toEqual([{ name: 'Size', values: ['S', 'M'] }]);
  });
});

describe('reconcileVariants', () => {
  test('adds only the missing combinations and copies price from the first row', () => {
    const types = [T('Size', ['S', 'M']), T('Colour', ['Red'])];
    const existing = [row({ Size: 'S', Colour: 'Red' }, { id: 'v1', price: '799', mrp: '899' })];
    const r = reconcileVariants(existing, types);
    expect(r.variants.map(v => v.label)).toEqual(['S / Red', 'M / Red']);
    expect(r.variants[0].id).toBe('v1');
    expect(r.variants[1]).toMatchObject({ id: null, price: '799', mrp: '899', stock: '0' });
    expect(r.removed).toEqual([]);
  });
  test('rows that no longer match any combination are returned as removed', () => {
    const r = reconcileVariants([row({ Size: 'S' }, { id: 'a' }), row({ Size: 'XL' }, { id: 'b' })], [T('Size', ['S', 'M'])]);
    expect(r.removed.map(v => v.id)).toEqual(['b']);
    expect(r.variants.map(v => v.label)).toEqual(['S', 'M']);
  });
});

describe('structural edits', () => {
  test('the first value of the first option makes the Default variant adopt it (keeps its stock and id)', () => {
    const start = state([], [row({}, { id: 'd', stock: '40', sku: 'X-1' })]);
    let s = addType(start);
    s = { types: s.types, variants: s.variants };
    expect(s.variants).toHaveLength(1);
    const typeId = s.types[0].id;
    let r = setTypeName(s, typeId, 'Size');
    expect(r.ok).toBe(true);
    r = addValue(r, typeId, 'S');
    expect(r.variants).toHaveLength(1);
    expect(r.variants[0]).toMatchObject({ id: 'd', stock: '40', sku: 'X-1', label: 'S', options: { Size: 'S' } });
    expect(r.removed).toEqual([]);
    r = addValue(r, typeId, 'M');
    expect(r.variants.map(v => v.label)).toEqual(['S', 'M']);
    expect(r.variants[1].id).toBeNull();
  });

  test('adding a second option makes existing variants adopt its first value and generates the rest', () => {
    const s0 = state([T('Size', ['S', 'M'])], [row({ Size: 'S' }, { id: 'a', stock: '3' }), row({ Size: 'M' }, { id: 'b', stock: '4' })]);
    let r = addType(s0);
    const id = r.types[1].id;
    r = setTypeName(r, id, 'Colour');
    r = addValue(r, id, 'Red');
    expect(r.variants.map(v => [v.label, v.id])).toEqual([['S / Red', 'a'], ['M / Red', 'b']]);
    r = addValue(r, id, 'Blue');
    expect(r.variants.map(v => v.label)).toEqual(['S / Red', 'S / Blue', 'M / Red', 'M / Blue']);
  });

  test('renaming an option VALUE rewrites options and label on every affected variant', () => {
    const types = [T('Size', ['S', 'M']), T('Colour', ['Red'])];
    const s0 = state(types, [row({ Size: 'S', Colour: 'Red' }, { id: 'a' }), row({ Size: 'M', Colour: 'Red' }, { id: 'b' })]);
    const r = renameValue(s0, types[0].id, 'M', 'Medium');
    expect(r.ok).toBe(true);
    expect(r.types[0].values).toEqual(['S', 'Medium']);
    expect(r.variants.map(v => [v.id, v.label, v.options.Size])).toEqual([['a', 'S / Red', 'S'], ['b', 'Medium / Red', 'Medium']]);
    expect(r.removed).toEqual([]);
  });
  test('renaming to an existing value (any case) is refused', () => {
    const types = [T('Size', ['S', 'M'])];
    const r = renameValue(state(types, [row({ Size: 'S' }), row({ Size: 'M' })]), types[0].id, 'M', 's');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/already/);
  });

  test('renaming an option NAME rewrites the key in every variant and keeps the order', () => {
    const types = [T('Size', ['S']), T('Colour', ['Red', 'Blue'])];
    const s0 = state(types, [row({ Size: 'S', Colour: 'Red' }, { id: 'a' }), row({ Size: 'S', Colour: 'Blue' }, { id: 'b' })]);
    const r = setTypeName(s0, types[1].id, 'Shade');
    expect(r.ok).toBe(true);
    expect(r.variants.map(v => [v.id, v.options, v.label])).toEqual([
      ['a', { Size: 'S', Shade: 'Red' }, 'S / Red'], ['b', { Size: 'S', Shade: 'Blue' }, 'S / Blue'],
    ]);
    expect(setTypeName(s0, types[1].id, 'size').ok).toBe(false);
    expect(setTypeName(s0, types[1].id, '  ').ok).toBe(false);
  });

  test('removing a value removes its variants and reports them (with their stock)', () => {
    const types = [T('Size', ['S', 'M', 'L'])];
    const s0 = state(types, [row({ Size: 'S' }, { id: 'a', stock: '2' }), row({ Size: 'M' }, { id: 'b', stock: '0' }), row({ Size: 'L' }, { id: 'c', stock: '9' })]);
    const r = removeValue(s0, types[0].id, 'L');
    expect(r.variants.map(v => v.label)).toEqual(['S', 'M']);
    expect(r.removed.map(v => v.id)).toEqual(['c']);
    expect(removedWithStock(r.removed).map(v => v.id)).toEqual(['c']);
    expect(removedWithStock([{ id: 'x', stock: '4', track_inventory: false }, { id: null, stock: '3' }])).toEqual([]);
  });

  test('removing the last value of an option removes the option from the variants instead of deleting them all', () => {
    const types = [T('Size', ['S', 'M']), T('Colour', ['Red'])];
    const s0 = state(types, [row({ Size: 'S', Colour: 'Red' }, { id: 'a' }), row({ Size: 'M', Colour: 'Red' }, { id: 'b' })]);
    const r = removeValue(s0, types[1].id, 'Red');
    expect(r.variants.map(v => [v.id, v.label])).toEqual([['a', 'S'], ['b', 'M']]);
    expect(r.removed).toEqual([]);
  });

  test('removing a whole option collapses variants that become identical into the first one', () => {
    const types = [T('Size', ['S', 'M']), T('Colour', ['Red', 'Blue'])];
    const s0 = state(types, cartesian(effectiveTypes(types)).map((o, i) => row(o, { id: `v${i}` })));
    const r = removeType(s0, types[1].id);
    expect(r.types).toHaveLength(1);
    expect(r.variants.map(v => [v.id, v.label])).toEqual([['v0', 'S'], ['v2', 'M']]);
    expect(r.removed.map(v => v.id)).toEqual(['v1', 'v3']);
  });

  test('moving an option reorders labels', () => {
    const types = [T('Size', ['S']), T('Colour', ['Red'])];
    const r = moveType(state(types, [row({ Size: 'S', Colour: 'Red' }, { id: 'a' })]), types[1].id, -1);
    expect(r.types.map(t => t.name)).toEqual(['Colour', 'Size']);
    expect(r.variants[0].label).toBe('Red / S');
    expect(r.variants[0].id).toBe('a');
  });

  test('turning options off keeps the first row as Default and returns the rest as removed', () => {
    const r = disableOptions(state([T('Size', ['S', 'M'])], [row({ Size: 'S' }, { id: 'a' }), row({ Size: 'M' }, { id: 'b' })]));
    expect(r.types).toEqual([]);
    expect(r.variants).toHaveLength(1);
    expect(r.variants[0]).toMatchObject({ id: 'a', label: 'Default', options: {} });
    expect(r.removed.map(v => v.id)).toEqual(['b']);
  });

  test('the variant limit and option limit are enforced', () => {
    const many = Array.from({ length: 13 }, (_, i) => `v${i}`);
    const types = [T('A', many), T('B', many)];
    const s = state(types, []);
    const r = addValue(s, types[1].id, 'extra');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(String(MAX_VARIANTS));
    let s3 = state([T('A', ['1']), T('B', ['1']), T('C', ['1'])]);
    expect(addType(s3).ok).toBe(false);
  });

  test('adding a value needs a named option and rejects blanks / duplicates', () => {
    const t = blankType();
    expect(addValue(state([t]), t.id, 'S').ok).toBe(false);
    const named = T('Size', ['S']);
    expect(addValue(state([named]), named.id, ' ').ok).toBe(false);
    expect(addValue(state([named]), named.id, 's').ok).toBe(false);
  });
});

describe('applyToAll', () => {
  test('sets a field on every row, or only the active ones', () => {
    const rows = [row({ Size: 'S' }, { active: true }), row({ Size: 'M' }, { active: false })];
    expect(applyToAll(rows, 'price', '50').map(v => v.price)).toEqual(['50', '50']);
    expect(applyToAll(rows, 'price', '50', { onlyActive: true }).map(v => v.price)).toEqual(['50', '100']);
  });
});

describe('diffVariants', () => {
  const base = [
    { id: 'a', sku: 'A-1', options: { Size: 'S' }, label: 'S', price: '100', mrp: '120', stock: 5, track_inventory: true, weight_g: null, image_url: null, position: 0, active: true },
    { id: 'b', sku: null, options: { Size: 'M' }, label: 'M', price: 100, mrp: null, stock: 0, track_inventory: true, weight_g: 200, image_url: null, position: 1, active: true },
    { id: 'c', sku: 'C-1', options: { Size: 'L' }, label: 'L', price: 100, mrp: null, stock: 3, track_inventory: true, weight_g: null, image_url: null, position: 2, active: true },
  ];
  const form = (over = []) => base.map((b, i) => ({ key: b.id, id: b.id, options: b.options, label: b.label, sku: b.sku || '', price: String(b.price), mrp: b.mrp === null ? '' : String(b.mrp), stock: String(b.stock), track_inventory: true, active: true, weight_g: b.weight_g === null ? '' : String(b.weight_g), image_url: '', ...(over[i] || {}) }));

  test('an untouched form produces nothing (numbers from the database may be strings)', () => {
    const d = diffVariants(base, form());
    expect(d).toEqual({ inserts: [], updates: [], deletes: [], stockChanges: [] });
  });

  test('changed columns become minimal patches; stock is never in a patch', () => {
    const d = diffVariants(base, form([{ price: '90', stock: '9' }, { sku: 'B-1', active: false }]));
    expect(d.updates).toEqual([
      { id: 'a', patch: { price: 90 }, optionsChanged: false },
      { id: 'b', patch: { sku: 'B-1', active: false }, optionsChanged: false },
    ]);
    expect(d.stockChanges).toEqual([{ id: 'a', from: 5, to: 9 }]);
  });

  test('a renamed value shows up as an options + label change', () => {
    const rows = form([{ options: { Size: 'Small' }, label: 'Small' }]);
    const d = diffVariants(base, rows);
    expect(d.updates[0]).toEqual({ id: 'a', patch: { options: { Size: 'Small' }, label: 'Small' }, optionsChanged: true });
  });

  test('new rows are inserts with their opening stock; removed rows are deletes', () => {
    const rows = [...form().slice(0, 2), { key: 'n', id: null, options: { Size: 'XL' }, label: 'XL', sku: ' X-1 ', price: '110', mrp: '', stock: '12', track_inventory: true, active: true, weight_g: '', image_url: '' }];
    const d = diffVariants(base, rows);
    expect(d.deletes).toEqual(['c']);
    expect(d.inserts).toHaveLength(1);
    expect(d.inserts[0].columns).toMatchObject({ sku: 'X-1', price: 110, mrp: null, track_inventory: true, position: 2, options: { Size: 'XL' } });
    expect(d.inserts[0].opening).toBe(12);
  });

  test('untracked rows have no opening stock and no stock changes', () => {
    const rows = form([{ track_inventory: false, stock: '99' }]);
    const d = diffVariants(base, [...rows, { key: 'n', id: null, options: {}, label: 'x', sku: '', price: '1', mrp: '', stock: '8', track_inventory: false, active: true, weight_g: '', image_url: '' }].slice(0, 4));
    expect(d.stockChanges).toEqual([]);
    expect(d.inserts[0].opening).toBe(0);
    expect(d.updates[0]).toMatchObject({ id: 'a', patch: { track_inventory: false } });
  });

  test('reordering rows rewrites positions', () => {
    const rows = form();
    const d = diffVariants(base, [rows[1], rows[0], rows[2]]);
    expect(d.updates.map(u => [u.id, u.patch.position])).toEqual([['b', 0], ['a', 1]]);
  });
});

describe('suggestSku', () => {
  test('PREFIX-OPTIONS in capitals, letters and digits only', () => {
    expect(suggestSku('Cotton Kurta', { Size: 'M', Colour: 'Light Blue' }, new Set())).toBe('COTTONKURTA-M-LIGHTBLUE');
    expect(suggestSku('', {}, new Set())).toBe('SKU');
  });
  test('stays unique among the SKUs already taken (any case)', () => {
    const taken = new Set(['kur-s', 'kur-s-2']);
    expect(suggestSku('KUR', { Size: 'S' }, taken)).toBe('KUR-S-3');
  });
});

describe('mergeVariantIds', () => {
  test('rows that were new adopt the ids the database assigned (matched by option combination)', () => {
    const rows = [{ key: 'a', id: 'v1', options: { Size: 'S' } }, { key: 'k-new', id: null, options: { Size: 'M' } }, { key: 'k-other', id: null, options: { Size: 'XL' } }];
    const fresh = [{ id: 'v1', options: { Size: 'S' } }, { id: 'v2', options: { Size: 'M' } }];
    const out = mergeVariantIds(rows, fresh);
    expect(out.map(r => [r.id, r.key])).toEqual([['v1', 'v1'], ['v2', 'v2'], [null, 'k-other']]);
  });
});
