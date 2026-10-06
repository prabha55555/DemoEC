import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCartActions } from '../context/CartContext';
import { isProductSoldOut, priceRange, productBadges } from '../utils/catalog';
import BlurImage from './BlurImage';
import PriceBlock from './PriceBlock';
import StarRating from './StarRating';
import WishlistButton from './WishlistButton';
import { thumb } from '../utils/thumbnail';

// One product tile. Reads a list row (catalogApi LIST_COLUMNS) and never fetches. It deliberately does NOT subscribe
// to cart data (that re-rendered the whole grid on every cart change); the heart is its own small component for the
// same reason. A product with options never gets a silent size: its button takes the shopper to the product page.
function ProductCard({ product: p }) {
  const { quickAdd } = useCartActions();
  const navigate = useNavigate();
  const [state, setState] = useState('idle');     // idle | adding | added
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const href = `/product/${p.id}`;
  const soldOut = isProductSoldOut(p);
  const range = priceRange(p);
  const merch = productBadges(p).find(b => !/% OFF$/.test(b)) || '';
  const rated = Number(p.rating_count) > 0 && Number(p.rating_avg) > 0;
  const hasOptions = !!p.has_variants;

  // A product with a video and a chosen cover shows that cover first (with a play badge). List queries do not
  // select the video columns today; a row that carries them (a `select *`) gets the cover.
  const cover = p.video_url && p.video_cover_url ? p.video_cover_url : null;
  const img = cover || p.images?.[0];
  const imgPosition = cover ? (p.video_cover_position || '50% 50%') : (p.image_position || '50% 50%');

  async function handleAdd() {
    if (state === 'adding') return;
    setState('adding');
    const res = await quickAdd(p);
    if (res?.needsOptions) { setState('idle'); navigate(href); return; }
    setState(res?.added ? 'added' : 'idle');
    clearTimeout(timer.current);
    if (res?.added) timer.current = setTimeout(() => setState('idle'), 1800);
  }

  return (
    <article className={`bl-pcard${soldOut ? ' is-out' : ''}`}>
      <div className="bl-pcard-mediawrap">
        {/* The name below is the accessible link; this one only enlarges the tap target. */}
        <Link to={href} className="bl-pcard-media" tabIndex={-1} aria-hidden="true">
          {img && <BlurImage src={thumb(img, 480)} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: imgPosition }} />}
          {cover && (
            <span className="bl-pcard-play" aria-label="Has video">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
            </span>
          )}
          {soldOut && <span className="bl-pcard-soldmask"><span>Out of stock</span></span>}
        </Link>
        {merch && !soldOut && <div className="bl-pcard-badges"><span className="badge badge-gold">{merch}</span></div>}
        <WishlistButton productId={p.id} className="bl-pcard-wish" />
      </div>

      <div className="bl-pcard-body">
        {p.brand && <div className="bl-pcard-brand">{p.brand}</div>}
        <Link to={href} className="bl-pcard-name" title={p.name}>{p.name}</Link>
        {rated && <div className="bl-pcard-rating"><StarRating value={p.rating_avg} count={p.rating_count} size={13} /></div>}
        {range.from !== null && <PriceBlock price={range.from} mrp={range.mrp} prefix={hasOptions && range.isRange ? 'from' : ''} />}
        {p.free_shipping && !soldOut && <div className="bl-pcard-note ok">Free delivery</div>}

        <div className="bl-pcard-actions">
          {soldOut ? (
            <Link to={href} className="bl-pcard-add">View details</Link>
          ) : hasOptions ? (
            <Link to={href} className="bl-pcard-add">Select options</Link>
          ) : (
            <button type="button" className={`bl-pcard-add${state === 'added' ? ' is-in' : ''}`} onClick={handleAdd} disabled={state === 'adding'} aria-live="polite">
              {state === 'adding' ? 'Adding…' : state === 'added' ? 'Added ✓' : 'Add to cart'}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export default React.memo(ProductCard);

// Same footprint as a card while a list loads, so the page does not jump when the products arrive.
export function ProductCardSkeleton() {
  return (
    <div className="bl-pcard bl-pcard-skel" aria-hidden="true">
      <div className="bl-pcard-media bl-skel" />
      <div className="bl-pcard-body">
        <div className="bl-skel-line" style={{ width: '40%' }} />
        <div className="bl-skel-line" style={{ width: '90%' }} />
        <div className="bl-skel-line" style={{ width: '65%' }} />
        <div className="bl-skel-line lg" style={{ width: '45%' }} />
      </div>
    </div>
  );
}

export function ProductGridSkeleton({ count = 8, className = 'bl-grid' }) {
  return (
    <div className={className} role="status" aria-label="Loading products">
      {Array.from({ length: count }).map((_, i) => <ProductCardSkeleton key={i} />)}
    </div>
  );
}
