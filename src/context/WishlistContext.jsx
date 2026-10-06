import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '../supabase';
import { useAuth } from './AuthContext';
import toast from 'react-hot-toast';

// The wishlist is a set of PRODUCT ids (not snapshots -- price and stock are always read live).
// Guests keep it in localStorage; once signed in it lives in the `wishlists` table and follows the
// customer across devices, with the guest list merged in on login.
//
//   ids          Set of product ids
//   has(id)      is this product saved
//   toggle(id)   add/remove (optimistic; rolls back if the save fails); resolves the new saved state
//   count        number saved
const WishlistContext = createContext({ ids: new Set(), has: () => false, toggle: async () => false, count: 0 });
export const useWishlist = () => useContext(WishlistContext);

const KEY = 'tt_wl2';
const readLocal = () => {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; } catch { return []; }
};

export function WishlistProvider({ children }) {
  const { currentUser } = useAuth();
  const userId = currentUser?.id || null;
  const [ids, setIds] = useState(() => new Set(readLocal()));
  const idsRef = useRef(ids);
  idsRef.current = ids;

  const persistLocal = (set) => { try { localStorage.setItem(KEY, JSON.stringify([...set])); } catch { /* ignore */ } };

  // On sign-in: union the guest list with the saved one and push the guest-only items up.
  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from('wishlists').select('product_id').eq('user_id', userId);
      if (error || cancelled) return;
      const remote = new Set((data || []).map(r => r.product_id));
      // A guest's saved list can hold a product that has since been removed (or never existed). Saving such an id
      // breaks the foreign key and would fail the WHOLE batch, silently dropping the valid items with it -- so only
      // products that still exist are merged. (Draft products are hidden by row-level security, so they drop out too.)
      const guestOnly = [...idsRef.current].filter(id => !remote.has(id));
      let stillExist = new Set();
      if (guestOnly.length) {
        const { data: live, error: liveErr } = await supabase.from('products').select('id').in('id', guestOnly);
        if (liveErr || cancelled) return;
        stillExist = new Set((live || []).map(r => r.id));
      }
      const missing = guestOnly.filter(id => stillExist.has(id));
      const merged = new Set([...remote, ...missing]);
      if (missing.length) await supabase.from('wishlists').upsert(missing.map(product_id => ({ user_id: userId, product_id })), { onConflict: 'user_id,product_id', ignoreDuplicates: true });
      if (!cancelled) { setIds(merged); persistLocal(merged); }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const toggle = useCallback(async (productId) => {
    if (!productId) return false;
    const was = idsRef.current.has(productId);
    const next = new Set(idsRef.current);
    if (was) next.delete(productId); else next.add(productId);
    setIds(next); persistLocal(next);
    toast.success(was ? 'Removed from wishlist' : 'Saved to wishlist');
    if (userId) {
      const { error } = was
        ? await supabase.from('wishlists').delete().eq('user_id', userId).eq('product_id', productId)
        : await supabase.from('wishlists').insert({ user_id: userId, product_id: productId });
      if (error && error.code !== '23505') {          // 23505 = already saved, fine
        const back = new Set(idsRef.current);
        if (was) back.add(productId); else back.delete(productId);
        setIds(back); persistLocal(back);
        toast.error('Could not update your wishlist. Please try again.');
        return was;
      }
    }
    return !was;
  }, [userId]);

  const value = useMemo(() => ({ ids, has: (id) => ids.has(id), toggle, count: ids.size }), [ids, toggle]);
  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}
