// Product CSV: an RFC-4180 parser, the export layout (one row per VARIANT) and the import validator / planner.
// Pure -- no React, no network. The screens load what the planner needs (existing products, variants, SKU owners)
// and call these functions; productApi.js executes the plan. Unit-tested in productCsv.test.js.
//
// Layout (header names are matched case-insensitively; unknown columns are ignored with a notice)
//   every row     product_number, name, brand, category, status, option1_name, option1_value, option2_name, option2_value,
//                 option3_name, option3_value, sku, price, mrp, stock, track_inventory, weight_g, variant_active, variant_image
//   FIRST row of  subtitle, description, highlights, tags, attributes, images, image_position, video_url, video_position,
//   each product  video_cover_url, video_cover_position, featured, badge, free_shipping, cod_allowed, delivery_min_days,
//                 delivery_max_days, default_weight_g, length_cm, width_cm, height_cm, return_window_days, gst_rate, hsn_code,
//                 max_qty_per_order, low_stock_threshold, meta_title, meta_description
// An empty cell means "leave as it is" (an update) or "use the default" (a new product).
// Lists use "|" between items, attributes are key=value pairs separated by "|", multi-select values use ";".
// A literal | ; = or \ inside an item is written with a backslash in front.
import { attributeSchemaFor } from '../../utils/catalog';
import { displayValue } from './attributes';
import { categoryPath, findCategoryByText } from './categoryTools';
import { LIMITS } from './productForm';
import { MAX_OPTION_TYPES, optionsKey } from './variantMatrix';
import { variantLabelFromOptions } from '../../utils/catalog';

// ============================================================================================ 1. the parser
// Returns { rows: string[][], lines: number[] (the file line each record starts on), error?: string, delimiter }.
// Handles quoted fields with embedded commas / quotes ("") / newlines, CRLF, LF or CR line ends, a leading BOM and a
// missing final newline. Blank lines are skipped. A quote that is never closed is reported (the rest of the file
// becomes that cell) rather than silently swallowed.
export function parseCsv(input, { delimiter } = {}) {
  let text = String(input ?? '');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const d = delimiter || sniffDelimiter(text);
  const rows = [];
  const lines = [];
  let row = [];
  let field = '';
  let quoted = false;     // inside "..."
  let wasQuoted = false;  // the current field started with a quote (so "" stays a value, not blank-line material)
  let line = 1;
  let startLine = 1;
  let error;

  const endField = () => { row.push(field); field = ''; wasQuoted = false; };
  const endRow = () => {
    endField();
    const blank = row.length === 1 && row[0] === '' && !wasQuoted;
    if (!blank) { rows.push(row); lines.push(startLine); }
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else { field += c; if (c === '\n') line += 1; }
      continue;
    }
    if (c === '"' && field === '') { quoted = true; wasQuoted = true; continue; }
    if (c === d) { endField(); continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      endRow();
      line += 1;
      startLine = line;
      continue;
    }
    field += c;
  }
  if (quoted) error = `A quoted value starting on line ${startLine} is never closed (a missing ").`;
  if (field !== '' || row.length > 0 || wasQuoted) endRow();
  return { rows, lines, error, delimiter: d };
}

// Excel in some regions saves "CSV" with ; or tab: use that when the header line has no comma at all.
function sniffDelimiter(text) {
  const first = text.replace(/^﻿/, '').split(/\r\n|\n|\r/, 1)[0] || '';
  if (first.includes(',')) return ',';
  if (first.includes('\t')) return '\t';
  if (first.includes(';')) return ';';
  return ',';
}

// ========================================================================================= 2. list escaping
const escapeFor = (s, chars) => String(s).replace(/\\/g, '\\\\').replace(new RegExp(`[${chars.map(c => `\\${c}`).join('')}]`, 'g'), m => `\\${m}`);

export function joinList(items, sep = '|') { return (items || []).map(s => escapeFor(s, [sep])).join(sep); }

// Splits on an unescaped separator; \x yields x. Items are trimmed and empty ones dropped.
export function splitList(text, sep = '|') {
  const out = [];
  let cur = '';
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) { cur += s[i + 1]; i += 1; continue; }
    if (c === sep) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}

// key=value pairs. Keys escape "=" and "|"; values escape "|".
export function joinPairs(pairs) { return pairs.map(([k, v]) => `${escapeFor(k, ['|', '='])}=${escapeFor(v, ['|'])}`).join('|'); }

