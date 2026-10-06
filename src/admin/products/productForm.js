// Pure logic for the product form: a database row <-> the form's state, the validation rules and the columns that
// are written. No React, no network (unit-tested in productForm.test.js).
//
// Never written from here (a database trigger maintains them from the variants): price, price_max, mrp, discount_pct,
// in_stock, has_variants, total_stock, search_text, rating_*, sales_count. Legacy pottery columns are never touched.
import { attributeSchemaFor } from '../../utils/catalog';
import { mergeAttributes, splitAttributes, isFilled, extraId, toFormValue } from './attributes';
import {
  MAX_OPTION_TYPES, MAX_VARIANTS, blankType, blankVariant, comboCount, effectiveTypes, optionTypesPayload, optionsKey, typesFromRecord,
} from './variantMatrix';

// The columns the form reads (explicit: the edit screen never `select *`s, and never touches the dead legacy columns).
export const PRODUCT_COLUMNS = [
  'id', 'product_number', 'name', 'brand', 'category_id', 'cat', 'subtitle', 'description', 'highlights', 'attributes',
  'option_types', 'tags', 'status', 'badge', 'featured', 'images', 'image_position', 'video_url', 'video_position',
  'video_cover_url', 'video_cover_position', 'delivery_min_days', 'delivery_max_days', 'weight_g', 'length_cm', 'width_cm',
  'height_cm', 'free_shipping', 'gst_rate', 'hsn_code', 'return_window_days', 'cod_allowed', 'max_qty_per_order',
  'low_stock_threshold', 'meta_title', 'meta_description', 'sales_count', 'rating_avg', 'rating_count',
  'price', 'price_max', 'mrp', 'discount_pct', 'in_stock', 'has_variants', 'total_stock', 'created_at', 'updated_at',
].join(', ');

export const VARIANT_COLUMNS = 'id, product_id, sku, options, label, price, mrp, stock, track_inventory, weight_g, image_url, position, active, created_at, updated_at';

export const STATUSES = [
  { value: 'draft', label: 'Draft', help: 'Hidden from the store. Use this while you are still setting the product up.' },
  { value: 'active', label: 'Active', help: 'Live on the store: shoppers can find and buy it.' },
  { value: 'archived', label: 'Archived', help: 'Hidden from the store but kept, with its sales history. Restore it any time.' },
];

export const LIMITS = { name: 150, subtitle: 160, description: 5000, highlight: 160, highlights: 10, tags: 20, tag: 30, badge: 20, metaTitle: 70, metaDescription: 170, sku: 64, brand: 80, productNumber: 40 };

