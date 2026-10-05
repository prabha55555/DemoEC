import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useBrand } from '../context/BrandContext';
import { supabase } from '../supabase';
import ProductCard from '../components/ProductCard';
import HeroSlider from '../components/HeroSlider';
import { COLLECTOR_LABEL, effectiveTaxonomy } from '../data/products';
import { COMPANY, whatsappLink, DEFAULT_WA_MESSAGE } from '../config/company';
import { usePageMeta } from '../utils/usePageMeta';

// Copy-pasted per-file rather than a shared hook, matching this codebase's
// existing convention (Shop.jsx/HeroSlider.jsx/PageHero.jsx all carry the same copy).
function useIsMobile(bp = 768) {
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

const s = { width: 30, height: 30, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
// Generic line icons, assigned to category groups in order (works for any admin-defined taxonomy).
const CAT_ICONS = [
  <svg {...s}><path d="M20.4 6.6L16 4l-2 2.2a3 3 0 01-4 0L8 4 3.6 6.6l1.7 4.2L8 9.7V20h8V9.7l2.7 1.1z" /></svg>,
  <svg {...s}><path d="M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1z" /><path d="M9 21v-7h6v7" /></svg>,
  <svg {...s}><path d="M12 21s-7-4.6-7-10a4 4 0 017-2.6A4 4 0 0119 11c0 5.4-7 10-7 10z" /></svg>,
  <svg {...s}><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M11 18h2" /></svg>,
  <svg {...s}><path d="M6 8h12l1 12H5z" /><path d="M9 8V6a3 3 0 016 0v2" /></svg>,
  <svg {...s}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" /></svg>,
];

const PERKS = [
  { t: 'Free Delivery on every order', icon: <svg {...s} width="18" height="18"><path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z" /><circle cx="5.5" cy="18.5" r="2" /><circle cx="18.5" cy="18.5" r="2" /></svg> },
  { t: 'Secure Online Payments', icon: <svg {...s} width="18" height="18"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg> },
  { t: '24-Hour Support', icon: <svg {...s} width="18" height="18"><path d="M3 18v-6a9 9 0 0118 0v6" /><path d="M21 19a2 2 0 01-2 2h-1v-7h3zM3 19a2 2 0 002 2h1v-7H3z" /></svg> },
];

function SectionHead({ title, sub, to, allLabel = 'View all', icon }) {
  return (
    <div className="bl-sec-head">
      <div>
        <h2 className="bl-sec-title">{title}{icon}</h2>
        {sub && <div className="bl-sec-sub">{sub}</div>}
      </div>
      {to && <Link to={to} className="bl-link-all">{allLabel} <span aria-hidden="true">&rsaquo;</span></Link>}
    </div>
  );
}

function SkeletonCards({ n = 6 }) {
  return (
    <div className="bl-grid" aria-hidden="true">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="bl-pcard" style={{ minHeight: 280 }}>
          <div className="bl-pcard-media" style={{ background: 'linear-gradient(110deg,#EAF0EF 30%,#F6F9F8 50%,#EAF0EF 70%)', backgroundSize: '200% 100%', animation: 'blShimmer 1.4s linear infinite' }} />
          <div className="bl-pcard-body">
            <div style={{ height: 12, width: '85%', background: '#EAF0EF', borderRadius: 4 }} />
            <div style={{ height: 16, width: '40%', background: '#EAF0EF', borderRadius: 4, marginTop: 6 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const { brand } = useBrand();
  const isMobile = useIsMobile(768);
  const [products, setProducts] = useState([]);
  const [productsTotal, setProductsTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const groups = effectiveTaxonomy(brand);

  usePageMeta({
    title: 'Online Shopping for Fashion, Home, Beauty & More',
    description: `Shop fashion, home & kitchen, beauty, electronics, bags, footwear and more at ${COMPANY.name}. Free delivery on every order.`,
    path: '/',
  });

  useEffect(() => {
    // Only the first 20 are ever shown on Home -- fetch just those, and get the true
    // total separately (cheap head-only count) so "View all N products" stays accurate.
    // Ordered by featured, then discover_pinned, so either kind of pinned product
    // always lands in this batch even if it's not one of the most recently added.
    // Newest-first still decides the order within each group.
    supabase.from('products').select('*').eq('available', true)
      .order('featured', { ascending: false }).order('discover_pinned', { ascending: false }).order('created_at', { ascending: false }).limit(20)
      .then(({ data }) => { if (data) setProducts(data); }, () => {})
      .then(() => setLoaded(true));
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('available', true)
      .then(({ count }) => { if (typeof count === 'number') setProductsTotal(count); }, () => {});
  }, []);

  // Admin-pinned (featured) products lead; the rest follow newest-first. Split into
  // distinct shelves so the same product never repeats down the page.
  const featured = products.filter(p => p.featured);
  const rest = products.filter(p => !p.featured);
  const ordered = [...featured, ...rest];
  const topCount = isMobile ? 6 : 8;
  const topPicks = ordered.slice(0, topCount);
  const newArrivals = ordered.slice(topCount, topCount + (isMobile ? 6 : 8));
  const more = ordered.slice(topCount + newArrivals.length);

  // Category thumbnails: every item of every group, tagged with its group's icon slot.
  const thumbs = groups.flatMap((g, gi) => g.items.map(item => ({ item, gi }))).slice(0, 16);

  return (
    <div style={{ paddingTop: 'var(--hdr-h)', background: '#fff' }}>
      {/* BANNER */}
      <section className="bl-wrap" style={{ paddingTop: 12 }}>
        <div className="bl-hero-grid"><HeroSlider /></div>
        <div className="bl-strip" style={{ marginTop: 8 }}>
          {PERKS.map(p => (
            <div key={p.t} className="bl-strip-item">{p.icon}<span>{p.t}</span></div>
          ))}
        </div>
      </section>

      {/* CATEGORY THUMBNAILS */}
      {thumbs.length > 0 && (
        <section className="bl-wrap bl-sec" aria-label="Shop by category">
          <div className="bl-cats no-scrollbar">
            {thumbs.map(({ item, gi }) => (
              <button key={item} type="button" className="bl-cat" onClick={() => navigate(`/shop?category=${encodeURIComponent(item)}`)}>
                <span className="bl-cat-ico">{CAT_ICONS[gi % CAT_ICONS.length]}</span>
                <span className="bl-cat-name">{item}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* FEATURED BANNER WITH ARCH TILES */}
      {groups.length > 0 && (
        <section className="bl-wrap bl-sec">
          <div className="bl-feature">
            <div className="bl-feature-copy">
              <div className="bl-feature-kicker">
                <svg width="38" height="38" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.9 6.9L22 10l-5.5 4.8L18.2 22 12 18.3 5.8 22l1.7-7.2L2 10l7.1-1.1z" /></svg>
                {COLLECTOR_LABEL}
              </div>
              <p className="bl-feature-text">Products you love, picked with care. Free delivery on every order.</p>
              <Link to={`/shop?collection=${encodeURIComponent(COLLECTOR_LABEL)}`} className="bl-feature-cta">Shop Now</Link>
            </div>
            <div className="bl-arches">
              {groups.slice(0, 4).map((g, i) => (
                <Link key={g.label} to={`/shop?group=${encodeURIComponent(g.label)}`} className="bl-arch">
                  <span className="bl-arch-ico">{CAT_ICONS[i % CAT_ICONS.length]}</span>
                  <span className="bl-arch-t">{g.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* TOP PICKS */}
      <section className="bl-wrap bl-sec">
        <SectionHead title={brand.home_featured_title || 'Top Picks For You'} to="/shop" allLabel="View all" />
        {!loaded ? <SkeletonCards n={isMobile ? 4 : 6} /> : topPicks.length > 0 ? (
          <div className="bl-rail no-scrollbar">
            {topPicks.map(p => <ProductCard key={p.id} product={p} />)}
          </div>
        ) : (
          <div className="bl-panel" style={{ padding: '30px 18px', textAlign: 'center' }}>
            <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 6 }}>Fresh products are on their way</div>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, maxWidth: 440, margin: '0 auto 14px' }}>Our catalogue is being updated. Browse the categories or talk to our team directly.</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link to="/shop" className="btn btn-gold">Browse Categories</Link>
              <Link to="/contact" className="btn btn-outline">Contact Us</Link>
            </div>
          </div>
        )}
      </section>

      {/* FRESH ARRIVALS (tinted container) */}
      {newArrivals.length > 0 && (
        <section className="bl-wrap bl-sec">
          <div className="bl-tint">
            <SectionHead title="Fresh Arrivals" to="/shop" allLabel="View all" />
            <div className="bl-rail no-scrollbar">
              {newArrivals.map(p => <ProductCard key={p.id} product={p} />)}
            </div>
          </div>
        </section>
      )}

      {/* PRODUCTS FOR YOU */}
      {more.length > 0 && (
        <section className="bl-wrap bl-sec">
          <SectionHead title="Products For You" />
          <div className="bl-grid cols-5">
            {more.map(p => <ProductCard key={p.id} product={p} />)}
          </div>
          {productsTotal > products.length && (
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <button type="button" className="btn btn-outline" onClick={() => navigate('/shop')}>View all {productsTotal} products</button>
            </div>
          )}
        </section>
      )}

      {/* CALLS TO ACTION */}
      <section className="bl-wrap bl-sec" style={{ paddingBottom: 18 }}>
        <div className="bl-cta-duo">
          <div className="bl-cta sun">
            <h3>Give the gift of choice</h3>
            <p>Brightlight gift cards — pick an amount, and they pick what they love.</p>
            <Link to="/gift-card" className="btn btn-dark">Buy a Gift Card</Link>
          </div>
          <div className="bl-cta teal">
            <h3>{brand.home_ink_title || 'Everything you need, delivered to your door.'}</h3>
            <p>{brand.home_ink_body || 'Shop everyday products across fashion, home, beauty, electronics and more — with free delivery and secure payments.'}</p>
            <a href={whatsappLink(DEFAULT_WA_MESSAGE)} target="_blank" rel="noreferrer" className="btn btn-sun">Chat with us</a>
          </div>
        </div>
      </section>

      <style>{`
        @keyframes blShimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
      `}</style>
    </div>
  );
}
