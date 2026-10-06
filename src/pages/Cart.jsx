import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { useBrand } from '../context/BrandContext';
import { useWishlist } from '../context/WishlistContext';
import { discountPercent, formatMoney, lineKey } from '../utils/catalog';
import { shippingSummary } from '../utils/shipping';
import { shippingPromise } from '../utils/storeCopy';
import { checkoutTotals } from '../utils/checkoutRules';
import { getCartDeliveryRange } from '../utils/delivery';
import { thumb } from '../utils/thumbnail';
import { usePageMeta } from '../utils/usePageMeta';
import PriceSummary from '../components/PriceSummary';

const ico = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };

// Purely visual 3-step progress tracker (Cart -> Address -> Payment). `current` is 1-based.
function CartSteps({ current }) {
  const steps = ['Cart', 'Address', 'Payment'];
  return (
    <ol className="cart-steps" aria-label="Checkout progress">
      {steps.map((label, i) => {
        const n = i + 1;
        const state = n < current ? 'done' : n === current ? 'active' : '';
        return (
          <li key={label} className={`cart-step ${state}`} aria-current={n === current ? 'step' : undefined}>
            <span className="cart-step-dot">
              {n < current ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
              ) : n}
            </span>
            <span className="cart-step-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

// Plain teal outline cart for the empty state.
function EmptyCartArt() {
  return (
    <svg className="cart-empty-art" width="120" height="104" viewBox="0 0 120 104" fill="none" stroke="var(--primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 12h14l12 50h52l12-34H26" />
      <path d="M48 28v34M62 28v34M76 28v34" strokeWidth="2" opacity=".45" />
      <circle cx="42" cy="79" r="6" />
      <circle cx="80" cy="79" r="6" />
    </svg>
  );
}

// Why the + button is stopped: the stock left, or the per-order limit.
function capMessage(line, cap) {
  return line.stock !== null && line.stock !== undefined && line.stock <= cap ? `Only ${line.stock} available` : `Maximum ${cap} per order`;
}

function CartLine({ line, brand, saved, onQty, onRemove, onSave }) {
  const gift = !!line.isGiftCard;
  const cap = gift ? 1 : Math.max(1, Number(line.maxQty) || 10);
  const atCap = line.qty >= cap;
  const off = discountPercent(line.price, line.mrp);
  const delivery = !gift && !line.soldOut ? getCartDeliveryRange([line], brand, null) : null;
  const productHref = !gift && line.id ? `/product/${line.id}` : null;
  const img = line.image ? thumb(line.image, 220) : null;
  const imgEl = img ? <img src={img} alt={line.name} loading="lazy" decoding="async" /> : <span className="cart-item-noimg" aria-hidden="true">{gift ? '🎁' : ''}</span>;
  const name = line.name || 'Item';
  const lowStock = !gift && !line.soldOut && line.stock !== null && line.stock !== undefined && line.stock > 0 && line.stock <= (Number(brand?.low_stock_threshold) || 5);

  return (
    <article className={`cart-item${line.soldOut ? ' is-soldout' : ''}`} aria-label={name}>
      {productHref ? <Link to={productHref} className="cart-item-img" aria-label={`View ${name}`}>{imgEl}</Link> : <div className="cart-item-img">{imgEl}</div>}
      <div className="cart-item-body">
        {line.brand && !gift && <div className="cart-item-brand">{line.brand}</div>}
        <div className="cart-item-name">{productHref ? <Link to={productHref}>{name}</Link> : name}</div>
        {line.variantLabel && <div className="cart-item-variant">{line.variantLabel}</div>}
        {gift && <div className="cart-item-meta">Digital gift card — code emailed after payment{line.recipientName ? ` · for ${line.recipientName}` : ''}</div>}
        <div className="cart-item-price-row">
          <span className="cart-item-price">{formatMoney(line.price * line.qty)}</span>
          {Number(line.mrp) > Number(line.price) && (
            <>
              <s className="cart-item-mrp" aria-label={`MRP ${formatMoney(line.mrp * line.qty)}`}>{formatMoney(line.mrp * line.qty)}</s>
              {off > 0 && <span className="cart-item-off">{off}% off</span>}
            </>
          )}
          {line.qty > 1 && <span className="cart-item-unit">{formatMoney(line.price)} each</span>}
        </div>
        {line.soldOut && <div className="cart-item-alert" role="alert">Out of stock — remove to continue</div>}
        {lowStock && <div className="cart-item-low">Only {line.stock} left</div>}
        {delivery && <div className="cart-item-delivery">Delivery by {delivery.label}</div>}
      </div>
      <div className="cart-item-foot">
        {!gift && !line.soldOut && (
          <div className="cart-qty">
            <div className="cart-stepper" role="group" aria-label={`Quantity of ${name}`}>
              <button type="button" onClick={() => onQty(line, line.qty - 1)} aria-label={line.qty <= 1 ? `Remove ${name}` : 'Decrease quantity'}>−</button>
              <span aria-live="polite">{line.qty}</span>
              <button type="button" onClick={() => onQty(line, line.qty + 1)} disabled={atCap} aria-label="Increase quantity" title={atCap ? capMessage(line, cap) : undefined}>+</button>
            </div>
            {atCap && <span className="cart-cap" role="status">{capMessage(line, cap)}</span>}
          </div>
        )}
        {!gift && (
          <button type="button" className="cart-link" onClick={() => onSave(line)}>{saved ? 'Already saved — remove from cart' : 'Save for later'}</button>
        )}
        <button type="button" className="cart-link is-danger" onClick={() => onRemove(line)}>Remove</button>
      </div>
    </article>
  );
}

export default function Cart() {
  const { cart, removeFromCart, updateQty, refreshCart, hasUnavailable } = useCart();
  const { currentUser } = useAuth();
  const { brand } = useBrand();
  const wishlist = useWishlist();
  const navigate = useNavigate();
  const [refreshState, setRefreshState] = useState(cart.length ? 'checking' : 'idle'); // 'checking' | 'ok' | 'failed' | 'idle'
  usePageMeta({ title: 'My Cart', description: 'Review the items in your cart before checkout.' });

  // The cart lives in the browser and goes stale: re-check price/stock against the catalogue once when the page opens.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!cart.length) { setRefreshState('idle'); return; }
      const res = await refreshCart();
      if (alive) setRefreshState(res ? 'ok' : 'failed');
    })();
    return () => { alive = false; };
    // eslint-disable-next-line
  }, []);

  // Sold-out lines are not part of the price (the server refuses them); they only block checkout.
  const live = useMemo(() => cart.filter(l => !l.soldOut), [cart]);
  const totals = useMemo(() => checkoutTotals({ cart: live, brand, address: null }), [live, brand]);
  const { quote } = totals;
  const itemCount = live.reduce((s, i) => s + i.qty, 0);
  const headCount = cart.reduce((s, i) => s + i.qty, 0);
  const payable = totals.subtotal + (quote.free ? 0 : quote.fee);
  const canCheckout = live.length > 0 && !hasUnavailable;
  const blockReason = hasUnavailable ? 'Remove the out-of-stock items to continue.' : '';

  async function saveForLater(line) {
    if (!wishlist.has(line.id)) await wishlist.toggle(line.id);
    removeFromCart(line);
  }

  const goCheckout = () => { if (canCheckout) navigate('/checkout'); };

  const rows = [
    { key: 'price', label: `Price (${itemCount} ${itemCount === 1 ? 'item' : 'items'})`, value: formatMoney(totals.mrpTotal) },
    ...(totals.productSavings > 0 ? [{ key: 'disc', label: 'Discount', value: `− ${formatMoney(totals.productSavings)}`, tone: 'minus' }] : []),
    {
      key: 'ship', label: 'Delivery',
      value: quote.free ? 'Free' : shippingSummary({ shipping: quote, brand }),
      tone: quote.free ? 'free' : undefined,
      sub: !quote.free && quote.estimated ? 'Final charge depends on your PIN code' : undefined,
    },
  ];
  const hint = !quote.free && quote.threshold > 0 && quote.away > 0
    ? { text: <>Add <strong>{formatMoney(quote.away)}</strong> more for free delivery</>, away: quote.away, threshold: quote.threshold }
    : null;

  return (
    <div className="cart-page" style={{ paddingTop: 'var(--hdr-h)', minHeight: '80vh', background: 'var(--bg)' }}>
      <div className="bl-pagehead cart-head">
        <div className="bl-pagehead-inner">
          <div className="cart-head-row">
            <h1 className="cart-title">My Cart{cart.length > 0 ? ` (${headCount})` : ''}</h1>
            {cart.length > 0 && <CartSteps current={1} />}
          </div>
        </div>
      </div>

      <div className="bl-wrap cart-wrap">
        {cart.length === 0 ? (
          <div className="cart-empty">
            <EmptyCartArt />
            <div className="cart-empty-title">Your cart is empty</div>
            <p className="cart-empty-sub">Add items you love and they will wait for you here.</p>
            <button type="button" className="btn btn-gold" style={{ minWidth: 200 }} onClick={() => navigate('/shop')}>Continue shopping</button>
          </div>
        ) : (
          <div className="cart-grid">
            <div>
              {refreshState === 'checking' && <div className="cart-note" role="status"><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Checking prices and availability…</div>}
              {refreshState === 'failed' && <div className="cart-note is-warn" role="status">We could not refresh prices just now. Prices and stock are confirmed again at checkout.</div>}
              {hasUnavailable && <div className="cart-note is-error" role="alert">Some items are out of stock. Remove them to continue to checkout.</div>}
              <div className="cart-list">
                {cart.map(line => (
                  <CartLine key={lineKey(line) || line.id} line={line} brand={brand} saved={wishlist.has(line.id)}
                    onQty={updateQty} onRemove={removeFromCart} onSave={saveForLater} />
                ))}
                <div className="cart-continue">
                  <Link to="/shop" className="cart-ghost">
                    <svg {...ico} width="15" height="15"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
                    Continue shopping
                  </Link>
                </div>
              </div>
            </div>

            <div className="cart-side">
              <PriceSummary
                className="cart-summary"
                rows={rows}
                total={{ label: 'Total amount', value: formatMoney(payable) }}
                savings={totals.productSavings}
                hint={hint}
                footer={(
                  <>
                    <button type="button" className="btn btn-gold btn-full cart-cta cart-cta-desktop" onClick={goCheckout} disabled={!canCheckout} aria-describedby={blockReason ? 'cart-block' : undefined}>
                      Proceed to checkout
                    </button>
                    {blockReason && <div id="cart-block" className="cart-block" role="status">{blockReason}</div>}
                    {!currentUser && <div className="cart-guest-note">No account needed. Check out as a guest or sign in.</div>}
                    <p className="cart-trust">
                      <svg {...ico} width="15" height="15"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                      <span>Secure payments via UPI, cards &amp; net banking. {shippingPromise(brand)}.</span>
                    </p>
                  </>
                )}
              />
            </div>
          </div>
        )}
      </div>

      {/* Mobile sticky bar: total + continue, directly above the bottom tab bar */}
      {cart.length > 0 && (
        <div className="cart-bar">
          <div className="cart-bar-total">
            <span>Total</span>
            <strong>{formatMoney(payable)}</strong>
          </div>
          <button type="button" className="btn btn-gold cart-bar-btn" onClick={goCheckout} disabled={!canCheckout}>Continue</button>
        </div>
      )}

      <style>{`
        .cart-head .bl-pagehead-inner { padding-top: 12px; padding-bottom: 12px; }
        @media (min-width: 768px) { .cart-head .bl-pagehead-inner { padding-top: 14px; padding-bottom: 14px; } }
        .cart-head-row { display: flex; align-items: center; justify-content: space-between; gap: 10px 24px; flex-wrap: wrap; }
        .cart-title { font-family: var(--font-head); font-size: 20px; line-height: 1.3; margin: 0; }

        .cart-steps { display: flex; align-items: center; list-style: none; margin: 0; padding: 0; }
        .cart-step { display: flex; align-items: center; gap: 6px; color: var(--text-muted); font-size: 12.5px; white-space: nowrap; }
        .cart-step + .cart-step::before { content: ''; display: block; width: 44px; height: 1px; background: #CDD6D4; margin: 0 4px 0 10px; }
        .cart-step + .cart-step.done::before, .cart-step + .cart-step.active::before { background: var(--primary); }
        .cart-step-dot { width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 11.5px; font-weight: 500; background: #fff; border: 1px solid #B8C3C1; color: var(--text-muted); flex-shrink: 0; }
        .cart-step.active, .cart-step.done { color: var(--text); }
        .cart-step.active { font-weight: 500; }
        .cart-step.active .cart-step-dot, .cart-step.done .cart-step-dot { background: var(--primary); border-color: var(--primary); color: #fff; }

        .cart-wrap { padding-top: 12px; padding-bottom: 40px; }
        .cart-grid { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 12px; align-items: start; }
        .cart-side { position: sticky; top: calc(var(--hdr-h) + 12px); }

        .cart-note { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; padding: 10px 14px; border: 1px solid var(--border); border-radius: 8px; background: #fff; font-size: 13px; color: var(--text-muted); }
        .cart-note.is-warn { background: var(--sun-tint); border-color: var(--sun); color: var(--sun-text); }
        .cart-note.is-error { background: #FDEBE9; border-color: #F3C2BD; color: var(--error); font-weight: 500; }

        .cart-list { background: #fff; border: 1px solid var(--border); border-radius: 8px; min-width: 0; overflow: hidden; }
        .cart-item { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 10px 14px; padding: 16px; border-bottom: 1px solid var(--border); }
        .cart-item.is-soldout .cart-item-img, .cart-item.is-soldout .cart-item-body > *:not(.cart-item-alert) { opacity: .6; }
        .cart-item-img { grid-row: 1 / span 2; width: 96px; height: 96px; align-self: start; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; background: #EFF3F2; display: flex; align-items: center; justify-content: center; }
        .cart-item-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .cart-item-img:focus-visible, .cart-item-name a:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
        .cart-item-noimg { font-size: 28px; }
        .cart-item-body { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .cart-item-brand { font-size: 11.5px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .03em; }
        .cart-item-name { font-size: 14.5px; font-weight: 500; color: var(--text); line-height: 1.4; overflow-wrap: anywhere; }
        .cart-item-name a { color: inherit; }
        .cart-item-name a:hover { color: var(--primary); }
        .cart-item-variant { display: inline-block; align-self: flex-start; margin-top: 2px; padding: 2px 8px; background: #EEF2F1; border-radius: 4px; font-size: 12.5px; color: var(--text); }
        .cart-item-meta { font-size: 12.5px; color: var(--text-muted); }
        .cart-item-price-row { display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 10px; margin-top: 6px; }
        .cart-item-price { font-size: 17px; font-weight: 600; color: var(--text); }
        .cart-item-mrp { font-size: 13px; color: var(--text-muted); }
        .cart-item-off { font-size: 13px; font-weight: 600; color: var(--success); }
        .cart-item-unit { font-size: 12.5px; color: var(--text-muted); }
        .cart-item-alert { margin-top: 6px; font-size: 13px; font-weight: 600; color: var(--error); }
        .cart-item-low { margin-top: 4px; font-size: 12.5px; font-weight: 500; color: var(--warning); }
        .cart-item-delivery { margin-top: 4px; font-size: 12.5px; color: var(--text-muted); }
        .cart-item-foot { grid-column: 2; display: flex; align-items: center; gap: 6px 18px; flex-wrap: wrap; }
        .cart-qty { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .cart-cap { font-size: 12px; color: var(--warning); font-weight: 500; }

        .cart-stepper { display: inline-flex; align-items: center; background: #fff; border: 1px solid #CDD6D4; border-radius: 4px; overflow: hidden; }
        .cart-stepper button { width: 34px; height: 34px; border: none; background: #fff; font-size: 18px; line-height: 1; color: var(--text); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background .12s, color .12s; }
        .cart-stepper button:hover:not(:disabled) { background: var(--primary-tint); color: var(--primary); }
        .cart-stepper button:disabled { opacity: .35; cursor: not-allowed; }
        .cart-stepper button:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
        .cart-stepper span { min-width: 38px; height: 34px; display: flex; align-items: center; justify-content: center; border-left: 1px solid #CDD6D4; border-right: 1px solid #CDD6D4; font-size: 14px; font-weight: 500; color: var(--text); }
        .cart-link { min-height: 34px; padding: 0 2px; border: none; background: none; font-size: 13px; font-weight: 600; color: var(--primary); cursor: pointer; text-transform: none; }
        .cart-link:hover { text-decoration: underline; text-underline-offset: 3px; }
        .cart-link.is-danger { color: var(--text-muted); }
        .cart-link.is-danger:hover { color: var(--error); }
        .cart-continue { padding: 12px 16px; }
        .cart-ghost { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 500; color: var(--primary); }
        .cart-ghost:hover { text-decoration: underline; text-underline-offset: 3px; }

        .cart-cta { min-height: 46px; font-size: 15px; margin-top: 16px; }
        .cart-cta:disabled { opacity: .5; cursor: not-allowed; }
        .cart-block { font-size: 12.5px; color: var(--error); margin-top: 8px; text-align: center; }
        .cart-guest-note { font-size: 12.5px; color: var(--text-muted); margin-top: 10px; text-align: center; }
        .cart-trust { display: flex; align-items: flex-start; gap: 8px; margin: 14px 0 0; font-size: 12px; line-height: 1.5; color: var(--text-muted); }
        .cart-trust svg { flex-shrink: 0; margin-top: 2px; color: var(--primary); }

        .cart-empty { text-align: center; padding: 56px 20px 60px; background: #fff; border: 1px solid var(--border); border-radius: 8px; }
        .cart-empty-art { display: block; margin: 0 auto 18px; max-width: 100%; height: auto; }
        .cart-empty-title { font-family: var(--font-head); font-size: 18px; font-weight: 500; color: var(--text); margin-bottom: 6px; }
        .cart-empty-sub { font-size: 14px; color: var(--text-muted); margin: 0 0 18px; }

        .cart-bar { display: none; }

        @media (max-width: 899px) {
          .cart-page { padding-bottom: 68px; }
          .cart-grid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
          .cart-side { position: static; }
          .cart-cta-desktop { display: none; }
          .cart-bar {
            display: flex; align-items: center; justify-content: space-between; gap: 12px;
            position: fixed; left: 0; right: 0; z-index: 90;
            bottom: calc(var(--bottom-nav-h) + env(safe-area-inset-bottom, 0px));
            background: #fff; border-top: 1px solid var(--border);
            padding: 8px 14px;
          }
          .cart-bar-total { display: flex; flex-direction: column; line-height: 1.2; }
          .cart-bar-total span { font-size: 12px; color: var(--text-muted); }
          .cart-bar-total strong { font-size: 18px; font-weight: 600; color: var(--text); }
          .cart-bar-btn { flex: 1; max-width: 220px; min-height: 44px; font-size: 15px; }
          .cart-bar-btn:disabled { opacity: .5; }
        }
        @media (max-width: 520px) {
          .cart-item { grid-template-columns: 80px minmax(0, 1fr); padding: 14px 12px; gap: 10px 12px; }
          .cart-item-img { width: 80px; height: 80px; grid-row: auto; }
          .cart-item-foot { grid-column: 1 / -1; }
          .cart-stepper button, .cart-stepper span { height: 38px; }
          .cart-stepper button { width: 38px; }
          .cart-steps { width: 100%; justify-content: space-between; }
          .cart-step { font-size: 12px; }
          .cart-step + .cart-step { flex: 1; }
          .cart-step + .cart-step::before { width: auto; flex: 1; min-width: 10px; margin: 0 2px 0 8px; }
        }
      `}</style>
    </div>
  );
}