export function splitPairs(text) {
  const out = [];
  for (const item of splitItemsRaw(text)) {
    let key = '';
    let i = 0;
    for (; i < item.length; i += 1) {
      if (item[i] === '\\' && i + 1 < item.length) { key += item[i + 1]; i += 1; continue; }
      if (item[i] === '=') break;
      key += item[i];
    }
    if (i >= item.length) { out.push({ key: key.trim(), value: '', malformed: true }); continue; }
    const rest = item.slice(i + 1).replace(/\\(.)/g, '$1');
    out.push({ key: key.trim(), value: rest.trim() });
  }
  return out.filter(p => p.key || p.value);
}
// splits on "|" but keeps the backslash escapes in place (so key / value can be unescaped separately)
function splitItemsRaw(text) {
  const out = [];
  let cur = '';
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '\\' && i + 1 < s.length) { cur += s[i] + s[i + 1]; i += 1; continue; }
    if (s[i] === '|') { out.push(cur); cur = ''; continue; }
    cur += s[i];
  }
  out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}

// ============================================================================================ 3. the layout
export const VARIANT_COLUMNS_CSV = ['option1_name', 'option1_value', 'option2_name', 'option2_value', 'option3_name', 'option3_value', 'sku', 'price', 'mrp', 'stock', 'track_inventory', 'weight_g', 'variant_active', 'variant_image'];
export const LEADING_COLUMNS = ['product_number', 'name', 'brand', 'category', 'status'];
export const PRODUCT_ONLY_COLUMNS = [
  'subtitle', 'description', 'highlights', 'tags', 'attributes', 'images', 'image_position', 'video_url', 'video_position',
  'video_cover_url', 'video_cover_position', 'featured', 'badge', 'free_shipping', 'cod_allowed', 'delivery_min_days',
  'delivery_max_days', 'default_weight_g', 'length_cm', 'width_cm', 'height_cm', 'return_window_days', 'gst_rate', 'hsn_code',
  'max_qty_per_order', 'low_stock_threshold', 'meta_title', 'meta_description',
];
export const CSV_COLUMNS = [...LEADING_COLUMNS, ...VARIANT_COLUMNS_CSV, ...PRODUCT_ONLY_COLUMNS];

const ALIASES = {
  product_no: 'product_number', product_code: 'product_number', productnumber: 'product_number',
  title: 'name', product_name: 'name', category_name: 'category',
  compare_at_price: 'mrp', list_price: 'mrp', selling_price: 'price',
  quantity: 'stock', qty: 'stock', inventory: 'stock', track: 'track_inventory', track_stock: 'track_inventory',
  weight: 'weight_g', weight_grams: 'weight_g', variant_weight_g: 'weight_g', variant_sku: 'sku', active: 'variant_active', variant_enabled: 'variant_active',
  image: 'variant_image', variant_image_url: 'variant_image', photos: 'images', image_urls: 'images',
  product_weight_g: 'default_weight_g', specifications: 'attributes', specs: 'attributes',
};

export function normalizeHeader(h) {
  let k = String(h ?? '').replace(/^﻿/, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  k = k.replace(/^option_(\d)_/, 'option$1_');
  return ALIASES[k] || k;
}

const yn = (b) => (b ? 'yes' : 'no');
const numText = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? '' : String(Number(v)));
// A leading = + - @ in a cell was neutralised with an apostrophe on export; undo that when reading it back.
const unNeutralise = (s) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);

function attributesText(attributes) {
  const attrs = attributes && typeof attributes === 'object' && !Array.isArray(attributes) ? attributes : {};
  return joinPairs(Object.entries(attrs).map(([k, v]) => [k, Array.isArray(v) ? joinList(v.map(String), ';') : typeof v === 'boolean' ? yn(v) : displayValue(v)]).filter(([, v]) => v !== ''));
}

