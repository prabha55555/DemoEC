import React, { useEffect, useState } from 'react';
import { thumb } from '../../utils/thumbnail';
import Icon from './Icon';

// An onError handler for any <img> that was given a resized URL (thumb()): the first failure retries with the
// ORIGINAL file, so a project without Supabase Image Transformations (a paid feature) still shows its pictures.
//   <img src={thumb(url, 300)} onError={originalOnError(url)} />
export function originalOnError(original) {
  return (e) => {
    const img = e.currentTarget;
    if (!img.dataset.fallback && original) { img.dataset.fallback = '1'; img.src = original; } else img.removeAttribute('src');
  };
}

// A small picture for a table row / list item: <Thumb src={product.images?.[0]} width={96} size={44} />
// Requests a resized rendition (thumb()), falls back to the original file if the resize is unavailable, and to a
// neutral placeholder if there is no picture or it cannot be loaded -- never a broken-image icon.
//   width: pixel width to request (use ~2x the displayed size) · size: displayed box, a number (px) or a CSS size ('100%')
//   lazy (default true): defer loading until near the viewport -- pass false for a handful of pictures that should load at once
export default function Thumb({ src, width = 120, size = 44, alt = '', className = '', style, lazy = true }) {
  const [stage, setStage] = useState(0); // 0 resized · 1 original file · 2 give up
  useEffect(() => { setStage(0); }, [src]);
  const box = { width: size, height: size, ...style };
  if (!src || stage >= 2) {
    return (
      <span className={`adm-thumb adm-thumb-empty ${className}`.trim()} style={box} role={alt ? 'img' : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true}>
        <Icon name="image" size={typeof size === 'number' ? Math.max(14, Math.round(size * 0.42)) : 22} />
      </span>
    );
  }
  return (
    <img
      className={`adm-thumb ${className}`.trim()} style={box} src={stage === 0 ? thumb(src, width) : src} alt={alt}
      loading={lazy ? 'lazy' : undefined} decoding="async" onError={() => setStage(s => s + 1)}
    />
  );
}
