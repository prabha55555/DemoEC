// Vercel serverless function -- a tiny, crawlable "share card" for a single
// product, for links that are pasted into WhatsApp and similar apps and
// should unfurl as a photo card with the product's name, brand and price.
//
// Why this exists: WhatsApp's own link-preview crawler doesn't execute
// JavaScript and only renders an image thumbnail for a URL when the fetched
// HTML has proper Open Graph meta tags (og:image, og:title) -- a bare image
// file URL (what was tried first) gets no thumbnail, confirmed by a real
// screenshot of the actual chat. This site is a client-rendered React SPA
// with no server-side rendering, so the real /product/:id page's initial
// HTML (before React mounts) has no product-specific tags for a crawler to
// read. This endpoint is the standard workaround: a lightweight, public,
// GET-only page with the right meta tags for crawlers, that immediately
// redirects a real visitor's browser to the actual product page.
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { COMPANY } from '../src/config/company.js';
import { formatMoney, discountPercent } from '../src/utils/catalog.js';

const supabase = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.REACT_APP_SUPABASE_ANON_KEY);
const SITE_URL = COMPANY.website;
const OG_IMAGE_MAX = 1200;

// SEC-STOR-3: `original` below is a product.images URL -- normally our own
// Supabase Storage, but ImageUploader's "Paste URL" mode lets an admin save
// ANY http(s) URL there (including pre-migration Cloudinary links). Fetching
// that URL server-side, unrestricted, is a blind-SSRF vector: a malicious or
// compromised product row could point it at an internal/link-local address
// and this endpoint would fetch it on the server's behalf. Only ever fetch
// from a host this codebase actually serves real product photos from.
const SUPABASE_IMAGE_HOST = (() => {
  try { return new URL(process.env.REACT_APP_SUPABASE_URL).host; } catch { return null; }
})();
const ALLOWED_IMAGE_HOSTS = new Set([SUPABASE_IMAGE_HOST, 'res.cloudinary.com'].filter(Boolean));

function isAllowedImageUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_IMAGE_HOSTS.has(parsed.host);
  } catch {
    return false; // not a valid absolute URL at all
  }
}

// Hard cap on the source photo this function downloads to re-encode -- not
// the same limit as supabaseStorage.js's client-side upload cap (that one
// only constrains what OUR OWN uploader saves; a pasted URL or a legacy row
// could point anywhere up to that host allowlist). Enforced twice: once
// cheaply via Content-Length before reading anything, and again while
// actually streaming the body, since Content-Length is caller-supplied and
// can't be trusted on its own (a slow, unbounded, or mislabeled response
// must not be read into memory in full before this check runs).
const MAX_SOURCE_IMAGE_BYTES = 15 * 1024 * 1024; // 15MB

