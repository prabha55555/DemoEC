// Pure helpers for category attribute schemas and the product values stored against them.
//   schema row   { key, label, type: 'text'|'number'|'select'|'multiselect'|'boolean', options: [], unit, required, filterable }
//   product      attributes { [key]: string | number | string[] | boolean }
// The category editor builds schemas; the product form renders fields from them and keeps anything that is NOT in the
// schema as free "Other specifications" rows, so switching category never silently throws a value away.

export const ATTRIBUTE_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Single choice (select)' },
  { value: 'multiselect', label: 'Multiple choice' },
  { value: 'boolean', label: 'Yes / No' },
];
const TYPE_SET = new Set(ATTRIBUTE_TYPES.map(t => t.value));
export const hasOptions = (type) => type === 'select' || type === 'multiselect';

const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// "Fabric & finish" -> fabric_finish. Keys are what products store values under and what the shop's filters
// query (attributes->>key), so they stay lowercase letters / digits / underscores and unique among `taken`.
export function attributeKeyFromLabel(label, taken = []) {
  let base = squash(label).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!base) base = 'attribute';
  if (/^\d/.test(base)) base = `a_${base}`;
  base = base.slice(0, 40).replace(/_+$/, '') || 'attribute';
  const used = new Set((taken || []).map(k => String(k).toLowerCase()));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

export const isValidKey = (k) => /^[a-z0-9_]+$/.test(String(k || ''));

// Cleans a schema before it is saved (or before it is compared): trims labels, drops blank rows, makes keys valid
// and unique, keeps `options` only for choice types and `unit` only for numbers.
export function normalizeSchema(rows) {
  const out = [];
  const taken = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const label = squash(r?.label);
    if (!label) continue;
    let key = String(r.key || '').trim().toLowerCase();
    if (!isValidKey(key) || taken.includes(key)) key = attributeKeyFromLabel(label, taken);
    taken.push(key);
    const type = TYPE_SET.has(r.type) ? r.type : 'text';
    const row = { key, label, type };
    if (hasOptions(type)) {
      const seen = new Set();
      row.options = (Array.isArray(r.options) ? r.options : []).map(squash).filter(o => o && !seen.has(o.toLowerCase()) && seen.add(o.toLowerCase()));
    }
    if (type === 'number' && squash(r.unit)) row.unit = squash(r.unit);
    if (r.required) row.required = true;
    if (r.filterable && type !== 'multiselect') row.filterable = true;
    out.push(row);
  }
  return out;
}

// Problems in an editor's rows, keyed by row index: [{ label?, options?, key? }]. `inheritedKeys` / `inheritedLabels`
// are what the parent categories already define (a child cannot redefine them -- the parent's definition wins).
export function validateSchemaRows(rows, inheritedKeys = [], inheritedLabels = []) {
  const errors = rows.map(() => ({}));
  const keys = new Map();
  const labels = new Map();
  const inherited = new Set((inheritedKeys || []).map(k => String(k).toLowerCase()));
  const inheritedNames = new Set((inheritedLabels || []).map(l => squash(l).toLowerCase()));
  rows.forEach((r, i) => {
    const label = squash(r.label);
    if (!label) errors[i].label = 'Give this attribute a label.';
    else {
      const l = label.toLowerCase();
      if (labels.has(l)) errors[i].label = 'Another attribute already has this label.';
      else if (inheritedNames.has(l)) errors[i].label = 'A parent category already has an attribute with this label.';
      labels.set(l, i);
    }
    const key = String(r.key || '').trim().toLowerCase();
    if (key) {
      if (!isValidKey(key)) errors[i].key = 'Use lowercase letters, numbers and underscores only.';
      else if (keys.has(key)) errors[i].key = 'Another attribute already uses this key.';
      else if (inherited.has(key)) errors[i].key = 'A parent category already defines this key.';
      keys.set(key, i);
    }
    if (hasOptions(r.type) && !(Array.isArray(r.options) && r.options.some(o => squash(o)))) errors[i].options = 'Add at least one choice.';
  });
  return errors;
}

// ------------------------------------------------------------------------------------ product attribute values
let xseq = 0;
export const extraId = () => `x${Date.now().toString(36)}${(xseq++).toString(36)}`;

const yes = new Set(['yes', 'true', 'y', '1']);
const no = new Set(['no', 'false', 'n', '0']);

// A stored value as text (for an "Other specifications" row, the CSV and the storefront table).
export function displayValue(v) {
  if (Array.isArray(v)) return v.map(x => String(x)).join(', ');
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return v === null || v === undefined ? '' : String(v).trim();
}

