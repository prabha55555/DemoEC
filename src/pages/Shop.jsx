import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabase';
import ProductCard from '../components/ProductCard';
import { COLLECTOR_LABEL, COMING_SOON_CATEGORIES, isProductSoldOut, matchesSearch, effectiveTaxonomy, startingPrice, effectivePrice } from '../data/products';
import { COMPANY } from '../config/company';
import { useBrand } from '../context/BrandContext';
import { usePageMeta } from '../utils/usePageMeta';

// Copy-pasted per-file rather than a shared hook, matching this codebase's
// existing convention (HeroSlider.jsx/PageHero.jsx both carry the same copy).
function useIsMobile(bp = 899) {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width: ${bp}px)`).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${bp}px)`);
    const handler = e => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [bp]);
  return isMobile;
}

// Legacy Supabase rows may still carry old names — match loosely.
const LEGACY_CATS = {};
function matchesCategory(product, category) {
  let want = category.trim().toLowerCase();
  want = LEGACY_CATS[want] || want;
  // A product flagged "Top Pick" in Admin belongs to this collection regardless of its
  // actual category (cat is single-select, so a product can't also literally be
  // re-categorized as "Top Picks").
  if (want === COLLECTOR_LABEL.trim().toLowerCase() && product.is_collectors_piece) return true;
  let cat = (product.cat || '').trim().toLowerCase();
  cat = LEGACY_CATS[cat] || cat;
  return cat === want;
}

const PRICE_BANDS = [
  { value: 'u500', label: 'Under ₹500', min: 0, max: 500 },
  { value: '500-1000', label: '₹500 – ₹1,000', min: 500, max: 1000 },
  { value: '1000-2000', label: '₹1,000 – ₹2,000', min: 1000, max: 2000 },
  { value: 'o2000', label: '₹2,000 & above', min: 2000, max: Infinity },
];

const SORT_OPTIONS = [
  { value: 'newest',     label: 'Newest First' },
  { value: 'oldest',     label: 'Oldest First' },
  { value: 'price-asc',  label: 'Price: Low to High' },
  { value: 'price-desc', label: 'Price: High to Low' },
  { value: 'enquiry',    label: 'Price on Request' },
];

const IconFilter = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>;
const IconCheck = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>;

