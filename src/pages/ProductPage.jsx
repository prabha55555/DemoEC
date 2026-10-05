import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../supabase';
import { useCartActions, useCartData } from '../context/CartContext';
import { useBrand } from '../context/BrandContext';
import { useAuth } from '../context/AuthContext';
import { fmt, knownStock, productBadges, effectivePrice, withShippingCharge, startingPrice, effectiveTaxonomy } from '../data/products';
import { COMPANY, whatsappLink } from '../config/company';
import { isSaved, toggleSaved } from '../utils/wishlist';
import { getDeliveryRange } from '../utils/delivery';
import ProductCard from '../components/ProductCard';
import NotifyWhenAvailable from '../components/NotifyWhenAvailable';
import ProductVideo from '../components/ProductVideo';
import { buildProductMedia, clampVideoPosition, photoIndexFromMerged, mergedIndexFromPhoto } from '../utils/productMedia';
import BlurImage from '../components/BlurImage';
import { FacebookIcon, TwitterXIcon, PinterestIcon, EmailIcon } from '../components/SocialIcons';
import { thumb } from '../utils/thumbnail';
import toast from 'react-hot-toast';
import { usePageMeta } from '../utils/usePageMeta';

// Inline line-icon glyphs (rendered by <Ico/> below: 1.8 stroke, rounded caps).
const IC = {
  truck: <path d="M1 3h15v13H1zM16 8h4l3 3v5h-7V8zM5.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM18.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />,
  cart: <path d="M3 4h2l2.4 11.2a1 1 0 00.8.8h8.9a1 1 0 001-.8L20 8H6.2M9.5 20h.01M17 20h.01" />,
  bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  check: <polyline points="20 6 9 17 4 12" />,
  heart: <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 000-7.78z" />,
  share: <path d="M18 8a3 3 0 100-6 3 3 0 000 6zM6 15a3 3 0 100-6 3 3 0 000 6zM18 22a3 3 0 100-6 3 3 0 000 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />,
  zoom: <path d="M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-4.3-4.3M11 8v6M8 11h6" />,
  lock: <path d="M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5l8-3zM9 12l2 2 4-4" />,
  support: <path d="M3 18v-6a9 9 0 0118 0v6M3 18a2 2 0 002 2h1v-7H5a2 2 0 00-2 2zM21 18a2 2 0 01-2 2h-1v-7h1a2 2 0 012 2z" />,
  returns: <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8M3 3v5h5" />,
  chat: <path d="M21 11.5a8.4 8.4 0 01-8.5 8.5 8.6 8.6 0 01-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 1121 11.5z" />,
};
function Ico({ children, size = 20, sw = 1.8, fill = 'none' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
  );
}

