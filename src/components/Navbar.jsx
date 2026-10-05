import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCartData } from '../context/CartContext';
import { useBrand } from '../context/BrandContext';
import { COLLECTOR_LABEL, COMING_SOON_CATEGORIES, effectiveTaxonomy } from '../data/products';
import { COMPANY } from '../config/company';
import { thumb } from '../utils/thumbnail';
import markImg from '../assets/brightlight-mark.png';
import SearchBar from './SearchBar';

// Kept in the same order Account.jsx's own sidebar/pill-strip uses (Account.jsx's
// NAV_ITEMS) so a signed-in customer finds every tab from the header itself.
const ACCOUNT_MENU_ITEMS = [
  { label: 'Dashboard', tab: null },
  { label: 'Orders', tab: 'orders' },
  { label: 'Wishlist', tab: 'wishlist' },
  { label: 'Gift Cards', tab: 'giftcards' },
  { label: 'Coupons', tab: 'coupons' },
  { label: 'Enquiries', tab: 'enquiries' },
  { label: 'Notifications', tab: 'notifications' },
  { label: 'Addresses', tab: 'addresses' },
  { label: 'Account Details', tab: 'details' },
];

// Informational pages -- shown in the desktop category bar's right side and the mobile drawer.
const INFO_LINKS = [
  { label: 'About', path: '/about' },
  { label: 'Blog', path: '/insights' },
  { label: 'Help Centre', path: '/help' },
  { label: 'Contact', path: '/contact' },
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

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [openDd, setOpenDd] = useState(null);          // desktop: group label | 'account'
  const [openMobileGroup, setOpenMobileGroup] = useState(null);
  const { currentUser, logout } = useAuth();
  const { cartCount } = useCartData();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const location = useLocation();
  const hamburgerRef = useRef(null);
  const ddCloseTimer = useRef(null);
  const groups = effectiveTaxonomy(brand);
  const comingSoonCats = Array.isArray(brand.coming_soon_categories) ? brand.coming_soon_categories : COMING_SOON_CATEGORIES;

  useEffect(() => { setMenuOpen(false); setOpenDd(null); setOpenMobileGroup(null); }, [location.pathname, location.search]);

  // Lock page scroll while the mobile drawer is open.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
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
            <button type="button" className="bl-act bl-act-hide-sm" onClick={() => navigate('/account?tab=wishlist')} aria-label="Wishlist">
              {Icon.heart}<span className="bl-act-label">Wishlist</span>
            </button>

            {/* Desktop account — dropdown when signed in, straight to login otherwise */}
            <div className="bl-dd-zone bl-act-desktop" style={{ position: 'relative' }}>
              <button
                type="button"
                className="bl-act"
                onClick={e => { e.stopPropagation(); currentUser ? setOpenDd(o => (o === 'account' ? null : 'account')) : navigate('/login'); }}
                aria-label={currentUser ? 'Account menu' : 'Sign in'}
                aria-expanded={openDd === 'account'}
                aria-haspopup={currentUser ? 'true' : undefined}
              >
                {Icon.user}<span className="bl-act-label">{currentUser ? 'Account' : 'Sign in'}</span>
              </button>
              {openDd === 'account' && currentUser && (
                <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, background: '#fff', border: '1px solid var(--line)', borderRadius: 12, minWidth: 220, boxShadow: 'var(--shadow-lg)', animation: 'fadeIn .15s ease', zIndex: 1200, overflow: 'hidden' }}>
                  {ACCOUNT_MENU_ITEMS.map(({ label, tab }) => (
                    <Link key={tab || 'dashboard'} to={tab ? `/account?tab=${tab}` : '/account'} className="bl-drawer-link" style={{ padding: '11px 16px', fontSize: 14 }}>{label}</Link>
                  ))}
                  <button type="button" className="bl-drawer-link" style={{ padding: '11px 16px', fontSize: 14, color: 'var(--error)', borderBottom: 'none' }} onClick={async () => { await logout(); navigate('/'); }}>Log out</button>
                </div>
              )}
            </div>

            <button type="button" className="bl-act" onClick={() => navigate('/cart')} aria-label={`Cart${cartCount > 0 ? `, ${cartCount} item${cartCount === 1 ? '' : 's'}` : ''}`}>
              {Icon.cart}
              {cartCount > 0 && <span className="bl-act-badge">{cartCount}</span>}
              <span className="bl-act-label">Cart</span>
            </button>
          </nav>
        </div>

        {/* ROW 2 (mobile) — search */}
        <div className="bl-header-row2">
          <SearchBar placeholder="Search products & categories" />
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
            <Link to="/shop" className="bl-catlink" onMouseEnter={() => setOpenDd(null)}>Shop All</Link>
            {groups.slice(0, 6).map(group => (
              <Link key={group.label} to={`/shop?group=${encodeURIComponent(group.label)}`} className="bl-catlink" onMouseEnter={() => setOpenDd(null)}>{group.label}</Link>
            ))}
            <Link to={`/shop?collection=${encodeURIComponent(COLLECTOR_LABEL)}`} className="bl-catlink is-accent" onMouseEnter={() => setOpenDd(null)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.9 6.9L22 10l-5.5 4.8L18.2 22 12 18.3 5.8 22l1.7-7.2L2 10l7.1-1.1z" /></svg>
              {COLLECTOR_LABEL}
            </Link>
          </div>

          {openDd === 'all' && (
            <div className="bl-mega" role="menu">
              <div className="bl-mega-inner">
                {groups.map(group => (
                  <div key={group.label}>
                    <Link to={`/shop?group=${encodeURIComponent(group.label)}`} className="bl-mega-title">{group.label}</Link>
                    {group.items.map(item => comingSoonCats.includes(item) ? (
                      <span key={item} className="bl-mega-link" style={{ opacity: .5, cursor: 'default' }}>{item} <span className="bl-chip grey" style={{ marginLeft: 6 }}>Soon</span></span>
                    ) : (
                      <Link key={item} to={`/shop?category=${encodeURIComponent(item)}`} className="bl-mega-link" role="menuitem">{item}</Link>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* MOBILE DRAWER */}
      <div className={`bl-drawer-scrim${menuOpen ? ' is-open' : ''}`} onClick={() => setMenuOpen(false)} aria-hidden="true" />
      <aside id="bl-drawer" className={`bl-drawer${menuOpen ? ' is-open' : ''}`} aria-hidden={!menuOpen} aria-label="Menu">
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
                <Link to="/login" style={{ fontSize: 13, color: 'var(--brand-light)', fontWeight: 600 }}>Sign in / Register</Link>
              </>
            )}
          </div>
          <button type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu" style={{ background: 'none', border: 'none', color: '#fff', width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{Icon.close}</button>
        </div>

        <div className="bl-drawer-body">
          <Link to="/" className="bl-drawer-link">Home</Link>

          <button type="button" className="bl-drawer-link" onClick={() => toggleMobileGroup('shop')} aria-expanded={openMobileGroup === 'shop'}>
            <span>Shop by Category</span>
            <span style={{ transform: openMobileGroup === 'shop' ? 'rotate(180deg)' : 'none', transition: 'transform .2s', display: 'flex' }}>{Icon.chev}</span>
          </button>
          {openMobileGroup === 'shop' && (
            <div className="bl-drawer-sub">
              <Link to="/shop" className="bl-drawer-link">All Products</Link>
              {groups.map(group => (
                <div key={group.label}>
                  <Link to={`/shop?group=${encodeURIComponent(group.label)}`} className="bl-drawer-link" style={{ fontWeight: 600, color: 'var(--text)' }}>{group.label}</Link>
                  {group.items.map(item => comingSoonCats.includes(item) ? (
                    <div key={item} className="bl-drawer-link is-lvl2" style={{ opacity: .55 }}>{item}<span className="bl-chip grey">Coming soon</span></div>
                  ) : (
                    <Link key={item} to={`/shop?category=${encodeURIComponent(item)}`} className="bl-drawer-link is-lvl2">{item}</Link>
                  ))}
                </div>
              ))}
            </div>
          )}

          <Link to={`/shop?collection=${encodeURIComponent(COLLECTOR_LABEL)}`} className="bl-drawer-link" style={{ color: 'var(--gold)', fontWeight: 700 }}>{COLLECTOR_LABEL}</Link>
          <Link to="/gift-card" className="bl-drawer-link">Gift Cards</Link>

          <div className="bl-drawer-label">Company</div>
          {INFO_LINKS.map(l => <Link key={l.path} to={l.path} className="bl-drawer-link">{l.label}</Link>)}

          <div className="bl-drawer-label">My Account</div>
          <Link to={currentUser ? '/account' : '/login'} className="bl-drawer-link">{currentUser ? 'My Account' : 'Sign In'}</Link>
          <Link to="/account?tab=orders" className="bl-drawer-link">My Orders</Link>
          <Link to="/account?tab=wishlist" className="bl-drawer-link">Wishlist</Link>
          <Link to="/cart" className="bl-drawer-link">{`Cart (${cartCount})`}</Link>
          {currentUser && (
            <button type="button" className="bl-drawer-link" style={{ color: 'var(--error)' }} onClick={() => { logout(); navigate('/'); }}>Log out</button>
          )}

          <a href={`tel:${COMPANY.phoneTel}`} className="btn btn-outline" style={{ margin: '18px 18px 0', width: 'calc(100% - 36px)' }}>{Icon.phone} Call {COMPANY.phoneDisplay}</a>
        </div>
      </aside>

      {/* MOBILE BOTTOM TAB BAR -- floating, with a raised Cart button in the centre */}
      <nav className="bl-bottom-nav" aria-label="Primary">
        <Link to="/" className={`bl-bn-item${path === '/' ? ' is-active' : ''}`}>{Icon.home}<span>Home</span></Link>
        <Link to="/shop" className={`bl-bn-item${path.startsWith('/shop') ? ' is-active' : ''}`}>{Icon.grid}<span>Shop</span></Link>
        <Link to="/cart" className="bl-bn-item is-cart" aria-label={`Cart${cartCount > 0 ? `, ${cartCount} item${cartCount === 1 ? '' : 's'}` : ''}`}>
          <span className="bl-bn-fab">{Icon.cart}</span>
          {cartCount > 0 && <span className="bl-bn-badge">{cartCount}</span>}
        </Link>
        <Link to="/account?tab=wishlist" className={`bl-bn-item${path === '/account' && location.search.includes('wishlist') ? ' is-active' : ''}`}>{Icon.heart}<span>Wishlist</span></Link>
        <Link to={currentUser ? '/account' : '/login'} className={`bl-bn-item${(path === '/account' && !location.search.includes('wishlist')) || path === '/login' || path === '/register' ? ' is-active' : ''}`}>{Icon.user}<span>{currentUser ? 'Account' : 'Sign in'}</span></Link>
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
        @keyframes fadeIn { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:translateY(0); } }
      `}</style>
    </>
  );
}
