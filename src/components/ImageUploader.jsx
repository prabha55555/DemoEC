import React, { useId, useState, useRef, useEffect } from 'react';
import { thumb } from '../utils/thumbnail';
import { uploadToStorage, ALLOWED_IMAGE_ACCEPT } from '../utils/supabaseStorage';
import { clampVideoPosition } from '../utils/productMedia';
import toast from 'react-hot-toast';

// ── IMAGE UPLOADER ─────────────────────────────
// Two modes:
// 1. Direct upload to Supabase Storage (always available -- same project as the rest of the site)
// 2. Paste URL manually (works always, no config needed -- also how pre-migration Cloudinary URLs get added)
//
// Optional `video` prop (videoUrl + videoPosition + onVideoPositionChange): when a product has a video,
// it appears as one more tile in this same grid, at videoPosition among the photos -- its own Move Left/
// Right buttons shift videoPosition instead of reordering `images`, which lets an admin place the video
// anywhere in the gallery order the product page will use (see src/utils/productMedia.js). The video's
// own URL is set elsewhere (Admin's Product Video field); this tile is ordering-only, so it has no
// remove/upload controls of its own.

export default function ImageUploader({ images = [], onChange, folder = 'products', label = 'Product Images', multiple = true, video = null }) {
  const [urlInput, setUrlInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [mode, setMode] = useState('upload'); // 'url' or 'upload'
  const fileRef = useRef();
  const groupLabelId = useId();
  // A multi-file upload takes several seconds; if the admin removes/reorders an
  // existing image via its own onChange call while the loop is still running, the
  // upload's own closed-over `images` prop is stale by the time it finishes. Track
  // the latest value in a ref so the final merge doesn't silently revert that edit.
  const imagesRef = useRef(images);
  useEffect(() => { imagesRef.current = images; }, [images]);

  // Guards against a slow upload finishing after this uploader has been swapped out
  // for a different record (Admin.jsx keys each ImageUploader by the record's id, so
  // switching records unmounts this instance) -- without this, a photo uploaded for
  // product A could land on product B's form if the admin navigated away mid-upload.
  // Re-armed on every mount: React.StrictMode (the dev server) mounts, unmounts and re-mounts
  // effects once, and a cleanup-only effect would leave this false for good -- the upload then
  // finished silently, never attached its photos and the button sat on "Uploading... 0%".
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // ── ADD URL MANUALLY ──
  function addUrl() {
    const url = urlInput.trim();
    if (!url) return;
    if (!url.startsWith('http')) {
      toast.error('Please enter a valid URL starting with http');
      return;
    }
    onChange([...images, url]);
    setUrlInput('');
  }

  // ── UPLOAD TO SUPABASE STORAGE ──
  async function handleFileUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true);
    setProgress(0);

    // Uploaded in parallel (was a sequential for-loop awaiting one file at a time,
    // which made a 6-photo batch take ~6x one upload's latency for no benefit).
    let doneCount = 0;
    const results = await Promise.allSettled(files.map(async (file) => {
      const url = await uploadToStorage(file, folder);
      doneCount += 1;
      if (mountedRef.current) setProgress(Math.round((doneCount / files.length) * 100));
      return url;
    }));

    // The record this upload was started for is gone (admin switched to editing a
    // different product/story before it finished) -- drop the results rather than
    // attach them to whatever record replaced it.
    if (!mountedRef.current) return;

    const uploaded = [];
    const failed = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') uploaded.push(r.value);
      else { failed.push(files[i].name); console.error('Upload failed for', files[i].name, r.reason); }
    });

    onChange([...imagesRef.current, ...uploaded]);
    setUploading(false);
    setProgress(0);
    e.target.value = '';
    if (failed.length > 0) {
      toast.error(failed.length === 1 ? `${failed[0]} failed to upload.` : `${failed.length} photos failed to upload.`);
    }
  }

  function removeImage(idx) {
    onChange(images.filter((_, i) => i !== idx));
  }

  function moveImage(idx, dir) {
    const imgs = [...images];
    const target = idx + dir;
    if (target < 0 || target >= imgs.length) return;
    [imgs[idx], imgs[target]] = [imgs[target], imgs[idx]];
    onChange(imgs);
  }

  const hasVideo = !!video?.videoUrl;
  const videoPos = hasVideo ? clampVideoPosition(video.videoPosition, images.length) : 0;
  function moveVideo(dir) {
    if (!hasVideo) return;
    video.onVideoPositionChange(clampVideoPosition(videoPos + dir, images.length));
  }
  // The merged tile order the grid actually renders: photo tiles keep their real index into `images`
  // (so Move/Remove still act on the right one) with the video tile spliced in at videoPos.
  const tiles = hasVideo
    ? [
        ...images.slice(0, videoPos).map((url, i) => ({ kind: 'image', url, idx: i })),
        { kind: 'video', url: video.videoUrl },
        ...images.slice(videoPos).map((url, i) => ({ kind: 'image', url, idx: videoPos + i })),
      ]
    : images.map((url, i) => ({ kind: 'image', url, idx: i }));

  const lbl = {
    fontFamily: "'Inter',sans-serif", fontWeight: 600, fontSize: 11,
    letterSpacing: '0.14em', color: 'var(--gd)',
    textTransform: 'uppercase', display: 'block', marginBottom: 7
  };
  // Small square icon buttons overlaid on each thumbnail -- sized close to the
  // ~36-40px touch-target guideline (were 18x18) rather than a heading-level
  // <label>, since there's no single control it names (there's a URL field
  // AND a file input below it) -- referenced instead via aria-label on each
  // actual input, and via aria-labelledby here for the preview grid as a whole.
  const iconBtn = {
    width: 34, height: 34, background: 'rgba(0,0,0,0.75)', border: 'none', color: '#fff',
    cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
  };

  return (
    <div>
      {/* Not a <label htmlFor>, since it doesn't name one single control --
          the URL field and file input below both get their own aria-label
          instead. This is a group heading, referenced by the preview grid via
          aria-labelledby. */}
      <div id={groupLabelId} style={lbl}>{label}</div>

      {/* PREVIEW GRID -- photos, plus the video tile mixed in at its own position if this product has one */}
      {tiles.length > 0 && (
        <div role="group" aria-labelledby={groupLabelId} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
          {tiles.map((t, pos) => {
            const isFirst = pos === 0;
            if (t.kind === 'video') {
              return (
                <div key="video" style={{ position: 'relative', width: 108, height: 108, background: '#000' }}>
                  <video src={t.url} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover', border: isFirst ? '2px solid var(--gd)' : '1px solid rgba(33,29,20,0.2)', opacity: 0.85 }} />
                  <span aria-hidden="true" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="#F2EFE4"><path d="M8 5v14l11-7z" /></svg>
                  </span>
                  {isFirst && (
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'var(--gd)', color: 'var(--text-dark)', fontFamily: "'Inter',sans-serif", fontWeight: 600, fontSize: 10, letterSpacing: '0.1em', textAlign: 'center', padding: '2px 0', textTransform: 'uppercase' }}>Opens First</div>
                  )}
                  <div style={{ position: 'absolute', top: 2, right: 2, display: 'flex', gap: 2 }}>
                    {pos > 0 && <button type="button" onClick={() => moveVideo(-1)} title="Move video left" aria-label="Move video left" style={iconBtn}>←</button>}
                    {pos < tiles.length - 1 && <button type="button" onClick={() => moveVideo(1)} title="Move video right" aria-label="Move video right" style={iconBtn}>→</button>}
                  </div>
                </div>
              );
            }
            const { url, idx } = t;
            return (
              <div key={idx} style={{ position: 'relative', width: 108, height: 108 }}>
                <img
                  src={thumb(url, 216)}
                  alt={isFirst ? `${label} — image 1 of ${images.length} (main)` : `${label} — image ${idx + 1} of ${images.length}`}
                  loading="lazy"
                  decoding="async"
                  style={{
                    width: '100%', height: '100%', objectFit: 'cover',
                    border: isFirst ? '2px solid var(--gd)' : '1px solid rgba(33,29,20,0.2)'
                  }}
                  onError={e => { e.target.src = ''; e.target.style.background = '#D3CCB9'; }}
                />
                {isFirst && (
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'var(--gd)', color: 'var(--text-dark)', fontFamily: "'Inter',sans-serif", fontWeight: 600, fontSize: 10, letterSpacing: '0.1em', textAlign: 'center', padding: '2px 0', textTransform: 'uppercase' }}>
                    {hasVideo ? 'Main Photo' : 'Main'}
                  </div>
                )}
                <div style={{ position: 'absolute', top: 2, right: 2, display: 'flex', gap: 2 }}>
                  {idx > 0 && (
                    <button type="button" onClick={() => moveImage(idx, -1)} title="Move left" aria-label={`Move image ${idx + 1} left`} style={iconBtn}>←</button>
                  )}
                  {idx < images.length - 1 && (
                    <button type="button" onClick={() => moveImage(idx, 1)} title="Move right" aria-label={`Move image ${idx + 1} right`} style={iconBtn}>→</button>
                  )}
                  <button type="button" onClick={() => removeImage(idx)} title="Remove" aria-label={`Remove image ${idx + 1}`} style={{ ...iconBtn, background: 'rgba(192,120,64,0.9)', fontSize: 17 }}>×</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {hasVideo && (
        <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: 'var(--iv)', fontStyle: 'normal', marginTop: -6, marginBottom: 14 }}>
          Use the video tile's ← → arrows to choose where it opens among the photos on the product page.
        </div>
      )}

      {/* MODE TABS */}
      <div role="tablist" aria-label={`${label} — add photos by`} style={{ display: 'flex', gap: 0, marginBottom: 12 }}>
        <button
          type="button" role="tab" aria-selected={mode === 'url'}
          onClick={() => setMode('url')}
          style={{ padding: '12px 16px', fontFamily: "'Inter',sans-serif", fontWeight: 600, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', border: '1px solid rgba(33,29,20,0.2)', cursor: 'pointer', transition: 'all 0.2s', background: mode === 'url' ? 'var(--gd)' : 'rgba(30,27,20,0.04)', color: mode === 'url' ? 'var(--br)' : 'var(--iv)' }}
        >
          Paste URL
        </button>
        <button
          type="button" role="tab" aria-selected={mode === 'upload'}
          onClick={() => setMode('upload')}
          style={{ padding: '12px 16px', fontFamily: "'Inter',sans-serif", fontWeight: 600, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', border: '1px solid rgba(33,29,20,0.2)', borderLeft: 'none', cursor: 'pointer', transition: 'all 0.2s', background: mode === 'upload' ? 'var(--gd)' : 'rgba(30,27,20,0.04)', color: mode === 'upload' ? 'var(--br)' : 'var(--iv)' }}
        >
          Upload File
        </button>
      </div>

      {/* PASTE URL MODE */}
      {mode === 'url' && (
        <div role="tabpanel">
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addUrl()}
              placeholder="Paste an image URL here..."
              aria-label={`${label} — image URL`}
              type="url" inputMode="url" enterKeyHint="done" autoCapitalize="none" spellCheck={false}
              style={{ flex: 1, padding: '10px 12px', background: 'rgba(30,27,20,0.06)', border: '1px solid rgba(33,29,20,0.2)', color: 'var(--iv)', fontFamily: "var(--font-body)", fontSize: 15 }}
              onFocus={e => e.target.style.borderColor = 'var(--gd)'}
              onBlur={e => e.target.style.borderColor = 'rgba(33,29,20,0.2)'}
            />
            <button
              type="button"
              onClick={addUrl}
              style={{ background: 'var(--gd)', border: 'none', color: 'var(--text-dark)', fontFamily: "'Inter',sans-serif", fontWeight: 600, fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', padding: '11px 16px', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              Add
            </button>
          </div>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: 'var(--iv)', fontStyle: 'normal', marginTop: 7, lineHeight: 1.6 }}>
            Paste a link to an image already hosted elsewhere. Press Enter or click Add.
          </div>
        </div>
      )}

      {/* UPLOAD MODE */}
      {mode === 'upload' && (
        <div role="tabpanel">
          {/* accept mirrors supabaseStorage.js's ALLOWED_IMAGE_TYPES -- SVG and
              anything else is excluded there too (SEC-STOR-2); this is only
              the file picker's own filter, not the enforcement. */}
          <input ref={fileRef} type="file" accept={ALLOWED_IMAGE_ACCEPT} multiple={multiple} style={{ display: 'none' }} onChange={handleFileUpload} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            aria-busy={uploading}
            style={{ minHeight: 40, background: uploading ? 'rgba(33,29,20,0.4)' : 'rgba(30,27,20,0.08)', border: '1px dashed rgba(33,29,20,0.35)', color: uploading ? 'var(--gd)' : 'var(--iv)', fontFamily: "'Inter',sans-serif", fontWeight: 600, fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '12px 20px', cursor: uploading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
          >
            {uploading ? (
              <><span aria-hidden="true" style={{ width: 14, height: 14, border: '2px solid rgba(33,29,20,0.3)', borderTopColor: 'var(--gd)', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.7s linear infinite' }} /> Uploading... {progress}%</>
            ) : 'Select Photos to Upload'}
          </button>
          {uploading && (
            <div role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} style={{ marginTop: 8, height: 3, background: 'rgba(33,29,20,0.15)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', background: 'var(--gd)', width: `${progress}%`, transition: 'width 0.3s' }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
