import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { fmt, knownStock } from '../data/products';
import { thumb } from '../utils/thumbnail';
import { getShippingCost } from '../utils/delivery';

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

export default function Cart() {
  const { cart, removeFromCart, updateQty, cartSubtotal } = useCart();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const shipping = getShippingCost(cart);
  const itemCount = cart.reduce((s, i) => s + i.qty, 0);
  const grandTotal = cartSubtotal + shipping;

  return (
    <div className="cart-page" style={{ paddingTop: 'var(--hdr-h)', minHeight: '80vh', background: 'var(--bg)' }}>
      {/* HEADER -- plain title row + 3-step tracker */}
      <div className="bl-pagehead cart-head">
        <div className="bl-pagehead-inner">
          <div className="cart-head-row">
            <h1 className="cart-title">My Cart{cart.length > 0 ? ` (${itemCount})` : ''}</h1>
            {cart.length > 0 && <CartSteps current={1} />}
          </div>
        </div>
      </div>

      <div className="bl-wrap cart-wrap">
        {cart.length === 0 ? (
          <div className="cart-empty">
            <EmptyCartArt />
            <div className="cart-empty-title">Your cart is empty</div>
            <button className="btn btn-gold" style={{ minWidth: 200 }} onClick={() => navigate('/shop')}>Continue Shopping</button>
          </div>
        ) : (
          <div className="cart-grid">
            {/* ITEMS */}
            <div className="cart-list">
              {cart.map((item) => {
                const stockNum = knownStock(item.stock);
                const atStockLimit = stockNum !== null && item.qty >= stockNum;
                return (
                  <article className="cart-item" key={item.id + (item.size ? '::' + item.size : '')}>
                    <div
                      className="cart-item-img"
                      style={{ background: item.bg || 'var(--bg-hover)', cursor: item.isGiftCard ? 'default' : 'pointer' }}
                      onClick={() => { if (!item.isGiftCard) navigate(`/product/${item.id}`); }}
                    >
                      {item.images?.[0] && <img src={thumb(item.images[0], 200)} alt={item.name} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                    </div>
                    <div className="cart-item-body">
                      {item.cat && <div className="cart-item-cat">{item.cat}</div>}
                      <div className="cart-item-name">{item.name}</div>
                      {item.size && <div className="cart-item-variant">Size: {item.size}</div>}
                      {item.isGiftCard ? (
                        <div className="cart-item-meta">
                          Code issued after payment{item.recipientName ? ` — for ${item.recipientName}` : ''}
                        </div>
                      ) : (
                        item.origin ? <div className="cart-item-meta">{item.origin}</div> : null
                      )}
                      <div className="cart-item-price-row">
                        <div className="cart-item-price">{fmt(item.price * item.qty)}</div>
                        {item.qty > 1 && <div className="cart-item-unit">{fmt(item.price)} each</div>}
                      </div>
                      {!item.isGiftCard && (
                        <div className="cart-item-delivery">
                          <span className="cart-item-free">
                            <svg {...ico} width="14" height="14"><path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z" /><circle cx="5.5" cy="18.5" r="2" /><circle cx="18.5" cy="18.5" r="2" /></svg>
                            Free delivery
                          </span>
                          {item.shipping_charge > 0 && item.show_shipping_at_checkout !== false && (
                            <span className="cart-item-incl">Shipping included</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="cart-item-foot">
                      <div className="cart-stepper">
                        <button
                          onClick={() => updateQty(item, item.qty - 1)}
                          aria-label="Decrease quantity"
                        >−</button>
                        <span aria-live="polite">{item.qty}</span>
                        <button
                          onClick={() => updateQty(item, item.qty + 1)}
                          disabled={atStockLimit}
                          aria-label="Increase quantity"
                        >+</button>
                      </div>
                      <button className="cart-remove" onClick={() => removeFromCart(item)}>Remove</button>
                    </div>
                  </article>
                );
              })}
              <div className="cart-continue">
                <Link to="/shop" className="cart-ghost">
                  <svg {...ico} width="15" height="15"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
                  Continue shopping
                </Link>
              </div>
            </div>

            {/* PRICE DETAILS */}
            <aside className="cart-summary" aria-label="Price details">
              <div className="cart-sum-title">Price Details</div>
              <div className="cart-sum-body">
                <div className="cart-sum-row">
                  <span>Items ({itemCount})</span><span>{fmt(cartSubtotal)}</span>
                </div>
                <div className="cart-sum-row">
                  <span>Delivery</span>
                  {shipping > 0 ? <span>{fmt(shipping)}</span> : <span className="cart-free">Free</span>}
                </div>
                <div className="cart-sum-total">
                  <span>Total</span><strong>{fmt(grandTotal)}</strong>
                </div>
                <div className="cart-sum-note">Inclusive of all taxes</div>
                <button
                  className="btn btn-gold btn-full cart-cta cart-cta-desktop"
                  onClick={() => navigate('/checkout')}
                >
                  Proceed to Checkout
                </button>
                {!currentUser && (
                  <div className="cart-guest-note">
                    No account needed. Checkout as guest or sign in.
                  </div>
                )}
                <p className="cart-trust">
                  <svg {...ico} width="15" height="15"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                  <span>Secure payments via UPI, cards &amp; net banking. Free delivery on every order.</span>
                </p>
              </div>
            </aside>
          </div>
        )}
      </div>

      {/* Mobile sticky bar -- total + continue, sits directly above the bottom tab bar */}
      {cart.length > 0 && (
        <div className="cart-bar">
          <div className="cart-bar-total">
            <span>Total</span>
            <strong>{fmt(grandTotal)}</strong>
          </div>
          <button className="btn btn-gold cart-bar-btn" onClick={() => navigate('/checkout')}>
            Continue
          </button>
        </div>
      )}

      <style>{`
        /* header: plain title row + tracker */
        .cart-head .bl-pagehead-inner { padding-top: 12px; padding-bottom: 12px; }
        @media (min-width: 768px) { .cart-head .bl-pagehead-inner { padding-top: 14px; padding-bottom: 14px; } }
        .cart-head-row { display: flex; align-items: center; justify-content: space-between; gap: 10px 24px; flex-wrap: wrap; }
        .cart-title { font-family: var(--font-head); font-size: 20px; line-height: 1.3; margin: 0; }

        /* plain 3-step tracker */
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

        /* item list */
        .cart-list { background: #fff; border: 1px solid var(--border); border-radius: 8px; min-width: 0; overflow: hidden; }
        .cart-item { display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: 10px 14px; padding: 16px; border-bottom: 1px solid var(--border); }
        .cart-item-img { grid-row: 1 / span 2; width: 90px; height: 90px; align-self: start; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; flex-shrink: 0; }
        .cart-item-body { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .cart-item-cat { font-size: 11px; font-weight: 500; color: var(--primary); }
        .cart-item-name { font-size: 14px; font-weight: 500; color: var(--text); line-height: 1.4; overflow-wrap: anywhere; }
        .cart-item-variant, .cart-item-meta { font-size: 12.5px; color: var(--text-muted); }
        .cart-item-price-row { display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 10px; margin-top: 4px; }
        .cart-item-price { font-size: 16px; font-weight: 600; color: var(--text); }
        .cart-item-unit { font-size: 12.5px; color: var(--text-muted); }
        .cart-item-delivery { display: flex; align-items: center; flex-wrap: wrap; gap: 2px 12px; margin-top: 3px; }
        .cart-item-free { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 500; color: var(--success); }
        .cart-item-incl { font-size: 12px; color: var(--text-muted); }
        .cart-item-foot { grid-column: 2; display: flex; align-items: center; gap: 6px 16px; flex-wrap: wrap; }

        .cart-stepper { display: inline-flex; align-items: center; background: #fff; border: 1px solid #CDD6D4; border-radius: 4px; overflow: hidden; }
        .cart-stepper button { width: 32px; height: 32px; border: none; background: #fff; font-size: 18px; line-height: 1; color: var(--text); display: flex; align-items: center; justify-content: center; transition: background .12s, color .12s; }
        .cart-stepper button:hover:not(:disabled) { background: var(--primary-tint); color: var(--primary); }
        .cart-stepper button:disabled { opacity: .35; cursor: not-allowed; }
        .cart-stepper span { min-width: 36px; height: 32px; display: flex; align-items: center; justify-content: center; border-left: 1px solid #CDD6D4; border-right: 1px solid #CDD6D4; font-size: 14px; font-weight: 500; color: var(--text); }
        .cart-remove { min-height: 32px; padding: 0 4px; border: none; background: none; font-size: 13px; font-weight: 500; color: var(--text-muted); transition: color .12s; }
        .cart-remove:hover { color: var(--error); }
        .cart-continue { padding: 12px 16px; }
        .cart-ghost { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 500; color: var(--primary); }
        .cart-ghost:hover { text-decoration: underline; text-underline-offset: 3px; }

        /* price details card */
        .cart-summary { background: #fff; border: 1px solid var(--border); border-radius: 8px; position: sticky; top: calc(var(--hdr-h) + 12px); }
        .cart-sum-title { padding: 13px 16px; font-size: 14px; font-weight: 500; color: var(--text-muted); border-bottom: 1px solid var(--border); }
        .cart-sum-body { padding: 16px; }
        .cart-sum-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 14px; color: var(--text); margin-bottom: 12px; }
        .cart-free { color: var(--success); font-weight: 500; }
        .cart-sum-total { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding-top: 14px; border-top: 1px dashed #C9D3D1; font-size: 16px; font-weight: 600; color: var(--text); }
        .cart-sum-total strong { font-size: 18px; font-weight: 600; }
        .cart-sum-note { font-size: 12px; color: var(--text-muted); margin: 4px 0 16px; }
        .cart-cta { min-height: 46px; font-size: 15px; }
        .cart-guest-note { font-size: 12.5px; color: var(--text-muted); margin-top: 10px; text-align: center; }
        .cart-trust { display: flex; align-items: flex-start; gap: 8px; margin: 14px 0 0; font-size: 12px; line-height: 1.5; color: var(--text-muted); }
        .cart-trust svg { flex-shrink: 0; margin-top: 2px; color: var(--primary); }

        /* empty state */
        .cart-empty { text-align: center; padding: 56px 20px 60px; background: #fff; border: 1px solid var(--border); border-radius: 8px; }
        .cart-empty-art { display: block; margin: 0 auto 18px; max-width: 100%; height: auto; }
        .cart-empty-title { font-family: var(--font-head); font-size: 18px; font-weight: 500; color: var(--text); margin-bottom: 18px; }

        .cart-bar { display: none; }

        @media (max-width: 899px) {
          .cart-page { padding-bottom: 68px; }
          .cart-grid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
          .cart-summary { position: static; }
          .cart-cta-desktop { display: none; }
          .cart-sum-note { margin-bottom: 0; }
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
        }
        @media (max-width: 520px) {
          .cart-item { padding: 14px 12px; gap: 10px 12px; }
          .cart-item-img { grid-row: auto; }
          .cart-item-foot { grid-column: 1 / -1; }
          .cart-stepper button, .cart-stepper span { height: 36px; }
          .cart-stepper button { width: 36px; }
          .cart-steps { width: 100%; justify-content: space-between; }
          .cart-step { font-size: 12px; }
          .cart-step + .cart-step { flex: 1; }
          .cart-step + .cart-step::before { width: auto; flex: 1; min-width: 10px; margin: 0 2px 0 8px; }
        }
      `}</style>
    </div>
  );
}
