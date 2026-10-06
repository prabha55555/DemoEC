import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useWishlist } from '../context/WishlistContext';
import { useCartActions } from '../context/CartContext';
import { fetchProducts } from '../utils/catalogApi';
import { discountPercent, formatMoney, priceRange } from '../utils/catalog';
import { thumb } from '../utils/thumbnail';
import { EmptyState, LoadError, Loading, NAV_ICONS, TabHead } from './AccountParts';

// Account -> Wishlist. The wishlist is a set of product ids; price and stock are always read live.
export default function AccountWishlistTab() {
  const navigate = useNavigate();
  const wishlist = useWishlist();
  const { quickAdd } = useCartActions();
  const idList = useMemo(() => [...wishlist.ids].sort(), [wishlist.ids]);
  const key = idList.join(',');
  const [state, setState] = useState({ rows: [], loading: true, error: '' });
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    if (!idList.length) { setState({ rows: [], loading: false, error: '' }); return; }
    setState(s => ({ ...s, loading: true, error: '' }));
    try {
      const { rows } = await fetchProducts({ ids: idList, pageSize: 60, sort: 'newest' });
      setState({ rows, loading: false, error: '' });
    } catch {
      setState({ rows: [], loading: false, error: 'Please check your connection and try again.' });
    }
    // eslint-disable-next-line
  }, [key]);

  useEffect(() => { load(); }, [load]);

  // Only products still in the wishlist AND still on sale are shown (an archived product simply has no card).
  const rows = state.rows.filter(p => wishlist.has(p.id));

  async function moveToCart(p) {
    if (busyId) return;
    setBusyId(p.id);
    try {
      const res = await quickAdd(p);
      if (res?.needsOptions) { navigate(`/product/${p.id}`); return; }
      if (res?.added) await wishlist.toggle(p.id); // "move": it leaves the wishlist once it is in the cart
    } finally { setBusyId(null); }
  }

  if (state.error) return <><TabHead title="My wishlist" /><LoadError message={state.error} onRetry={load} /></>;
  if (state.loading && !rows.length) return <><TabHead title="My wishlist" /><Loading label="Loading your wishlist" /></>;
  if (!rows.length) {
    return (
      <>
        <TabHead title="My wishlist" />
        <EmptyState art="wishlist" title="Nothing saved yet" text="Tap the heart on any product to keep it here for later." cta="Explore products" onCta={() => navigate('/shop')} />
      </>
    );
  }

  return (
    <>
      <TabHead title="My wishlist" sub={`${rows.length} saved ${rows.length === 1 ? 'item' : 'items'}`} />
      <div className="bl-grid acc-wgrid">
        {rows.map(p => {
          const pr = priceRange(p);
          const off = discountPercent(pr.from, p.mrp);
          const out = p.in_stock === false;
          return (
            <div key={p.id} className="acc-wcard">
              <Link to={`/product/${p.id}`} className="acc-wimg" aria-label={`View ${p.name}`}>
                {p.images?.[0] && <img src={thumb(p.images[0], 350)} alt="" loading="lazy" decoding="async" />}
              </Link>
              <button type="button" className="acc-wheart" onClick={() => wishlist.toggle(p.id)} aria-label={`Remove ${p.name} from wishlist`}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{NAV_ICONS.wishlist}</svg>
              </button>
              <div className="acc-wbody">
                {p.brand && <div className="acc-wbrand">{p.brand}</div>}
                <Link to={`/product/${p.id}`} className="acc-wname">{p.name}</Link>
                <div className="acc-wprice">
                  {pr.from != null ? <>{pr.isRange ? 'From ' : ''}{formatMoney(pr.from)}</> : '—'}
                  {pr.mrp && <s className="acc-wmrp">{formatMoney(pr.mrp)}</s>}
                  {off > 0 && <span className="acc-woff">{off}% off</span>}
                </div>
                <div className={`acc-wstock${out ? ' is-out' : ''}`}>{out ? 'Out of stock' : 'In stock'}</div>
                <div className="acc-wactions">
                  {out
                    ? <Link to={`/product/${p.id}`} className="btn btn-sm btn-outline">View product</Link>
                    : (
                      <button type="button" className="btn btn-sm btn-outline" onClick={() => moveToCart(p)} disabled={busyId === p.id} aria-busy={busyId === p.id}>
                        {busyId === p.id ? 'Adding…' : p.has_variants ? 'Choose options' : 'Move to cart'}
                      </button>
                    )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
