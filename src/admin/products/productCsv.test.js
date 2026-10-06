import { toCsv } from '../lib/csv';
import {
  CSV_COLUMNS, errorReportRows, exportColumns, exportRecords, groupRecords, joinList, joinPairs, normalizeHeader, parseCsv, planImport,
  readImportFile, splitList, splitPairs, templateRecords,
} from './productCsv';

describe('parseCsv (RFC 4180)', () => {
  test('simple rows, with CRLF, LF or CR line endings and no final newline', () => {
    expect(parseCsv('a,b,c\r\n1,2,3').rows).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
    expect(parseCsv('a,b\n1,2\n').rows).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a,b\r1,2\r').rows).toEqual([['a', 'b'], ['1', '2']]);
  });
  test('quoted fields: commas, doubled quotes and newlines stay inside the cell', () => {
    const r = parseCsv('name,desc\r\n"Smith, J","He said ""hi"""\r\n"two\r\nlines",x\r\n');
    expect(r.rows).toEqual([['name', 'desc'], ['Smith, J', 'He said "hi"'], ['two\r\nlines', 'x']]);
    expect(r.error).toBeUndefined();
  });
  test('reports the line each record starts on (a quoted newline counts)', () => {
    const r = parseCsv('a,b\n"x\ny",1\n2,3\n');
    expect(r.lines).toEqual([1, 2, 4]);
  });
  test('strips a BOM, skips blank lines, keeps empty cells and a quoted empty cell', () => {
    expect(parseCsv('﻿a,b\n\n1,\n,2\n').rows).toEqual([['a', 'b'], ['1', ''], ['', '2']]);
    expect(parseCsv('a,b\n"",x').rows[1]).toEqual(['', 'x']);
  });
  test('a quote that is never closed is reported', () => {
    const r = parseCsv('a,b\n1,"oops\n2,3');
    expect(r.error).toMatch(/never closed/);
    expect(r.rows[1][0]).toBe('1');
  });
  test('a stray quote inside an unquoted field is kept literally', () => {
    expect(parseCsv('5" pipe,ok').rows).toEqual([['5" pipe', 'ok']]);
  });
  test('detects ; and tab delimited files from regional Excel exports', () => {
    expect(parseCsv('a;b\n1;2').rows).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a\tb\n1\t2').rows).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a,b;c\n1,2;3').rows).toEqual([['a', 'b;c'], ['1', '2;3']]);
  });
  test('an empty file has no rows', () => {
    expect(parseCsv('').rows).toEqual([]);
    expect(parseCsv('\n\n').rows).toEqual([]);
  });
  test('round-trips what toCsv writes (including formula neutralising handled by the importer)', () => {
    const text = toCsv([{ label: 'a', get: r => r.a }, { label: 'b', get: r => r.b }], [{ a: 'x,"y"', b: 'line1\nline2' }, { a: '', b: 'ü€₹' }]);
    expect(parseCsv(text).rows).toEqual([['a', 'b'], ['x,"y"', 'line1\nline2'], ['', 'ü€₹']]);
  });
});

describe('list escaping', () => {
  test('join / split are inverses even with separators and backslashes in the items', () => {
    const items = ['plain', 'has | pipe', 'back\\slash', 'a=b', ' spaced '.trim()];
    expect(splitList(joinList(items))).toEqual(items);
    expect(splitList(joinList(['a;b', 'c'], ';'), ';')).toEqual(['a;b', 'c']);
  });
  test('splitList trims and drops empty items', () => {
    expect(splitList(' a | | b |')).toEqual(['a', 'b']);
    expect(splitList('')).toEqual([]);
  });
  test('key=value pairs survive = and | inside keys and values', () => {
    const pairs = [['material', 'Cotton | Linen'], ['Size = chart', 'a=b'], ['empty', '']];
    const text = joinPairs(pairs);
    expect(splitPairs(text).filter(p => !p.malformed)).toEqual([{ key: 'material', value: 'Cotton | Linen' }, { key: 'Size = chart', value: 'a=b' }, { key: 'empty', value: '' }]);
    expect(splitPairs('novalue')[0]).toMatchObject({ key: 'novalue', malformed: true });
  });
});

