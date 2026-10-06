// Order lifecycle E2E: status updates, cancel (customer + admin), refunds, restock, returns, authz.
import crypto from 'node:crypto';
const API = process.env.DEVSTACK_API || 'http://localhost:3100';
const SUPA = process.env.DEVSTACK_SUPA || 'http://localhost:54321';
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  FAIL:', m); } else console.log('  ok  :', m); };
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const sql = async (q) => { const r = await fetch(`${SUPA}/__sql`, { method: 'POST', body: q }); const b = await j(r); if (!r.ok) throw new Error(JSON.stringify(b)); return b; };
const post = async (path, body, token) => { const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }); return { status: r.status, body: await j(r) }; };
const signup = async (email, password) => {
  const h = { 'Content-Type': 'application/json', apikey: 'dev-anon-key' };
  let r = await fetch(`${SUPA}/auth/v1/signup`, { method: 'POST', headers: h, body: JSON.stringify({ email, password }) });
  let b = await r.json();
  if (!b.user) { r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, { method: 'POST', headers: h, body: JSON.stringify({ email, password }) }); b = await r.json(); }
  return { token: b.access_token, id: b.user.id };
};
const rzp = async () => (await (await fetch(`${API}/__dev/state`)).json());

await fetch(`${API}/__dev/reset-limits`);
await sql(`delete from orders; delete from pending_orders; delete from used_payments; delete from order_returns; delete from products where product_number like 'LC-%'; delete from coupons where code like 'LC%'; delete from gift_cards where code like 'BL-GC-TEST%' or code like 'BL-GC-CODX%'; delete from auth.users where email like '%@lc.test'`);
const alice = await signup('alice@lc.test', 'pw-alice-1');
const bob = await signup('bob@lc.test', 'pw-bob-1');
const admin = await signup('admin@example.test', 'admin-pass-1');   // REACT_APP_ADMIN_EMAIL of the harness; same password as the --accounts demo admin, so it works with or without them

const cat = (await sql(`select id from categories where name='Men'`))[0].id;
const pid = (await sql(`insert into products (product_number,name,brand,category_id,status,return_window_days) values ('LC-P1','LC Jacket','Acme','${cat}','active',7) returning id`))[0].id;
const vid = (await sql(`insert into product_variants (product_id,label,price,mrp,stock,sku) values ('${pid}','Default',1000,1500,20,'LC-P1-D') returning id`))[0].id;
const gid = (await sql(`insert into products (product_number,name,category_id,status) values ('LC-P2','LC Socks','${cat}','active') returning id`))[0].id;
const gvid = (await sql(`insert into product_variants (product_id,label,price,stock) values ('${gid}','Default',250,20) returning id`))[0].id;
await sql(`update settings set free_shipping_threshold=499, shipping_fee_metro=40, shipping_fee_other=60, cod_enabled=true, cod_fee=0, return_window_days=7 where id='brand'`);
const stock = async (v = vid) => (await sql(`select stock from product_variants where id='${v}'`))[0].stock;

async function place(user, lines, extra = {}) {
  await fetch(`${API}/__dev/reset-limits`);
  const body = {
    items: lines.map(l => ({ id: l.id, variantId: l.variantId, qty: l.qty })), checkoutAttemptKey: crypto.randomUUID(),
    cart: lines.map(l => ({ id: l.id, variantId: l.variantId, name: 'x' })),
    addr: { name: 'A', phone: '9876543210', line1: '1 Road', city: 'Chennai', state: 'Tamil Nadu', pincode: '600001' },
    userName: 'A', userEmail: 'a@lc.test', userPhone: '9876543210', ...extra,
  };
  const c = await post('/api/razorpay-create-order', body, user.token);
  if (c.status !== 200) throw new Error('create failed ' + JSON.stringify(c.body));
  if (c.body.cod) {
    const f = await post('/api/verify-free-order', { receipt: c.body.receipt, blob: c.body.blob, blobSig: c.body.blobSig, cart: body.cart, addr: body.addr, userName: 'A', userEmail: 'a@lc.test', userPhone: '9876543210' }, user.token);
    if (!f.body.verified) throw new Error('cod verify failed ' + JSON.stringify(f.body));
    return c.body.receipt;
  }
  const pay = await (await fetch(`${API}/__dev/pay`, { method: 'POST', body: JSON.stringify({ order_id: c.body.id }) })).json();
  const v = await post('/api/razorpay-verify-payment', { ...pay, blob: c.body.blob, blobSig: c.body.blobSig, cart: body.cart, addr: body.addr, userName: 'A', userEmail: 'a@lc.test', userPhone: '9876543210' }, user.token);
  if (!v.body.verified) throw new Error('verify failed ' + JSON.stringify(v.body));
  return c.body.receipt;
}
const order = async (rn) => (await sql(`select * from orders where order_id='${rn}'`))[0];

