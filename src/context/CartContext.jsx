import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../supabase';
import { knownStock } from '../data/products';
import { cartSubtotalOf } from '../utils/pricing';
import toast from 'react-hot-toast';
import CartToast from '../components/CartToast';

// Split into two contexts so a component that only needs to call addToCart
// (every ProductCard, ProductPage, GiftCard) never re-renders when the cart's
// contents change — only components reading actual cart data (Cart, Checkout,
// the Navbar badge) do. All the action functions below are wrapped in
// useCallback with no dependencies (they only ever use the functional
// setCart(prev => ...) form), so CartActionsContext's value is stable for
// the lifetime of the app and never triggers its subscribers to re-render.
const CartDataContext = createContext();
const CartActionsContext = createContext();

export function useCartData() { return useContext(CartDataContext); }
export function useCartActions() { return useContext(CartActionsContext); }
// Back-compat combined hook for call sites that need both.
export function useCart() {
  return { ...useContext(CartDataContext), ...useContext(CartActionsContext) };
}

export function CartProvider({ children }) {
  const [cart, setCart] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('tt_cart') || '[]');
      // Valid JSON isn't necessarily a valid cart -- a leftover/tampered value like
      // `null` or `{}` parses fine but would crash the very next effect below, which
      // calls array methods on this unconditionally.
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem('tt_cart', JSON.stringify(cart));
  }, [cart]);

  // The cart is saved in the browser and can go stale -- a product added days ago may
  // since have been deleted or unpublished by the admin. Re-check once against Supabase
  // on load and drop anything that's gone, so a removed product never lingers in a cart.
  useEffect(() => {
    const realIds = [...new Set(cart.filter(i => !i.isGiftCard).map(i => i.id))];
    if (realIds.length === 0) return;
    // Tracks which ids this specific query actually asked about, so the "no
    // matching row" case below can tell "genuinely deleted" apart from "added
    // to the cart after this query was already sent."
    const queriedIds = new Set(realIds);
    supabase.from('products').select('id, available, stock, variants').in('id', realIds).then(({ data, error }) => {
      if (error || !data) return;
      const liveMap = new Map(data.map(p => [p.id, p]));
      let removedCount = 0;
      // Functional update against the LATEST cart, not the snapshot this effect
      // started with -- an item added while this check was in flight has no entry
      // in liveMap (it wasn't part of the query) and is left untouched rather than
      // silently dropped by an overwrite built from a stale snapshot.
      setCart(prev => {
        const kept = [];
        prev.forEach(item => {
          if (item.isGiftCard) { kept.push(item); return; }
          const live = liveMap.get(item.id);
          if (!live) {
            // Genuinely gone (hard-deleted), not just "added mid-flight" -- this
            // id WAS part of the query and still has no matching row. Previously
            // both cases were treated the same way ("keep it"), so a deleted
            // product's line lingered in the cart forever, surviving all the way
            // to a confusing checkout rejection instead of being cleaned up here.
            if (queriedIds.has(item.id)) { removedCount++; return; }
            kept.push(item); return;
          }
          if (live.available === false) { removedCount++; return; }
          // A cart line for a product with variants tracks that specific variant's
          // stock, not the base product row's -- refreshing from `live.stock`
          // unconditionally here used to clobber a correct variant stock with the
          // (usually untracked/irrelevant) base column. Look up the matching variant
          // instead; if it can't be found, leave the line's stock as-is rather than
          // guessing.
          if (item.size && Array.isArray(live.variants)) {
            const variant = live.variants.find(v => v.size === item.size);
            kept.push(variant ? { ...item, stock: variant.stock } : item);
          } else {
            kept.push({ ...item, stock: live.stock });
          }
        });
        return kept;
      });
      if (removedCount > 0) {
        toast.error(removedCount === 1
          ? 'An item in your cart is no longer available and was removed.'
          : `${removedCount} items in your cart are no longer available and were removed.`);
      }
    });
    // eslint-disable-next-line
  }, []);

  // Two different sizes of the same product are separate cart lines -- keyed by
  // id+size, not just id, so picking "Small" vs "Medium" doesn't merge them.
  function lineKey(item) {
    return item.id + (item.size ? '::' + item.size : '');
  }

  const addToCart = useCallback((product) => {
    // Stock may be null/undefined (unset) rather than a real number -- only ever
    // treat it as a hard limit when it's genuinely known, so an unset stock value
    // never masquerades as "0 available" or blocks a legitimate add.
    const stockNum = knownStock(product.stock);
    const hasKnownStock = stockNum !== null;
    if (hasKnownStock && stockNum === 0) {
      toast.error('This product is no longer available.');
      return;
    }
    setCart((prev) => {
      const key = lineKey(product);
      const existing = prev.find((i) => lineKey(i) === key);
      if (existing) {
        if (hasKnownStock && existing.qty >= stockNum) {
          toast.error(`Only ${stockNum} available.`);
          return prev;
        }
        toast.custom((t) => <CartToast t={t} product={product} label="Quantity Updated" />, { duration: 4000 });
        // Refreshes price/stock/etc. from the current `product` being added, not
        // just the qty -- otherwise re-adding a product whose price changed since
        // it was first added kept showing the old price all the way to checkout.
        return prev.map((i) =>
          lineKey(i) === key ? { ...i, ...product, qty: i.qty + 1 } : i
        );
      }
      toast.custom((t) => <CartToast t={t} product={product} label="Added to Cart" />, { duration: 4000 });
      return [...prev, { ...product, qty: 1 }];
    });
  }, []);

  const removeFromCart = useCallback((item) => {
    const key = lineKey(item);
    setCart((prev) => prev.filter((i) => lineKey(i) !== key));
    toast.success('Item removed from cart.');
  }, []);

  const updateQty = useCallback((item, qty) => {
    if (qty <= 0) {
      removeFromCart(item);
      return;
    }
    // Same "unknown vs. actually zero" stock rule as addToCart -- only clamp when
    // stock is genuinely known, so an untracked product's qty is never capped.
    const stockNum = knownStock(item.stock);
    if (stockNum !== null && qty > stockNum) {
      toast.error(`Only ${stockNum} available.`);
      qty = stockNum;
    }
    const key = lineKey(item);
    setCart((prev) =>
      prev.map((i) => (lineKey(i) === key ? { ...i, qty } : i))
    );
  }, [removeFromCart]);

  const clearCart = useCallback(() => {
    setCart([]);
  }, []);

  const cartCount = cart.reduce((s, i) => s + i.qty, 0);
  const cartSubtotal = cartSubtotalOf(cart);

  const dataValue = useMemo(
    () => ({ cart, cartCount, cartSubtotal }),
    [cart, cartCount, cartSubtotal]
  );
  const actionsValue = useMemo(
    () => ({ addToCart, removeFromCart, updateQty, clearCart }),
    [addToCart, removeFromCart, updateQty, clearCart]
  );

  return (
    <CartActionsContext.Provider value={actionsValue}>
      <CartDataContext.Provider value={dataValue}>
        {children}
      </CartDataContext.Provider>
    </CartActionsContext.Provider>
  );
}
