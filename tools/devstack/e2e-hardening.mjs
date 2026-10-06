// Regression tests for issues found in an independent review of the checkout/order code.
// Each test reproduces an abuse or failure scenario; all must PASS once fixed.
import crypto from 'node:crypto';
const API = process.env.DEVSTACK_API || 'http://localhost:3100';
const SUPA = process.env.DEVSTACK_SUPA || 'http://localhost:54321';
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  FAIL:', m); } else console.log('  ok  :', m); };
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const sql = async (q) => { const r = await fetch(`${SUPA}/__sql`, { method: 'POST', body: q }); const b = await j(r); if (!r.ok) throw new Error(JSON.stringify(b)); return b; };
const post = async (path, body, token) => { const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); return { status: r.status, body: await j(r) }; };
const reset = () => fetch(`${API}/__dev/reset-limits`);
const signup = async (email, password) => {
  const h = { 'Content-Type': 'application/json', apikey: 'dev-anon-key' };
  let r = await fetch(`${SUPA}/auth/v1/signup`, { method: 'POST', headers: h, body: JSON.stringify({ email, password }) });
  let b = await r.json();
  if (!b.user) { r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, { method: 'POST', headers: h, body: JSON.stringify({ email, password }) }); b = await r.json(); }
  return { token: b.access_token, id: b.user.id };
};
const rzp = async () => (await (await fetch(`${API}/__dev/state`)).json());

await reset();
await sql(`delete from orders; delete from order_returns; delete from pending_orders; delete from used_payments; delete from products where product_number like 'HD-%'; delete from coupons where code like 'HD%'; delete from gift_cards where code like 'BL-GC-HD%'; delete from auth.users where email like '%@hd.test'`);
const alice = await signup('alice@hd.test', 'pw-alice-1');
const newbie = await signup('newbie@hd.test', 'pw-newbie-1');          // never ordered anything
const admin = await signup('admin@example.test', 'admin-pass-1');   // same as the --accounts demo admin, so it works with or without them
await sql(`update settings set free_shipping_threshold=499, shipping_fee_metro=40, shipping_fee_other=60, cod_enabled=true, cod_fee=0, cod_max_order=100000, return_window_days=7 where id='brand'`);
const cat = (await sql(`select id from categories where name='Men'`))[0].id;
const mkProduct = async (n, price, stock, extra = '') => {
  const pid = (await sql(`insert into products (product_number,name,category_id,status${extra ? ',' + extra.split('=')[0] : ''}) values ('HD-${n}','HD ${n}','${cat}','active'${extra ? ',' + extra.split('=')[1] : ''}) returning id`))[0].id;
  const vid = (await sql(`insert into product_variants (product_id,label,price,stock,sku) values ('${pid}','Default',${price},${stock},'HD-${n}-D') returning id`))[0].id;
  return { pid, vid };
};
const A = await mkProduct('A', 1000, 20);
const B = await mkProduct('B', 1000, 20);
const stock = async (v) => (await sql(`select stock from product_variants where id='${v}'`))[0].stock;
const addr = { name: 'A', phone: '9876543210', line1: '1 Road', city: 'Chennai', state: 'Tamil Nadu', pincode: '600001' };
const body = (lines, extra = {}) => ({
  items: lines.map(l => ({ id: l.pid, variantId: l.vid, qty: l.qty || 1 })), checkoutAttemptKey: crypto.randomUUID(),
  cart: lines.map(l => ({ id: l.pid, variantId: l.vid, name: 'x' })), addr, userName: 'A', userEmail: 'a@hd.test', userPhone: '9876543210', ...extra,
});
const payOnline = async (c, b, token) => {
  const pay = await (await fetch(`${API}/__dev/pay`, { method: 'POST', body: JSON.stringify({ order_id: c.id }) })).json();
  return post('/api/razorpay-verify-payment', { ...pay, blob: c.blob, blobSig: c.blobSig, cart: b.cart, addr: b.addr, userName: 'A', userEmail: 'a@hd.test', userPhone: '9876543210' }, token);
};
const freeVerify = (c, b, token, over = {}) => post('/api/verify-free-order', { receipt: c.receipt, blob: c.blob, blobSig: c.blobSig, cart: b.cart, addr: b.addr, userName: 'A', userEmail: 'a@hd.test', userPhone: '9876543210', ...over }, token);

