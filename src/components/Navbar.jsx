import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCartData } from '../context/CartContext';
import { useWishlist } from '../context/WishlistContext';
import { useBrand } from '../context/BrandContext';
import { useCatalog } from '../context/CatalogContext';
import { COMPANY } from '../config/company';
import { thumb } from '../utils/thumbnail';
import { DEALS_PATH } from '../utils/shopQuery';
import markImg from '../assets/brightlight-mark.png';
import SearchBar from './SearchBar';

// The signed-in customer's account links, in the order of the account page's own menu (the tab keys Account.jsx
// reads from ?tab=; it accepts `support` as well as the old `enquiries`).
const ACCOUNT_MENU_ITEMS = [
  { label: 'My account', tab: null },
  { label: 'Orders', tab: 'orders' },
  { label: 'Wishlist', tab: 'wishlist' },
  { label: 'Addresses', tab: 'addresses' },
  { label: 'Coupons', tab: 'coupons' },
  { label: 'Gift cards', tab: 'giftcards' },
  { label: 'Notifications', tab: 'notifications' },
  { label: 'Support', tab: 'support' },
  { label: 'Account details', tab: 'details' },
];

// Informational pages -- shown in the mobile drawer.
const INFO_LINKS = [
  { label: 'About us', path: '/about' },
  { label: 'Blog', path: '/insights' },
  { label: 'Help Centre', path: '/help' },
  { label: 'Contact us', path: '/contact' },
];

const Icon = {
  menu: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>,
  heart: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 000-7.78z" /></svg>,
  user: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>,
  cart: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="21" r="1.2" /><circle cx="20" cy="21" r="1.2" /><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" /></svg>,
  home: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z" /></svg>,
  grid: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" /></svg>,
  chev: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9" /></svg>,
  close: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>,
  tag: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8zM7.5 7.5h.01" /></svg>,
  phone: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z" /></svg>,
};

