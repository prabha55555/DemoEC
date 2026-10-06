import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useCartActions, useCartData } from '../context/CartContext';
import { useBrand } from '../context/BrandContext';
import { useCatalog } from '../context/CatalogContext';
import {
  defaultSelection, findVariantBySelection, optionValueState, reconcileSelection, stockStatus, maxPurchasableQty,
  isVariantPurchasable, specRows,
} from '../utils/catalog';
import { fetchProduct, fetchProducts, fetchRelated } from '../utils/catalogApi';
import { getDeliveryRange } from '../utils/delivery';
import { shippingPromise, returnPolicyShort, returnWindowDays, codAvailable } from '../utils/storeCopy';
import { lookupPincode } from '../utils/indianAddress';
import { readRecentIds, pushRecentId } from '../utils/storefrontStorage';
import { usePageMeta } from '../utils/usePageMeta';
import { COMPANY, whatsappLink } from '../config/company';
import ProductGallery from '../components/ProductGallery';
import ProductReviews from '../components/ProductReviews';
import ProductShelf, { ProductRail, ShelfHead } from '../components/ProductShelf';
import { ProductGridSkeleton } from '../components/ProductCard';
import NotifyWhenAvailable from '../components/NotifyWhenAvailable';
import PriceBlock from '../components/PriceBlock';
import WishlistButton from '../components/WishlistButton';
import { WhatsAppIcon } from '../components/SocialIcons';
import toast from 'react-hot-toast';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const absUrl = (u) => (u && u.startsWith('/') ? `${COMPANY.website}${u}` : u);

// A colour option gets a small round swatch when its name is something the browser understands ("Navy", "Light Blue").
// The text is always shown too -- the swatch is only a hint.
function swatchFor(optionName, value) {
  if (!/colou?r/i.test(optionName) || typeof CSS === 'undefined' || !CSS.supports) return null;
  for (const c of [value, String(value).replace(/\s+/g, '')]) if (CSS.supports('color', c)) return c;
  return null;
}

