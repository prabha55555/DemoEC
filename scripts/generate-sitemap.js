// Runs as a "prebuild" hook (see package.json) -- writes public/sitemap.xml
// as a plain static file before react-scripts build runs, so it's just
// another file CRA copies into the final build, no server-side rendering or
// new serverless function involved. Queries the same public `products` table
// every shop/product page already reads from (no anon SELECT restriction).
//
// Deliberately never throws/exits non-zero -- a Supabase hiccup during a
// build must not be able to abort the whole deployment. On any fetch
// failure this falls back to writing the static routes alone and logs a
// warning, rather than failing the build or leaving a stale sitemap in
// place from a previous run.
const fs = require('fs');
const path = require('path');

// react-scripts loads .env.local/.env itself for its own build step, but a
// plain `node` process (this script) doesn't get that for free -- Vercel's
// own build environment already injects configured project env vars
// directly into process.env for every build process (not just
// react-scripts), so this is only needed for local/manual runs. Never
// overrides a value already set in the real environment.
function loadLocalEnvFallback() {
  for (const file of ['.env.local', '.env']) {
    const p = path.join(__dirname, '..', file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
}

const SITE_URL = 'https://www.brightlightsolutions.in';
const STATIC_ROUTES = ['/', '/shop', '/insights', '/help', '/about', '/contact', '/gift-card'];

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildXml(urls) {
  const body = urls.map(u => `  <url>\n    <loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ''}\n  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

async function main() {
  loadLocalEnvFallback();
  const urls = STATIC_ROUTES.map(r => ({ loc: `${SITE_URL}${r}` }));

  const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
  const anonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
  if (supabaseUrl && anonKey) {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/products?select=id,updated_at&available=eq.true`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      });
      if (res.ok) {
        const rows = await res.json();
        for (const p of rows) {
          urls.push({ loc: `${SITE_URL}/product/${p.id}`, lastmod: p.updated_at ? p.updated_at.slice(0, 10) : undefined });
        }
      } else {
        console.warn(`generate-sitemap: products fetch returned ${res.status}, writing static routes only.`);
      }
    } catch (err) {
      console.warn('generate-sitemap: could not fetch products, writing static routes only.', err.message);
    }
  } else {
    console.warn('generate-sitemap: Supabase env vars not available, writing static routes only.');
  }

  const outPath = path.join(__dirname, '..', 'public', 'sitemap.xml');
  fs.writeFileSync(outPath, buildXml(urls));
  console.log(`generate-sitemap: wrote ${urls.length} URLs to ${outPath}`);
}

main().catch(err => {
  console.warn('generate-sitemap: unexpected failure, leaving any existing sitemap.xml in place.', err.message);
});
