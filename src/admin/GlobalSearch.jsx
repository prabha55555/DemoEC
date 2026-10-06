import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { withTimeout } from '../utils/withTimeout';
import useDebounce from './hooks/useDebounce';
import useDismiss from './hooks/useDismiss';
import { sanitizeSearch } from './hooks/serverList';
import { Icon, StatusPill } from './ui';
import { formatMoney } from './lib/format';

// The top-bar search: type an order number ("BL-20001"), a customer's name or email, a product name or a
// product number and jump straight there. Results are grouped; ↑ ↓ moves, Enter opens, Esc closes, "/" focuses it.
// Enter with nothing highlighted goes to the order if the text looks like an order number, to the only match if
// there is exactly one, and otherwise to the products list filtered by the text (/admin/products?q=…).
const MIN_CHARS = 2;
const looksLikeOrderNumber = (q) => /^(bl-?)?\d{4,}$/i.test(q.trim());

async function runSearch(text) {
  const t = sanitizeSearch(text);
  const [orders, products] = await Promise.all([
    withTimeout(supabase.from('orders').select('id, order_id, user_name, user_email, total, status')
      .or(`order_id.ilike.%${t}%,user_name.ilike.%${t}%,user_email.ilike.%${t}%`).is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(5), 10000),
    withTimeout(supabase.from('products').select('id, product_number, name, status')
      .or(`name.ilike.%${t}%,product_number.ilike.%${t}%`).order('name').limit(5), 10000),
  ]);
  return {
    orders: orders.error ? [] : (orders.data || []),
    products: products.error ? [] : (products.data || []),
    failed: !!(orders.error && products.error),
  };
}