export default function Shop() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { brand } = useBrand();
  const [products, setProducts]   = useState([]);
  const [catFilter, setCatFilter] = useState(searchParams.get('category') || 'All');
  const [groupFilter, setGroupFilter] = useState(searchParams.get('group') || '');
  const [collectionFilter, setCollectionFilter] = useState(searchParams.get('collection') || '');
  const [searchFilter, setSearchFilter] = useState(searchParams.get('search') || '');
  const [hideSoldOut, setHideSoldOut] = useState(false);
  const [priceBand, setPriceBand] = useState('');           // '' | 'u500' | '500-1000' | '1000-2000' | 'o2000' (client-side only)
  const [catSearch, setCatSearch] = useState('');
  const [openF, setOpenF] = useState({ cat: true, price: true, avail: true });
  const [sort, setSort]           = useState('newest');
  const [loading, setLoading]     = useState(true);
  const [sheet, setSheet]         = useState(null); // 'sort' | 'filter' | null (mobile bottom sheets)
  const groups = effectiveTaxonomy(brand);
  const comingSoonCats = Array.isArray(brand.coming_soon_categories) ? brand.coming_soon_categories : COMING_SOON_CATEGORIES;

  const shopTitle = collectionFilter || groupFilter || (catFilter !== 'All' ? catFilter : null);
  usePageMeta({
    title: shopTitle ? `${shopTitle} | Shop` : 'Shop All Products',
    description: shopTitle ? `Shop ${shopTitle} at ${COMPANY.name}.` : `Browse the full ${COMPANY.name} range of fashion, home & kitchen, beauty, electronics, bags, footwear and more.`,
    path: '/shop',
  });

  // Sync URL ?category= / ?group= / ?collection= whenever it changes (e.g. header menu click)
  useEffect(() => {
    setCatFilter(searchParams.get('category') || 'All');
    setGroupFilter(searchParams.get('group') || '');
    setCollectionFilter(searchParams.get('collection') || '');
    setSearchFilter(searchParams.get('search') || '');
  }, [searchParams]);

  // Lock page scroll behind an open bottom sheet.
  useEffect(() => {
    if (!sheet) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [sheet]);

  function handleCatClick(value) {
    if (value === 'All') setSearchParams({});
    else setSearchParams({ category: value });
    setSheet(null);
  }
  function handleGroupClick(label) { setSearchParams({ group: label }); setSheet(null); }
  function handleCollectionClick() { setSearchParams({ collection: COLLECTOR_LABEL }); setSheet(null); }

  useEffect(() => {
    supabase.from('products').select('*').eq('available', true)
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setProducts(data); setLoading(false); });
  }, []);

  // Apply all filters + sort -- memoized so opening a sheet or any other unrelated
  // re-render doesn't re-filter/re-sort the whole catalogue.
  const filtered = React.useMemo(() => {
    let result = [...products];
    if (searchFilter.trim()) {
      result = result.filter(p => matchesSearch(p, searchFilter));
    }
    if (collectionFilter) {
      result = result.filter(p => matchesCategory(p, collectionFilter));
    } else if (groupFilter) {
      const group = groups.find(g => g.label.toLowerCase() === groupFilter.toLowerCase());
      // An unmatched group (e.g. a stale/shared link to a group an admin has since
      // renamed) should show zero results, not silently fall through to "All" while
      // the filter still claims that group is active.
      result = group ? result.filter(p => group.items.some(item => matchesCategory(p, item))) : [];
    } else if (catFilter !== 'All') {
      result = result.filter(p => matchesCategory(p, catFilter));
    }
    // Price band (client-side, over the shown price). Enquiry-only products have no price, so a band excludes them.
    if (priceBand) {
      const band = PRICE_BANDS.find(b => b.value === priceBand);
      if (band) {
        result = result.filter(p => {
          if (p.enquiry_only) return false;
          const base = startingPrice(p);
          if (base == null) return false;
          const price = effectivePrice(base, p.shipping_charge);
          return price >= band.min && price < band.max;
        });
      }
    }
    // Sold-out products show normally in "All"/category browsing (or whenever "Hide
    // sold out" is turned on) -- but a price sort ranks what you can actually buy, so
    // sold-out items are excluded from it automatically, regardless of the toggle.
    if (hideSoldOut || sort === 'price-asc' || sort === 'price-desc') {
      result = result.filter(p => !isProductSoldOut(p));
    }
    // A price sort orders what actually has a price -- enquiry-only products (no
    // stored price at all) are excluded from it entirely.
    if (sort === 'price-asc' || sort === 'price-desc') {
      result = result.filter(p => !p.enquiry_only);
    }
    if (sort === 'oldest')     result = result.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
    if (sort === 'price-asc' || sort === 'price-desc') {
      // Uses startingPrice(), not the raw `price` field -- a variant product's base
      // `price` is null by convention (its real price lives on each variant).
      const dir = sort === 'price-asc' ? 1 : -1;
      result = result.sort((a, b) => {
        const aPrice = startingPrice(a);
        const bPrice = startingPrice(b);
        if (aPrice == null && bPrice == null) return 0;
        if (aPrice == null) return 1;
        if (bPrice == null) return -1;
        return dir * (aPrice - bPrice);
      });
    }
    if (sort === 'enquiry')    result = result.sort((a,b) => (b.enquiry_only?1:0) - (a.enquiry_only?1:0));

    // Available-first, always, on the complete filtered+sorted set -- BEFORE the
    // mobile pagination slice below ever touches it. A stable partition (not a fresh
    // sort), so the chosen sort stays the tiebreaker within each group.
    const available = result.filter(p => !isProductSoldOut(p));
    const soldOut = result.filter(p => isProductSoldOut(p));
    return [...available, ...soldOut];
  }, [products, searchFilter, collectionFilter, groupFilter, catFilter, hideSoldOut, priceBand, sort, groups]);

  // Mobile-only pagination -- desktop shows every filtered result at once.
  const isMobile = useIsMobile(899);
  const MOBILE_PAGE_SIZE = 12;
  const [mobilePage, setMobilePage] = useState(1);
  // Any change to what's actually being shown resets back to page 1.
  useEffect(() => { setMobilePage(1); }, [searchFilter, collectionFilter, groupFilter, catFilter, hideSoldOut, priceBand, sort]);
  // Page buttons sit at the very bottom of the list; jump back to the top of the
  // results (just under the fixed header) when the page changes, with smooth
  // scrolling switched off for the jump so it can't be cut short.
  function changeMobilePage(update) {
    setMobilePage(update);
    const jump = () => {
      const html = document.documentElement;
      const prev = html.style.scrollBehavior;
      html.style.scrollBehavior = 'auto';
      const top = document.getElementById('shop-results')?.getBoundingClientRect().top;
      window.scrollTo(0, top == null ? 0 : Math.max(0, window.scrollY + top - 130));
      html.style.scrollBehavior = prev;
    };
    jump();
    requestAnimationFrame(jump);
  }
  const mobileTotalPages = Math.max(1, Math.ceil(filtered.length / MOBILE_PAGE_SIZE));
  const gridItems = isMobile
    ? filtered.slice((mobilePage - 1) * MOBILE_PAGE_SIZE, mobilePage * MOBILE_PAGE_SIZE)
    : filtered;

  function clearSearch() {
    const next = new URLSearchParams(searchParams);
    next.delete('search');
    setSearchParams(next);
  }
  function clearAll() { setSearchParams({}); setHideSoldOut(false); setPriceBand(''); setCatSearch(''); setSort('newest'); setSheet(null); }

  const noCategory = !collectionFilter && !groupFilter && catFilter === 'All';
  const activeCount = (noCategory ? 0 : 1) + (hideSoldOut ? 1 : 0) + (priceBand ? 1 : 0) + (searchFilter.trim() ? 1 : 0);
  const heading = searchFilter.trim() && noCategory ? `Results for “${searchFilter.trim()}”` : (shopTitle || 'All Products');

  // Filter sections, shared by the desktop left rail and the mobile filter drawer.
  const q = catSearch.trim().toLowerCase();
  const categoryTree = (
    <>
      <div className="bl-fsearch">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></svg>
        <input value={catSearch} onChange={e => setCatSearch(e.target.value)} placeholder="Search" aria-label="Search categories" />
      </div>
      {!q && (
        <>
          <button type="button" className={`bl-fopt${noCategory ? ' is-on' : ''}`} onClick={() => handleCatClick('All')}>
            <span className="bl-fradio" />All Products
          </button>
          <button type="button" className={`bl-fopt${collectionFilter ? ' is-on' : ''}`} onClick={handleCollectionClick}>
            <span className="bl-fradio" />{COLLECTOR_LABEL}
          </button>
        </>
      )}
      {groups.map(group => {
        const items = group.items.filter(item => !q || item.toLowerCase().includes(q) || group.label.toLowerCase().includes(q));
        if (items.length === 0) return null;
        return (
          <div key={group.label} style={{ marginTop: 8 }}>
            <button type="button" className={`bl-fopt${!collectionFilter && groupFilter === group.label ? ' is-on' : ''}`} style={{ fontWeight: 600, color: 'var(--text)' }} onClick={() => handleGroupClick(group.label)}>
              {group.label}
            </button>
            <div style={{ paddingLeft: 4 }}>
              {items.map(item => comingSoonCats.includes(item) ? (
                <div key={item} className="bl-fopt" style={{ opacity: .55, cursor: 'default' }}>{item} <span className="bl-chip grey">Soon</span></div>
              ) : (
                <button key={item} type="button" className={`bl-fopt${!collectionFilter && !groupFilter && catFilter === item ? ' is-on' : ''}`} onClick={() => handleCatClick(item)}>
                  <span className="bl-fcheck">{!collectionFilter && !groupFilter && catFilter === item && IconCheck}</span>{item}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );

  const priceFilter = (
    <>
      {PRICE_BANDS.map(b => (
        <button key={b.value} type="button" className={`bl-fopt${priceBand === b.value ? ' is-on' : ''}`} onClick={() => setPriceBand(v => (v === b.value ? '' : b.value))} aria-pressed={priceBand === b.value}>
          <span className="bl-fcheck">{priceBand === b.value && IconCheck}</span>{b.label}
        </button>
      ))}
    </>
  );

  const availabilityToggle = (
    <button type="button" className={`bl-fopt${hideSoldOut ? ' is-on' : ''}`} onClick={() => setHideSoldOut(v => !v)} aria-pressed={hideSoldOut}>
      <span className="bl-fcheck">{hideSoldOut && IconCheck}</span>Hide sold-out products
    </button>
  );

  const Chev = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>;
  const filterSections = (
    <>
      {[
        ['cat', 'Category', categoryTree],
        ['price', 'Price', priceFilter],
        ['avail', 'Availability', availabilityToggle],
      ].map(([key, title, body]) => (
        <div key={key} className="bl-fgroup">
          <button type="button" className={`bl-fgroup-title is-btn${openF[key] ? ' is-open' : ''}`} onClick={() => setOpenF(o => ({ ...o, [key]: !o[key] }))} aria-expanded={!!openF[key]}>
            {title}{Chev}
          </button>
          {openF[key] && <div className="bl-fgroup-body">{body}</div>}
        </div>
      ))}
    </>
  );

  return (
    <div style={{ paddingTop: 'var(--hdr-h)', background: '#fff', minHeight: '100vh' }}>
      {/* PAGE TITLE */}
      <div className="bl-shop-banner">
        <div className="bl-shop-banner-in">
          <nav className="bl-crumbs" aria-label="Breadcrumb">
            <Link to="/">Home</Link><span aria-hidden="true">›</span>
            {shopTitle || searchFilter.trim() ? <><Link to="/shop">Shop</Link><span aria-hidden="true">›</span><span>{heading}</span></> : <span>Shop</span>}
          </nav>
          <h1 className="bl-shop-title">{heading}</h1>
          {!loading && <div className="bl-shop-count">Showing {filtered.length === 0 ? 0 : 1} - {filtered.length} of {filtered.length} {filtered.length === 1 ? 'product' : 'products'}</div>}
        </div>
      </div>

      <div className="bl-wrap" style={{ paddingTop: 16, paddingBottom: 28 }}>
        <div className="bl-shop">
          {/* LEFT FILTER RAIL (desktop) */}
          <aside className="bl-filters" aria-label="Filters">
            <div className="bl-fgroup" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10 }}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>Filters</span>
              {activeCount > 0 && <button type="button" className="bl-fmore" style={{ padding: 0 }} onClick={clearAll}>Clear all</button>}
            </div>
            {filterSections}
          </aside>

          <div style={{ minWidth: 0 }}>
            {/* TOOLBAR */}
            <div className="bl-toolbar">
              <div className="bl-toolbar-l">
                <button type="button" className="bl-filter-btn" onClick={() => setSheet('filter')}>{IconFilter} Filters{activeCount > 0 && <span className="dot" aria-label="filters active" />}</button>
                {searchFilter.trim() && (
                  <button type="button" className="bl-chip-btn is-on" onClick={clearSearch}>“{searchFilter.trim()}”<span className="x" aria-hidden="true">×</span><span style={{ position: 'absolute', left: -9999 }}>Clear search</span></button>
                )}
                {!noCategory && (
                  <button type="button" className="bl-chip-btn is-on" onClick={() => handleCatClick('All')}>{shopTitle}<span className="x" aria-hidden="true">×</span></button>
                )}
                {priceBand && (
                  <button type="button" className="bl-chip-btn is-on" onClick={() => setPriceBand('')}>{PRICE_BANDS.find(b => b.value === priceBand)?.label}<span className="x" aria-hidden="true">×</span></button>
                )}
                {hideSoldOut && (
                  <button type="button" className="bl-chip-btn is-on" onClick={() => setHideSoldOut(false)}>In stock only<span className="x" aria-hidden="true">×</span></button>
                )}
              </div>
              <label className="bl-sort">
                Sort by:
                <select className="bl-select" value={sort} onChange={e => setSort(e.target.value)}>
                  {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            </div>

            {/* RESULTS */}
            <section id="shop-results">
              {loading ? (
                <div style={{ textAlign: 'center', padding: 60 }}><span className="spinner"></span></div>
              ) : filtered.length === 0 ? (
                <div className="bl-panel" style={{ textAlign: 'center', padding: '48px 20px' }}>
                  <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ margin: '0 auto 10px' }}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35M8.5 11h5" /></svg>
                  <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 6 }}>
                    {searchFilter.trim() ? `No products found for “${searchFilter.trim()}”` : 'No products found'}
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 16 }}>Try a different keyword or clear your filters.</p>
                  <button type="button" className="btn btn-gold" onClick={clearAll}>Clear filters</button>
                </div>
              ) : (
                <>
                  <div className="bl-grid">
                    {gridItems.map(p => <ProductCard key={p.id} product={p} />)}
                  </div>

                  {/* Mobile-only pagination -- isMobile is false on desktop, so this never
                      renders there, and gridItems === filtered there regardless. */}
                  {isMobile && mobileTotalPages > 1 && (
                    <div className="bl-pager">
                      <button type="button" onClick={() => changeMobilePage(p => Math.max(1, p - 1))} disabled={mobilePage === 1} aria-label="Previous page">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><polyline points="15 18 9 12 15 6" /></svg>
                      </button>
                      <span style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap' }}>Page {mobilePage} of {mobileTotalPages}</span>
                      <button type="button" onClick={() => changeMobilePage(p => Math.min(mobileTotalPages, p + 1))} disabled={mobilePage === mobileTotalPages} aria-label="Next page">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><polyline points="9 18 15 12 9 6" /></svg>
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        </div>
      </div>

      {/* FILTER DRAWER (mobile) */}
      {sheet === 'filter' && (
        <>
          <div className="bl-fdrawer-scrim" onClick={() => setSheet(null)} />
          <aside className="bl-fdrawer" role="dialog" aria-modal="true" aria-label="Filter products">
            <div className="bl-fdrawer-head">
              Filters
              <button type="button" onClick={() => setSheet(null)} aria-label="Close filters" style={{ background: 'none', border: 'none', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="bl-fdrawer-body">{filterSections}</div>
            <div className="bl-fdrawer-foot">
              <button type="button" className="btn btn-outline" onClick={clearAll}>Clear all</button>
              <button type="button" className="btn btn-gold" onClick={() => setSheet(null)}>Show {filtered.length} {filtered.length === 1 ? 'product' : 'products'}</button>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
