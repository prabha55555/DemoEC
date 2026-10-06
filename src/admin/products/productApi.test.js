// The product save pipeline against a small in-memory fake of the Supabase client: what is written, in which order, and
// what is never written (rollup columns, stock on an existing variant).
import { blankForm, formFromRecord } from './productForm';
import { blankVariant } from './variantMatrix';

jest.mock('../../supabase', () => {
  const state = { log: [], tables: {}, failInsertOn: null, seq: 0 };
  const api = { __state: state, from: (table) => makeBuilder(state, table), rpc: (name, args) => rpc(state, name, args), storage: { from: () => ({ remove: async () => ({ error: null }) }) } };
  function rpc(st, name, args) {
    st.log.push({ op: 'rpc', name, args });
    const v = (st.tables.product_variants || []).find(x => x.id === args.p_variant_id);
    if (!v) return Promise.resolve({ data: null, error: { code: 'P0002', message: `VARIANT_NOT_FOUND: ${args.p_variant_id}` } });
    const next = args.p_set_to !== undefined && args.p_set_to !== null ? args.p_set_to : v.stock + args.p_delta;
    if (next < 0) return Promise.resolve({ data: null, error: { code: '22023', message: `stock cannot go below zero (would be ${next})` } });
    v.stock = next;
    return Promise.resolve({ data: next, error: null });
  }
  function makeBuilder(st, table) {
    const q = { table, op: 'select', payload: null, filters: [], head: false, single: false };
    const b = {};
    const rowsOf = () => (st.tables[table] = st.tables[table] || []);
    const matches = (row) => q.filters.every(([f, col, val]) => {
      if (f === 'eq') return String(row[col]) === String(val);
      if (f === 'neq') return String(row[col]) !== String(val);
      if (f === 'in') return val.includes(row[col]);
      if (f === 'ilike') return String(row[col] ?? '').toLowerCase() === String(val).toLowerCase().replace(/\\/g, '');
      return true;
    });
    const run = () => {
      if (q.op === 'insert') {
        if (st.failInsertOn === table) return { data: null, error: { code: '23514', message: `simulated ${table} failure` } };
        const list = (Array.isArray(q.payload) ? q.payload : [q.payload]).map(r => ({ id: `${table}-${++st.seq}`, ...r }));
        rowsOf().push(...list);
        st.log.push({ op: 'insert', table, rows: JSON.parse(JSON.stringify(list)) }); // a copy: later updates must not rewrite history
        return { data: list, error: null };
      }
      if (q.op === 'update') {
        const hit = rowsOf().filter(matches);
        hit.forEach(r => Object.assign(r, q.payload));
        st.log.push({ op: 'update', table, patch: q.payload, ids: hit.map(r => r.id) });
        return { data: hit, error: null };
      }
      if (q.op === 'delete') {
        const hit = rowsOf().filter(matches);
        st.tables[table] = rowsOf().filter(r => !hit.includes(r));
        st.log.push({ op: 'delete', table, ids: hit.map(r => r.id) });
        return { data: hit, error: null };
      }
      const hit = rowsOf().filter(matches);
      if (q.head) return { data: null, count: hit.length, error: null };
      if (q.single) return { data: hit[0] || null, error: null };
      return { data: hit, error: null };
    };
    ['insert', 'update', 'delete'].forEach((op) => { b[op] = (payload) => { q.op = op; q.payload = payload; b.method = op === 'delete' ? 'DELETE' : op === 'insert' ? 'POST' : 'PATCH'; return b; }; });
    b.select = (cols, opts) => { if (q.op === 'select') q.head = !!opts?.head; return b; };
    ['eq', 'neq', 'in', 'ilike'].forEach((f) => { b[f] = (col, val) => { q.filters.push([f, col, val]); return b; }; });
    ['contains', 'order', 'limit', 'range', 'not', 'or', 'gt', 'lt', 'gte', 'lte'].forEach((f) => { b[f] = () => b; });
    b.maybeSingle = () => { q.single = true; return b; };
    b.then = (resolve, reject) => Promise.resolve(run()).then(resolve, reject);
    return b;
  }
  return { supabase: api, default: api };
});

// eslint-disable-next-line import/first
import { supabase } from '../../supabase';
// eslint-disable-next-line import/first
import { saveProduct } from './productApi';

const mockState = supabase.__state;

