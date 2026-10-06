import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useCatalog } from '../context/CatalogContext';
import ProductCard, { ProductGridSkeleton } from '../components/ProductCard';
import FilterPanel from '../components/FilterPanel';
import { fetchProducts, fetchFacets, SORT_OPTIONS } from '../utils/catalogApi';
import { attributeSchemaFor, formatMoney } from '../utils/catalog';
import {
  PAGE_SIZE, parseShopParams, toShopSearch, applyPatch, clearFilters, activeFilterCount, effectiveSort, resultRange, pageWindow, toggleIn,
} from '../utils/shopQuery';
import { useIsMobile } from '../utils/useMediaQuery';
import { useModal } from '../utils/useModal';
import { usePageMeta } from '../utils/usePageMeta';
import { COMPANY } from '../config/company';

const IconFilter = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>;
const IconSort = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3" /></svg>;
const IconClose = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>;

// The jump back to the top of the results after a page change (the pager sits at the bottom of a long list).
function scrollToResults() {
  const html = document.documentElement;
  const prev = html.style.scrollBehavior;
  html.style.scrollBehavior = 'auto';
  const top = document.getElementById('shop-results')?.getBoundingClientRect().top;
  const hdr = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--hdr-h'), 10) || 110;
  window.scrollTo(0, top == null ? 0 : Math.max(0, window.scrollY + top - hdr - 12));
  html.style.scrollBehavior = prev;
}