// A stored value as the form holds it for a schema field of `type`.
export function toFormValue(def, stored) {
  if (stored === undefined || stored === null) return def.type === 'multiselect' ? [] : def.type === 'boolean' ? undefined : '';
  switch (def.type) {
    case 'multiselect': return Array.isArray(stored) ? stored.map(String) : String(stored).split(/[,;]/).map(squash).filter(Boolean);
    case 'boolean': return typeof stored === 'boolean' ? stored : yes.has(String(stored).toLowerCase()) ? true : no.has(String(stored).toLowerCase()) ? false : undefined;
    case 'number': return String(stored);
    default: return Array.isArray(stored) ? stored.join(', ') : String(stored);
  }
}

// A form value -> what is stored, or undefined when empty / invalid (undefined values are not saved).
export function toStoredValue(def, value) {
  switch (def.type) {
    case 'number': {
      const s = String(value ?? '').trim();
      if (s === '') return undefined;
      const n = Number(s);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'boolean': return typeof value === 'boolean' ? value : undefined;
    case 'multiselect': { const a = (Array.isArray(value) ? value : []).map(squash).filter(Boolean); return a.length ? a : undefined; }
    default: { const s = squash(value); return s || undefined; }
  }
}

// Is the form value "filled in"? (drives required-field validation)
export function isFilled(def, value) {
  if (def.type === 'boolean') return typeof value === 'boolean';
  return toStoredValue(def, value) !== undefined;
}

// Splits stored attributes into { values (schema fields, as form values), extras (everything else) }.
export function splitAttributes(attributes, schema) {
  const attrs = attributes && typeof attributes === 'object' && !Array.isArray(attributes) ? attributes : {};
  const defs = new Map((schema || []).map(d => [d.key, d]));
  const values = {};
  const extras = [];
  for (const [k, v] of Object.entries(attrs)) {
    const def = defs.get(k);
    if (def) values[k] = toFormValue(def, v);
    else { const text = displayValue(v); if (text) extras.push({ id: extraId(), key: k, value: text }); }
  }
  return { values, extras };
}

// Builds the stored attributes from the schema fields + the free rows. `problems` lists what could not be saved
// (invalid numbers, repeated names) so the caller can show them -- nothing is dropped silently.
export function mergeAttributes(values, extras, schema) {
  const out = {};
  const problems = [];
  const schemaKeys = new Set((schema || []).map(d => d.key));
  for (const def of schema || []) {
    const raw = values?.[def.key];
    const stored = toStoredValue(def, raw);
    if (stored !== undefined) out[def.key] = stored;
    else if (def.type === 'number' && String(raw ?? '').trim() !== '') problems.push(`${def.label} must be a number.`);
  }
  const seen = new Set();
  for (const e of extras || []) {
    const key = squash(e.key);
    const value = squash(e.value);
    if (!key && !value) continue;
    if (!key) { problems.push('An "Other specifications" row has a value but no name.'); continue; }
    if (!value) continue;
    if (schemaKeys.has(key) || seen.has(key.toLowerCase())) { problems.push(`"${key}" is listed twice in the specifications.`); continue; }
    seen.add(key.toLowerCase());
    out[key] = value;
  }
  return { attributes: out, problems };
}

// Category changed: schema values whose key is not in the new schema move to the free rows (kept, not lost), and
// free rows whose name matches a key of the new schema move into that field when the value fits it.
export function reconcileOnCategoryChange(values, extras, oldSchema, newSchema) {
  const newDefs = new Map((newSchema || []).map(d => [d.key, d]));
  const oldDefs = new Map((oldSchema || []).map(d => [d.key, d]));
  const nextValues = {};
  const nextExtras = [];
  for (const [k, v] of Object.entries(values || {})) {
    if (newDefs.has(k)) { nextValues[k] = v; continue; }
    const def = oldDefs.get(k);
    const stored = def ? toStoredValue(def, v) : undefined;
    const text = displayValue(stored);
    if (text) nextExtras.push({ id: extraId(), key: k, value: text });
  }
  for (const e of extras || []) {
    const def = newDefs.get(squash(e.key));
    if (def && nextValues[def.key] === undefined) {
      const fv = toFormValue(def, e.value);
      const fits = def.type === 'select' ? (def.options || []).find(o => o.toLowerCase() === String(fv).toLowerCase())
        : def.type === 'multiselect' ? (fv.length && fv.every(x => (def.options || []).some(o => o.toLowerCase() === x.toLowerCase())))
          : def.type === 'boolean' ? fv !== undefined
            : def.type === 'number' ? Number.isFinite(Number(e.value))
              : true;
      if (fits) { nextValues[def.key] = def.type === 'select' ? fits : fv; continue; }
    }
    nextExtras.push(e);
  }
  return { values: nextValues, extras: nextExtras };
}
