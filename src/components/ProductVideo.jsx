import React, { useState } from 'react';

// Pulls an embeddable player URL out of a YouTube/Vimeo link. Those pages are not video files,
// so a bare <video src> pointed at them never plays -- the usual cause of "the video doesn't show".
function embedUrlFor(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return `https://www.youtube.com/embed/${u.pathname.slice(1)}?rel=0`;
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed)\/([\w-]+)/) || [])[1];
      if (id) return `https://www.youtube.com/embed/${id}?rel=0`;
    }
    if (host === 'vimeo.com') {
      const id = u.pathname.match(/^\/(\d+)/)?.[1];
      if (id) return `https://player.vimeo.com/video/${id}`;
    }
  } catch { /* not a valid absolute URL -- treated as a plain video file below */ }
  return null;
}

// Product-gallery video. Plays direct MP4/WebM files inline (playsInline so iPhones don't force
// fullscreen), embeds YouTube/Vimeo links, and if the browser genuinely can't play the file
// (unsupported codec such as an iPhone .mov, a Drive/Dropbox share page, a dead link) says so
// with a link to open it, instead of a silent black box.
export default function ProductVideo({ url }) {
  const [failed, setFailed] = useState(false);
  const embed = embedUrlFor(url);
  if (embed) {
    return <iframe src={embed} title="Product video" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen style={{ width: '100%', height: '100%', border: 0, background: '#000' }} />;
  }
  if (failed) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center', color: '#fff', fontFamily: "var(--font-body)", fontSize: 15 }}>
        <div>This video can't be played in your browser.</div>
        <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: '#fff', fontFamily: "var(--font-body)", fontWeight: 600, fontSize: 14, border: '1px solid rgba(255,255,255,.7)', borderRadius: 6, padding: '10px 20px', minHeight: 42, display: 'inline-flex', alignItems: 'center' }}>Open video</a>
      </div>
    );
  }
  return <video src={url} controls playsInline preload="metadata" onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} />;
}