const categories = [{ id: 'c1', parent_id: null, name: 'Fashion', slug: 'fashion', attribute_schema: [] }];
const reset = () => { mockState.log = []; mockState.tables = { products: [], product_variants: [] }; mockState.failInsertOn = null; mockState.seq = 0; };
const writes = () => mockState.log.filter(e => e.op !== 'select');
const ROLLUPS = ['price', 'price_max', 'mrp', 'discount_pct', 'in_stock', 'has_variants', 'total_stock', 'search_text', 'rating_avg', 'rating_count', 'sales_count'];

const newForm = (over = {}) => ({ ...blankForm(), name: 'Test Mug', category_id: 'c1', images: ['/a.jpg'], variants: [blankVariant({ price: '299', mrp: '399', stock: '12', sku: 'MUG-1' })], ...over });

beforeEach(reset);

describe('saving a NEW product', () => {
  test('inserts it as a draft first, adds the variant with stock 0, gives the opening stock through the RPC, publishes LAST', async () => {
    const res = await saveProduct({ form: newForm(), base: null, categories, targetStatus: 'active' });
    expect(res.ok).toBe(true);
    const w = writes();
    expect(w.map(e => `${e.op}:${e.table || e.name}`)).toEqual(['insert:products', 'insert:product_variants', 'rpc:admin_adjust_stock', 'update:products']);
    expect(w[0].rows[0]).toMatchObject({ name: 'Test Mug', status: 'draft', category_id: 'c1' });
    expect(w[0].rows[0].product_number).toMatch(/^PRD-/);
    expect(w[1].rows[0]).toMatchObject({ sku: 'MUG-1', price: 299, mrp: 399, stock: 0, label: 'Default', options: {} });
    expect(w[2].args).toMatchObject({ p_delta: 12, p_reason: 'restock', p_note: 'Opening stock' });
    expect(w[3].patch).toEqual({ status: 'active' });
  });

  test('never writes a rollup column on the product or `stock` on an existing variant', async () => {
    await saveProduct({ form: newForm(), base: null, categories, targetStatus: 'draft' });
    for (const e of writes().filter(x => x.table === 'products' && x.rows)) ROLLUPS.forEach(c => expect(e.rows[0]).not.toHaveProperty(c));
    expect(writes().filter(e => e.op === 'update' && e.table === 'product_variants' && 'stock' in e.patch)).toEqual([]);
  });

  test('a draft stays a draft: no status write at all', async () => {
    const res = await saveProduct({ form: newForm(), base: null, categories, targetStatus: 'draft' });
    expect(res.ok).toBe(true);
    expect(writes().some(e => e.op === 'update' && e.table === 'products')).toBe(false);
  });

  test('if the variants cannot be saved the product is NOT published and the failure is reported', async () => {
    mockState.failInsertOn = 'product_variants';
    const res = await saveProduct({ form: newForm(), base: null, categories, targetStatus: 'active' });
    expect(res.ok).toBe(false);
    expect(res.steps.some(s => s.ok === false && /simulated product_variants failure/.test(s.text))).toBe(true);
    expect(res.steps.some(s => /Not published/.test(s.text))).toBe(true);
    expect(mockState.tables.products[0].status).toBe('draft');
    expect(writes().some(e => e.op === 'update' && e.table === 'products' && e.patch.status === 'active')).toBe(false);
  });

  test('a taken SKU is found before anything is written', async () => {
    mockState.tables.product_variants = [{ id: 'other', product_id: 'p-other', sku: 'mug-1', stock: 1 }];
    const res = await saveProduct({ form: newForm(), base: null, categories, targetStatus: 'draft' });
    expect(res.ok).toBe(false);
    expect(res.stage).toBe('check');
    expect(res.field).toBe('sku');
    expect(writes()).toEqual([]);
  });

  test('a taken product number is found before anything is written', async () => {
    mockState.tables.products = [{ id: 'p-old', name: 'Old Mug', product_number: 'MUG-001' }];
    const res = await saveProduct({ form: newForm({ product_number: 'mug-001' }), base: null, categories, targetStatus: 'draft' });
    expect(res.stage).toBe('check');
    expect(res.field).toBe('product_number');
    expect(writes()).toEqual([]);
  });
});

