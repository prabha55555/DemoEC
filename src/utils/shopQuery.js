// The shop's filter state <-> the URL query string. The URL IS the state: every filter, the sort and the
// page live in `?q=&sort=&min=&max=&brand=&rating=&discount=&stock=1&page=&attr.<key>=`, so a filtered
// listing can be shared, bookmarked and walked with the back/forward buttons. Pure -- no React, no network.
import { searchWords, SORT_OPTIONS } from './catalogApi';

export const PAGE_SIZE = 24;

// The "Deals" entry in the header, footer and home page: everything with at least 10% off, biggest discount first.
export const DEALS_PATH = '/shop?sort=discount&discount=10';

// A list value arrives repeated (`brand=A&brand=B`) or comma-joined (`brand=A,B`, handy in hand-written
// links). A comma followed by a space is part of the name ("Foo, Inc."), not a separator.
const SPLIT = /,(?!\s)/;
const uniq = (arr) => [...new Set(arr)];
const listParam = (sp, key) => uniq(sp.getAll(key).flatMap(v => v.split(SPLIT)).map(s => s.trim()).filter(Boolean));
const posNum = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const moneyParam = (v) => { if (v === null || v === undefined || String(v).trim() === '') return ''; const n = Number(v); return Number.isFinite(n) && n >= 0 ? String(n) : ''; };

const SORT_VALUES = new Set(SORT_OPTIONS.map(o => o.value));
// Attribute keys are schema keys (used inside a PostgREST JSON path), never free text.
const ATTR_KEY = /^[a-z0-9_]+$/i;

export function parseShopParams(sp) {
  const q = (sp.get('q') || '').trim().slice(0, 120);
  const sort = SORT_VALUES.has(sp.get('sort')) ? sp.get('sort') : '';
  const attrs = {};
  for (const key of new Set([...sp.keys()].filter(k => k.startsWith('attr.')))) {
    const name = key.slice(5);
    if (!ATTR_KEY.test(name)) continue;
    const values = listParam(sp, key);
    if (values.length) attrs[name] = values;
  }
  return {
    q,
    words: searchWords(q),
    sort,                                   // '' = the default for this view (see effectiveSort)
    priceMin: moneyParam(sp.get('min')),
    priceMax: moneyParam(sp.get('max')),
    brands: listParam(sp, 'brand'),
    rating: Math.min(5, Math.floor(posNum(sp.get('rating')))),
    discount: Math.min(90, Math.floor(posNum(sp.get('discount')))),
    inStock: sp.get('stock') === '1',
    page: Math.max(1, Math.floor(posNum(sp.get('page'))) || 1),
    attrs,
  };
}

// Back to a query string ('' or '?a=b'). Defaults are omitted so URLs stay short and canonical.
export function toShopSearch(state) {
  const sp = new URLSearchParams();
  if (state.q) sp.set('q', state.q);
  if (state.sort) sp.set('sort', state.sort);
  if (state.priceMin !== '' && state.priceMin !== undefined) sp.set('min', state.priceMin);
  if (state.priceMax !== '' && state.priceMax !== undefined) sp.set('max', state.priceMax);
  (state.brands || []).forEach(b => sp.append('brand', b));
  if (state.rating) sp.set('rating', String(state.rating));
  if (state.discount) sp.set('discount', String(state.discount));
  if (state.inStock) sp.set('stock', '1');
  for (const [k, values] of Object.entries(state.attrs || {})) (values || []).forEach(v => sp.append(`attr.${k}`, v));
  if (state.page > 1) sp.set('page', String(state.page));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// Change filters. Anything that changes WHAT is listed sends the shopper back to page 1; only an explicit
// `page` in the patch keeps it.
export function applyPatch(state, patch) {
  const next = { ...state, ...patch };
  if (!('page' in patch)) next.page = 1;
  return next;
}

export const toggleIn = (list, value) => (list.includes(value) ? list.filter(v => v !== value) : [...list, value]);

// Everything the shopper can switch off with "Clear all". The search words and the sort stay: they say what
// the shopper is looking for, the rest narrows it.
export function clearFilters(state) {
  return { ...state, priceMin: '', priceMax: '', brands: [], rating: 0, discount: 0, inStock: false, attrs: {}, page: 1 };
}

export function activeFilterCount(state) {
  return (state.priceMin !== '' || state.priceMax !== '' ? 1 : 0)
    + state.brands.length + (state.rating ? 1 : 0) + (state.discount ? 1 : 0) + (state.inStock ? 1 : 0)
    + Object.values(state.attrs).reduce((n, v) => n + v.length, 0);
}

// "Relevance" while searching is simply newest first (search_text has no ranking); otherwise Popularity.
export const effectiveSort = (state) => state.sort || (state.q ? 'newest' : 'popular');

// "Showing 1-24 of 118"
export function resultRange(page, pageSize, count) {
  if (!count) return { from: 0, to: 0 };
  const from = (page - 1) * pageSize + 1;
  return { from, to: Math.min(count, page * pageSize) };
}

// Page numbers for the pager: 1 … 4 5 [6] 7 8 … 20  (null = an ellipsis)
export function pageWindow(page, pages, span = 1) {
  if (pages <= 1) return [1];
  const out = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= span) out.push(p);
    else if (out[out.length - 1] !== null) out.push(null);
  }
  return out;
}
