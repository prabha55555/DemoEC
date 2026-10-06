// api/notify.js -- the three admin notification sends merged into one function (Hobby plan: max 12 functions).
// Checks routing by `kind`, the admin gate, and that each branch still does what its old standalone endpoint did.
import crypto from 'node:crypto';
const API = process.env.DEVSTACK_API || 'http://localhost:3100';
const SUPA = process.env.DEVSTACK_SUPA || 'http://localhost:54321';
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  FAIL:', m); } else console.log('  ok  :', m); };
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const sql = async (q) => { const r = await fetch(`${SUPA}/__sql`, { method: 'POST', body: q }); const b = await j(r); if (!r.ok) throw new Error(JSON.stringify(b)); return b; };
const call = async (path, { method = 'POST', body, token } = {}) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await j(r) };
};
const signup = async (email, password) => {
  const h = { 'Content-Type': 'application/json', apikey: 'dev-anon-key' };
  let r = await fetch(`${SUPA}/auth/v1/signup`, { method: 'POST', headers: h, body: JSON.stringify({ email, password }) });
  let b = await r.json();
  if (!b.user) { r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, { method: 'POST', headers: h, body: JSON.stringify({ email, password }) }); b = await r.json(); }
  return { token: b.access_token, id: b.user.id };
};

await fetch(`${API}/__dev/reset-limits`);
const admin = await signup('admin@example.test', 'admin-pass-1');   // same as the --accounts demo admin, so it works with or without them
const shopper = await signup('shopper-n@example.test', 'pw-shopper-1');
// These handlers read the order AS THE ADMIN (row-level security), so the test admin must be in app_admins
await sql(`insert into app_admins (email) values ('admin@example.test') on conflict do nothing`);
await sql(`delete from orders where order_id like 'BL-NT%'; delete from email_sends`);
await sql(`insert into orders (order_id, user_id, user_email, user_name, user_phone, address, items, subtotal, shipping, total, status, payment_status, payment_method)
  values ('BL-NT1', '${shopper.id}', 'shopper-n@example.test', 'Notify Tester', '9876543210', '{"line1":"1 Road","city":"Chennai","state":"Tamil Nadu","pincode":"600001"}'::jsonb,
          '[{"id":"x","variantId":"y","name":"Test Tee","variantLabel":"M / Red","qty":2,"price":500}]'::jsonb, 1000, 0, 1000, 'Shipped', 'paid', 'razorpay')`);
const orderUuid = (await sql(`select id from orders where order_id='BL-NT1'`))[0].id;
const emailTpl = (await sql(`select id from email_templates where event_type='ORDER_SHIPPED' limit 1`))[0].id;
const waTpl = (await sql(`select id from whatsapp_templates where event_type='ORDER_SHIPPED' limit 1`))[0].id;

console.log('routing + admin gate');
let r = await call('/api/notify?kind=test-email', { method: 'GET' });
ok(r.status === 401, 'no token -> 401');
r = await call('/api/notify?kind=test-email', { method: 'GET', token: shopper.token });
ok(r.status === 403, 'a customer token -> 403');
r = await call('/api/notify?kind=nope', { token: admin.token });
ok(r.status === 400 && /Unknown/.test(r.body.error), 'unknown kind -> 400');
r = await call('/api/notify', { token: admin.token, body: { kind: 'nope' } });
ok(r.status === 400, 'kind may also come from the body; unknown -> 400');

console.log('test-email');
r = await call('/api/notify?kind=test-email', { method: 'GET', token: admin.token });
ok(r.status === 200 && r.body.ok && r.body.brevoConfigured === true && r.body.adminEmail === 'admin@example.test', 'GET diagnostic works for the admin');
r = await call('/api/notify?kind=test-email', { token: admin.token, body: { toEmail: 'not-an-email' } });
ok(r.status === 400, 'a bad recipient is refused');
r = await call('/api/notify?kind=test-email', { token: admin.token, body: { toEmail: 'owner@example.test' } });
ok(r.status === 200 && r.body.ok, 'fixed test email is sent');

console.log('order-email');
r = await call('/api/notify?kind=order-email', { token: admin.token, body: { orderId: orderUuid } });
ok(r.status === 400, 'templateId is required');
r = await call('/api/notify?kind=order-email', { token: admin.token, body: { orderId: orderUuid, templateId: emailTpl } });
ok(r.status === 200 && r.body.ok, 'sends the ORDER_SHIPPED template for the order');
const sent = await sql(`select event_type, status, recipient_email, subject from email_sends order by created_at`);
ok(sent.some(s => s.event_type === 'ORDER_SHIPPED' && s.recipient_email === 'shopper-n@example.test' && s.status === 'sent' && /BL-NT1/.test(s.subject)), 'audit log row written with the interpolated subject: ' + sent.map(s => s.event_type + ':' + s.subject).join(' | '));
r = await call('/api/notify?kind=order-email', { token: shopper.token, body: { orderId: orderUuid, templateId: emailTpl } });
ok(r.status === 403, 'a customer cannot trigger an order email');

console.log('order-whatsapp');
r = await call('/api/notify?kind=order-whatsapp', { token: admin.token, body: { orderId: orderUuid, templateId: waTpl } });
ok(r.status === 200 && r.body.ok, 'sends the WhatsApp template for the order');
r = await call('/api/notify?kind=order-whatsapp', { token: admin.token, body: { orderId: orderUuid, templateId: '00000000-0000-0000-0000-000000000000' } });
ok(r.status === 404, 'unknown template -> 404');

process.exit(fail ? 1 : 0);
