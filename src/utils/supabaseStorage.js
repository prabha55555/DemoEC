import { supabase } from '../supabase';

const BUCKET = 'images';
// Videos live in their own bucket so image-only rules on `images` (allowed types, small size cap)
// never block them, and video limits never loosen the image bucket.
const VIDEO_BUCKET = 'videos';

// SEC-STOR-2: raster types only -- SVG is deliberately excluded. An SVG can
// carry an embedded <script>/onload, and this bucket serves uploads back out
// as public, directly-linkable URLs (getPublicUrl below), which is exactly
// the shape a stored-XSS payload needs. This allowlist (and ImageUploader's
// matching `accept`) is a courtesy check only -- see MAX_UPLOAD_BYTES's own
// comment below: the real enforcement has to be the bucket's own Storage
// policy (allowed_mime_types + file_size_limit), which is a Supabase
// dashboard/SQL change, not something this file can guarantee on its own.
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
// Matching `accept` value for <input type="file">, extensions AND MIME types
// together -- some mobile/desktop file pickers only honor one or the other.
export const ALLOWED_IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp,.gif,.avif,' + ALLOWED_IMAGE_TYPES.join(',');

// Camera-original photos (20-30MB+) blow past Supabase's on-the-fly image
// transform size limit -- thumb() requests for them 400 outright, leaving
// broken/blank previews everywhere the photo is used. Downscaling here, once,
// at upload time keeps every later transform request fast and reliable.
const MAX_DIMENSION = 2400;
const JPEG_QUALITY = 0.86;
const SKIP_THRESHOLD_BYTES = 1.5 * 1024 * 1024; // already-small files aren't worth re-encoding

// What to do with a large image before uploading it. Pure, so the decision can be tested without a canvas.
//   { action: 'keep' }                                  upload the original untouched
//   { action: 'jpeg', width, height }                   flatten to a JPEG at that size (photos)
//   { action: 'resize', type, width, height }           shrink but KEEP the format (transparent PNG / WebP / AVIF)
// A PNG / WebP / AVIF that really uses transparency (a logo, a cut-out product shot) must never become a JPEG:
// JPEG has no alpha channel, so the transparent area would turn solid black.
export function planImageUpload({ type, size, width, height, hasAlpha }) {
  if (!String(type).startsWith('image/') || type === 'image/gif') return { action: 'keep' };
  if (size <= SKIP_THRESHOLD_BYTES) return { action: 'keep' };
  const longest = Math.max(width, height);
  const scale = longest > MAX_DIMENSION ? MAX_DIMENSION / longest : 1;
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  if (hasAlpha && type !== 'image/jpeg') {
    return scale < 1 ? { action: 'resize', type, width: w, height: h } : { action: 'keep' };
  }
  return { action: 'jpeg', width: w, height: h };
}

// True when the picture has any visibly transparent pixel. Looks at a small downscaled copy: averaging keeps
// even a thin transparent edge below full opacity. If the pixels cannot be read, assume transparency (the safe
// answer: the original format is kept).
function detectAlpha(bitmap) {
  try {
    const scale = Math.min(1, 128 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < px.length; i += 4) if (px[i] < 250) return true;
    return false;
  } catch {
    return true;
  }
}

const EXT_FOR_TYPE = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/avif': '.avif' };

async function compressImage(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  if (file.size <= SKIP_THRESHOLD_BYTES) return file;

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file; // decode failed -- upload the original rather than block the admin

  const plan = planImageUpload({
    type: file.type, size: file.size, width: bitmap.width, height: bitmap.height,
    hasAlpha: file.type === 'image/jpeg' ? false : detectAlpha(bitmap),
  });
  if (plan.action === 'keep') { bitmap.close?.(); return file; }

  const canvas = document.createElement('canvas');
  canvas.width = plan.width;
  canvas.height = plan.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, plan.width, plan.height);
  bitmap.close?.();

  const outType = plan.action === 'jpeg' ? 'image/jpeg' : plan.type;
  const blob = await new Promise(resolve => canvas.toBlob(resolve, outType, JPEG_QUALITY));
  // The browser silently falls back to PNG for a type it cannot encode (AVIF): only accept what we asked for,
  // and only if it actually got smaller.
  if (!blob || blob.type !== outType || blob.size >= file.size) return file;

  const newName = file.name.replace(/\.[^.]+$/, '') + (EXT_FOR_TYPE[outType] || '.jpg');
  return new File([blob], newName, { type: outType });
}

