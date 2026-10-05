import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCartActions, useCartData } from '../context/CartContext';
import { useBrand } from '../context/BrandContext';
import { useAuth } from '../context/AuthContext';
import { recordWhatsAppEnquiry } from '../utils/enquiryBeacon';
import { fmt, isProductSoldOut, productAddToCartPayload, productBadges, effectivePrice, startingPrice } from '../data/products';
import { getDeliveryRange } from '../utils/delivery';
import { isSaved, toggleSaved } from '../utils/wishlist';
import { COMPANY, whatsappLink } from '../config/company';
import BlurImage from './BlurImage';
import { thumb } from '../utils/thumbnail';
import toast from 'react-hot-toast';

function ProductCard({ product: p }) {
  // addToCart alone used to be enough here (no re-render just because some
  // other card's Add click changed the cart) -- now that this card must also
  // flip its own button to "Go to Cart" once ITS product is added, it needs
  // to read live cart contents too, so it re-renders on any cart change like
  // Cart/Checkout/the Navbar badge already do.
  const { addToCart } = useCartActions();
  const { cart } = useCartData();
  const navigate = useNavigate();
  const { brand } = useBrand();
  const { currentUser } = useAuth();
  const [saved, setSaved] = useState(() => isSaved(p.id));
  const isEnquiryOnly = p.enquiry_only || p.enquiryOnly;
  const isSoldOut = isProductSoldOut(p);
  // A product with a video AND a chosen cover image shows that cover first on its tile (with a play badge), aligned
  // with its own focus point. Anything else -- no video, or no cover chosen -- is exactly the first photo as before.
  const coverImg = p.video_url && p.video_cover_url ? p.video_cover_url : null;
  const img = coverImg || p.images?.[0];
  const imgPosition = coverImg ? (p.video_cover_position || '50% 50%') : (p.image_position || '50% 50%');
  const badges = productBadges(p);
  const hasVariants = Array.isArray(p.variants) && p.variants.length > 0;
  // Mirrors handleAdd's own payload exactly, so "already in cart" is checked
  // against the very same id+size this card would actually add -- a card has
  // no size picker, so productAddToCartPayload's own deterministic variant
  // choice IS the size that would land in the cart.
  const cartPayload = !isSoldOut && !isEnquiryOnly ? productAddToCartPayload(p) : null;
  const inCart = !!cartPayload && cart.some(i => i.id === p.id && (i.size || undefined) === (cartPayload.size || undefined));
  // No known delivery city yet at browse time (city isn't known until
  // checkout) -- getDeliveryRange() already treats an unknown city as the
  // optimistic/base per-product estimate, same as everywhere else this is used.
  const delivery = !isSoldOut && !isEnquiryOnly ? getDeliveryRange(p, brand) : null;

  function goToProduct() { navigate(`/product/${p.id}`); }

  // wa.me only ever pre-fills text -- there's no attachment parameter in
  // WhatsApp's click-to-chat API, so a real photo attachment isn't possible
  // here. A bare image URL doesn't get a preview thumbnail either --
  // WhatsApp's crawler only renders one from a page with proper Open Graph
  // tags. api/product-share.js is exactly that: a tiny server-rendered page
  // with the product's photo/name as og:image/og:title, which WhatsApp shows
  // as a real photo card, and which redirects an actual visitor straight to
  // this product's page.
  function enquireWhatsAppUrl() {
    // v= is a cache-buster, not read server-side -- WhatsApp caches a link
    // preview per exact URL and won't re-crawl just because the page's own
    // content changed later. Tying it to the product's own updated_at means a
    // photo change makes this effectively a new URL to WhatsApp, forcing a
    // fresh crawl instead of serving a stale cached result indefinitely.
    const cacheBust = p.updated_at ? `&v=${encodeURIComponent(p.updated_at)}` : '';
    const photoUrl = p.images?.[0] ? `${COMPANY.website}/api/product-share?id=${p.id}${cacheBust}` : null;
    const message = `Hi,\nI'm interested in "${p.name}".\nCould you please help me with my enquiry?` + (photoUrl ? `\n\n${photoUrl}` : '');
    return whatsappLink(message);
  }

  function handleAdd() { addToCart(productAddToCartPayload(p)); }

  function handleSave(e) {
    e.stopPropagation();
    const nowSaved = toggleSaved(p);
    setSaved(nowSaved);
    toast.success(nowSaved ? 'Added to your wishlist.' : 'Removed from your wishlist.');
  }

  return (
    <article className="bl-pcard">
      {/* IMAGE BLOCK */}
      <div className="bl-pcard-mediawrap">
        <button type="button" className="bl-pcard-media" onClick={goToProduct} aria-label={`View ${p.name}`} style={{ background: p.bg || undefined, cursor: 'pointer' }}>
          {img && <BlurImage src={thumb(img, 640)} alt={p.name} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: imgPosition }} />}
          {coverImg && (
            <span className="bl-pcard-play" aria-label="Has video">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
            </span>
          )}
          {isSoldOut && <span className="bl-pcard-soldmask"><span>Sold Out</span></span>}
        </button>

        {/* BADGES */}
        {(badges.length > 0 || p.is_collectors_piece) && (
          <div className="bl-pcard-badges">
            {badges.map((b, i) => <span key={i} className="badge badge-gold">{b}</span>)}
            {p.is_collectors_piece && <span className="badge badge-gold">Top Pick</span>}
          </div>
        )}

        {/* WISHLIST */}
        <button
          type="button"
          onClick={handleSave}
          className={`bl-pcard-wish${saved ? ' is-on' : ''}`}
          title={saved ? 'Remove from wishlist' : 'Add to wishlist'}
          aria-label={saved ? 'Remove from wishlist' : 'Add to wishlist'}
          aria-pressed={saved}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 000-7.78z" />
          </svg>
        </button>
      </div>

      {/* BODY */}
      <div className="bl-pcard-body">
        {p.cat && <div className="bl-pcard-cat">{p.cat}</div>}
        <button type="button" className="bl-pcard-name" onClick={goToProduct} title={p.name}>{p.name}</button>

        {isSoldOut ? (
          <div className="bl-pcard-priceRow"><span className="bl-pcard-note" style={{ fontWeight: 600 }}>Currently unavailable</span></div>
        ) : isEnquiryOnly ? (
          <div className="bl-pcard-priceRow"><span className="bl-pcard-price" style={{ fontSize: 14 }}>Price on request</span></div>
        ) : (
          <>
            <div className="bl-pcard-priceRow">
              {hasVariants && !p.price && <span className="bl-pcard-from">From</span>}
              <span className="bl-pcard-price">{fmt(effectivePrice(startingPrice(p), p.shipping_charge))}</span>
            </div>
            <div className="bl-pcard-note">Inclusive of all taxes</div>
          </>
        )}

        {delivery && (
          <div className="bl-pcard-chips">
            <span className="bl-chip">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z" /><circle cx="5.5" cy="18.5" r="2" /><circle cx="18.5" cy="18.5" r="2" /></svg>
              Free Delivery
            </span>
            <span className="bl-chip grey" title={`Estimated delivery ${delivery.label}`}>{delivery.daysLabel}</span>
          </div>
        )}

        <div className="bl-pcard-actions">
          {!isSoldOut && isEnquiryOnly && (
            <a href={enquireWhatsAppUrl()} target="_blank" rel="noreferrer" onClick={() => recordWhatsAppEnquiry(currentUser, { productId: p.id, reason: 'priceOnEnquiry' })} className="bl-pcard-add wa" style={{ textDecoration: 'none' }}>
              Enquire on WhatsApp
            </a>
          )}
          {!isSoldOut && !isEnquiryOnly && (
            inCart ? (
              <button type="button" className="bl-pcard-add is-in" onClick={(e) => { e.stopPropagation(); navigate('/cart'); }}>Go to Cart</button>
            ) : (
              <button type="button" className="bl-pcard-add" onClick={handleAdd}>Add to Cart</button>
            )
          )}
          {isSoldOut && (
            <button type="button" className="bl-pcard-add" onClick={goToProduct}>View Details</button>
          )}
        </div>
      </div>
    </article>
  );
}

export default React.memo(ProductCard);