console.log('C1) release-reservation then pay must NOT keep a gift card / coupon the release already gave back');
{
  await sql(`insert into gift_cards (code,initial_value,balance) values ('BL-GC-HD01-HD01-HD01',400,400); insert into coupons (code,type,value,applies_to,max_uses) values ('HDONE','flat',100,'all',1)`);
  const b = body([{ ...A, qty: 1 }], { couponCode: 'HDONE', giftCardCode: 'BL-GC-HD01-HD01-HD01' });
  const c = await post('/api/razorpay-create-order', b, alice.token);
  ok(c.status === 200 && c.body.computedTotal === 500, 'checkout: 1000 - 100 coupon - 400 gift card = ₹500 to pay');
  // the attacker releases the hold (public endpoint), spends the gift card elsewhere, then pays and verifies
  await post('/api/release-reservation', { checkoutAttemptKey: b.checkoutAttemptKey });
  ok((await sql(`select balance from gift_cards where code='BL-GC-HD01-HD01-HD01'`))[0].balance == 400, 'release gave the gift card back');
  await sql(`update gift_cards set balance = 0 where code='BL-GC-HD01-HD01-HD01'`);        // spent on another order meanwhile
  const refundsBefore = (await rzp()).rzpRefunds.length;
  const p = await payOnline(c.body, b, alice.token);
  ok(p.status === 409 || p.body.verified === false, `paid order is REFUSED when its gift card can no longer be re-applied (status ${p.status}: ${p.body.error})`);
  ok((await rzp()).rzpRefunds.length === refundsBefore + 1, 'and the customer is refunded automatically');
  ok((await sql(`select count(*)::int n from orders where order_id='${c.body.receipt}'`))[0].n === 0, 'no order was written');
  ok(await stock(A.vid) === 20, 'stock was not left taken');
}
{
  // legitimate slow payment: hold released by the sweep, card still has its balance -> re-debited, order accepted
  await sql(`delete from coupons where code='HDONE'; delete from gift_cards where code like 'BL-GC-HD%'; insert into gift_cards (code,initial_value,balance) values ('BL-GC-HD02-HD02-HD02',400,400)`);
  const b = body([{ ...A, qty: 1 }], { giftCardCode: 'BL-GC-HD02-HD02-HD02' });
  const c = await post('/api/razorpay-create-order', b, alice.token);
  await post('/api/release-reservation', { checkoutAttemptKey: b.checkoutAttemptKey });
  ok((await sql(`select balance from gift_cards where code='BL-GC-HD02-HD02-HD02'`))[0].balance == 400, 'slow payer: hold swept, gift card credited back');
  const p = await payOnline(c.body, b, alice.token);
  ok(p.status === 200 && p.body.verified, 'slow payment still becomes an order');
  ok((await sql(`select balance from gift_cards where code='BL-GC-HD02-HD02-HD02'`))[0].balance == 0, 'the gift card is debited AGAIN (no free double spend)');
}

console.log('H1) a failed order write must give back the stock and coupon it consumed');
{
  await reset();
  await sql(`insert into coupons (code,type,value,applies_to,max_uses) values ('HDTWO','flat',50,'all',3)`);
  const before = await stock(B.vid);
  const b = body([{ ...B, qty: 5 }], { paymentMethod: 'cod', couponCode: 'HDTWO' });
  const c = await post('/api/razorpay-create-order', b, alice.token);
  ok(c.status === 200 && c.body.cod, 'COD checkout reserved 5 units + a coupon use');
  ok(await stock(B.vid) === before - 5, 'stock reserved');
  // verify with a cart that omits the line -> order write fails after the reservation was claimed
  const f = await freeVerify(c.body, b, alice.token, { cart: [{ id: A.pid, variantId: A.vid, name: 'x' }] });
  ok(f.status !== 200, 'mismatched cart is refused');
  ok(await stock(B.vid) === before, 'stock is given back (was leaked before the fix)');
  ok((await sql(`select times_used from coupons where code='HDTWO'`))[0].times_used === 0, 'coupon use is given back');
}