// Client-side only, same as ALLOWED_IMAGE_TYPES above -- a courtesy check to
// reject an obviously-wrong file before spending time compressing/uploading
// it, NOT a real security boundary (any caller can skip this file entirely
// and hit Supabase Storage directly with the same anon key). Actual
// enforcement has to live in the bucket's own Storage policy (file_size_limit,
// admin-only write access) -- a Supabase dashboard/SQL change, not something
// this file can guarantee on its own.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB, well above any real product/hero photo

// Uploads a File to Supabase Storage and returns its public URL. Filenames are
// prefixed with a timestamp so two admins uploading a same-named file never
// collide and silently overwrite each other's photo.
// Only formats every browser can play inline. iPhone .mov (HEVC) and most other containers are
// deliberately rejected with a clear message rather than uploaded and then silently not playing.
export const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm'];
// Matches the `videos` bucket's file_size_limit and the project-wide Storage upload limit (Supabase Pro allows raising it).
// A single upload of this size can take a few minutes on a slow connection -- wait for "Uploaded".
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

export async function uploadToStorage(file, folder = 'products') {
  const isVideo = file.type.startsWith('video/');
  if (isVideo) {
    if (!ALLOWED_VIDEO_TYPES.includes(file.type)) {
      throw new Error('This video format will not play in every browser (iPhone .mov / HEVC in particular). Please export it as MP4 (H.264) and upload that.');
    }
    if (file.size > MAX_VIDEO_BYTES) {
      throw new Error(`Video is too large (${(file.size / 1024 / 1024).toFixed(1)}MB) -- please compress it to under ${MAX_VIDEO_BYTES / 1024 / 1024}MB.`);
    }
  } else if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error('Unsupported file type -- please upload a JPEG, PNG, WEBP, GIF or AVIF image.');
  } else if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File is too large (${(file.size / 1024 / 1024).toFixed(1)}MB) -- please use an image under ${MAX_UPLOAD_BYTES / 1024 / 1024}MB.`);
  }
  const upload = isVideo ? file : await compressImage(file);
  const safeName = upload.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const path = `${folder}/${Date.now()}-${safeName}`;
  const bucket = isVideo ? VIDEO_BUCKET : BUCKET;
  const { error } = await supabase.storage.from(bucket).upload(path, upload, {
    cacheControl: '31536000',
    upsert: false,
    contentType: upload.type,
  });
  if (error) {
    if (isVideo && /bucket not found/i.test(error.message || '')) {
      throw new Error('The "videos" storage bucket does not exist yet -- create it in Supabase (see the video bucket SQL) and try again.');
    }
    throw error;
  }
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

// A public Storage URL -> its object path inside `bucket` ('' when the URL is not one of ours). Query strings
// and percent-encoding are handled, so a URL copied from the browser still resolves to the stored file.
export function storagePathOf(url, bucket) {
  if (typeof url !== 'string') return '';
  const marker = `/storage/v1/object/public/${bucket}/`;
  const at = url.indexOf(marker);
  if (at === -1) return '';
  const raw = url.slice(at + marker.length).split(/[?#]/)[0];
  try { return decodeURIComponent(raw); } catch { return raw; }
}

// Deletes previously-uploaded files from Storage, given their public URLs (as saved
// on a product/story). Best-effort: logs rather than throws, since a failed cleanup
// shouldn't block the product/story deletion that triggered it. URLs that aren't
// from this bucket (pre-migration Cloudinary URLs, anything pasted in manually) are
// silently skipped -- there's nothing of ours to remove.
export async function deleteFromStorage(urls) {
  const list = (Array.isArray(urls) ? urls.flat() : [urls]).filter(u => typeof u === 'string' && u);
  for (const bucket of [BUCKET, VIDEO_BUCKET]) {
    const paths = Array.from(new Set(list.map(u => storagePathOf(u, bucket)).filter(Boolean)));
    if (paths.length === 0) continue;
    const { error } = await supabase.storage.from(bucket).remove(paths);
    if (error) console.error('Storage cleanup failed:', error);
  }
}

// The file URLs that were in a record BEFORE an edit and are not in it AFTER -- i.e. replaced or removed
// images / videos whose files are now orphaned. Pass the same list of URL fields for both:
//   const gone = staleMediaUrls([old.image_url, old.mobile_image_url], [form.image_url, form.mobile_image_url]);
//   after a SUCCESSFUL save:  deleteFromStorage(gone)
// Arrays may be nested (a gallery inside the list); empty values are ignored.
export function staleMediaUrls(previous, next) {
  const flat = (v) => (Array.isArray(v) ? v.flat(Infinity) : [v]).filter(u => typeof u === 'string' && u);
  const keep = new Set(flat(next));
  return Array.from(new Set(flat(previous))).filter(u => !keep.has(u));
}