const Ico = ({ children, size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
const I = {
  truck: <path d="M1 3h15v13H1zM16 8h4l3 3v5h-7V8zM5.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM18.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />,
  returns: <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8M3 3v5h5" />,
  cash: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></>,
  lock: <path d="M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5l8-3zM9 12l2 2 4-4" />,
  cart: <path d="M3 4h2l2.4 11.2a1 1 0 00.8.8h8.9a1 1 0 001-.8L20 8H6.2M9.5 20h.01M17 20h.01" />,
  bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  link: <path d="M10 13a5 5 0 007.07 0l3-3a5 5 0 00-7.07-7.07l-1.5 1.5M14 11a5 5 0 00-7.07 0l-3 3a5 5 0 007.07 7.07l1.5-1.5" />,
};

export default function ProductPage() {
  const { id } = useParams();
  // A new product id is a fresh page: every piece of state (selection, quantity, PIN result) starts over.
  return <ProductView key={id} id={id} />;
}

function ProductView({ id }) {
  const navigate = useNavigate();
  const { addVariantToCart, updateQty } = useCartActions();
  const { cart } = useCartData();
  const { brand } = useBrand();
  const catalog = useCatalog();

  const [status, setStatus] = useState('loading');       // loading | ready | missing | error
  const [data, setData] = useState(null);                 // { product, variants }
  const [selection, setSelection] = useState({});
  const [qty, setQty] = useState(1);
  const [reload, setReload] = useState(0);
  const [related, setRelated] = useState(null);           // null = loading
  const [recent, setRecent] = useState(null);
  const [pin, setPin] = useState(() => { try { return localStorage.getItem('tt_pin') || ''; } catch { return ''; } });
  const [pinBusy, setPinBusy] = useState(false);
  const [pinInfo, setPinInfo] = useState(null);           // { pin, city, state, verified, range } | { error }

  // ---- load the product (a draft or unknown id is "not found", never a half-empty page)
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    if (!UUID.test(id)) { setStatus('missing'); return undefined; }
    fetchProduct(id)
      .then((res) => {
        if (cancelled) return;
        if (!res || res.product.status !== 'active') { setStatus('missing'); return; }
        const variants = res.variants.filter(v => v.active !== false).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        setData({ product: res.product, variants });
        setSelection(defaultSelection(variants).selection);
        setStatus('ready');
      })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [id, reload]);

  const product = data?.product;
  const variants = useMemo(() => data?.variants || [], [data]);
  const optionTypes = useMemo(() => (Array.isArray(product?.option_types) ? product.option_types.filter(o => o?.name && Array.isArray(o.values) && o.values.length) : []), [product]);
  const variant = useMemo(() => findVariantBySelection(variants, selection) || variants[0] || null, [variants, selection]);

  // ---- recently viewed (ids only) and related products
  useEffect(() => {
    if (status !== 'ready') return undefined;
    let cancelled = false;
    const before = readRecentIds().filter(x => x !== id);
    pushRecentId(id);
    if (!before.length) { setRecent([]); return undefined; }
    fetchProducts({ ids: before, pageSize: 10 })
      .then(({ rows }) => { if (!cancelled) setRecent(before.map(x => rows.find(r => r.id === x)).filter(Boolean)); })
      .catch(() => { if (!cancelled) setRecent([]); });
    return () => { cancelled = true; };
  }, [status, id]);

  useEffect(() => {
    if (status !== 'ready' || catalog.loading) return undefined;
    let cancelled = false;
    fetchRelated(product, catalog.categories, 8)
      .then(r => { if (!cancelled) setRelated(r); })
      .catch(() => { if (!cancelled) setRelated([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line
  }, [status, catalog.loading, id]);

  // Picking another option starts over at one unit (the new option may have less stock).
  const variantId = variant?.id;
  useEffect(() => { setQty(1); }, [variantId]);

  // ---- derived buy-box facts
  const threshold = product?.low_stock_threshold ?? brand.low_stock_threshold;
  const stock = variant ? stockStatus(variant, threshold) : { state: 'out', text: 'Out of stock' };
  const canBuy = !!variant && isVariantPurchasable(variant);
  const maxQty = variant ? Math.max(1, maxPurchasableQty(variant, product)) : 1;
  const delivery = product ? getDeliveryRange(product, brand, pinInfo?.city) : null;

  const images = useMemo(() => {
    const own = Array.isArray(product?.images) ? product.images : [];
    // Pictures that belong to one variant ride along after the product's own, so choosing that variant can jump to it.
    const extra = [...new Set(variants.map(v => v.image_url).filter(u => u && !own.includes(u)))];
    return [...own, ...extra];
  }, [product, variants]);

  const chain = useMemo(() => (product ? catalog.chain(product.category_id).reverse() : []), [product, catalog]);
  const pageUrl = typeof window !== 'undefined' ? window.location.href : `${COMPANY.website}/product/${id}`;
  const description = product ? (product.meta_description || product.subtitle || String(product.description || '').replace(/\s+/g, ' ').trim().slice(0, 155) || `${[product.brand, product.name].filter(Boolean).join(' ')} at ${COMPANY.name}`) : undefined;

  usePageMeta({
    title: status === 'missing' ? 'Product not found' : (product?.meta_title || product?.name),
    description,
    path: `/product/${id}`,
    image: absUrl(images[0]),
  });

  // ---- actions
  const inCart = variant ? cart.find(l => l.variantId === variant.id) : null;
  // The cart adds ONE more unit when the line already exists, so top it up to the chosen quantity.
  function addToCart() {
    if (!canBuy) return false;
    const have = inCart?.qty || 0;
    if (!have) return addVariantToCart(product, variant, qty);
    const ok = addVariantToCart(product, variant, 1);
    const target = Math.min(have + qty, maxQty);
    if (ok && target > have + 1) updateQty(inCart, target);
    return ok;
  }
  function buyNow() {
    if ((inCart?.qty || 0) >= maxQty) { navigate('/checkout'); return; }   // already at the limit: just go and pay
    if (addToCart()) navigate('/checkout');
  }

  async function checkPin(e) {
    e.preventDefault();
    const code = pin.trim();
    if (!/^[1-9]\d{5}$/.test(code)) { setPinInfo({ error: 'Enter a valid 6-digit PIN code.' }); return; }
    setPinBusy(true);
    const info = await lookupPincode(code);      // null when unknown or the lookup service is unreachable
    setPinBusy(false);
    try { localStorage.setItem('tt_pin', code); } catch { /* not remembered */ }
    setPinInfo({ pin: code, city: info?.city || '', state: info?.state || '', verified: !!info });
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(pageUrl); toast.success('Link copied'); }
    catch { toast.error('Could not copy the link.'); }
  }

  function scrollToReviews(e) {
    e.preventDefault();
    document.getElementById('reviews')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---- states other than a loaded product
  if (status === 'loading') {
    return (
      <div className="pp-page" aria-busy="true">
        <div className="bl-wrap pp-wrap">
          <div className="pp-main pp-main-skel">
            <div className="pp-stage bl-skel" />
            <div className="pp-skel-info">
              <div className="bl-skel-line" style={{ width: '30%' }} /><div className="bl-skel-line lg" style={{ width: '80%' }} />
              <div className="bl-skel-line lg" style={{ width: '35%', marginTop: 18 }} /><div className="bl-skel-line" style={{ width: '50%', marginTop: 18 }} />
              <div className="bl-skel-line lg" style={{ width: '100%', marginTop: 22, height: 44 }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="pp-page"><div className="bl-wrap bl-empty" role="alert" style={{ minHeight: '50vh', justifyContent: 'center' }}>
        <h1 className="pp-h2">We couldn’t load this product</h1>
        <p>Check your connection and try again.</p>
        <button type="button" className="btn btn-gold" onClick={() => setReload(n => n + 1)}>Try again</button>
      </div></div>
    );
  }

  if (status === 'missing') {
    return (
      <div className="pp-page">
        <div className="bl-wrap bl-empty" style={{ paddingTop: 48 }}>
          <h1 className="pp-h2">This product isn’t available</h1>
          <p>It may have been removed or the link is incorrect. Here are some things you might like.</p>
          <div className="bl-empty-actions"><Link to="/shop" className="btn btn-gold">Browse all products</Link></div>
        </div>
        <ProductShelf title="Popular right now" query={{ sort: 'popular' }} to="/shop" />
      </div>
    );
  }

  // ---- the page
  const hasOptions = optionTypes.length > 0;
  const rated = Number(product.rating_count) > 0 && Number(product.rating_avg) > 0;
  const highlights = (Array.isArray(product.highlights) ? product.highlights : []).map(h => String(h).trim()).filter(Boolean);
  const specs = (() => {
    const rows = [];
    if (product.brand) rows.push({ key: 'brand', label: 'Brand', value: product.brand });
    rows.push(...specRows(product, catalog.categories));
    const has = (l) => rows.some(r => r.label.toLowerCase() === l);
    if (Number(product.weight_g) > 0 && !has('weight')) rows.push({ key: 'weight_g', label: 'Weight', value: `${Number(product.weight_g)} g` });
    const dims = [product.length_cm, product.width_cm, product.height_cm].map(Number);
    if (dims.every(d => d > 0) && !has('dimensions')) rows.push({ key: 'dims', label: 'Dimensions', value: `${dims.join(' × ')} cm` });
    return rows;
  })();
  const merch = String(product.badge || '').split('|')[0].trim();
  const returnDays = returnWindowDays(product, brand);
  const cod = codAvailable(brand, [product]);

  const productLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description,
    image: images.length ? images.map(absUrl) : undefined,
    sku: variant?.sku || product.product_number || undefined,
    brand: product.brand ? { '@type': 'Brand', name: product.brand } : undefined,
    offers: variant ? {
      '@type': 'Offer',
      url: `${COMPANY.website}/product/${id}`,
      priceCurrency: 'INR',
      price: Number(variant.price),
      availability: canBuy ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: 'IN',
        returnPolicyCategory: returnDays > 0 ? 'https://schema.org/MerchantReturnFiniteReturnWindow' : 'https://schema.org/MerchantReturnNotPermitted',
        ...(returnDays > 0 ? { merchantReturnDays: returnDays } : {}),
        merchantReturnLink: `${COMPANY.website}/returns-policy`,
      },
    } : undefined,
    aggregateRating: rated ? { '@type': 'AggregateRating', ratingValue: Number(product.rating_avg), reviewCount: Number(product.rating_count) } : undefined,
  };
  const crumbItems = [{ name: 'Home', path: '/' }, ...chain.map(c => ({ name: c.name, path: `/category/${c.slug}` })), { name: product.name, path: `/product/${id}` }];
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbItems.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: `${COMPANY.website}${c.path}` })),
  };
  // JSON.stringify never escapes "<": a name containing "</script>" would end this tag early, so it is escaped.
  const ld = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

  return (
    <div className={`pp-page pp-fade-in${canBuy ? ' pp-has-bar' : ''}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(productLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(breadcrumbLd) }} />

      <div className="bl-wrap pp-wrap">
        <nav className="bl-crumbs pp-crumbs" aria-label="Breadcrumb">
          <Link to="/">Home</Link>
          {chain.map(c => <React.Fragment key={c.id}><span aria-hidden="true">›</span><Link to={`/category/${c.slug}`}>{c.name}</Link></React.Fragment>)}
          <span aria-hidden="true">›</span>
          <span className="pp-crumb-cur" aria-current="page">{product.name}</span>
        </nav>

        <div className="pp-main">
          <div className="pp-gallery-col">
            <ProductGallery name={product.name} images={images} videoUrl={product.video_url} videoPosition={product.video_position} focusImage={variant?.image_url || null}>
              {(merch || !canBuy) && (
                <div className="pp-ribbons">
                  {merch && <span className="badge badge-gold">{merch}</span>}
                  {!canBuy && <span className="badge pp-badge-sold">Out of stock</span>}
                </div>
              )}
              <div className="pp-float"><WishlistButton productId={product.id} className="pp-fbtn pp-heart" size={18} /></div>
            </ProductGallery>
          </div>

          <div className="pp-info-col">
            <div className="pp-buybox">
              {/* summary */}
              <section className="pp-sec" aria-label="Product summary">
                {product.brand && <Link to={`/shop?brand=${encodeURIComponent(product.brand)}`} className="pp-brand">{product.brand}</Link>}
                <h1 className="pp-title">{product.name}</h1>
                {product.subtitle && <div className="pp-subtitle">{product.subtitle}</div>}
                {rated && (
                  <a href="#reviews" onClick={scrollToReviews} className="pp-ratinglink">
                    <span className="pp-ratingpill">{Number(product.rating_avg).toFixed(1)} ★</span>
                    <span>{Number(product.rating_count).toLocaleString('en-IN')} {Number(product.rating_count) === 1 ? 'rating' : 'ratings'}</span>
                  </a>
                )}
                <div className="pp-price">
                  {variant && <PriceBlock price={variant.price} mrp={variant.mrp} size="lg" detail />}
                </div>
              </section>

              {/* one group per option type (Size, Colour ...) */}
              {hasOptions && optionTypes.map(o => (
                <section key={o.name} className="pp-sec pp-options" aria-label={o.name}>
                  <div className="pp-label" id={`opt-${o.name}`}>{o.name}{selection[o.name] ? <b>: {selection[o.name]}</b> : null}</div>
                  <div className="pp-chips" role="group" aria-labelledby={`opt-${o.name}`}>
                    {o.values.map(v => {
                      const state = optionValueState(variants, o.name, v, selection);
                      const on = String(selection[o.name]) === String(v);
                      const swatch = swatchFor(o.name, v);
                      return (
                        <button key={v} type="button" disabled={state === 'invalid'} aria-pressed={on}
                          className={`pp-chip${on ? ' is-on' : ''}${state === 'soldout' ? ' is-sold' : ''}`}
                          title={state === 'soldout' ? `${v} — out of stock` : state === 'invalid' ? `${v} — not available with your other choices` : v}
                          onClick={() => setSelection(reconcileSelection(variants, o.name, v, selection))}>
                          {swatch && <span className="pp-swatch" style={{ background: swatch }} aria-hidden="true" />}
                          {v}
                          {state === 'soldout' && <span className="sr-only"> (out of stock)</span>}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}

              {/* stock, quantity, actions */}
              <section className="pp-sec pp-buy" aria-label="Purchase options">
                <div className="pp-stockrow">
                  <span className={`pp-stock is-${stock.state}`} role="status">{stock.text}</span>
                  {variant?.sku && <span className="pp-sku">SKU: {variant.sku}</span>}
                </div>

                {canBuy ? (
                  <>
                    <div className="pp-qty">
                      <span id="pp-qty-l">Quantity</span>
                      <div className="pp-stepper" role="group" aria-labelledby="pp-qty-l">
                        <button type="button" onClick={() => setQty(q => Math.max(1, q - 1))} disabled={qty <= 1} aria-label="Decrease quantity">−</button>
                        <output aria-live="polite">{qty}</output>
                        <button type="button" onClick={() => setQty(q => Math.min(maxQty, q + 1))} disabled={qty >= maxQty} aria-label="Increase quantity">+</button>
                      </div>
                      {qty >= maxQty && maxQty > 1 && <span className="pp-qty-note">Maximum per order</span>}
                    </div>
                    <div className="pp-bar">
                      <button type="button" className="btn btn-outline" onClick={addToCart}><Ico size={18}>{I.cart}</Ico>Add to cart</button>
                      <button type="button" className="btn btn-sun" onClick={buyNow}><Ico size={17}>{I.bolt}</Ico>Buy now</button>
                    </div>
                    {inCart && <div className="pp-incart">{inCart.qty} in your cart · <Link to="/cart">View cart</Link></div>}
                  </>
                ) : (
                  <div className="pp-unavail">
                    <button type="button" className="btn btn-full pp-soldbtn" disabled>Out of stock</button>
                    <p className="pp-reason">{hasOptions && variant ? `${variant.label} is out of stock. Choose another option or get notified.` : 'This product is currently out of stock.'}</p>
                    {variant && <NotifyWhenAvailable product={product} variant={variant} />}
                  </div>
                )}
              </section>

              {/* delivery */}
              <section className="pp-sec pp-delivery" aria-label="Delivery and returns">
                <form className="pp-pin" onSubmit={checkPin}>
                  <label htmlFor="pp-pin" className="pp-label">Delivery</label>
                  <div className="pp-pin-row">
                    <input id="pp-pin" inputMode="numeric" autoComplete="postal-code" maxLength={6} placeholder="Enter PIN code" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} />
                    <button type="submit" className="btn btn-outline btn-sm" disabled={pinBusy}>{pinBusy ? 'Checking…' : 'Check'}</button>
                  </div>
                  {pinInfo?.error && <div className="form-error" role="alert">{pinInfo.error}</div>}
                </form>
                {delivery && canBuy && (
                  <div className="pp-line" role="status">
                    <Ico size={20}>{I.truck}</Ico>
                    <div>
                      <b>Delivery by {delivery.label}</b>
                      <span>
                        {pinInfo && !pinInfo.error
                          ? (pinInfo.verified ? ` to ${pinInfo.city}${pinInfo.state ? `, ${pinInfo.state}` : ''} (${pin})` : ` — we could not look up ${pinInfo.pin} just now, so this is our standard estimate`)
                          : ` · usually ${delivery.daysLabel}`}
                      </span>
                    </div>
                  </div>
                )}
                <div className="pp-line">
                  <Ico size={20}>{I.lock}</Ico>
                  <div><b>{product.free_shipping ? 'Free delivery on this item' : shippingPromise(brand)}</b><span> · Secure online payments</span></div>
                </div>
                {cod && <div className="pp-line"><Ico size={20}>{I.cash}</Ico><div><b>Cash on Delivery available</b></div></div>}
                <div className="pp-line">
                  <Ico size={20}>{I.returns}</Ico>
                  <div><b>{returnPolicyShort(product, brand)}</b>{' '}<Link to="/returns-policy" className="pp-link">Returns policy</Link></div>
                </div>
              </section>

              {highlights.length > 0 && (
                <section className="pp-sec pp-hl" aria-label="Highlights">
                  <h2 className="pp-h3">Highlights</h2>
                  <ul className="pp-highlights">{highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>
                </section>
              )}

              <section className="pp-sec pp-share" aria-label="Share">
                <span>Share</span>
                <button type="button" className="pp-sharebtn" onClick={copyLink}><Ico size={16}>{I.link}</Ico>Copy link</button>
                <a className="pp-sharebtn" href={`https://wa.me/?text=${encodeURIComponent(`${product.name} ${pageUrl}`)}`} target="_blank" rel="noreferrer"><WhatsAppIcon width={16} height={16} aria-hidden="true" />WhatsApp</a>
                <a className="pp-sharebtn pp-help" href={whatsappLink(`Hi, I have a question about "${product.name}" ${pageUrl}`)} target="_blank" rel="noreferrer">Need help with this product?</a>
              </section>
            </div>
          </div>
        </div>

        {/* description, specifications, reviews */}
        {product.description && (
          <section className="pp-card" aria-labelledby="pp-desc-h">
            <h2 className="pp-h2" id="pp-desc-h">Product description</h2>
            <p className="pp-body">{product.description}</p>
          </section>
        )}
        {specs.length > 0 && (
          <section className="pp-card" aria-labelledby="pp-spec-h">
            <h2 className="pp-h2" id="pp-spec-h">Specifications</h2>
            <table className="pp-specs">
              <tbody>{specs.map(r => <tr key={r.key}><th scope="row">{r.label}</th><td>{r.value}</td></tr>)}</tbody>
            </table>
          </section>
        )}
        <ProductReviews product={product} />
      </div>

      {/* related + recently viewed */}
      <div className="bl-wrap bl-sec">
        {related === null ? (
          <><ShelfHead title="Similar products" /><ProductGridSkeleton count={6} className="bl-rail bl-rail-skel no-scrollbar" /></>
        ) : related.length > 0 && (
          <><ShelfHead title="Similar products" sub={chain.length ? `More from ${chain[chain.length - 1].name}` : undefined} to={chain.length ? `/category/${chain[chain.length - 1].slug}` : '/shop'} /><ProductRail products={related} /></>
        )}
      </div>
      {recent && recent.length > 0 && (
        <div className="bl-wrap bl-sec">
          <ShelfHead title="Recently viewed" />
          <ProductRail products={recent} />
        </div>
      )}
    </div>
  );
}
