import { blankForm, dropMissingVariantImages, formFromRecord, generateProductNumber, mediaUrlsOf, productPayload, repairTypes, statusPlan, validateForm } from './productForm';
import { blankType, blankVariant } from './variantMatrix';

const categories = [
  { id: 'c1', parent_id: null, name: 'Fashion', slug: 'fashion', attribute_schema: [{ key: 'material', label: 'Material', type: 'text', required: true }, { key: 'weight', label: 'Weight', type: 'number' }] },
  { id: 'c2', parent_id: 'c1', name: 'Men', slug: 'men', attribute_schema: [{ key: 'fit', label: 'Fit', type: 'select', options: ['Slim', 'Regular'] }] },
];

const valid = (over = {}) => {
  const f = blankForm();
  f.name = 'Tee';
  f.category_id = 'c2';
  f.images = ['/a.jpg'];
  f.variants = [blankVariant({ price: '499', stock: '5' })];
  f.attributes = { material: 'Cotton' };
  return { ...f, ...over };
};

describe('validateForm', () => {
  test('a complete simple product is valid for both draft and publish', () => {
    expect(validateForm(valid(), { categories, mode: 'draft' }).ok).toBe(true);
    expect(validateForm(valid(), { categories, mode: 'publish' }).ok).toBe(true);
  });
  test('draft: only the name and variant prices are required; no photo is a warning, not an error', () => {
    const r = validateForm(blankForm(), { categories, mode: 'draft' });
    expect(Object.keys(r.errors).sort()).toEqual(['name', 'variants']);
    expect(Object.values(r.variantErrors)[0].price).toBe('Required');
    expect(r.warnings.join(' ')).toMatch(/no photos/);
    expect(r.errors.category_id).toBeUndefined();
  });
  test('publish additionally needs category, a photo, an active variant and required attributes', () => {
    const f = valid({ category_id: '', images: [], attributes: {} });
    const r = validateForm(f, { categories: [], mode: 'publish' });
    expect(r.errors.category_id).toMatch(/category/);
    expect(r.errors.images).toMatch(/photo/);
    const withCat = validateForm({ ...f, category_id: 'c2', images: ['/a.jpg'], attributes: {} }, { categories, mode: 'publish' });
    expect(withCat.attrErrors.material).toMatch(/required/);
    expect(withCat.errors.attributes).toBeTruthy();
    const noneActive = validateForm(valid({ variants: [blankVariant({ price: '1', active: false })] }), { categories, mode: 'publish' });
    expect(noneActive.errors.variants).toMatch(/active variant/);
  });
  test('prices: required, numeric, and MRP at least the price', () => {
    const rows = [blankVariant({ price: 'abc' }), blankVariant({ price: '100', mrp: '90' }), blankVariant({ price: '100', mrp: '100' }), blankVariant({ price: '', mrp: '5' })];
    const r = validateForm(valid({ variants: rows }), { categories });
    expect(r.variantErrors[rows[0].key].price).toBeTruthy();
    expect(r.variantErrors[rows[1].key].mrp).toBe('At least the price');
    expect(r.variantErrors[rows[2].key]).toBeUndefined();
    expect(r.variantErrors[rows[3].key].price).toBe('Required');
  });
  test('stock and weight must be whole numbers (stock is ignored for untracked rows)', () => {
    const rows = [blankVariant({ price: '1', stock: '2.5' }), blankVariant({ price: '1', stock: 'x', track_inventory: false }), blankVariant({ price: '1', weight_g: '1.5' })];
    const r = validateForm(valid({ variants: rows }), { categories });
    expect(r.variantErrors[rows[0].key].stock).toBeTruthy();
    expect(r.variantErrors[rows[1].key]).toBeUndefined();
    expect(r.variantErrors[rows[2].key].weight_g).toBeTruthy();
  });
  test('duplicate SKUs (any case) are flagged on both rows', () => {
    const rows = [blankVariant({ price: '1', sku: 'ABC', options: { S: 'a' } }), blankVariant({ price: '1', sku: 'abc', options: { S: 'b' } })];
    const r = validateForm(valid({ variants: rows }), { categories });
    expect(r.variantErrors[rows[0].key].sku).toBe('Duplicate SKU');
    expect(r.variantErrors[rows[1].key].sku).toBe('Duplicate SKU');
  });
  test('options on: publishing needs a real option; empty options are tolerated in a draft', () => {
    const f = valid({ hasOptions: true, optionTypes: [blankType()] });
    expect(validateForm(f, { categories, mode: 'draft' }).errors.options).toBeUndefined();
    expect(validateForm(f, { categories, mode: 'publish' }).errors.options).toMatch(/at least one option/);
  });
  test('delivery days: both or neither, min <= max', () => {
    expect(validateForm(valid({ delivery_min_days: '3' }), { categories }).errors.delivery_max_days).toMatch(/both/);
    expect(validateForm(valid({ delivery_min_days: '6', delivery_max_days: '3' }), { categories }).errors.delivery_max_days).toMatch(/lower/);
    expect(validateForm(valid({ delivery_min_days: '3', delivery_max_days: '6' }), { categories }).errors.delivery_max_days).toBeUndefined();
    expect(validateForm(valid({ delivery_min_days: 'a' }), { categories }).errors.delivery_min_days).toBeTruthy();
  });
  test('policies: custom return days, GST, HSN, max quantity, badge length', () => {
    const r = validateForm(valid({ returnMode: 'custom', returnDays: '0', gst_rate: '120', hsn_code: 'abc', max_qty_per_order: '0', badge: 'x'.repeat(21), low_stock_threshold: '1.5' }), { categories });
    expect(Object.keys(r.errors).sort()).toEqual(['badge', 'gst_rate', 'hsn_code', 'low_stock_threshold', 'max_qty_per_order', 'returnDays']);
    expect(validateForm(valid({ returnMode: 'none', gst_rate: '', hsn_code: '' }), { categories }).ok).toBe(true);
  });
  test('an invalid number attribute blocks even a draft', () => {
    const r = validateForm(valid({ attributes: { material: 'x', weight: 'abc' } }), { categories });
    expect(r.attrErrors.weight).toMatch(/number/);
  });
  test('repeated specification names are reported', () => {
    const r = validateForm(valid({ extras: [{ id: '1', key: 'Origin', value: 'a' }, { id: '2', key: 'origin', value: 'b' }] }), { categories });
    expect(r.errors.extras).toMatch(/twice/);
  });
});

