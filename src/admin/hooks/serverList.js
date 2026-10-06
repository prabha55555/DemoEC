// The pure half of useServerList: range maths and PostgREST query construction. Kept free of React so
// it can be unit-tested with a fake query builder.
export const DEFAULT_PAGE_SIZE = 25;

const toInt = (v, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : d; };

// 1-based page -> the inclusive [from, to] row indexes PostgREST's .range() wants.
export function pageRange(page, pageSize = DEFAULT_PAGE_SIZE) {
  const p = toInt(page, 1);
  const s = toInt(pageSize, DEFAULT_PAGE_SIZE);
  return [(p - 1) * s, p * s - 1];
}

// Number of pages for `total` rows (always >= 1, so an empty list is "page 1 of 1").
export function pageCount(total, pageSize = DEFAULT_PAGE_SIZE) {
  return Math.max(1, Math.ceil((Number(total) || 0) / toInt(pageSize, DEFAULT_PAGE_SIZE)));
}

// Keeps `page` inside 1..pageCount(total).
export function clampPage(page, total, pageSize = DEFAULT_PAGE_SIZE) {
  return Math.min(toInt(page, 1), pageCount(total, pageSize));
}

// "Showing 26-50 of 132" figures for a page.
export function pageWindow(page, total, pageSize = DEFAULT_PAGE_SIZE) {
  const t = Math.max(0, Number(total) || 0);
  if (t === 0) return { from: 0, to: 0, total: 0 };
  const [a, b] = pageRange(page, pageSize);
  return { from: a + 1, to: Math.min(t, b + 1), total: t };
}

// User-typed search text -> something safe to drop into a PostgREST `or=(…)` filter. Commas, brackets,
// quotes, backslashes and the wildcard characters have meaning in that syntax, so they are removed
// rather than escaped (escaping differs between PostgREST versions; a search never needs them).
export function sanitizeSearch(text) {
  return String(text ?? '').replace(/[,()"'\\%*]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ("name","sku"), "red shirt" -> 'name.ilike.%red shirt%,sku.ilike.%red shirt%'  ('' when nothing to search)
export function buildSearchOr(columns, text) {
  const t = sanitizeSearch(text);
  const cols = (columns || []).filter(Boolean);
  if (!t || cols.length === 0) return '';
  return cols.map(c => `${c}.ilike.%${t}%`).join(',');
}

const COMPARE_OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike']);

// filters = { column: spec } where spec is
//   undefined | ''              -> ignored ("no filter selected")
//   null                        -> column IS NULL
//   [a, b]                      -> column IN (a, b)   (an empty array is ignored)
//   { gte: x, lte: y, … }       -> comparison operators (eq neq gt gte lt lte like ilike is in not)
//   { not: ['is', null] }       -> column IS NOT NULL   (or  { not: ['eq', 'x'] })
//   anything else               -> column = value
// plus the reserved key `$or`: a raw PostgREST or-string, e.g. '$or': 'status.eq.Placed,status.eq.Packed'.
export function applyFilters(query, filters) {
  let q = query;
  for (const [column, spec] of Object.entries(filters || {})) {
    if (spec === undefined || spec === '') continue;
    if (column === '$or') { if (spec) q = q.or(spec); continue; }
    if (spec === null) { q = q.is(column, null); continue; }
    if (Array.isArray(spec)) { if (spec.length) q = q.in(column, spec); continue; }
    if (typeof spec === 'object') {
      for (const [op, value] of Object.entries(spec)) {
        if (value === undefined || value === '') continue;
        if (op === 'not') q = q.not(column, value[0], value[1]);
        else if (op === 'is') q = q.is(column, value);
        else if (op === 'in') { if (Array.isArray(value) && value.length) q = q.in(column, value); }
        else if (COMPARE_OPS.has(op)) q = q[op](column, value);
      }
      continue;
    }
    q = q.eq(column, spec);
  }
  return q;
}

// orderBy: { column, ascending = false, nullsFirst } | [that, …] | 'created_at' | 'created_at.asc'
export function normaliseOrder(orderBy) {
  const list = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  return list.map((o) => {
    if (typeof o === 'string') { const [column, dir] = o.split('.'); return { column, ascending: dir === 'asc' }; }
    return { column: o.column, ascending: o.ascending === true, ...(o.nullsFirst !== undefined ? { nullsFirst: o.nullsFirst } : {}) };
  }).filter(o => o.column);
}

export function applyOrder(query, orderBy) {
  let q = query;
  for (const { column, ascending, nullsFirst } of normaliseOrder(orderBy)) {
    q = q.order(column, nullsFirst === undefined ? { ascending } : { ascending, nullsFirst });
  }
  return q;
}

// Builds the page query: select with an exact count, filters, search, ordering and .range().
export function buildListQuery(client, { table, select = '*', filters, search, searchColumns, orderBy, page = 1, pageSize = DEFAULT_PAGE_SIZE }) {
  let q = client.from(table).select(select, { count: 'exact' });
  q = applyFilters(q, filters);
  const or = buildSearchOr(searchColumns, search);
  if (or) q = q.or(or);
  q = applyOrder(q, orderBy);
  const [from, to] = pageRange(page, pageSize);
  return q.range(from, to);
}

// A count-only query (no rows travel): `{ count: 'exact', head: true }`.
export function buildCountQuery(client, { table, filters, search, searchColumns }) {
  let q = client.from(table).select('*', { count: 'exact', head: true });
  q = applyFilters(q, filters);
  const or = buildSearchOr(searchColumns, search);
  if (or) q = q.or(or);
  return q;
}

// PostgREST answers a range past the end of the data with this error (HTTP 416).
export const isRangeError = (e) => !!e && (e.code === 'PGRST103' || /range not satisfiable/i.test(e.message || ''));
