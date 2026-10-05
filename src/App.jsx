import React, { useEffect, useLayoutEffect, useRef, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import { BrandProvider, useBrand } from './context/BrandContext';
import { CartProvider } from './context/CartContext';
import { ProtectedRoute, AdminRoute } from './components/ProtectedRoute';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import FloatingWhatsApp from './components/FloatingWhatsApp';
import BufferingLogo from './components/BufferingLogo';
import ErrorBoundary from './components/ErrorBoundary';
import { Analytics } from '@vercel/analytics/react';
import './styles/globals.css';
// Home, Shop, and the product detail page are the most common landing pages (direct
// visits, search, ads) and stay in the main bundle so they render with no extra
// round trip. Everything else -- especially Admin, a ~1,500-line back-office CRUD
// that every anonymous shopper used to download and parse before seeing the
// homepage -- is code-split and only fetched when actually navigated to.
import Home from './pages/Home';
import Shop from './pages/Shop';
import ProductPage from './pages/ProductPage';
const Cart = lazy(() => import('./pages/Cart'));
const Checkout = lazy(() => import('./pages/Checkout'));
const Confirmation = lazy(() => import('./pages/Confirmation'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Account = lazy(() => import('./pages/Account'));
const Admin = lazy(() => import('./pages/Admin'));
const AdminLogin = lazy(() => import('./pages/AdminLogin'));
const About = lazy(() => import('./pages/AboutContact').then(m => ({ default: m.About })));
const Contact = lazy(() => import('./pages/AboutContact').then(m => ({ default: m.Contact })));
const Terms = lazy(() => import('./pages/Terms'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const ShippingPolicy = lazy(() => import('./pages/ShippingPolicy'));
const Stories = lazy(() => import('./pages/Stories'));
const StoryPage = lazy(() => import('./pages/StoryPage'));
const Care = lazy(() => import('./pages/Care'));
const GiftCard = lazy(() => import('./pages/GiftCard'));

// Every page change starts at the top. Two things used to defeat a plain scrollTo on mobile:
// globals.css sets `html { scroll-behavior: smooth }` (older iOS Safari ignores behavior:'instant'
// and animates, and that animation gets cut short when the lazily-loaded page swaps in and the
// document height changes), and lazy routes render their real content a moment AFTER the path
// changes. So: jump with smooth scrolling switched off, and repeat once the new page has painted.
function ScrollToTop() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    const html = document.documentElement;
    const jump = () => {
      const prev = html.style.scrollBehavior;
      html.style.scrollBehavior = 'auto';
      window.scrollTo(0, 0);
      html.scrollTop = 0;
      document.body.scrollTop = 0;
      html.style.scrollBehavior = prev;
    };
    jump();
    const raf = requestAnimationFrame(jump);
    const t1 = setTimeout(jump, 120);
    const t2 = setTimeout(jump, 400);
    return () => { cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2); };
  }, [pathname]);
  return null;
}

function ScrollProgress() {
  const progressRef = useRef(null);
  useEffect(() => {
    const prog = progressRef.current;
    function onScroll() {
      if (!prog) return;
      const doc = document.documentElement;
      const pct = doc.scrollHeight === doc.clientHeight ? 0 : (doc.scrollTop / (doc.scrollHeight - doc.clientHeight)) * 100;
      prog.style.width = Math.min(pct, 100) + '%';
    }
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return <div className="tt-progress" ref={progressRef}></div>;
}

function AppLayout({ children }) {
  const { pathname } = useLocation();
  const isAdminPage = pathname.startsWith('/admin');
  // Product/cart/checkout pages carry their own sticky bottom action bar, which the floating chat button would overlap.
  const hideFloatingChat = /^\/(product|cart|checkout)/.test(pathname);
  return (
    <>
      {/* Off-screen until focused (see .skip-link in globals.css) -- lets a
          keyboard user jump past the nav/hero straight to the page content
          instead of tabbing through every nav link and dropdown first. */}
      <a href="#main-content" className="skip-link">Skip to content</a>
      {!isAdminPage && <Navbar />}
      {/* tabIndex=-1: <main> isn't focusable by default, so the skip link's
          href="#main-content" would scroll here without ever moving keyboard
          focus off the nav -- this lets it actually receive focus. */}
      <main id="main-content" tabIndex={-1}>{children}</main>
      {!isAdminPage && <Footer />}
      {!isAdminPage && !hideFloatingChat && <FloatingWhatsApp />}
    </>
  );
}

// Branded splash shown while brand settings load; uses the shared BufferingLogo
// indicator (same "buffering logo" visual used for images and route loading) instead
// of its own separate spinner. Unmounts on the fade's own transitionend event rather
// than a hardcoded setTimeout that had to be kept in sync with the CSS duration by hand.
//
// Capped at 1.2s regardless of `loading` -- BrandContext already seeds sane
// defaults for every field synchronously (see BrandContext.jsx), so the real
// site underneath is already correct even before the fetch resolves. Blocking
// every visit on a full network round trip (previously up to BrandContext's
// own 8s timeout) turned a cosmetic branding flash into a real "the whole app
// is frozen" wait on a slow connection.
function SplashScreen() {
  const { loading } = useBrand();
  const [gone, setGone] = React.useState(false);
  const [timedOut, setTimedOut] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 1200);
    return () => clearTimeout(t);
  }, []);
  if (gone) return null;
  const visible = loading && !timedOut;
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 99999, background: 'var(--bg)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: visible ? 1 : 0, transition: 'opacity .3s ease', pointerEvents: visible ? 'auto' : 'none',
      }}
      onTransitionEnd={() => { if (!visible) setGone(true); }}
    >
      <BufferingLogo size={160} />
    </div>
  );
}

