import React from 'react';

// Small building blocks shared by the Account page and its tab components (icons, empty states, tab
// headings). The matching `.acc-*` styles live in Account.jsx's ACCOUNT_CSS.
export const NAV_ICONS = {
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

export function NavIcon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true">
      {NAV_ICONS[name]}
    </svg>
  );
}

// Small outline illustrations for the empty states (inline SVG on a 64x64 grid, drawn with the
// .acc-ill-line stroke style).
const EMPTY_ART = {
  orders: <>
    <path d="M10 22L32 11l22 11v22L32 55 10 44z" />
    <path d="M10 22l22 11 22-11M32 33v22" />
    <path d="M21 16.5l22 11" />
  </>,
  wishlist: <path d="M32 54C13 41 8 27 14 19c5-6 14-5 18 2 4-7 13-8 18-2 6 8 1 22-18 35z" />,
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
  error: <>
    <circle cx="32" cy="32" r="22" />
    <path d="M32 20v14M32 43v.5" strokeWidth="3" />
  </>,
};

export function EmptyState({ art, title, text, cta, onCta, children }) {
  return (
    <div className="acc-empty">
      <svg className="acc-ill" viewBox="0 0 64 64" aria-hidden="true">
        <ellipse className="acc-ill-ground" cx="32" cy="60" rx="20" ry="2.5" />
        <g className="acc-ill-line">{EMPTY_ART[art]}</g>
      </svg>
      <div className="acc-empty-title">{title}</div>
      {text && <div className="acc-empty-text">{text}</div>}
      {cta && <button type="button" className="btn btn-gold" onClick={onCta}>{cta}</button>}
      {children}
    </div>
  );
}

export function TabHead({ title, sub, action }) {
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

export function Loading({ label = 'Loading' }) {
  return <div style={{ textAlign: 'center', padding: 40 }}><span className="spinner" role="status" aria-label={label}></span></div>;
}

// Inline error with a retry button (every list screen needs one).
export function LoadError({ message = 'Something went wrong while loading this.', onRetry }) {
  return (
    <EmptyState art="error" title="We could not load this" text={message}>
      {onRetry && <button type="button" className="btn btn-outline" onClick={onRetry}>Try again</button>}
    </EmptyState>
  );
}
