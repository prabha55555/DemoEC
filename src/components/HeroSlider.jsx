import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabase';
import { useBrand } from '../context/BrandContext';
import { COMPANY } from '../config/company';
import BlurImage from './BlurImage';
import { thumb } from '../utils/thumbnail';
import { safeHref, isInternalPath } from '../utils/safeUrl';
import { useIsMobile } from '../utils/useMediaQuery';
import { shippingPromise, returnWindowDays } from '../utils/storeCopy';
import { DEALS_PATH } from '../utils/shopQuery';
import { HERO_CTA_POSITIONS, HERO_HEADLINE_SIZES, HERO_SUBTEXT_SIZES } from '../utils/heroCtaPositions';

// A link an admin typed into a slide: an on-site path ("/shop?sort=discount") navigates inside the app, anything
// else (https://...) is a normal link. Unsafe values (javascript:, data: ...) render nothing.
function CtaLink({ to, className, style, tabIndex, children }) {
  const href = safeHref(to);
  if (!href) return null;
  return isInternalPath(href)
    ? <Link to={href} className={className} style={style} tabIndex={tabIndex}>{children}</Link>
    : <a href={href} className={className} style={style} tabIndex={tabIndex}>{children}</a>;
}

// Shown when no slides have been configured in Admin -> Hero Slides, so a fresh store still opens with a proper
// banner. Generic on purpose; the delivery slide reads the store's own shipping/returns settings.
function defaultSlides(brand) {
  const days = returnWindowDays(null, brand);
  const perks = ['Secure online payments', days > 0 ? `${days}-day easy returns` : null, brand.cod_enabled ? 'Cash on Delivery' : null].filter(Boolean);
  return [
    {
      key: 'welcome', variant: 'teal', kicker: `Welcome to ${COMPANY.shortName}`,
      title: <>Everything you need, <em>delivered.</em></>,
      text: 'Fashion, home, beauty, electronics and more, all in one place.',
      cta: { label: 'Shop now', to: '/shop' },
    },
    {
      key: 'deals', variant: 'sun', kicker: 'Deals of the day',
      title: <>Great prices, <em>every day</em></>,
      text: 'Save on fashion, home, beauty and electronics.',
      cta: { label: 'See all deals', to: DEALS_PATH, dark: true },
    },
    {
      key: 'delivery', variant: 'ink', kicker: 'Delivered to your door',
      title: <>{shippingPromise(brand)}</>,
      text: perks.join(' · '),
      cta: { label: 'Start shopping', to: '/shop' },
    },
  ];
}

export default function HeroSlider() {
  const { brand } = useBrand();
  const isMobile = useIsMobile(768);
  const [slides, setSlides] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState(0);
  const pausedRef = useRef(false);
  const touchX = useRef(null);
  const useDefaults = loaded && slides.length === 0;
  const defaults = useDefaults ? defaultSlides(brand) : [];
  const count = useDefaults ? defaults.length : slides.length;
  const intervalMs = Number(brand.hero_slider_interval_ms) || 4000;
  const showDots = brand.hero_slider_show_dots !== false;
  const showArrows = brand.hero_slider_show_arrows !== false;

  useEffect(() => {
    supabase.from('hero_slides').select('*').eq('active', true).order('display_order')
      .then(({ data }) => { if (data) setSlides(data); }, () => {})
      .then(() => setLoaded(true));
  }, []);

  const goTo = (i) => setActive(((i % count) + count) % count);

  // A ref, not state -- so hovering doesn't tear down/recreate the interval, it just makes the tick a no-op while paused.
  useEffect(() => {
    if (count < 2) return undefined;
    // prefers-reduced-motion stops the auto-advance outright; the arrows and dots still work.
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const id = setInterval(() => { if (!pausedRef.current) setActive(i => (i + 1) % count); }, Math.max(intervalMs, 3000));
    return () => clearInterval(id);
  }, [count, intervalMs]);

  // A shorter slide list (admin removed one) can leave the index past the end.
  useEffect(() => { if (count > 0 && active >= count) setActive(0); }, [count, active]);

  if (!loaded || count === 0) {
    // Reserve the banner's space while slides load so the page doesn't jump.
    return <div className="bl-hero" aria-hidden="true"><div className="bl-hero-track" style={{ background: '#E3EEEC' }} /></div>;
  }

  function onTouchStart(e) { touchX.current = e.touches[0].clientX; pausedRef.current = true; }
  function onTouchEnd(e) {
    pausedRef.current = false;
    if (touchX.current === null || count < 2) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 40) goTo(active + (dx < 0 ? 1 : -1));
    touchX.current = null;
  }

  return (
    <div style={{ minWidth: 0 }} role="region" aria-roledescription="carousel" aria-label="Featured offers">
      <div
        className="bl-hero"
        onMouseEnter={() => { pausedRef.current = true; }}
        onMouseLeave={() => { pausedRef.current = false; }}
        onFocus={() => { pausedRef.current = true; }}
        onBlur={() => { pausedRef.current = false; }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div className="bl-hero-track" aria-live="off">
          {useDefaults ? defaults.map((s, i) => (
            <div key={s.key} className={`bl-hero-slide${i === active ? ' is-active' : ''}`} aria-hidden={i !== active}>
              <div className={`bl-promo v-${s.variant}`}>
                <div className="bl-promo-copy">
                  <span className="bl-promo-kicker">{s.kicker}</span>
                  <h2 className="bl-promo-title">{s.title}</h2>
                  {s.text && <p className="bl-promo-text">{s.text}</p>}
                  <CtaLink to={s.cta.to} className={`btn bl-promo-cta ${s.cta.dark ? 'btn-dark' : 'btn-sun'}`} tabIndex={i === active ? 0 : -1}>{s.cta.label}</CtaLink>
                </div>
              </div>
            </div>
          )) : slides.map((slide, i) => {
            // Mobile falls back to bottom-center only if the slide has no mobile position of its own set.
            const positionKey = isMobile ? (slide.mobile_cta_position || 'bottom-center') : (slide.cta_position || 'bottom-left');
            const position = HERO_CTA_POSITIONS[positionKey] || HERO_CTA_POSITIONS['bottom-left'];
            const showCta = slide.show_cta !== false && !!safeHref(slide.cta_link);
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
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: imgPosition, background: '#EEF2F1' }}
                />
                {hasText && <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(15,25,24,.58) 0%, rgba(15,25,24,.16) 55%, rgba(15,25,24,.26) 100%)' }} />}
                {/* flexDirection is deliberately row (the default): HERO_CTA_POSITIONS' values assume justifyContent=horizontal and
                    alignItems=vertical, which is only true for a row-direction flex container. */}
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
                        <CtaLink to={slide.cta_link} className="btn btn-sun" style={{ textDecoration: 'none' }} tabIndex={i === active ? 0 : -1}>{slide.cta_label || 'Shop now'}</CtaLink>
                        {(slide.extra_ctas || []).filter(c => c.link).map((c, j) => (
                          <CtaLink key={j} to={c.link} className="btn btn-outline" style={{ textDecoration: 'none' }} tabIndex={i === active ? 0 : -1}>{c.label || 'Learn more'}</CtaLink>
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
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <button type="button" aria-label="Next slide" onClick={() => goTo(active + 1)} className="bl-hero-arrow r">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
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
        .hero-cta-row { flex-wrap: nowrap; }
        @media (max-width: 359px) { .hero-cta-row { flex-wrap: wrap; } }
        @media (max-width: 768px) { .hero-cta-row .btn { font-size: 12.5px; padding: 8px 16px; min-height: 38px; } }
      `}</style>
    </div>
  );
}