console.log('1) admin moves an order along its lifecycle');
{
  const rn = await place(alice, [{ id: pid, variantId: vid, qty: 2 }]);              // 2000, online
  ok(await stock() === 18, 'order placed, stock 20 -> 18');
  let r = await post('/api/orders', { action: 'admin_status', orderId: rn, status: 'Shipped', tracking: { carrier: 'Delhivery', number: 'DL123', url: 'https://t.example/DL123' } });
  ok(r.status === 401, 'status change without a token is refused');
  r = await post('/api/orders', { action: 'admin_status', orderId: rn, status: 'Shipped' }, alice.token);
  ok(r.status === 403, "a customer's token cannot change order status");
  r = await post('/api/orders', { action: 'admin_status', orderId: rn, status: 'Shipped', tracking: { number: 'X1', url: 'javascript:alert(1)' } }, admin.token);
  ok(r.status === 400 && /https/i.test(r.body.error), `a tracking link that is not a web address is refused: "${r.body.error}"`);
  ok((await order(rn)).status === 'Placed' && !(await order(rn)).tracking_url, 'and nothing was saved or moved');
  r = await post('/api/orders', { action: 'admin_status', orderId: rn, status: 'Shipped', tracking: { carrier: 'Delhivery', number: 'DL123', url: 'https://t.example/DL123' } }, admin.token);
  ok(r.status === 200 && r.body.order.status === 'Shipped' && r.body.order.tracking_number === 'DL123', 'admin: Placed -> Shipped (skipping Confirmed/Packed) with tracking');
  let o = await order(rn);
  ok(o.shipped_at && o.timeline.map(t => t.status).join() === 'Placed,Shipped', 'shipped_at stamped, timeline: ' + o.timeline.map(t => t.status).join(' > '));
  r = await post('/api/orders', { action: 'admin_status', orderId: rn, status: 'Packed' }, admin.token);
  ok(r.status === 409, 'cannot move backwards (Shipped -> Packed)');
  r = await post('/api/orders', { action: 'admin_status', orderId: rn, status: 'Out for Delivery' }, admin.token);
  ok(r.status === 200, 'Shipped -> Out for Delivery');
  r = await post('/api/orders', { action: 'admin_status', orderId: rn, status: 'Delivered' }, admin.token);
  ok(r.status === 200 && r.body.order.delivered_at, 'Out for Delivery -> Delivered, delivered_at stamped');
  r = await post('/api/orders', { action: 'admin_status', orderId: rn, status: 'Delivered' }, admin.token);
  ok(r.status === 409, 'Delivered is final: a second Delivered is refused');
  ok(await stock() === 18, 'stock untouched by status changes');
}

console.log('2) customer cancels a Placed online order');
{
  const before = await stock();
  const rn = await place(alice, [{ id: pid, variantId: vid, qty: 3 }]);              // 3000
  ok(await stock() === before - 3, 'stock reserved');
  let r = await post('/api/orders', { action: 'cancel', orderId: rn, reason: 'Ordered by mistake' }, bob.token);
  ok(r.status === 404, "another customer cannot cancel Alice's order (reads as not found)");
  r = await post('/api/orders', { action: 'cancel', orderId: rn, reason: 'Ordered by mistake' });
  ok(r.status === 401, 'cancel without sign-in refused');
  const refundsBefore = (await rzp()).rzpRefunds.length;
  r = await post('/api/orders', { action: 'cancel', orderId: rn, reason: 'Ordered by mistake' }, alice.token);
  ok(r.status === 200 && r.body.order.status === 'Cancelled', 'Alice cancels her own order');
  const o = await order(rn);
  ok(o.cancel_reason === 'Ordered by mistake' && o.cancelled_at && o.timeline.at(-1).status === 'Cancelled', 'reason + cancelled_at + timeline recorded');
  ok(await stock() === before, 'stock restored');
  const st = await rzp();
  ok(st.rzpRefunds.length === refundsBefore + 1 && st.rzpRefunds.at(-1).amount === 300000, `Razorpay refunded the full ₹3000 (${st.rzpRefunds.at(-1)?.amount} paise)`);
  ok(o.payment_status === 'refunded' && Number(o.refunded_amount) === 3000, `payment_status ${o.payment_status}, refunded ₹${o.refunded_amount}`);
  // second cancel (double click / replay)
  r = await post('/api/orders', { action: 'cancel', orderId: rn, reason: 'again' }, alice.token);
  ok(r.status === 409, 'a second cancel is refused');
  ok(await stock() === before && (await rzp()).rzpRefunds.length === refundsBefore + 1, 'no double restock, no double refund');
}

