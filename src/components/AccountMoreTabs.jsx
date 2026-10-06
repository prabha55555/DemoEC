import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../supabase';
import { useBrand } from '../context/BrandContext';
import { safeQuery, isAuthExpiredError } from '../utils/safeFetch';
import { formatMoney } from '../utils/catalog';
import { fmtDate, isPlaceholderEmail, isValidIndianMobile, maskPhone } from '../utils/orderFormat';
import { EmptyState, LoadError, Loading, NavIcon, TabHead } from './AccountParts';

// ------------------------------------------------------------------------------------ coupons
const COUPON_COLUMNS = 'id, code, type, value, description, applies_to, min_order_value, max_discount, expires_at, max_uses, times_used, first_order_only';

export function CouponsTab() {
  const navigate = useNavigate();
  const [state, setState] = useState({ rows: [], loading: true, error: '' });

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: '' }));
    // RLS already limits this to public, currently valid coupons that still have uses left.
    const res = await safeQuery(supabase.from('coupons').select(COUPON_COLUMNS).order('created_at', { ascending: false }));
    if (isAuthExpiredError(res.error)) { toast.error('Your session has expired — please sign in again.'); navigate('/login'); return; }
    if (res.error) { setState({ rows: [], loading: false, error: 'Please check your connection and try again.' }); return; }
    const rows = (res.data || []).filter(c => !(Number(c.max_uses) > 0 && Number(c.times_used) >= Number(c.max_uses)));
    setState({ rows, loading: false, error: '' });
  }, [navigate]);
  useEffect(() => { load(); }, [load]);

  async function copyCode(code) {
    try { await navigator.clipboard?.writeText(code); toast.success(`${code} copied.`); }
    catch { toast(`Your code is ${code}`); }
  }

  const terms = (c) => [
    Number(c.min_order_value) > 0 && `Minimum order ${formatMoney(c.min_order_value)}`,
    c.type === 'percent' && Number(c.max_discount) > 0 && `Up to ${formatMoney(c.max_discount)} off`,
    c.applies_to === 'products' && 'On selected products',
    c.applies_to === 'categories' && 'On selected categories',
    c.applies_to === 'bundle' && 'Buy the qualifying items together',
    c.first_order_only && 'First order only',
    c.expires_at && `Valid till ${fmtDate(c.expires_at)}`,
  ].filter(Boolean);

  return (
    <div>
      <TabHead title="Available coupons" sub="Copy a code and apply it at checkout." />
      {state.error ? <LoadError message={state.error} onRetry={load} />
        : state.loading ? <Loading label="Loading coupons" />
        : state.rows.length === 0 ? <EmptyState art="coupons" title="No coupons right now" text="Check back soon for new offers." cta="Continue shopping" onCta={() => navigate('/shop')} />
        : (
          <div className="acc-tickets">
            {state.rows.map(c => (
              <div key={c.id} className="acc-ticket">
                <div className="acc-ticket-stub">
                  <div className="acc-ticket-big">{c.type === 'percent' ? `${Number(c.value)}%` : formatMoney(c.value)}</div>
                  <div className="acc-ticket-small">OFF</div>
                </div>
                <div className="acc-ticket-main">
                  <div style={{ minWidth: 0 }}>
                    <div className="acc-ticket-kind">Coupon</div>
                    <span className="acc-code is-coupon">{c.code}</span>
                    {c.description && <div className="acc-ticket-desc">{c.description}</div>}
                    <ul className="acc-terms">{terms(c).map(t => <li key={t}>{t}</li>)}</ul>
                  </div>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => copyCode(c.code)} aria-label={`Copy code ${c.code}`}>Copy code</button>
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------------- gift cards
// "Keep the code on file" registry: the codes live on the profile; balances are read through api/lookup.js.
export function GiftCardsTab({ userProfile, updateProfile }) {
  const navigate = useNavigate();
  const { brand } = useBrand();
  const [showModal, setShowModal] = useState(false);
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [balances, setBalances] = useState({});
  const [loadingBalances, setLoadingBalances] = useState(true);
  const cards = userProfile?.gift_cards || [];

  useEffect(() => {
    const codes = cards.map(c => c.code);
    if (codes.length === 0) { setLoadingBalances(false); return; }
    setLoadingBalances(true);
    // Routed through api/lookup.js instead of querying the gift_cards table directly -- see Checkout.jsx's applyGiftCard.
    fetch('/api/lookup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'gift-card', codes }),
    }).then(res => res.json()).then(({ giftCards }) => {
      const map = {};
      (giftCards || []).forEach(g => { map[g.code] = { balance: g.balance, expiresAt: g.expires_at }; });
      setBalances(map);
      setLoadingBalances(false);
    }).catch(() => setLoadingBalances(false)); // a network-level failure -- without this every card is stuck "Checking balance..."
    // eslint-disable-next-line
  }, [userProfile?.gift_cards]);

  async function linkCard() {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) { toast.error('Enter a gift card code.'); return; }
    if (cards.some(c => c.code === trimmed)) { toast.error('That code is already linked to your account.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/lookup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'gift-card', code: trimmed }),
      });
      const { giftCard: data } = await res.json().catch(() => ({}));
      if (!res.ok || !data) { toast.error('That code was not found.'); return; }
      await updateProfile({ gift_cards: [...cards, { code: trimmed, added_at: new Date().toISOString() }] });
      toast.success(`Gift card linked — ${formatMoney(data.balance)} available.`);
      setCode(''); setShowModal(false);
    } catch { toast.error('Failed to link gift card.'); }
    finally { setSaving(false); }
  }

  async function removeCard(codeToRemove) {
    try { await updateProfile({ gift_cards: cards.filter(c => c.code !== codeToRemove) }); toast.success('Removed.'); }
    catch { toast.error('Could not remove it. Please try again.'); }
  }

  const modalRef = useRef(null);
  useEffect(() => { if (showModal) modalRef.current?.querySelector('input')?.focus(); }, [showModal]);

  return (
    <div>
      <TabHead
        title="My gift cards"
        sub={`Received a ${brand?.brand_name || 'store'} gift card? Link its code here to keep it on file and see its remaining balance. Apply it at checkout when you are ready to use it.`}
        action={<button type="button" className="btn btn-outline btn-sm" onClick={() => setShowModal(true)}>Add new</button>}
      />

      {cards.length === 0 ? (
        <EmptyState art="giftcards" title="No gift cards linked" text="Link a code you received, or give someone a gift card." cta="Buy a gift card" onCta={() => navigate('/gift-card')} />
      ) : (
        <div className="acc-tickets">
          {cards.map(c => {
            const bal = balances[c.code];
            return (
              <div key={c.code} className="acc-ticket is-gift">
                <div className="acc-ticket-stub">
                  <div className="acc-ticket-big">{loadingBalances ? '…' : bal !== undefined ? formatMoney(bal.balance) : '—'}</div>
                  <div className="acc-ticket-small">{loadingBalances ? 'Checking balance…' : bal !== undefined ? 'available' : 'Balance unavailable'}</div>
                </div>
                <div className="acc-ticket-main">
                  <div style={{ minWidth: 0 }}>
                    <div className="acc-ticket-kind">Gift card</div>
                    <div className="acc-code">{c.code}</div>
                    <div className="acc-muted" style={{ marginTop: 4 }}>
                      Added {fmtDate(c.added_at)}
                      {bal?.expiresAt && (
                        new Date(bal.expiresAt) < new Date()
                          ? <span style={{ color: 'var(--error)' }}> · Expired {fmtDate(bal.expiresAt)}</span>
                          : <span> · Valid until {fmtDate(bal.expiresAt)}</span>
                      )}
                    </div>
                  </div>
                  <button type="button" onClick={() => removeCard(c.code)} className="btn btn-danger btn-sm">Remove</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <div className="acc-modal-back" onMouseDown={e => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className="acc-modal" role="dialog" aria-modal="true" aria-labelledby="acc-gc-title" ref={modalRef} onKeyDown={e => { if (e.key === 'Escape') setShowModal(false); }}>
            <button type="button" className="acc-modal-x" onClick={() => setShowModal(false)} aria-label="Close">×</button>
            <h3 id="acc-gc-title" className="acc-h" style={{ fontSize: 18, marginBottom: 16 }}>Link a gift card</h3>
            <label className="form-label" htmlFor="acc-gc-code">Gift card code</label>
            <input
              id="acc-gc-code"
              className="form-input"
              value={code}
              onChange={e => setCode(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); linkCard(); } }}
              placeholder="e.g. BL-GC-XXXX-XXXX-XXXX"
              style={{ marginBottom: 18, textTransform: 'uppercase', fontSize: 16 }}
            />
            <button type="button" className="btn btn-gold btn-full" onClick={linkCard} disabled={saving}>{saving ? <span className="spinner" role="status" aria-label="Linking" /> : 'Link gift card'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------ back-in-stock alerts
// Subscriptions requested from a sold-out product (src/components/NotifyWhenAvailable.jsx). They are
// per variant now; older rows only carry a size, so the label falls back to that.
export function NotificationsTab({ currentUser }) {
  const navigate = useNavigate();
  const [state, setState] = useState({ rows: [], labels: {}, loading: true, error: '' });

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: '' }));
    const res = await safeQuery(supabase.from('product_notifications')
      .select('id, product_id, variant_id, product_name, size, status, created_at, notified_at')
      .eq('user_id', currentUser.id).order('created_at', { ascending: false }));
    if (isAuthExpiredError(res.error)) { toast.error('Your session has expired — please sign in again.'); navigate('/login'); return; }
    if (res.error && res.error.code !== '42P01') { setState({ rows: [], labels: {}, loading: false, error: 'Please check your connection and try again.' }); return; }
    const rows = res.data || [];
    const variantIds = [...new Set(rows.map(r => r.variant_id).filter(Boolean))];
    let labels = {};
    if (variantIds.length) {
      const v = await safeQuery(supabase.from('product_variants').select('id, label').in('id', variantIds));
      labels = Object.fromEntries((v.data || []).map(x => [x.id, x.label]));
    }
    setState({ rows, labels, loading: false, error: '' });
  }, [currentUser.id, navigate]);
  useEffect(() => { load(); }, [load]);

  if (state.error) return <><TabHead title="Notifications" /><LoadError message={state.error} onRetry={load} /></>;
  if (state.loading) return <><TabHead title="Notifications" /><Loading label="Loading notifications" /></>;
  if (!state.rows.length) {
    return (
      <>
        <TabHead title="Notifications" />
        <EmptyState art="notifications" title="No back-in-stock alerts yet" text="Ask to be notified on a sold-out product and it will be listed here." cta="Explore products" onCta={() => navigate('/shop')} />
      </>
    );
  }
  return (
    <>
      <TabHead title="Notifications" sub="We email you when these are back in stock." />
      <div className="acc-card acc-list">
        {state.rows.map(n => {
          const label = (n.variant_id && state.labels[n.variant_id]) || n.size || '';
          return (
            <div key={n.id} className="acc-lrow">
              <span className="acc-lico" aria-hidden="true"><NavIcon name="notifications" size={18} /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <a href={`/product/${n.product_id}`} className="acc-lname">{n.product_name}</a>
                <div className="acc-muted">{[label && label !== 'Default' ? label : null, n.created_at ? `Requested ${fmtDate(n.created_at)}` : null].filter(Boolean).join(' · ')}</div>
              </div>
              <span className={n.status === 'notified' ? 'badge badge-confirmed' : 'badge badge-pending'}>{n.status === 'notified' ? 'Notified' : 'Waiting for stock'}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------- my queries
// Questions the customer sent the store about a product (the `enquiries` table).
export function SupportTab({ currentUser }) {
  const navigate = useNavigate();
  const [state, setState] = useState({ rows: [], loading: true, error: '' });

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true, error: '' }));
    const res = await safeQuery(supabase.from('enquiries').select('id, product, message, type, status, created_at').eq('user_id', currentUser.id).order('created_at', { ascending: false }));
    if (isAuthExpiredError(res.error)) { toast.error('Your session has expired — please sign in again.'); navigate('/login'); return; }
    if (res.error) { setState({ rows: [], loading: false, error: 'Please check your connection and try again.' }); return; }
    setState({ rows: res.data || [], loading: false, error: '' });
  }, [currentUser.id, navigate]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <TabHead title="My queries" sub="Questions you have sent us, and where they stand." />
      {state.error ? <LoadError message={state.error} onRetry={load} />
        : state.loading ? <Loading label="Loading your queries" />
        : state.rows.length === 0 ? <EmptyState art="enquiries" title="No queries yet" text="Questions you send us about a product will show up here." cta="Browse products" onCta={() => navigate('/shop')} />
        : (
          <div className="acc-card acc-list">
            {state.rows.map(e => (
              <div key={e.id} className="acc-lrow">
                <span className="acc-lico" aria-hidden="true"><NavIcon name="enquiries" size={18} /></span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="acc-lname">{e.product || 'General query'}</div>
                  {e.message && <div className="acc-muted" style={{ overflowWrap: 'anywhere' }}>{String(e.message).slice(0, 140)}</div>}
                  <div className="acc-muted">{e.created_at ? fmtDate(e.created_at) : ''}</div>
                </div>
                <div className="acc-lbadges">
                  {e.type && <span className="badge badge-confirmed">{e.type}</span>}
                  <span className="badge badge-pending">{e.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
    </>
  );
}

// ------------------------------------------------------------------------------ account details
export function DetailsTab({ userProfile, currentUser, updateProfile }) {
  const mobileAccount = !!currentUser?.app_metadata?.msg91_phone;
  const placeholder = isPlaceholderEmail(currentUser?.email);
  const [form, setForm] = useState({ name: userProfile?.name || '', phone: userProfile?.phone || '' });
  const [marketingOptIn, setMarketingOptIn] = useState(!!userProfile?.marketing_opt_in);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  // If this tab mounts before userProfile has finished loading (e.g. a hard refresh straight into
  // ?tab=details), the initial state would hold blanks and Save would push them over the real values.
  // Backfills once, the first time real profile data arrives; never again, so it can't clobber an edit.
  const syncedRef = useRef(!!userProfile);
  useEffect(() => {
    if (syncedRef.current || !userProfile) return;
    syncedRef.current = true;
    setForm({ name: userProfile.name || '', phone: userProfile.phone || '' });
    setMarketingOptIn(!!userProfile.marketing_opt_in);
  }, [userProfile]);

  async function save() {
    const e = {};
    if (!form.name.trim()) e.name = 'Please enter your name';
    // A mobile-OTP account's number is its login: it is shown, not edited here.
    if (!mobileAccount && form.phone.trim() && !isValidIndianMobile(form.phone)) e.phone = 'Enter a valid 10-digit mobile number';
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      await updateProfile({ name: form.name.trim(), ...(mobileAccount ? {} : { phone: form.phone.trim() }), marketing_opt_in: marketingOptIn });
      toast.success('Details updated.');
    } catch { toast.error('Could not save your details. Please try again.'); }
    finally { setSaving(false); }
  }

  const phoneShown = mobileAccount ? maskPhone(userProfile?.phone || currentUser.app_metadata.msg91_phone) : form.phone;
  return (
    <div style={{ maxWidth: 640 }}>
      <TabHead title="Account details" sub="Keep your contact details up to date so we can reach you about your orders." />
      <div className="acc-card acc-form-card">
        <div className="acc-form-grid" style={{ marginBottom: 18 }}>
          <div>
            <label className="form-label" htmlFor="acct-name">Full name</label>
            <input id="acct-name" className="form-input" value={form.name} onChange={e => { setForm(f => ({ ...f, name: e.target.value })); setErrors(x => ({ ...x, name: '' })); }} autoComplete="name" aria-invalid={errors.name ? 'true' : undefined} aria-describedby={errors.name ? 'acct-name-err' : undefined} />
            {errors.name && <div className="form-error" id="acct-name-err" role="alert">{errors.name}</div>}
          </div>
          <div>
            <label className="form-label" htmlFor="acct-phone">Mobile number</label>
            <input id="acct-phone" className="form-input" type="tel" inputMode="tel" value={phoneShown} disabled={mobileAccount} maxLength={15}
              onChange={e => { setForm(f => ({ ...f, phone: e.target.value })); setErrors(x => ({ ...x, phone: '' })); }} autoComplete="tel"
              aria-invalid={errors.phone ? 'true' : undefined} aria-describedby={errors.phone ? 'acct-phone-err' : mobileAccount ? 'acct-phone-note' : undefined} />
            {errors.phone && <div className="form-error" id="acct-phone-err" role="alert">{errors.phone}</div>}
            {mobileAccount && <div className="acc-muted" id="acct-phone-note" style={{ marginTop: 4 }}>This verified number is how you sign in.</div>}
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="form-label" htmlFor="acct-email">Email</label>
            <input id="acct-email" className="form-input" value={placeholder ? '' : (currentUser.email || '')} placeholder={placeholder ? 'No email on this account' : undefined} disabled />
            {placeholder && <div className="acc-muted" style={{ marginTop: 4 }}>You can enter an email at checkout to receive order updates.</div>}
          </div>
        </div>
        <div className="form-group">
          <label className="acc-check">
            <input type="checkbox" checked={marketingOptIn} onChange={e => setMarketingOptIn(e.target.checked)} />
            <span>Email me about new products and special offers.</span>
          </label>
        </div>
        <button type="button" className="btn btn-gold" onClick={save} disabled={saving} aria-busy={saving}>{saving ? <span className="spinner" role="status" aria-label="Saving" /> : 'Save changes'}</button>
      </div>
    </div>
  );
}
