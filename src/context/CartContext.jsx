import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../supabase';
import { useCatalog } from './CatalogContext';
import { fetchVariantsForProducts } from '../utils/catalogApi';
import { cartLineFromVariant, isVariantPurchasable, lineKey, maxPurchasableQty } from '../utils/catalog';
import { reconcileCart, storedKey } from '../utils/cartReconcile';
import { cartSubtotalOf } from '../utils/pricing';
import toast from 'react-hot-toast';
import CartToast from '../components/CartToast';

// Split into two contexts so a component that only needs to call addToCart
// (every ProductCard, ProductPage, GiftCard) never re-renders when the cart's
// contents change -- only components reading actual cart data (Cart, Checkout,
// the Navbar badge) do. Every action below is wrapped in useCallback with stable
// dependencies, so CartActionsContext's value is stable for the app's lifetime.
const CartDataContext = createContext();
const CartActionsContext = createContext();

export function useCartData() { return useContext(CartDataContext); }
export function useCartActions() { return useContext(CartActionsContext); }
// Back-compat combined hook for call sites that need both.
export function useCart() {
  return { ...useContext(CartDataContext), ...useContext(CartActionsContext) };
}

const STORAGE_KEY = 'tt_cart';

function readStored() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    // Valid JSON isn't necessarily a valid cart -- a leftover/tampered value like `null` or `{}`
    // parses fine but would crash the first array method called on it.
    return Array.isArray(parsed) ? parsed.filter(l => l && typeof l === 'object') : [];
  } catch { return []; }
}