// One product -> its CSV records (one per variant), each an object keyed by CSV column.
export function exportRecords(product, variants, categories) {
  const list = [...(variants || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || String(a.label).localeCompare(String(b.label)));
  const names = (Array.isArray(product.option_types) ? product.option_types : []).map(t => t?.name).filter(Boolean);
  const base = {
    product_number: product.product_number || '', name: product.name || '', brand: product.brand || '',
    category: product.category_id ? categoryPath(categories, product.category_id) : '', status: product.status || '',
  };
  const productLevel = {
    subtitle: product.subtitle || '', description: product.description || '',
    highlights: joinList((product.highlights || []).map(String)), tags: joinList((product.tags || []).map(String)),
    attributes: attributesText(product.attributes), images: joinList((product.images || []).map(String)),
    image_position: product.image_position || '', video_url: product.video_url || '', video_position: product.video_url ? numText(product.video_position) : '',
    video_cover_url: product.video_cover_url || '', video_cover_position: product.video_cover_url ? (product.video_cover_position || '') : '',
    featured: yn(product.featured), badge: product.badge || '', free_shipping: yn(product.free_shipping), cod_allowed: yn(product.cod_allowed !== false),
    delivery_min_days: numText(product.delivery_min_days), delivery_max_days: numText(product.delivery_max_days), default_weight_g: numText(product.weight_g),
    length_cm: numText(product.length_cm), width_cm: numText(product.width_cm), height_cm: numText(product.height_cm),
    return_window_days: numText(product.return_window_days), gst_rate: numText(product.gst_rate), hsn_code: product.hsn_code || '',
    max_qty_per_order: numText(product.max_qty_per_order), low_stock_threshold: numText(product.low_stock_threshold),
    meta_title: product.meta_title || '', meta_description: product.meta_description || '',
  };
  const rows = list.length ? list : [null];
  return rows.map((v, i) => {
    const opts = v?.options || {};
    const orderNames = names.length ? names : Object.keys(opts);
    const rec = { ...Object.fromEntries(CSV_COLUMNS.map(c => [c, ''])), ...base };
    orderNames.slice(0, MAX_OPTION_TYPES).forEach((n, j) => { rec[`option${j + 1}_name`] = n; rec[`option${j + 1}_value`] = opts[n] === undefined ? '' : String(opts[n]); });
    if (v) {
      Object.assign(rec, {
        sku: v.sku || '', price: numText(v.price), mrp: numText(v.mrp), stock: numText(v.stock), track_inventory: yn(v.track_inventory !== false),
        weight_g: numText(v.weight_g), variant_active: yn(v.active !== false), variant_image: v.image_url || '',
      });
    }
    if (i === 0) Object.assign(rec, productLevel);
    return rec;
  });
}

export const exportColumns = () => CSV_COLUMNS.map(c => ({ label: c, get: (r) => r[c] }));

// The downloadable template: the header and two draft examples (a simple product and one with options).
export function templateRecords(categories) {
  const leaf = (categories || []).find(c => c.parent_id) || (categories || [])[0];
  const category = leaf ? categoryPath(categories, leaf.id) : 'Category name';
  const blank = Object.fromEntries(CSV_COLUMNS.map(c => [c, '']));
  return [
    { ...blank, product_number: 'EXAMPLE-1', name: 'Example mug (delete this row)', brand: 'Your brand', category, status: 'draft', sku: 'EXAMPLE-1', price: '299', mrp: '399', stock: '25', track_inventory: 'yes', weight_g: '350', variant_active: 'yes', subtitle: 'A short line under the name', description: 'Describe the product here.', highlights: 'Dishwasher safe|Holds 300 ml', tags: 'mug|kitchen', attributes: '', images: 'https://example.com/mug.jpg', featured: 'no', cod_allowed: 'yes', free_shipping: 'no' },
    { ...blank, product_number: 'EXAMPLE-2', name: 'Example t-shirt (delete these rows)', brand: 'Your brand', category, status: 'draft', option1_name: 'Size', option1_value: 'M', option2_name: 'Colour', option2_value: 'Red', sku: 'EXAMPLE-2-M-RED', price: '499', mrp: '699', stock: '10', track_inventory: 'yes', variant_active: 'yes', description: 'One row per variant. Product details go on the first row only.' },
    { ...blank, product_number: 'EXAMPLE-2', name: 'Example t-shirt (delete these rows)', brand: 'Your brand', category, status: 'draft', option1_name: 'Size', option1_value: 'L', option2_name: 'Colour', option2_value: 'Red', sku: 'EXAMPLE-2-L-RED', price: '499', mrp: '699', stock: '0', track_inventory: 'yes', variant_active: 'yes' },
  ];
}

// ============================================================================================ 4. reading a file
// text -> { ok, error?, header: string[] (as written), records: [{ line, raw: string[], cells: {canonicalColumn: value} }],
//           unknownColumns: string[], missing: string[] }
export function readImportFile(text) {
  const parsed = parseCsv(text);
  if (!parsed.rows.length) return { ok: false, error: 'The file is empty.', header: [], records: [], unknownColumns: [], missing: [] };
  const header = parsed.rows[0].map(h => String(h));
  const canon = header.map(normalizeHeader);
  const known = new Set(CSV_COLUMNS);
  const unknownColumns = header.filter((h, i) => h.trim() && !known.has(canon[i]));
  const seen = new Set();
  const dup = canon.find((c, i) => known.has(c) && (seen.has(c) ? true : (seen.add(c), false)));
  if (dup) return { ok: false, error: `The column "${dup}" appears more than once. Remove the repeated column and try again.`, header, records: [], unknownColumns, missing: [] };
  if (!canon.includes('name') && !canon.includes('product_number')) {
    return { ok: false, error: 'This does not look like a product file: there is no "name" or "product_number" column. Download the template to see the layout.', header, records: [], unknownColumns, missing: ['name'] };
  }
  const records = parsed.rows.slice(1).map((raw, i) => {
    const cells = {};
    canon.forEach((c, j) => { if (known.has(c)) cells[c] = unNeutralise(String(raw[j] ?? '').trim()); });
    return { line: parsed.lines[i + 1], raw, cells };
  }).filter(r => Object.values(r.cells).some(v => v !== ''));
  const missing = ['price'].filter(c => !canon.includes(c));
  return { ok: true, header, records, unknownColumns, missing, parseError: parsed.error };
}

// ====================================================================================== 5. validate + plan
const lc = (s) => String(s ?? '').trim().toLowerCase();
const STATUS_WORDS = { draft: 'draft', active: 'active', live: 'active', published: 'active', archived: 'archived', archive: 'archived' };
const YES = new Set(['yes', 'y', 'true', '1', 'on']);
const NO = new Set(['no', 'n', 'false', '0', 'off']);

function bool(v) { const t = lc(v); if (t === '') return { blank: true }; if (YES.has(t)) return { value: true }; if (NO.has(t)) return { value: false }; return { bad: true }; }
function intOf(v) { const t = String(v ?? '').trim(); if (t === '') return { blank: true }; if (!/^\d+$/.test(t)) return { bad: true }; return { value: Number(t) }; }
function moneyOf(v) { const t = String(v ?? '').trim().replace(/^₹\s*/, '').replace(/,/g, ''); if (t === '') return { blank: true }; if (!/^\d+(\.\d+)?$/.test(t)) return { bad: true }; return { value: Number(t) }; }
const okUrl = (u) => /^(https?:\/\/|\/)/i.test(u);

const sameNum = (a, b) => (a === null || a === undefined || a === '' ? b === null || b === undefined || b === '' : Number(a) === Number(b));
const sameText = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));
const sameAttrs = (a, b) => {
  const x = a && typeof a === 'object' ? a : {}; const y = b && typeof b === 'object' ? b : {};
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of keys) if (displayValue(x[k]) !== displayValue(y[k])) return false;
  return true;
};

