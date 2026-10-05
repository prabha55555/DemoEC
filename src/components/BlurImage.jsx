import React, { useState, useEffect, useRef } from 'react';
import BufferingLogo from './BufferingLogo';

// Drop-in <img> replacement: starts blurred, sharpens the instant the full image has
// actually finished loading. On a fast/cached load this is barely visible; on a slow
// first load (new tab, new device, big product photo) it reads as an intentional,
// polished "buffering" state instead of a blank box or a jarring pop-in.
//
// `showBuffering` additionally centers the branded spinning-logo indicator over the
// blur while a slow load is still in flight -- opt-in, and only worth it on large,
// prominent images (hero banners, the product page's main image); it would just
// clutter a 46px cart thumbnail.
export default function BlurImage({ src, style = {}, showBuffering = false, ...rest }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const imgRef = useRef(null);

  // A cached image can finish loading before React attaches the onLoad listener,
  // which would leave it blurred forever — so after every mount/src change, also
  // check the element's own loaded state directly. complete with naturalWidth 0
  // means the browser already gave up on it (bad URL, network error).
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
    const img = imgRef.current;
    if (img && img.complete) {
      if (img.naturalWidth > 0) setLoaded(true);
      else if (img.src) setFailed(true);
    }
  }, [src]);

  const blurTransition = 'filter .5s ease';
  const mergedTransition = style.transition ? `${style.transition}, ${blurTransition}` : blurTransition;

  if (failed) {
    return (
      <div aria-hidden="true" style={{
        ...style,
        filter: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-hover)',
      }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
      </div>
    );
  }

  if (!showBuffering) {
    return (
      <img
        ref={imgRef}
        src={src}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        style={{
          ...style,
          filter: loaded ? 'blur(0)' : 'blur(16px)',
          transition: mergedTransition,
        }}
        {...rest}
      />
    );
  }

  // The caller's `style` carries both box placement (position/inset/width/height,
  // e.g. a hero's `position:absolute, inset:0`) and image-only properties
  // (objectFit/objectPosition). The overlay needs to sit on the *box*, so placement
  // moves to the wrapper and the image just fills it at 100%/100%.
  const { objectFit, objectPosition, ...boxStyle } = style;
  return (
    <div style={{ position: 'relative', ...boxStyle }}>
      <img
        ref={imgRef}
        src={src}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        style={{
          width: '100%', height: '100%', objectFit, objectPosition,
          filter: loaded ? 'blur(0)' : 'blur(16px)',
          transition: mergedTransition,
        }}
        {...rest}
      />
      {!loaded && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <BufferingLogo size={48} />
        </div>
      )}
    </div>
  );
}
