import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useCatalog } from '../context/CatalogContext';
import { fetchProducts, fetchFacets, searchWords } from '../utils/catalogApi';
import { priceRange, formatMoney } from '../utils/catalog';
import { readRecentSearches, pushRecentSearch, clearRecentSearches } from '../utils/storefrontStorage';
import { thumb } from '../utils/thumbnail';

const SUGGEST_COLUMNS = 'id,name,brand,price,price_max,mrp,in_stock,has_variants,images,image_position';

// Wraps the matched words in <mark> so the shopper sees why a suggestion matched.
function Highlight({ text, words }) {
  if (!words.length) return text;
  const re = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig');
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

const SearchIcon = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></svg>;
const ClockIcon = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
const GridIcon = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>;
const TagIcon = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8zM7.5 7.5h.01" /></svg>;

// Header search. Typing shows (debounced) suggestions -- matching categories, brands and up to six products with
// their image and price; Enter or "See all results" opens /shop?q=. Fully keyboard driven (a combobox: arrows move,
// Enter picks, Escape closes) and it remembers recent searches on this device.
export default function SearchBar({ placeholder = 'Search for products, brands and more' }) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [found, setFound] = useState({ products: [], brands: [], q: '' });
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState(readRecentSearches);
  const navigate = useNavigate();
  const location = useLocation();
  const { categories, tree } = useCatalog();
  const inputRef = useRef(null);
  const boxRef = useRef(null);
  const uid = useId();
  const listId = `${uid}-list`;

  // The box mirrors the search being shown (/shop?q=...); anywhere else it starts empty.
  useEffect(() => {
    const onListing = location.pathname === '/shop' || location.pathname.startsWith('/category/');
    setQuery(onListing ? new URLSearchParams(location.search).get('q') || '' : '');
    setFocused(false);
    setActive(-1);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!focused) return undefined;
    const onDown = (e) => { if (!boxRef.current?.contains(e.target)) setFocused(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); };
  }, [focused]);

  const q = query.trim();
  const words = useMemo(() => searchWords(q), [q]);
  const wordsKey = words.join(' ');

  // Debounced lookup. `cancelled` stops an older, slower answer from replacing the one for what is typed now.
  useEffect(() => {
    if (!wordsKey) { setFound({ products: [], brands: [], q: '' }); setLoading(false); return undefined; }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const w = wordsKey.split(' ');
      const [prod, facets] = await Promise.all([
        fetchProducts({ words: w, pageSize: 6, sort: 'popular', columns: SUGGEST_COLUMNS }).catch(() => ({ rows: [] })),
        fetchFacets({ words: w }).catch(() => ({ brands: [] })),
      ]);
      if (cancelled) return;
      const brands = (facets.brands || []).filter(b => w.some(x => b.name.toLowerCase().includes(x))).slice(0, 3);
      setFound({ products: prod.rows, brands, q: wordsKey });
      setActive(-1);
      setLoading(false);
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [wordsKey]);

  // One flat, ordered list of everything selectable -- this is what the arrow keys walk.
  const items = useMemo(() => {
    if (!wordsKey) {
      const cats = (tree.flatMap(r => (r.children.length ? r.children : [r])) || []).slice(0, 6);
      return [
        ...recent.map(r => ({ type: 'recent', key: `r:${r}`, label: r, href: `/shop?q=${encodeURIComponent(r)}` })),
        ...cats.map(c => ({ type: 'category', key: `c:${c.id}`, label: c.name, href: `/category/${c.slug}`, group: 'Popular categories' })),
      ];
    }
    const w = wordsKey.split(' ');
    const cats = categories.filter(c => w.every(x => c.name.toLowerCase().includes(x))).slice(0, 3).map(c => {
      const parent = categories.find(p => p.id === c.parent_id);
      return { type: 'category', key: `c:${c.id}`, label: c.name, meta: parent ? `in ${parent.name}` : 'Category', href: `/category/${c.slug}` };
    });
    const brands = found.q === wordsKey ? found.brands.map(b => ({ type: 'brand', key: `b:${b.name}`, label: b.name, meta: `Brand · ${b.count} ${b.count === 1 ? 'product' : 'products'}`, href: `/shop?brand=${encodeURIComponent(b.name)}` })) : [];
    const prods = found.q === wordsKey ? found.products.map(p => ({ type: 'product', key: `p:${p.id}`, label: p.name, product: p, href: `/product/${p.id}` })) : [];
    return [...cats, ...brands, ...prods];
  }, [wordsKey, recent, tree, categories, found]);

  function close() { setFocused(false); inputRef.current?.blur(); }
  function go(href) { close(); navigate(href); }
  function search(text) {
    const t = String(text ?? query).trim();
    if (!t) return;
    setRecent(pushRecentSearch(t));
    go(`/shop?q=${encodeURIComponent(t)}`);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Tab') { setFocused(false); return; }
    if (!items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocused(true); setActive(i => (i + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i <= 0 ? items.length - 1 : i - 1)); }
    else if (e.key === 'Home' && active >= 0) { e.preventDefault(); setActive(0); }
    else if (e.key === 'End' && active >= 0) { e.preventDefault(); setActive(items.length - 1); }
  }
  function onSubmit(e) {
    e.preventDefault();
    const it = items[active];
    if (it && it.type === 'recent') search(it.label);
    else if (it) go(it.href);
    else search();
  }

  const showDrop = focused && (wordsKey ? true : items.length > 0);
  const optId = (i) => `${uid}-o${i}`;
  const grouped = (type) => items.map((it, i) => ({ it, i })).filter(x => x.it.type === type);
  const row = ({ it, i }) => (
    <button key={it.key} id={optId(i)} type="button" role="option" aria-selected={i === active} tabIndex={-1}
      className={`bl-search-item${i === active ? ' is-active' : ''}`}
      onClick={() => (it.type === 'recent' ? search(it.label) : go(it.href))}>
      {it.type === 'product' ? (() => {
        const p = it.product;
        const r = priceRange(p);
        return (
          <>
            {p.images?.[0] ? <img className="bl-search-thumb" src={thumb(p.images[0], 120)} alt="" width="44" height="44" style={{ objectPosition: p.image_position || '50% 50%' }} /> : <span className="bl-search-thumb" />}
            <span style={{ minWidth: 0 }}>
              <span className="bl-search-name" style={{ display: 'block' }}><Highlight text={p.name} words={words} /></span>
              <span className="bl-search-price">
                {p.in_stock === false ? <span className="out">Out of stock</span> : r.from !== null && <>
                  {p.has_variants && r.isRange ? 'from ' : ''}{formatMoney(r.from)}
                  {r.mrp && <s>{formatMoney(r.mrp)}</s>}
                  {r.percentOff > 0 && <span className="off">{r.percentOff}% off</span>}
                </>}
              </span>
            </span>
          </>
        );
      })() : (
        <>
          {it.type === 'recent' ? ClockIcon : it.type === 'brand' ? TagIcon : it.group ? SearchIcon : GridIcon}
          <span style={{ minWidth: 0 }}>
            <span className="bl-search-name"><Highlight text={it.label} words={it.type === 'recent' ? [] : words} /></span>
            {it.meta && <span className="bl-search-meta" style={{ display: 'block' }}>{it.meta}</span>}
          </span>
        </>
      )}
    </button>
  );

  return (
    <div className="bl-search" ref={boxRef}>
      <form className="bl-search-form" role="search" onSubmit={onSubmit}>
        {SearchIcon}
        <input
          ref={inputRef}
          className="bl-search-input"
          type="search"
          role="combobox"
          aria-expanded={showDrop}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showDrop && active >= 0 ? optId(active) : undefined}
          value={query}
          onChange={e => { setQuery(e.target.value); setFocused(true); }}
          onFocus={() => { setFocused(true); setRecent(readRecentSearches()); }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label="Search products"
          autoComplete="off"
          enterKeyHint="search"
        />
        {query && (
          <button type="button" className="bl-search-clear" aria-label="Clear search" onClick={() => { setQuery(''); inputRef.current?.focus(); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        )}
        <button type="submit" className="bl-search-submit">Search</button>
      </form>

      <div id={listId} className="bl-search-drop" role="listbox" aria-label="Search suggestions" hidden={!showDrop}>
        {showDrop && (!wordsKey ? (
          <>
            {recent.length > 0 && (
              <>
                <div className="bl-search-sugg-title" role="presentation">Recent searches
                  <button type="button" className="bl-search-clearall" onClick={() => { clearRecentSearches(); setRecent([]); }}>Clear</button>
                </div>
                {grouped('recent').map(row)}
              </>
            )}
            {grouped('category').length > 0 && <div className="bl-search-sugg-title" role="presentation">Popular categories</div>}
            {grouped('category').map(row)}
          </>
        ) : (
          <>
            {grouped('category').length > 0 && <div className="bl-search-sugg-title" role="presentation">Categories</div>}
            {grouped('category').map(row)}
            {grouped('brand').length > 0 && <div className="bl-search-sugg-title" role="presentation">Brands</div>}
            {grouped('brand').map(row)}
            {grouped('product').length > 0 && <div className="bl-search-sugg-title" role="presentation">Products</div>}
            {grouped('product').map(row)}
            {loading && !grouped('product').length && <div className="bl-search-empty" role="presentation">Searching…</div>}
            {!loading && found.q === wordsKey && !items.length && <div className="bl-search-empty" role="presentation">No matches for “{q}”. Try a different word or browse a category.</div>}
            {!loading && found.q === wordsKey && items.length > 0 && !grouped('product').length && <div className="bl-search-empty" role="presentation">No products match “{q}” yet.</div>}
            <button type="button" className="bl-search-all" tabIndex={-1} onClick={() => search()}>See all results for “{q}”</button>
          </>
        ))}
      </div>
    </div>
  );
}
