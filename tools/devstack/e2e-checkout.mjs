// End-to-end checkout tests against the harness: real api/*.js handlers, real SQL, fake Razorpay.
import crypto from 'node:crypto';
const API = process.env.DEVSTACK_API || 'http://localhost:3100';
const SQLURL = (process.env.DEVSTACK_SUPA || 'http://localhost:54321') + '/__sql';
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  FAIL:', m); } else console.log('  ok  :', m); };
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const sql = async (q) => { const r = await fetch(SQLURL, { method: 'POST', body: q }); const b = await j(r); if (!r.ok) throw new Error(JSON.stringify(b)); return b; };
const post = async (path, body, headers = {}) => { const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }); return { status: r.status, body: await j(r) }; };

await fetch(`${API}/__dev/reset-limits`);
// ---- fixtures: a clothing product with Size x Colour variants, and a plain gadget
await sql(`delete from orders; delete from pending_orders; delete from used_payments; delete from products where product_number like 'E2E-%';`);
const cat = (await sql(`select id from categories where name='Men'`))[0].id;
const tee = (await sql(`insert into products (product_number,name,brand,category_id,status,max_qty_per_order,option_types) values ('E2E-TEE','E2E Tee','Acme','${cat}','active',5,'[{"name":"Size","values":["S","M"]},{"name":"Colour","values":["Red","Blue"]}]') returning id`))[0].id;
const v = async (pid, size, colour, price, mrp, stock, sku) => (await sql(`insert into product_variants (product_id,label,options,price,mrp,stock,sku,position) values ('${pid}','${size} / ${colour}','{"Size":"${size}","Colour":"${colour}"}',${price},${mrp},${stock},'${sku}',0) returning id`))[0].id;
const vSR = await v(tee, 'S', 'Red', 600, 800, 10, 'E2E-TEE-S-R');
const vMB = await v(tee, 'M', 'Blue', 650, 800, 1, 'E2E-TEE-M-B');
const cheapCat = (await sql(`select id from categories where name='Mobile Accessories'`))[0].id;
const cable = (await sql(`insert into products (product_number,name,brand,category_id,status) values ('E2E-CABLE','E2E Cable','Pixelon','${cheapCat}','active') returning id`))[0].id;
const vCable = (await sql(`insert into product_variants (product_id,label,price,mrp,stock) values ('${cable}','Default',199,299,50) returning id`))[0].id;
const stockOf = async (id) => (await sql(`select stock from product_variants where id='${id}'`))[0].stock;
await sql(`update settings set free_shipping_threshold=499, shipping_fee_metro=40, shipping_fee_other=60, cod_enabled=false, cod_fee=25, cod_max_order=5000, seller_state='Tamil Nadu', return_window_days=7 where id='brand'`);

const addr = (city, state) => ({ name: 'Test Buyer', phone: '9876543210', line1: '12 Test Street', city, state, pincode: '600001' });
const base = (items, over = {}) => ({
  items, checkoutAttemptKey: crypto.randomUUID(),
  cart: items.map(i => ({ id: i.id, variantId: i.variantId, name: 'x', isGiftCard: !!i.isGiftCard })),
  addr: addr('Chennai', 'Tamil Nadu'), userName: 'Test Buyer', userEmail: 'buyer@example.test', userPhone: '9876543210', ...over,
});
async function payOnline(created, body) {
  const pay = await (await fetch(`${API}/__dev/pay`, { method: 'POST', body: JSON.stringify({ order_id: created.id }) })).json();
  return post('/api/razorpay-verify-payment', { ...pay, blob: created.blob, blobSig: created.blobSig, cart: body.cart, addr: body.addr, userName: body.userName, userEmail: body.userEmail, userPhone: body.userPhone });
}