// Groups the records into products: rows sharing a product_number are one product (wherever they sit in the file); a
// row with no number continues the previous product when its name is blank or the same, otherwise it starts a new one.
export function groupRecords(records) {
  const groups = [];
  const byNumber = new Map();
  let last = null;
  for (const rec of records) {
    const number = rec.cells.product_number || '';
    const name = rec.cells.name || '';
    if (number) {
      let g = byNumber.get(lc(number));
      if (!g) { g = { number, rows: [] }; byNumber.set(lc(number), g); groups.push(g); }
      g.rows.push(rec);
      last = g;
    } else if (last && (!name || lc(name) === lc(last.rows[0].cells.name))) {
      last.rows.push(rec);
    } else {
      last = { number: '', rows: [rec] };
      groups.push(last);
    }
  }
  return groups;
}

const firstNonBlank = (rows, col) => { for (const r of rows) if (r.cells[col]) return r.cells[col]; return ''; };

// ctx: { categories, brand?, existingByNumber: Map(lc number -> product row | { ambiguous: n }),
//        variantsByProduct: Map(product id -> variant rows), skuOwners: Map(lc sku -> { id, product_id, product_number, product_name }) }
// -> { products: [plan], problems: [{ line, level, message, column? }], totals }
export function planImport(records, ctx) {
  const categories = ctx.categories || [];
  const problems = [];
  const groups = groupRecords(records);
  const seenSkus = new Map(); // lc sku -> { line, number }
  const products = [];

  for (const g of groups) {
    const plan = planProduct(g, ctx, categories, seenSkus);
    problems.push(...plan.problems);
    products.push(plan);
  }

  const totals = {
    rows: records.length, products: products.length,
    validProducts: products.filter(p => !p.errors.length).length,
    validRows: products.filter(p => !p.errors.length).reduce((s, p) => s + p.variants.length, 0),
    skippedRows: products.filter(p => p.errors.length).reduce((s, p) => s + p.rows.length, 0),
    creates: products.filter(p => !p.errors.length && p.action === 'create').length,
    updates: products.filter(p => !p.errors.length && p.action === 'update' && p.changed).length,
    unchanged: products.filter(p => !p.errors.length && p.action === 'update' && !p.changed).length,
    warnings: problems.filter(p => p.level === 'warning').length,
    errors: problems.filter(p => p.level === 'error').length,
  };
  return { products, problems, totals };
}