describe('formFromRecord / productPayload round trip', () => {
  const record = {
    id: 'p1', product_number: 'T-1', name: ' Tee ', brand: 'Urban', category_id: 'c2', subtitle: 'sub', description: 'desc', highlights: ['a', 'b'], tags: ['x', 'y'],
    attributes: { material: 'Cotton', fit: 'Slim', 'Country of origin': 'India' }, option_types: [{ name: 'Size', values: ['S', 'M'] }], status: 'active', badge: 'New', featured: true,
    images: ['/a.jpg', '/b.jpg'], image_position: '0% 0%', video_url: null, video_position: 1, video_cover_url: null, video_cover_position: null,
    delivery_min_days: 3, delivery_max_days: 6, weight_g: 250, length_cm: '10.5', width_cm: null, height_cm: null, free_shipping: true, gst_rate: '12', hsn_code: '6109',
    return_window_days: 0, cod_allowed: false, max_qty_per_order: 4, low_stock_threshold: 2, meta_title: 'mt', meta_description: 'md',
  };
  const vs = [
    { id: 'v2', product_id: 'p1', sku: 'S2', options: { Size: 'M' }, label: 'M', price: '110', mrp: null, stock: 3, track_inventory: true, weight_g: null, image_url: null, position: 1, active: true },
    { id: 'v1', product_id: 'p1', sku: 'S1', options: { Size: 'S' }, label: 'S', price: '100', mrp: '120', stock: 5, track_inventory: false, weight_g: 90, image_url: '/a.jpg', position: 0, active: false },
  ];
  test('loads variants in position order, splits attributes and maps the policies', () => {
    const f = formFromRecord(record, vs, categories);
    expect(f.variants.map(v => v.id)).toEqual(['v1', 'v2']);
    expect(f.variants[0]).toMatchObject({ sku: 'S1', price: '100', mrp: '120', stock: '5', track_inventory: false, active: false, weight_g: '90', image_url: '/a.jpg' });
    expect(f.hasOptions).toBe(true);
    expect(f.optionTypes[0]).toMatchObject({ name: 'Size', values: ['S', 'M'] });
    expect(f.attributes).toEqual({ material: 'Cotton', fit: 'Slim' });
    expect(f.extras.map(e => [e.key, e.value])).toEqual([['Country of origin', 'India']]);
    expect(f.returnMode).toBe('none');
    expect(f.returnDays).toBe('7');
    expect(f.highlights.map(h => h.text)).toEqual(['a', 'b']);
  });
  test('saving what was loaded writes the same product columns back (and never a rollup column)', () => {
    const f = formFromRecord(record, vs, categories);
    const p = productPayload(f, categories);
    expect(p).toMatchObject({
      product_number: 'T-1', name: 'Tee', brand: 'Urban', category_id: 'c2', subtitle: 'sub', description: 'desc', highlights: ['a', 'b'], tags: ['x', 'y'],
      attributes: { material: 'Cotton', fit: 'Slim', 'Country of origin': 'India' }, option_types: [{ name: 'Size', values: ['S', 'M'] }], images: ['/a.jpg', '/b.jpg'],
      weight_g: 250, length_cm: 10.5, width_cm: null, free_shipping: true, delivery_min_days: 3, delivery_max_days: 6, cod_allowed: false, return_window_days: 0,
      gst_rate: 12, hsn_code: '6109', max_qty_per_order: 4, low_stock_threshold: 2, badge: 'New', featured: true, meta_title: 'mt', meta_description: 'md',
    });
    for (const banned of ['price', 'price_max', 'mrp', 'discount_pct', 'in_stock', 'has_variants', 'total_stock', 'search_text', 'rating_avg', 'rating_count', 'sales_count', 'status', 'id']) {
      expect(p).not.toHaveProperty(banned);
    }
  });
  test('return policy radio maps to null / days / 0', () => {
    const f = formFromRecord({ ...record, return_window_days: null }, vs, categories);
    expect(f.returnMode).toBe('default');
    expect(productPayload(f, categories).return_window_days).toBeNull();
    expect(productPayload({ ...f, returnMode: 'custom', returnDays: '14' }, categories).return_window_days).toBe(14);
    expect(productPayload({ ...f, returnMode: 'none' }, categories).return_window_days).toBe(0);
  });
  test('options turned off save no option types; a cleared category clears the denormalised name', () => {
    const f = formFromRecord(record, vs, categories);
    expect(productPayload({ ...f, hasOptions: false }, categories).option_types).toEqual([]);
    expect(productPayload({ ...f, category_id: '' }, categories)).toMatchObject({ category_id: null, cat: null });
    expect(productPayload(f, categories)).not.toHaveProperty('cat');
  });
  test('a product with no variants loads one blank Default row', () => {
    const f = formFromRecord({ ...record, option_types: [] }, [], categories);
    expect(f.variants).toHaveLength(1);
    expect(f.hasOptions).toBe(false);
  });
});

