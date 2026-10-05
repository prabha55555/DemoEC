import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabase';
import { useBrand } from '../context/BrandContext';
import { COMPANY } from '../config/company';
import BlurImage from './BlurImage';
import markImg from '../assets/brightlight-mark.png';
import { thumb } from '../utils/thumbnail';
import { HERO_CTA_POSITIONS, HERO_HEADLINE_SIZES, HERO_SUBTEXT_SIZES } from '../utils/heroCtaPositions';

// Copy-pasted per-file rather than a shared hook, matching this codebase's existing
// convention (Home.jsx and PageHero.jsx both carry local copies).
function useIsMobile(bp = 768) {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width: ${bp}px)`).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${bp}px)`);
    const handler = e => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [bp]);
  return isMobile;
}

// Gold ribbon / star artwork drawn in SVG so the default banners need no image uploads.
function PromoArt({ variant }) {
  // Ribbons are teal / yellow / white shapes; the logo gold is not used here.
  const palette = {
    dark: { stops: ['#5EEAD4', '#14B8A6', '#0F766E'], star: '#FFC93C', o1: .95, o2: .5 },
    sun:  { stops: ['#FFFFFF', '#FFF1B8', '#FFE08A'], star: '#0F766E', o1: .55, o2: .35 },
    mint: { stops: ['#8FE3D8', '#14B8A6', '#0F766E'], star: '#FFC93C', o1: 1, o2: .5 },
  }[variant] || { stops: ['#5EEAD4', '#14B8A6', '#0F766E'], star: '#FFC93C', o1: .95, o2: .5 };
  return (
    <svg className="bl-promo-art" viewBox="0 0 400 300" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={`bl-g-${variant}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={palette.stops[0]} />
          <stop offset=".55" stopColor={palette.stops[1]} />
          <stop offset="1" stopColor={palette.stops[2]} />
        </linearGradient>
      </defs>
      <path d="M400 0 C300 40 230 120 190 300 L260 300 C290 170 340 90 400 60Z" fill={`url(#bl-g-${variant})`} opacity={palette.o1} />
      <path d="M400 70 C330 110 290 180 270 300 L310 300 C330 210 360 150 400 120Z" fill={`url(#bl-g-${variant})`} opacity={palette.o2} />
      <path d="M330 40 L338 66 L364 74 L338 82 L330 108 L322 82 L296 74 L322 66Z" fill={palette.star} opacity=".97" />
      {variant === 'mint' && <image href={markImg} x="215" y="50" width="170" height="172" />}
    </svg>
  );
}

// Shown when no slides have been configured in Admin -> Hero Slides, so a fresh
// install already opens with a proper marketplace banner instead of an empty gap.
const DEFAULT_PROMOS = [
  {
    key: 'p1', variant: 'dark', kicker: 'Welcome to Brightlight',
    title: <>Shop everything you love, <em>delivered free</em></>,
    text: 'Fashion, home, beauty, electronics and more — all in one place, at prices you will like.',
    cta: { label: 'Shop Now', to: '/shop' },
  },
  {
    key: 'p2', variant: 'sun', kicker: 'New arrivals',
    title: <>Fresh finds, <em>every day</em></>,
    text: 'Discover the latest products across all categories.',
    cta: { label: 'Explore Now', to: '/shop', dark: true },
  },
  {
    key: 'p3', variant: 'mint', kicker: 'Free delivery',
    title: <>Free delivery on <em>every order</em></>,
    text: `Order today and get it delivered to your door. Need help? Call ${COMPANY.phoneDisplay} — we are available ${COMPANY.hours.toLowerCase()}.`,
    cta: { label: 'Start Shopping', to: '/shop' },
  },
];

export default function HeroSlider() {
  const { brand } = useBrand();
  const isMobile = useIsMobile(768);
  const [slides, setSlides] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState(0);
  const pausedRef = useRef(false);
  const touchX = useRef(null);
  const useDefaults = loaded && slides.length === 0;
  const count = useDefaults ? DEFAULT_PROMOS.length : slides.length;
  const intervalMs = Number(brand.hero_slider_interval_ms) || 4000;
  const showDots = brand.hero_slider_show_dots !== false;
  const showArrows = brand.hero_slider_show_arrows !== false;

  useEffect(() => {
    supabase.from('hero_slides').select('*').eq('active', true).order('display_order')
      .then(({ data }) => { if (data) setSlides(data); }, () => {})
      .then(() => setLoaded(true));
  }, []);

  // A ref, not state -- so hovering doesn't tear down/recreate the interval on
  // every mouse move, it just makes the existing tick a no-op while paused.
  const goTo = (i) => setActive(((i % count) + count) % count);

  useEffect(() => {
    if (count < 2) return;
    // prefers-reduced-motion stops the auto-advance outright -- the slider is
    // still fully usable via the arrows/dots, just never auto-advances.
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => {
      if (!pausedRef.current) setActive(i => (i + 1) % count);
    }, Math.max(intervalMs, 3000));
    return () => clearInterval(id);
  }, [count, intervalMs]);

  // A shorter slide list (admin removed one) can leave the index past the end.
  useEffect(() => { if (count > 0 && active >= count) setActive(0); }, [count, active]);

  if (!loaded || count === 0) {
    // Reserve the banner's space while slides load so the page doesn't jump.
    return (
      <div className="bl-hero" aria-hidden="true"><div className="bl-hero-track" style={{ background: 'linear-gradient(120deg,#DCEFEB,#F1F8F6)' }} /></div>
    );
  }

  // Pauses auto-advance for the duration of a touch the same way hover does for a mouse.
  function onTouchStart(e) { touchX.current = e.touches[0].clientX; pausedRef.current = true; }
  function onTouchEnd(e) {
    pausedRef.current = false;
    if (touchX.current === null || count < 2) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 40) goTo(active + (dx < 0 ? 1 : -1));
    touchX.current = null;
  }

  return (
    <div style={{ minWidth: 0 }} aria-roledescription="carousel" aria-label="Featured offers">
      <div
        className="bl-hero"
        onMouseEnter={() => { pausedRef.current = true; }}
        onMouseLeave={() => { pausedRef.current = false; }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="bl-hero-track">
          {useDefaults ? DEFAULT_PROMOS.map((s, i) => (
            <div key={s.key} className={`bl-hero-slide${i === active ? ' is-active' : ''}`} aria-hidden={i !== active}>
              <div className={`bl-promo v-${s.variant}`}>
                <PromoArt variant={s.variant} />
                <div className="bl-promo-copy">
                  <span className="bl-promo-kicker">{s.kicker}</span>
                  <h2 className="bl-promo-title">{s.title}</h2>
                  <p className="bl-promo-text">{s.text}</p>
                  <Link to={s.cta.to} className={`btn bl-promo-cta ${s.cta.dark ? 'btn-dark' : 'btn-sun'}`} tabIndex={i === active ? 0 : -1}>{s.cta.label}</Link>
                </div>
              </div>
            </div>
          )) : slides.map((slide, i) => {
            // Mobile falls back to bottom-center only if the slide has no mobile
            // position of its own set.
            const positionKey = isMobile
              ? (slide.mobile_cta_position || 'bottom-center')
              : (slide.cta_position || 'bottom-left');
            const position = HERO_CTA_POSITIONS[positionKey] || HERO_CTA_POSITIONS['bottom-left'];
            const showCta = slide.show_cta !== false && slide.cta_link;
            // Mobile uses a dedicated vertical photo when the admin has uploaded one.
            const hasMobileImage = isMobile && slide.mobile_image_url;
            const imgSrc = hasMobileImage ? slide.mobile_image_url : slide.image_url;
            const imgPosition = hasMobileImage ? '50% 50%' : (slide.image_position || '50% 50%');
            const hasText = !!(slide.headline || slide.subtext || showCta);
            const side = position.justifyContent === 'flex-start' ? 'flex-start' : position.justifyContent === 'flex-end' ? 'flex-end' : 'center';
            return (
              <div key={slide.id ?? i} className={`bl-hero-slide${i === active ? ' is-active' : ''}`} aria-hidden={i !== active}>
                <BlurImage
                  src={thumb(imgSrc, hasMobileImage ? 1200 : 1920)}
                  alt=""
                  aria-hidden="true"
                  showBuffering
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: imgPosition, background: '#EFEBDD' }}
                />
                {hasText && <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(20,17,11,.62) 0%, rgba(20,17,11,.18) 55%, rgba(20,17,11,.3) 100%)' }} />}
                {/* flexDirection is deliberately row (the default): HERO_CTA_POSITIONS' values assume
                    justifyContent=horizontal and alignItems=vertical, which is only true for a row-direction flex container. */}
                <div style={{ position: 'absolute', inset: 0, display: 'flex', padding: 'clamp(14px,3.2vw,44px)', ...position }}>
                  <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: '.6rem', alignItems: side, textAlign: side === 'flex-start' ? 'left' : side === 'flex-end' ? 'right' : 'center' }}>
                    {/* whiteSpace:'pre' -- a line only breaks where the admin actually pressed Enter. */}
                    {slide.headline && (
                      <h2 style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: HERO_HEADLINE_SIZES[(isMobile && slide.mobile_headline_size) || slide.headline_size] || HERO_HEADLINE_SIZES.medium, color: '#fff', lineHeight: 1.08, textShadow: '0 2px 18px rgba(0,0,0,.45)', margin: 0, whiteSpace: 'pre', letterSpacing: '-.02em' }}>{slide.headline}</h2>
                    )}
                    {slide.subtext && (
                      <p style={{ fontWeight: 600, fontSize: HERO_SUBTEXT_SIZES[slide.subtext_size] || HERO_SUBTEXT_SIZES.medium, color: '#fff', textShadow: '0 1px 10px rgba(0,0,0,.5)', margin: 0, maxWidth: isMobile ? 320 : undefined }}>{slide.subtext}</p>
                    )}
                    {showCta && (
                      <div className="hero-cta-row" style={{ display: 'flex', gap: '.6rem', marginTop: '.2rem', justifyContent: side }}>
                        <a href={slide.cta_link} className="btn btn-sun" style={{ textDecoration: 'none' }} tabIndex={i === active ? 0 : -1}>{slide.cta_label || 'Shop Now'}</a>
                        {(slide.extra_ctas || []).filter(c => c.link).map((c, j) => (
                          <a key={j} href={c.link} className="btn btn-outline" style={{ textDecoration: 'none' }} tabIndex={i === active ? 0 : -1}>{c.label || 'Learn More'}</a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {count > 1 && showArrows && (
          <>
            <button type="button" aria-label="Previous slide" onClick={() => goTo(active - 1)} className="bl-hero-arrow l">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <button type="button" aria-label="Next slide" onClick={() => goTo(active + 1)} className="bl-hero-arrow r">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </>
        )}

        {count > 1 && showDots && (
          <div className="bl-hero-dots">
            {Array.from({ length: count }).map((_, i) => (
              <button type="button" key={i} aria-label={`Go to slide ${i + 1}`} aria-current={i === active} onClick={() => goTo(i)} className={`bl-hero-dot${i === active ? ' is-active' : ''}`} />
            ))}
          </div>
        )}
      </div>

      <style>{`
        .bl-hero-grid > div > .bl-hero { height: 100%; }
        .bl-promo.v-dark { background: radial-gradient(120% 140% at 85% 20%, #0F766E 0%, #083F3B 62%); }
        .bl-promo.v-sun { background: linear-gradient(120deg, #FFC93C 0%, #FFD966 55%, #FFE9A8 100%); color: var(--ink); }
        .bl-promo.v-sun .bl-promo-text { color: rgba(16,32,30,.78); }
        .bl-promo.v-sun .bl-promo-kicker { background: rgba(16,32,30,.08); border-color: rgba(16,32,30,.25); color: var(--ink); }
        .bl-promo.v-sun .bl-promo-title em { color: var(--primary-dark); }
        .bl-promo.v-mint { background: linear-gradient(110deg, #D8F3EE 0%, #FFFFFF 70%); color: var(--ink); }
        .bl-promo.v-mint .bl-promo-text { color: var(--text-muted); }
        .bl-promo.v-mint .bl-promo-kicker { background: var(--primary-tint); border-color: var(--primary-border); color: var(--primary); }
        .bl-promo.v-mint .bl-promo-title em { color: var(--primary); }
        .hero-cta-row { flex-wrap: nowrap; }
        @media (max-width: 359px) { .hero-cta-row { flex-wrap: wrap; } }
        @media (max-width: 768px) { .hero-cta-row .btn { font-size: 12.5px; padding: 8px 16px; min-height: 38px; } }
      `}</style>
    </div>
  );
}