// A cart line is identified by its variant (gift cards by their own id). See utils/catalog.js lineKey.
//
// Every action computes the next cart from `cartRef` (a synchronous snapshot of the latest cart), shows
// its toast, then commits -- no side effects inside state updaters (which React may run twice or late).
export function CartProvider({ children }) {
  const [cart, setCartState] = useState(readStored);
  const cartRef = useRef(cart);
  const commit = useCallback((next) => { cartRef.current = next; setCartState(next); }, []);

  const catalog = useCatalog();
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const refreshing = useRef(null);       // the check currently in flight, so overlapping callers share one run

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cart)); } catch { /* storage full/blocked -- the cart still works for this visit */ }
  }, [cart]);

  // The cart is saved in the browser and goes stale. Re-check it against the live catalogue: drop lines
  // that are gone, lower quantities to stock, refresh prices/MRP/images, and upgrade carts saved by the
  // old size-based model. Safe to call any time (Cart and Checkout call it when they open).
  const refreshCart = useCallback(() => {
    // Two callers can ask at once (on load and again when the category tree arrives); a second run would
    // report the same removals a second time, so they share the first one.
    if (!refreshing.current) {
      refreshing.current = runRefresh().finally(() => { refreshing.current = null; });
    }
    return refreshing.current;
    // eslint-disable-next-line
  }, [commit]);

  async function runRefresh() {
    const snapshot = cartRef.current.filter(l => !l.isGiftCard);
    if (!snapshot.length) return { removed: 0, adjusted: 0, repriced: 0 };
    const productIds = [...new Set(snapshot.map(l => l.id))];
    try {
      const [{ data: products, error }, variants] = await Promise.all([
        supabase.from('products').select('id, status, name, brand, cat, category_id, images, max_qty_per_order, cod_allowed, free_shipping, delivery_min_days, delivery_max_days').in('id', productIds),
        fetchVariantsForProducts(productIds),
      ]);
      if (error || !products) return null;

      const result = reconcileCart(snapshot, products, variants, (p) => catalogRef.current.idsWithAncestors(p.category_id));
      const fresh = new Map(result.entries.map(e => [storedKey(e.original), e.line]));

      // Merge into the LATEST cart: a line added while this check was in flight was not part of it and is
      // kept untouched rather than silently dropped by an overwrite built from a stale snapshot.
      const next = [];
      for (const l of cartRef.current) {
        if (l.isGiftCard) { next.push(l); continue; }
        const k = storedKey(l);
        if (!fresh.has(k)) { next.push(l); continue; }
        const updated = fresh.get(k);
        if (updated) next.push(updated);            // null = dropped
      }
      commit(next);

      // fixed ids: the same notice never stacks on itself
      if (result.removed > 0) {
        toast.error(result.removed === 1 ? 'An item in your cart is no longer available and was removed.' : `${result.removed} items in your cart are no longer available and were removed.`, { id: 'cart-removed' });
      } else if (result.adjusted > 0) {
        toast('Some quantities were lowered to what is in stock.', { icon: 'ℹ️', id: 'cart-adjusted' });
      }
      return { removed: result.removed, adjusted: result.adjusted, repriced: result.repriced };
    } catch { return null; }
  }

  // Once on load, and again when the category tree arrives (so category coupons get the right ids).
  const categoriesReady = catalog.categories.length > 0;
  useEffect(() => { refreshCart(); /* eslint-disable-next-line */ }, [categoriesReady]);

  // Put a ready-made cart line in the cart (gift cards, or a line built by addVariantToCart).
  // Returns true when something was added.
  const addToCart = useCallback((line) => {
    const cap = line.isGiftCard ? 1 : Math.max(1, Number(line.maxQty) || 10);
    if (!line.isGiftCard && line.stock === 0) { toast.error('This item is out of stock.'); return false; }
    const prev = cartRef.current;
    const key = lineKey(line);
    const existing = prev.find((i) => lineKey(i) === key);
    if (existing) {
      if (existing.qty >= cap) {
        toast.error(line.isGiftCard ? 'This gift card is already in your cart.' : `You can add at most ${cap} of this item.`);
        return false;
      }
      // Adding 3 of something already in the cart adds 3 (up to the limit), not 1.
      const add = Math.max(1, Math.floor(Number(line.qty) || 1));
      const nextQty = Math.min(existing.qty + add, cap);
      if (nextQty < existing.qty + add) toast(`Only ${cap} can be ordered at a time -- quantity set to ${cap}.`, { icon: 'ℹ️' });
      else toast.custom((t) => <CartToast t={t} product={line} label="Quantity updated" />, { duration: 4000 });
      // Refresh price/stock/etc. from the line being added, not just the qty -- re-adding an item whose
      // price changed since it was first added must not keep showing the old price to checkout.
      commit(prev.map((i) => (lineKey(i) === key ? { ...i, ...line, qty: nextQty } : i)));
      return true;
    }
    toast.custom((t) => <CartToast t={t} product={line} label="Added to cart" />, { duration: 4000 });
    commit([...prev, { ...line, qty: line.qty || 1 }]);
    return true;
  }, [commit]);

  // The normal way to add a catalogue item: a product + the variant the shopper chose.
  const addVariantToCart = useCallback((product, variant, qty = 1) => {
    if (!product || !variant) return false;
    if (!isVariantPurchasable(variant)) { toast.error('This option is out of stock.'); return false; }
    const line = cartLineFromVariant(product, variant, {
      categoryIds: catalogRef.current.idsWithAncestors(product.category_id),
      qty: Math.max(1, Math.min(qty, maxPurchasableQty(variant, product))),
    });
    return addToCart(line);
  }, [addToCart]);

  // Add from a product CARD, where the shopper has not chosen an option. A product with a single
  // purchasable option goes straight in; one that needs a size/colour returns { needsOptions: true } so the
  // caller sends the shopper to the product page -- never a silent guess at the size.
  const quickAdd = useCallback(async (product) => {
    if (product.has_variants) return { needsOptions: true };
    try {
      const variants = await fetchVariantsForProducts([product.id]);
      const variant = variants.find(v => v.active !== false);
      if (!variant) { toast.error('This product is not available right now.'); return { added: false }; }
      return { added: addVariantToCart(product, variant, 1) };
    } catch {
      toast.error('Could not add this item. Please try again.');
      return { added: false };
    }
  }, [addVariantToCart]);

  const removeFromCart = useCallback((item) => {
    const key = lineKey(item) || storedKey(item);
    commit(cartRef.current.filter((i) => (lineKey(i) || storedKey(i)) !== key));
    toast.success('Item removed from cart.');
  }, [commit]);

  const updateQty = useCallback((item, qty) => {
    if (qty <= 0) { removeFromCart(item); return; }
    const cap = item.isGiftCard ? 1 : Math.max(1, Number(item.maxQty) || 10);
    if (qty > cap) {
      toast.error(item.stock !== null && item.stock !== undefined && item.stock <= cap ? `Only ${item.stock} available.` : `You can add at most ${cap} of this item.`);
      qty = cap;
    }
    const key = lineKey(item) || storedKey(item);
    commit(cartRef.current.map((i) => ((lineKey(i) || storedKey(i)) === key ? { ...i, qty } : i)));
  }, [commit, removeFromCart]);

  const clearCart = useCallback(() => { commit([]); }, [commit]);

  const cartCount = cart.reduce((s, i) => s + i.qty, 0);
  const cartSubtotal = cartSubtotalOf(cart);
  // "Price (3 items)" at MRP and "You will save" -- the Flipkart-style breakdown.
  const cartMrpTotal = cart.reduce((s, i) => s + (Number(i.mrp) > Number(i.price) ? Number(i.mrp) : Number(i.price) || 0) * i.qty, 0);
  const cartSavings = Math.max(0, cartMrpTotal - cartSubtotal);
  const hasUnavailable = cart.some(i => i.soldOut);

  const dataValue = useMemo(
    () => ({ cart, cartCount, cartSubtotal, cartMrpTotal, cartSavings, hasUnavailable }),
    [cart, cartCount, cartSubtotal, cartMrpTotal, cartSavings, hasUnavailable]
  );
  const actionsValue = useMemo(
    () => ({ addToCart, addVariantToCart, quickAdd, removeFromCart, updateQty, clearCart, refreshCart }),
    [addToCart, addVariantToCart, quickAdd, removeFromCart, updateQty, clearCart, refreshCart]
  );

  return (
    <CartActionsContext.Provider value={actionsValue}>
      <CartDataContext.Provider value={dataValue}>
        {children}
      </CartDataContext.Provider>
    </CartActionsContext.Provider>
  );
}
