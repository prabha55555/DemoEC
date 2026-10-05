import React from 'react';
import { thumb } from '../utils/thumbnail';
import { HERO_CTA_POSITIONS, HERO_HEADLINE_PREVIEW_SIZES, HERO_SUBTEXT_PREVIEW_SIZES } from '../utils/heroCtaPositions';

// Miniature, fixed-size (not clamp()-scaled) rendition of a slide, used in the Admin
// Hero Slides list and edit form -- shares HERO_CTA_POSITIONS with the real
// HeroSlider so "button appears exactly where selected" stays true between the two.
// `mobile` renders using the slide's mobile position override (falling back to the
// desktop one, same as HeroSlider itself) instead of the desktop position.
export default function SlidePreview({ slide, width = 220, height = 124, mobile = false }) {
  const positionKey = mobile
    ? (slide.mobile_cta_position || slide.cta_position || 'bottom-center')
    : (slide.cta_position || 'bottom-left');
  const position = HERO_CTA_POSITIONS[positionKey] || HERO_CTA_POSITIONS['bottom-left'];
  const align = position.justifyContent === 'flex-start' ? 'flex-start' : position.justifyContent === 'flex-end' ? 'flex-end' : 'center';
  const textAlign = align === 'flex-start' ? 'left' : align === 'flex-end' ? 'right' : 'center';
  const showCta = slide.show_cta !== false && slide.cta_link;
  // Mirrors HeroSlider.jsx exactly: a dedicated mobile photo covers full; without
  // one, mobile shows the desktop photo uncropped (contain) instead of guessing a crop.
  const hasMobileImage = mobile && slide.mobile_image_url;
  const imgSrc = hasMobileImage ? slide.mobile_image_url : slide.image_url;
  const imgFit = hasMobileImage ? 'cover' : (mobile ? 'contain' : 'cover');
  const imgPosition = hasMobileImage ? '50% 50%' : (slide.image_position || '50% 50%');

  return (
    <div style={{ position: 'relative', width, height, overflow: 'hidden', background: 'var(--bg-hover)', border: '1px solid var(--line)', flexShrink: 0 }}>
      {imgSrc && (
        <img src={thumb(imgSrc, 400)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: imgFit, objectPosition: imgPosition }} />
      )}
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(30,27,20,.4) 0%, rgba(30,27,20,.1) 45%, rgba(30,27,20,.45) 100%)' }} />
      {/* Row, not column -- HERO_CTA_POSITIONS assumes justifyContent=horizontal,
          alignItems=vertical, which only holds for a row-direction container. */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', padding: 8, ...position }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: align, textAlign, maxWidth: '90%' }}>
          {slide.headline && (
            <div style={{ fontFamily: "var(--font-body)", fontWeight: 700, fontSize: HERO_HEADLINE_PREVIEW_SIZES[(mobile && slide.mobile_headline_size) || slide.headline_size] || HERO_HEADLINE_PREVIEW_SIZES.medium, color: '#F2EFE4', lineHeight: 1.08, textShadow: '0 1px 6px rgba(0,0,0,.5)', whiteSpace: 'pre' }}>{slide.headline}</div>
          )}
          {slide.subtext && (
            <div style={{ fontFamily: "var(--font-body)", fontWeight: 700, fontSize: HERO_SUBTEXT_PREVIEW_SIZES[slide.subtext_size] || HERO_SUBTEXT_PREVIEW_SIZES.medium, fontStyle: 'normal', color: '#F2EFE4', textShadow: '0 1px 6px rgba(0,0,0,.5)' }}>{slide.subtext}</div>
          )}
          {showCta && (
            <div style={{ display: 'flex', gap: 3, marginTop: 1 }}>
              <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 7, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-dark)', background: 'var(--gd)', padding: '3px 7px' }}>{slide.cta_label || 'Shop Now'}</div>
              {(slide.extra_ctas || []).filter(c => c.link).length > 0 && (
                <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 600, fontSize: 7, letterSpacing: '.04em', color: 'var(--gd)', background: 'var(--text-dark)', padding: '3px 6px' }}>+{slide.extra_ctas.filter(c => c.link).length}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