await fetch(`${API}/__dev/reset-limits`);
console.log('1) online order, two variants, free shipping over threshold');
{
  const body = base([{ id: tee, variantId: vSR, qty: 2, price: 1 }, { id: cable, variantId: vCable, qty: 1, price: 1 }]);  // client prices are junk on purpose
  const c = await post('/api/razorpay-create-order', body);
  ok(c.status === 200 && c.body.id, 'create-order ok');
  ok(c.body.computedSubtotal === 1399, `server priced from DB, ignoring client price: subtotal ${c.body.computedSubtotal} (2x600 + 199)`);
  ok(c.body.computedShipping === 0, 'shipping free above the threshold');
  ok(c.body.computedTotal === 1399 && c.body.amount === 139900, `total ${c.body.computedTotal}, Razorpay amount ${c.body.amount} paise`);
  ok(c.body.computedTax > 0, `tax portion recorded: ${c.body.computedTax}`);
  ok(await stockOf(vSR) === 8 && await stockOf(vCable) === 49, 'stock reserved per variant (10->8, 50->49)');
  const items = c.body.verifiedItems;
  ok(items[0].variantId === vSR && items[0].variantLabel === 'S / Red' && items[0].mrp === 800 && items[0].gstRate === 12 && items[0].image === null && items[0].returnWindowDays === 7, 'verified item snapshot has variant, label, mrp, GST rate, return window');
  const p = await payOnline(c.body, body);
  ok(p.status === 200 && p.body.verified, 'payment verified, order written');
  const [o] = await sql(`select order_id, status, payment_status, payment_method, shipping, cod_fee, tax_total, total, timeline, items from orders where order_id='${c.body.receipt}'`);
  ok(o.status === 'Placed' && o.payment_status === 'paid' && o.payment_method === 'razorpay', `order: ${o.status} / ${o.payment_status} / ${o.payment_method}`);
  ok(Number(o.total) === 1399 && Number(o.tax_total) > 0, 'order carries total + tax_total');
  ok(o.timeline.length === 1 && o.timeline[0].status === 'Placed', 'timeline starts with Placed');
  ok(o.items[0].variantId === vSR && o.items[0].sku === 'E2E-TEE-S-R' && o.items[0].variantLabel === 'S / Red', 'order line is a full snapshot');
  ok(await stockOf(vSR) === 8, 'stock stays decremented after the order (the sale)');
  const led = await sql(`select reason, delta from inventory_movements where ref='${c.body.receipt}' order by delta`);
  ok(led.length === 2 && led.every(l => l.reason === 'sale'), 'sale ledger rows written');
  ok((await sql(`select sales_count from products where id='${tee}'`))[0].sales_count === 2, 'sales_count bumped');
}

await fetch(`${API}/__dev/reset-limits`);
console.log('2) shipping below the threshold (metro vs other city)');
{
  const b1 = base([{ id: cable, variantId: vCable, qty: 1 }]);                       // 199 < 499
  const c1 = await post('/api/razorpay-create-order', b1);
  ok(c1.body.computedShipping === 40 && c1.body.computedTotal === 239, `Chennai (metro): shipping ${c1.body.computedShipping}, total ${c1.body.computedTotal}`);
  const b2 = base([{ id: cable, variantId: vCable, qty: 1 }], { addr: addr('Shillong', 'Meghalaya') });
  const c2 = await post('/api/razorpay-create-order', b2);
  ok(c2.body.computedShipping === 60 && c2.body.computedTotal === 259, `Shillong: shipping ${c2.body.computedShipping}, total ${c2.body.computedTotal}`);
  ok(c2.body.freeShippingAway === 300, `tells the customer they are ₹${c2.body.freeShippingAway} from free delivery`);
  await post('/api/release-reservation', { checkoutAttemptKey: b1.checkoutAttemptKey });
  await post('/api/release-reservation', { checkoutAttemptKey: b2.checkoutAttemptKey });
  ok(await stockOf(vCable) === 49, 'abandoned checkouts release their stock');
}

await fetch(`${API}/__dev/reset-limits`);
console.log('3) coupon rules');
{
  await sql(`delete from coupons where code in ('MIN500','CAP50','CATMEN','EXPIRED')`);
  await sql(`insert into coupons (code,type,value,applies_to,min_order_value,max_discount) values ('MIN500','percent',10,'all',500,null), ('CAP50','percent',50,'all',0,50)`);
  await sql(`insert into coupons (code,type,value,applies_to,category_ids) values ('CATMEN','flat',100,'categories','["${cat}"]')`);
  await sql(`insert into coupons (code,type,value,applies_to,expires_at) values ('EXPIRED','percent',10,'all', now() - interval '1 day')`);
  const run = async (code, items) => { const b = base(items, { couponCode: code }); const c = await post('/api/razorpay-create-order', b); await post('/api/release-reservation', { checkoutAttemptKey: b.checkoutAttemptKey }); return c.body; };
  const small = [{ id: cable, variantId: vCable, qty: 1 }];
  const big = [{ id: tee, variantId: vSR, qty: 1 }];
  let r = await run('MIN500', small); ok(r.computedDiscount === 0 && /Add items worth/.test(r.couponNote), `minimum order not met -> dropped with a reason: "${r.couponNote}"`);
  r = await run('MIN500', big); ok(r.computedDiscount === 60, 'minimum met -> 10% of 600 = 60');
  r = await run('CAP50', big); ok(r.computedDiscount === 50, '50% off capped at ₹50');
  r = await run('CATMEN', big); ok(r.computedDiscount === 100, 'category coupon applies to a Men item');
  r = await run('CATMEN', small); ok(r.computedDiscount === 0 && /categories/.test(r.couponNote), 'category coupon refuses a Mobile Accessories item');
  r = await run('EXPIRED', big); ok(r.computedDiscount === 0 && /expired/.test(r.couponNote), 'expired coupon refused');
  r = await run('NOPE', big); ok(r.computedDiscount === 0 && r.couponNote, 'unknown coupon refused');
  ok((await sql(`select times_used from coupons where code='CAP50'`))[0].times_used === 0, 'released checkouts gave their coupon use back');
}

