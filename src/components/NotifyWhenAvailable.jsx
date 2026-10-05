import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabase';
import { safeQuery, isAuthExpiredError } from '../utils/safeFetch';
import toast from 'react-hot-toast';

// "Notify When Available" -- subscribes the logged-in customer to a back-in-
// stock alert for one product (optionally one size, when the product has
// variants -- stock is tracked per size in this catalog, so a subscription
// is only meaningful at the level stock actually varies at).
//
// The database is the source of truth for "already subscribed" -- checked
// fresh on mount via a real SELECT, never inferred from local/React state
// alone, so the state is correct across refresh/logout-login/new browser
// session exactly as required. Duplicate prevention is enforced at the DB
// layer (a unique index on user_id+product_id+size, see the product_notifications
// SQL), not just by this component's own UI state.
export default function NotifyWhenAvailable({ product, size }) {
  const { currentUser, userProfile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState('checking'); // 'checking' | 'available' | 'saving' | 'subscribed'

  useEffect(() => {
    let cancelled = false;
    if (!currentUser) { setStatus('available'); return; }
    (async () => {
      let q = supabase.from('product_notifications').select('id').eq('user_id', currentUser.id).eq('product_id', product.id);
      q = size ? q.eq('size', size) : q.is('size', null);
      const { data, error } = await safeQuery(q.maybeSingle());
      if (cancelled) return;
      if (isAuthExpiredError(error)) { setStatus('available'); return; }
      setStatus(data ? 'subscribed' : 'available');
    })();
    return () => { cancelled = true; };
  }, [currentUser, product.id, size]);

  async function handleClick() {
    // Ask the customer to log in/register rather than silently creating an
    // anonymous record -- a subscription needs a real identity to notify.
    if (!currentUser) {
      toast('Please log in to get notified when this is back in stock.', { icon: 'ℹ️' });
      navigate('/login', { state: { from: location } });
      return;
    }
    setStatus('saving');
    const { error } = await safeQuery(supabase.from('product_notifications').insert({
      user_id: currentUser.id,
      user_name: userProfile?.name || null,
      user_email: currentUser.email,
      user_phone: userProfile?.phone || null,
      product_id: product.id,
      product_name: product.name,
      size: size || null,
    }));
    if (error) {
      // 23505 = unique_violation -- a second click/tab lost the race against
      // an already-saved subscription, not a real failure. Reflect the true
      // (already-subscribed) state instead of showing an error for it.
      if (error.code === '23505') { setStatus('subscribed'); toast('You\'re already subscribed to this product.'); return; }
      if (error.code === '42P01') { toast.error('Notifications aren\'t set up yet. Please try again later.'); setStatus('available'); return; }
      setStatus('available');
      toast.error('Could not save your request. Please try again.');
      return;
    }
    setStatus('subscribed');
    toast.success('We\'ll notify you when this is back in stock.');
  }

  if (status === 'checking') return null; // avoid a flash of the wrong state while the DB check resolves

  if (status === 'subscribed') {
    return (
      <button className="btn btn-full" disabled style={{ background: '#E5F6EE', color: 'var(--success)', cursor: 'default', fontWeight: 600, fontSize: 14, padding: '11px 20px', borderRadius: 6, minHeight: 44, border: '1px solid #BDE6D2' }}>
        &#10003; You're Already Subscribed
      </button>
    );
  }

  return (
    <button
      className="btn btn-full"
      onClick={handleClick}
      disabled={status === 'saving'}
      style={{ background: '#fff', color: 'var(--primary)', fontWeight: 600, fontSize: 14, padding: '11px 20px', borderRadius: 6, minHeight: 44, border: '1px solid var(--primary)', cursor: status === 'saving' ? 'default' : 'pointer', opacity: status === 'saving' ? 0.6 : 1 }}
    >
      {status === 'saving' ? 'Saving...' : 'Notify When Available'}
    </button>
  );
}
