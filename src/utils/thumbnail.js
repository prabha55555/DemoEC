// Requests a resized, auto-compressed rendition for thumbnail use (grid cards,
// cart lines, admin tables) instead of downloading the full original upload.
// Handles both pre-migration Cloudinary URLs and current Supabase Storage URLs
// (uploaded via supabaseStorage.js) via each host's own transform endpoint. Any
// other URL (pasted from elsewhere) passes through unchanged.
// Full-resolution zoom views (ProductPage) intentionally do NOT use this.
export function thumb(url, width = 700) {
  if (!url || typeof url !== 'string') return url;

  // Cloudinary's URL structure -- still handled so photos uploaded before the
  // Supabase Storage migration keep resizing correctly.
  const cldMarker = '/image/upload/';
  const cldIdx = url.indexOf(cldMarker);
  if (cldIdx !== -1) {
    const insertAt = cldIdx + cldMarker.length;
    return `${url.slice(0, insertAt)}w_${width},q_auto,f_auto,c_limit/${url.slice(insertAt)}`;
  }

  // width alone leaves height unconstrained at the source's full original size
  // (confirmed: a 1080x1350 photo requested at width=180 came back 180x1350,
  // not scaled) -- resize=contain + a matching height makes this behave like
  // Cloudinary's c_limit above: fit within a WxW box, aspect ratio preserved.
  const sbMarker = '/storage/v1/object/public/';
  const sbIdx = url.indexOf(sbMarker);
  if (sbIdx !== -1) {
    const base = url.slice(0, sbIdx);
    const rest = url.slice(sbIdx + sbMarker.length);
    return `${base}/storage/v1/render/image/public/${rest}?width=${width}&height=${width}&resize=contain&quality=80`;
  }

  return url;
}