function Logo({ brand, onClick }) {
  const useDefaultLockup = !brand.brand_name || brand.brand_name === COMPANY.name;
  return (
    <Link to="/" className="bl-logo" aria-label={`${brand.brand_name || COMPANY.name} — home`} onClick={onClick}>
      <img className="bl-logo-img" src={brand.logo_url ? thumb(brand.logo_url, 300) : markImg} alt="" />
      {useDefaultLockup ? (
        <span className="bl-logo-text">
          <span className="bl-logo-name">Bright<b>light</b></span>
          <span className="bl-logo-sub">SOLUTIONS</span>
        </span>
      ) : (
        <span className="bl-logo-name" style={{ maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{brand.brand_name}</span>
      )}
    </Link>
  );
}

const countLabel = (n, one) => (n > 0 ? `, ${n} ${one}${n === 1 ? '' : 's'}` : '');

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openDd, setOpenDd] = useState(null);          // desktop: 'all' | 'account'
  const [openMobileGroup, setOpenMobileGroup] = useState(null);
  const { currentUser, logout } = useAuth();
  const { cartCount } = useCartData();
  const { count: wishCount } = useWishlist();
  const { brand } = useBrand();
  const { tree } = useCatalog();
  const navigate = useNavigate();
  const location = useLocation();
  const hamburgerRef = useRef(null);
  const drawerRef = useRef(null);
  const ddCloseTimer = useRef(null);

  useEffect(() => { setMenuOpen(false); setOpenDd(null); setOpenMobileGroup(null); }, [location.pathname, location.search]);

  // Mobile drawer: scroll locked, focus moves in, and Escape / a tap on the dim area close it.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    drawerRef.current?.querySelector('a, button')?.focus();
    return () => { document.body.style.overflow = prev; };
  }, [menuOpen]);

  useEffect(() => {
    if (!openDd) return undefined;
    const close = (e) => { if (!e.target.closest('.bl-dd-zone')) setOpenDd(null); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openDd]);

  // Escape closes whichever of dropdown/drawer is open and returns focus to the opener.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== 'Escape') return;
      if (openDd) setOpenDd(null);
      else if (menuOpen) { setMenuOpen(false); hamburgerRef.current?.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openDd, menuOpen]);

  const hoverOpen = (name) => { clearTimeout(ddCloseTimer.current); setOpenDd(name); };
  const hoverClose = () => { clearTimeout(ddCloseTimer.current); ddCloseTimer.current = setTimeout(() => setOpenDd(null), 140); };
  const toggleMobileGroup = (name) => setOpenMobileGroup(p => (p === name ? null : name));
  const path = location.pathname;
  const onWishlist = path === '/account' && location.search.includes('wishlist');

  return (
    <>
      <header className="bl-header">

        {/* ROW 1 — menu / logo / (desktop) search / actions */}
        <div className="bl-header-row">
          <button ref={hamburgerRef} type="button" className="bl-menu-btn" onClick={() => setMenuOpen(true)} aria-label="Open menu" aria-expanded={menuOpen} aria-controls="bl-drawer">{Icon.menu}</button>
          <Logo brand={brand} />

          <div className="bl-search-desktop" style={{ flex: 1, minWidth: 0 }}>
            <SearchBar />
          </div>

          <nav className="bl-actions" aria-label="Account and cart">
            <div className="bl-toplinks">
              <Link to="/contact" className="bl-toplink">Contact Us</Link>
              <Link to="/help" className="bl-toplink">Help Centre</Link>
            </div>
            {/* A guest who taps Wishlist is sent to sign in and brought back (ProtectedRoute keeps the destination). */}
            <Link to="/account?tab=wishlist" className="bl-act bl-act-hide-sm" aria-label={`Wishlist${countLabel(wishCount, 'item')}`}>
              {Icon.heart}
              {wishCount > 0 && <span className="bl-act-badge">{wishCount}</span>}
              <span className="bl-act-label">Wishlist</span>
            </Link>

            {/* Desktop account — dropdown when signed in, straight to login otherwise */}
            <div className="bl-dd-zone bl-act-desktop" style={{ position: 'relative' }}>
              <button
                type="button"
                className="bl-act"
                onClick={e => { e.stopPropagation(); currentUser ? setOpenDd(o => (o === 'account' ? null : 'account')) : navigate('/login'); }}
                aria-label={currentUser ? 'Account menu' : 'Sign in'}
                aria-expanded={currentUser ? openDd === 'account' : undefined}
                aria-haspopup={currentUser ? 'true' : undefined}
              >
                {Icon.user}<span className="bl-act-label">{currentUser ? 'Account' : 'Sign in'}</span>
              </button>
              {openDd === 'account' && currentUser && (
                <div className="bl-acct-menu">
                  {ACCOUNT_MENU_ITEMS.map(({ label, tab }) => (
                    <Link key={tab || 'dashboard'} to={tab ? `/account?tab=${tab}` : '/account'} className="bl-drawer-link" style={{ padding: '11px 16px', fontSize: 14 }}>
                      {label}{tab === 'wishlist' && wishCount > 0 && <span className="bl-chip grey">{wishCount}</span>}
                    </Link>
                  ))}
                  <button type="button" className="bl-drawer-link" style={{ padding: '11px 16px', fontSize: 14, color: 'var(--error)', borderBottom: 'none' }} onClick={async () => { await logout(); navigate('/'); }}>Log out</button>
                </div>
              )}
            </div>

            <Link to="/cart" className="bl-act" aria-label={`Cart${countLabel(cartCount, 'item')}`}>
              {Icon.cart}
              {cartCount > 0 && <span className="bl-act-badge">{cartCount}</span>}
              <span className="bl-act-label">Cart</span>
            </Link>
          </nav>
        </div>

        {/* ROW 2 (mobile) — search */}
        <div className="bl-header-row2">
          <SearchBar placeholder="Search for products, brands and more" />
        </div>

        {/* CATEGORY BAR (desktop) */}
        <div className="bl-catbar bl-dd-zone" onMouseLeave={hoverClose} onMouseEnter={() => clearTimeout(ddCloseTimer.current)} style={{ position: 'relative' }}>
          <div className="bl-catbar-inner">
            <button
              type="button"
              className={`bl-catlink${openDd === 'all' ? ' is-open' : ''}`}
              style={{ fontWeight: 600 }}
              aria-expanded={openDd === 'all'}
              aria-haspopup="true"
              onMouseEnter={() => hoverOpen('all')}
              onClick={e => { e.stopPropagation(); setOpenDd(o => (o === 'all' ? null : 'all')); }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
              All Categories{Icon.chev}
            </button>
            <Link to={DEALS_PATH} className="bl-catlink is-accent" onMouseEnter={() => setOpenDd(null)}>{Icon.tag}Deals</Link>
            {tree.slice(0, 7).map(root => (
              <Link key={root.id} to={`/category/${root.slug}`} className="bl-catlink" onMouseEnter={() => setOpenDd(null)}>{root.name}</Link>
            ))}
          </div>

          {openDd === 'all' && (
            <div className="bl-mega">
              <div className="bl-mega-inner">
                {tree.map(root => (
                  <div key={root.id}>
                    <Link to={`/category/${root.slug}`} className="bl-mega-title">{root.name}</Link>
                    {root.children.map(c => <Link key={c.id} to={`/category/${c.slug}`} className="bl-mega-link">{c.name}</Link>)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* MOBILE DRAWER */}
      <div className={`bl-drawer-scrim${menuOpen ? ' is-open' : ''}`} onClick={() => setMenuOpen(false)} aria-hidden="true" />
      <aside id="bl-drawer" ref={drawerRef} className={`bl-drawer${menuOpen ? ' is-open' : ''}`} aria-hidden={!menuOpen} aria-label="Menu">
        <div className="bl-drawer-head">
          <img src={brand.logo_url ? thumb(brand.logo_url, 200) : markImg} alt="" style={{ height: 40, width: 'auto', background: '#fff', borderRadius: 10, padding: 4 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {currentUser ? (
              <>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,.7)' }}>Hello,</div>
                <div style={{ fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || currentUser.email || 'Welcome'}</div>
              </>
            ) : (
              <>
                <div style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 17 }}>{brand.brand_name || COMPANY.name}</div>
                <Link to="/login" style={{ fontSize: 13, color: 'var(--sun)', fontWeight: 600 }}>Sign in / Register</Link>
              </>
            )}
          </div>
          <button type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu" style={{ background: 'none', border: 'none', color: '#fff', width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{Icon.close}</button>
        </div>

        <div className="bl-drawer-body">
          <Link to="/" className="bl-drawer-link">Home</Link>
          <Link to={DEALS_PATH} className="bl-drawer-link" style={{ color: 'var(--primary)', fontWeight: 700 }}>Deals</Link>

          <button type="button" className="bl-drawer-link" onClick={() => toggleMobileGroup('shop')} aria-expanded={openMobileGroup === 'shop'}>
            <span>Shop by category</span>
            <span style={{ transform: openMobileGroup === 'shop' ? 'rotate(180deg)' : 'none', transition: 'transform .2s', display: 'flex' }}>{Icon.chev}</span>
          </button>
          {openMobileGroup === 'shop' && (
            <div className="bl-drawer-sub">
              <Link to="/shop" className="bl-drawer-link">All products</Link>
              {tree.map(root => (
                <div key={root.id}>
                  <Link to={`/category/${root.slug}`} className="bl-drawer-link" style={{ fontWeight: 600, color: 'var(--text)' }}>{root.name}</Link>
                  {root.children.map(c => <Link key={c.id} to={`/category/${c.slug}`} className="bl-drawer-link is-lvl2">{c.name}</Link>)}
                </div>
              ))}
            </div>
          )}

          <Link to="/gift-card" className="bl-drawer-link">Gift cards</Link>

          <div className="bl-drawer-label">Company</div>
          {INFO_LINKS.map(l => <Link key={l.path} to={l.path} className="bl-drawer-link">{l.label}</Link>)}

          <div className="bl-drawer-label">My account</div>
          <Link to={currentUser ? '/account' : '/login'} className="bl-drawer-link">{currentUser ? 'My account' : 'Sign in'}</Link>
          <Link to="/account?tab=orders" className="bl-drawer-link">My orders</Link>
          <Link to="/account?tab=wishlist" className="bl-drawer-link">{`Wishlist${wishCount > 0 ? ` (${wishCount})` : ''}`}</Link>
          <Link to="/account?tab=support" className="bl-drawer-link">Support</Link>
          <Link to="/cart" className="bl-drawer-link">{`Cart (${cartCount})`}</Link>
          {currentUser && (
            <button type="button" className="bl-drawer-link" style={{ color: 'var(--error)' }} onClick={() => { logout(); navigate('/'); }}>Log out</button>
          )}

          <a href={`tel:${COMPANY.phoneTel}`} className="btn btn-outline" style={{ margin: '18px 18px 0', width: 'calc(100% - 36px)' }}>{Icon.phone} Call {brand.support_phone || COMPANY.phoneDisplay}</a>
        </div>
      </aside>

      {/* MOBILE BOTTOM TAB BAR */}
      <nav className="bl-bottom-nav" aria-label="Primary">
        <Link to="/" className={`bl-bn-item${path === '/' ? ' is-active' : ''}`} aria-current={path === '/' ? 'page' : undefined}>{Icon.home}<span>Home</span></Link>
        <Link to="/shop" className={`bl-bn-item${path.startsWith('/shop') || path.startsWith('/category') ? ' is-active' : ''}`}>{Icon.grid}<span>Shop</span></Link>
        <Link to="/cart" className={`bl-bn-item${path === '/cart' ? ' is-active' : ''}`} aria-label={`Cart${countLabel(cartCount, 'item')}`}>
          {Icon.cart}<span>Cart</span>
          {cartCount > 0 && <span className="bl-bn-badge">{cartCount}</span>}
        </Link>
        <Link to="/account?tab=wishlist" className={`bl-bn-item${onWishlist ? ' is-active' : ''}`} aria-label={`Wishlist${countLabel(wishCount, 'item')}`}>
          {Icon.heart}<span>Wishlist</span>
          {wishCount > 0 && <span className="bl-bn-badge">{wishCount}</span>}
        </Link>
        <Link to={currentUser ? '/account' : '/login'} className={`bl-bn-item${(path === '/account' && !onWishlist) || path === '/login' || path === '/register' ? ' is-active' : ''}`}>{Icon.user}<span>{currentUser ? 'Account' : 'Sign in'}</span></Link>
      </nav>

      <style>{`
        /* desktop-only / mobile-only visibility for the header pieces */
        .bl-search-desktop { display: none; }
        .bl-act-desktop { display: none; }
        .bl-act-hide-sm { display: none; }
        @media (min-width: 900px) {
          .bl-search-desktop { display: block; }
          .bl-act-desktop { display: block; }
          .bl-act-hide-sm { display: flex; }
        }
        /* mobile: keep wishlist reachable from the header too */
        @media (max-width: 899px) { .bl-act-hide-sm { display: flex; min-width: 44px; } .bl-act { min-width: 44px; } .bl-actions { margin-left: auto; } }
        .bl-acct-menu { position: absolute; top: calc(100% + 6px); right: 0; background: #fff; border: 1px solid var(--line); border-radius: 12px; min-width: 220px; box-shadow: var(--shadow-lg); animation: fadeIn .15s ease; z-index: 1200; overflow: hidden; }
        .bl-act-label { white-space: nowrap; }
        .bl-catlink svg { flex-shrink: 0; }
        /* the account menu / drawer links carry a small count chip on the right */
        .bl-drawer-link .bl-chip { margin-left: 8px; }
      `}</style>
    </>
  );
}