describe('headers', () => {
  test('are matched case-insensitively with a few friendly aliases', () => {
    expect(normalizeHeader('Product Number')).toBe('product_number');
    expect(normalizeHeader(' SKU ')).toBe('sku');
    expect(normalizeHeader('Option 1 Name')).toBe('option1_name');
    expect(normalizeHeader('Quantity')).toBe('stock');
    expect(normalizeHeader('compare-at price')).toBe('mrp');
    expect(normalizeHeader('﻿Name')).toBe('name');
  });
});

// ------------------------------------------------------------------------------------------------ fixtures
const categories = [
  { id: 'c-fashion', parent_id: null, name: 'Fashion', slug: 'fashion', sort_order: 1, attribute_schema: [{ key: 'material', label: 'Material', type: 'text' }, { key: 'fit', label: 'Fit', type: 'select', options: ['Regular', 'Slim'] }, { key: 'weight', label: 'Weight', type: 'number' }, { key: 'wp', label: 'Waterproof', type: 'boolean' }, { key: 'uses', label: 'Uses', type: 'multiselect', options: ['Gym', 'Office'] }] },
  { id: 'c-men', parent_id: 'c-fashion', name: 'Men', slug: 'men', sort_order: 1, attribute_schema: [] },
  { id: 'c-home', parent_id: null, name: 'Home', slug: 'home', sort_order: 2, attribute_schema: [] },
];
const product = (over = {}) => ({
  id: 'p1', product_number: 'T-1', name: 'Polo Shirt', brand: 'Urban', category_id: 'c-men', status: 'active', subtitle: 'Soft, "pique" cotton', description: 'Line one\nLine two, with comma',
  highlights: ['100% cotton', 'Wash | dry'], tags: ['polo', 'men'], attributes: { material: 'Cotton', fit: 'Slim', weight: 230, wp: false, uses: ['Gym', 'Office'], 'Country of origin': 'India' },
  images: ['https://x.test/a.jpg', 'https://x.test/b.jpg?x=1,2'], image_position: '50% 0%', video_url: null, video_position: 0, video_cover_url: null, video_cover_position: '50% 50%',
  featured: true, badge: 'Bestseller', free_shipping: false, cod_allowed: true, delivery_min_days: 3, delivery_max_days: 6, weight_g: 250, length_cm: null, width_cm: '12.5', height_cm: null,
  return_window_days: null, gst_rate: '12', hsn_code: '6109', max_qty_per_order: 10, low_stock_threshold: null, meta_title: 'Polo', meta_description: null,
  option_types: [{ name: 'Size', values: ['M', 'L'] }, { name: 'Colour', values: ['Navy'] }], ...over,
});
const variants = (pid = 'p1') => [
  { id: 'v1', product_id: pid, sku: 'T-1-M-NAVY', options: { Size: 'M', Colour: 'Navy' }, label: 'M / Navy', price: '499', mrp: '699', stock: 10, track_inventory: true, weight_g: 240, image_url: 'https://x.test/a.jpg', position: 0, active: true },
  { id: 'v2', product_id: pid, sku: 'T-1-L-NAVY', options: { Size: 'L', Colour: 'Navy' }, label: 'L / Navy', price: '499.50', mrp: null, stock: 0, track_inventory: true, weight_g: null, image_url: null, position: 1, active: false },
];
const simple = () => ({ id: 'p2', product_number: 'T-2', name: '=SUM Mug', brand: null, category_id: 'c-home', status: 'draft', option_types: [], highlights: [], tags: [], attributes: {}, images: [], featured: false, cod_allowed: true, free_shipping: false, max_qty_per_order: 10 });
const simpleVariants = () => [{ id: 'v3', product_id: 'p2', sku: null, options: {}, label: 'Default', price: 99, mrp: 129, stock: 4, track_inventory: false, weight_g: null, image_url: null, position: 0, active: true }];

function ctxFor(list) {
  const existingByNumber = new Map();
  const variantsByProduct = new Map();
  const skuOwners = new Map();
  for (const { p, v } of list) {
    existingByNumber.set(p.product_number.toLowerCase(), p);
    variantsByProduct.set(p.id, v);
    v.forEach(x => { if (x.sku) skuOwners.set(x.sku.toLowerCase(), { id: x.id, product_id: p.id, product_number: p.product_number, product_name: p.name }); });
  }
  return { categories, existingByNumber, variantsByProduct, skuOwners };
}
const fileFrom = (recs) => readImportFile(toCsv(exportColumns(), recs));
const exportAll = (list) => list.flatMap(({ p, v }) => exportRecords(p, v, categories));