await fetch(`${API}/__dev/reset-limits`);
console.log('4) stock and tampering');
{
  let c = await post('/api/razorpay-create-order', base([{ id: tee, variantId: vMB, qty: 2 }]));
  ok(c.status === 400 && /Only 1 left/.test(c.body.error), `oversell refused with a clear message: "${c.body.error}"`);
  c = await post('/api/razorpay-create-order', base([{ id: cable, variantId: vMB, qty: 1 }]));
  ok(c.status === 400 && /no longer available/.test(c.body.error), 'a variant that belongs to another product is refused');
  c = await post('/api/razorpay-create-order', base([{ id: tee, qty: 1 }]));
  ok(c.status === 400 && /out of date/.test(c.body.error), 'a line without a variantId is refused');
  c = await post('/api/razorpay-create-order', base([{ id: tee, variantId: vSR, qty: 6 }]));
  ok(c.status === 400 && /at most 5/.test(c.body.error), 'per-order quantity cap enforced');
  await sql(`update product_variants set active=false where id='${vSR}'`);
  c = await post('/api/razorpay-create-order', base([{ id: tee, variantId: vSR, qty: 1 }]));
  ok(c.status === 400, 'inactive variant refused');
  await sql(`update product_variants set active=true where id='${vSR}'`);
  await sql(`update products set status='draft' where id='${tee}'`);
  c = await post('/api/razorpay-create-order', base([{ id: tee, variantId: vSR, qty: 1 }]));
  ok(c.status === 400, 'draft product cannot be ordered');
  await sql(`update products set status='active' where id='${tee}'`);
}

await fetch(`${API}/__dev/reset-limits`);
console.log('5) Cash on Delivery');
{
  let b = base([{ id: cable, variantId: vCable, qty: 1 }], { paymentMethod: 'cod' });
  let c = await post('/api/razorpay-create-order', b);
  ok(c.status === 400 && /not available/.test(c.body.error), 'COD refused while the store has it switched off');
  await sql(`update settings set cod_enabled=true where id='brand'`);
  b = base([{ id: cable, variantId: vCable, qty: 1 }], { paymentMethod: 'cod' });
  c = await post('/api/razorpay-create-order', b);
  ok(c.status === 200 && c.body.cod === true && !c.body.id, 'COD: server returns a signed blob, no Razorpay order');
  ok(c.body.computedShipping === 40 && c.body.computedCodFee === 25 && c.body.computedTotal === 264, `COD total = 199 + 40 shipping + 25 COD fee = ${c.body.computedTotal}`);
  const f = await post('/api/verify-free-order', { receipt: c.body.receipt, blob: c.body.blob, blobSig: c.body.blobSig, cart: b.cart, addr: b.addr, userName: b.userName, userEmail: b.userEmail, userPhone: b.userPhone });
  ok(f.status === 200 && f.body.verified, 'COD order confirmed through the signed blob');
  const [o] = await sql(`select status, payment_status, payment_method, cod_fee, total from orders where order_id='${c.body.receipt}'`);
  ok(o.status === 'Placed' && o.payment_status === 'cod_pending' && o.payment_method === 'cod' && Number(o.cod_fee) === 25 && Number(o.total) === 264, `COD order stored as ${o.payment_status}/${o.payment_method}`);
  ok(await stockOf(vCable) === 48, 'COD order took stock');
  // a client cannot turn an online blob into a free order
  const b2 = base([{ id: cable, variantId: vCable, qty: 1 }]);
  const c2 = await post('/api/razorpay-create-order', b2);
  const f2 = await post('/api/verify-free-order', { receipt: c2.body.receipt, blob: c2.body.blob, blobSig: c2.body.blobSig, cart: b2.cart, addr: b2.addr, userName: 'x', userEmail: 'x@x.test', userPhone: '9876543210' });
  ok(f2.status === 400, 'an ONLINE order cannot be completed through the free/COD endpoint');
  await post('/api/release-reservation', { checkoutAttemptKey: b2.checkoutAttemptKey });
  // COD with a cart over the COD ceiling
  await sql(`update settings set cod_max_order=100 where id='brand'`);
  const b3 = base([{ id: cable, variantId: vCable, qty: 1 }], { paymentMethod: 'cod' });
  const c3 = await post('/api/razorpay-create-order', b3);
  ok(c3.status === 400 && /up to/.test(c3.body.error), `COD refused above its ceiling: "${c3.body.error}"`);
  ok(await stockOf(vCable) === 48, '...and nothing was left reserved');
  await sql(`update settings set cod_max_order=5000, cod_enabled=false where id='brand'`);
}

