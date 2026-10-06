import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../context/AuthContext';
import { fetchReviews } from '../utils/catalogApi';
import { fmtDate } from '../utils/orderFormat';
import StarRating from './StarRating';
import toast from 'react-hot-toast';

const PAGE = 5;

// Count per star (5 -> 1) from a list of reviews. Pure, so the summary can be tested without the network.
export function ratingHistogram(reviews) {
  const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (const r of reviews) if (counts[r.rating] !== undefined) counts[r.rating] += 1;
  return counts;
}

// The star picker of the review form: five real radio buttons in a group, so it works with a keyboard and a screen reader.
function StarInput({ value, onChange }) {
  return (
    <div className="rv-stars" role="radiogroup" aria-label="Your rating">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n === 1 ? '' : 's'}`} className={`rv-star${n <= value ? ' is-on' : ''}`} onClick={() => onChange(n)}>
          <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.5 6.1 20.7l1.2-6.6L2.5 9.5l6.6-.9L12 2.5z" fill="currentColor" /></svg>
        </button>
      ))}
    </div>
  );
}

// Reviews block of the product page: summary + histogram, the approved reviews, and the form for signed-in customers.
// The database decides who may post (RLS: only for a product in one of their Delivered orders); a rejected insert is
// explained instead of shown as an error.
export default function ProductReviews({ product, id = 'reviews' }) {
  const { currentUser, userProfile } = useAuth();
  const location = useLocation();
  const [reviews, setReviews] = useState(null);       // null = loading
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [mine, setMine] = useState(null);             // the customer's own review of this product, if any
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ rating: 0, title: '', body: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');          // inline result of the last submit

  useEffect(() => {
    let cancelled = false;
    setReviews(null); setFailed(false); setShown(PAGE);
    fetchReviews(product.id, { limit: 100 })
      .then(r => { if (!cancelled) setReviews(r); })
      .catch(() => { if (!cancelled) { setReviews([]); setFailed(true); } });
    return () => { cancelled = true; };
  }, [product.id]);

  useEffect(() => {
    setMine(null); setMessage(''); setFormOpen(false);
    if (!currentUser) return undefined;
    let cancelled = false;
    supabase.from('reviews').select('id, status, rating').eq('user_id', currentUser.id).eq('product_id', product.id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setMine(data || null); }, () => {});
    return () => { cancelled = true; };
  }, [currentUser, product.id]);

  const hist = useMemo(() => ratingHistogram(reviews || []), [reviews]);
  const total = (reviews || []).length;
  // Product rollups cover EVERY approved review; the fetched list is capped, so prefer them for the headline numbers.
  const count = Number(product.rating_count) > 0 ? Number(product.rating_count) : total;
  const avg = Number(product.rating_avg) > 0 ? Number(product.rating_avg) : (total ? (reviews.reduce((s, r) => s + r.rating, 0) / total) : 0);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    if (!form.rating) { setMessage('Please choose a star rating.'); return; }
    if (form.body.trim().length < 10) { setMessage('Please write a few words about the product (at least 10 characters).'); return; }
    setBusy(true); setMessage('');
    const name = (userProfile?.name || currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || '').trim() || 'Customer';
    const { error } = await supabase.from('reviews').insert({
      product_id: product.id, user_id: currentUser.id, user_name: name, rating: form.rating,
      title: form.title.trim().slice(0, 120), body: form.body.trim().slice(0, 2000), status: 'pending', verified_purchase: true,
    });
    setBusy(false);
    if (error) {
      // 42501 = row-level security refused it: no delivered order of theirs contains this product.
      if (error.code === '42501' || /row-level security/i.test(error.message || '')) setMessage('You can review a product after it has been delivered to you.');
      else if (error.code === '23505') { setMessage('You have already reviewed this product.'); setMine({ status: 'pending', rating: form.rating }); setFormOpen(false); }
      else setMessage('We could not submit your review. Please try again.');
      return;
    }
    setMine({ status: 'pending', rating: form.rating });
    setFormOpen(false);
    setForm({ rating: 0, title: '', body: '' });
    setMessage('');
    toast.success('Thanks! Your review will appear once approved.');
  }

  const list = reviews || [];
  return (
    <section className="pp-card" id={id} aria-labelledby={`${id}-h`}>
      <div className="rv-head">
        <h2 className="pp-h2" id={`${id}-h`}>Ratings &amp; reviews</h2>
        {!currentUser ? (
          <Link className="btn btn-outline btn-sm" to="/login" state={{ from: { pathname: location.pathname, search: location.search } }}>Sign in to write a review</Link>
        ) : mine ? null : (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setFormOpen(o => !o)} aria-expanded={formOpen}>Write a review</button>
        )}
      </div>

      {mine && (
        <p className="rv-note" role="status">
          {mine.status === 'approved' ? 'Thanks for reviewing this product — your review is live.'
            : mine.status === 'rejected' ? 'Your review was not published.'
            : 'Thanks! Your review will appear once approved.'}
        </p>
      )}

      {formOpen && !mine && (
        <form className="rv-form" onSubmit={submit} noValidate>
          <div className="form-group">
            <span className="form-label" id="rv-rating-l">Your rating</span>
            <StarInput value={form.rating} onChange={rating => setForm(f => ({ ...f, rating }))} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="rv-title">Title (optional)</label>
            <input id="rv-title" className="form-input" maxLength={120} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Sum it up in a few words" />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="rv-body">Your review</label>
            <textarea id="rv-body" className="form-textarea" rows={4} maxLength={2000} value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} placeholder="What did you like or dislike? How is the quality?" />
          </div>
          {message && <div className="form-error-box" role="alert">{message}</div>}
          <div className="rv-actions">
            <button type="submit" className="btn btn-gold" disabled={busy}>{busy ? 'Submitting…' : 'Submit review'}</button>
            <button type="button" className="btn btn-outline" onClick={() => { setFormOpen(false); setMessage(''); }}>Cancel</button>
          </div>
        </form>
      )}

      {reviews === null ? (
        <div className="rv-summary" aria-hidden="true"><div className="bl-skel-line lg" style={{ width: 120 }} /><div className="bl-skel-line" style={{ width: 200, marginTop: 14 }} /><div className="bl-skel-line" style={{ width: 180 }} /></div>
      ) : count === 0 && list.length === 0 ? (
        <p className="rv-empty">{failed ? 'Reviews could not be loaded right now.' : 'No reviews yet. Be the first to share what you think once your order arrives.'}</p>
      ) : (
        <>
          <div className="rv-summary">
            <div className="rv-avg">
              <div className="rv-avg-n">{avg.toFixed(1)}<span>/ 5</span></div>
              <StarRating value={avg} size={18} />
              <div className="rv-avg-c">{count.toLocaleString('en-IN')} {count === 1 ? 'rating' : 'ratings'}</div>
            </div>
            {total > 0 && <div className="rv-bars" aria-label="Rating breakdown">
              {[5, 4, 3, 2, 1].map(n => (
                <div key={n} className="rv-bar">
                  <span className="rv-bar-l">{n}★</span>
                  <span className="rv-bar-t"><span style={{ width: `${total ? Math.round((hist[n] / total) * 100) : 0}%` }} /></span>
                  <span className="rv-bar-n">{hist[n]}</span>
                </div>
              ))}
            </div>}
          </div>

          <ul className="rv-list">
            {list.slice(0, shown).map(r => (
              <li key={r.id} className="rv-item">
                <div className="rv-item-top">
                  <StarRating value={r.rating} size={14} />
                  {r.title && <b className="rv-item-title">{r.title}</b>}
                </div>
                {r.body && <p className="rv-item-body">{r.body}</p>}
                <div className="rv-item-meta">
                  <span>{r.user_name || 'Customer'}</span>
                  {r.verified_purchase && <span className="rv-verified">Verified purchase</span>}
                  <span>{fmtDate(r.created_at)}</span>
                </div>
              </li>
            ))}
          </ul>
          {list.length > shown && <button type="button" className="btn btn-outline btn-sm" onClick={() => setShown(n => n + PAGE)}>Show more reviews</button>}
        </>
      )}
    </section>
  );
}