const str = (v) => (v === null || v === undefined ? '' : String(v));
const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const toNum = (s) => { const t = str(s).trim(); if (t === '') return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
const toInt = (s) => { const n = toNum(s); return n === null ? null : Math.trunc(n); };
const isInt = (s) => /^\d+$/.test(str(s).trim());
const isMoney = (s) => /^\d+(\.\d+)?$/.test(str(s).trim());

let hseq = 0;
export const highlightId = () => `h${Date.now().toString(36)}${(hseq++).toString(36)}`;

// ---------------------------------------------------------------------------------------------- blank + load
export function blankForm() {
  return {
    product_number: '', name: '', brand: '', category_id: '', subtitle: '', description: '',
    highlights: [], tags: [],
    images: [], image_position: '50% 50%', video_url: '', video_position: 0, video_cover_url: '', video_cover_position: '50% 50%',
    hasOptions: false, optionTypes: [], variants: [blankVariant()],
    attributes: {}, extras: [],
    weight_g: '', length_cm: '', width_cm: '', height_cm: '', free_shipping: false,
    delivery_min_days: '', delivery_max_days: '', cod_allowed: true,
    returnMode: 'default', returnDays: '7', gst_rate: '', hsn_code: '', max_qty_per_order: '10', low_stock_threshold: '',
    status: 'draft', featured: false, badge: '', meta_title: '', meta_description: '',
  };
}

// Make sure every option value used by a variant is listed in the option types (and every option name too), so a
// legacy / hand-edited product can never lose a variant the first time its options are edited.
export function repairTypes(types, variants) {
  const out = (types || []).map(t => ({ ...t, values: [...t.values] }));
  const byName = new Map(out.map(t => [t.name, t]));
  for (const v of variants || []) {
    for (const [k, val] of Object.entries(v.options || {})) {
      let t = byName.get(k);
      if (!t) { t = blankType({ name: k, values: [] }); out.push(t); byName.set(k, t); }
      if (!t.values.includes(String(val))) t.values.push(String(val));
    }
  }
  return out;
}

export function variantRowFromRecord(v) {
  return {
    key: v.id, id: v.id, options: v.options && typeof v.options === 'object' ? v.options : {}, label: v.label || 'Default',
    sku: str(v.sku), price: str(v.price), mrp: v.mrp === null || v.mrp === undefined ? '' : str(v.mrp), stock: str(v.stock ?? 0),
    track_inventory: v.track_inventory !== false, active: v.active !== false,
    weight_g: v.weight_g === null || v.weight_g === undefined ? '' : str(v.weight_g), image_url: str(v.image_url),
  };
}

export function formFromRecord(product, variantRecords, categories) {
  const p = product || {};
  const sorted = [...(variantRecords || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || String(a.label).localeCompare(String(b.label)));
  const rows = sorted.map(variantRowFromRecord);
  const withOptions = rows.some(r => Object.keys(r.options).length > 0) || (Array.isArray(p.option_types) && p.option_types.some(t => t?.name && (t.values || []).length));
  const types = withOptions ? repairTypes(typesFromRecord(p.option_types), rows) : [];
  const schema = attributeSchemaFor(categories || [], p.category_id);
  const { values, extras } = splitAttributes(p.attributes, schema);
  const rw = p.return_window_days;
  return {
    ...blankForm(),
    product_number: str(p.product_number), name: str(p.name), brand: str(p.brand), category_id: p.category_id || '',
    subtitle: str(p.subtitle), description: str(p.description),
    highlights: (Array.isArray(p.highlights) ? p.highlights : []).map(String).filter(Boolean).map(text => ({ id: highlightId(), text })),
    tags: (Array.isArray(p.tags) ? p.tags : []).map(String).filter(Boolean),
    images: (Array.isArray(p.images) ? p.images : []).filter(u => typeof u === 'string' && u),
    image_position: p.image_position || '50% 50%', video_url: str(p.video_url), video_position: Number(p.video_position) || 0,
    video_cover_url: str(p.video_cover_url), video_cover_position: p.video_cover_position || '50% 50%',
    hasOptions: withOptions, optionTypes: types, variants: rows.length ? rows : [blankVariant()],
    attributes: values, extras,
    weight_g: str(p.weight_g), length_cm: str(p.length_cm), width_cm: str(p.width_cm), height_cm: str(p.height_cm),
    free_shipping: !!p.free_shipping, delivery_min_days: str(p.delivery_min_days), delivery_max_days: str(p.delivery_max_days),
    cod_allowed: p.cod_allowed !== false,
    returnMode: rw === null || rw === undefined || rw === '' ? 'default' : Number(rw) === 0 ? 'none' : 'custom',
    returnDays: rw === null || rw === undefined || rw === '' || Number(rw) === 0 ? '7' : str(rw),
    gst_rate: str(p.gst_rate), hsn_code: str(p.hsn_code), max_qty_per_order: str(p.max_qty_per_order ?? 10),
    low_stock_threshold: str(p.low_stock_threshold),
    status: ['draft', 'active', 'archived'].includes(p.status) ? p.status : 'draft', featured: !!p.featured, badge: str(p.badge),
    meta_title: str(p.meta_title), meta_description: str(p.meta_description),
  };
}

// ---------------------------------------------------------------------------------------------- validation
// mode 'draft': what the database needs (a name, a price on every variant) plus every format rule.
// mode 'publish': additionally everything a shopper needs (category, a photo, an active variant, required attributes).
// Returns { errors, variantErrors: { [rowKey]: {price, mrp, sku, stock, weight_g} }, warnings, count }.
export function validateForm(form, { categories = [], mode = 'draft' } = {}) {
  const publish = mode === 'publish';
  const errors = {};
  const variantErrors = {};
  const warnings = [];
  const set = (k, msg) => { if (!errors[k]) errors[k] = msg; };

  if (!squash(form.name)) set('name', 'Enter the product name.');
  else if (form.name.length > LIMITS.name) set('name', `The name can be at most ${LIMITS.name} characters.`);
  if (form.product_number && squash(form.product_number).length > LIMITS.productNumber) set('product_number', `At most ${LIMITS.productNumber} characters.`);
  if (publish && !form.category_id) set('category_id', 'Choose a category before publishing.');
  if (form.brand.length > LIMITS.brand) set('brand', `At most ${LIMITS.brand} characters.`);
  if (form.subtitle.length > LIMITS.subtitle) set('subtitle', `At most ${LIMITS.subtitle} characters.`);
  if (form.description.length > LIMITS.description) set('description', `At most ${LIMITS.description} characters.`);
  if (squash(form.badge).length > LIMITS.badge) set('badge', `Badge text can be at most ${LIMITS.badge} characters.`);
  if (form.meta_title.length > LIMITS.metaTitle) set('meta_title', `At most ${LIMITS.metaTitle} characters.`);
  if (form.meta_description.length > LIMITS.metaDescription) set('meta_description', `At most ${LIMITS.metaDescription} characters.`);
  if (form.highlights.some(h => h.text.length > LIMITS.highlight)) set('highlights', `Each highlight can be at most ${LIMITS.highlight} characters.`);
  if (form.video_url && !/^(https?:\/\/|\/)/i.test(form.video_url.trim())) set('video_url', 'The video link must start with http:// or https://.');

  // -- images
  if (!form.images.length) {
    if (publish) set('images', 'Add at least one photo before publishing.');
    else warnings.push('This product has no photos yet. Add at least one before you publish it.');
  }

  // -- options & variants
  const eff = effectiveTypes(form.optionTypes);
  if (form.hasOptions) {
    if (!eff.length) {
      if (publish) set('options', 'Add at least one option with a value (for example Size: S, M, L) or turn options off.');
    }
    if (form.optionTypes.length > MAX_OPTION_TYPES) set('options', `A product can have at most ${MAX_OPTION_TYPES} options.`);
    if (form.optionTypes.some(t => squash(t.name) && !t.values.length) && eff.length) set('options', 'Every option needs at least one value. Remove the empty option or add values to it.');
    if (comboCount(form.optionTypes) > MAX_VARIANTS) set('options', `That is more than ${MAX_VARIANTS} variants. Remove some values.`);
  }
  const rows = form.variants || [];
  if (!rows.length) set('variants', 'A product needs at least one variant.');
  const skus = new Map();
  const combos = new Map();
  rows.forEach((r) => {
    const e = {};
    const price = str(r.price).trim();
    if (price === '') e.price = 'Required';
    else if (!isMoney(price)) e.price = 'Enter a valid price';
    const mrp = str(r.mrp).trim();
    if (mrp !== '') {
      if (!isMoney(mrp)) e.mrp = 'Enter a valid MRP';
      else if (!e.price && Number(mrp) < Number(price)) e.mrp = 'At least the price';
    }
    const stock = str(r.stock).trim();
    if (r.track_inventory !== false && stock !== '' && !isInt(stock)) e.stock = 'Whole number';
    const w = str(r.weight_g).trim();
    if (w !== '' && !isInt(w)) e.weight_g = 'Whole grams';
    const sku = str(r.sku).trim();
    if (sku.length > LIMITS.sku) e.sku = `Max ${LIMITS.sku} chars`;
    if (sku) {
      const k = sku.toLowerCase();
      if (skus.has(k)) { e.sku = 'Duplicate SKU'; variantErrors[skus.get(k)] = { ...(variantErrors[skus.get(k)] || {}), sku: 'Duplicate SKU' }; }
      else skus.set(k, r.key);
    }
    const ck = optionsKey(r.options);
    if (combos.has(ck)) set('variants', 'Two variants have the same option combination.');
    combos.set(ck, true);
    if (Object.keys(e).length) variantErrors[r.key] = { ...(variantErrors[r.key] || {}), ...e };
  });
  if (Object.keys(variantErrors).length) set('variants', errors.variants || 'Fix the highlighted variant fields.');
  if (publish) {
    const live = rows.filter(r => r.active !== false);
    if (!live.length) set('variants', 'A published product needs at least one active variant.');
  } else if (form.status === 'active' && !rows.some(r => r.active !== false)) {
    set('variants', 'An active product needs at least one active variant.');
  }

  // -- shipping & policies
  const nonNegInt = (k, label, max) => {
    const v = str(form[k]).trim();
    if (v === '') return;
    if (!isInt(v)) set(k, `${label} must be a whole number.`);
    else if (max !== undefined && Number(v) > max) set(k, `${label} can be at most ${max}.`);
  };
  nonNegInt('weight_g', 'Weight');
  ['length_cm', 'width_cm', 'height_cm'].forEach((k) => {
    const v = str(form[k]).trim();
    if (v !== '' && !isMoney(v)) set(k, 'Enter a valid size in cm.');
  });
  nonNegInt('delivery_min_days', 'Minimum days', 365);
  nonNegInt('delivery_max_days', 'Maximum days', 365);
  const dmin = str(form.delivery_min_days).trim(); const dmax = str(form.delivery_max_days).trim();
  if (!errors.delivery_min_days && !errors.delivery_max_days) {
    if ((dmin === '') !== (dmax === '')) set('delivery_max_days', 'Set both the minimum and maximum days, or leave both blank.');
    else if (dmin !== '' && Number(dmin) > Number(dmax)) set('delivery_max_days', 'The maximum cannot be lower than the minimum.');
  }
  if (form.returnMode === 'custom') {
    if (!isInt(form.returnDays) || Number(form.returnDays) < 1 || Number(form.returnDays) > 365) set('returnDays', 'Enter 1 to 365 days.');
  }
  const gst = str(form.gst_rate).trim();
  if (gst !== '' && (!isMoney(gst) || Number(gst) > 100)) set('gst_rate', 'Enter a rate between 0 and 100.');
  const hsn = str(form.hsn_code).trim();
  if (hsn !== '' && !/^\d{2,8}$/.test(hsn)) set('hsn_code', 'HSN codes are 2 to 8 digits.');
  const mq = str(form.max_qty_per_order).trim();
  if (mq === '' || !isInt(mq) || Number(mq) < 1 || Number(mq) > 1000) set('max_qty_per_order', 'Enter 1 to 1000.');
  const lt = str(form.low_stock_threshold).trim();
  if (lt !== '' && !isInt(lt)) set('low_stock_threshold', 'Whole number, or leave blank.');

  // -- attributes
  const schema = attributeSchemaFor(categories, form.category_id);
  const attrErrors = {};
  for (const def of schema) {
    const raw = form.attributes[def.key];
    if (def.type === 'number' && str(raw).trim() !== '' && !Number.isFinite(Number(str(raw).trim()))) attrErrors[def.key] = `${def.label} must be a number.`;
    else if (publish && def.required && !isFilled(def, raw)) attrErrors[def.key] = `${def.label} is required.`;
  }
  const merged = mergeAttributes(form.attributes, form.extras, schema);
  const extraProblems = merged.problems.filter(p => !/must be a number/.test(p));
  if (Object.keys(attrErrors).length) errors.attributes = 'Fix the highlighted specifications.';
  if (extraProblems.length) errors.extras = extraProblems[0];
  if (form.tags.length > LIMITS.tags) set('tags', `At most ${LIMITS.tags} tags.`);

  const count = Object.keys(errors).length;
  return { errors, variantErrors, attrErrors, warnings, count, ok: count === 0 };
}

// ------------------------------------------------------------------------------------------------ payload
// A new product number when none was typed: PRD- plus six characters from the clock (checked for uniqueness on save).
export const generateProductNumber = () => `PRD-${Date.now().toString(36).toUpperCase().slice(-6)}`;

// The product columns that are written. `status` is added by the caller (it is written last when publishing).
export function productPayload(form, categories) {
  const schema = attributeSchemaFor(categories || [], form.category_id);
  const { attributes } = mergeAttributes(form.attributes, form.extras, schema);
  const clean = (list) => Array.from(new Set(list.map(squash).filter(Boolean)));
  const hasOptions = form.hasOptions && effectiveTypes(form.optionTypes).length > 0;
  return {
    product_number: squash(form.product_number) || null,
    name: squash(form.name),
    brand: squash(form.brand) || null,
    category_id: form.category_id || null,
    ...(form.category_id ? {} : { cat: null }),
    subtitle: squash(form.subtitle) || null,
    description: form.description.trim() || null,
    highlights: form.highlights.map(h => squash(h.text)).filter(Boolean),
    tags: clean(form.tags),
    attributes,
    option_types: hasOptions ? optionTypesPayload(form.optionTypes) : [],
    images: form.images,
    image_position: form.image_position || '50% 50%',
    video_url: form.video_url.trim() || null,
    video_position: Number(form.video_position) || 0,
    video_cover_url: form.video_cover_url.trim() || null,
    video_cover_position: form.video_cover_position || '50% 50%',
    weight_g: toInt(form.weight_g),
    length_cm: toNum(form.length_cm), width_cm: toNum(form.width_cm), height_cm: toNum(form.height_cm),
    free_shipping: !!form.free_shipping,
    delivery_min_days: toInt(form.delivery_min_days), delivery_max_days: toInt(form.delivery_max_days),
    cod_allowed: form.cod_allowed !== false,
    return_window_days: form.returnMode === 'none' ? 0 : form.returnMode === 'custom' ? toInt(form.returnDays) : null,
    gst_rate: toNum(form.gst_rate), hsn_code: str(form.hsn_code).trim() || null,
    max_qty_per_order: toInt(form.max_qty_per_order) ?? 10,
    low_stock_threshold: toInt(form.low_stock_threshold),
    badge: squash(form.badge) || null,
    featured: !!form.featured,
    meta_title: squash(form.meta_title) || null,
    meta_description: squash(form.meta_description) || null,
  };
}

// Every media URL a form refers to (photos, the video and its cover, variant pictures) -- for storage clean-up.
export const mediaUrlsOf = (form) => [form.images, form.video_url, form.video_cover_url, (form.variants || []).map(v => v.image_url)].flat(2).filter(Boolean);

// The status a save should end with and whether it must be written last (publishing a product that is not live yet).
export function statusPlan(currentStatus, targetStatus) {
  return { target: targetStatus, writeLast: targetStatus === 'active' && currentStatus !== 'active' };
}

// Re-points a variant picture at a photo that still exists (a removed photo clears the rows that used it).
export function dropMissingVariantImages(variants, images) {
  const set = new Set(images);
  return variants.map(v => (v.image_url && !set.has(v.image_url) ? { ...v, image_url: '' } : v));
}

// "12 / 70"-style helpers for the SEO preview.
export const clip = (s, n) => { const t = squash(s); return t.length > n ? `${t.slice(0, Math.max(0, n - 1)).trimEnd()}…` : t; };

// A product's variant default for a new row appended later (price etc. copied from the first row).
export function seedFromVariants(variants) {
  const f = (variants || [])[0] || {};
  return { price: f.price ?? '', mrp: f.mrp ?? '', track_inventory: f.track_inventory ?? true, weight_g: f.weight_g ?? '' };
}

export { extraId, toFormValue };