function planProduct(g, ctx, categories, seenSkus) {
  const rows = g.rows;
  const errors = [];
  const warnings = [];
  const problems = [];
  const push = (level, rec, message, column) => {
    const item = { line: rec?.line ?? rows[0].line, level, message, column };
    (level === 'error' ? errors : warnings).push(item);
    problems.push({ ...item, number: g.number });
  };
  const head = rows[0];
  const number = g.number || firstNonBlank(rows, 'product_number');
  const name = firstNonBlank(rows, 'name');

  // ---- is it an existing product?
  let existing = null;
  if (number) {
    const found = ctx.existingByNumber?.get(lc(number));
    if (found?.ambiguous) push('error', head, `${found.ambiguous} products already share the product number "${number}", so it is unclear which to update. Make the numbers unique first.`, 'product_number');
    else existing = found || null;
  }
  const existingVariants = existing ? (ctx.variantsByProduct?.get(existing.id) || []) : [];

  // The template's two example products are samples, not data: importing them untouched would create junk.
  if (/^EXAMPLE-\d+$/i.test(number)) push('error', head, 'This is an example row from the template. Delete it or replace it with your own product.', 'product_number');

  // ---- name, brand, status, category
  const desired = {}; // product columns to write (only what the file gave)
  if (!name && !existing) push('error', head, number ? `Product "${number}" has no name.` : 'This row has neither a product number nor a name.', 'name');
  if (name) {
    if (name.length > LIMITS.name) push('error', head, `The name is longer than ${LIMITS.name} characters.`, 'name');
    desired.name = name;
  }
  if (number) { if (number.length > LIMITS.productNumber) push('error', head, `The product number is longer than ${LIMITS.productNumber} characters.`, 'product_number'); desired.product_number = number; }
  const brand = firstNonBlank(rows, 'brand'); if (brand) desired.brand = brand;

  const statusText = firstNonBlank(rows, 'status');
  let status = existing ? existing.status : 'draft';
  if (statusText) {
    const s = STATUS_WORDS[lc(statusText)];
    if (!s) push('error', head, `Unknown status "${statusText}" - use draft, active or archived.`, 'status');
    else { status = s; desired.status = s; }
  } else if (!existing) desired.status = 'draft';

  const catText = firstNonBlank(rows, 'category');
  let category = existing ? categories.find(c => c.id === existing.category_id) || null : null;
  if (catText) {
    const f = findCategoryByText(categories, catText);
    if (f.error) push('error', head, f.error, 'category');
    else if (f.category) { category = f.category; desired.category_id = f.category.id; }
  } else if (!existing && status !== 'active') push('warning', head, 'No category - fine for a draft, but choose one before publishing.', 'category');
  if (status === 'active' && !category && !(catText && !category)) push('error', head, 'An active product needs a category.', 'category');

  // ---- product-level optional columns
  const text = (col, field, max) => { const v = firstNonBlank(rows, col); if (!v) return; if (max && v.length > max) { push('error', head, `${col} is longer than ${max} characters.`, col); return; } desired[field || col] = v; };
  text('subtitle', 'subtitle', LIMITS.subtitle);
  text('description', 'description', LIMITS.description);
  text('badge', 'badge', LIMITS.badge);
  text('meta_title', 'meta_title', LIMITS.metaTitle);
  text('meta_description', 'meta_description', LIMITS.metaDescription);
  text('image_position', 'image_position');
  text('video_cover_position', 'video_cover_position');
  const hsn = firstNonBlank(rows, 'hsn_code'); if (hsn) { if (!/^\d{2,8}$/.test(hsn)) push('error', head, 'hsn_code must be 2 to 8 digits.', 'hsn_code'); else desired.hsn_code = hsn; }

  const hl = firstNonBlank(rows, 'highlights'); if (hl) { const items = splitList(hl); if (items.length > LIMITS.highlights) push('warning', head, `Only the first ${LIMITS.highlights} highlights are used.`, 'highlights'); desired.highlights = items.slice(0, LIMITS.highlights); }
  const tg = firstNonBlank(rows, 'tags'); if (tg) { const items = Array.from(new Set(splitList(tg).map(t => t.slice(0, LIMITS.tag)))).slice(0, LIMITS.tags); desired.tags = items; }
  const im = firstNonBlank(rows, 'images');
  if (im) {
    const items = splitList(im);
    const badUrl = items.find(u => !okUrl(u));
    if (badUrl) push('error', head, `"${badUrl}" is not a valid image link (it must start with http:// or https://).`, 'images');
    else desired.images = items;
  }
  const vu = firstNonBlank(rows, 'video_url'); if (vu) { if (!okUrl(vu)) push('error', head, 'video_url must start with http:// or https://.', 'video_url'); else desired.video_url = vu; }
  const vc = firstNonBlank(rows, 'video_cover_url'); if (vc) { if (!okUrl(vc)) push('error', head, 'video_cover_url must start with http:// or https://.', 'video_cover_url'); else desired.video_cover_url = vc; }
  const vp = intOf(firstNonBlank(rows, 'video_position')); if (vp.bad) push('error', head, 'video_position must be a whole number.', 'video_position'); else if (!vp.blank) desired.video_position = vp.value;

  for (const [col, field] of [['featured', 'featured'], ['free_shipping', 'free_shipping'], ['cod_allowed', 'cod_allowed']]) {
    const b = bool(firstNonBlank(rows, col));
    if (b.bad) push('error', head, `${col} must be yes or no.`, col); else if (!b.blank) desired[field] = b.value;
  }
  for (const [col, field, max] of [['delivery_min_days', 'delivery_min_days', 365], ['delivery_max_days', 'delivery_max_days', 365], ['return_window_days', 'return_window_days', 365], ['max_qty_per_order', 'max_qty_per_order', 1000], ['low_stock_threshold', 'low_stock_threshold', 1000000], ['default_weight_g', 'weight_g', 1000000]]) {
    const n = intOf(firstNonBlank(rows, col));
    if (n.bad) push('error', head, `${col} must be a whole number.`, col);
    else if (!n.blank) { if (n.value > max) push('error', head, `${col} can be at most ${max}.`, col); else if (col === 'max_qty_per_order' && n.value < 1) push('error', head, 'max_qty_per_order must be at least 1.', col); else desired[field] = n.value; }
  }
  for (const col of ['length_cm', 'width_cm', 'height_cm']) {
    const n = moneyOf(firstNonBlank(rows, col));
    if (n.bad) push('error', head, `${col} must be a number.`, col); else if (!n.blank) desired[col] = n.value;
  }
  const gst = moneyOf(firstNonBlank(rows, 'gst_rate'));
  if (gst.bad || (gst.value !== undefined && gst.value > 100)) push('error', head, 'gst_rate must be a number between 0 and 100.', 'gst_rate'); else if (!gst.blank) desired.gst_rate = gst.value;
  if (desired.delivery_min_days !== undefined || desired.delivery_max_days !== undefined) {
    const mn = desired.delivery_min_days ?? existing?.delivery_min_days; const mx = desired.delivery_max_days ?? existing?.delivery_max_days;
    if ((mn === null || mn === undefined) !== (mx === null || mx === undefined)) push('error', head, 'Set both delivery_min_days and delivery_max_days, or neither.', 'delivery_max_days');
    else if (Number(mn) > Number(mx)) push('error', head, 'delivery_max_days cannot be lower than delivery_min_days.', 'delivery_max_days');
  }

  // ---- attributes (typed by the category's schema)
  const attrText = firstNonBlank(rows, 'attributes');
  if (attrText) {
    const schema = attributeSchemaFor(categories, category?.id);
    const byKey = new Map(schema.map(d => [d.key, d]));
    const byLabel = new Map(schema.map(d => [lc(d.label), d]));
    const attrs = {};
    for (const pair of splitPairs(attrText)) {
      if (pair.malformed) { push('error', head, `Attribute "${pair.key}" has no value - write it as key=value.`, 'attributes'); continue; }
      const def = byKey.get(pair.key) || byKey.get(lc(pair.key)) || byLabel.get(lc(pair.key));
      if (!def) { attrs[pair.key] = pair.value; continue; }
      if (def.type === 'number') { const n = moneyOf(pair.value); if (n.bad) push('error', head, `${def.label} must be a number.`, 'attributes'); else if (!n.blank) attrs[def.key] = n.value; }
      else if (def.type === 'boolean') { const b = bool(pair.value); if (b.bad) push('error', head, `${def.label} must be yes or no.`, 'attributes'); else if (!b.blank) attrs[def.key] = b.value; }
      else if (def.type === 'multiselect') { const vals = splitList(pair.value, ';'); const off = vals.filter(v => !(def.options || []).some(o => lc(o) === lc(v))); if (off.length && (def.options || []).length) push('warning', head, `${def.label}: "${off.join('", "')}" is not one of the choices.`, 'attributes'); if (vals.length) attrs[def.key] = vals; }
      else {
        if (def.type === 'select' && (def.options || []).length && !(def.options || []).some(o => lc(o) === lc(pair.value))) push('warning', head, `${def.label}: "${pair.value}" is not one of the choices.`, 'attributes');
        if (pair.value) attrs[def.key] = def.type === 'select' ? ((def.options || []).find(o => lc(o) === lc(pair.value)) || pair.value) : pair.value;
      }
    }
    desired.attributes = attrs;
  }

  // ---- variants
  // Option names: the product's own when it has options already (spelling kept), else the first row that names some.
  const have = Array.isArray(existing?.option_types) ? existing.option_types.filter(t => t?.name) : [];
  const fileNames = [];
  for (const rec of rows) {
    const named = [1, 2, 3].map(i => rec.cells[`option${i}_name`] || '').filter(Boolean);
    if (named.length) { named.forEach(n => fileNames.push(n)); break; }
  }
  let optionNames = fileNames;
  if (have.length && fileNames.length) {
    if (have.length !== fileNames.length || have.some((t, i) => lc(t.name) !== lc(fileNames[i]))) {
      push('error', head, `The options (${fileNames.join(', ')}) do not match the existing product's options (${have.map(t => t.name).join(', ')}).`, 'option1_name');
    } else optionNames = have.map(t => t.name);
  }
  if (optionNames.length > MAX_OPTION_TYPES) push('error', head, `A product can have at most ${MAX_OPTION_TYPES} options.`, 'option1_name');
  const typeList = optionNames.map(n => ({ name: n }));
  const variants = [];
  const matchedVariantIds = new Set();
  const optionKeysInFile = new Set();
  // A product that already has options may be updated by SKU alone (rows with no option cells); a simple product has one row.
  const bySkuOnly = !optionNames.length && have.length > 0;
  for (const rec of rows) {
    const c = rec.cells;
    const pairs = [1, 2, 3].map(i => ({ name: c[`option${i}_name`] || '', value: c[`option${i}_value`] || '' }));
    const named = pairs.filter(p => p.name);
    if (pairs.some(p => p.value && !p.name)) push('error', rec, 'An option value has no option name (e.g. Size).', 'option1_name');
    const options = {};
    let optionsOk = true;
    if (optionNames.length) {
      if (named.length !== optionNames.length || named.some((p, i) => lc(p.name) !== lc(optionNames[i]))) {
        optionsOk = false;
        push('error', rec, `Option names do not match the first row of this product (${optionNames.join(', ')}).`, 'option1_name');
      } else {
        named.forEach((p, i) => {
          if (!p.value) { optionsOk = false; push('error', rec, `No value for the option "${optionNames[i]}".`, `option${i + 1}_value`); } else options[optionNames[i]] = p.value;
        });
      }
    }
    const key = optionsOk && !bySkuOnly ? optionsKey(options) : null;
    if (key && optionKeysInFile.has(key)) {
      push('error', rec, optionNames.length ? `Duplicate option combination (${variantLabelFromOptions(options, typeList)}) for this product.` : 'This product has more than one row but no option names. Add option names and values, one combination per row.', 'option1_value');
    }
    if (key) optionKeysInFile.add(key);

    const sku = c.sku || '';
    if (sku.length > LIMITS.sku) push('error', rec, `The SKU is longer than ${LIMITS.sku} characters.`, 'sku');
    let owner = null;
    if (sku) {
      const first = seenSkus.get(lc(sku));
      if (first) push('error', rec, `Duplicate SKU "${sku}" (also on line ${first}).`, 'sku');
      else seenSkus.set(lc(sku), rec.line);
      owner = ctx.skuOwners?.get(lc(sku)) || null;
      if (owner && !(existing && owner.product_id === existing.id)) {
        push('error', rec, `The SKU "${sku}" already belongs to ${owner.product_name ? `"${owner.product_name}"` : 'another product'}${owner.product_number ? ` (${owner.product_number})` : ''}.`, 'sku');
      }
    }

    // Match an existing variant: by SKU first, else by option combination.
    let match = null;
    if (existing) {
      if (owner && owner.product_id === existing.id) match = existingVariants.find(v => v.id === owner.id) || null;
      if (!match && key) match = existingVariants.find(v => optionsKey(v.options) === key && !matchedVariantIds.has(v.id)) || null;
      if (match && matchedVariantIds.has(match.id)) { push('error', rec, 'Two rows describe the same existing variant.', 'sku'); match = null; }
      if (match) matchedVariantIds.add(match.id);
    }
    if (bySkuOnly && !match) push('error', rec, `This product has options (${have.map(t => t.name).join(', ')}); give this row its option values, or a SKU that already exists.`, 'option1_name');

    const price = moneyOf(c.price);
    const mrp = moneyOf(c.mrp);
    const stock = intOf(c.stock);
    const track = bool(c.track_inventory);
    const weight = intOf(c.weight_g);
    const active = bool(c.variant_active);
    if (price.bad) push('error', rec, `"${c.price}" is not a valid price.`, 'price');
    else if (price.blank && !match) push('error', rec, 'The price is missing.', 'price');
    if (mrp.bad) push('error', rec, `"${c.mrp}" is not a valid MRP.`, 'mrp');
    const priceNow = price.blank ? (match ? Number(match.price) : null) : price.value;
    if (!mrp.bad && !mrp.blank && priceNow !== null && mrp.value < priceNow) push('error', rec, `The MRP (${mrp.value}) is lower than the price (${priceNow}).`, 'mrp');
    if (stock.bad) push('error', rec, `Stock "${c.stock}" must be a whole number, zero or more.`, 'stock');
    if (track.bad) push('error', rec, 'track_inventory must be yes or no.', 'track_inventory');
    if (weight.bad) push('error', rec, 'weight_g must be a whole number.', 'weight_g');
    if (active.bad) push('error', rec, 'variant_active must be yes or no.', 'variant_active');
    if (c.variant_image && !okUrl(c.variant_image)) push('error', rec, 'variant_image must start with http:// or https://.', 'variant_image');

    const hasOptions = optionNames.length > 0 && optionsOk;
    variants.push({
      line: rec.line, action: match ? 'update' : 'create', id: match?.id || null, existing: match || null,
      sku: sku || null, options: hasOptions ? options : {}, hasOptions,
      label: hasOptions ? variantLabelFromOptions(options, typeList) : 'Default',
      price: price.blank ? null : price.value, mrp: mrp.blank ? null : mrp.value, mrpGiven: !mrp.blank,
      stock: stock.blank ? null : stock.value, track_inventory: track.blank ? null : track.value,
      weight_g: weight.blank ? null : weight.value, active: active.blank ? null : active.value, image_url: c.variant_image || null,
    });
  }

  // ---- option types for the product: this file's options merged into what the product already has
  let optionTypes = null;
  if (optionNames.length && optionNames.length <= MAX_OPTION_TYPES) {
    optionTypes = optionNames.map((n, i) => {
      const values = [...(have[i]?.values || [])];
      for (const v of variants) { const val = v.options[n]; if (val && !values.includes(val)) values.push(val); }
      return { name: n, values };
    });
  }

  if (status === 'active' && !(desired.images?.length || existing?.images?.length)) push('warning', head, 'Active but has no images yet - the store will show a placeholder.', 'images');

  // ---- what actually changes (so re-importing an exported file writes nothing)
  const patch = {};
  if (existing) {
    for (const [k, v] of Object.entries(desired)) {
      const cur = existing[k];
      let same;
      if (['highlights', 'tags', 'images'].includes(k)) same = stable(v) === stable(Array.isArray(cur) ? cur : []);
      else if (k === 'attributes') same = sameAttrs(v, cur);
      else if (typeof v === 'boolean') same = !!cur === v;
      else if (typeof v === 'number') same = sameNum(cur, v);
      else same = sameText(cur, v);
      if (!same) patch[k] = v;
    }
    if (optionTypes && stable(optionTypes) !== stable((existing.option_types || []).map(t => ({ name: t.name, values: t.values })))) patch.option_types = optionTypes;
  }
  for (const v of variants) {
    if (v.action !== 'update') { v.patch = null; v.stockTo = v.stock; continue; }
    const e = v.existing;
    const p = {};
    if (v.sku !== null && lc(v.sku) !== lc(e.sku)) p.sku = v.sku;
    if (optionKeyDiffers(e, v)) { p.options = v.options; p.label = v.label; }
    if (v.price !== null && !sameNum(e.price, v.price)) p.price = v.price;
    if (v.mrpGiven && !sameNum(e.mrp, v.mrp)) p.mrp = v.mrp;
    if (v.track_inventory !== null && (e.track_inventory !== false) !== v.track_inventory) p.track_inventory = v.track_inventory;
    if (v.weight_g !== null && !sameNum(e.weight_g, v.weight_g)) p.weight_g = v.weight_g;
    if (v.active !== null && (e.active !== false) !== v.active) p.active = v.active;
    if (v.image_url && v.image_url !== (e.image_url || '')) p.image_url = v.image_url;
    v.patch = Object.keys(p).length ? p : null;
    const tracked = v.track_inventory === null ? e.track_inventory !== false : v.track_inventory;
    v.stockTo = tracked && v.stock !== null && v.stock !== Number(e.stock) ? v.stock : null;
  }
  const variantChanged = variants.some(v => v.action === 'create' || v.patch || v.stockTo !== null);
  const changed = !existing ? true : (Object.keys(patch).length > 0 || variantChanged);

  return {
    key: g.number || `row-${head.line}`, number, name: name || existing?.name || '', rows, action: existing ? 'update' : 'create',
    existing, existingVariants, desired, patch, optionTypes, status, category, variants, errors, warnings, problems, changed,
  };
}