function NotFound() {
  return (
    <div style={{ paddingTop: 'var(--hdr-h)', minHeight: '80vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', padding: '60px 24px' }}>
        {/* "404" itself is decorative (the real page title is the h1 below) --
            aria-hidden keeps a screen reader from announcing a bare "404". */}
        <div aria-hidden="true" style={{ fontFamily: 'var(--font-head)', fontSize: 'clamp(80px,14vw,140px)', fontWeight: 800, lineHeight: 1, background: 'var(--grad-teal)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>404</div>
        <h1 style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 22, color: 'var(--text)', margin: '6px 0 10px' }}>Page not found</h1>
        <p style={{ fontSize: 15, color: 'var(--text-muted)', marginBottom: 24 }}>The page you are looking for does not exist or has moved.</p>
        <Link to="/" className="btn btn-sun" style={{ textDecoration: 'none', display: 'inline-flex' }}>Return Home</Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <AuthProvider>
        <BrandProvider>
          <CartProvider>
            <SplashScreen />
            <ScrollProgress />
            <Toaster
              position="bottom-center"
              containerStyle={{ bottom: 'calc(var(--bottom-nav-h) + 14px)' }}
              toastOptions={{
                style: {
                  fontFamily: "var(--font-body)", fontWeight: 500, fontSize: '14px',
                  background: '#1F2A28', color: '#fff',
                  borderRadius: 6, padding: '10px 16px', boxShadow: '0 6px 18px rgba(31,42,40,.25)',
                },
                success: { iconTheme: { primary: '#FFC93C', secondary: '#1F2A28' } },
                error: { iconTheme: { primary: '#FF8A7A', secondary: '#1F2A28' } },
              }}
            />
            <ScrollToTop />
            <AppLayout>
              <Suspense fallback={<BufferingLogo fullPage size={72} />}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/shop" element={<Shop />} />
                <Route path="/gift-card" element={<GiftCard />} />
                <Route path="/product/:id" element={<ProductPage />} />
                <Route path="/about" element={<About />} />
                <Route path="/contact" element={<Contact />} />
                <Route path="/insights" element={<Stories />} />
                <Route path="/insights/:id" element={<StoryPage />} />
                <Route path="/help" element={<Care />} />
                <Route path="/cart" element={<Cart />} />
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/checkout" element={<Checkout />} />
                <Route path="/confirmation" element={<Confirmation />} />
                <Route path="/account" element={<ProtectedRoute><Account /></ProtectedRoute>} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/privacy-policy" element={<PrivacyPolicy />} />
                <Route path="/shipping-policy" element={<ShippingPolicy />} />
                <Route path="/admin/login" element={<AdminLogin />} />
                <Route path="/admin" element={<AdminRoute><Admin /></AdminRoute>} />
                <Route path="*" element={<NotFound />} />
              </Routes>
              </Suspense>
            </AppLayout>
          </CartProvider>
        </BrandProvider>
      </AuthProvider>
    </BrowserRouter>
    <Analytics />
    </ErrorBoundary>
  );
}