console.log('3) cannot cancel after dispatch (customer) but admin can');
{
  const rn = await place(alice, [{ id: pid, variantId: vid, qty: 1 }]);
  await post('/api/orders', { action: 'admin_status', orderId: rn, status: 'Shipped' }, admin.token);
  let r = await post('/api/orders', { action: 'cancel', orderId: rn }, alice.token);
  ok(r.status === 409 && /dispatched/.test(r.body.error), `customer refused once shipped: "${r.body.error}"`);
  const before = await stock();
  r = await post('/api/orders', { action: 'admin_cancel', orderId: rn, reason: 'Courier lost it' }, admin.token);
  ok(r.status === 200 && r.body.order.status === 'Cancelled', 'admin may cancel a shipped order');
  ok(await stock() === before + 1, 'and its stock is restocked');
}

console.log('4) cancel gives back coupon use and gift card; COD cancel refunds nothing');
{
  await sql(`insert into coupons (code,type,value,applies_to,max_uses) values ('LCSAVE','flat',100,'all',5)`);
  await sql(`insert into gift_cards (code,initial_value,balance) values ('BL-GC-TEST-TEST-TEST',500,500)`);
  const rn = await place(alice, [{ id: pid, variantId: vid, qty: 1 }], { couponCode: 'LCSAVE', giftCardCode: 'BL-GC-TEST-TEST-TEST' });
  let o = await order(rn);
  ok(Number(o.discount) === 100 && Number(o.gift_card_applied) === 500 && Number(o.total) === 400, `1000 - 100 coupon - 500 gift card = ${o.total} charged online`);
  ok((await sql(`select times_used from coupons where code='LCSAVE'`))[0].times_used === 1, 'coupon used once');
  ok((await sql(`select balance from gift_cards where code='BL-GC-TEST-TEST-TEST'`))[0].balance == 0, 'gift card drained');
  const refundsBefore = (await rzp()).rzpRefunds.length;
  const r = await post('/api/orders', { action: 'cancel', orderId: rn, reason: 'x' }, alice.token);
  ok(r.status === 200, 'cancelled');
  ok((await sql(`select times_used from coupons where code='LCSAVE'`))[0].times_used === 0, 'coupon use given back');
  ok((await sql(`select balance from gift_cards where code='BL-GC-TEST-TEST-TEST'`))[0].balance == 500, 'gift card balance restored to 500');
  const st = await rzp();
  ok(st.rzpRefunds.length === refundsBefore + 1 && st.rzpRefunds.at(-1).amount === 40000, `Razorpay refunded only what was charged online: ${st.rzpRefunds.at(-1).amount} paise`);

  // COD order cancelled: nothing was collected, nothing to refund
  const cn = await place(alice, [{ id: gid, variantId: gvid, qty: 1 }], { paymentMethod: 'cod' });
  o = await order(cn);
  ok(o.payment_method === 'cod' && o.payment_status === 'cod_pending', 'COD order placed');
  const rb = (await rzp()).rzpRefunds.length;
  const rc = await post('/api/orders', { action: 'cancel', orderId: cn, reason: 'changed mind' }, alice.token);
  ok(rc.status === 200 && (await rzp()).rzpRefunds.length === rb, 'COD cancel: no gateway refund attempted');
}