describe('export', () => {
  test('one row per variant; product-level columns only on the first row', () => {
    const rows = exportRecords(product(), variants(), categories);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ product_number: 'T-1', name: 'Polo Shirt', category: 'Fashion > Men', status: 'active', option1_name: 'Size', option1_value: 'M', option2_name: 'Colour', option2_value: 'Navy', sku: 'T-1-M-NAVY', price: '499', mrp: '699', stock: '10', track_inventory: 'yes', weight_g: '240', variant_active: 'yes' });
    expect(rows[0].description).toBe('Line one\nLine two, with comma');
    expect(rows[1]).toMatchObject({ product_number: 'T-1', name: 'Polo Shirt', sku: 'T-1-L-NAVY', price: '499.5', mrp: '', variant_active: 'no', description: '', highlights: '', featured: '' });
    expect(rows[0].highlights).toBe('100% cotton|Wash \\| dry');
  });
  test('the columns start with the documented layout', () => {
    expect(CSV_COLUMNS.slice(0, 5)).toEqual(['product_number', 'name', 'brand', 'category', 'status']);
    expect(CSV_COLUMNS).toEqual(expect.arrayContaining(['option1_name', 'option2_value', 'sku', 'price', 'mrp', 'stock', 'track_inventory', 'weight_g']));
  });
  test('a product with no variants still exports one row', () => {
    expect(exportRecords(product(), [], categories)).toHaveLength(1);
  });
});

describe('importing the file that was just exported is a no-op', () => {
  test('nothing is created, nothing changes, no errors', () => {
    const list = [{ p: product(), v: variants() }, { p: simple(), v: simpleVariants() }];
    const file = fileFrom(exportAll(list));
    expect(file.ok).toBe(true);
    expect(file.unknownColumns).toEqual([]);
    const plan = planImport(file.records, ctxFor(list));
    expect(plan.problems.filter(p => p.level === 'error')).toEqual([]);
    expect(plan.totals).toMatchObject({ products: 2, creates: 0, updates: 0, unchanged: 2, errors: 0 });
    plan.products.forEach((p) => { expect(p.changed).toBe(false); expect(p.patch).toEqual({}); p.variants.forEach(v => { expect(v.patch).toBeNull(); expect(v.stockTo).toBeNull(); }); });
  });
  test('the formula-neutralising apostrophe is stripped on the way back in', () => {
    const list = [{ p: simple(), v: simpleVariants() }];
    const csv = toCsv(exportColumns(), exportAll(list));
    expect(csv).toContain("'=SUM Mug");
    expect(readImportFile(csv).records[0].cells.name).toBe('=SUM Mug');
  });
});