console.log('H2) first-order / per-customer coupons cannot be used by guests');
{
  await reset();
  await sql(`delete from pending_orders`);          // earlier groups left open checkouts for this customer, which (correctly) count
  await sql(`insert into coupons (code,type,value,applies_to,first_order_only) values ('HDFIRST','flat',100,'all',true)`);
  const g = await post('/api/razorpay-create-order', body([{ ...A, qty: 1 }], { couponCode: 'HDFIRST' }));   // guest: no token
  ok(g.status === 200 && g.body.computedDiscount === 0 && /Sign in/.test(g.body.couponNote || ''), `guest refused the coupon: "${g.body.couponNote}"`);
  const s = await post('/api/razorpay-create-order', body([{ ...A, qty: 1 }], { couponCode: 'HDFIRST' }), newbie.token);
  ok(s.body.computedDiscount === 100, 'a signed-in first-time customer gets it');
}

{
  // a retry of the same attempt must not count its own hold as a previous order...
  await reset();
  await sql(`delete from pending_orders`);
  const b1 = body([{ ...A, qty: 1 }], { couponCode: 'HDFIRST' });
  const first = await post('/api/razorpay-create-order', b1, newbie.token);
  const retry = await post('/api/razorpay-create-order', b1, newbie.token);
  ok(first.body.computedDiscount === 100 && retry.status === 200 && retry.body.computedDiscount === 100, 'a retry of the same checkout still gets the first-order coupon');
  // ...but a SECOND, parallel checkout by the same customer cannot take it again
  await reset();
  const second = await post('/api/razorpay-create-order', body([{ ...A, qty: 1 }], { couponCode: 'HDFIRST' }), newbie.token);
  ok(second.status === 200 && second.body.computedDiscount === 0 && /first order/.test(second.body.couponNote || ''), `a parallel checkout is refused: "${second.body.couponNote}"`);
}

console.log('H3) migration keeps hidden products hidden (checked in test-migration.mjs)');

console.log('C2) a purchased gift card cannot be cancelled-and-kept');
{
  await reset();
  const gb = { items: [{ id: 'gc-1', qty: 1, isGiftCard: true, price: 2000 }], checkoutAttemptKey: crypto.randomUUID(), cart: [{ id: 'gc-1', isGiftCard: true, name: 'Gift card' }], addr, userName: 'A', userEmail: 'a@hd.test', userPhone: '9876543210' };
  const c = await post('/api/razorpay-create-order', gb, alice.token);
  ok(c.status === 200 && c.body.computedTotal === 2000, 'gift card checkout ₹2000');
  const p = await payOnline(c.body, gb, alice.token);
  ok(p.status === 200 && p.body.verified, 'gift card purchased');
  const card = (await sql(`select code, balance, initial_value from gift_cards where order_id='${c.body.receipt}'`))[0];
  ok(card && Number(card.balance) === 2000, 'card issued with ₹2000');
  let r = await post('/api/orders', { action: 'cancel', orderId: c.body.receipt, reason: 'x' }, alice.token);
  ok(r.status === 409 && /gift card/i.test(r.body.error), `customer cannot cancel an order that bought a gift card: "${r.body.error}"`);
  // part-spent card: admin cannot cancel/refund
  await sql(`update gift_cards set balance = 1500 where code='${card.code}'`);
  r = await post('/api/orders', { action: 'admin_cancel', orderId: c.body.receipt, reason: 'x' }, admin.token);
  ok(r.status === 409 && /partly|spent|used/i.test(r.body.error), `admin cannot cancel once the card is part-spent: "${r.body.error}"`);
  const rb = (await rzp()).rzpRefunds.length;
  await sql(`update gift_cards set balance = 2000 where code='${card.code}'`);
  r = await post('/api/orders', { action: 'admin_cancel', orderId: c.body.receipt, reason: 'fraud' }, admin.token);
  ok(r.status === 200, 'admin can cancel while the card is untouched');
  ok((await sql(`select balance from gift_cards where code='${card.code}'`))[0].balance == 0, 'the card is voided');
  ok((await rzp()).rzpRefunds.length === rb + 1, 'and the payment refunded');
  r = await post('/api/orders', { action: 'admin_refund', orderId: c.body.receipt, amount: 100 }, admin.token);
  ok(r.status >= 400, 'no further refunds on that order');
}

