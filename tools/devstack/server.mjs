// Dev-only stand-in for Supabase: real Postgres (PGlite) behind a PostgREST-compatible
// HTTP layer + minimal GoTrue (auth) + Storage stubs. Also hosts the project's real
// api/*.js handlers with a fake Razorpay, so checkout can be exercised end to end.
//
//   node server.mjs [--port 54321] [--api-port 3100] [--sql file.sql ...] [--seed file.sql ...]
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const multi = (name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : []));
const PORT = Number(opt('--port', 54321));
const API_PORT = Number(opt('--api-port', 3100));
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = opt('--project', path.resolve(HERE, '../..'));

export const JWT_SECRET = 'dev-jwt-secret';
export const SERVICE_KEY = 'dev-service-role-key';
export const ANON_KEY = 'dev-anon-key';
export const RZP = { keyId: 'rzp_test_devkey', keySecret: 'dev_razorpay_secret', webhookSecret: 'dev_webhook_secret' };

const db = new PGlite();
await db.exec(fs.readFileSync(path.join(HERE, 'supabase-stub.sql'), 'utf8'));
for (const f of [...multi('--sql'), ...multi('--seed')]) {
  await db.exec(fs.readFileSync(f, 'utf8'));
  console.log('applied', f);
}

// ---------------------------------------------------------------- helpers
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function mintJwt(user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600 * 24, app_metadata: user.raw_app_meta_data || {}, user_metadata: {} };
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(payload);
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function readJwt(token) {
  try {
    const [h, p, s] = token.split('.');
    const expect = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url');
    if (s !== expect) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch { return null; }
}
const qi = (id) => '"' + String(id).replace(/"/g, '""') + '"';
const lit = (v) => (v === null || v === undefined ? 'null' : "'" + String(v).replace(/'/g, "''") + "'");

// Resolve who is calling: service role, an authenticated user, or anon.
function whoIs(req) {
  const apikey = req.headers['apikey'];
  const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  if (bearer === SERVICE_KEY || apikey === SERVICE_KEY && !bearer) return { role: 'service_role', sub: null };
  const claims = bearer && bearer !== ANON_KEY ? readJwt(bearer) : null;
  if (claims?.sub) return { role: 'authenticated', sub: claims.sub, claims };
  return { role: 'anon', sub: null };
}

// ---------------------------------------------------------------- PostgREST query -> SQL
// Column expression: supports json paths  data->>key / data->a->>b
function colExpr(raw) {
  const parts = raw.split(/(->>|->)/);
  let sql = qi(parts[0]);
  for (let i = 1; i < parts.length; i += 2) {
    const op = parts[i]; const key = parts[i + 1];
    sql += `${op}${/^\d+$/.test(key) ? key : lit(key)}`;
  }
  return sql;
}
function splitTop(s) { // split on commas not nested in () or {}
  const out = []; let depth = 0; let cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '{') depth++;
    if (ch === ')' || ch === '}') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function unquote(v) { return v.length > 1 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v; }
function condition(colRaw, expr) { // expr like  eq.5  not.in.(a,b)
  let neg = false; let e = expr;
  if (e.startsWith('not.')) { neg = true; e = e.slice(4); }
  const dot = e.indexOf('.');
  const op = e.slice(0, dot); const val = e.slice(dot + 1);
  const col = colExpr(colRaw);
  let sql;
  switch (op) {
    case 'eq': sql = `${col}::text = ${lit(val)}`; break;
    case 'neq': sql = `${col}::text <> ${lit(val)}`; break;
    case 'gt': sql = `${col} > ${lit(val)}`; break;
    case 'gte': sql = `${col} >= ${lit(val)}`; break;
    case 'lt': sql = `${col} < ${lit(val)}`; break;
    case 'lte': sql = `${col} <= ${lit(val)}`; break;
    case 'like': sql = `${col}::text like ${lit(val.replace(/\*/g, '%'))}`; break;
    case 'ilike': sql = `${col}::text ilike ${lit(val.replace(/\*/g, '%'))}`; break;
    case 'is': sql = val === 'null' ? `${col} is null` : val === 'true' ? `${col} is true` : val === 'false' ? `${col} is false` : `${col} is not distinct from ${lit(val)}`; break;
    case 'in': {
      const items = splitTop(val.replace(/^\(|\)$/g, '')).map(unquote);
      sql = items.length ? `${col}::text in (${items.map(lit).join(',')})` : 'false'; break;
    }
    case 'cs': sql = `${col} @> ${lit(val.replace(/^\{/, '[').replace(/\}$/, ']').startsWith('[') && !val.startsWith('[') ? val : val)}::jsonb`; break;
    case 'cd': sql = `${col} <@ ${lit(val)}::jsonb`; break;
    default: throw new Error('unsupported operator ' + op);
  }
  return neg ? `not (${sql})` : sql;
}
function orGroup(inner, joiner = ' or ') {
  return '(' + splitTop(inner).map((part) => {
    const m = part.match(/^(and|or)\((.*)\)$/);
    if (m) return orGroup(m[2], m[1] === 'and' ? ' and ' : ' or ');
    const i = part.indexOf('.');
    return condition(part.slice(0, i), part.slice(i + 1));
  }).join(joiner) + ')';
}
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
function buildWhere(params) {
  const clauses = [];
  for (const [k, v] of params) {
    if (RESERVED.has(k)) continue;
    if (k === 'or') clauses.push(orGroup(v.replace(/^\(|\)$/g, '')));
    else if (k === 'and') clauses.push(orGroup(v.replace(/^\(|\)$/g, ''), ' and '));
    else clauses.push(condition(k, v));
  }
  return clauses.length ? ' where ' + clauses.join(' and ') : '';
}
function buildSelect(sel) {
  if (!sel || sel === '*') return '*';
  if (sel.includes('(')) throw new Error('embedded resources are not supported by the dev server: ' + sel);
  return splitTop(sel).map((c) => {
    const [name, alias] = c.split(':').reverse();
    const base = colExpr(name.trim());
    return alias ? `${base} as ${qi(alias)}` : base;
  }).join(', ');
}
function buildOrder(order) {
  if (!order) return '';
  return ' order by ' + order.split(',').map((o) => {
    const [c, ...mods] = o.split('.');
    return `${colExpr(c)} ${mods.includes('desc') ? 'desc' : 'asc'}${mods.includes('nullsfirst') ? ' nulls first' : mods.includes('nullslast') ? ' nulls last' : ''}`;
  }).join(', ');
}

async function readBody(req) {
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString();
  return raw;
}

// One request == one transaction with the caller's role + claims applied (so RLS is real).
async function asCaller(who, fn) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${who.role}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [who.sub || '']);
    return fn(tx);
  });
}