describe('saving an EXISTING product', () => {
  const product = { id: 'p1', product_number: 'T-1', name: 'Tee', category_id: 'c1', status: 'active', images: ['/a.jpg'], option_types: [{ name: 'Size', values: ['S', 'M'] }], attributes: {}, highlights: [], tags: [], sales_count: 3 };
  const variants = [
    { id: 'v1', product_id: 'p1', sku: 'T-S', options: { Size: 'S' }, label: 'S', price: 100, mrp: null, stock: 5, track_inventory: true, weight_g: null, image_url: null, position: 0, active: true },
    { id: 'v2', product_id: 'p1', sku: 'T-M', options: { Size: 'M' }, label: 'M', price: 100, mrp: null, stock: 2, track_inventory: true, weight_g: null, image_url: null, position: 1, active: true },
  ];
  const load = () => {
    mockState.tables.products = [{ ...product }];
    mockState.tables.product_variants = variants.map(v => ({ ...v }));
    const base = { product: { ...product }, variants: variants.map(v => ({ ...v })) };
    return { base, form: formFromRecord(base.product, base.variants, categories) };
  };

  test('changing a price patches only that column; stock edits go through admin_adjust_stock set_to with the form reason', async () => {
    const { base, form } = load();
    form.variants[0].price = '120';
    form.variants[0].stock = '9';
    form.name = 'Tee v2';
    const res = await saveProduct({ form, base, categories, targetStatus: 'active' });
    expect(res.ok).toBe(true);
    const w = writes();
    expect(w.find(e => e.op === 'update' && e.table === 'product_variants').patch).toEqual({ price: 120 });
    const rpcs = w.filter(e => e.op === 'rpc');
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].args).toMatchObject({ p_variant_id: 'v1', p_set_to: 9, p_reason: 'adjustment', p_note: 'Edited in product form' });
    expect(w.filter(e => e.op === 'update' && e.table === 'product_variants' && 'stock' in e.patch)).toEqual([]);
    // an already-active product is not re-published
    expect(w.filter(e => e.op === 'update' && e.table === 'products').every(e => !('status' in e.patch) || e.patch.status === 'active')).toBe(true);
  });

  test('stock that changed since the form loaded is adjusted by the difference, so a sale is not overwritten', async () => {
    const { base, form } = load();
    form.variants[0].stock = '9'; // the admin saw 5 and wants +4
    mockState.tables.product_variants[0].stock = 3; // two sold meanwhile
    await saveProduct({ form, base, categories, targetStatus: 'active' });
    const rpc = writes().find(e => e.op === 'rpc');
    expect(rpc.args).toMatchObject({ p_variant_id: 'v1', p_delta: 4 });
    expect(rpc.args.p_set_to).toBeUndefined();
    expect(mockState.tables.product_variants.find(v => v.id === 'v1').stock).toBe(7);
  });

  test('new variants are inserted before removed ones are deleted (never zero variants), removed ones are deleted last', async () => {
    const { base, form } = load();
    form.variants = [form.variants[0], blankVariant({ options: { Size: 'XL' }, label: 'XL', price: '100', stock: '4', sku: 'T-XL' })];
    form.optionTypes = [{ id: 't', name: 'Size', values: ['S', 'XL'] }];
    const res = await saveProduct({ form, base, categories, targetStatus: 'active' });
    expect(res.ok).toBe(true);
    const order = writes().filter(e => e.table === 'product_variants' || e.op === 'rpc').map(e => `${e.op}`);
    expect(order.indexOf('insert')).toBeLessThan(order.indexOf('delete'));
    expect(writes().find(e => e.op === 'delete').ids).toEqual(['v2']);
    expect(writes().find(e => e.op === 'rpc').args).toMatchObject({ p_delta: 4, p_reason: 'restock', p_note: 'Opening stock' });
  });

  test('publishing a draft writes the status last, after the variants and stock', async () => {
    const { base, form } = load();
    base.product.status = 'draft';
    mockState.tables.products[0].status = 'draft';
    form.status = 'active';
    form.variants[1].price = '150';
    const res = await saveProduct({ form, base, categories, targetStatus: 'active' });
    expect(res.ok).toBe(true);
    const w = writes();
    const lastStatusIdx = w.map(e => (e.op === 'update' && e.table === 'products' && e.patch.status === 'active' && Object.keys(e.patch).length === 1 ? 1 : 0)).lastIndexOf(1);
    expect(lastStatusIdx).toBe(w.length - 1);
    expect(w.find(e => e.op === 'update' && e.table === 'products' && 'name' in e.patch).patch).not.toHaveProperty('status');
  });
});

