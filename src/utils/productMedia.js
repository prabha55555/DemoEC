// Combines a product's photos and its optional single video into one ordered gallery sequence --
// shared by the product page (what's shown/opened first) and Admin's Photos section (where the video
// tile sits, drag-reordered by its own Move Left/Right buttons). `videoPosition` is how many photos
// come immediately before the video (0 = video leads, images.length = video trails everything); it is
// a pure count, so reordering photos among themselves never has to touch it.
export function clampVideoPosition(position, imagesLength) {
  const n = Number(position);
  return Math.max(0, Math.min(imagesLength, Number.isFinite(n) ? n : 0));
}

export function buildProductMedia(images, videoUrl, videoPosition) {
  const imgs = images || [];
  if (!videoUrl) return imgs.map(url => ({ type: 'image', url }));
  const pos = clampVideoPosition(videoPosition, imgs.length);
  return [
    ...imgs.slice(0, pos).map(url => ({ type: 'image', url })),
    { type: 'video', url: videoUrl },
    ...imgs.slice(pos).map(url => ({ type: 'image', url })),
  ];
}

// Maps an index into the combined media[] above back to the corresponding photo-only index (used by
// the full-screen photo lightbox, which never shows the video) -- and the reverse. `hasVideo`/`videoPos`
// must be the same (already-clamped) values buildProductMedia was called with.
export function photoIndexFromMerged(mergedIndex, hasVideo, videoPos) {
  if (!hasVideo) return mergedIndex;
  return mergedIndex < videoPos ? mergedIndex : mergedIndex - 1;
}

export function mergedIndexFromPhoto(photoIndex, hasVideo, videoPos) {
  if (!hasVideo) return photoIndex;
  return photoIndex < videoPos ? photoIndex : photoIndex + 1;
}