describe('planImport: what is created and updated', () => {
  const base = { ...Object.fromEntries(CSV_COLUMNS.map(c => [c, ''])) };
  const rec = (over) => ({ ...base, ...over });
  const run = (recs, list = []) => planImport(fileFrom(recs).records, ctxFor(list));

  test('a new product with variants is a create; option types are built from the rows', () => {
    const plan = run([
      rec({ product_number: 'N-1', name: 'New Tee', category: 'Fashion > Men', status: 'draft', option1_name: 'Size', option1_value: 'S', sku: 'N-1-S', price: '300', stock: '5' }),
      rec({ product_number: 'N-1', name: 'New Tee', category: 'Fashion > Men', status: 'draft', option1_name: 'Size', option1_value: 'M', sku: 'N-1-M', price: '300', stock: '0' }),
    ]);
    expect(plan.totals).toMatchObject({ creates: 1, validRows: 2, errors: 0 });
    const p = plan.products[0];
    expect(p.action).toBe('create');
    expect(p.optionTypes).toEqual([{ name: 'Size', values: ['S', 'M'] }]);
    expect(p.variants.map(v => [v.label, v.sku, v.price, v.stock])).toEqual([['S', 'N-1-S', 300, 5], ['M', 'N-1-M', 300, 0]]);
    expect(p.desired).toMatchObject({ name: 'New Tee', category_id: 'c-men', status: 'draft' });
  });

  test('rows without a product number continue the previous product when the name is blank', () => {
    const groups = groupRecords(fileFrom([
      rec({ product_number: 'A', name: 'A', price: '1' }), rec({ price: '2', option1_name: 'Size', option1_value: 'x' }), rec({ name: 'B', price: '3' }), rec({ product_number: 'A', price: '4' }),
    ]).records);
    expect(groups.map(g => g.rows.length)).toEqual([3, 1]);
  });

  test('updates by product number and SKU change only what differs; stock goes through an adjustment', () => {
    const list = [{ p: product(), v: variants() }];
    const rows = exportAll(list);
    rows[0].price = '450';
    rows[0].stock = '25';
    rows[0].badge = 'Sale';
    const plan = planImport(fileFrom(rows).records, ctxFor(list));
    const p = plan.products[0];
    expect(plan.totals).toMatchObject({ updates: 1, creates: 0, errors: 0 });
    expect(p.patch).toEqual({ badge: 'Sale' });
    expect(p.variants[0]).toMatchObject({ action: 'update', id: 'v1', patch: { price: 450 }, stockTo: 25 });
    expect(p.variants[1]).toMatchObject({ action: 'update', id: 'v2', patch: null, stockTo: null });
  });

  test('a new size on an existing product is a new variant and extends option_types', () => {
    const list = [{ p: product(), v: variants() }];
    const rows = [...exportAll(list), rec({ product_number: 'T-1', option1_name: 'Size', option1_value: 'XL', option2_name: 'Colour', option2_value: 'Navy', sku: 'T-1-XL-NAVY', price: '499', stock: '7' })];
    const plan = planImport(fileFrom(rows).records, ctxFor(list));
    const p = plan.products[0];
    expect(plan.totals.errors).toBe(0);
    expect(p.variants[2]).toMatchObject({ action: 'create', sku: 'T-1-XL-NAVY', stock: 7, options: { Size: 'XL', Colour: 'Navy' }, label: 'XL / Navy' });
    expect(p.patch.option_types).toEqual([{ name: 'Size', values: ['M', 'L', 'XL'] }, { name: 'Colour', values: ['Navy'] }]);
  });

  test('a stock-only file can update an options product by SKU', () => {
    const list = [{ p: product(), v: variants() }];
    const plan = run([rec({ product_number: 'T-1', sku: 'T-1-L-NAVY', stock: '12' }), rec({ product_number: 'T-1', sku: 't-1-m-navy', stock: '3' })], list);
    expect(plan.totals.errors).toBe(0);
    expect(plan.products[0].variants.map(v => [v.id, v.stockTo])).toEqual([['v2', 12], ['v1', 3]]);
  });
});

