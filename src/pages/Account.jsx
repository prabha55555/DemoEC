import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../context/AuthContext';
import { useCartActions } from '../context/CartContext';
import { fmt, fmtDate, formatDeliveryLabel } from '../data/products';
import { thumb } from '../utils/thumbnail';
import { getWishlist, toggleSaved } from '../utils/wishlist';
import { isProductSoldOut, productAddToCartPayload, withShippingCharge } from '../data/products';
import { safeQuery, isAuthExpiredError } from '../utils/safeFetch';
import { safeHref } from '../utils/safeUrl';
import { INDIAN_STATES, lookupPincode } from '../utils/indianAddress';
import { whatsappLink } from '../config/company';
import toast from 'react-hot-toast';

const NAV_ICONS = {
  dashboard: <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></>,
  orders: <><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" /><polyline points="3.29 7 12 12 20.71 7" /><line x1="12" y1="22" x2="12" y2="12" /></>,
  wishlist: <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />,
  giftcards: <><polyline points="20 12 20 22 4 22 4 12" /><rect x="2" y="7" width="20" height="5" /><line x1="12" y1="22" x2="12" y2="7" /><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z" /><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z" /></>,
  coupons: <><path d="M20.59 13.41L13.42 20.58a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></>,
  enquiries: <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />,
  notifications: <><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" /></>,
  addresses: <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></>,
  details: <><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  logout: <><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></>,
};

function NavIcon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true">
      {NAV_ICONS[name]}
    </svg>
  );
}

// The real fulfillment stages an order moves through after payment (mirrors
// Admin's STATUSES, minus the pre-payment "Pending" state and the terminal
// "Cancelled" exception, both handled separately below).
const ORDER_STAGES = ['Paid', 'Confirmed', 'Shipped', 'Out for Delivery', 'Delivered'];

