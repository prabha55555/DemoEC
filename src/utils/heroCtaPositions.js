// Single source of truth for the 9 content-block position presets -- imported by
// both the live HeroSlider and the admin SlidePreview so "button appears exactly
// where selected" stays true instead of the two drifting apart over time.
// 3x3 grid, same shape as the existing image focal-point picker (IMAGE_POSITIONS
// in Admin.jsx) for a consistent picking experience across the two features.
export const HERO_CTA_POSITIONS = {
  'top-left':      { alignItems: 'flex-start', justifyContent: 'flex-start' },
  'top-center':    { alignItems: 'flex-start', justifyContent: 'center' },
  'top-right':     { alignItems: 'flex-start', justifyContent: 'flex-end' },
  'center-left':   { alignItems: 'center',     justifyContent: 'flex-start' },
  'center-center': { alignItems: 'center',     justifyContent: 'center' },
  'center-right':  { alignItems: 'center',     justifyContent: 'flex-end' },
  'bottom-left':   { alignItems: 'flex-end',   justifyContent: 'flex-start' },
  'bottom-center': { alignItems: 'flex-end',   justifyContent: 'center' },
  'bottom-right':  { alignItems: 'flex-end',   justifyContent: 'flex-end' },
};

// Row/col order matching a 3x3 grid layout (top row first), for the visual picker.
export const HERO_CTA_POSITION_GRID = [
  ['top-left', 'top-center', 'top-right'],
  ['center-left', 'center-center', 'center-right'],
  ['bottom-left', 'bottom-center', 'bottom-right'],
];
export const HERO_CTA_POSITION_OPTIONS = Object.keys(HERO_CTA_POSITIONS);

// Headline size presets -- two parallel scales sharing the same keys, so the live
// HeroSlider (responsive clamp()) and the admin SlidePreview (fixed miniature px)
// stay in step without either one guessing the other's units.
// "medium" (the default) is deliberately anchored close to the old static hero's
// .display class (globals.css: clamp(2.8rem,7vw,5.8rem)) -- a slide left at the
// default should read as at least as big/premium as the hero it replaced, not smaller.
export const HERO_HEADLINE_SIZES = {
  small:  'clamp(1.8rem,4vw,2.8rem)',
  medium: 'clamp(2.6rem,6.5vw,5rem)',
  large:  'clamp(3.2rem,8vw,6.5rem)',
  xl:     'clamp(3.8rem,9.5vw,8rem)',
};
export const HERO_HEADLINE_PREVIEW_SIZES = { small: 11, medium: 15, large: 19, xl: 23 };
export const HERO_HEADLINE_SIZE_OPTIONS = Object.keys(HERO_HEADLINE_SIZES);

// Subtext size presets -- same idea, scaled down from the headline ladder since
// a subtext should never out-size its headline at any tier.
export const HERO_SUBTEXT_SIZES = {
  small:  'clamp(.95rem,1.8vw,1.2rem)',
  medium: 'clamp(1.15rem,2.4vw,1.6rem)',
  large:  'clamp(1.4rem,3vw,2rem)',
  xl:     'clamp(1.7rem,3.6vw,2.5rem)',
};
export const HERO_SUBTEXT_PREVIEW_SIZES = { small: 8, medium: 10, large: 12, xl: 14 };
export const HERO_SUBTEXT_SIZE_OPTIONS = Object.keys(HERO_SUBTEXT_SIZES);
