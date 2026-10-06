// Runs as a "prebuild" hook (see package.json) -- writes public/sitemap.xml
// as a plain static file before react-scripts build runs, so it's just
// another file CRA copies into the final build, no server-side rendering or
// new serverless function involved. Queries the same public tables every
// shop page already reads (products, categories, stories -- RLS only ever
// returns active products, active categories and published articles).
//
// Deliberately never throws/exits non-zero -- a Supabase hiccup during a
// build must not be able to abort the whole deployment. On any fetch
// failure this falls back to writing the static routes alone (and whatever
// was fetched before the failure) and logs a warning, rather than failing
// the build or leaving a stale sitemap in place from a previous run.
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

// The site address lives in src/config/company.js (an ES module, which this CommonJS script cannot import), so the
// one line is read from the file instead of being repeated here.
function siteUrl() {
  try {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'config', 'company.js'), 'utf8');
    const m = src.match(/website:\s*['"]([^'"]+)['"]/);
    if (m) return m[1].replace(/\/+$/, '');
  } catch { /* fall through */ }
  console.warn('generate-sitemap: could not read COMPANY.website from src/config/company.js.');
  return '';
}

const STATIC_ROUTES = [
  '/', '/shop', '/gift-card', '/insights', '/help', '/about', '/contact',
  '/shipping-policy', '/returns-policy', '/terms', '/privacy-policy',
];
const PAGE = 500;   // under PostgREST's default 1000-row response cap, so every request is a full page

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildXml(urls) {
  const body = urls.map(u => `  <url>\n    <loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ''}\n  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

// Every row of a table, one page at a time (a single request silently stops at 1000 rows).
async function fetchAll(base, headers, table, query) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(`${base}/rest/v1/${table}?${query}&limit=${PAGE}&offset=${offset}`, { headers });
    if (!res.ok) throw new Error(`${table} fetch returned ${res.status}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

const day = (v) => (v ? String(v).slice(0, 10) : undefined);

async function main() {
  loadLocalEnvFallback();
  const SITE_URL = siteUrl();
  const urls = STATIC_ROUTES.map(r => ({ loc: `${SITE_URL}${r}` }));

  const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
  const anonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;
  if (supabaseUrl && anonKey) {
    const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };
    const sources = [
      ['categories', 'select=slug,updated_at&active=eq.true&order=sort_order.asc,name.asc', r => ({ loc: `${SITE_URL}/category/${encodeURIComponent(r.slug)}`, lastmod: day(r.updated_at) })],
      ['products', 'select=id,updated_at&status=eq.active&order=id.asc', r => ({ loc: `${SITE_URL}/product/${r.id}`, lastmod: day(r.updated_at) })],
      ['stories', 'select=id,created_at&published=eq.true&order=created_at.desc', r => ({ loc: `${SITE_URL}/insights/${r.id}`, lastmod: day(r.created_at) })],
    ];
    for (const [table, query, toUrl] of sources) {
      try {
        const rows = await fetchAll(supabaseUrl, headers, table, query);
        rows.filter(r => r.slug !== '' && r.id !== '').forEach(r => urls.push(toUrl(r)));
      } catch (err) {
        console.warn(`generate-sitemap: could not fetch ${table}, skipping them.`, err.message);
      }
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
