import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBrand } from '../context/BrandContext';
import { useCatalog } from '../context/CatalogContext';
import HeroSlider from '../components/HeroSlider';
import ProductShelf from '../components/ProductShelf';
import { COMPANY } from '../config/company';
import { shippingPromise, returnWindowDays } from '../utils/storeCopy';
import { DEALS_PATH } from '../utils/shopQuery';
import { thumb } from '../utils/thumbnail';
import { usePageMeta } from '../utils/usePageMeta';

const s = { width: 28, height: 28, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
// Plain line icons for category tiles that have no picture (assigned in order, so any category set looks consistent).
const CAT_ICONS = [
  <svg {...s}><path d="M20.4 6.6L16 4l-2 2.2a3 3 0 01-4 0L8 4 3.6 6.6l1.7 4.2L8 9.7V20h8V9.7l2.7 1.1z" /></svg>,
  <svg {...s}><path d="M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1z" /><path d="M9 21v-7h6v7" /></svg>,
  <svg {...s}><path d="M12 21s-7-4.6-7-10a4 4 0 017-2.6A4 4 0 0119 11c0 5.4-7 10-7 10z" /></svg>,
  <svg {...s}><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M11 18h2" /></svg>,
  <svg {...s}><path d="M6 8h12l1 12H5z" /><path d="M9 8V6a3 3 0 016 0v2" /></svg>,
  <svg {...s}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" /></svg>,
];
const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
const PERK_ICONS = {
  truck: <svg {...p}><path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z" /><circle cx="5.5" cy="18.5" r="2" /><circle cx="18.5" cy="18.5" r="2" /></svg>,
  lock: <svg {...p}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>,
  returns: <svg {...p}><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8M3 3v5h5" /></svg>,
  cash: <svg {...p}><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></svg>,
  support: <svg {...p}><path d="M3 18v-6a9 9 0 0118 0v6" /><path d="M21 19a2 2 0 01-2 2h-1v-7h3zM3 19a2 2 0 002 2h1v-7H3z" /></svg>,
};

export default function Home() {
  const { brand } = useBrand();
  const { tree, descendantIds } = useCatalog();
  const [shelfCounts, setShelfCounts] = useState({});

  usePageMeta({
    title: 'Online Shopping for Fashion, Home, Beauty & More',
    description: `Shop fashion, home & kitchen, beauty, electronics and more at ${COMPANY.name}. ${shippingPromise(brand)}, secure payments and easy returns.`,
    path: '/',
  });

  // The trust strip is built from the store's own settings, so it can never promise what the store does not do.
  const returnDays = returnWindowDays(null, brand);
  const perks = [
    { t: shippingPromise(brand), icon: PERK_ICONS.truck },
    { t: 'Secure online payments', icon: PERK_ICONS.lock },
    returnDays > 0 && { t: `${returnDays}-day easy returns`, icon: PERK_ICONS.returns },
    brand.cod_enabled ? { t: 'Cash on Delivery available', icon: PERK_ICONS.cash } : { t: `Customer support ${COMPANY.hours.toLowerCase()}`, icon: PERK_ICONS.support },
  ].filter(Boolean);

  // Tiles: every sub-category (or the group itself when it has none), each with its own picture when it has one.
  const tiles = useMemo(() => tree.flatMap(root => (root.children.length ? root.children : [root])).slice(0, 16), [tree]);

  // One shelf per leading group, then the shelves that apply to the whole store.
  const groupShelves = useMemo(() => tree.slice(0, 3).map(root => ({ id: root.id, name: root.name, slug: root.slug, ids: descendantIds(root.id) })), [tree, descendantIds]);
  const totalShelves = 4 + groupShelves.length;
  const report = (id) => (n) => setShelfCounts(c => (c[id] === n ? c : { ...c, [id]: n }));
  const allEmpty = Object.keys(shelfCounts).length >= totalShelves && Object.values(shelfCounts).every(n => n === 0);

  return (
    <div className="bl-home">
      <section className="bl-wrap" style={{ paddingTop: 12 }} aria-label="Offers">
        <HeroSlider />
        <ul className="bl-strip" aria-label="Why shop with us">
          {perks.map(perk => <li key={perk.t} className="bl-strip-item">{perk.icon}<span>{perk.t}</span></li>)}
        </ul>
      </section>

      {tiles.length > 0 && (
        <section className="bl-wrap bl-sec" aria-label="Shop by category">
          <div className="bl-cats no-scrollbar">
            {tiles.map((c, i) => (
              <Link key={c.id} to={`/category/${c.slug}`} className="bl-cat">
                <span className="bl-cat-ico">
                  {c.image_url ? <img src={thumb(c.image_url, 200)} alt="" width="84" height="84" loading="lazy" decoding="async" /> : CAT_ICONS[i % CAT_ICONS.length]}
                </span>
                <span className="bl-cat-name">{c.name}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <ProductShelf title="Deals of the day" sub="The biggest discounts right now" to={DEALS_PATH} tinted
        query={{ sort: 'discount', minDiscount: 10, inStockOnly: true }} onResult={report('deals')} />
      <ProductShelf title="Bestsellers" sub="What other shoppers are buying" to="/shop"
        query={{ sort: 'popular', inStockOnly: true }} onResult={report('best')} />
      <ProductShelf title="New arrivals" sub="Just added to the store" to="/shop?sort=newest"
        query={{ sort: 'newest', inStockOnly: true }} onResult={report('new')} />
      <ProductShelf title="Featured" sub="Hand-picked for you"
        query={{ featured: true, sort: 'popular', inStockOnly: true }} onResult={report('featured')} />
      {groupShelves.map(g => (
        <ProductShelf key={g.id} title={g.name} to={`/category/${g.slug}`} linkLabel="Shop all"
          query={{ categoryIds: g.ids, sort: 'popular', inStockOnly: true }} onResult={report(g.id)} />
      ))}

      {allEmpty && (
        <section className="bl-wrap bl-sec">
          <div className="bl-panel bl-empty">
            <h2>Fresh products are on their way</h2>
            <p>Our catalogue is being updated. Check back soon, or get in touch if you need help.</p>
            <div className="bl-empty-actions">
              <Link to="/shop" className="btn btn-gold">Browse the shop</Link>
              <Link to="/contact" className="btn btn-outline">Contact us</Link>
            </div>
          </div>
        </section>
      )}

      <section className="bl-wrap bl-sec" style={{ paddingBottom: 18 }} aria-label="More from us">
        <div className="bl-cta-duo">
          <div className="bl-cta sun">
            <h3>Give the gift of choice</h3>
            <p>Send a gift card in any amount, and let them pick what they love.</p>
            <Link to="/gift-card" className="btn btn-dark">Buy a gift card</Link>
          </div>
          <div className="bl-cta teal">
            <h3>Questions about an order?</h3>
            <p>Find quick answers on delivery, returns and payments, or reach our team any time.</p>
            <Link to="/help" className="btn btn-sun">Visit the Help Centre</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