function Sheet({ title, onClose, children, footer, side = false, label }) {
  const ref = useRef(null);
  useModal(true, onClose, ref);
  return (
    <>
      <div className={side ? 'bl-fdrawer-scrim' : 'bl-sheet-scrim'} onClick={onClose} aria-hidden="true" />
      <aside ref={ref} className={side ? 'bl-fdrawer' : 'bl-sheet'} role="dialog" aria-modal="true" aria-label={label || title} tabIndex={-1}>
        <div className={side ? 'bl-fdrawer-head' : 'bl-sheet-head'}>
          {title}
          <button type="button" className="bl-icon-btn" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`}>{IconClose}</button>
        </div>
        <div className={side ? 'bl-fdrawer-body' : 'bl-sheet-body'}>{children}</div>
        {footer && <div className={side ? 'bl-fdrawer-foot' : 'bl-sheet-foot'}>{footer}</div>}
      </aside>
    </>
  );
}

export default function Shop() {
  const { slug } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const isMobile = useIsMobile(899);

  const state = useMemo(() => parseShopParams(new URLSearchParams(location.search)), [location.search]);
  const sort = effectiveSort(state);
  const category = slug ? catalog.bySlug.get(slug) || null : null;
  const catalogPending = !!slug && catalog.loading;
  const unknownCategory = !!slug && !catalog.loading && !category;
  const categoryIds = useMemo(() => (category ? catalog.descendantIds(category.id) : undefined), [category, catalog]);
  const chain = useMemo(() => (category ? catalog.chain(category.id).reverse() : []), [category, catalog]);   // [group, ..., category]
  const attrSchema = useMemo(
    () => (category ? attributeSchemaFor(catalog.categories, category.id).filter(a => a.filterable) : []),
    [category, catalog.categories],
  );

  const [result, setResult] = useState(null);         // { rows, count } of the latest answer
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [facets, setFacets] = useState(null);
  const [sheet, setSheet] = useState(null);           // 'filter' | 'sort' | null (mobile)
  const [reload, setReload] = useState(0);
  const reqRef = useRef(0);
  const scopeRef = useRef(null);

  // ---- URL is the state: every change writes the query string; back/forward walk through it.
  const update = useCallback((patch, { replace = false } = {}) => {
    navigate({ pathname: location.pathname, search: toShopSearch(applyPatch(state, patch)) }, { replace });
  }, [navigate, location.pathname, state]);

  // Picking another category keeps what the shopper is looking for (search words, sort, rating, discount, stock) and drops
  // the filters that only made sense inside the old one (brands, attributes, price, page).
  const goCategory = useCallback((nextSlug) => {
    const keep = { ...clearFilters(state), q: state.q, sort: state.sort, rating: state.rating, discount: state.discount, inStock: state.inStock };
    navigate({ pathname: nextSlug ? `/category/${nextSlug}` : '/shop', search: toShopSearch(keep) });
    setSheet(null);
  }, [navigate, state]);

  // ---- facets depend on the scope only (category + search words), not on the other filters
  const scopeKey = JSON.stringify([category?.id || null, state.words]);
  useEffect(() => {
    if (catalogPending || unknownCategory) return undefined;
    let cancelled = false;
    setFacets(null);
    fetchFacets({ categoryIds, words: state.words })
      .then(f => { if (!cancelled) setFacets(f); })
      .catch(() => { if (!cancelled) setFacets({ total: 0, price_min: null, price_max: null, brands: [], attributes: {} }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [scopeKey, catalogPending, unknownCategory, reload]);

  // ---- products: 24 per page, filtered and sorted by the database
  const queryKey = JSON.stringify([scopeKey, state.brands, state.priceMin, state.priceMax, state.attrs, state.inStock, state.rating, state.discount, sort, state.page]);
  useEffect(() => {
    if (catalogPending || unknownCategory) return undefined;
    const id = ++reqRef.current;                    // a slower, older answer must never overwrite a newer one
    if (scopeRef.current !== scopeKey) { scopeRef.current = scopeKey; setResult(null); }   // a different list: skeleton, not the old one
    setLoading(true);
    setError(false);
    fetchProducts({
      categoryIds, words: state.words, brands: state.brands, priceMin: state.priceMin, priceMax: state.priceMax,
      attrs: state.attrs, inStockOnly: state.inStock, minRating: state.rating, minDiscount: state.discount,
      sort, page: state.page, pageSize: PAGE_SIZE,
    })
      .then((res) => {
        if (id !== reqRef.current) return;
        // A page past the end (a stale link): show the last page instead of an empty one.
        if (res.rows.length === 0 && res.count > 0 && state.page > 1) { update({ page: Math.ceil(res.count / PAGE_SIZE) }, { replace: true }); return; }
        setResult(res);
        setLoading(false);
      })
      .catch((err) => {
        if (id !== reqRef.current) return;
        if (state.page > 1 && (err?.code === 'PGRST103' || err?.status === 416)) { update({ page: 1 }, { replace: true }); return; }
        setError(true);
        setLoading(false);
      });
    return () => { /* the request id check above discards a superseded answer */ };
    // eslint-disable-next-line
  }, [queryKey, catalogPending, unknownCategory, reload]);

  // ---- heading, breadcrumb, meta
  const brandOnly = !category && !state.q && state.brands.length === 1 ? state.brands[0] : '';
  const isDeals = !category && !state.q && sort === 'discount' && state.discount > 0 && !state.brands.length;
  const heading = category ? category.name
    : state.q ? `Results for “${state.q}”`
    : isDeals ? 'Deals'
    : brandOnly || 'All products';
  const count = result?.count ?? 0;
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const range = resultRange(state.page, PAGE_SIZE, count);
  const basePath = slug ? `/category/${slug}` : '/shop';

  usePageMeta({
    title: unknownCategory ? 'Category not found' : [heading.replace(/[“”]/g, '"'), state.page > 1 ? `Page ${state.page}` : ''].filter(Boolean).join(' - '),
    description: category?.description
      || (category ? `Shop ${category.name} online at ${COMPANY.name}. Compare prices, ratings and discounts, with secure payments and easy returns.`
        : state.q ? `Search results for "${state.q}" at ${COMPANY.name}.`
        : isDeals ? `Today's best deals and discounts at ${COMPANY.name}.`
        : `Shop fashion, home & kitchen, beauty, electronics and more at ${COMPANY.name}.`),
    path: `${basePath}${state.page > 1 ? `?page=${state.page}` : ''}`,
    image: category?.image_url || undefined,
  });

  // ---- active filter chips
  const chips = [];
  if (state.q) chips.push({ key: 'q', label: `“${state.q}”`, clear: () => update({ q: '' }) });
  if (state.priceMin !== '' || state.priceMax !== '') {
    const lo = state.priceMin !== '' ? formatMoney(state.priceMin) : '';
    const hi = state.priceMax !== '' ? formatMoney(state.priceMax) : '';
    chips.push({ key: 'price', label: lo && hi ? `${lo} – ${hi}` : lo ? `Above ${lo}` : `Under ${hi}`, clear: () => update({ priceMin: '', priceMax: '' }) });
  }
  state.brands.forEach(b => chips.push({ key: `b:${b}`, label: b, clear: () => update({ brands: toggleIn(state.brands, b) }) }));
  Object.entries(state.attrs).forEach(([k, vals]) => {
    const def = attrSchema.find(a => a.key === k);
    vals.forEach(v => chips.push({ key: `a:${k}:${v}`, label: `${def?.label || k}: ${def?.type === 'boolean' ? (v === 'true' ? 'Yes' : 'No') : v}`, clear: () => update({ attrs: { ...state.attrs, [k]: toggleIn(vals, v) } }) }));
  });
  if (state.rating) chips.push({ key: 'rating', label: `${state.rating}★ & up`, clear: () => update({ rating: 0 }) });
  if (state.discount) chips.push({ key: 'discount', label: `${state.discount}% or more off`, clear: () => update({ discount: 0 }) });
  if (state.inStock) chips.push({ key: 'stock', label: 'In stock only', clear: () => update({ inStock: false }) });
  const filterCount = activeFilterCount(state);
  const clearAll = () => update({ ...clearFilters(state) }, { replace: false });

  // ---- sub-category chips: a group lists its categories, a category its siblings
  const treeNode = (id) => catalog.tree.find(r => r.id === id);
  const subChips = !category ? [] : category.parent_id ? (treeNode(category.parent_id)?.children || []) : (treeNode(category.id)?.children || []);
  const group = chain[0];

  const sortOptions = state.q ? [{ value: 'relevance', label: 'Relevance' }, ...SORT_OPTIONS] : SORT_OPTIONS;
  const sortValue = state.sort || (state.q ? 'relevance' : 'popular');
  function onSort(value) {
    const isDefault = value === 'relevance' || (value === 'popular' && !state.q);
    update({ sort: isDefault ? '' : value });
    setSheet(null);
  }

  const panel = (
    <FilterPanel
      state={state} facets={facets} attrSchema={attrSchema} tree={catalog.tree}
      activeCategory={category} chainIds={chain.map(c => c.id)}
      onChange={(patch) => update(patch, { replace: isMobile })} onCategory={goCategory}
    />
  );

  const pageLink = (p) => ({ pathname: basePath, search: toShopSearch({ ...state, page: p }) });

  // ---- results area
  let results;
  if (unknownCategory) {
    results = (
      <div className="bl-panel bl-empty">
        <h2>We couldn’t find that category</h2>
        <p>It may have been renamed or removed. Pick a category below or browse everything.</p>
        <div className="bl-empty-links">
          {catalog.tree.map(c => <Link key={c.id} className="bl-chip-btn" to={`/category/${c.slug}`}>{c.name}</Link>)}
        </div>
        <Link to="/shop" className="btn btn-gold">Browse all products</Link>
      </div>
    );
  } else if (error) {
    results = (
      <div className="bl-panel bl-empty" role="alert">
        <h2>Something went wrong</h2>
        <p>We couldn’t load the products. Check your connection and try again.</p>
        <button type="button" className="btn btn-gold" onClick={() => setReload(n => n + 1)}>Try again</button>
      </div>
    );
  } else if (!result || (loading && result.rows.length === 0)) {
    results = <ProductGridSkeleton count={PAGE_SIZE / 2} />;
  } else if (result.rows.length === 0) {
    results = (
      <div className="bl-panel bl-empty">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35M8.5 11h5" /></svg>
        <h2>{state.q ? `No results for “${state.q}”` : 'No products match'}</h2>
        {filterCount > 0 ? <p>Try removing some filters to see more products.</p>
          : state.q ? <p>Check the spelling, try fewer or more general words, or browse a category.</p>
          : <p>There are no products here yet. Have a look at our other categories.</p>}
        <div className="bl-empty-actions">
          {filterCount > 0 && <button type="button" className="btn btn-gold" onClick={clearAll}>Clear all filters</button>}
          {state.q && <button type="button" className="btn btn-outline" onClick={() => update({ q: '' })}>Clear search</button>}
          <Link to="/shop?sort=discount&discount=10" className="btn btn-outline">See today’s deals</Link>
        </div>
        {catalog.tree.length > 0 && (
          <div className="bl-empty-links" aria-label="Browse categories">
            {catalog.tree.map(c => <Link key={c.id} className="bl-chip-btn" to={`/category/${c.slug}`}>{c.name}</Link>)}
          </div>
        )}
      </div>
    );
  } else {
    results = (
      <>
        <div className={`bl-grid${loading ? ' is-busy' : ''}`} aria-busy={loading}>
          {result.rows.map(p => <ProductCard key={p.id} product={p} />)}
        </div>
        {pages > 1 && (
          <nav className="bl-pager" aria-label="Pagination">
            {state.page > 1
              ? <Link className="bl-pager-btn" to={pageLink(state.page - 1)} onClick={scrollToResults} rel="prev" aria-label="Previous page">‹</Link>
              : <span className="bl-pager-btn is-off" aria-hidden="true">‹</span>}
            {pageWindow(state.page, pages).map((p, i) => p === null
              ? <span key={`gap${i}`} className="bl-pager-gap" aria-hidden="true">…</span>
              : <Link key={p} className={`bl-pager-btn${p === state.page ? ' is-on' : ''}`} to={pageLink(p)} onClick={scrollToResults} aria-label={`Page ${p}`} aria-current={p === state.page ? 'page' : undefined}>{p}</Link>)}
            {state.page < pages
              ? <Link className="bl-pager-btn" to={pageLink(state.page + 1)} onClick={scrollToResults} rel="next" aria-label="Next page">›</Link>
              : <span className="bl-pager-btn is-off" aria-hidden="true">›</span>}
          </nav>
        )}
      </>
    );
  }

  return (
    <div className="bl-shop-page">
      {/* TITLE BAR: breadcrumb, heading, category blurb and sub-category chips */}
      <div className="bl-shop-banner">
        <div className="bl-shop-banner-in">
          <nav className="bl-crumbs" aria-label="Breadcrumb">
            <Link to="/">Home</Link>
            {category && group && group.id !== category.id && <><span aria-hidden="true">›</span><Link to={`/category/${group.slug}`}>{group.name}</Link></>}
            {category ? <><span aria-hidden="true">›</span><span aria-current="page">{category.name}</span></>
              : state.q ? <><span aria-hidden="true">›</span><Link to="/shop">Shop</Link><span aria-hidden="true">›</span><span aria-current="page">Search</span></>
              : <><span aria-hidden="true">›</span><span aria-current="page">{brandOnly || (isDeals ? 'Deals' : 'Shop')}</span></>}
          </nav>
          <div className="bl-shop-head">
            {category?.image_url && <img className="bl-shop-head-img" src={category.image_url} alt="" width="64" height="64" />}
            <div style={{ minWidth: 0 }}>
              <h1 className="bl-shop-title">{unknownCategory ? 'Category not found' : heading}</h1>
              {category?.description && <p className="bl-shop-desc">{category.description}</p>}
            </div>
          </div>
          {subChips.length > 0 && (
            <div className="bl-subcats no-scrollbar" aria-label="Sub-categories">
              {category.parent_id && <Link className="bl-chip-btn" to={`/category/${group.slug}`}>All {group.name}</Link>}
              {subChips.map(c => <Link key={c.id} to={`/category/${c.slug}`} className={`bl-chip-btn${c.id === category.id ? ' is-on' : ''}`} aria-current={c.id === category.id ? 'page' : undefined}>{c.name}</Link>)}
            </div>
          )}
        </div>
      </div>

      <div className="bl-wrap" style={{ paddingTop: 14, paddingBottom: 28 }}>
        <div className="bl-shop">
          {/* LEFT FILTER RAIL (desktop) */}
          {!isMobile && (
            <aside className="bl-filters" aria-label="Filters">
              <div className="bl-fgroup bl-fhead">
                <span>Filters</span>
                {filterCount > 0 && <button type="button" className="bl-fmore" onClick={clearAll}>Clear all</button>}
              </div>
              {panel}
            </aside>
          )}

          <div style={{ minWidth: 0 }}>
            {/* TOOLBAR */}
            <div className="bl-toolbar">
              <div className="bl-count" role="status" aria-live="polite">
                {result && !error && !unknownCategory && (count === 0 ? 'No products' : <>Showing <b>{range.from}–{range.to}</b> of <b>{count.toLocaleString('en-IN')}</b> {count === 1 ? 'product' : 'products'}</>)}
              </div>
              {isMobile ? (
                <div className="bl-mtools">
                  <button type="button" className="bl-filter-btn" onClick={() => setSheet('sort')}>{IconSort} Sort</button>
                  <button type="button" className="bl-filter-btn" onClick={() => setSheet('filter')}>{IconFilter} Filters{filterCount > 0 && <span className="bl-fbadge">{filterCount}</span>}</button>
                </div>
              ) : (
                <label className="bl-sort">
                  Sort by
                  <select className="bl-select" value={sortValue} onChange={e => onSort(e.target.value)}>
                    {sortOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              )}
            </div>

            {chips.length > 0 && (
              <div className="bl-active" aria-label="Active filters">
                {chips.map(c => (
                  <button key={c.key} type="button" className="bl-chip-btn is-on" onClick={c.clear} aria-label={`Remove filter ${c.label}`}>{c.label}<span className="x" aria-hidden="true">×</span></button>
                ))}
                {filterCount > 0 && <button type="button" className="bl-fmore" onClick={clearAll}>Clear all</button>}
              </div>
            )}

            <section id="shop-results" aria-label="Products">{results}</section>
          </div>
        </div>
      </div>

      {/* FILTER DRAWER + SORT SHEET (mobile) */}
      {isMobile && sheet === 'filter' && (
        <Sheet side title="Filters" onClose={() => setSheet(null)}
          footer={<>
            <button type="button" className="btn btn-outline" onClick={clearAll} disabled={filterCount === 0}>Clear all</button>
            <button type="button" className="btn btn-gold" onClick={() => setSheet(null)}>{loading ? 'Show results' : `Show ${count.toLocaleString('en-IN')} ${count === 1 ? 'product' : 'products'}`}</button>
          </>}>
          {panel}
        </Sheet>
      )}
      {isMobile && sheet === 'sort' && (
        <Sheet title="Sort by" onClose={() => setSheet(null)}>
          {sortOptions.map(o => (
            <button key={o.value} type="button" className={`bl-sheet-opt${sortValue === o.value ? ' is-on' : ''}`} onClick={() => onSort(o.value)} aria-pressed={sortValue === o.value}>
              {o.label}
              {sortValue === o.value && <span aria-hidden="true">✓</span>}
            </button>
          ))}
        </Sheet>
      )}
    </div>
  );
}