// ------------------------------------------------------------------------------------------------ CSV import runner
describe('runImport', () => {
  // eslint-disable-next-line import/first
  const { readImportFile, planImport } = require('./productCsv');
  // eslint-disable-next-line import/first
  const { runImport } = require('./productApi');
  const cats = [{ id: 'c1', parent_id: null, name: 'Fashion', slug: 'fashion', attribute_schema: [] }, { id: 'c2', parent_id: 'c1', name: 'Men', slug: 'men', attribute_schema: [] }];
  const emptyCtx = { categories: cats, existingByNumber: new Map(), variantsByProduct: new Map(), skuOwners: new Map() };

  test('a new product is created as a draft, its variants get opening stock through the RPC, and it is published last', async () => {
    const file = readImportFile([
      'product_number,name,category,status,option1_name,option1_value,sku,price,stock',
      'N-1,New Tee,Fashion > Men,active,Size,S,N-1-S,300,5',
      'N-1,New Tee,Fashion > Men,active,Size,M,N-1-M,300,0',
    ].join('\n'));
    const plan = planImport(file.records, emptyCtx);
    expect(plan.totals.errors).toBe(0);
    const results = await runImport(plan);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ok: true, action: 'create', created: 2, stock: 1 });
    const w = writes();
    expect(w.map(e => `${e.op}:${e.table || e.name}`)).toEqual(['insert:products', 'insert:product_variants', 'rpc:admin_adjust_stock', 'update:products']);
    expect(w[0].rows[0]).toMatchObject({ product_number: 'N-1', name: 'New Tee', status: 'draft', category_id: 'c2', option_types: [{ name: 'Size', values: ['S', 'M'] }] });
    expect(w[1].rows.map(r => [r.sku, r.stock, r.position])).toEqual([['N-1-S', 0, 0], ['N-1-M', 0, 1]]);
    expect(w[2].args).toMatchObject({ p_delta: 5, p_reason: 'restock', p_note: 'Opening stock' });
    expect(w[3].patch).toEqual({ status: 'active' });
  });

  test('an update changes only what differs; existing stock is set through the RPC as a "correction"', async () => {
    const product = { id: 'p1', product_number: 'T-1', name: 'Tee', category_id: 'c2', status: 'draft', option_types: [], images: [], highlights: [], tags: [], attributes: {}, badge: null };
    const variant = { id: 'v1', product_id: 'p1', sku: 'T-1', options: {}, label: 'Default', price: 100, mrp: null, stock: 4, track_inventory: true, weight_g: null, image_url: null, position: 0, active: true };
    mockState.tables.products = [{ ...product }];
    mockState.tables.product_variants = [{ ...variant }];
    const ctx = { ...emptyCtx, existingByNumber: new Map([['t-1', product]]), variantsByProduct: new Map([['p1', [variant]]]), skuOwners: new Map([['t-1', { id: 'v1', product_id: 'p1', product_number: 'T-1', product_name: 'Tee' }]]) };
    const plan = planImport(readImportFile('product_number,sku,price,stock,badge\nT-1,T-1,120,9,Sale').records, ctx);
    expect(plan.totals.errors).toBe(0);
    const results = await runImport(plan);
    expect(results[0]).toMatchObject({ ok: true, action: 'update', updated: 1, stock: 1 });
    const w = writes();
    expect(w.find(e => e.op === 'update' && e.table === 'products').patch).toEqual({ badge: 'Sale' });
    expect(w.find(e => e.op === 'update' && e.table === 'product_variants').patch).toEqual({ price: 120 });
    expect(w.find(e => e.op === 'rpc').args).toMatchObject({ p_variant_id: 'v1', p_set_to: 9, p_reason: 'correction', p_note: 'CSV import' });
  });

  test('a plan with nothing to change writes nothing at all', async () => {
    const product = { id: 'p1', product_number: 'T-1', name: 'Tee', category_id: 'c2', status: 'draft', option_types: [], images: [], highlights: [], tags: [], attributes: {} };
    const variant = { id: 'v1', product_id: 'p1', sku: 'T-1', options: {}, label: 'Default', price: 100, mrp: null, stock: 4, track_inventory: true, weight_g: null, image_url: null, position: 0, active: true };
    const ctx = { ...emptyCtx, existingByNumber: new Map([['t-1', product]]), variantsByProduct: new Map([['p1', [variant]]]), skuOwners: new Map([['t-1', { id: 'v1', product_id: 'p1' }]]) };
    const plan = planImport(readImportFile('product_number,name,sku,price,stock\nT-1,Tee,T-1,100,4').records, ctx);
    expect(plan.totals).toMatchObject({ updates: 0, unchanged: 1 });
    expect(await runImport(plan)).toEqual([]);
    expect(writes()).toEqual([]);
  });

  test('products with an error are never written', async () => {
    const plan = planImport(readImportFile('product_number,name,price\nB-1,Broken,abc').records, emptyCtx);
    expect(plan.totals.errors).toBeGreaterThan(0);
    expect(await runImport(plan)).toEqual([]);
    expect(writes()).toEqual([]);
  });
});