describe('planImport: problems', () => {
  const base = { ...Object.fromEntries(CSV_COLUMNS.map(c => [c, ''])) };
  const rec = (over) => ({ ...base, ...over });
  const run = (recs, list = []) => planImport(fileFrom(recs).records, ctxFor(list));
  const messages = (plan, level = 'error') => plan.problems.filter(p => p.level === level).map(p => p.message);

  test('unknown category', () => {
    const plan = run([rec({ product_number: 'X', name: 'X', category: 'Shoes', price: '1' })]);
    expect(messages(plan)).toEqual(['Unknown category "Shoes".']);
    expect(plan.totals).toMatchObject({ validProducts: 0, skippedRows: 1 });
  });
  test('a missing category is only a warning for a draft, an error for an active product', () => {
    expect(messages(run([rec({ product_number: 'X', name: 'X', price: '1' })]), 'warning')[0]).toMatch(/No category/);
    expect(messages(run([rec({ product_number: 'X', name: 'X', status: 'active', price: '1' })]))).toEqual(['An active product needs a category.']);
  });
  test('bad numbers, missing price and MRP below price', () => {
    const plan = run([
      rec({ product_number: 'A', name: 'A', category: 'Home', price: 'abc' }),
      rec({ product_number: 'B', name: 'B', category: 'Home', price: '' }),
      rec({ product_number: 'C', name: 'C', category: 'Home', price: '100', mrp: '50' }),
      rec({ product_number: 'D', name: 'D', category: 'Home', price: '100', stock: '-3' }),
      rec({ product_number: 'E', name: 'E', category: 'Home', price: '100', stock: '2.5' }),
      rec({ product_number: 'F', name: 'F', category: 'Home', price: '100', weight_g: 'heavy' }),
    ]);
    const m = messages(plan);
    expect(m.some(x => /"abc" is not a valid price/.test(x))).toBe(true);
    expect(m.some(x => /price is missing/.test(x))).toBe(true);
    expect(m.some(x => /MRP \(50\) is lower than the price \(100\)/.test(x))).toBe(true);
    expect(m.filter(x => /Stock/.test(x))).toHaveLength(2);
    expect(m.some(x => /weight_g/.test(x))).toBe(true);
    expect(plan.totals.validProducts).toBe(0);
  });
  test('duplicate SKUs inside the file, and SKUs that belong to another product', () => {
    const list = [{ p: simple(), v: [{ ...simpleVariants()[0], sku: 'TAKEN-1' }] }];
    const plan = run([
      rec({ product_number: 'A', name: 'A', category: 'Home', price: '1', sku: 'DUP' }),
      rec({ product_number: 'B', name: 'B', category: 'Home', price: '1', sku: 'dup' }),
      rec({ product_number: 'C', name: 'C', category: 'Home', price: '1', sku: 'taken-1' }),
    ], list);
    const m = messages(plan);
    expect(m.some(x => /Duplicate SKU "dup" \(also on line 2\)/.test(x))).toBe(true);
    expect(m.some(x => /already belongs to "=SUM Mug"/.test(x))).toBe(true);
    expect(plan.totals.validProducts).toBe(1);
  });
  test('option mismatches', () => {
    const plan = run([
      rec({ product_number: 'A', name: 'A', category: 'Home', price: '1', option1_name: 'Size', option1_value: 'S' }),
      rec({ product_number: 'A', price: '1', option1_name: 'Colour', option1_value: 'Red' }),
      rec({ product_number: 'A', price: '1', option1_name: 'Size', option1_value: '' }),
      rec({ product_number: 'A', price: '1', option1_name: 'Size', option1_value: 'S' }),
      rec({ product_number: 'B', name: 'B', category: 'Home', price: '1' }),
      rec({ product_number: 'B', price: '1' }),
    ]);
    const m = messages(plan);
    expect(m.some(x => /Option names do not match the first row/.test(x))).toBe(true);
    expect(m.some(x => /No value for the option "Size"/.test(x))).toBe(true);
    expect(m.some(x => /Duplicate option combination \(S\)/.test(x))).toBe(true);
    expect(m.some(x => /more than one row but no option names/.test(x))).toBe(true);
  });
  test('options that do not match an existing product are refused', () => {
    const list = [{ p: product(), v: variants() }];
    const plan = run([rec({ product_number: 'T-1', option1_name: 'Material', option1_value: 'Silk', price: '1' })], list);
    expect(messages(plan)[0]).toMatch(/do not match the existing product's options \(Size, Colour\)/);
  });
  test('invalid status / yes-no / image links, and a product with any bad row is skipped as a whole', () => {
    const plan = run([
      rec({ product_number: 'A', name: 'A', category: 'Home', price: '1', status: 'sold', featured: 'maybe', images: 'ftp://x/y.jpg' }),
      rec({ product_number: 'G', name: 'Good', category: 'Home', price: '10', sku: 'G-1' }),
      rec({ product_number: 'H', name: 'Half', category: 'Home', price: '10', option1_name: 'Size', option1_value: 'S' }),
      rec({ product_number: 'H', price: 'x', option1_name: 'Size', option1_value: 'M' }),
    ]);
    const m = messages(plan);
    expect(m.some(x => /Unknown status "sold"/.test(x))).toBe(true);
    expect(m.some(x => /featured must be yes or no/.test(x))).toBe(true);
    expect(m.some(x => /not a valid image link/.test(x))).toBe(true);
    expect(plan.totals).toMatchObject({ products: 3, validProducts: 1, validRows: 1, skippedRows: 3 });
  });
  test('attributes are typed by the category schema; wrong types are reported', () => {
    const plan = run([rec({ product_number: 'A', name: 'A', category: 'Fashion > Men', price: '1', attributes: 'material=Silk|weight=abc|wp=maybe|fit=Loose|uses=Gym;Pool|Colour code=7' })]);
    const m = messages(plan);
    expect(m).toEqual(expect.arrayContaining(['Weight must be a number.', 'Waterproof must be yes or no.']));
    const w = messages(plan, 'warning');
    expect(w.some(x => /Fit: "Loose" is not one of the choices/.test(x))).toBe(true);
    expect(w.some(x => /Uses: "Pool" is not one of the choices/.test(x))).toBe(true);
  });
});

describe('readImportFile', () => {
  test('rejects an empty file and one without a name / product_number column', () => {
    expect(readImportFile('').ok).toBe(false);
    expect(readImportFile('foo,bar\n1,2').ok).toBe(false);
  });
  test('reports unknown and repeated columns, and ignores rows with nothing in the known columns', () => {
    const f = readImportFile('Name,Price,Colour of box\nTee,5,red\n,,blue\n');
    expect(f.ok).toBe(true);
    expect(f.unknownColumns).toEqual(['Colour of box']);
    expect(f.records).toHaveLength(1);
    expect(readImportFile('name,name,price\na,b,1').ok).toBe(false);
  });
  test('records carry the original file line number', () => {
    const f = readImportFile('name,price\nA,1\n\nB,2\n');
    expect(f.records.map(r => r.line)).toEqual([2, 4]);
  });
});

describe('error report', () => {
  test('lists every row of a skipped product, in the original columns, with the reason', () => {
    const file = readImportFile('name,price,sku,option1_name,option1_value,Extra\nGood,10,G-1,,,x\nBad,abc,,Size,S,y\nBad,5,,Size,M,z\n');
    const plan = planImport(file.records, { categories, existingByNumber: new Map(), variantsByProduct: new Map(), skuOwners: new Map() });
    const rows = errorReportRows(file, plan);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'Bad', price: 'abc', Extra: 'y', import_line: 3, import_level: 'error' });
    expect(rows[0].import_problem).toMatch(/not a valid price/);
    expect(rows[1]).toMatchObject({ price: '5', Extra: 'z', import_line: 4, import_level: 'skipped' });
    expect(rows[1].import_problem).toMatch(/another row of this product has an error \(line 3\)/);
  });
  test('the report is itself a file the importer accepts (the import_* columns are ignored)', () => {
    const file = readImportFile('name,price\nBad,abc\n');
    const plan = planImport(file.records, { categories, existingByNumber: new Map(), variantsByProduct: new Map(), skuOwners: new Map() });
    const rows = errorReportRows(file, plan);
    const cols = [...file.header, 'import_line', 'import_level', 'import_problem'].map(label => ({ label, get: r => r[label] }));
    const back = readImportFile(toCsv(cols, rows));
    expect(back.ok).toBe(true);
    expect(back.unknownColumns).toEqual(['import_line', 'import_level', 'import_problem']);
  });
});

describe('template', () => {
  test('parses back cleanly; its two example products are refused until the user replaces them', () => {
    const file = fileFrom(templateRecords(categories));
    expect(file.ok).toBe(true);
    const plan = planImport(file.records, { categories, existingByNumber: new Map(), variantsByProduct: new Map(), skuOwners: new Map() });
    expect(plan.products).toHaveLength(2);
    const errors = plan.problems.filter(p => p.level === 'error');
    expect(errors.map(e => e.message)).toEqual([expect.stringMatching(/example row/), expect.stringMatching(/example row/)]);
    expect(plan.totals.creates).toBe(0);
    // with real product numbers the very same rows are valid
    const real = templateRecords(categories).map(r => ({ ...r, product_number: r.product_number.replace('EXAMPLE', 'REAL'), sku: r.sku.replace('EXAMPLE', 'REAL') }));
    const ok = planImport(fileFrom(real).records, { categories, existingByNumber: new Map(), variantsByProduct: new Map(), skuOwners: new Map() });
    expect(ok.totals.errors).toBe(0);
    expect(ok.totals.creates).toBe(2);
  });
});