await fetch(`${API}/__dev/reset-limits`);
console.log('6) fully covered by a coupon -> free order');
{
  await sql(`delete from coupons where code='FREEALL'; insert into coupons (code,type,value,applies_to) values ('FREEALL','flat',10000,'all')`);
  // a ₹600 cart: the coupon wipes out the merchandise, and delivery stays free because the CART is over the threshold
  const b = base([{ id: tee, variantId: vSR, qty: 1 }], { couponCode: 'FREEALL' });
  const c = await post('/api/razorpay-create-order', b);
  ok(c.status === 200 && c.body.free === true && c.body.computedTotal === 0 && c.body.computedShipping === 0, 'coupon covers the whole order -> free path, no surprise shipping charge');
  const f = await post('/api/verify-free-order', { receipt: c.body.receipt, blob: c.body.blob, blobSig: c.body.blobSig, cart: b.cart, addr: b.addr, userName: b.userName, userEmail: b.userEmail, userPhone: b.userPhone });
  ok(f.status === 200 && f.body.verified, 'free order confirmed');
  const [o] = await sql(`select payment_method, payment_status, total, coupon_code from orders where order_id='${c.body.receipt}'`);
  ok(o.payment_method === 'free' && o.payment_status === 'paid' && Number(o.total) === 0 && o.coupon_code === 'FREEALL', `stored as ${o.payment_method}/${o.payment_status}`);
  // a cheap cart: the coupon covers the goods but delivery is still owed
  const b2 = base([{ id: cable, variantId: vCable, qty: 1 }], { couponCode: 'FREEALL' });
  const c2 = await post('/api/razorpay-create-order', b2);
  ok(c2.body.computedDiscount === 199 && c2.body.computedShipping === 40 && c2.body.computedTotal === 40, 'cheap cart: goods free, 40 delivery still charged');
  await post('/api/release-reservation', { checkoutAttemptKey: b2.checkoutAttemptKey });
}

await fetch(`${API}/__dev/reset-limits`);
console.log('7) webhook recovers a paid order the browser never confirmed');
{
  const body = base([{ id: cable, variantId: vCable, qty: 1 }, { id: tee, variantId: vSR, qty: 1 }]);
  const c = await post('/api/razorpay-create-order', body);
  const pay = await (await fetch(`${API}/__dev/pay`, { method: 'POST', body: JSON.stringify({ order_id: c.body.id }) })).json();
  const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: pay.razorpay_payment_id, order_id: c.body.id, amount: c.body.amount, currency: 'INR', status: 'captured' } } } });
  const sig = crypto.createHmac('sha256', 'dev_webhook_secret').update(raw).digest('hex');
  const r = await fetch(`${API}/api/razorpay-webhook`, { method: 'POST', headers: { 'x-razorpay-signature': sig, 'content-type': 'application/json' }, body: raw });
  const rb = await j(r);
  ok(rb.recovered === true, 'webhook recovered the order: ' + JSON.stringify(rb));
  const [o] = await sql(`select status, payment_status, items from orders where order_id='${c.body.receipt}'`);
  ok(o && o.status === 'Placed' && o.items.length === 2 && o.items[0].variantId, 'recovered order has variant snapshots');
  const dup = await post('/api/razorpay-verify-payment', { ...pay, blob: c.body.blob, blobSig: c.body.blobSig, cart: body.cart, addr: body.addr, userName: 'x', userEmail: 'x@x.test', userPhone: '9876543210' });
  ok(dup.status === 200 && dup.body.verified, 'browser verify after the webhook is a harmless success (no duplicate order)');
  ok((await sql(`select count(*)::int n from orders where order_id='${c.body.receipt}'`))[0].n === 1, 'still exactly one order');
}

await fetch(`${API}/__dev/reset-limits`);
console.log('8) two shoppers, one unit');
{
  const bA = base([{ id: tee, variantId: vMB, qty: 1 }]);
  const bB = base([{ id: tee, variantId: vMB, qty: 1 }]);
  const [a, b] = await Promise.all([post('/api/razorpay-create-order', bA), post('/api/razorpay-create-order', bB)]);
  const wins = [a, b].filter(x => x.status === 200).length;
  ok(wins === 1, `exactly one of two concurrent checkouts got the last unit (wins: ${wins}; statuses ${a.status}/${b.status})`);
  ok(await stockOf(vMB) === 0, 'stock is 0, never negative');
  await post('/api/release-reservation', { checkoutAttemptKey: bA.checkoutAttemptKey });
  await post('/api/release-reservation', { checkoutAttemptKey: bB.checkoutAttemptKey });
  ok(await stockOf(vMB) === 1, 'released -> 1 again');
}

process.exit(fail ? 1 : 0);