// A row with no option cells never changes a variant's options; one with options does when they differ.
function optionKeyDiffers(existing, v) {
  if (!v.hasOptions) return false;
  return optionsKey(existing.options) !== optionsKey(v.options);
}

// ====================================================================================== 6. the error report
// Every row of every SKIPPED product, in the original file's columns, plus why -- so the file can be fixed and
// re-imported (the extra import_* columns are ignored on the way back in). Rows that were fine themselves but belong
// to a product with a bad row say so: a product is never half-imported.
export function errorReportRows(file, plan) {
  const byLine = new Map();
  for (const p of plan.problems) byLine.set(p.line, [...(byLine.get(p.line) || []), p]);
  const rows = [];
  for (const product of plan.products) {
    if (!product.errors.length) continue;
    const firstBad = product.errors[0].line;
    for (const rec of product.rows) {
      const list = byLine.get(rec.line) || [];
      const row = {};
      file.header.forEach((h, i) => { row[h || `column_${i + 1}`] = rec.raw[i] ?? ''; });
      row.import_line = rec.line;
      row.import_level = list.some(p => p.level === 'error') ? 'error' : 'skipped';
      row.import_problem = list.length
        ? list.map(p => `${p.level === 'error' ? 'Error' : 'Warning'}: ${p.message}`).join(' | ')
        : `Skipped: another row of this product has an error (line ${firstBad}).`;
      rows.push(row);
    }
  }
  return rows.sort((a, b) => a.import_line - b.import_line);
}
