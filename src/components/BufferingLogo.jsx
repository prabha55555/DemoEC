import React from 'react';
import bufferingLogoImg from '../assets/buffering-logo.png';

// A branded loading indicator -- the site logo pulsing like a heartbeat, with a
// soft drop shadow (styles in globals.css) -- shared by full-page loading (route
// code-splitting, initial site load) and per-image loading (BlurImage, while a
// slow photo is still fetching), so a visitor sees one consistent "buffering"
// moment everywhere instead of a generic spinner or a blank gap.
//
// Bundled as a static local asset (src/assets/buffering-logo.png) rather than
// read from brand.splash_logo/logo_url -- those come from a Supabase fetch that
// hasn't resolved yet on a cold page load, which used to leave this with nothing
// to show (previously a plain pulsing dot placeholder) until that fetch finished.
// A bundled image ships with the JS itself, so it's available instantly, no
// network round trip, ever. Trade-off: if the admin changes the site logo, this
// loading indicator keeps showing the old one until the next deploy re-bundles it
// -- acceptable since it's a brief transitional moment, not a permanent brand slot.
export default function BufferingLogo({ size = 64, fullPage = false }) {
  const ring = (
    <div className="tt-buffering-ring" style={{ width: size, height: size }}>
      <img src={bufferingLogoImg} alt="" style={{ width: size * 0.72, height: size * 0.72, objectFit: 'contain' }} />
    </div>
  );

  if (!fullPage) return ring;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {ring}
    </div>
  );
}