console.log('M1) releasing a checkout that used a coupon AND a gift card gives each back once');
{
  await reset();
  await sql(`delete from gift_cards where code like 'BL-GC-HD%'; delete from coupons where code like 'HD%'; insert into gift_cards (code,initial_value,balance) values ('BL-GC-HD03-HD03-HD03',300,300); insert into coupons (code,type,value,applies_to,max_uses) values ('HDTHREE','flat',100,'all',9)`);
  const b = body([{ ...A, qty: 1 }], { couponCode: 'HDTHREE', giftCardCode: 'BL-GC-HD03-HD03-HD03' });
  await post('/api/razorpay-create-order', b, alice.token);
  // two other customers also hold a use of the same coupon, so the counter is well above zero and any
  // extra release would visibly steal one of THEIR uses
  const o1 = body([{ ...A, qty: 1 }], { couponCode: 'HDTHREE' });
  const o2 = body([{ ...A, qty: 1 }], { couponCode: 'HDTHREE' });
  await post('/api/razorpay-create-order', o1, alice.token);
  await post('/api/razorpay-create-order', o2, alice.token);
  ok((await sql(`select times_used from coupons where code='HDTHREE'`))[0].times_used === 3, 'three checkouts hold the coupon');
  await post('/api/release-reservation', { checkoutAttemptKey: b.checkoutAttemptKey });
  await post('/api/release-reservation', { checkoutAttemptKey: b.checkoutAttemptKey });
  await post('/api/release-reservation', { checkoutAttemptKey: b.checkoutAttemptKey });
  ok((await sql(`select times_used from coupons where code='HDTHREE'`))[0].times_used === 2, 'releasing the first checkout three times gives back exactly ONE use (others keep theirs)');
  ok((await sql(`select balance from gift_cards where code='BL-GC-HD03-HD03-HD03'`))[0].balance == 300, 'gift card credited exactly once');
}

console.log('M2) a failed refund on cancel is reported, and a gift card is still credited');
{
  await reset();
  await sql(`delete from gift_cards where code like 'BL-GC-HD%'; insert into gift_cards (code,initial_value,balance) values ('BL-GC-HD04-HD04-HD04',300,300)`);
  const b = body([{ ...A, qty: 1 }], { giftCardCode: 'BL-GC-HD04-HD04-HD04' });
  const c = await post('/api/razorpay-create-order', b, alice.token);
  await payOnline(c.body, b, alice.token);
  await sql(`update orders set payment_id='pay_doesnotexist' where order_id='${c.body.receipt}'`);   // the gateway will refuse this refund
  const r = await post('/api/orders', { action: 'cancel', orderId: c.body.receipt, reason: 'x' }, alice.token);
  ok(r.status === 200 && r.body.order.status === 'Cancelled', 'order is cancelled');
  ok(r.body.refundFailed === true, 'the response says the refund FAILED (not silent success)');
  ok((await sql(`select balance from gift_cards where code='BL-GC-HD04-HD04-HD04'`))[0].balance == 300, 'gift card still credited back');
  ok((await sql(`select count(*)::int n from order_notes where order_uuid=(select id from orders where order_id='${c.body.receipt}')`))[0].n >= 1, 'an internal note tells the admin to refund manually');
  const o = (await sql(`select refunded_amount, payment_status from orders where order_id='${c.body.receipt}'`))[0];
  ok(Number(o.refunded_amount) === 0 && o.payment_status === 'paid', 'books show nothing refunded (the reserved amount was rolled back)');
}