console.log('4b) COD order paid partly with a gift card: cancelling returns the gift card');
{
  await sql(`delete from gift_cards where code='BL-GC-CODX-CODX-CODX'; insert into gift_cards (code,initial_value,balance) values ('BL-GC-CODX-CODX-CODX',300,300)`);
  const cn = await place(alice, [{ id: pid, variantId: vid, qty: 1 }], { paymentMethod: 'cod', giftCardCode: 'BL-GC-CODX-CODX-CODX' });
  const o = await order(cn);
  ok(o.payment_method === 'cod' && Number(o.gift_card_applied) === 300 && Number(o.total) === 700, `COD order: ₹1000 - ₹300 gift card = ₹${o.total} to pay on delivery`);
  const rb = (await rzp()).rzpRefunds.length;
  const r = await post('/api/orders', { action: 'cancel', orderId: cn, reason: 'changed mind' }, alice.token);
  ok(r.status === 200, 'cancelled');
  ok((await sql(`select balance from gift_cards where code='BL-GC-CODX-CODX-CODX'`))[0].balance == 300, 'gift card balance restored (₹300)');
  ok((await rzp()).rzpRefunds.length === rb, 'and no gateway refund was attempted');
}

console.log('5) double-click race: two cancels at once');
{
  const before = await stock();
  const rn = await place(alice, [{ id: pid, variantId: vid, qty: 2 }]);
  const rb = (await rzp()).rzpRefunds.length;
  const [a, b] = await Promise.all([post('/api/orders', { action: 'cancel', orderId: rn }, alice.token), post('/api/orders', { action: 'cancel', orderId: rn }, alice.token)]);
  const wins = [a, b].filter(x => x.status === 200).length;
  ok(wins === 1, `exactly one cancel wins (${a.status}/${b.status})`);
  ok(await stock() === before && (await rzp()).rzpRefunds.length === rb + 1, 'stock restored once, refunded once');
}

console.log('6) returns: request -> approve -> refund (partial) -> restock');
{
  const rn = await place(alice, [{ id: pid, variantId: vid, qty: 2 }, { id: gid, variantId: gvid, qty: 2 }]);   // 2000 + 500 = 2500
  let r = await post('/api/orders', { action: 'return_request', orderId: rn, items: [{ variantId: vid, qty: 1 }], reason: 'Size / fit issue' }, alice.token);
  ok(r.status === 409, `cannot return before delivery: "${r.body.error}"`);
  await post('/api/orders', { action: 'admin_status', orderId: rn, status: 'Delivered' }, admin.token);
  r = await post('/api/orders', { action: 'return_request', orderId: rn, items: [{ variantId: vid, qty: 1 }], reason: 'Size / fit issue' }, bob.token);
  ok(r.status === 404, "Bob cannot return Alice's order");
  r = await post('/api/orders', { action: 'return_request', orderId: rn, items: [{ variantId: vid, qty: 5 }], reason: 'x' }, alice.token);
  ok(r.status === 400 && /at most 2/.test(r.body.error), `cannot return more than bought: "${r.body.error}"`);
  r = await post('/api/orders', { action: 'return_request', orderId: rn, items: [{ variantId: vid, qty: 1 }], reason: 'Size / fit issue', details: 'too small' }, alice.token);
  ok(r.status === 200 && r.body.return.status === 'Requested' && Number(r.body.return.refund_amount) === 1000, `return requested; proposed refund ₹${r.body.return.refund_amount}`);
  const rid = r.body.return.id;
  r = await post('/api/orders', { action: 'return_request', orderId: rn, items: [{ variantId: vid, qty: 2 }], reason: 'x' }, alice.token);
  ok(r.status === 400, 'the unit already under a return request cannot be requested twice');
  r = await post('/api/orders', { action: 'return_update', returnId: rid, status: 'Refunded' }, alice.token);
  ok(r.status === 403, 'a customer cannot approve/refund their own return');
  r = await post('/api/orders', { action: 'return_update', returnId: rid, status: 'Refunded' }, admin.token);
  ok(r.status === 409, 'cannot refund a return that was never approved');
  r = await post('/api/orders', { action: 'return_update', returnId: rid, status: 'Approved', adminNote: 'Pickup tomorrow' }, admin.token);
  ok(r.status === 200 && r.body.return.status === 'Approved', 'admin approves');
  const stockBefore = await stock();
  const rb = (await rzp()).rzpRefunds.length;
  r = await post('/api/orders', { action: 'return_update', returnId: rid, status: 'Refunded' }, admin.token);
  ok(r.status === 200 && r.body.return.status === 'Refunded', 'admin refunds the return');
  const st = await rzp();
  ok(st.rzpRefunds.length === rb + 1 && st.rzpRefunds.at(-1).amount === 100000, `Razorpay refunded just that line: ${st.rzpRefunds.at(-1).amount} paise`);
  ok(await stock() === stockBefore + 1, 'returned unit restocked');
  const o = await order(rn);
  ok(o.payment_status === 'partially_refunded' && Number(o.refunded_amount) === 1000 && o.status === 'Delivered', `order: ${o.payment_status}, refunded ₹${o.refunded_amount}, still ${o.status}`);
  const refundsAfter = (await rzp()).rzpRefunds.length;
  r = await post('/api/orders', { action: 'return_update', returnId: rid, status: 'Refunded' }, admin.token);
  ok((await rzp()).rzpRefunds.length === refundsAfter && Number((await order(rn)).refunded_amount) === 1000, 're-sending Refunded never refunds twice');
  // reject path
  r = await post('/api/orders', { action: 'return_request', orderId: rn, items: [{ variantId: gvid, qty: 1 }], reason: 'No longer needed' }, alice.token);
  const rid2 = r.body.return.id;
  r = await post('/api/orders', { action: 'return_update', returnId: rid2, status: 'Rejected', adminNote: 'Used item' }, admin.token);
  ok(r.status === 200 && r.body.return.status === 'Rejected' && r.body.return.resolved_at, 'admin rejects a return');
  r = await post('/api/orders', { action: 'return_request', orderId: rn, items: [{ variantId: gvid, qty: 2 }], reason: 'x' }, alice.token);
  ok(r.status === 200, 'after a rejection the units can be requested again');
}

