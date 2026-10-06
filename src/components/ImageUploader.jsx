import React, { useId, useState, useRef, useEffect } from 'react';
import { uploadToStorage, ALLOWED_IMAGE_ACCEPT } from '../utils/supabaseStorage';
import { clampVideoPosition } from '../utils/productMedia';
import { mapWithConcurrency } from '../admin/lib/pool';
import Icon from '../admin/ui/Icon';
import Thumb from '../admin/ui/Thumb';
import toast from 'react-hot-toast';

// ── IMAGE UPLOADER ─────────────────────────────
// Two ways to add a photo:
// 1. Direct upload to Supabase Storage (same project as the rest of the site)
// 2. Paste a URL (also how photos hosted elsewhere get added)
//
//   <ImageUploader images={form.images} onChange={imgs => set('images', imgs)} folder="products" />
//   multiple={false} keeps a single image (the new upload replaces the old one: onChange gets [url]).
//
// Optional `video` prop (videoUrl + videoPosition + onVideoPositionChange): when a product has a video, it appears
// as one more tile in this same grid, at videoPosition among the photos -- its own ← → buttons shift videoPosition
// instead of reordering `images`, so the admin can place the video anywhere in the order the product page will use
// (see src/utils/productMedia.js). The video's own URL is set elsewhere; this tile is ordering-only, so it has no
// remove / upload controls of its own.

// A 20-photo batch used to open 20 uploads at once; a few at a time is just as fast on a normal connection
// and never overwhelms a slow one.
const UPLOAD_CONCURRENCY = 3;