console.log('M3) duplicate lines in a return request cannot inflate the refund');
{
  await reset();
  const b = body([{ ...A, qty: 2 }]);
  const c = await post('/api/razorpay-create-order', b, alice.token);
  await payOnline(c.body, b, alice.token);
  await post('/api/orders', { action: 'admin_status', orderId: c.body.receipt, status: 'Delivered' }, admin.token);
  const r = await post('/api/orders', { action: 'return_request', orderId: c.body.receipt, reason: 'x', items: [{ variantId: A.vid, qty: 2 }, { variantId: A.vid, qty: 2 }] }, alice.token);
  ok(r.status === 400, `two lines of qty 2 on a qty-2 item are refused: "${r.body.error}"`);
}

console.log('M4) concurrent refunds never exceed what was paid');
{
  await reset();
  const b = body([{ ...A, qty: 1 }]);
  const c = await post('/api/razorpay-create-order', b, alice.token);
  await payOnline(c.body, b, alice.token);
  // delivered, so the refund is not limited to "part of the order" (that rule has its own test in e2e-orders): this one is about the race
  await post('/api/orders', { action: 'admin_status', orderId: c.body.receipt, status: 'Delivered' }, admin.token);
  const rb = (await rzp()).rzpRefunds.length;
  const res = await Promise.all([1, 2, 3].map(() => post('/api/orders', { action: 'admin_refund', orderId: c.body.receipt, amount: 700, reason: 'race' }, admin.token)));
  const o = (await sql(`select refunded_amount, payment_status from orders where order_id='${c.body.receipt}'`))[0];
  ok(Number(o.refunded_amount) === 1000, `three parallel ₹700 refunds on a ₹1000 order refund exactly ₹1000 (got ${o.refunded_amount})`);
  ok((await rzp()).rzpRefunds.length - rb === 2, `Razorpay was called twice (700 + 300), not three times (${(await rzp()).rzpRefunds.length - rb})`);
  ok(o.payment_status === 'refunded', 'payment_status refunded');
  ok(res.filter(x => x.status === 200).length === 2, 'two of the three requests refunded something');
}

console.log('M5) a coupon that covers only some items refunds only what was paid for them');
{
  await reset();
  await sql(`delete from coupons where code like 'HD%'; insert into coupons (code,type,value,applies_to,product_ids) values ('HDHALF','percent',50,'products','["${A.pid}"]')`);
  const b = body([{ ...A, qty: 1 }, { ...B, qty: 1 }], { couponCode: 'HDHALF' });
  const c = await post('/api/razorpay-create-order', b, alice.token);
  ok(c.body.computedDiscount === 500 && c.body.computedTotal === 1500, 'cart ₹2000, 50% off item A only -> ₹500 off');
  await payOnline(c.body, b, alice.token);
  await post('/api/orders', { action: 'admin_status', orderId: c.body.receipt, status: 'Delivered' }, admin.token);
  const ra = await post('/api/orders', { action: 'return_request', orderId: c.body.receipt, reason: 'x', items: [{ variantId: A.vid, qty: 1 }] }, alice.token);
  ok(Number(ra.body.return.refund_amount) === 500, `returning the discounted item A refunds ₹${ra.body.return.refund_amount} (what was paid: 1000 - 500)`);
  const rb = await post('/api/orders', { action: 'return_request', orderId: c.body.receipt, reason: 'x', items: [{ variantId: B.vid, qty: 1 }] }, alice.token);
  ok(Number(rb.body.return.refund_amount) === 1000, `returning item B refunds its full ₹${rb.body.return.refund_amount}`);
}

console.log('L) smaller hardening');
{
  await reset();
  // city required, so the shipping zone is always a real one
  let r = await post('/api/razorpay-create-order', body([{ ...A, qty: 1 }], { addr: { ...addr, city: '' } }));
  ok(r.status === 400, 'a blank city is refused (shipping zone cannot be guessed)');
  // verify cannot swap in a different (farther) address than the one that was priced
  const b = body([{ ...A, qty: 1 }]);
  const c = await post('/api/razorpay-create-order', b);
  const swapped = { ...b, addr: { ...addr, city: 'Shillong', state: 'Meghalaya', pincode: '793001' } };
  const p = await payOnline(c.body, swapped);
  ok(p.status >= 400 && p.body.verified === false, `verifying with a different address than the priced one is refused: "${p.body.error}"`);
}

process.exit(fail ? 1 : 0);
