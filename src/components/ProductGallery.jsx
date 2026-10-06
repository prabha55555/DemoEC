import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ProductVideo from './ProductVideo';
import BlurImage from './BlurImage';
import { buildProductMedia, clampVideoPosition, photoIndexFromMerged, mergedIndexFromPhoto } from '../utils/productMedia';
import { thumb } from '../utils/thumbnail';

const ZoomIcon = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-4.3-4.3M11 8v6M8 11h6" /></svg>;

// The product gallery: vertical thumbnails (desktop) / dots (mobile), a large contained image, swipe, a lightbox with
// zoom/pan and an optional video mixed among the photos (see utils/productMedia.js).
//   images       photo URLs, in order
//   focusImage   a URL to jump to (the selected variant's picture); ignored when it is not in `images`
//   children     overlays inside the stage (badges, wishlist, share), positioned by the page
export default function ProductGallery({ name, images, videoUrl, videoPosition, focusImage, children }) {
  const [active, setActive] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  // 1 = fit, up to 4 = pinched in. Double-tap jumps straight between 1 and 2.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const hasVideo = !!videoUrl;
  const videoPos = clampVideoPosition(videoPosition, images.length);
  const media = buildProductMedia(images, videoUrl, videoPos);
  const current = media[active] || media[0];
  const lbIndex = Math.max(0, Math.min(images.length - 1, photoIndexFromMerged(active, hasVideo, videoPos)));

  // Jump to the variant's picture when the shopper picks another option.
  useEffect(() => {
    if (!focusImage) return;
    const i = images.indexOf(focusImage);
    if (i >= 0) setActive(mergedIndexFromPhoto(i, hasVideo, videoPos));
    // eslint-disable-next-line
  }, [focusImage]);

  // A shorter media list (another product) can leave the index past the end.
  useEffect(() => { if (active >= media.length) setActive(0); }, [active, media.length]);
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, [active, lightbox]);

  // ---- lightbox: scroll lock, Escape, arrows, focus in and back out
  const closeRef = useRef(null);
  const openerRef = useRef(null);
  useEffect(() => {
    if (!lightbox) return undefined;
    openerRef.current = document.activeElement;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const go = (d) => setActive(a => mergedIndexFromPhoto((photoIndexFromMerged(a, hasVideo, videoPos) + d + images.length) % images.length, hasVideo, videoPos));
    const onKey = (e) => {
      if (e.key === 'Escape') setLightbox(false);
      else if (e.key === 'ArrowRight' && images.length > 1) go(1);
      else if (e.key === 'ArrowLeft' && images.length > 1) go(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      openerRef.current?.focus?.();
    };
  }, [lightbox, hasVideo, videoPos, images.length]);

  // ---- touch: swipe between images; pinch + pan inside the lightbox
  const touchX = useRef(null);
  const multiTouch = useRef(false);
  const lastTap = useRef(0);
  const pinch = useRef(null);
  const panStart = useRef(null);
  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; multiTouch.current = e.touches.length > 1; };
  function swipe(e, count, step) {
    // multiTouch guards a pinch (two fingers) from being read as a swipe.
    if (touchX.current === null || count < 2 || zoom > 1 || multiTouch.current) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
    touchX.current = null;
  }
  const dist = ([a, b]) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  function zoomStart(e) {
    if (e.touches.length === 2) pinch.current = { d: dist(e.touches), scale: zoom };
    else if (e.touches.length === 1 && zoom > 1) panStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, off: pan };
  }
  function zoomMove(e) {
    if (e.touches.length === 2 && pinch.current) setZoom(Math.min(4, Math.max(1, pinch.current.scale * (dist(e.touches) / pinch.current.d))));
    else if (e.touches.length === 1 && panStart.current && zoom > 1) {
      const max = (zoom - 1) * 160;
      setPan({
        x: Math.max(-max, Math.min(max, panStart.current.off.x + e.touches[0].clientX - panStart.current.x)),
        y: Math.max(-max, Math.min(max, panStart.current.off.y + e.touches[0].clientY - panStart.current.y)),
      });
    }
  }
  function zoomEnd(e) {
    if (e.touches.length !== 0) return;
    pinch.current = null; panStart.current = null;
    if (zoom <= 1.05) { setZoom(1); setPan({ x: 0, y: 0 }); }
  }
  function doubleTap(e) {
    e.stopPropagation();
    const now = Date.now();
    if (now - lastTap.current < 350) { setZoom(z => (z > 1 ? 1 : 2)); setPan({ x: 0, y: 0 }); }
    lastTap.current = now;
  }
  const stepPhoto = (d) => setActive(mergedIndexFromPhoto((lbIndex + d + images.length) % images.length, hasVideo, videoPos));

  return (
    <div className="pp-gallery">
      {media.length > 1 && (
        <div className="pp-thumbs no-scrollbar" role="group" aria-label="Product images">
          {media.map((m, i) => (
            <button key={i} type="button" aria-pressed={active === i} aria-label={m.type === 'video' ? 'Show video' : `Show image ${i + 1}`} onClick={() => setActive(i)} className={`pp-thumb${active === i ? ' is-on' : ''}`}>
              {m.type === 'video' ? (
                <>
                  <video src={m.url.includes('#') ? m.url : `${m.url}#t=0.1`} preload="metadata" muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <span className="pp-thumb-play"><svg width="18" height="18" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg></span>
                </>
              ) : (
                <img src={thumb(m.url, 160)} alt="" width="60" height="60" loading="lazy" decoding="async" />
              )}
            </button>
          ))}
        </div>
      )}

      <div className="pp-stage-wrap">
        <div
          className={`pp-stage${current?.type === 'video' ? ' is-video' : ''}${current?.type === 'image' ? ' is-zoomable' : ''}`}
          onClick={() => current?.type === 'image' && setLightbox(true)}
          onTouchStart={onTouchStart}
          onTouchEnd={e => swipe(e, media.length, d => setActive(a => (a + d + media.length) % media.length))}
        >
          {current?.type === 'video' ? (
            <ProductVideo key={active} url={current.url} />
          ) : current ? (
            <BlurImage key={active} src={thumb(current.url, 1200)} alt={name} className="pp-img-fade" showBuffering style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <div className="pp-noimg">{name}</div>
          )}
          {current?.type === 'image' && <span className="pp-zoom-hint" aria-hidden="true">{ZoomIcon}Click to zoom</span>}
        </div>

        {children}

        {media.length > 1 && (
          <div className="pp-pager">
            <div className="pp-pager-in">
              {media.map((m, i) => (
                <button key={i} type="button" aria-label={`Go to image ${i + 1} of ${media.length}`} aria-current={active === i} onClick={() => setActive(i)} className={`pp-pg${active === i ? ' is-on' : ''}`}><span /></button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Portaled to <body> so it sits above the fixed header whatever transforms the page has. */}
      {lightbox && images.length > 0 && createPortal((
        <div className="pp-lightbox" role="dialog" aria-modal="true" aria-label={`${name} — image viewer`} onClick={() => setLightbox(false)}>
          <button ref={closeRef} type="button" className="pp-lb-close" onClick={() => setLightbox(false)} aria-label="Close image viewer">×</button>

          {images.length > 1 && (
            <div className="pp-lightbox-rail" onClick={e => e.stopPropagation()}>
              {images.map((url, i) => (
                <button key={i} type="button" className={`pp-lb-thumb${lbIndex === i ? ' is-on' : ''}`} aria-label={`Show image ${i + 1}`} aria-pressed={lbIndex === i} onClick={() => setActive(mergedIndexFromPhoto(i, hasVideo, videoPos))}>
                  <img src={thumb(url, 140)} alt="" loading="lazy" decoding="async" />
                </button>
              ))}
            </div>
          )}

          <div className="pp-lightbox-main" onTouchStart={onTouchStart} onTouchEnd={e => swipe(e, images.length, stepPhoto)}>
            <div className="pp-lb-frame" onClick={e => e.stopPropagation()} onTouchStart={zoomStart} onTouchMove={zoomMove} onTouchEnd={zoomEnd}>
              <BlurImage key={active} src={zoom > 1 ? images[lbIndex] : thumb(images[lbIndex], 1200)} alt={name} className="pp-img-fade" onClick={doubleTap}
                style={{ maxWidth: '100%', maxHeight: '85vh', objectFit: 'contain', display: 'block', cursor: zoom > 1 ? 'zoom-out' : 'zoom-in', transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`, transformOrigin: 'center center', transition: 'transform .15s ease-out' }} />
            </div>
            {images.length > 1 && zoom === 1 && (
              <>
                <button type="button" className="pp-lb-nav l" onClick={e => { e.stopPropagation(); stepPhoto(-1); }} aria-label="Previous image">‹</button>
                <button type="button" className="pp-lb-nav r" onClick={e => { e.stopPropagation(); stepPhoto(1); }} aria-label="Next image">›</button>
              </>
            )}
            <div className="pp-lb-count">{lbIndex + 1} / {images.length}</div>
          </div>
        </div>
      ), document.body)}
    </div>
  );
}