function cors(res, extra = {}) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Type');
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
}
function send(res, status, body, extra = {}) {
  cors(res, { 'Content-Type': 'application/json', ...extra });
  res.statusCode = status;
  res.end(body === undefined ? '' : JSON.stringify(body));
}
function pgError(res, e) {
  const code = e.code || 'P0001';
  const status = code === '42501' ? 403 : code === '23505' ? 409 : code === '23503' ? 409 : code.startsWith('23') ? 400 : code === 'PGRST' ? 404 : 400;
  send(res, status, { code, message: e.message, details: e.detail || null, hint: e.hint || null });
}

// ---------------------------------------------------------------- REST
async function handleRest(req, res, url) {
  const who = whoIs(req);
  const table = url.pathname.replace('/rest/v1/', '').replace(/^\/+/, '');
  const params = [...url.searchParams.entries()];
  const prefer = req.headers['prefer'] || '';
  const wantRows = /return=representation/.test(prefer);
  const wantCount = /count=exact/.test(prefer);
  const single = /vnd\.pgrst\.object/.test(req.headers['accept'] || '');
  const method = req.method;
  const raw = method === 'GET' || method === 'DELETE' ? '' : await readBody(req);
  const body = raw ? JSON.parse(raw) : null;

  try {
    // ---- RPC
    if (table.startsWith('rpc/')) {
      const fn = table.slice(4);
      const result = await asCaller(who, async (tx) => {
        const argsObj = body || {};
        const keys = Object.keys(argsObj);
        // Like PostgREST: leave parameter types to the function signature. Arrays of scalars become Postgres
        // array literals (text[] / uuid[] params); objects and arrays of objects stay JSON (jsonb params).
        const named = keys.map((k, i) => `${qi(k)} => $${i + 1}`).join(', ');
        const esc = (x) => String(x).split('\\').join('\\\\').split('"').join('\\"');
        const pgArray = (a) => '{' + a.map(x => (x === null ? 'NULL' : '"' + esc(x) + '"')).join(',') + '}';
        const vals = keys.map((k) => {
          const v = argsObj[k];
          if (Array.isArray(v) && v.every(x => x === null || typeof x !== 'object')) return pgArray(v);
          return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
        });
        // Like PostgREST: a function that returns a TABLE answers with a JSON array of rows; a scalar / jsonb /
        // void function answers with that single value. Selecting FROM the function makes Postgres report which.
        const r = await tx.query(`select * from ${qi(fn)}(${named})`, vals);
        if (r.fields.length === 1 && r.fields[0].name === fn) return r.rows[0]?.[fn] ?? null;
        return r.rows;
      });
      return send(res, 200, result);
    }

    const result = await asCaller(who, async (tx) => {
      if (method === 'GET' || method === 'HEAD') {
        const where = buildWhere(params);
        const sel = buildSelect(url.searchParams.get('select'));
        const order = buildOrder(url.searchParams.get('order'));
        let limit = url.searchParams.get('limit'); let offset = url.searchParams.get('offset');
        const range = req.headers['range'];
        if (range && /^\d+-\d*$/.test(range) ) { const [a, b] = range.split('-'); offset = a; if (b) limit = String(Number(b) - Number(a) + 1); }
        const q = `select ${sel} from ${qi(table)}${where}${order}${limit ? ` limit ${Number(limit)}` : ''}${offset ? ` offset ${Number(offset)}` : ''}`;
        const rows = (await tx.query(q)).rows;
        let count = null;
        if (wantCount) count = Number((await tx.query(`select count(*)::int as n from ${qi(table)}${where}`)).rows[0].n);
        return { rows, count };
      }
      if (method === 'POST') {
        const list = Array.isArray(body) ? body : [body];
        if (list.length === 0) return { rows: [] };
        const cols = [...new Set(list.flatMap((r) => Object.keys(r)))];
        const colTypes = (await tx.query(`select column_name, data_type, udt_name from information_schema.columns where table_schema='public' and table_name=$1`, [table])).rows
          .reduce((m, r) => ({ ...m, [r.column_name]: r }), {});
        const valsSql = list.map((r) => '(' + cols.map((c) => {
          const v = r[c];
          if (v === undefined) return 'default';
          if (v === null) return 'null';
          const t = colTypes[c]?.data_type;
          if (typeof v === 'object') return `${lit(JSON.stringify(v))}::${t === 'jsonb' || t === 'json' ? t : (t === 'ARRAY' ? 'jsonb' : 'jsonb')}`;
          return lit(v);
        }).join(',') + ')').join(',');
        let q = `insert into ${qi(table)} (${cols.map(qi).join(',')}) values ${valsSql}`;
        if (/resolution=merge-duplicates|resolution=ignore-duplicates/.test(prefer)) {
          const conflict = url.searchParams.get('on_conflict') || 'id';
          const ccols = conflict.split(',').map((c) => qi(c.trim())).join(',');
          q += /ignore-duplicates/.test(prefer) ? ` on conflict (${ccols}) do nothing`
            : ` on conflict (${ccols}) do update set ${cols.filter((c) => !conflict.split(',').includes(c)).map((c) => `${qi(c)} = excluded.${qi(c)}`).join(', ') || `${qi(cols[0])} = excluded.${qi(cols[0])}`}`;
        }
        q += ' returning *';
        const rows = (await tx.query(q)).rows;
        return { rows };
      }
      if (method === 'PATCH') {
        const colTypes = (await tx.query(`select column_name, data_type from information_schema.columns where table_schema='public' and table_name=$1`, [table])).rows
          .reduce((m, r) => ({ ...m, [r.column_name]: r.data_type }), {});
        const sets = Object.entries(body).map(([c, v]) => {
          if (v === null) return `${qi(c)} = null`;
          if (typeof v === 'object') return `${qi(c)} = ${lit(JSON.stringify(v))}::jsonb`;
          return `${qi(c)} = ${lit(v)}`;
        }).join(', ');
        const rows = (await tx.query(`update ${qi(table)} set ${sets}${buildWhere(params)} returning *`)).rows;
        return { rows };
      }
      if (method === 'DELETE') {
        const rows = (await tx.query(`delete from ${qi(table)}${buildWhere(params)} returning *`)).rows;
        return { rows };
      }
      throw new Error('unsupported method ' + method);
    });

    // Select columns requested for write ops (we always return *; project down if select= given)
    let rows = result.rows;
    if (method !== 'GET' && method !== 'HEAD' && url.searchParams.get('select') && url.searchParams.get('select') !== '*') {
      const cols = splitTop(url.searchParams.get('select')).map((c) => c.split(':').pop().trim());
      rows = rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
    }
    const headers = {};
    if (result.count !== null && result.count !== undefined) headers['Content-Range'] = `0-${Math.max(rows.length - 1, 0)}/${result.count}`;
    if (single) {
      if (rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows` }, headers);
      return send(res, 200, rows[0], headers);
    }
    if (method === 'GET' || wantRows) return send(res, 200, rows, headers);
    return send(res, method === 'POST' ? 201 : 204, method === 'POST' ? undefined : undefined, headers);
  } catch (e) {
    return pgError(res, e);
  }
}

// ---------------------------------------------------------------- Auth (GoTrue-lite)
const pw = new Map(); // email -> password

// ---- optional demo accounts + order history (--accounts) ---------------------------------------
async function seedAccounts() {
  const accounts = [['admin@example.test', 'admin-pass-1', true], ['shopper@example.test', 'shopper-pass-1', false]];
  const ids = {};
  for (const [email, password, isAdmin] of accounts) {
    let row = (await db.query('select id from auth.users where email=$1', [email])).rows[0];
    if (!row) row = (await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id', [email])).rows[0];
    ids[email] = row.id; pw.set(email, password);
    if (isAdmin) await db.query('insert into public.app_admins (email) values ($1) on conflict do nothing', [email]);
  }
  const uid = ids['shopper@example.test'];
  await db.query(`insert into public.profiles (id, name, phone, addresses) values ($1, 'Demo Shopper', '9876543210', $2::jsonb) on conflict (id) do nothing`,
    [uid, JSON.stringify([{ name: 'Demo Shopper', phone: '9876543210', line1: '12 Lake View Road', line2: 'Anna Nagar', city: 'Chennai', state: 'Tamil Nadu', pincode: '600040' }])]);
  await db.query(`insert into public.coupons (code, type, value, applies_to, min_order_value, max_discount, description) values
      ('WELCOME10','percent',10,'all',499,150,'10% off your order (up to Rs. 150) on orders above Rs. 499'),
      ('FLAT100','flat',100,'all',999,null,'Rs. 100 off orders above Rs. 999') on conflict (code) do nothing`);

  const variant = async (sku) => (await db.query(`select v.*, p.name pname, p.brand, p.cat, p.images from public.product_variants v join public.products p on p.id=v.product_id where v.sku=$1`, [sku])).rows[0];
  const line = (v, qty) => ({ id: v.product_id, variantId: v.id, sku: v.sku, name: v.pname, variantLabel: v.label === 'Default' ? '' : v.label, options: v.options, qty, price: Number(v.price), mrp: v.mrp ? Number(v.mrp) : null, cat: v.cat, brand: v.brand, image: v.images?.[0] || null, gstRate: 12, hsn: '6104', returnWindowDays: 7 });
  const addr = { name: 'Demo Shopper', phone: '9876543210', line1: '12 Lake View Road', line2: 'Anna Nagar', city: 'Chennai', state: 'Tamil Nadu', pincode: '600040' };
  const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
  const kurta = await variant('DEMO-001-S-INDIGO'), charger = await variant('DEMO-004'), mug = await variant('DEMO-032'), tee = await variant('DEMO-021-M-NAVY');
  if (!kurta || !charger || !mug || !tee) return;
  const orders = [
    { id: 'BL-20001', status: 'Delivered', days: 6, items: [line(kurta, 1), line(charger, 1)], pay: 'razorpay', delivered: 3, events: ['Placed', 'Confirmed', 'Shipped', 'Out for Delivery', 'Delivered'] },
    { id: 'BL-20002', status: 'Shipped', days: 2, items: [line(tee, 2)], pay: 'razorpay', events: ['Placed', 'Confirmed', 'Shipped'], tracking: ['Delhivery', 'DL9921334', 'https://www.delhivery.com/track'] },
    { id: 'BL-20003', status: 'Placed', days: 0, items: [line(mug, 1)], pay: 'razorpay', events: ['Placed'] },
    { id: 'BL-20004', status: 'Cancelled', days: 9, items: [line(charger, 1)], pay: 'razorpay', events: ['Placed', 'Cancelled'], cancelled: true },
    { id: 'BL-20005', status: 'Placed', days: 1, items: [line(kurta, 1), line(mug, 2)], pay: 'cod', events: ['Placed'] },
  ];
  for (const o of orders) {
    const subtotal = o.items.reduce((t, i) => t + i.price * i.qty, 0);
    const shipping = subtotal >= 499 ? 0 : 40;
    const total = subtotal + shipping;
    const tax = Math.round(total - total / 1.12);
    const timeline = o.events.map((st, k) => ({ status: st, at: ago(o.days - k * 0.3 > 0 ? o.days - k * 0.3 : 0), by: 'system' }));
    await db.query(`insert into public.orders (order_id, user_id, user_email, user_name, user_phone, address, items, subtotal, shipping, total, tax_total, payment_method, payment_status, status, payment_id,
        estimated_delivery, shipping_carrier, tracking_number, tracking_url, delivered_at, cancelled_at, cancel_reason, refunded_amount, refunds, timeline, created_at)
      values ($1,$2,'shopper@example.test','Demo Shopper','9876543210',$3::jsonb,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22::jsonb,$23)
      on conflict (order_id) do nothing`,
      [o.id, uid, JSON.stringify({ ...addr, billing: addr }), JSON.stringify(o.items), subtotal, shipping, total, tax, o.pay,
       o.cancelled ? 'refunded' : (o.pay === 'cod' ? 'cod_pending' : 'paid'), o.status, o.pay === 'razorpay' ? 'pay_demo_' + o.id : null,
       '12 Oct - 15 Oct', o.tracking?.[0] || null, o.tracking?.[1] || null, o.tracking?.[2] || null, o.delivered ? ago(o.delivered) : null,
       o.cancelled ? ago(o.days - 0.3) : null, o.cancelled ? 'Ordered by mistake' : null, o.cancelled ? total : 0,
       JSON.stringify(o.cancelled ? [{ id: 'rfnd_demo', amount: total, at: ago(o.days - 0.3), type: 'online', status: 'processed' }] : []),
       JSON.stringify(timeline), ago(o.days)]);
  }
  console.log('demo accounts + orders ready (admin@example.test / admin-pass-1, shopper@example.test / shopper-pass-1)');
}

function userJson(u) {
  return { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: u.email_confirmed_at, app_metadata: u.raw_app_meta_data || {}, user_metadata: {}, created_at: u.created_at };
}
function sessionJson(u) {
  const access_token = mintJwt(u);
  return { access_token, token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, refresh_token: 'rt_' + u.id, user: userJson(u) };
}
async function handleAuth(req, res, url) {
  const p = url.pathname.replace('/auth/v1', '');
  const raw = req.method === 'GET' ? '' : await readBody(req);
  const body = raw ? JSON.parse(raw) : {};
  if (p === '/signup') {
    const email = String(body.email || '').toLowerCase();
    const found = (await db.query('select * from auth.users where email=$1', [email])).rows[0];
    if (found) return send(res, 422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
    const u = (await db.query('insert into auth.users (email, email_confirmed_at) values ($1, now()) returning *', [email])).rows[0];
    pw.set(email, body.password);
    return send(res, 200, sessionJson(u));
  }
  if (p === '/token') {
    const grant = url.searchParams.get('grant_type');
    if (grant === 'refresh_token') {
      const id = String(body.refresh_token || '').replace(/^rt_/, '');
      const u = (await db.query('select * from auth.users where id=$1', [id])).rows[0];
      return u ? send(res, 200, sessionJson(u)) : send(res, 400, { error: 'invalid_grant', error_description: 'bad refresh token' });
    }
    const email = String(body.email || '').toLowerCase();
    const u = (await db.query('select * from auth.users where email=$1', [email])).rows[0];
    if (!u || pw.get(email) !== body.password) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    return send(res, 200, sessionJson(u));
  }
  if (p === '/user') {
    const claims = readJwt((req.headers['authorization'] || '').replace(/^Bearer\s+/i, ''));
    if (!claims) return send(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
    const u = (await db.query('select * from auth.users where id=$1', [claims.sub])).rows[0];
    return u ? send(res, 200, userJson(u)) : send(res, 404, { msg: 'not found' });
  }
  if (p === '/logout') return send(res, 204);
  if (p === '/recover' || p === '/otp' || p === '/verify') return send(res, 200, {});
  return send(res, 404, { msg: 'unsupported auth route ' + p });
}

// ---------------------------------------------------------------- Storage + edge-function stubs
const uploads = new Map();

// supabase-js uploads a file as multipart/form-data (a cacheControl field + the file part). Pull the file's own
// bytes and content type out, so what is served back is the image, not the multipart envelope.
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return null;
  const boundary = Buffer.from('--' + (m[1] || m[2]).trim());
  const parts = [];
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    const next = buf.indexOf(boundary, pos + boundary.length);
    if (next === -1) break;
    const part = buf.subarray(pos + boundary.length + 2, next - 2);          // skip CRLF after the boundary and before the next
    const headEnd = part.indexOf('\r\n\r\n');
    if (headEnd !== -1) parts.push({ head: part.subarray(0, headEnd).toString(), body: part.subarray(headEnd + 4) });
    pos = next;
  }
  const file = parts.find(p => /filename=/i.test(p.head)) || parts.find(p => !/name="cacheControl"/i.test(p.head));
  if (!file) return null;
  const ct = /content-type:\s*([^\r\n]+)/i.exec(file.head);
  return { buf: Buffer.from(file.body), type: ct ? ct[1].trim() : 'application/octet-stream' };
}

async function handleStorage(req, res, url) {
  const object = url.pathname.match(/^\/storage\/v1\/object\/(?:public\/|authenticated\/)?([^/]+)\/(.+)$/);
  // The image-resize route (used by the site's thumb()) just serves the original: there is no resizer here.
  const render = url.pathname.match(/^\/storage\/v1\/render\/image\/(?:public\/|authenticated\/)?([^/]+)\/(.+)$/);
  const hit = object || render;
  if (req.method === 'GET' && hit) {
    const f = uploads.get(`${hit[1]}/${decodeURIComponent(hit[2])}`);
    if (!f) { cors(res); res.statusCode = 404; return res.end('not found'); }
    cors(res, { 'Content-Type': f.type, 'Cache-Control': 'no-store' }); return res.end(f.buf);
  }
  if ((req.method === 'POST' || req.method === 'PUT') && object) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const type = req.headers['content-type'] || 'application/octet-stream';
    const file = /multipart\/form-data/i.test(type) ? parseMultipart(raw, type) : null;
    uploads.set(`${object[1]}/${decodeURIComponent(object[2])}`, file || { buf: raw, type });
    return send(res, 200, { Key: `${object[1]}/${object[2]}`, Id: crypto.randomUUID() });
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/storage/v1/object/')) {
    const body = await readBody(req);
    try { for (const name of JSON.parse(body || '{}').prefixes || []) uploads.delete(`${url.pathname.split('/')[4]}/${name}`); } catch { /* ignore */ }
    return send(res, 200, []);
  }
  return send(res, 200, []);
}
export const whatsappCalls = [];
async function handleFunctions(req, res, url) {
  const body = await readBody(req);
  whatsappCalls.push({ path: url.pathname, body });
  return send(res, 200, { success: true });
}

const supa = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.statusCode = 204; return res.end(); }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith('/rest/v1/')) return await handleRest(req, res, url);
    if (url.pathname.startsWith('/auth/v1/')) return await handleAuth(req, res, url);
    if (url.pathname.startsWith('/storage/v1/')) return await handleStorage(req, res, url);
    if (url.pathname.startsWith('/functions/v1/')) return await handleFunctions(req, res, url);
    if (url.pathname === '/__sql') { // dev-only: run SQL, return rows
      const results = await db.exec(await readBody(req)); return send(res, 200, results[results.length - 1]?.rows || []);
    }
    send(res, 404, { message: 'not found: ' + url.pathname });
  } catch (e) { console.error(e); send(res, 500, { message: e.message }); }
});
supa.listen(PORT, () => console.log(`supabase-lite on :${PORT}`));
if (args.includes('--accounts')) await seedAccounts();

// ---------------------------------------------------------------- API host (the real api/*.js) + fake Razorpay
process.env.REACT_APP_SUPABASE_URL = `http://localhost:${PORT}`;
process.env.SUPABASE_URL = `http://localhost:${PORT}`;
process.env.REACT_APP_SUPABASE_ANON_KEY = ANON_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
process.env.RAZORPAY_KEY_ID = RZP.keyId;
process.env.RAZORPAY_KEY_SECRET = RZP.keySecret;
process.env.RAZORPAY_WEBHOOK_SECRET = RZP.webhookSecret;
process.env.BREVO_API_KEY = 'dev-brevo-key';
process.env.REACT_APP_ADMIN_EMAIL = process.env.REACT_APP_ADMIN_EMAIL || 'admin@example.test';
process.env.SIGNED_TOKEN_SECRET = process.env.SIGNED_TOKEN_SECRET || RZP.keySecret;

export const rzpOrders = new Map();
export const rzpPayments = new Map();
export const rzpRefunds = [];
export const emailsSent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const u = typeof input === 'string' ? input : input.url;
  if (u.startsWith('https://api.razorpay.com/')) {
    const p = u.replace('https://api.razorpay.com/v1', '');
    const jsonRes = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (p === '/orders' && init.method === 'POST') {
      const b = JSON.parse(init.body); const id = 'order_' + crypto.randomBytes(7).toString('hex');
      const o = { id, amount: b.amount, currency: b.currency, receipt: b.receipt, status: 'created' }; rzpOrders.set(id, o); return jsonRes(200, o);
    }
    let m;
    if ((m = p.match(/^\/orders\/(.+)$/))) { const o = rzpOrders.get(m[1]); return o ? jsonRes(200, o) : jsonRes(404, { error: { description: 'no such order' } }); }
    if ((m = p.match(/^\/payments\/([^/]+)\/refund$/))) {
      const pay = rzpPayments.get(m[1]); const b = JSON.parse(init.body);
      if (!pay) return jsonRes(400, { error: { description: 'no such payment' } });
      rzpRefunds.push({ payment_id: m[1], amount: b.amount, notes: b.notes }); return jsonRes(200, { id: 'rfnd_' + crypto.randomBytes(5).toString('hex'), amount: b.amount });
    }
    if ((m = p.match(/^\/payments\/([^/]+)$/))) { const pay = rzpPayments.get(m[1]); return pay ? jsonRes(200, pay) : jsonRes(404, { error: { description: 'no such payment' } }); }
    return jsonRes(404, { error: { description: 'unmocked razorpay route ' + p } });
  }
  if (/^https:\/\/api\.brevo\.com\//.test(u) || /^https:\/\/api\.sendinblue\.com\//.test(u)) {
    emailsSent.push({ url: u, body: init.body }); return new Response(JSON.stringify({ messageId: '<dev@mock>' }), { status: 201, headers: { 'content-type': 'application/json' } });
  }
  return realFetch(input, init);
};

function wrapRes(res) {
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { cors(res, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); return res; };
  return res;
}
const apiDir = path.join(PROJECT, 'api');
const apiServer = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.statusCode = 204; return res.end(); }
  const url = new URL(req.url, `http://localhost:${API_PORT}`);

  // dev control endpoints (never part of the real app)
  if (url.pathname === '/__dev/pay') { // simulate Razorpay capturing a payment for an order
    const b = JSON.parse(await readBody(req));
    const o = rzpOrders.get(b.order_id); if (!o) return send(res, 404, { error: 'no such order' });
    const payId = 'pay_' + crypto.randomBytes(7).toString('hex');
    rzpPayments.set(payId, { id: payId, order_id: o.id, amount: o.amount, currency: 'INR', status: 'captured' });
    const signature = crypto.createHmac('sha256', RZP.keySecret).update(`${o.id}|${payId}`).digest('hex');
    return send(res, 200, { razorpay_order_id: o.id, razorpay_payment_id: payId, razorpay_signature: signature });
  }
  if (url.pathname === '/__dev/reset-limits') {
    const m = await import(pathToFileURL(path.join(PROJECT, 'src/utils/rateLimit.js')).href);
    m.resetRateLimits(); return send(res, 200, { ok: true });
  }
  if (url.pathname === '/__dev/state') return send(res, 200, { rzpRefunds, emailsSent: emailsSent.length, whatsapp: whatsappCalls.length });

  const m = url.pathname.match(/^\/api\/([^/]+)$/);
  if (!m) return send(res, 404, { error: 'not found' });
  const file = path.join(apiDir, m[1] + '.js');
  if (!fs.existsSync(file)) return send(res, 404, { error: 'no such api' });
  try {
    const mod = await import(pathToFileURL(file).href + '?t=' + fs.statSync(file).mtimeMs);
    const raw = await readBody(req);
    const parsedBody = mod.config?.api?.bodyParser === false ? undefined : (raw ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : {});
    // Handlers that disable bodyParser read the stream themselves; give them one.
    const reqLike = mod.config?.api?.bodyParser === false
      ? Object.assign((await import('node:stream')).Readable.from([raw]), { headers: req.headers, method: req.method })
      : Object.assign(req, { body: parsedBody });
    if (mod.config?.api?.bodyParser === false) reqLike.headers = req.headers;
    reqLike.query = Object.fromEntries(url.searchParams);
    await mod.default(reqLike, wrapRes(res));
  } catch (e) { console.error('api error', m[1], e); if (!res.headersSent) send(res, 500, { error: String(e.message) }); }
});
apiServer.listen(API_PORT, () => console.log(`api host on :${API_PORT}`));
