import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import brandMark from '../assets/brightlight-mark.png';
import { Button, ConfirmProvider, Icon } from './ui';
import { NAV_GROUPS, titleFor } from './navConfig';
import GlobalSearch from './GlobalSearch';
import AttentionBell from './AttentionBell';
import SectionBoundary from './SectionBoundary';
import { AdminCountsProvider, useAdminCounts } from './hooks/useAdminCounts';
import { UnsavedChangesProvider } from './hooks/useUnsavedChanges';
import { AUTH_EXPIRED_EVENT } from './hooks/adminWrite';

// The admin chrome: sticky sidebar (a drawer below 1024px), top bar (search, needs-attention bell, View store,
// Sign out) and the content area. Also provides what every screen below relies on: the confirm dialog
// (useConfirm), the unsaved-changes guard (useUnsavedChanges) and the shared attention counts (useAdminCounts).
function Chrome({ children }) {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { counts } = useAdminCounts();
  const [navOpen, setNavOpen] = useState(false);
  const menuBtn = useRef(null);
  const closeBtn = useRef(null);
  const lastExpiry = useRef(0);

  // Every screen change starts at the top, closes the mobile drawer and (below) announces the new page.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    setNavOpen(false);
  }, [pathname]);

  // Drawer: Escape closes it and the page behind it does not scroll while it is open.
  useEffect(() => {
    if (!navOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setNavOpen(false); menuBtn.current?.focus(); } };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    closeBtn.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [navOpen]);

  const signOut = useCallback(async () => {
    try { await logout(); } catch { /* the redirect below is what matters */ }
    navigate('/admin/login');
  }, [logout, navigate]);

  // A query or write found the login session gone (adminWrite / useServerList raise this event).
  useEffect(() => {
    const onExpired = () => {
      if (Date.now() - lastExpiry.current < 5000) return;
      lastExpiry.current = Date.now();
      toast.error('Your session has expired — please sign in again.');
      signOut();
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, [signOut]);

  const adminName = (currentUser?.user_metadata?.full_name || currentUser?.email || 'Admin').split('@')[0];

  return (
    <div className="adm">
      <div className="adm-shell">
        <aside id="adm-sidebar" className={`adm-sidebar${navOpen ? ' is-open' : ''}`} aria-label="Admin navigation">
          <div className="adm-brand">
            <img src={brandMark} alt="" />
            <div className="adm-brand-name">Bright<b>light</b></div>
            <span className="adm-brand-tag">Admin</span>
            <button ref={closeBtn} type="button" className="adm-drawer-close" onClick={() => { setNavOpen(false); menuBtn.current?.focus(); }} aria-label="Close menu"><Icon name="close" size={18} /></button>
          </div>
          <nav className="adm-nav" aria-label="Admin sections">
            {NAV_GROUPS.map(g => (
              <div className="adm-nav-group" key={g.label}>
                <div className="adm-nav-label">{g.label}</div>
                {g.items.map(it => {
                  const n = it.countKey ? counts[it.countKey] : 0;
                  return (
                    <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => `adm-nav-item${isActive ? ' is-active' : ''}`}>
                      <Icon name={it.icon} size={19} />
                      <span>{it.label}</span>
                      {n > 0 && <span className="adm-nav-count" aria-label={`${n} need attention`}>{n > 99 ? '99+' : n}</span>}
                    </NavLink>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="adm-side-foot">
            <div className="adm-user">
              <div className="adm-avatar" aria-hidden="true">{(adminName[0] || 'A').toUpperCase()}</div>
              <div className="adm-user-meta">
                <div className="adm-user-role">Signed in as admin</div>
                <div className="adm-user-email" title={currentUser?.email}>{currentUser?.email}</div>
              </div>
            </div>
          </div>
        </aside>
        <div className={`adm-scrim${navOpen ? ' is-open' : ''}`} onClick={() => setNavOpen(false)} aria-hidden="true" />

        <div className="adm-main">
          <header className="adm-topbar">
            <button ref={menuBtn} type="button" className="adm-menu-btn" onClick={() => setNavOpen(true)} aria-label="Open menu" aria-controls="adm-sidebar" aria-expanded={navOpen}><Icon name="menu" size={20} /></button>
            <GlobalSearch />
            <div className="adm-top-actions">
              <AttentionBell />
              <Button className="adm-hide-sm" icon="store" href="/" target="_blank">View store</Button>
              <Button variant="primary" icon="logout" onClick={signOut}>Sign out</Button>
            </div>
          </header>

          <div className="adm-content">
            {/* Tells screen-reader users which screen they just landed on (the page itself does not reload). */}
            <div className="adm-sr" role="status" aria-live="polite">{titleFor(pathname)}</div>
            <SectionBoundary resetKey={pathname}>{children}</SectionBoundary>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminLayout({ children }) {
  return (
    <ConfirmProvider>
      <UnsavedChangesProvider>
        <AdminCountsProvider>
          <Chrome>{children}</Chrome>
        </AdminCountsProvider>
      </UnsavedChangesProvider>
    </ConfirmProvider>
  );
}