export default function ImageUploader({ images = [], onChange, folder = 'products', label = 'Product images', multiple = true, video = null, help }) {
  const [urlInput, setUrlInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [mode, setMode] = useState('upload'); // 'url' or 'upload'
  const fileRef = useRef();
  const groupLabelId = useId();
  // A multi-file upload takes several seconds; if the admin removes/reorders an existing image via its own
  // onChange call while the batch is still running, the upload's closed-over `images` prop is stale by the
  // time it finishes. Track the latest value in a ref so the final merge doesn't silently revert that edit.
  const imagesRef = useRef(images);
  useEffect(() => { imagesRef.current = images; }, [images]);

  // Guards against a slow upload finishing after this uploader has been swapped out for a different record
  // (screens key each ImageUploader by the record's id, so switching records unmounts this instance) -- without
  // this, a photo uploaded for product A could land on product B's form if the admin navigated away mid-upload.
  // Re-armed on every mount: React.StrictMode (the dev server) mounts, unmounts and re-mounts effects once,
  // and a cleanup-only effect would leave this false for good -- the upload then finished silently, never
  // attached its photos and the button sat on "Uploading... 0%".
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // ── ADD URL MANUALLY ──
  function addUrl() {
    const url = urlInput.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      toast.error('Please enter a valid URL starting with http');
      return;
    }
    onChange(multiple ? [...images, url] : [url]);
    setUrlInput('');
  }

  // ── UPLOAD TO SUPABASE STORAGE ──
  async function handleFileUpload(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true);
    setProgress(0);

    let doneCount = 0;
    const results = await mapWithConcurrency(files, UPLOAD_CONCURRENCY, async (file) => {
      try { return await uploadToStorage(file, folder); }
      finally {
        doneCount += 1;
        if (mountedRef.current) setProgress(Math.round((doneCount / files.length) * 100));
      }
    });

    // The record this upload was started for is gone (admin switched to a different product/story before it
    // finished) -- drop the results rather than attach them to whatever record replaced it.
    if (!mountedRef.current) return;

    const uploaded = [];
    const failed = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') uploaded.push(r.value);
      else failed.push({ name: files[i].name, reason: r.reason?.message || 'upload failed' });
    });

    if (uploaded.length) onChange(multiple ? [...imagesRef.current, ...uploaded] : [uploaded[uploaded.length - 1]]);
    setUploading(false);
    setProgress(0);
    e.target.value = '';
    if (failed.length === 1) toast.error(`${failed[0].name}: ${failed[0].reason}`);
    else if (failed.length > 1) toast.error(`${failed.length} photos failed to upload (${failed[0].reason}).`);
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

  return (
    <div className="adm-uploader">
      {/* Not a <label htmlFor>: it doesn't name one single control -- the URL field and file input below get
          their own aria-label. This is a group heading, referenced by the preview grid via aria-labelledby. */}
      <div id={groupLabelId} className="adm-label">{label}</div>
      {help && <div className="adm-hint">{help}</div>}

      {/* PREVIEW GRID -- photos, plus the video tile mixed in at its own position if this product has one */}
      {tiles.length > 0 && (
        <div role="group" aria-labelledby={groupLabelId} className="adm-uploader-grid">
          {tiles.map((t, pos) => {
            const isFirst = pos === 0;
            if (t.kind === 'video') {
              return (
                <div key="video" className={`adm-tile${isFirst ? ' is-main' : ''}`}>
                  <video src={t.url} muted preload="metadata" />
                  <span className="adm-tile-play" aria-hidden="true"><Icon name="play" size={26} filled /></span>
                  {isFirst && <div className="adm-tile-badge">Opens First</div>}
                  <div className="adm-tile-actions">
                    {pos > 0 && <button type="button" className="adm-tile-btn" onClick={() => moveVideo(-1)} title="Move video left" aria-label="Move video left"><Icon name="chevronLeft" size={16} /></button>}
                    {pos < tiles.length - 1 && <button type="button" className="adm-tile-btn" onClick={() => moveVideo(1)} title="Move video right" aria-label="Move video right"><Icon name="chevronRight" size={16} /></button>}
                  </div>
                </div>
              );
            }
            const { url, idx } = t;
            return (
              <div key={idx} className={`adm-tile${isFirst ? ' is-main' : ''}`}>
                {/* Resized rendition first, the original file if resizing is unavailable, a placeholder if neither loads. */}
                <Thumb
                  src={url} width={216} size="100%" lazy={false}
                  alt={isFirst ? `${label} — image 1 of ${images.length} (main)` : `${label} — image ${idx + 1} of ${images.length}`}
                />
                {isFirst && <div className="adm-tile-badge">{hasVideo ? 'Main Photo' : 'Main'}</div>}
                <div className="adm-tile-actions">
                  {idx > 0 && (
                    <button type="button" className="adm-tile-btn" onClick={() => moveImage(idx, -1)} title="Move left" aria-label={`Move image ${idx + 1} left`}><Icon name="chevronLeft" size={16} /></button>
                  )}
                  {idx < images.length - 1 && (
                    <button type="button" className="adm-tile-btn" onClick={() => moveImage(idx, 1)} title="Move right" aria-label={`Move image ${idx + 1} right`}><Icon name="chevronRight" size={16} /></button>
                  )}
                  <button type="button" className="adm-tile-btn danger" onClick={() => removeImage(idx)} title="Remove" aria-label={`Remove image ${idx + 1}`}><Icon name="close" size={16} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {hasVideo && (
        <div className="adm-hint">Use the video tile's arrows to choose where it opens among the photos on the product page.</div>
      )}

      {/* MODE TABS */}
      <div role="tablist" aria-label={`${label} — add photos by`} className="adm-uploader-modes">
        <button type="button" role="tab" aria-selected={mode === 'upload'} onClick={() => setMode('upload')}>Upload file</button>
        <button type="button" role="tab" aria-selected={mode === 'url'} onClick={() => setMode('url')}>Paste URL</button>
      </div>

      {/* PASTE URL MODE */}
      {mode === 'url' && (
        <div role="tabpanel">
          <div className="adm-media-url">
            <input
              className="adm-input"
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addUrl(); } }}
              placeholder="Paste an image URL here…"
              aria-label={`${label} — image URL`}
              type="url" inputMode="url" enterKeyHint="done" autoCapitalize="none" spellCheck={false}
            />
            <button type="button" className="adm-btn primary" onClick={addUrl}><span className="adm-btn-label">Add</span></button>
          </div>
          <div className="adm-hint" style={{ marginTop: 6 }}>Link to an image already hosted elsewhere. Press Enter or click Add.</div>
        </div>
      )}

      {/* UPLOAD MODE */}
      {mode === 'upload' && (
        <div role="tabpanel">
          {/* accept mirrors supabaseStorage.js's ALLOWED_IMAGE_TYPES -- SVG and anything else is excluded there too
              (SEC-STOR-2); this is only the file picker's own filter, not the enforcement. */}
          <input ref={fileRef} type="file" accept={ALLOWED_IMAGE_ACCEPT} multiple={multiple} hidden onChange={handleFileUpload} />
          <button type="button" className="adm-dropzone" onClick={() => fileRef.current?.click()} disabled={uploading} aria-busy={uploading}>
            {uploading
              ? <><span className="adm-spinner" aria-hidden="true" /> Uploading… {progress}%</>
              : <><Icon name="upload" size={17} /> {multiple ? 'Select photos to upload' : 'Select a photo to upload'}</>}
          </button>
          {uploading && (
            <div role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} className="adm-progress" style={{ marginTop: 8 }}>
              <div style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