export default function ProductPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addToCart } = useCartActions();
  const { cart } = useCartData();
  const { brand } = useBrand();
  const { currentUser } = useAuth();
  const groups = effectiveTaxonomy(brand);
  const [product, setProduct] = useState(null);
  const [related, setRelated] = useState([]);
  const [relatedTier, setRelatedTier] = useState('cat'); // 'cat' | 'group' | 'recent'
  const [relatedGroupLabel, setRelatedGroupLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeImg, setActiveImg] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  // Replaces the old binary "zoomed" flag -- zoomScale is continuous (1 = fit,
  // up to 4 = max pinch-in) so a two-finger pinch can land anywhere in that
  // range, not just toggle between two fixed sizes. Double-tap still only
  // ever jumps straight to 1 or 2, same as the old boolean did.
  const [zoomScale, setZoomScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [saved, setSaved] = useState(false);
  const [selectedVariantIdx, setSelectedVariantIdx] = useState(null);
  // Presentation-only UI state: which info tab is open, and whether the share popover on the image is open.
  const [infoTab, setInfoTab] = useState('desc');
  const [shareOpen, setShareOpen] = useState(false);

  // Fresh product => back to the first tab with the share popover closed.
  useEffect(() => { setInfoTab('desc'); setShareOpen(false); }, [id]);

  // Escape closes the share popover (same convention as the lightbox below).
  useEffect(() => {
    if (!shareOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setShareOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shareOpen]);

  // Lock page scroll while the lightbox is open — without this, scrolling the
  // underlying page on mobile made the fixed lightbox appear to jump/misalign.
  useEffect(() => {
    if (!lightbox) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [lightbox]);

  // Matches the same convention already used in SearchBar.jsx -- Escape closes
  // an open overlay, not just a click on the backdrop/close button.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e) => { if (e.key === 'Escape') setLightbox(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [lightbox]);

  // Dialog focus handling (WAI-ARIA dialog pattern): move focus into the lightbox
  // the instant it opens (onto its close button, the safest universal landing
  // spot) and hand focus back to whatever opened it once it closes -- otherwise
  // a keyboard/screen-reader user's focus is left on a now-hidden element, or
  // silently reset to <body>.
  const lightboxCloseRef = React.useRef(null);
  const lightboxTriggerRef = React.useRef(null);
  useEffect(() => {
    if (lightbox) {
      lightboxTriggerRef.current = document.activeElement;
      lightboxCloseRef.current?.focus();
    } else {
      lightboxTriggerRef.current?.focus?.();
    }
  }, [lightbox]);

  useEffect(() => { setZoomScale(1); setPanOffset({ x: 0, y: 0 }); }, [activeImg, lightbox]);

  const lastTapRef = React.useRef(0);
  function handleImageTap(e) {
    e.stopPropagation();
    const now = Date.now();
    if (now - lastTapRef.current < 350) {
      // Fixed 1x/2x jump on double-tap, same as the old boolean toggle --
      // pinch (below) is what lets the user land on anything in between.
      setZoomScale(z => (z > 1 ? 1 : 2));
      setPanOffset({ x: 0, y: 0 });
    }
    lastTapRef.current = now;
  }

  // Pinch-to-zoom + pan-while-zoomed on the lightbox's main image. Relies on
  // .pp-lightbox's own touch-action:none (set below) to already stop the
  // browser's native page-scroll/pinch-zoom gesture on this element -- so
  // there's no need to fight React's passive touch-event listeners with
  // preventDefault() (which doesn't work here since React 17+ attaches
  // touchmove as passive by default).
  const pinchRef = React.useRef(null); // { startDist, startScale }
  const panRef = React.useRef(null); // { startX, startY, startOffset }
  function touchDist(touches) {
    const [a, b] = touches;
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }
  function onZoomTouchStart(e) {
    if (e.touches.length === 2) {
      pinchRef.current = { startDist: touchDist(e.touches), startScale: zoomScale };
    } else if (e.touches.length === 1 && zoomScale > 1) {
      panRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, startOffset: panOffset };
    }
  }
  function onZoomTouchMove(e) {
    if (e.touches.length === 2 && pinchRef.current) {
      const scale = Math.min(4, Math.max(1, pinchRef.current.startScale * (touchDist(e.touches) / pinchRef.current.startDist)));
      setZoomScale(scale);
    } else if (e.touches.length === 1 && panRef.current && zoomScale > 1) {
      const dx = e.touches[0].clientX - panRef.current.startX;
      const dy = e.touches[0].clientY - panRef.current.startY;
      // Bounds how far the image can be dragged off-center, scaling with how
      // far zoomed in it currently is -- more zoom, more room to pan.
      const maxPan = (zoomScale - 1) * 160;
      setPanOffset({
        x: Math.max(-maxPan, Math.min(maxPan, panRef.current.startOffset.x + dx)),
        y: Math.max(-maxPan, Math.min(maxPan, panRef.current.startOffset.y + dy)),
      });
    }
  }
  function onZoomTouchEnd(e) {
    if (e.touches.length === 0) {
      pinchRef.current = null;
      panRef.current = null;
      // Pinching back down below 1x snaps to the normal centered view instead
      // of leaving the image at some odd in-between scale/offset.
      if (zoomScale <= 1.05) { setZoomScale(1); setPanOffset({ x: 0, y: 0 }); }
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setActiveImg(0);
    setSelectedVariantIdx(null);
    supabase.from('products').select('*').eq('id', id).single().then(({ data }) => {
      if (cancelled) return;
      setProduct(data || null);
      // Default to the first in-stock option so price/specs are accurate immediately,
      // instead of forcing a click before showing real numbers. Selecting by index (not
      // name) keeps this unambiguous even if two options happen to share the same name.
      if (data?.variants?.length) {
        // Untracked stock (null/'') means "unknown, assume available," never "sold out" --
        // knownStock() is the app-wide contract for this (src/data/products.js). Prefer a
        // definitely-in-stock variant first, then any non-sold-out (including untracked)
        // variant, before falling back to just the first option regardless.
        let idx = data.variants.findIndex(v => knownStock(v.stock) > 0);
        if (idx === -1) idx = data.variants.findIndex(v => knownStock(v.stock) !== 0);
        if (idx === -1) idx = 0;
        setSelectedVariantIdx(idx);
      }
      setLoading(false);
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    return () => { cancelled = true; };
  }, [id]);

  // Recomputes whenever the selected variant changes, not just on initial load --
  // isSaved(id) alone can't tell Small and Large of the same product apart, so
  // the heart used to stay showing "saved" (from Small) after switching to
  // Large, and clicking it again would remove the Small entry instead of adding
  // a Large one.
  useEffect(() => {
    if (!product) return;
    const variant = (product.variants?.length && selectedVariantIdx !== null) ? product.variants[selectedVariantIdx] : null;
    setSaved(isSaved(product.id, variant?.size));
  }, [product, selectedVariantIdx]);

  useEffect(() => {
    if (!product) { setRelated([]); return; }
    let cancelled = false;
    const productCat = (product.cat || '').trim().toLowerCase();

    // Three bounded, targeted queries (widening only as needed) instead of pulling
    // every available product on every product-page view just to slice down to 4.
    async function loadRelated() {
      const { data: sameCat } = await supabase.from('products').select('*')
        .eq('available', true).neq('id', product.id).ilike('cat', productCat)
        .order('created_at', { ascending: false }).limit(4);
      if (cancelled) return;
      if (sameCat?.length > 0) { setRelated(sameCat); setRelatedTier('cat'); return; }

      // No other products in the exact same category — widen to the same taxonomy group
      // before falling back to "recent".
      const group = groups.find(g => g.items.some(item => item.toLowerCase() === productCat));
      if (group) {
        const { data: sameGroup } = await supabase.from('products').select('*')
          .eq('available', true).neq('id', product.id).in('cat', group.items)
          .order('created_at', { ascending: false }).limit(4);
        if (cancelled) return;
        if (sameGroup?.length > 0) { setRelated(sameGroup); setRelatedTier('group'); setRelatedGroupLabel(group.label); return; }
      }

      const { data: recent } = await supabase.from('products').select('*')
        .eq('available', true).neq('id', product.id)
        .order('created_at', { ascending: false }).limit(4);
      if (cancelled) return;
      setRelated(recent || []);
      setRelatedTier('recent');
    }
    loadRelated();
    return () => { cancelled = true; };
  }, [product, groups]);

  // Called unconditionally, before the loading/not-found early returns below
  // (hooks can't be called conditionally) -- degrades gracefully via optional
  // chaining while `product` is still null. Same caveat as Home/Shop's own
  // usePageMeta calls: only helps crawlers that execute JS (Google's does);
  // WhatsApp/Facebook/Twitter's link-preview crawlers don't, which is exactly
  // why the enquiry flow deliberately points at api/product-share.js instead.
  usePageMeta({
    title: product?.name,
    description: [product?.cat, product?.origin].filter(Boolean).join(' — ') || undefined,
    path: `/product/${id}`,
    image: product?.images?.[0],
  });

  function handleSave() {
    if (!product) return;
    // Save whichever option is actually selected on screen, not the bare base
    // product -- otherwise the wishlist can't tell this specific option's real
    // price/stock apart from any other option of the same product.
    const toSave = chosenVariant
      ? { ...product, size: chosenVariant.size, price: chosenVariant.price ?? product.price, stock: chosenVariant.stock }
      : product;
    const nowSaved = toggleSaved(toSave);
    setSaved(nowSaved);
    toast.success(nowSaved ? 'Saved for later.' : 'Removed from saved.');
  }

  // Opens WhatsApp immediately (so it isn't blocked as a popup) and saves the enquiry server-side
  // (api/send-enquiry-whatsapp.js) so it shows up under Admin > Enquiries -- for a guest exactly the
  // same as a signed-in customer, and with a real error shown here if it genuinely fails, instead of
  // silently never reaching Admin the way a direct client-side insert could.
  async function handleEnquire(reason) {
    const sizeNote = chosenVariant ? ` (Option: ${chosenVariant.size})` : '';
    const enquiryMsg = `Hi, I'm interested in "${product.name}"${sizeNote}. Could you please help me with my enquiry?`;
    const messages = {
      soldOut: `Hi,
I'm interested in "${product.name}"${sizeNote}.
I see that it's currently sold out. Is it still available, or could you help me find something similar?`,
      priceOnEnquiry: enquiryMsg,
      inStock: enquiryMsg,
    };
    // wa.me only ever pre-fills text -- there's no attachment parameter in
    // WhatsApp's click-to-chat API, so a real photo attachment isn't
    // possible here. A bare image URL doesn't get a preview thumbnail either
    // -- confirmed live, WhatsApp's crawler only renders one from a page
    // with proper Open Graph tags. api/product-share.js is exactly that: a
    // tiny server-rendered page with the product's photo/name as og:image/
    // og:title, which WhatsApp shows as a real photo card, and which
    // redirects an actual visitor straight to this product page.
    // v= is a cache-buster, not read server-side -- see ProductCard.jsx's
    // own copy of this same reasoning (WhatsApp caches a link preview per
    // exact URL and won't re-crawl just because the page's content changed).
    const cacheBust = product.updated_at ? `&v=${encodeURIComponent(product.updated_at)}` : '';
    const photoUrl = product.images?.[0] ? `${COMPANY.website}/api/product-share?id=${product.id}${cacheBust}` : null;
    const message = messages[reason] + (photoUrl ? `\n\n${photoUrl}` : '');
    window.open(whatsappLink(message), '_blank');

    const payload = { productId: product.id, reason, size: chosenVariant?.size || null };

    // navigator.sendBeacon is the browser's own purpose-built primitive for exactly this moment: a
    // request that must be delivered even though the page is about to be backgrounded or torn down
    // (window.open above switches straight to the WhatsApp app on a phone). It's a stronger guarantee
    // than fetch(..., {keepalive:true}) -- which this replaces -- because the browser queues it at the
    // OS/network level immediately rather than relying on the page's own JS execution surviving long
    // enough to hand the request off. It can't set custom headers, so the access token (when logged
    // in) travels in the JSON body instead -- api/send-enquiry-whatsapp.js accepts either.
    function beaconSend(body) {
      if (navigator.sendBeacon) {
        const ok = navigator.sendBeacon('/api/send-enquiry-whatsapp', new Blob([JSON.stringify(body)], { type: 'application/json' }));
        if (ok) return true;
      }
      // Fallback for the rare browser without sendBeacon, or one that refused to queue it (e.g. over
      // its per-origin pending-beacon limit) -- best-effort only, matches the pre-sendBeacon behavior.
      fetch('/api/send-enquiry-whatsapp', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
      return false;
    }

    if (!currentUser) {
      // The common, highest-risk case: no async gap at all between opening WhatsApp and handing this
      // off, since there's no token to fetch first.
      beaconSend(payload);
      return;
    }
    // A signed-in customer's own session lookup is one small, already-cached (no network round trip)
    // async step -- kept after window.open so opening WhatsApp is never delayed by it.
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      beaconSend(token ? { ...payload, accessToken: token } : payload);
    } catch {
      beaconSend(payload);
    }
  }

  const touchX = React.useRef(null);
  const multiTouchRef = React.useRef(false);
  function onTouchStart(e) { touchX.current = e.touches[0].clientX; multiTouchRef.current = e.touches.length > 1; }
  // `offset` is how many non-photo items (the video, when it comes first) precede the photos in the list
  // the swipe moves through -- 0 for the main gallery, 1 in the photo-only lightbox when a video leads.
  function onTouchEnd(e, count, offset = 0) {
    // multiTouchRef guards against a pinch gesture (2 fingers) being
    // misread as a swipe -- the swipe distance below is measured only off
    // the first finger, which can easily move >40px mid-pinch on its own.
    if (touchX.current === null || count < 2 || zoomScale > 1 || multiTouchRef.current) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 40) {
      setActiveImg(i => offset + (dx < 0 ? (i - offset + 1) % count : (i - offset - 1 + count) % count));
    }
    touchX.current = null;
  }

  if (loading) {
    return <div style={{ paddingTop: 'var(--hdr-h)', minHeight: '80vh', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span className="spinner"></span></div>;
  }

  if (!product) {
    return (
      <div style={{ paddingTop: 'var(--hdr-h)', minHeight: '80vh', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '100px 24px' }}>
        <div>
          <div style={{ fontFamily: "var(--font-head)", fontWeight: 500, fontSize: 22, color: 'var(--text)', marginBottom: 14 }}>Product not found</div>
          <button className="btn btn-outline" onClick={() => navigate('/shop')}>Back to Shop</button>
        </div>
      </div>
    );
  }

  const isEnquiryOnly = product.enquiry_only || product.enquiryOnly;
  const hasVariants = (product.variants || []).length > 0;
  const chosenVariant = hasVariants && selectedVariantIdx !== null ? product.variants[selectedVariantIdx] : null;
  const allVariantsSoldOut = hasVariants && product.variants.every(v => knownStock(v.stock) === 0);
  const isSoldOut = hasVariants ? (chosenVariant ? knownStock(chosenVariant.stock) === 0 : allVariantsSoldOut) : knownStock(product.stock) === 0;
  // Before any variant is chosen, product.price is blank for a variant-only
  // product (Admin's own convention) -- fall back to the lowest variant price
  // instead of showing "Rs. 0" ahead of a selection.
  const displayPrice = chosenVariant ? chosenVariant.price : startingPrice(product);
  const displayPriceWithShipping = effectivePrice(displayPrice, product.shipping_charge);
  const displayWeight = chosenVariant ? chosenVariant.weight : product.weight;
  const displayDimensions = chosenVariant ? chosenVariant.dimensions : product.dimensions;
  const delivery = getDeliveryRange(product, brand);
  // Same id+size cart-line identity CartContext itself keys on (see lineKey there) --
  // a variant product isn't "in the cart" unless the SPECIFIC selected size is the
  // one already added, not just any size of this product.
  const cartLineSize = hasVariants ? chosenVariant?.size : undefined;
  const inCart = !isSoldOut && !isEnquiryOnly && (!hasVariants || !!chosenVariant)
    && cart.some(i => i.id === product.id && (i.size || undefined) === cartLineSize);
  const images = product.images || [];
  // Video (if any) rides along as one more gallery item, after the photos --
  // same thumbnail strip, same lightbox rail, just rendered as <video> instead
  // of <img> when it's the active slide.
  // Gallery order (photos + the optional video, mixed by the admin in Photos section -- see
  // src/utils/productMedia.js). The photo-only lightbox below maps its own index through
  // photoIndexFromMerged/mergedIndexFromPhoto, since it never shows the video itself.
  const hasVideo = !!product.video_url;
  const videoPos = clampVideoPosition(product.video_position, images.length);
  const media = buildProductMedia(images, product.video_url, videoPos);
  const activeMedia = media[activeImg];
  const lbIndex = Math.max(0, Math.min(images.length - 1, photoIndexFromMerged(activeImg, hasVideo, videoPos)));
  const pageUrl = typeof window !== 'undefined' ? window.location.href : '';

  // JSON.stringify never escapes a literal "<" -- a product name/description
  // containing a real "</script>" sequence would otherwise close this tag
  // early and let arbitrary HTML after it execute (the exact XSS class
  // already fixed once in api/product-share.js's redirect page). < is
  // a no-op for JSON parsing but can't prematurely close the tag.
  const productJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: [product.cat, product.origin].filter(Boolean).join(' — ') || undefined,
    image: images.length ? images : undefined,
    offers: {
      '@type': 'Offer',
      url: pageUrl,
      priceCurrency: 'INR',
      price: displayPriceWithShipping,
      availability: isSoldOut ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
    },
  };

  // Same payload the original Add to Cart button built -- shared now by "Add to Cart" and "Buy Now".
  function cartPayload() {
    return hasVariants
      ? withShippingCharge({ ...product, weight: chosenVariant.weight, dimensions: chosenVariant.dimensions, stock: chosenVariant.stock, size: chosenVariant.size }, chosenVariant.price)
      : withShippingCharge(product, product.price);
  }
  function handleAddToCart() {
    if (hasVariants && !chosenVariant) { toast.error('Please select an option.'); return false; }
    addToCart(cartPayload());
    return true;
  }
  // "Buy Now" = add this exact option to the cart, then go straight to the cart/checkout flow.
  function handleBuyNow() {
    if (handleAddToCart()) navigate('/cart');
  }

  // The primary action group. On mobile (<900px) this renders as the sticky bar above the bottom tab bar,
  // except for sold-out products, whose (taller) notify/enquire stack stays in the normal flow.
  const showEnquire = product.allow_enquiry !== false;
  const stickyBar = !isSoldOut;
  const waIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.5 3.5A11.8 11.8 0 0012 0a12 12 0 00-10.3 18L0 24l6.2-1.6A12 12 0 0024 12a11.8 11.8 0 00-3.5-8.5zM12 22a10 10 0 01-5.1-1.4l-.4-.2-3.7 1 1-3.6-.2-.4A10 10 0 1122 12a10 10 0 01-10 10zm5.5-7.5c-.3-.2-1.8-.9-2-1s-.5-.2-.7.2-.8 1-1 1.2-.4.2-.7.1a8.2 8.2 0 01-4.1-3.6c-.3-.6.3-.6.9-1.8.1-.2 0-.4 0-.5l-.9-2.1c-.2-.6-.5-.5-.7-.5h-.6a1.2 1.2 0 00-.9.4 3.7 3.7 0 00-1.1 2.7 6.4 6.4 0 001.4 3.4 14.6 14.6 0 005.6 4.9c2.1.9 2.9 1 3.9.8a3.3 3.3 0 002.2-1.6 2.7 2.7 0 00.2-1.6c-.1-.1-.3-.2-.6-.4z" /></svg>
  );
  // Enquiry-only products make WhatsApp the main action (solid green); everywhere else it is a secondary green outline.
  const enquireBtn = (
    <button type="button" className={`btn btn-full ${isEnquiryOnly ? 'btn-wa pp-wa-solid' : 'pp-wa'}`} onClick={() => handleEnquire(isSoldOut ? 'soldOut' : (isEnquiryOnly ? 'priceOnEnquiry' : 'inStock'))}>{waIcon}Enquire on WhatsApp</button>
  );

  const badges = productBadges(product);
  const crumbCat = product.cat ? (
    <>
      <span aria-hidden="true">›</span>
      <Link to={`/shop?category=${encodeURIComponent(product.cat)}`}>{product.cat}</Link>
    </>
  ) : null;

  const detailRows = [
    ['Category', product.cat],
    ['Material', product.material],
    ['Dimensions', displayDimensions],
    ['Weight', displayWeight],
    ['Brand / Make', product.origin],
  ].filter(([, v]) => v);

  const shareLinks = [
    { label: 'Share on WhatsApp', Icon: null, href: `https://wa.me/?text=${encodeURIComponent(`${product.name} ${pageUrl}`)}`, external: true },
    { label: 'Share on Facebook', Icon: FacebookIcon, href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}`, external: true },
    { label: 'Share on X', Icon: TwitterXIcon, href: `https://twitter.com/intent/tweet?url=${encodeURIComponent(pageUrl)}&text=${encodeURIComponent(product.name)}`, external: true },
    { label: 'Pin on Pinterest', Icon: PinterestIcon, href: product.pinterest_url || `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(pageUrl)}&media=${encodeURIComponent(images[0] || '')}&description=${encodeURIComponent(product.name)}`, external: true },
    { label: 'Share by email', Icon: EmailIcon, href: `mailto:?subject=${encodeURIComponent(product.name)}&body=${encodeURIComponent('Check out this product: ' + pageUrl)}`, external: false },
  ];

  const supportLinks = [
    { to: '/shipping-policy', icon: IC.truck, title: 'Shipping information', body: 'Delivery details and timelines' },
    { to: '/terms', icon: IC.returns, title: 'Returns & refunds', body: 'See our return eligibility and process' },
    { to: '/help', icon: IC.chat, title: 'Help Centre', body: 'Answers and support for your order' },
  ];
  const trust = [
    { t: 'Secure payments', icon: IC.lock },
    { t: 'Free delivery', icon: IC.truck },
    { t: 'Easy support', icon: IC.support },
  ];

  // Info tabs (pure UI state): Description only when the product has copy. The label/value details live in the
  // compact "Product Details" block beside the buy box, so they are no longer a tab.
  const hasDescription = !!(product.story || product.together);
  const tabs = [
    hasDescription && { id: 'desc', label: 'Description' },
    { id: 'ship', label: 'Shipping & returns' },
  ].filter(Boolean);
  const activeTab = tabs.some(t => t.id === infoTab) ? infoTab : tabs[0].id;
  function onTabKey(e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = tabs.findIndex(t => t.id === activeTab);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    setInfoTab(next.id);
    document.getElementById(`pp-tab-${next.id}`)?.focus();
  }

  return (
    <div key={id} className={`pp-page pp-fade-in${stickyBar ? ' pp-has-bar' : ''}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd).replace(/</g, '\\u003c') }} />
      <div className="bl-wrap pp-wrap">
        <nav className="bl-crumbs pp-crumbs" aria-label="Breadcrumb">
          <Link to="/">Home</Link>
          {crumbCat}
          <span aria-hidden="true">›</span>
          <span className="pp-crumb-cur" aria-current="page">{product.name}</span>
        </nav>

        <div className="pp-main">

          {/* GALLERY -- desktop: vertical thumbnail strip + large bordered image (sticky); mobile: full-width swipeable image with dots */}
          <div className="pp-gallery-col">
            <div className="pp-gallery">
              {/* Thumbnails (desktop) */}
              {media.length > 1 && (
                <div className="pp-thumbs no-scrollbar" role="tablist" aria-label="Product images">
                  {media.map((m, i) => (
                    <button key={i} type="button" role="tab" aria-selected={activeImg === i} aria-label={m.type === 'video' ? 'Show video' : `Show image ${i + 1}`} onClick={() => setActiveImg(i)}
                      className={`pp-thumb${activeImg === i ? ' is-on' : ''}`}
                    >
                      {m.type === 'video' ? (
                        <>
                          <video src={m.url.includes('#') ? m.url : `${m.url}#t=0.1`} preload="metadata" muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(31,42,40,.3)' }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                          </span>
                        </>
                      ) : (
                        <img src={thumb(m.url, 160)} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      )}
                    </button>
                  ))}
                </div>
              )}

              <div className="pp-stage-wrap">
                <div className="pp-stage" style={{ background: activeMedia?.type === 'video' ? '#000' : (product.bg || (activeMedia ? '#fff' : 'var(--primary-tint)')), cursor: (media.length && activeMedia?.type !== 'video') ? 'zoom-in' : 'default' }}
                  onClick={() => media.length > 0 && activeMedia?.type !== 'video' && setLightbox(true)}
                  onTouchStart={onTouchStart}
                  onTouchEnd={e => onTouchEnd(e, media.length)}
                >
                  {activeMedia?.type === 'video' ? (
                    <ProductVideo key={activeImg} url={activeMedia.url} />
                  ) : activeMedia ? (
                    <BlurImage key={activeImg} src={thumb(activeMedia.url, 1200)} alt={product.name} className="pp-img-fade" showBuffering style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-head)', fontWeight: 500, fontSize: 18, color: 'rgba(15,118,110,.45)', textAlign: 'center', padding: 32 }}>{product.name}</div>
                  )}
                  {media.length > 0 && activeMedia?.type !== 'video' && (
                    <span className="pp-zoom-hint" aria-hidden="true">
                      <Ico size={13} sw={2}>{IC.zoom}</Ico>
                      Click to zoom
                    </span>
                  )}
                </div>

                {/* Badges (top-left) */}
                {(badges.length > 0 || product.is_collectors_piece || isSoldOut) && (
                  <div className="pp-ribbons">
                    {badges.map((b, i) => <span key={i} className="badge badge-gold">{b}</span>)}
                    {product.is_collectors_piece && <span className="badge badge-gold">Top Pick</span>}
                    {isSoldOut && <span className="badge pp-badge-sold">Sold out</span>}
                  </div>
                )}

                {/* Wishlist + share (top-right): small bordered circles */}
                <div className="pp-float">
                  <button type="button" onClick={handleSave} className={`pp-fbtn pp-heart${saved ? ' is-on' : ''}`} title={saved ? 'Remove from saved' : 'Save for later'} aria-label={saved ? 'Remove from saved' : 'Save for later'} aria-pressed={saved}>
                    <Ico size={18} sw={2} fill={saved ? 'currentColor' : 'none'}>{IC.heart}</Ico>
                  </button>
                  <button type="button" onClick={() => setShareOpen(o => !o)} className="pp-fbtn" title="Share" aria-label="Share this product" aria-expanded={shareOpen}>
                    <Ico size={17} sw={2}>{IC.share}</Ico>
                  </button>
                </div>
                {shareOpen && (
                  <>
                    <button type="button" className="pp-scrim" tabIndex={-1} aria-label="Close share options" onClick={() => setShareOpen(false)} />
                    <div className="pp-share-pop" role="group" aria-label="Share this product">
                      <div className="pp-share-t">Share this product</div>
                      <div className="pp-share-btns">
                        {shareLinks.map(({ label, Icon, href, external }) => (
                          <a key={label} href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined} className="pp-share-btn" aria-label={label} title={label} onClick={() => setShareOpen(false)}>
                            {Icon ? <Icon width={18} height={18} /> : waIcon}
                          </a>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {/* Dots (mobile) */}
                {media.length > 1 && (
                  <div className="pp-pager">
                    <div className="pp-pager-in">
                      {media.map((m, i) => (
                        <button key={i} type="button" aria-label={`Go to image ${i + 1} of ${media.length}`} aria-current={activeImg === i} onClick={() => setActiveImg(i)} className={`pp-pg${activeImg === i ? ' is-on' : ''}`}><span /></button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* INFO -- desktop: one bordered buy box + flat bordered blocks; mobile: white sections separated by 8px grey gaps */}
          <div className="pp-info-col">

            <div className="pp-buybox">
              {/* (1) Name / category / price */}
              <section className="pp-sec pp-head" aria-label="Product summary">
                <h1 className="pp-title">{product.name}</h1>
                {product.subtitle && <div className="pp-subtitle">{product.subtitle}</div>}
                {product.cat && (
                  <div className="pp-chiprow">
                    <Link to={`/shop?category=${encodeURIComponent(product.cat)}`} className="bl-chip grey pp-catchip">{product.cat}</Link>
                  </div>
                )}

                <div className="pp-price">
                  {isSoldOut ? (
                    <div className="pp-price-row"><span className="pp-price-main pp-price-muted">Sold out</span></div>
                  ) : isEnquiryOnly ? (
                    <div className="pp-price-row"><span className="pp-price-main pp-price-enq">Price on enquiry</span></div>
                  ) : (
                    <>
                      <div className="pp-price-row">
                        <span className="pp-price-main">{fmt(displayPriceWithShipping)}</span>
                        {hasVariants && !chosenVariant && <span className="pp-from">Starting price</span>}
                        <span className="pp-free"><Ico size={15} sw={2}>{IC.truck}</Ico>Free Delivery</span>
                      </div>
                      <div className="pp-tax">Inclusive of all taxes</div>
                    </>
                  )}
                </div>
              </section>

              {/* (2) Options */}
              {hasVariants && (
                <section className="pp-sec pp-options" aria-label="Options">
                  <div className="pp-label" id="pp-variant-label">Select Size/Option{chosenVariant ? <b>: {chosenVariant.size}</b> : null}</div>
                  <div className="pp-chips" role="group" aria-labelledby="pp-variant-label">
                    {product.variants.map((v, i) => {
                      const sizeSoldOut = knownStock(v.stock) === 0;
                      const active = selectedVariantIdx === i;
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => !sizeSoldOut && setSelectedVariantIdx(i)}
                          disabled={sizeSoldOut}
                          aria-pressed={active}
                          className={`pp-chip${active ? ' is-on' : ''}`}
                        >{v.size}</button>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* (3) Actions -- on mobile the button row is the sticky bar above the bottom tab bar */}
              <section className="pp-actioncard" aria-label="Purchase options">
                {isSoldOut ? (
                  <div className="pp-actions-flow">
                    <button className="btn btn-full pp-soldbtn" disabled>Sold out</button>
                    <NotifyWhenAvailable product={product} size={chosenVariant?.size || null} />
                    {enquireBtn}
                  </div>
                ) : isEnquiryOnly ? (
                  <div className="pp-bar">{enquireBtn}</div>
                ) : inCart ? (
                  <>
                    <div className="pp-bar">
                      <button className="btn btn-gold" onClick={() => navigate('/cart')}>
                        <Ico size={18} sw={2.4}>{IC.check}</Ico>
                        Go to Cart
                      </button>
                    </div>
                    {showEnquire && <div className="pp-enquire">{enquireBtn}</div>}
                  </>
                ) : (
                  <>
                    <div className="pp-bar">
                      <button className="btn btn-outline" onClick={handleAddToCart}>
                        <Ico size={18} sw={2}>{IC.cart}</Ico>
                        Add to Cart
                      </button>
                      <button className="btn btn-gold" onClick={handleBuyNow}>
                        <Ico size={17} sw={2} fill="currentColor">{IC.bolt}</Ico>
                        Buy Now
                      </button>
                    </div>
                    {showEnquire && <div className="pp-enquire">{enquireBtn}</div>}
                  </>
                )}
              </section>
            </div>

            {/* (4) Product details: compact label/value rows */}
            {detailRows.length > 0 && (
              <section className="pp-sec pp-box pp-details" aria-label="Product details">
                <h2 className="pp-h2">Product Details</h2>
                <dl className="pp-dl">
                  {detailRows.map(([k, v]) => (
                    <div key={k} className="pp-dl-row">
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            {/* (5) Delivery */}
            {!isSoldOut && (
              <section className="pp-sec pp-box pp-delcard" aria-label="Delivery">
                <div className="pp-del-top">
                  <span className="pp-ico"><Ico size={22} sw={1.7}>{IC.truck}</Ico></span>
                  <div style={{ minWidth: 0 }}>
                    <div className="pp-h3">Estimated delivery</div>
                    <div className="pp-del-text">{delivery.daysLabel} <span>({delivery.label}) in India</span></div>
                  </div>
                </div>
                <ol className="pp-steps" aria-label="Delivery timeline">
                  <li className="pp-step is-done"><span className="pp-st-dot" /><b>Ordered</b><small>Today</small></li>
                  <li className="pp-step"><span className="pp-st-dot" /><b>Shipped</b><small>Packed &amp; dispatched</small></li>
                  <li className="pp-step"><span className="pp-st-dot" /><b>Delivered</b><small>{delivery.label}</small></li>
                </ol>
                <div className="pp-del-chips">
                  <span className={`bl-chip ${product.fulfillment_type === 'made_to_order' ? 'gold' : ''}`}>{product.fulfillment_type === 'made_to_order' ? 'Made to order' : 'Ready to ship'}</span>
                  <span className="bl-chip grey">Shipping included within India</span>
                </div>
                <div className="pp-del-note">For international orders, please enquire on WhatsApp.</div>
              </section>
            )}

            {/* (6) Trust row */}
            <div className="pp-sec pp-box pp-trust" role="group" aria-label="Why shop with us">
              {trust.map(({ t, icon }) => (
                <div key={t} className="pp-trust-item">
                  <span className="pp-trust-ico"><Ico size={20} sw={1.7}>{icon}</Ico></span>
                  <span className="pp-trust-t">{t}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* DESCRIPTION / SHIPPING & RETURNS -- underline tabs */}
        <section className="pp-tabs-card" aria-label="Product information">
          <div className="pp-tabs no-scrollbar" role="tablist" aria-label="Product information" onKeyDown={onTabKey}>
            {tabs.map(t => (
              <button key={t.id} type="button" role="tab" id={`pp-tab-${t.id}`} aria-selected={activeTab === t.id} aria-controls={activeTab === t.id ? `pp-panel-${t.id}` : undefined} tabIndex={activeTab === t.id ? 0 : -1}
                className={`pp-tab${activeTab === t.id ? ' is-on' : ''}`} onClick={() => setInfoTab(t.id)}>{t.label}</button>
            ))}
          </div>

          <div className="pp-panel" role="tabpanel" id={`pp-panel-${activeTab}`} aria-labelledby={`pp-tab-${activeTab}`}>
            {activeTab === 'desc' && (
              <div className="pp-desc">
                {product.story && <p className="pp-body" style={{ whiteSpace: 'pre-line' }}>{product.story}</p>}
                {product.together && (
                  <p className="pp-body" style={{ whiteSpace: 'pre-line', ...(product.story ? { marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' } : null) }}>{product.together}</p>
                )}
              </div>
            )}

            {activeTab === 'ship' && (
              <div>
                <div className="pp-ship-hero">
                  <span className="pp-ico"><Ico size={22} sw={1.7}>{IC.truck}</Ico></span>
                  <div style={{ minWidth: 0 }}>
                    <div className="pp-h3">Free delivery on every order</div>
                    <p className="pp-ship-p">
                      Shipping is included within India{!isSoldOut ? <>. Estimated delivery: {delivery.daysLabel} ({delivery.label}).</> : '.'} For international orders, please enquire on WhatsApp.
                    </p>
                  </div>
                </div>
                <div className="pp-shiplinks">
                  {supportLinks.map(({ to, icon, title, body }) => (
                    <Link key={to} to={to} className="pp-shiplink">
                      <span className="pp-ico"><Ico size={20} sw={1.7}>{icon}</Ico></span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="pp-sl-t">{title}</span>
                        <span className="pp-sl-d">{body}</span>
                      </span>
                      <span aria-hidden="true" className="pp-sl-go">›</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* SIMILAR PRODUCTS -- plain product grid */}
      {related.length > 0 && (
        <section className="pp-related" aria-label="Similar products">
          <div className="bl-wrap bl-sec">
            <div className="bl-sec-head">
              <div>
                <h2 className="bl-sec-title">Similar products</h2>
                <div className="bl-sec-sub">
                  {relatedTier === 'cat' && <>More from {product.cat}</>}
                  {relatedTier === 'group' && <>More in {relatedGroupLabel}</>}
                  {relatedTier === 'recent' && <>Fresh picks from the store</>}
                </div>
              </div>
              <Link to="/shop" className="bl-link-all">View all <span aria-hidden="true">›</span></Link>
            </div>
            <div className="bl-grid pp-rel-grid">
              {related.map(p => <ProductCard key={p.id} product={p} />)}
            </div>
          </div>
        </section>
      )}

      {/* LIGHTBOX — portaled to document.body so it always renders above the fixed navbar,
          regardless of any transform/animation on this page's own ancestors */}
      {lightbox && images.length > 0 && createPortal((
        <div className="pp-lightbox" role="dialog" aria-modal="true" aria-label={`${product.name} — image viewer`} style={{ position: 'fixed', inset: 0, background: '#fff', zIndex: 9999, display: 'flex', touchAction: 'none' }}
          onClick={() => setLightbox(false)}
        >
          <button ref={lightboxCloseRef} onClick={() => setLightbox(false)} aria-label="Close" style={{ position: 'absolute', top: 16, right: 18, width: 40, height: 40, background: '#fff', border: '1px solid var(--border)', borderRadius: '50%', color: 'var(--text)', fontSize: 24, cursor: 'pointer', zIndex: 10001, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>

          {/* THUMBNAIL RAIL */}
          {images.length > 1 && (
            <div className="pp-lightbox-rail" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 20, overflowY: 'auto', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
              {images.map((url, i) => (
                <div key={i} onClick={() => setActiveImg(mergedIndexFromPhoto(i, hasVideo, videoPos))}
                  style={{ width: 64, height: 64, flexShrink: 0, cursor: 'pointer', borderRadius: 4, overflow: 'hidden', border: `1px solid ${lbIndex === i ? 'var(--primary)' : 'var(--border)'}`, boxShadow: lbIndex === i ? '0 0 0 1px var(--primary)' : 'none', opacity: lbIndex === i ? 1 : 0.7, transition: 'opacity .2s' }}
                >
                  <img src={thumb(url, 140)} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              ))}
            </div>
          )}

          {/* MAIN IMAGE */}
          <div className="pp-lightbox-main" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}
            onTouchStart={onTouchStart}
            onTouchEnd={e => {
              // Photo-only swipe: the lightbox never shows the video, so this cycles lbIndex (not the
              // combined gallery index) and maps back through the video's position, wherever it sits.
              if (touchX.current === null || images.length < 2 || zoomScale > 1 || multiTouchRef.current) return;
              const dx = e.changedTouches[0].clientX - touchX.current;
              if (Math.abs(dx) > 40) {
                const nextPhoto = dx < 0 ? (lbIndex + 1) % images.length : (lbIndex - 1 + images.length) % images.length;
                setActiveImg(mergedIndexFromPhoto(nextPhoto, hasVideo, videoPos));
              }
              touchX.current = null;
            }}
          >
            <div style={{ maxWidth: '85%', maxHeight: '85vh', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', touchAction: 'none' }}
              onClick={e => e.stopPropagation()}
              onTouchStart={onZoomTouchStart}
              onTouchMove={onZoomTouchMove}
              onTouchEnd={onZoomTouchEnd}
            >
              <BlurImage key={activeImg} src={zoomScale > 1 ? images[lbIndex] : thumb(images[lbIndex], 1200)} alt={product.name} className="pp-img-fade"
                onClick={handleImageTap}
                style={{
                  maxWidth: '100%', maxHeight: '85vh',
                  objectFit: 'contain', display: 'block', cursor: zoomScale > 1 ? 'zoom-out' : 'zoom-in',
                  transform: `scale(${zoomScale}) translate(${panOffset.x / zoomScale}px, ${panOffset.y / zoomScale}px)`,
                  transformOrigin: 'center center',
                  transition: 'transform .15s ease-out',
                }} />
            </div>
            {images.length > 1 && zoomScale === 1 && (
              <>
                <button onClick={e => { e.stopPropagation(); setActiveImg(mergedIndexFromPhoto((lbIndex - 1 + images.length) % images.length, hasVideo, videoPos)); }} aria-label="Previous image"
                  style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', background: '#fff', border: '1px solid var(--border)', color: 'var(--text)', width: 40, height: 40, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%' }}>‹</button>
                <button onClick={e => { e.stopPropagation(); setActiveImg(mergedIndexFromPhoto((lbIndex + 1) % images.length, hasVideo, videoPos)); }} aria-label="Next image"
                  style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', background: '#fff', border: '1px solid var(--border)', color: 'var(--text)', width: 40, height: 40, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%' }}>›</button>
              </>
            )}
            <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', fontWeight: 500, fontSize: 13, color: 'var(--text-muted)', background: '#fff', border: '1px solid var(--border)', padding: '3px 10px', borderRadius: 4 }}>
              {lbIndex + 1} / {images.length}
            </div>
          </div>
        </div>
      ), document.body)}

      <style>{`
        @keyframes ppFade { from { opacity:0; } to { opacity:1; } }
        /* Opacity only (no transform): a lingering transform would become the containing block for the
           fixed mobile action bar below and pin it to the page instead of the viewport. */
        .pp-fade-in { animation: ppFade .25s ease both; }
        .pp-img-fade { animation: ppFade .25s ease both; }

        .pp-page { padding-top: var(--hdr-h); background: var(--bg); min-height: 100vh; color: var(--text); }
        /* room for the sticky bar (the body already pads for the bottom tab bar) */
        .pp-page.pp-has-bar { padding-bottom: 72px; }
        @supports selector(:has(*)) {
          @media (max-width: 899px) {
            .pp-page.pp-has-bar { padding-bottom: 0; }
            body:has(.pp-has-bar) { padding-bottom: calc(var(--bottom-nav-h) + env(safe-area-inset-bottom, 0px) + 64px); }
          }
        }

        /* ── breadcrumb ── */
        .pp-wrap.bl-wrap { padding: 0; }
        nav.pp-crumbs { margin: 0; padding: 10px 14px; background: #fff; border-bottom: 1px solid var(--border); flex-wrap: nowrap; overflow: hidden; white-space: nowrap; font-size: 12.5px; color: var(--text-muted); }
        .pp-crumbs > a, .pp-crumbs > span { flex-shrink: 0; }
        .pp-crumbs > a:nth-child(3) { flex-shrink: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
        .pp-crumbs .pp-crumb-cur { flex-shrink: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--text); }

        /* ── layout (mobile first) ── */
        .pp-main { display: grid; grid-template-columns: minmax(0, 1fr); }

        /* ── gallery ── */
        .pp-gallery-col { background: #fff; min-width: 0; }
        .pp-gallery { display: flex; flex-direction: column; }
        .pp-stage-wrap { position: relative; min-width: 0; }
        .pp-stage { position: relative; aspect-ratio: 1 / 1; overflow: hidden; }
        @media (min-width: 600px) and (max-width: 899px) { .pp-stage { aspect-ratio: 4 / 3; } }
        .pp-zoom-hint { display: none; }
        .pp-thumbs { display: none; }
        .pp-ribbons { position: absolute; top: 10px; left: 10px; z-index: 3; display: flex; flex-direction: column; gap: 4px; align-items: flex-start; pointer-events: none; max-width: calc(100% - 70px); }
        .pp-badge-sold { background: var(--ink); color: #fff; }
        .pp-float { position: absolute; top: 10px; right: 10px; z-index: 7; display: flex; flex-direction: column; gap: 8px; }
        .pp-fbtn { width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--border); background: #fff; color: #6C7876; display: flex; align-items: center; justify-content: center; padding: 0; transition: color .15s, border-color .15s; }
        .pp-heart.is-on { color: var(--coral); border-color: #F6C9C4; }
        .pp-scrim { position: fixed; inset: 0; z-index: 5; background: transparent; border: 0; padding: 0; cursor: default; }
        .pp-share-pop { position: absolute; top: 100px; right: 10px; z-index: 8; background: #fff; border-radius: 8px; padding: 12px; box-shadow: var(--shadow-md); border: 1px solid var(--border); animation: ppFade .15s ease both; max-width: calc(100% - 20px); }
        .pp-share-t { font-weight: 500; font-size: 13px; color: var(--text); margin-bottom: 8px; }
        .pp-share-btns { display: flex; gap: 8px; flex-wrap: wrap; }
        .pp-share-btn { width: 38px; height: 38px; border-radius: 6px; border: 1px solid var(--border); background: #fff; color: var(--primary); display: flex; align-items: center; justify-content: center; transition: background .15s, color .15s; }
        .pp-pager { display: flex; justify-content: center; padding: 6px 0 10px; }
        .pp-pager-in { display: inline-flex; align-items: center; }
        .pp-pg { width: 22px; height: 24px; display: flex; align-items: center; justify-content: center; background: none; border: none; padding: 0; }
        .pp-pg span { display: block; width: 6px; height: 6px; border-radius: 3px; background: #C5CFCD; transition: width .2s, background .2s; }
        .pp-pg.is-on span { width: 16px; background: var(--primary); }

        /* ── info column: mobile = white sections separated by 8px grey gaps ── */
        .pp-info-col { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; min-width: 0; }
        .pp-buybox { display: contents; }
        .pp-sec { background: #fff; padding: 14px; min-width: 0; }
        .pp-actioncard { display: contents; }

        .pp-title { font-family: var(--font-head); font-weight: 500; font-size: 20px; line-height: 1.35; letter-spacing: 0; color: var(--text); margin: 0; overflow-wrap: anywhere; }
        .pp-subtitle { font-size: 14px; color: var(--text-muted); margin-top: 4px; line-height: 1.5; }
        .pp-chiprow { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
        .pp-catchip { font-size: 12px; padding: 3px 9px; text-decoration: none; transition: background .15s, color .15s; }
        .pp-price { margin-top: 12px; }
        .pp-price-row { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 12px; }
        .pp-price-main { font-family: var(--font-head); font-weight: 600; font-size: 26px; line-height: 1.15; letter-spacing: 0; color: #1F2A28; }
        .pp-price-muted { color: var(--text-muted); font-size: 22px; }
        .pp-price-enq { font-size: 20px; }
        .pp-from { font-size: 13px; font-weight: 400; color: var(--text-muted); }
        .pp-free { display: inline-flex; align-items: center; gap: 5px; color: var(--success); font-weight: 500; font-size: 13px; white-space: nowrap; }
        .pp-tax { font-size: 12px; color: var(--text-muted); margin-top: 3px; }

        .pp-label { font-family: var(--font-head); font-weight: 500; font-size: 14px; color: var(--text); margin-bottom: 10px; }
        .pp-label b { font-weight: 600; }
        .pp-chips { display: flex; flex-wrap: wrap; gap: 8px; }
        .pp-chip { height: 40px; min-width: 48px; padding: 0 16px; border-radius: 4px; border: 1px solid #CDD6D4; background: #fff; color: var(--text); font-family: var(--font-body); font-size: 14px; font-weight: 500; transition: border-color .15s, background .15s, color .15s; }
        .pp-chip.is-on { border-color: var(--primary); background: var(--primary-tint); color: var(--primary-dark); box-shadow: inset 0 0 0 1px var(--primary); }
        .pp-chip:disabled { background: #F7F9F9; color: var(--text-muted); text-decoration: line-through; opacity: .55; cursor: not-allowed; }

        /* actions */
        .pp-bar { display: flex; gap: 10px; }
        .pp-bar .btn { flex: 1; min-width: 0; min-height: 46px; font-size: 14px; font-weight: 600; padding: 10px 12px; }
        .pp-enquire, .pp-actions-flow { background: #fff; padding: 12px 14px; }
        .pp-actions-flow { display: flex; flex-direction: column; gap: 10px; }
        .pp-wa { background: #F3FBF6; color: #0A6B34; border: 1px solid #1FA855; min-height: 44px; font-weight: 600; font-size: 14px; }
        .pp-wa-solid { min-height: 46px; font-weight: 600; font-size: 14px; }
        .pp-soldbtn { background: var(--bg-hover); color: var(--text-muted); border: 1px solid var(--border); min-height: 44px; font-weight: 600; }

        /* product details */
        .pp-h2 { font-family: var(--font-head); font-weight: 500; font-size: 16px; color: var(--text); margin: 0 0 6px; }
        .pp-h3 { font-family: var(--font-head); font-weight: 500; font-size: 14px; color: var(--text); }
        .pp-dl { margin: 0; }
        .pp-dl-row { display: grid; grid-template-columns: minmax(88px, 36%) minmax(0, 1fr); gap: 12px; padding: 9px 0; border-bottom: 1px solid #EEF2F1; font-size: 13.5px; line-height: 1.45; }
        .pp-dl-row:last-child { border-bottom: none; padding-bottom: 0; }
        .pp-dl dt { color: var(--text-muted); }
        .pp-dl dd { margin: 0; color: var(--text); overflow-wrap: anywhere; }

        /* delivery */
        .pp-del-top { display: flex; gap: 12px; align-items: flex-start; }
        .pp-ico { color: var(--primary); display: inline-flex; flex-shrink: 0; margin-top: 1px; }
        .pp-del-text { font-size: 13.5px; font-weight: 500; color: var(--text); margin-top: 2px; }
        .pp-del-text span { font-weight: 400; color: var(--text-muted); }
        .pp-steps { list-style: none; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); position: relative; margin-top: 16px; }
        .pp-steps::before { content: ''; position: absolute; top: 4px; left: 16.66%; right: 16.66%; height: 1px; background: var(--primary-border); }
        .pp-step { position: relative; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 2px; padding: 0 4px; }
        .pp-st-dot { position: relative; z-index: 1; width: 9px; height: 9px; border-radius: 50%; background: #fff; border: 1.5px solid var(--primary); margin-bottom: 8px; }
        .pp-step.is-done .pp-st-dot { background: var(--primary); }
        .pp-step b { font-size: 12.5px; font-weight: 500; color: var(--text); }
        .pp-step small { font-size: 12px; color: var(--text-muted); line-height: 1.3; overflow-wrap: anywhere; }
        .pp-del-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
        .pp-del-note { font-size: 12px; color: var(--text-muted); margin-top: 8px; line-height: 1.5; }

        /* trust row */
        .pp-trust { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
        .pp-trust-item { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; min-width: 0; }
        .pp-trust-ico { color: var(--primary); display: flex; }
        .pp-trust-t { font-size: 12px; color: #4B5755; line-height: 1.3; }

        /* tabs (underline) */
        .pp-tabs-card { background: #fff; margin-top: 8px; min-width: 0; }
        .pp-tabs { display: flex; gap: 24px; overflow-x: auto; padding: 0 14px; border-bottom: 1px solid var(--border); }
        .pp-tab { min-height: 46px; padding: 0 2px; background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -1px; font-family: var(--font-body); font-size: 14px; font-weight: 500; color: var(--text-muted); white-space: nowrap; transition: color .15s, border-color .15s; }
        .pp-tab.is-on { color: var(--primary); border-bottom-color: var(--primary); }
        .pp-panel { min-width: 0; padding: 16px 14px 20px; }
        .pp-body { font-size: 14px; line-height: 1.7; color: var(--text); margin: 0; max-width: 80ch; }
        .pp-ship-hero { display: flex; gap: 12px; align-items: flex-start; }
        .pp-ship-p { font-size: 13.5px; line-height: 1.6; color: var(--text-muted); margin: 3px 0 0; }
        .pp-shiplinks { margin-top: 14px; border-top: 1px solid var(--border); max-width: 720px; }
        .pp-shiplink { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border); text-decoration: none; }
        .pp-sl-t { display: block; font-weight: 500; font-size: 14px; color: var(--text); }
        .pp-sl-d { display: block; font-size: 12.5px; color: var(--text-muted); margin-top: 1px; }
        .pp-sl-go { color: var(--text-muted); font-size: 20px; line-height: 1; }

        /* similar products */
        .pp-related { background: #fff; margin-top: 8px; }
        @media (min-width: 640px) and (max-width: 1023px) { .pp-rel-grid > :nth-child(n+4) { display: none; } }

        @media (hover: hover) and (pointer: fine) {
          .pp-fbtn:hover { color: var(--primary); border-color: var(--primary); }
          .pp-heart:hover { color: var(--coral); border-color: var(--coral); }
          .pp-share-btn:hover { background: var(--primary-tint); color: var(--primary-dark); }
          .pp-chip:not(:disabled):not(.is-on):hover { border-color: var(--primary); color: var(--primary); }
          .pp-wa:hover { background: #E3F7EA; }
          .pp-catchip:hover { background: var(--primary-tint); color: var(--primary); }
          .pp-tab:not(.is-on):hover { color: var(--primary); }
          .pp-shiplink:hover .pp-sl-t { color: var(--primary); }
          .pp-thumb:not(.is-on):hover { border-color: #98A5A3; }
        }

        /* Lightbox */
        @media (max-width: 700px) {
          .pp-lightbox { flex-direction: column-reverse; }
          .pp-lightbox-rail { flex-direction: row; overflow-x: auto; overflow-y: visible; padding: 12px; }
        }

        /* ── MOBILE (<900px): sticky bottom bar sits flush above the bottom tab bar ── */
        @media (max-width: 899px) {
          .pp-bar { position: fixed; left: 0; right: 0; bottom: calc(var(--bottom-nav-h) + env(safe-area-inset-bottom, 0px)); z-index: 900; padding: 8px 12px; background: #fff; border-top: 1px solid var(--border); }
        }

        /* ── DESKTOP (>=900px): white page, thumbs + image on the left, bordered buy box on the right ── */
        @media (min-width: 900px) {
          .pp-page { background: #fff; }
          .pp-page.pp-has-bar { padding-bottom: 0; }
          .pp-wrap.bl-wrap { padding: 0 20px; }
          nav.pp-crumbs { padding: 16px 0 14px; background: none; border-bottom: none; }
          .pp-main { --pp-stage-max: min(600px, calc(100vh - var(--hdr-h) - 110px)); grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 36px; align-items: start; }

          .pp-gallery-col { background: none; position: sticky; top: calc(var(--hdr-h) + 16px); }
          .pp-gallery { flex-direction: row; gap: 12px; align-items: flex-start; }
          .pp-thumbs { display: flex; flex-direction: column; gap: 8px; width: 60px; flex-shrink: 0; max-height: var(--pp-stage-max); overflow-y: auto; }
          .pp-thumb { position: relative; width: 60px; height: 60px; flex-shrink: 0; padding: 0; overflow: hidden; border-radius: 4px; border: 1px solid var(--border); background: #fff; transition: border-color .15s; }
          .pp-thumb.is-on { border-color: var(--primary); box-shadow: 0 0 0 1px var(--primary); }
          .pp-stage-wrap { flex: 0 1 var(--pp-stage-max); min-width: 0; }
          .pp-stage { border: 1px solid var(--border); border-radius: 6px; }
          .pp-zoom-hint { position: absolute; right: 10px; bottom: 10px; display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border-radius: 4px; background: rgba(255,255,255,.94); border: 1px solid var(--border); color: var(--text-muted); font-size: 12px; font-weight: 400; pointer-events: none; }
          .pp-pager { display: none; }

          .pp-info-col { gap: 16px; margin-top: 0; }
          .pp-buybox { display: block; border: 1px solid var(--border); border-radius: 8px; padding: 22px 24px; }
          .pp-sec { background: none; padding: 0; }
          .pp-box { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 18px 24px; }
          .pp-options { margin-top: 20px; }
          .pp-actioncard { display: block; margin-top: 20px; }
          .pp-enquire, .pp-actions-flow { background: none; padding: 0; }
          .pp-enquire { margin-top: 10px; }
          .pp-title { font-size: 22px; }
          .pp-price { margin-top: 14px; }
          .pp-price-main { font-size: 28px; }
          .pp-price-muted { font-size: 24px; }
          .pp-price-enq { font-size: 22px; }
          .pp-bar .btn { min-height: 48px; font-size: 15px; }
          .pp-dl-row { grid-template-columns: 150px minmax(0, 1fr); }
          .pp-trust { padding: 14px 16px; gap: 0; }
          .pp-trust-item { flex-direction: row; justify-content: center; text-align: left; gap: 8px; padding: 0 8px; }
          .pp-trust-item + .pp-trust-item { border-left: 1px solid var(--border); }

          .pp-tabs-card { margin-top: 24px; border: 1px solid var(--border); border-radius: 8px; }
          .pp-tabs { padding: 0 24px; }
          .pp-panel { padding: 20px 24px 24px; }
          .pp-related { background: none; margin-top: 12px; }
        }
      `}</style>
    </div>
  );
}