function OrderStageTracker({ status }) {
  if (status === 'Cancelled') {
    return (
      <div className="acc-cancelled" role="status">This order was cancelled.</div>
    );
  }
  // 'Pending' is a pre-payment/legacy state -- hasn't reached the first real stage yet.
  const currentIdx = status === 'Pending' ? -1 : ORDER_STAGES.indexOf(status);
  return (
    <div className="acc-stages">
      {ORDER_STAGES.map((stage, i) => {
        const done = i <= currentIdx;
        const isLast = i === ORDER_STAGES.length - 1;
        return (
          <React.Fragment key={stage}>
            <div className="acc-stage">
              <div className={`acc-stage-dot${done ? ' is-done' : ''}`}>
                {done && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>}
              </div>
              <div className={`acc-stage-label${done ? ' is-done' : ''}`}>{stage}</div>
            </div>
            {!isLast && <div className={`acc-stage-bar${i < currentIdx ? ' is-done' : ''}`} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// Always-visible 3-step summary on every order card (Ordered -> Shipped -> Delivered),
// derived from the same status value the detailed tracker above uses.
const MINI_STEPS = ['Ordered', 'Shipped', 'Delivered'];
function miniDone(status) {
  if (status === 'Delivered') return 3;
  if (status === 'Shipped' || status === 'Out for Delivery') return 2;
  if (status === 'Pending') return 0;
  return 1; // Paid / Confirmed
}

function OrderMiniTrack({ status }) {
  if (status === 'Cancelled') {
    return <div className="acc-mini is-cancelled" role="status">This order was cancelled.</div>;
  }
  const done = miniDone(status);
  return (
    <ol className="acc-mini" aria-label={`Order progress: ${done === 0 ? 'awaiting confirmation' : `${MINI_STEPS[done - 1]} complete`}`}>
      {MINI_STEPS.map((step, i) => (
        <li key={step} className={`acc-mini-step${i < done ? ' is-done' : i === done ? ' is-now' : ''}`}>
          <span className="acc-mini-dot">
            {i < done && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>}
          </span>
          <span className="acc-mini-label">{step}</span>
        </li>
      ))}
    </ol>
  );
}

// Shown once an order has actually shipped AND the admin entered
// something to show (Admin.jsx's Orders tab "Shipping / Tracking" field).
// Never constructs a tracking URL itself from the carrier name -- only ever
// renders `tracking_url` verbatim if the admin actually entered one, and only
// through safeHref() (same guard as every other admin-entered link in this
// codebase), so an unsafe/invalid value silently drops the button instead of
// becoming a real href.
function ShipmentTracking({ order }) {
  const shippedIdx = ORDER_STAGES.indexOf('Shipped');
  const currentIdx = (order.status === 'Pending' || order.status === 'Cancelled') ? -1 : ORDER_STAGES.indexOf(order.status);
  if (currentIdx < shippedIdx) return null;
  const carrier = order.shipping_carrier;
  const trackingNumber = order.tracking_number;
  const trackingHref = order.tracking_url ? safeHref(order.tracking_url) : '';
  if (!carrier && !trackingNumber && !trackingHref) return null;
  return (
    <div className="acc-shipment">
      {carrier && <div><strong>Carrier:</strong> {carrier}</div>}
      {trackingNumber && <div style={{ userSelect: 'text' }}><strong>Tracking number:</strong> {trackingNumber}</div>}
      {trackingHref && (
        <a href={trackingHref} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }}>Track shipment</a>
      )}
    </div>
  );
}

// Small outline illustrations for the empty states (inline SVG on a 64x64 grid, drawn with the
// .acc-ill-line stroke style below).
const EMPTY_ART = {
  orders: <>
    <path d="M10 22L32 11l22 11v22L32 55 10 44z" />
    <path d="M10 22l22 11 22-11M32 33v22" />
    <path d="M21 16.5l22 11" />
  </>,
  wishlist: <>
    <path d="M32 54C13 41 8 27 14 19c5-6 14-5 18 2 4-7 13-8 18-2 6 8 1 22-18 35z" />
  </>,
  giftcards: <>
    <rect x="10" y="28" width="44" height="26" rx="2" />
    <rect x="8" y="20" width="48" height="8" rx="2" />
    <path d="M32 20v34" />
    <path d="M32 20c-3-9-14-9-14-3s10 4 14 3zM32 20c3-9 14-9 14-3s-10 4-14 3z" />
  </>,
  coupons: <>
    <path d="M8 16h48v10a6 6 0 000 12v10H8V38a6 6 0 000-12z" />
    <path d="M42 18v28" strokeDasharray="3 3" />
    <circle cx="21" cy="27" r="3" />
    <circle cx="31" cy="37" r="3" />
    <path d="M32 25L20 39" />
  </>,
  enquiries: <>
    <path d="M8 12h48v30H27L15 53V42H8z" />
    <path d="M21 27h2M31 27h2M41 27h2" strokeWidth="3" />
  </>,
  notifications: <>
    <path d="M32 9c-9 0-15 7-15 16v9l-5 8h40l-5-8v-9c0-9-6-16-15-16z" />
    <path d="M26 47a6 6 0 0012 0M32 9V6" />
  </>,
  addresses: <>
    <path d="M32 56S14 41 14 26a18 18 0 0136 0c0 15-18 30-18 30z" />
    <circle cx="32" cy="26" r="6" />
  </>,
};

function EmptyState({ art, title, text, cta, onCta }) {
  return (
    <div className="acc-empty">
      <svg className="acc-ill" viewBox="0 0 64 64" aria-hidden="true">
        <ellipse className="acc-ill-ground" cx="32" cy="60" rx="20" ry="2.5" />
        <g className="acc-ill-line">{EMPTY_ART[art]}</g>
      </svg>
      <div className="acc-empty-title">{title}</div>
      {text && <div className="acc-empty-text">{text}</div>}
      {cta && <button className="btn btn-gold" onClick={onCta}>{cta}</button>}
    </div>
  );
}

function TabHead({ title, sub, action }) {
  return (
    <div className="acc-head">
      <div>
        <h2 className="acc-h">{title}</h2>
        {sub && <p className="acc-sub">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

const ACCOUNT_CSS = `
  .acc-page { padding-top: var(--hdr-h); min-height: 100vh; background: var(--bg); }
  .acc-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

  /* ── Layout: grey page, white bordered cards ───────────── */
  .acc-wrap { padding-top: 0; padding-bottom: 40px; }
  .acc-layout { display: grid; grid-template-columns: minmax(0,1fr); gap: 0; align-items: start; }
  .acc-content { min-width: 0; padding-top: 14px; }
  .acc-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; }

  /* ── Profile row (avatar circle + name / email) ───────── */
  .acc-profile { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .acc-avatar { width: 44px; height: 44px; border-radius: 50%; flex-shrink: 0; background: var(--primary-tint); border: 1px solid var(--primary-border); color: var(--primary); font-weight: 600; font-size: 18px; display: flex; align-items: center; justify-content: center; }
  .acc-pinfo { min-width: 0; flex: 1; }
  .acc-pname { font-weight: 500; font-size: 15px; line-height: 1.3; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .acc-pmeta { font-size: 12.5px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.4; }

  /* ── Mobile: slim profile row + underline tab strip ───── */
  .account-sidebar { display: none; }
  .acc-mtop { margin: 0 -14px; background: #fff; border-bottom: 1px solid var(--border); min-width: 0; }
  .acc-mtop .acc-profile { padding: 10px 14px; }
  .acc-mtop .acc-avatar { width: 40px; height: 40px; font-size: 16px; }
  .acc-mtop .acc-pmeta + .acc-pmeta { display: none; }
  .acc-mlogout { flex-shrink: 0; min-height: 34px; padding: 0 12px; border: 1px solid var(--border); border-radius: 6px; background: #fff; color: var(--error); font-size: 13px; font-weight: 500; }
  .account-nav-scroll { display: flex; overflow-x: auto; scrollbar-width: none; border-top: 1px solid var(--border); padding: 0 6px; }
  .account-nav-scroll::-webkit-scrollbar { display: none; }
  .acc-pill { flex-shrink: 0; min-height: 44px; padding: 0 12px; margin-bottom: -1px; border: none; border-bottom: 2px solid transparent; background: transparent; color: var(--text-muted); font-size: 13.5px; font-weight: 500; white-space: nowrap; transition: color .15s, border-color .15s; }
  .acc-pill.is-active { color: var(--primary); border-bottom-color: var(--primary); font-weight: 600; }

  /* ── Desktop: bordered nav card (profile row, vertical list, log out) ── */
  .acc-side { position: sticky; top: calc(var(--hdr-h) + 14px); margin-top: 14px; background: #fff; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .acc-side .acc-profile { padding: 16px; border-bottom: 1px solid var(--border); }
  .acc-nav { display: flex; flex-direction: column; padding: 6px 0; }
  .acc-navbtn { position: relative; display: flex; align-items: center; gap: 14px; width: 100%; min-height: 46px; padding: 0 16px; border: none; background: transparent; color: var(--text); font-size: 14px; font-weight: 500; text-align: left; transition: background .12s, color .12s; }
  .acc-navbtn:focus-visible { outline-offset: -2px; }
  .acc-navico { display: flex; flex-shrink: 0; color: var(--text-muted); }
  .acc-navbtn:hover { background: #F5F8F7; }
  .acc-navbtn.is-active { background: var(--primary-tint); color: var(--primary); }
  .acc-navbtn.is-active .acc-navico { color: var(--primary); }
  .acc-navbtn.is-active::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--primary); }
  .acc-navcount { margin-left: auto; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: #EEF2F1; color: var(--text-muted); font-size: 11.5px; font-weight: 600; display: flex; align-items: center; justify-content: center; }
  .acc-navbtn.is-active .acc-navcount { background: #fff; color: var(--primary); }
  .acc-navsep { height: 1px; background: var(--border); margin: 6px 0; }
  .acc-navbtn.is-logout, .acc-navbtn.is-logout .acc-navico { color: var(--error); }
  .acc-navbtn.is-logout:hover { background: #FDEBE9; }

  /* ── Headings & small text ────────────────────────────── */
  .acc-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
  .acc-h { font-family: var(--font-head); font-weight: 500; font-size: clamp(18px, 2vw, 22px); line-height: 1.25; color: var(--text); margin: 0; }
  .acc-sub { font-size: 13px; color: var(--text-muted); margin: 3px 0 0; line-height: 1.5; max-width: 560px; }
  .acc-muted { font-size: 12.5px; color: var(--text-muted); line-height: 1.45; }
  .acc-link { display: inline-block; font-size: 13px; font-weight: 500; color: var(--primary); padding: 6px 0; }
  .acc-link:hover { text-decoration: underline; }
  .acc-linkbtn { background: none; border: none; padding: 6px 0; }
  .acc-price { font-weight: 600; font-size: 16px; color: var(--text); }

  /* ── Dashboard ────────────────────────────────────────── */
  .acc-hello { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
  .acc-hello h2 { font-family: var(--font-head); font-weight: 500; font-size: clamp(18px, 2vw, 22px); line-height: 1.25; color: var(--text); margin: 0; overflow-wrap: anywhere; }
  .acc-hello p { font-size: 13.5px; color: var(--text-muted); line-height: 1.5; margin: 3px 0 0; max-width: 520px; }
  .acc-tiles { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; }
  .acc-tile { text-align: left; display: flex; flex-direction: column; gap: 10px; padding: 14px; background: #fff; border: 1px solid var(--border); border-radius: 8px; color: var(--text); transition: border-color .15s; }
  .acc-tile:hover { border-color: var(--primary); }
  .acc-tile-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .acc-tile-ico { width: 40px; height: 40px; border-radius: 50%; background: var(--primary-tint); color: var(--primary); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .acc-tile-count { font-weight: 600; font-size: 18px; line-height: 1; color: var(--text); }
  .acc-tile-label { font-size: 14px; font-weight: 500; color: var(--text); }
  .acc-tile-hint { font-size: 12px; color: var(--text-muted); margin-top: 2px; line-height: 1.35; }
  .acc-help { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 12px; padding: 14px 16px; background: #fff; border: 1px solid var(--border); border-radius: 8px; }
  .acc-help strong { display: block; font-weight: 500; font-size: 14px; color: var(--text); }

  /* ── Orders ───────────────────────────────────────────── */
  .acc-orders { display: flex; flex-direction: column; gap: 12px; }
  .acc-order { overflow: hidden; }
  .acc-order-head { display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
  .acc-oid { font-weight: 500; font-size: 14px; color: var(--text); overflow-wrap: anywhere; }
  .acc-status { flex-shrink: 0; }
  .acc-mini { list-style: none; display: flex; margin: 0; padding: 14px 16px 12px; border-bottom: 1px solid var(--border); }
  .acc-mini.is-cancelled { display: block; background: #FDEBE9; color: var(--error); font-size: 13px; font-weight: 500; padding: 10px 16px; }
  .acc-mini-step { position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .acc-mini-dot { position: relative; z-index: 1; width: 16px; height: 16px; border-radius: 50%; background: #fff; border: 2px solid #C9D3D1; display: flex; align-items: center; justify-content: center; }
  .acc-mini-step.is-done .acc-mini-dot { background: var(--primary); border-color: var(--primary); }
  .acc-mini-step.is-now .acc-mini-dot { border-color: var(--primary); }
  .acc-mini-step.is-now .acc-mini-dot::after { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--primary); }
  .acc-mini-label { font-size: 12px; color: var(--text-muted); }
  .acc-mini-step.is-done .acc-mini-label, .acc-mini-step.is-now .acc-mini-label { color: var(--text); font-weight: 500; }
  .acc-mini-step:not(:last-child)::after { content: ''; position: absolute; top: 7px; left: calc(50% + 12px); right: calc(-50% + 12px); height: 2px; background: #DDE4E2; }
  .acc-mini-step.is-done:not(:last-child)::after { background: var(--primary); }
  .acc-order-items { padding: 0 16px; }
  .acc-oitem { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid #F0F3F2; }
  .acc-oitem:last-child { border-bottom: none; }
  .acc-oitem-ico { width: 52px; height: 52px; border-radius: 6px; background: #EFF3F2; border: 1px solid #E6EBEA; color: #8A9694; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .acc-oitem-name { font-size: 13.5px; font-weight: 400; color: var(--text); line-height: 1.35; overflow-wrap: anywhere; }
  .acc-oitem-price { font-weight: 600; font-size: 14px; color: var(--text); white-space: nowrap; }
  .acc-order-foot { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 16px; border-top: 1px solid var(--border); background: #FAFBFB; }
  .acc-order-stats { display: flex; gap: 28px; flex-wrap: wrap; }
  .acc-deliv { font-size: 13.5px; font-weight: 500; color: var(--text-muted); }
  .acc-deliv.is-set { color: var(--success); }
  .acc-order-actions { display: flex; gap: 8px; }
  .acc-order-track { border-top: 1px solid var(--border); padding: 4px 16px 12px; }
  .acc-stages { display: flex; padding: 14px 0 6px; overflow-x: auto; }
  .acc-stage { display: flex; flex-direction: column; align-items: center; flex-shrink: 0; width: 76px; }
  .acc-stage-dot { width: 18px; height: 18px; border-radius: 50%; border: 2px solid #C9D3D1; background: #fff; display: flex; align-items: center; justify-content: center; }
  .acc-stage-dot.is-done { background: var(--primary); border-color: var(--primary); }
  .acc-stage-label { font-size: 11.5px; color: var(--text-muted); margin-top: 6px; text-align: center; line-height: 1.3; }
  .acc-stage-label.is-done { color: var(--text); font-weight: 500; }
  .acc-stage-bar { flex: 1; height: 2px; background: #DDE4E2; margin-top: 8px; min-width: 18px; }
  .acc-stage-bar.is-done { background: var(--primary); }
  .acc-cancelled { padding: 12px 0; font-size: 13.5px; font-weight: 500; color: var(--error); }
  .acc-shipment { display: flex; flex-direction: column; gap: 6px; padding: 10px 0 12px; border-top: 1px solid var(--border); margin-top: 4px; font-size: 13.5px; color: var(--text); }

  /* ── Simple list rows (enquiries, notifications) ─────── */
  .acc-list { padding: 0 16px; }
  .acc-lrow { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid #F0F3F2; }
  .acc-lrow:last-child { border-bottom: none; }
  .acc-lico { width: 36px; height: 36px; border-radius: 50%; background: var(--primary-tint); color: var(--primary); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .acc-lname { font-size: 14px; font-weight: 500; color: var(--text); overflow-wrap: anywhere; }
  .acc-lbadges { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }

  /* ── Empty state ──────────────────────────────────────── */
  .acc-empty { background: #fff; border: 1px solid var(--border); border-radius: 8px; text-align: center; padding: 36px 20px 40px; display: flex; flex-direction: column; align-items: center; }
  .acc-ill { width: 88px; height: 88px; color: var(--primary); margin-bottom: 10px; }
  .acc-ill-ground { fill: #E4E8E7; }
  .acc-ill-line { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .acc-empty-title { font-weight: 500; font-size: 16px; color: var(--text); }
  .acc-empty-text { font-size: 13.5px; color: var(--text-muted); margin: 4px 0 16px; max-width: 340px; line-height: 1.5; }
  .acc-empty-text:last-child { margin-bottom: 0; }
  .acc-empty-title + .btn { margin-top: 14px; }

  /* ── Wishlist: flat bordered product cards ────────────── */
  .bl-grid.acc-wgrid { grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; }
  .acc-wcard { position: relative; display: flex; flex-direction: column; background: #fff; border: 1px solid #E6EBEA; border-radius: 6px; overflow: hidden; transition: box-shadow .15s, border-color .15s; }
  .acc-wimg { display: block; width: 100%; aspect-ratio: 1 / 1.12; border: none; padding: 0; background: #EFF3F2; overflow: hidden; }
  .acc-wimg img { width: 100%; height: 100%; object-fit: cover; }
  .acc-wheart { position: absolute; top: 8px; right: 8px; z-index: 2; width: 32px; height: 32px; border-radius: 50%; border: none; background: rgba(255,255,255,.95); color: var(--coral); display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
  .acc-wbody { padding: 9px 10px 10px; display: flex; flex-direction: column; gap: 3px; flex: 1; }
  .acc-wname { font-size: 13px; font-weight: 400; color: #5A6563; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 2.7em; }
  .acc-wprice { font-weight: 600; font-size: 16px; color: var(--text); }
  .acc-wactions { margin-top: auto; padding-top: 8px; }
  .acc-wactions .btn { width: 100%; }

  /* ── Ticket cards (gift cards + coupons): dashed left stub ── */
  .acc-tickets { display: flex; flex-direction: column; gap: 10px; }
  .acc-ticket { display: flex; background: #fff; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .acc-ticket-stub { flex: 0 0 120px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 14px 8px; background: var(--primary-tint); color: var(--primary-dark); border-right: 1.5px dashed var(--primary-border); }
  .acc-ticket-big { font-weight: 600; font-size: 20px; line-height: 1.15; overflow-wrap: anywhere; }
  .acc-ticket-small { font-size: 12px; font-weight: 500; margin-top: 2px; opacity: .85; }
  .acc-ticket-main { flex: 1; min-width: 0; padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .acc-ticket-kind { font-size: 12px; font-weight: 500; color: var(--text-muted); margin-bottom: 4px; }
  .acc-code { font-weight: 600; font-size: 14px; letter-spacing: .02em; color: var(--text); overflow-wrap: anywhere; }
  .acc-code.is-coupon { display: inline-block; padding: 3px 10px; border: 1px dashed var(--primary); border-radius: 4px; color: var(--primary); background: #fff; }
  .acc-ticket-desc { font-size: 13.5px; color: var(--text); margin-top: 6px; line-height: 1.45; }

  /* ── Addresses: bordered tiles ────────────────────────── */
  .acc-addrs { display: grid; grid-template-columns: minmax(0,1fr); gap: 12px; margin-bottom: 16px; }
  .acc-addr { position: relative; display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; background: #fff; border: 1px solid var(--border); border-radius: 8px; transition: border-color .15s, background .15s; }
  .acc-addr.is-editing { border-color: var(--primary); background: var(--primary-tint); }
  .acc-addr-top { display: flex; align-items: center; gap: 8px; }
  .acc-addr-top .badge-confirmed { margin-left: auto; }
  .acc-addr-pin { width: 32px; height: 32px; border-radius: 50%; background: var(--primary-tint); color: var(--primary); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .acc-addr.is-editing .acc-addr-pin { background: #fff; }
  .acc-addr-body { display: block; width: 100%; text-align: left; background: none; border: none; padding: 0; font-size: 13.5px; line-height: 1.6; color: var(--text); overflow-wrap: anywhere; }
  .acc-addr-body:disabled { cursor: not-allowed; }
  .acc-addr-body strong { display: block; font-size: 14px; font-weight: 500; color: var(--text); }
  .acc-addr-actions { display: flex; gap: 8px; margin-top: auto; }

  /* ── Forms: boxed inputs, two columns ─────────────────── */
  .acc-form-card { padding: 20px; }
  .acc-form-grid { display: grid; grid-template-columns: minmax(0,1fr); gap: 14px; }
  .acc-form-card .form-input, .acc-form-card .form-select { min-height: 44px; font-size: 16px; }
  .acc-form-card .form-input:disabled { background: var(--bg-hover); color: var(--text-muted); cursor: not-allowed; }
  .acc-formhead { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px; }
  .acc-check { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; font-size: 13.5px; line-height: 1.55; color: var(--text); }
  .acc-check input { margin-top: 2px; width: 16px; height: 16px; flex-shrink: 0; accent-color: var(--primary); cursor: pointer; }
  .acc-modal-back { position: fixed; inset: 0; background: rgba(15,25,24,.5); z-index: 2000; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .acc-modal { position: relative; width: 100%; max-width: 420px; background: #fff; border-radius: 8px; padding: 24px; box-shadow: var(--shadow-lg); }
  .acc-modal-x { position: absolute; top: 8px; right: 8px; width: 40px; height: 40px; background: none; border: none; font-size: 24px; line-height: 1; color: var(--text-muted); border-radius: 50%; }
  .acc-modal-x:hover { background: var(--bg-hover); }

  @media (min-width: 560px) {
    .acc-form-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
    .acc-addrs { grid-template-columns: repeat(2, minmax(0,1fr)); }
  }
  @media (min-width: 640px) {
    .bl-grid.acc-wgrid { grid-template-columns: repeat(3, minmax(0,1fr)); gap: 12px; }
    .acc-form-card .form-input, .acc-form-card .form-select { min-height: 42px; font-size: 14px; }
  }
  @media (min-width: 768px) {
    .acc-mtop { margin: 0 -20px; }
    .acc-mtop .acc-profile { padding: 10px 20px; }
    .account-nav-scroll { padding: 0 14px; }
  }
  @media (min-width: 900px) {
    .acc-layout { grid-template-columns: 264px minmax(0,1fr); gap: 20px; }
    .account-sidebar { display: block; }
    .acc-mtop { display: none; }
  }
  @media (min-width: 1100px) {
    .acc-tiles { grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; }
  }
  @media (hover: hover) and (pointer: fine) {
    .acc-wcard:hover { box-shadow: var(--shadow-md); border-color: #D2DBD9; }
    .acc-addr:not(.is-editing):hover { border-color: var(--primary-border); }
  }
  @media (min-width: 1280px) {
    .bl-grid.acc-wgrid { grid-template-columns: repeat(4, minmax(0,1fr)); gap: 14px; }
  }
  @media (max-width: 520px) {
    .acc-ticket-stub { flex-basis: 96px; }
    .acc-ticket-big { font-size: 17px; }
    .acc-order-actions { width: 100%; }
    .acc-order-actions .btn { flex: 1; }
    .acc-order-stats { gap: 20px; }
    .acc-order-head, .acc-order-foot, .acc-mini { padding-left: 14px; padding-right: 14px; }
    .acc-order-items, .acc-order-track { padding-left: 14px; padding-right: 14px; }
  }
`;

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'orders', label: 'Orders' },
  { key: 'wishlist', label: 'Wishlist' },
  { key: 'giftcards', label: 'Gift Cards' },
  { key: 'coupons', label: 'Coupons' },
  { key: 'enquiries', label: 'Enquiries' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'addresses', label: 'Addresses' },
  { key: 'details', label: 'Account Details' },
];

export default function Account() {
  const { currentUser, userProfile, logout, refreshProfile, updateProfile } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab');
  const [tab, setTab] = useState(NAV_ITEMS.some(n => n.key === urlTab) ? urlTab : 'dashboard');
  const [orders, setOrders] = useState([]);
  const [enquiries, setEnquiries] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [expandedOrderId, setExpandedOrderId] = useState(null);
  const navScrollRef = useRef(null);

  // `tab` only ever read the URL once, on mount -- clicking a section link from
  // somewhere else on the page (the Navbar account dropdown) while already on
  // /account changes the URL but never re-synced the visible tab. This keeps them
  // in step whenever the URL's own tab param changes.
  useEffect(() => {
    const key = searchParams.get('tab');
    setTab(NAV_ITEMS.some(n => n.key === key) ? key : 'dashboard');
  }, [searchParams]);

  useEffect(() => {
    if (!currentUser) return;
    Promise.all([
      safeQuery(supabase.from('orders').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false })),
      safeQuery(supabase.from('enquiries').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false })),
    ]).then(([oRes, eRes]) => {
      // An expired session used to resolve with {data: null, error: "JWT expired"},
      // which the old `oRes.data || []` silently turned into an empty list --
      // indistinguishable from "you genuinely have no orders."
      if (isAuthExpiredError(oRes.error) || isAuthExpiredError(eRes.error)) {
        toast.error('Your session has expired -- please sign in again.');
        navigate('/login');
        return;
      }
      // Admin soft-deletes (deleted_at) keep the row for payment/audit history but hide it from the
      // customer's list; filtered here so it works whether or not the column exists yet.
      setOrders((oRes.data || []).filter(o => !o.deleted_at));
      setEnquiries(eRes.data || []);
      setLoadingOrders(false);
    }).catch(() => setLoadingOrders(false)); // a network-level failure rejects instead of resolving with {error} -- without this the tab spins forever
  }, [currentUser, navigate]);

  // Deep-linking straight to a tab past the first few (e.g. /account?tab=coupons) left the
  // mobile pill strip scrolled to its start, with no pill visibly active -- scroll the active
  // pill into view within the strip itself (never the page) whenever the tab changes.
  useEffect(() => {
    const strip = navScrollRef.current;
    if (!strip) return;
    const activePill = strip.querySelector(`[data-tab="${tab}"]`);
    if (!activePill) return;
    const stripRect = strip.getBoundingClientRect();
    const pillRect = activePill.getBoundingClientRect();
    if (pillRect.left < stripRect.left || pillRect.right > stripRect.right) {
      strip.scrollLeft += (pillRect.left - stripRect.left) - (stripRect.width - pillRect.width) / 2;
    }
  }, [tab]);

  function selectTab(key) {
    setTab(key);
    setSearchParams(key === 'dashboard' ? {} : { tab: key });
  }

  async function handleLogout() {
    await logout();
    toast.success('Signed out.');
    navigate('/');
  }

  if (!currentUser) { navigate('/login'); return null; }

  const statusCls = { Pending: 'badge-pending', Paid: 'badge-confirmed', Confirmed: 'badge-confirmed', Shipped: 'badge-shipped', 'Out for Delivery': 'badge-shipped', Delivered: 'badge-delivered', Cancelled: 'badge-sold' };
  const wishlistCount = getWishlist().length;
  const giftCount = (userProfile?.gift_cards || []).length;
  const displayName = userProfile?.name || currentUser.email?.split('@')[0] || 'there';
  const initial = (displayName.trim().charAt(0) || 'U').toUpperCase();
  const contactLine = userProfile?.phone || '';
  // Small count chips next to the nav rows (only where the number is already known).
  const navCounts = { orders: loadingOrders ? 0 : orders.length, wishlist: wishlistCount };

  // Avatar + name / email -- shown in the desktop nav card and in the slim mobile profile row.
  const profileInfo = (
    <>
      <div className="acc-avatar" aria-hidden="true">{initial}</div>
      <div className="acc-pinfo">
        <div className="acc-pname">{displayName}</div>
        <div className="acc-pmeta">{currentUser.email}</div>
        {contactLine && <div className="acc-pmeta">{contactLine}</div>}
      </div>
    </>
  );

  return (
    <div className="acc-page">
      <div className="bl-wrap acc-wrap">
        <h1 className="acc-sr">My account</h1>
        <div className="account-layout acc-layout">

          {/* SIDEBAR -- desktop: bordered nav card (profile row, vertical list, log out), sticky */}
          <aside className="account-sidebar acc-side" aria-label="Account navigation">
            <div className="acc-profile">{profileInfo}</div>
            <nav className="acc-nav">
              {NAV_ITEMS.map(n => (
                <button key={n.key} onClick={() => selectTab(n.key)} className={`acc-navbtn${tab === n.key ? ' is-active' : ''}`} aria-current={tab === n.key ? 'page' : undefined}>
                  <span className="acc-navico"><NavIcon name={n.key} size={20} /></span>
                  <span>{n.label}</span>
                  {navCounts[n.key] > 0 && <span className="acc-navcount">{navCounts[n.key]}</span>}
                </button>
              ))}
              <div className="acc-navsep" aria-hidden="true" />
              <button onClick={handleLogout} className="acc-navbtn is-logout">
                <span className="acc-navico"><NavIcon name="logout" size={20} /></span>
                <span>Log out</span>
              </button>
            </nav>
          </aside>

          {/* MOBILE -- slim profile row (with Log out) and a horizontally scrollable underline-tab strip */}
          <div className="account-nav-mobile acc-mtop">
            <div className="acc-profile">
              {profileInfo}
              <button type="button" onClick={handleLogout} className="acc-mlogout">Log out</button>
            </div>
            <div className="account-nav-scroll" ref={navScrollRef}>
              {NAV_ITEMS.map(n => (
                <button key={n.key} data-tab={n.key} onClick={() => selectTab(n.key)} className={`acc-pill${tab === n.key ? ' is-active' : ''}`}>
                  {n.label}
                </button>
              ))}
            </div>
          </div>

          {/* CONTENT */}
          <div className="acc-content">
            {tab === 'dashboard' && (
              <DashboardTab name={displayName} orderCount={orders.length} wishlistCount={wishlistCount} giftCount={giftCount} onNav={selectTab} onShop={() => navigate('/shop')} />
            )}

            {tab === 'orders' && (
              <>
                <TabHead title="My orders" sub={!loadingOrders && orders.length > 0 ? `${orders.length} ${orders.length === 1 ? 'order' : 'orders'}` : undefined} />
                {loadingOrders ? <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner"></span></div> :
                orders.length === 0 ? (
                  <EmptyState art="orders" title="No orders yet" text="Your order history will appear here." cta="Start shopping" onCta={() => navigate('/shop')} />
                ) : (
                  <div className="acc-orders">
                    {orders.map(o => {
                      const isExpanded = expandedOrderId === o.id;
                      const oid = o.order_id || o.id.slice(-8).toUpperCase();
                      const oItems = Array.isArray(o.items) ? o.items : [];
                      return (
                        <div key={o.id} className="acc-card acc-order">
                          <div className="acc-order-head">
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div className="acc-oid">Order #{oid}</div>
                              <div className="acc-muted">Placed on {o.created_at ? fmtDate(o.created_at) : '-'}</div>
                            </div>
                            <span className={`badge acc-status ${statusCls[o.status] || 'badge-pending'}`}>{o.status}</span>
                          </div>

                          <OrderMiniTrack status={o.status} />

                          <div className="acc-order-items">
                            {oItems.length === 0 && <div className="acc-muted" style={{ padding: '10px 0' }}>-</div>}
                            {oItems.map((i, idx) => (
                              <div key={`${i.id || idx}-${idx}`} className="acc-oitem">
                                <div className="acc-oitem-ico" aria-hidden="true">
                                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{NAV_ICONS.orders}</svg>
                                </div>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div className="acc-oitem-name">{i.name || 'Item'}</div>
                                  <div className="acc-muted">{[i.size, i.qty ? `Qty ${i.qty}` : null].filter(Boolean).join(' · ')}</div>
                                </div>
                                {i.price != null && <div className="acc-oitem-price">{fmt(i.price)}</div>}
                              </div>
                            ))}
                          </div>

                          <div className="acc-order-foot">
                            <div className="acc-order-stats">
                              <div>
                                <div className="acc-muted">Total</div>
                                <div className="acc-price">{fmt(o.total)}</div>
                              </div>
                              <div>
                                <div className="acc-muted">Delivery</div>
                                <div className={`acc-deliv${o.estimated_delivery ? ' is-set' : ''}`}>{o.estimated_delivery ? formatDeliveryLabel(o.estimated_delivery) : 'To be confirmed'}</div>
                              </div>
                            </div>
                            <div className="acc-order-actions">
                              <button className="btn btn-outline btn-sm" onClick={() => setExpandedOrderId(isExpanded ? null : o.id)} aria-expanded={isExpanded}>
                                {isExpanded ? 'Hide tracking' : 'Track order'}
                              </button>
                              <a className="btn btn-outline btn-sm" href={whatsappLink(`Hi, I need help with order ${oid}.`)} target="_blank" rel="noreferrer">Help</a>
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="acc-order-track">
                              <OrderStageTracker status={o.status} />
                              <ShipmentTracking order={o} />
                              <a href={whatsappLink(`Hi, I have a question about order ${oid}.`)} target="_blank" rel="noreferrer" className="acc-link">
                                Questions about this order? Message us on WhatsApp
                              </a>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {tab === 'wishlist' && <WishlistTab navigate={navigate} />}
            {tab === 'giftcards' && <GiftCardsTab userProfile={userProfile} updateProfile={updateProfile} navigate={navigate} />}
            {tab === 'coupons' && <CouponsTab />}

            {tab === 'enquiries' && (
              <>
                <TabHead title="My enquiries" />
                {enquiries.length === 0 ? (
                  <EmptyState art="enquiries" title="No enquiries yet" text="Questions you send us about a product will show up here." cta="Browse products" onCta={() => navigate('/shop')} />
                ) : (
                  <div className="acc-card acc-list">
                    {enquiries.map(e => (
                      <div key={e.id} className="acc-lrow">
                        <span className="acc-lico" aria-hidden="true"><NavIcon name="enquiries" size={18} /></span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="acc-lname">{e.product || '-'}</div>
                          <div className="acc-muted">{e.created_at ? fmtDate(e.created_at) : '-'}</div>
                        </div>
                        <div className="acc-lbadges">
                          <span className="badge badge-confirmed">{e.type}</span>
                          <span className="badge badge-pending">{e.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {tab === 'notifications' && <NotificationsTab currentUser={currentUser} navigate={navigate} />}

            {tab === 'addresses' && <AddressTab userProfile={userProfile} currentUser={currentUser} refreshProfile={refreshProfile} />}
            {tab === 'details' && <AccountDetailsTab userProfile={userProfile} currentUser={currentUser} updateProfile={updateProfile} />}
          </div>
        </div>
      </div>

      <style>{ACCOUNT_CSS}</style>
    </div>
  );
}

const DASH_TILES = [
  { key: 'orders', label: 'Orders', hint: 'Track and manage your orders' },
  { key: 'wishlist', label: 'Wishlist', hint: 'Items you saved for later' },
  { key: 'giftcards', label: 'Gift Cards', hint: 'Link a code and see the balance' },
  { key: 'coupons', label: 'Coupons', hint: 'Offers you can use at checkout' },
  { key: 'addresses', label: 'Addresses', hint: 'Where we deliver your orders' },
  { key: 'details', label: 'Account Details', hint: 'Name, phone and preferences' },
  { key: 'enquiries', label: 'Enquiries', hint: 'Questions you have sent us' },
  { key: 'notifications', label: 'Notifications', hint: 'Back-in-stock alerts' },
];

function DashboardTab({ name, orderCount, wishlistCount, giftCount, onNav, onShop }) {
  const counts = { orders: orderCount, wishlist: wishlistCount, giftcards: giftCount };
  return (
    <div>
      <div className="acc-hello">
        <div>
          <h2>Hello, {name}</h2>
          <p>Track your orders, manage saved items and addresses, and keep your gift cards and coupons in one place.</p>
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={onShop}>Continue shopping</button>
      </div>
      <div className="acc-tiles">
        {DASH_TILES.map(t => (
          <button key={t.key} onClick={() => onNav(t.key)} className="acc-tile">
            <div className="acc-tile-top">
              <div className="acc-tile-ico"><NavIcon name={t.key} size={20} /></div>
              {counts[t.key] !== undefined && <div className="acc-tile-count">{counts[t.key]}</div>}
            </div>
            <div>
              <div className="acc-tile-label">{t.label}</div>
              <div className="acc-tile-hint">{t.hint}</div>
            </div>
          </button>
        ))}
      </div>
      <div className="acc-help">
        <div>
          <strong>Need help with an order?</strong>
          <span className="acc-muted">Our team is available on WhatsApp.</span>
        </div>
        <a className="btn btn-wa btn-sm" href={whatsappLink()} target="_blank" rel="noreferrer">Chat on WhatsApp</a>
      </div>
    </div>
  );
}

function WishlistTab({ navigate }) {
  const [wl, setWl] = useState(getWishlist);
  const { addToCart } = useCartActions();
  // Matched by (id, size) -- same identity wishlist.js's toggleSaved() uses -- so removing one saved
  // size never hides (or, after a reload, resurrects) another size of the same product.
  const sameEntry = (a, b) => a.id === b.id && (a.size || null) === (b.size || null);
  function remove(product) { toggleSaved(product); setWl(wl.filter(p => !sameEntry(p, product))); toast.success('Removed.'); }
  // Adds the exact size that was saved (not "first in-stock variant" of the saved snapshot).
  function addSaved(p) {
    const saved = p.size && Array.isArray(p.variants) ? p.variants.find(v => v.size === p.size) : null;
    addToCart(saved ? { ...withShippingCharge(p, saved.price ?? p.price), size: saved.size, stock: saved.stock } : productAddToCartPayload(p));
  }
  if (!wl.length) return (
    <>
      <TabHead title="My wishlist" />
      <EmptyState art="wishlist" title="Nothing saved yet" text="Tap the heart on any product to keep it here for later." cta="Explore products" onCta={() => navigate('/shop')} />
    </>
  );
  return (
    <>
      <TabHead title="My wishlist" sub={`${wl.length} saved ${wl.length === 1 ? 'item' : 'items'}`} />
      <div className="bl-grid acc-wgrid">
        {wl.map(p => (
          <div key={`${p.id}::${p.size || ''}`} className="acc-wcard">
            <button type="button" className="acc-wimg" style={p.bg ? { background: p.bg } : undefined} onClick={() => navigate(`/product/${p.id}`)} aria-label={`View ${p.name}`}>
              {p.images?.[0] && <img src={thumb(p.images[0], 350)} alt="" loading="lazy" decoding="async" />}
            </button>
            <button type="button" className="acc-wheart" onClick={() => remove(p)} aria-label={`Remove ${p.name} from wishlist`}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{NAV_ICONS.wishlist}</svg>
            </button>
            <div className="acc-wbody">
              <div className="acc-wname">{p.name}</div>
              {p.size && <div className="acc-muted">Size: {p.size}</div>}
              <div className="acc-wprice">{p.enquiry_only ? <span className="acc-muted" style={{ fontWeight: 500 }}>Price on enquiry</span> : fmt(p.price)}</div>
              <div className="acc-wactions">
                {!p.enquiry_only && !isProductSoldOut(p)
                  ? <button className="btn btn-sm btn-outline" onClick={() => addSaved(p)}>Add to cart</button>
                  : <button className="btn btn-sm btn-outline" onClick={() => navigate(`/product/${p.id}`)}>View product</button>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// Back-in-stock subscriptions the customer requested from a sold-out product
// (see src/components/NotifyWhenAvailable.jsx, the only place these rows are
// created). Fetched fresh from the database, scoped to this user by RLS --
// never local/React-only state, so it matches what NotifyWhenAvailable itself
// checks on the product page.
function NotificationsTab({ currentUser, navigate }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;
    safeQuery(supabase.from('product_notifications').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false })).then(({ data, error }) => {
      if (isAuthExpiredError(error)) { toast.error('Your session has expired -- please sign in again.'); navigate('/login'); return; }
      if (error && error.code !== '42P01') toast.error('Failed to load notifications: ' + error.message);
      setItems(data || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [currentUser, navigate]);

  if (loading) return <><TabHead title="Notifications" /><div style={{ textAlign: 'center', padding: 40 }}><span className="spinner"></span></div></>;
  if (!items.length) return (
    <>
      <TabHead title="Notifications" />
      <EmptyState art="notifications" title="No back-in-stock notifications yet" text="Ask to be notified on a sold-out product and it will be listed here." cta="Explore products" onCta={() => navigate('/shop')} />
    </>
  );
  return (
    <>
      <TabHead title="Notifications" />
      <div className="acc-card acc-list">
        {items.map(n => (
          <div key={n.id} className="acc-lrow">
            <span className="acc-lico" aria-hidden="true"><NavIcon name="notifications" size={18} /></span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="acc-lname">{n.product_name}</div>
              <div className="acc-muted">{[n.size ? `Size ${n.size}` : null, n.created_at ? `Requested ${fmtDate(n.created_at)}` : null].filter(Boolean).join(' · ')}</div>
            </div>
            <span className={n.status === 'notified' ? 'badge badge-confirmed' : 'badge badge-pending'}>{n.status === 'notified' ? 'Notified' : 'Waiting for stock'}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// Lightweight "keep the code on file" registry -- this project has no backend to safely
// track/deduct a live balance, so redemption is arranged manually (same as order fulfillment).
function GiftCardsTab({ userProfile, updateProfile, navigate }) {
  const [showModal, setShowModal] = useState(false);
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [balances, setBalances] = useState({});
  const [loadingBalances, setLoadingBalances] = useState(true);
  const cards = userProfile?.gift_cards || [];

  useEffect(() => {
    const codes = cards.map(c => c.code);
    if (codes.length === 0) { setLoadingBalances(false); return; }
    // Routed through api/lookup.js instead of querying the gift_cards table
    // directly -- see Checkout.jsx's applyGiftCard for why.
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
      // Routed through api/lookup.js -- see Checkout.jsx's applyGiftCard for
      // why direct table access was removed.
      const res = await fetch('/api/lookup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'gift-card', code: trimmed }),
      });
      const { giftCard: data } = await res.json().catch(() => ({}));
      if (!res.ok || !data) { toast.error('That code was not found.'); return; }
      await updateProfile({ gift_cards: [...cards, { code: trimmed, added_at: new Date().toISOString() }] });
      toast.success(`Gift card linked — ${fmt(data.balance)} available.`);
      setCode(''); setShowModal(false);
    } catch { toast.error('Failed to link gift card.'); }
    finally { setSaving(false); }
  }

  async function removeCard(codeToRemove) {
    try { await updateProfile({ gift_cards: cards.filter(c => c.code !== codeToRemove) }); toast.success('Removed.'); }
    catch { toast.error('Failed.'); }
  }

  return (
    <div>
      <TabHead
        title="My gift cards"
        sub="Received a Brightlight Solutions gift card? Link its code here to keep it on file and see its remaining balance. Apply it at checkout when you are ready to use it."
        action={<button className="btn btn-outline btn-sm" onClick={() => setShowModal(true)}>Add new</button>}
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
                  <div className="acc-ticket-big">{loadingBalances ? '…' : bal !== undefined ? fmt(bal.balance) : '—'}</div>
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
                  <button onClick={() => removeCard(c.code)} className="btn btn-danger btn-sm">Remove</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <div className="acc-modal-back" onClick={() => setShowModal(false)}>
          <div className="acc-modal" role="dialog" aria-modal="true" aria-labelledby="acc-gc-title" onClick={e => e.stopPropagation()}>
            <button className="acc-modal-x" onClick={() => setShowModal(false)} aria-label="Close">×</button>
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
            <button className="btn btn-gold btn-full" onClick={linkCard} disabled={saving}>{saving ? <span className="spinner"></span> : 'Link gift card'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CouponsTab() {
  const [coupons, setCoupons] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    safeQuery(supabase.from('coupons').select('*').eq('active', true).order('created_at', { ascending: false }))
      .then(({ data, error }) => {
        if (isAuthExpiredError(error)) {
          toast.error('Your session has expired -- please sign in again.');
          navigate('/login');
          return;
        }
        setCoupons(data || []); setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [navigate]);

  function copyCode(code) {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(code);
    toast.success(`${code} copied.`);
  }

  return (
    <div>
      <TabHead title="Available coupons" sub="Copy a code and apply it at checkout." />
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner"></span></div>
      ) : coupons.length === 0 ? (
        <EmptyState art="coupons" title="No active coupons right now" text="Check back soon for new offers." cta="Continue shopping" onCta={() => navigate('/shop')} />
      ) : (
        <div className="acc-tickets">
          {coupons.map(c => (
            <div key={c.id} className="acc-ticket">
              <div className="acc-ticket-stub">
                <div className="acc-ticket-big">{c.type === 'percent' ? `${c.value}%` : fmt(c.value)}</div>
                <div className="acc-ticket-small">OFF</div>
              </div>
              <div className="acc-ticket-main">
                <div style={{ minWidth: 0 }}>
                  <div className="acc-ticket-kind">Coupon</div>
                  <span className="acc-code is-coupon">{c.code}</span>
                  <div className="acc-ticket-desc">
                    {c.type === 'percent' ? `${c.value}% off` : `${fmt(c.value)} off`}
                    {c.applies_to === 'bundle' && ' — buy the qualifying items together'}
                    {c.applies_to === 'products' && ' — on select products'}
                  </div>
                </div>
                <button className="btn btn-outline btn-sm" onClick={() => copyCode(c.code)}>Copy code</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AccountDetailsTab({ userProfile, currentUser, updateProfile }) {
  const [form, setForm] = useState({ name: userProfile?.name || '', phone: userProfile?.phone || '' });
  const [marketingOptIn, setMarketingOptIn] = useState(!!userProfile?.marketing_opt_in);
  const [saving, setSaving] = useState(false);
  // If this tab mounts before userProfile has finished loading (e.g. a hard
  // refresh straight into ?tab=details), the useState initializers above capture
  // blank/default values permanently -- clicking Save at that point would push
  // those blanks over the real saved name/phone. Backfills once, the first time
  // real profile data actually arrives; never again after that, so it can't
  // clobber an in-progress edit on a later profile refresh.
  const syncedRef = useRef(!!userProfile);
  useEffect(() => {
    if (syncedRef.current || !userProfile) return;
    syncedRef.current = true;
    setForm({ name: userProfile.name || '', phone: userProfile.phone || '' });
    setMarketingOptIn(!!userProfile.marketing_opt_in);
  }, [userProfile]);
  async function save() {
    setSaving(true);
    try { await updateProfile({ name: form.name, phone: form.phone, marketing_opt_in: marketingOptIn }); toast.success('Details updated.'); }
    catch (e) { toast.error('Failed.'); }
    finally { setSaving(false); }
  }
  return (
    <div style={{ maxWidth: 640 }}>
      <TabHead title="Account details" sub="Keep your contact details up to date so we can reach you about your orders." />
      <div className="acc-card acc-form-card">
        <div className="acc-form-grid" style={{ marginBottom: 18 }}>
          <div><label className="form-label" htmlFor="acct-name">Full name</label><input id="acct-name" className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div><label className="form-label" htmlFor="acct-phone">Phone</label><input id="acct-phone" className="form-input" type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
          <div style={{ gridColumn: '1 / -1' }}><label className="form-label" htmlFor="acct-email">Email</label><input id="acct-email" className="form-input" value={currentUser.email} disabled /></div>
        </div>
        <div className="form-group">
          <label className="acc-check">
            <input type="checkbox" checked={marketingOptIn} onChange={e => setMarketingOptIn(e.target.checked)} />
            <span>Email me about new products and special offers.</span>
          </label>
        </div>
        <button className="btn btn-gold" onClick={save} disabled={saving}>{saving ? <span className="spinner"></span> : 'Save changes'}</button>
      </div>
    </div>
  );
}

const EMPTY_ADDRESS = { name: '', phone: '', line1: '', line2: '', city: '', state: '', pincode: '' };

function AddressTab({ userProfile, currentUser, refreshProfile }) {
  const [form, setForm] = useState({ ...EMPTY_ADDRESS });
  const [editingIdx, setEditingIdx] = useState(null); // null = adding new; otherwise the index being edited
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const addresses = userProfile?.addresses || [];

  function startEdit(idx) {
    setEditingIdx(idx);
    setForm({ ...EMPTY_ADDRESS, ...addresses[idx] });
  }

  function cancelEdit() {
    setEditingIdx(null);
    setForm({ ...EMPTY_ADDRESS });
  }

  // Shared by both Add and Edit -- editingIdx null means append, otherwise
  // replace that array position in place (addresses[] has no stable id, only
  // array position -- same constraint deleteAddress() below already works
  // around).
  async function saveAddress() {
    if (!form.name || !form.phone || !form.line1 || !form.city || !form.state || !form.pincode) { toast.error('Please fill required fields.'); return; }
    if (!/^[6-9]\d{9}$/.test(form.phone.trim().replace(/\D/g, '').slice(-10))) { toast.error('Enter a valid 10-digit phone number.'); return; }
    if (!/^\d{6}$/.test(form.pincode.trim())) { toast.error('Enter a valid 6-digit PIN code.'); return; }
    setSaving(true);
    try {
      const newAddrs = editingIdx === null
        ? [...addresses, form]
        : addresses.map((a, i) => (i === editingIdx ? form : a));
      const { error } = await supabase.from('profiles').update({ addresses: newAddrs }).eq('id', currentUser.id);
      if (error) throw error;
      await refreshProfile();
      const wasEditing = editingIdx !== null;
      setForm({ ...EMPTY_ADDRESS });
      setEditingIdx(null);
      toast.success(wasEditing ? 'Address updated.' : 'Address saved.');
    } catch { toast.error('Failed to save address.'); }
    finally { setSaving(false); }
  }

  // addresses[] has no stable per-row id (plain objects in a JSON array, addressed
  // only by array position) -- computing "current list minus this index" from a
  // stale closure let a second delete, clicked before the first's refreshProfile()
  // resolved, undo the first deletion. Serializing all deletes through one `deleting`
  // flag (rather than trying to key/patch around the missing id) closes the race
  // without needing a data-model change.
  async function deleteAddress(idx) {
    if (deleting) return;
    setDeleting(true);
    try {
      const newAddrs = addresses.filter((_, i) => i !== idx);
      const { error } = await supabase.from('profiles').update({ addresses: newAddrs }).eq('id', currentUser.id);
      if (error) { toast.error('Failed to remove address.'); return; }
      await refreshProfile();
      // A deletion shifts every later index -- if the form was mid-edit, its
      // target position is no longer trustworthy (either it's gone, or it
      // now points at a different address), so drop back to "Add New".
      if (editingIdx !== null) cancelEdit();
      toast.success('Address removed.');
    } finally { setDeleting(false); }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <TabHead title="My addresses" />
      {addresses.length === 0 && (
        <div style={{ marginBottom: 20 }}>
          <EmptyState art="addresses" title="No saved addresses yet" text="Add your delivery address below and checkout gets faster." />
        </div>
      )}
      {addresses.length > 0 && (
        <div className="acc-addrs">
          {addresses.map((addr, i) => (
            <div key={i} className={`acc-addr${editingIdx === i ? ' is-editing' : ''}`}>
              <div className="acc-addr-top">
                <span className="acc-addr-pin" aria-hidden="true"><NavIcon name="addresses" size={18} /></span>
                {i === 0 && <span className="badge badge-gold">Default</span>}
                {editingIdx === i && <span className="badge badge-confirmed">Editing</span>}
              </div>
              <button type="button" className="acc-addr-body" onClick={() => startEdit(i)} disabled={deleting} aria-pressed={editingIdx === i}>
                <strong>{addr.name}</strong>{addr.phone}<br />{addr.line1}{addr.line2 ? ', ' + addr.line2 : ''}<br />{addr.city}, {addr.state}, {addr.pincode}
              </button>
              <div className="acc-addr-actions">
                <button className="btn btn-outline btn-sm" onClick={() => startEdit(i)} disabled={deleting}>Edit</button>
                <button className="btn btn-danger btn-sm" style={{ opacity: deleting ? 0.5 : 1 }} onClick={() => deleteAddress(i)} disabled={deleting}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="acc-card acc-form-card">
        <div className="acc-formhead">
          <h3 className="acc-h" style={{ fontSize: 18 }}>{editingIdx === null ? 'Add new address' : 'Edit address'}</h3>
          {editingIdx !== null && (
            <button onClick={cancelEdit} disabled={saving} className="acc-link acc-linkbtn" style={{ cursor: saving ? 'not-allowed' : 'pointer' }}>Cancel</button>
          )}
        </div>
        <div className="acc-form-grid">
          {[['Full name *','name',false],['Phone *','phone',false],['Address line 1 *','line1',true],['Address line 2','line2',true],['City *','city',false],['State *','state',false],['Pincode *','pincode',false]].map(([label,key,full]) => (
            <div key={key} style={{ gridColumn: full ? '1/-1' : 'auto' }}>
              <label className="form-label" htmlFor={`addr-${key}`}>{label}</label>
              {key === 'state' ? (
                <select id={`addr-${key}`} className="form-select" value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} style={{ cursor: 'pointer' }}>
                  <option value="">Select state</option>
                  {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <input id={`addr-${key}`} className="form-input" value={form[key]} onChange={e => {
                  const v = e.target.value;
                  setForm(f => ({ ...f, [key]: v }));
                  if (key === 'pincode' && /^\d{6}$/.test(v.trim())) {
                    lookupPincode(v.trim()).then(loc => { if (loc) setForm(f => ({ ...f, city: loc.city, state: loc.state })); });
                  }
                }} />
              )}
            </div>
          ))}
        </div>
        <button className="btn btn-gold" style={{ marginTop: 18 }} onClick={saveAddress} disabled={saving}>
          {saving ? <span className="spinner"></span> : (editingIdx === null ? 'Save address' : 'Save changes')}
        </button>
      </div>
    </div>
  );
}
