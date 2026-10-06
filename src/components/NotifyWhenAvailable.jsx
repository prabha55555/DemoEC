import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabase';
import { safeQuery, isAuthExpiredError } from '../utils/safeFetch';
import toast from 'react-hot-toast';

// "Notify me when it is back" for ONE variant (the size/colour the shopper is looking at).
//
// The database is the source of truth for "already subscribed" -- checked on mount with a real SELECT, never
// inferred from React state, so the answer is right after a refresh, a new device or a log-out/in. Duplicates are
// refused by a unique index (user + product + size text). `size` therefore carries the variant label too: it keeps
// that index per-variant (one subscription per option) and keeps older readers of the column working.
//
// Guests are asked to sign in first -- an alert needs a real identity to send to.
export default function NotifyWhenAvailable({ product, variant }) {
  const { currentUser, userProfile } = useAuth();
  const location = useLocation();
  const [status, setStatus] = useState('checking'); // 'checking' | 'available' | 'saving' | 'subscribed'
  const variantId = variant?.id || null;
  const sizeText = variant?.label && variant.label !== 'Default' ? variant.label : null;

  useEffect(() => {
    let cancelled = false;
    if (!currentUser || !variantId) { setStatus('available'); return undefined; }
    setStatus('checking');
    (async () => {
      const { data, error } = await safeQuery(
        supabase.from('product_notifications').select('id').eq('user_id', currentUser.id).eq('product_id', product.id).eq('variant_id', variantId).maybeSingle()
      );
      if (cancelled) return;
      if (isAuthExpiredError(error)) { setStatus('available'); return; }
      setStatus(data ? 'subscribed' : 'available');
    })();
    return () => { cancelled = true; };
  }, [currentUser, product.id, variantId]);

  async function handleClick() {
    if (!currentUser || !variantId) return;
    setStatus('saving');
    const { error } = await safeQuery(supabase.from('product_notifications').insert({
      user_id: currentUser.id,
      user_name: userProfile?.name || null,
      user_email: currentUser.email,
      user_phone: userProfile?.phone || null,
      product_id: product.id,
      product_name: product.name,
      variant_id: variantId,
      size: sizeText,
    }));
    if (error) {
      // 23505 = unique_violation: a second click/tab lost the race against an already-saved subscription, not a failure.
      if (error.code === '23505') { setStatus('subscribed'); toast('You are already subscribed to this item.'); return; }
      setStatus('available');
      toast.error('Could not save your request. Please try again.');
      return;
    }
    setStatus('subscribed');
    toast.success('We will notify you when this is back in stock.');
  }

  if (!currentUser) {
    return (
      <Link to="/login" state={{ from: { pathname: location.pathname, search: location.search } }} className="btn btn-outline btn-full pp-notify">
        Sign in to get notified when it is back
      </Link>
    );
  }
  if (status === 'checking') return <div className="pp-notify-skel bl-skel" aria-hidden="true" />;
  if (status === 'subscribed') {
    return <div className="pp-notify-done" role="status">✓ We will notify you when this is back in stock</div>;
  }
  return (
    <button type="button" className="btn btn-outline btn-full pp-notify" onClick={handleClick} disabled={status === 'saving'}>
      {status === 'saving' ? 'Saving…' : 'Notify me when available'}
    </button>
  );
}