export default function GlobalSearch() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState({ orders: [], products: [], failed: false });
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const wrap = useRef(null);
  const input = useRef(null);
  const listId = useId();
  const q = useDebounce(text, 250);
  const trimmed = sanitizeSearch(text);
  const ready = trimmed.length >= MIN_CHARS;

  // Fetch whenever the debounced text changes (stale answers are dropped).
  useEffect(() => {
    const query = sanitizeSearch(q);
    if (query.length < MIN_CHARS) { setRes({ orders: [], products: [], failed: false }); setLoading(false); return undefined; }
    let cancelled = false;
    setLoading(true);
    runSearch(query)
      .then(r => { if (!cancelled) { setRes(r); setLoading(false); setActive(-1); } })
      .catch(() => { if (!cancelled) { setRes({ orders: [], products: [], failed: true }); setLoading(false); } });
    return () => { cancelled = true; };
  }, [q]);

  // The flat list of things Enter / arrows can land on.
  const items = useMemo(() => [
    ...res.orders.map(o => ({ kind: 'order', key: `o${o.id}`, to: `/admin/orders/${o.order_id}`, o })),
    ...res.products.map(p => ({ kind: 'product', key: `p${p.id}`, to: `/admin/products/${p.id}`, p })),
    { kind: 'all', key: 'all-products', to: `/admin/products?q=${encodeURIComponent(trimmed)}`, label: `All products matching “${trimmed}”` },
    { kind: 'all', key: 'all-orders', to: `/admin/orders?q=${encodeURIComponent(trimmed)}`, label: `All orders matching “${trimmed}”` },
  ], [res, trimmed]);

  const close = useCallback(() => { setOpen(false); setActive(-1); }, []);
  useDismiss(wrap, open, close);
  // Moving to another screen closes the list and empties the box.
  useEffect(() => { setOpen(false); setText(''); }, [pathname]);

  // "/" focuses the search from anywhere that is not a text field.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (el && el.isContentEditable) return;
      e.preventDefault();
      input.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function go(to) { close(); setText(''); navigate(to); }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(items.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(-1, a - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (!ready) return;
      if (active >= 0 && items[active]) return go(items[active].to);
      if (looksLikeOrderNumber(trimmed) && res.orders[0]) return go(items.find(i => i.kind === 'order').to);
      const real = items.filter(i => i.kind !== 'all');
      if (real.length === 1) return go(real[0].to);
      go(`/admin/products?q=${encodeURIComponent(trimmed)}`);
    }
  }

  const rowId = (i) => `${listId}-${i}`;
  let idx = -1;
  const show = open && ready;

  return (
    <div className="adm-search" ref={wrap}>
      <Icon name="search" size={17} />
      <input
        ref={input} role="combobox" aria-expanded={show} aria-controls={listId} aria-autocomplete="list" aria-haspopup="listbox"
        aria-activedescendant={active >= 0 ? rowId(active) : undefined}
        value={text} onChange={e => { setText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKeyDown}
        placeholder="Search orders, customers, products  ( / )" aria-label="Search orders, customers and products"
        autoComplete="off" spellCheck={false}
      />
      {show && (
        <div className="adm-pop results" id={listId} role="listbox" aria-label="Search results">
          {loading && res.orders.length === 0 && res.products.length === 0 && <div className="adm-pop-empty" role="status">Searching…</div>}
          {!loading && res.failed && <div className="adm-pop-empty">Search is unavailable right now.</div>}
          {!loading && !res.failed && res.orders.length === 0 && res.products.length === 0 && <div className="adm-pop-empty">No orders or products match “{trimmed}”.</div>}
          {res.orders.length > 0 && <div className="adm-pop-group" role="presentation">Orders</div>}
          {res.orders.map(o => { idx += 1; const i = idx; return (
            <button key={o.id} id={rowId(i)} role="option" aria-selected={active === i} type="button" className={`adm-pop-item${active === i ? ' is-active' : ''}`}
              onMouseEnter={() => setActive(i)} onClick={() => go(`/admin/orders/${o.order_id}`)}>
              <span className="adm-pop-item-ico" style={{ background: '#FFF1D6', color: '#8A5000' }}><Icon name="cart" size={17} /></span>
              <span className="adm-pop-item-main">
                <span className="adm-pop-item-t">{o.order_id} · {o.user_name || o.user_email || 'Guest'}</span>
                <span className="adm-pop-item-d">{formatMoney(o.total)}</span>
              </span>
              <StatusPill status={o.status} kind="order" />
            </button>
          ); })}
          {res.products.length > 0 && <div className="adm-pop-group" role="presentation">Products</div>}
          {res.products.map(p => { idx += 1; const i = idx; return (
            <button key={p.id} id={rowId(i)} role="option" aria-selected={active === i} type="button" className={`adm-pop-item${active === i ? ' is-active' : ''}`}
              onMouseEnter={() => setActive(i)} onClick={() => go(`/admin/products/${p.id}`)}>
              <span className="adm-pop-item-ico" style={{ background: '#E4F6F3', color: '#0F766E' }}><Icon name="box" size={17} /></span>
              <span className="adm-pop-item-main">
                <span className="adm-pop-item-t">{p.name}</span>
                <span className="adm-pop-item-d">{p.product_number || 'No product number'}</span>
              </span>
              <StatusPill status={p.status} kind="product" />
            </button>
          ); })}
          {['all-products', 'all-orders'].map((k) => { idx += 1; const i = idx; const it = items.find(x => x.key === k); return (
            <button key={k} id={rowId(i)} role="option" aria-selected={active === i} type="button" className={`adm-pop-item${active === i ? ' is-active' : ''}`}
              onMouseEnter={() => setActive(i)} onClick={() => go(it.to)}>
              <span className="adm-pop-item-ico" style={{ background: 'var(--adm-fill-2)', color: 'var(--adm-body)' }}><Icon name="search" size={16} /></span>
              <span className="adm-pop-item-main"><span className="adm-pop-item-t">{it.label}</span></span>
            </button>
          ); })}
        </div>
      )}
    </div>
  );
}