console.log('7) admin goodwill refund is capped at what was charged');
{
  const rn = await place(alice, [{ id: pid, variantId: vid, qty: 1 }]);
  let r = await post('/api/orders', { action: 'admin_refund', orderId: rn, amount: 400, reason: 'late delivery' }, admin.token);
  ok(r.status === 200 && r.body.refund.amount === 400, 'partial goodwill refund ₹400 while the order is still going out');
  // not delivered yet: taking back the WHOLE order is a cancellation (stock back, coupon released), never a bare refund
  r = await post('/api/orders', { action: 'admin_refund', orderId: rn, amount: 9999, reason: 'oops' }, admin.token);
  ok(r.status === 409 && /cancel the order instead/i.test(r.body.error), `before delivery the whole order cannot be refunded without cancelling: "${r.body.error}"`);
  ok(Number((await order(rn)).refunded_amount) === 400, 'and nothing more was refunded');
  await post('/api/orders', { action: 'admin_status', orderId: rn, status: 'Delivered' }, admin.token);
  r = await post('/api/orders', { action: 'admin_refund', orderId: rn, amount: 9999, reason: 'oops' }, admin.token);
  const o = await order(rn);
  ok(Number(o.refunded_amount) === 1000 && o.payment_status === 'refunded', `after delivery a second refund is capped at the remaining ₹600 -> total ₹${o.refunded_amount}, ${o.payment_status}`);
  r = await post('/api/orders', { action: 'admin_refund', orderId: rn, amount: 50 }, admin.token);
  ok(r.status === 400, 'nothing left to refund -> refused');
  // cash on delivery, nothing collected yet: no refund can be recorded (the screen greys the button, the server refuses too)
  const cn = await place(alice, [{ id: gid, variantId: gvid, qty: 1 }], { paymentMethod: 'cod' });
  r = await post('/api/orders', { action: 'admin_refund', orderId: cn, amount: 50 }, admin.token);
  ok(r.status === 400 && /no money has been collected/i.test(r.body.error), `a COD order that has not been paid cannot be refunded: "${r.body.error}"`);
  ok((await order(cn)).payment_status === 'cod_pending' && Number((await order(cn)).refunded_amount) === 0, 'and its books are untouched');
}

console.log('8) notifications fire from the lifecycle (default templates)');
{
  const emails = (await sql(`select event_type, status, recipient_email from email_sends order by created_at`));
  const types = [...new Set(emails.map(e => e.event_type))];
  ok(types.includes('ORDER_SHIPPED') && types.includes('ORDER_DELIVERED') && types.includes('ORDER_CANCELLED') && types.includes('REFUND_PROCESSED') && types.includes('RETURN_REQUESTED') && types.includes('RETURN_APPROVED') && types.includes('RETURN_REJECTED'),
    'email_sends has rows for: ' + types.join(', '));
  ok(emails.every(e => e.status === 'sent'), 'all logged as sent (fake Brevo)');
}

process.exit(fail ? 1 : 0);