async function fetchImageWithSizeCap(url, maxBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`source image fetch failed: ${res.status}`);

  const declaredLength = Number(res.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`source image too large (Content-Length ${declaredLength} bytes)`);
  }

  if (!res.body || typeof res.body[Symbol.asyncIterator] !== 'function') {
    // No streamable body in this runtime -- still capped, just checked after
    // the full read instead of mid-stream.
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error(`source image too large (${buf.length} bytes)`);
    return buf;
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (total > maxBytes) throw new Error(`source image exceeded ${maxBytes} bytes while streaming`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// No inline <script>location.replace(...)</script> here -- that was the
// actual XSS sink (confirmed live): JSON.stringify() escapes for JS-string
// syntax only, it does NOT escape a literal "</script>" sequence, so an id
// containing one closed the real <script> tag early (HTML tokenizing happens
// before JS parsing) and let anything after it run as a brand-new script
// block. The already-escaped <meta http-equiv="refresh"> alone is enough for
// the redirect -- near-instant, no JS execution involved at all.
function redirectPage(url) {
  return `<!doctype html><html><head><meta charset="utf-8"/><meta http-equiv="refresh" content="0;url=${escapeHtml(url)}"/></head><body><a href="${escapeHtml(url)}">Continue to ${escapeHtml(COMPANY.name)}</a></body></html>`;
}

// Product ids are Supabase-generated UUIDs -- anything else can only be a
// forged request, never a real product link. Validated before it ever
// touches productUrl/the DB query, so a malformed id can't reach either the
// HTML this file renders or an invalid-UUID query-syntax error from
// Supabase (which the old code silently treated as "not found" and still
// reflected the raw id into the page).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  const id = req.query?.id;

  if (!id) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(302).send(redirectPage(`${SITE_URL}/shop`));
    return;
  }

  if (!UUID_RE.test(id)) {
    res.status(400).send('Invalid product id.');
    return;
  }

  // ---- OG image sub-route -- this is the URL the og:image tag below points
  // to, and what WhatsApp/Meta's link-preview crawler actually fetches for
  // the thumbnail. Re-encodes the product's photo as a guaranteed baseline
  // (non-progressive) JPEG ourselves, rather than pointing crawlers straight
  // at Supabase Storage's own image transform (used everywhere else via
  // thumb()). Confirmed live (SOF marker 0xFFC2) that Supabase's transform
  // output is progressive JPEG -- Android's WhatsApp decodes that fine, but
  // iOS/WhatsApp Web/Desktop's link-preview renderers silently drop just the
  // image (title/text still show) when it's progressive. Supabase's
  // render/image API has no documented toggle for this, so the only way to
  // guarantee the encoding is to do it ourselves.
  if (req.query?.img === '1') {
    const { data: product } = await supabase.from('products').select('images').eq('id', id).maybeSingle();
    const original = product?.images?.[0];
    // A missing image and a disallowed-host/oversized one are treated the
    // same way -- the existing "no photo" fallback (404 here; the metadata
    // page below never links an og:image at all in that case either).
    if (!original || !isAllowedImageUrl(original)) {
      res.status(404).end();
      return;
    }
    try {
      const buf = await fetchImageWithSizeCap(original, MAX_SOURCE_IMAGE_BYTES);
      const jpeg = await sharp(buf)
        .rotate() // bake in EXIF orientation before it's stripped by re-encoding
        .resize(OG_IMAGE_MAX, OG_IMAGE_MAX, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80, progressive: false })
        .toBuffer();
      res.setHeader('Content-Type', 'image/jpeg');
      // Supabase Storage's own image URLs (what this replaced) send this by
      // default -- this one didn't, which is a real, checkable gap unrelated
      // to the progressive-JPEG fix. WhatsApp Web runs as a page in an actual
      // browser (unlike the native mobile apps, which aren't subject to CORS
      // at all), so if it fetches this image client-side to build a compose
      // preview, a missing CORS header would silently fail exactly that one
      // step while leaving title/description (fetched separately) unaffected
      // -- matches the reported symptom. A public product photo has no
      // reason to restrict cross-origin access.
      res.setHeader('Access-Control-Allow-Origin', '*');
      // Matches this endpoint's own HTML response below -- short enough that
      // a product photo change shows up in a re-share within minutes, unlike
      // Supabase Storage's own URLs (immutable per-upload filename, so safe
      // to cache for a year) -- this route is keyed by product id, not by
      // the underlying file name, so it can't rely on that same guarantee.
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
      res.status(200).send(jpeg);
    } catch (err) {
      console.error('product-share: OG image re-encode failed.', err?.message, id);
      res.status(502).end();
    }
    return;
  }

  const productUrl = `${SITE_URL}/product/${id}`;

  // Same public read every product listing page already does (no anon
  // SELECT restriction on `products` -- this table is meant to be public).
  const { data: product } = await supabase.from('products').select('name, brand, subtitle, price, mrp, images, status').eq('id', id).maybeSingle();

  // Only live products get a card; a draft is "not found" here exactly like on the storefront.
  if (!product || product.status !== 'active') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(404).send(redirectPage(productUrl));
    return;
  }

  const title = product.name || COMPANY.name;
  // "Kaveri Weaves · ₹799 (11% off) — Straight-fit kurta with embroidered placket"
  const off = discountPercent(product.price, product.mrp);
  const priceText = Number(product.price) > 0 ? `${formatMoney(product.price)}${off > 0 ? ` (${off}% off)` : ''}` : '';
  const description = [[product.brand, priceText].filter(Boolean).join(' · '), product.subtitle].filter(Boolean).join(' — ') || `View this product at ${COMPANY.name}`;
  // Points at this same file's own img=1 branch above (a re-encoded,
  // guaranteed-baseline JPEG), not directly at Supabase Storage's transform
  // URL -- see the comment on that branch for why.
  const image = product.images?.[0] ? `${SITE_URL}/api/product-share?id=${id}&img=1` : '';

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<meta property="og:type" content="product"/>
<meta property="og:title" content="${escapeHtml(title)}"/>
<meta property="og:description" content="${escapeHtml(description)}"/>
${image ? `<meta property="og:image" content="${escapeHtml(image)}"/>\n<meta property="og:image:type" content="image/jpeg"/>\n<meta name="twitter:card" content="summary_large_image"/>` : ''}
<meta property="og:url" content="${escapeHtml(productUrl)}"/>
<meta http-equiv="refresh" content="0;url=${escapeHtml(productUrl)}"/>
</head>
<body>
<a href="${escapeHtml(productUrl)}">${escapeHtml(title)}</a>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Short public cache -- crawlers/re-shares benefit from not hitting
  // Supabase on every fetch, but a product edit (new photo, renamed) still
  // shows up within a few minutes rather than being stuck indefinitely.
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.status(200).send(html);
}
