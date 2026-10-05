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

async function compressImage(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  if (file.size <= SKIP_THRESHOLD_BYTES) return file;

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file; // decode failed -- upload the original rather than block the admin

  let { width, height } = bitmap;
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob || blob.size >= file.size) return file; // re-encode didn't help -- keep the original

  const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return new File([blob], newName, { type: 'image/jpeg' });
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

// Deletes previously-uploaded files from Storage, given their public URLs (as saved
// on a product/story). Best-effort: logs rather than throws, since a failed cleanup
// shouldn't block the product/story deletion that triggered it. URLs that aren't
// from this bucket (pre-migration Cloudinary URLs, anything pasted in manually) are
// silently skipped -- there's nothing of ours to remove.
export async function deleteFromStorage(urls) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(u => typeof u === 'string');
  for (const bucket of [BUCKET, VIDEO_BUCKET]) {
    const marker = `/storage/v1/object/public/${bucket}/`;
    const paths = list.filter(u => u.includes(marker)).map(u => u.slice(u.indexOf(marker) + marker.length));
    if (paths.length === 0) continue;
    const { error } = await supabase.storage.from(bucket).remove(paths);
    if (error) console.error('Storage cleanup failed:', error);
  }
}
