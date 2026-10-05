import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { useBrand } from '../context/BrandContext';
import { fmt, effectivePrice, isProductSoldOut, startingPrice, effectiveTaxonomy, SEARCHABLE_PRODUCT_FIELDS } from '../data/products';
import { thumb } from '../utils/thumbnail';

// Header search -- a real input that lives in the marketplace header (desktop: inline in the top
// row; mobile: its own full-width row under the logo bar). Results are fetched server-side (the
// header never loads the full catalogue) across the same field set Shop.jsx's own ?search=
// filter uses, via SEARCHABLE_PRODUCT_FIELDS. Enter / "See all results" hands off to /shop?search=.
export default function SearchBar({ placeholder = 'Search for products, categories and brands' }) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [active, setActive] = useState(-1);
  const navigate = useNavigate();
  const location = useLocation();
  const { brand } = useBrand();
  const inputRef = useRef(null);
  const boxRef = useRef(null);
  const debounceRef = useRef(null);

  // Mirror the current /shop?search= term so the box reflects what's being shown;
  // anywhere else it starts empty.
  useEffect(() => {
    const q = location.pathname === '/shop' ? new URLSearchParams(location.search).get('search') || '' : '';
    setQuery(q);
    setFocused(false);
    setResults([]);
    setSearched(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!focused) return;
    const onDown = (e) => { if (!boxRef.current?.contains(e.target)) setFocused(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); };
  }, [focused]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) { setResults([]); setSearched(false); setLoading(false); return; }
    setLoading(true);
    // Guards against an older, slower request resolving after a newer one --
    // otherwise retyping quickly could overwrite the results with the stale
    // query's answer, shown under a search box that had already moved on.
    let cancelled = false;
    debounceRef.current = setTimeout(async () => {
      // PostgREST's query-string filter DSL uses `*` as the ilike wildcard (not SQL's
      // own `%` -- that's reserved for URL percent-encoding), and the raw filter string
      // also breaks on commas/parens in the value -- strip those rather than trying to
      // escape PostgREST's own syntax.
      const safe = q.replace(/[,()%*]/g, ' ').trim();
      const orFilter = SEARCHABLE_PRODUCT_FIELDS.map(field => `${field}.ilike.*${safe}*`).join(',');
      let data = null;
      try {
        ({ data } = await supabase.from('products')
          .select('id,name,images,price,shipping_charge,image_position,enquiry_only,stock,variants')
          .eq('available', true)
          .or(orFilter)
          .limit(6));
      } catch { /* network-level failure -- fall through so the spinner always clears */ }
      if (cancelled) return;
      setResults(data || []);
      setActive(-1);
      setLoading(false);
      setSearched(true);
    }, 300);
    return () => { cancelled = true; clearTimeout(debounceRef.current); };
  }, [query]);

  function goToProduct(id) {
    setFocused(false);
    inputRef.current?.blur();
    navigate(`/product/${id}`);
  }

  function viewAll() {
    const q = query.trim();
    if (!q) return;
    setFocused(false);
    inputRef.current?.blur();
    navigate(`/shop?search=${encodeURIComponent(q)}`);
  }

  function goCategory(item) {
    setFocused(false);
    inputRef.current?.blur();
    navigate(`/shop?category=${encodeURIComponent(item)}`);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { setFocused(false); inputRef.current?.blur(); return; }
    if (!results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => (i + 1) % results.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => (i <= 0 ? results.length - 1 : i - 1)); }
  }

  function onSubmit(e) {
    e.preventDefault();
    if (active >= 0 && results[active]) goToProduct(results[active].id);
    else viewAll();
  }

  const q = query.trim();
  const groups = effectiveTaxonomy(brand);
  const suggestions = groups.flatMap(g => g.items).slice(0, 8);
  const showDrop = focused && (q ? true : suggestions.length > 0);

  return (
    <div className="bl-search" ref={boxRef}>
      <form className="bl-search-form" role="search" onSubmit={onSubmit}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></svg>
        <input
          ref={inputRef}
          className="bl-search-input"
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label="Search products"
          autoComplete="off"
          enterKeyHint="search"
        />
        {query && (
          <button type="button" className="bl-search-clear" aria-label="Clear search" onClick={() => { setQuery(''); inputRef.current?.focus(); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        )}
        <button type="submit" className="bl-search-submit">Search</button>
      </form>

      {showDrop && (
        <div className="bl-search-drop" role="listbox">
          {!q ? (
            <>
              <div className="bl-search-sugg-title">Browse categories</div>
              {suggestions.map(item => (
                <button key={item} type="button" className="bl-search-item" onClick={() => goCategory(item)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></svg>
                  <span className="bl-search-name">{item}</span>
                </button>
              ))}
            </>
          ) : loading ? (
            <div style={{ textAlign: 'center', padding: '22px 0' }}><span className="spinner"></span></div>
          ) : results.length === 0 ? (
            searched && <div className="bl-search-empty">No products found for &ldquo;{q}&rdquo;. Try a different keyword.</div>
          ) : (
            <>
              {results.map((p, i) => (
                <button key={p.id} type="button" role="option" aria-selected={i === active} className={`bl-search-item${i === active ? ' is-active' : ''}`} onClick={() => goToProduct(p.id)}>
                  {p.images?.[0]
                    ? <img className="bl-search-thumb" src={thumb(p.images[0], 120)} alt="" style={{ objectPosition: p.image_position || '50% 50%' }} />
                    : <span className="bl-search-thumb" />}
                  <span style={{ minWidth: 0 }}>
                    <div className="bl-search-name">{p.name}</div>
                    <div className="bl-search-price">
                      {isProductSoldOut(p) ? <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Currently unavailable</span>
                        : p.enquiry_only ? <span style={{ fontWeight: 600 }}>Price on request</span>
                        : <>{Array.isArray(p.variants) && p.variants.length > 0 && !p.price ? 'From ' : ''}{fmt(effectivePrice(startingPrice(p), p.shipping_charge))}</>}
                    </div>
                  </span>
                </button>
              ))}
              <button type="button" className="bl-search-all" onClick={viewAll}>See all results for &ldquo;{q}&rdquo;</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