describe('repairTypes', () => {
  test('adds option names and values that variants use but option_types lacks', () => {
    const types = repairTypes([blankType({ name: 'Size', values: ['S'] })], [{ options: { Size: 'XL', Colour: 'Red' } }]);
    expect(types.map(t => [t.name, t.values])).toEqual([['Size', ['S', 'XL']], ['Colour', ['Red']]]);
  });
});

describe('small helpers', () => {
  test('statusPlan writes the status last only when going live', () => {
    expect(statusPlan('draft', 'active')).toEqual({ target: 'active', writeLast: true });
    expect(statusPlan('active', 'active')).toEqual({ target: 'active', writeLast: false });
    expect(statusPlan('active', 'draft')).toEqual({ target: 'draft', writeLast: false });
  });
  test('dropMissingVariantImages clears a picture that is no longer one of the photos', () => {
    const rows = dropMissingVariantImages([{ image_url: '/a.jpg' }, { image_url: '/gone.jpg' }, { image_url: '' }], ['/a.jpg']);
    expect(rows.map(r => r.image_url)).toEqual(['/a.jpg', '', '']);
  });
  test('mediaUrlsOf gathers photos, video, cover and variant pictures', () => {
    const f = { ...blankForm(), images: ['/a'], video_url: '/v', video_cover_url: '/c', variants: [{ image_url: '/a' }, { image_url: '/d' }] };
    expect(mediaUrlsOf(f).sort()).toEqual(['/a', '/a', '/c', '/d', '/v']);
  });
  test('generated product numbers look like PRD-XXXXXX', () => {
    expect(generateProductNumber()).toMatch(/^PRD-[A-Z0-9]{6}$/);
  });
});
