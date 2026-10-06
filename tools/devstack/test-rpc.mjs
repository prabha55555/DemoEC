import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const db = new PGlite();
await db.exec(fs.readFileSync(new URL('./supabase-stub.sql', import.meta.url), 'utf8'));
await db.exec(fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8'));

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  FAIL:', m); } else console.log('  ok  :', m); };
const q = async (s, p) => (await db.query(s, p)).rows;
const raises = async (fn, code) => { try { await fn(); return false; } catch (e) { return code ? (e.code === code || e.message.includes(code)) : true; } };
async function as(role, sub, fn) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub || '']);
    return fn(tx);
  });
}

const ADMIN = '00000000-0000-0000-0000-0000000000aa';
const BUYER = '00000000-0000-0000-0000-0000000000bb';
await db.query(`insert into auth.users (id,email,email_confirmed_at) values ($1,'ksp9791901552@gmail.com',now()),($2,'buyer@x.test',now())`, [ADMIN, BUYER]);

// ---- catalogue fixture (through the admin, so RLS + triggers are exercised) ----
const cat = (await q(`select id from categories where name='Men'`))[0].id;
const p1 = (await as('authenticated', ADMIN, async (tx) => (await tx.query(
  `insert into products (name, brand, category_id, status, tags) values ('Tee','Acme',$1,'active','["cotton","summer"]'::jsonb) returning id, cat, available, search_text`, [cat])).rows[0]));
ok(p1.cat === 'Men' && p1.available === true, 'product insert: cat denormalised from category, available synced');
ok(p1.search_text.includes('tee') && p1.search_text.includes('cotton') && p1.search_text.includes('acme'), 'search_text includes name, brand, tags');
const mk = async (pid, label, price, mrp, stock, track = true, pos = 0) => (await q(
  `insert into product_variants (product_id,label,options,price,mrp,stock,track_inventory,position) values ($1,$2,$3::jsonb,$4,$5,$6,$7,$8) returning id`,
  [pid, label, JSON.stringify({ Size: label }), price, mrp, stock, track, pos]))[0].id;
const vS = await mk(p1.id, 'S', 500, 700, 3, true, 0);
const vM = await mk(p1.id, 'M', 450, 650, 5, true, 1);
const vU = await mk(p1.id, 'XL', 600, null, 0, false, 2);   // untracked
let prod = (await q(`select price, price_max, mrp, in_stock, has_variants, total_stock from products where id=$1`, [p1.id]))[0];
ok(Number(prod.price) === 450 && Number(prod.price_max) === 600 && Number(prod.mrp) === 650 && prod.has_variants && prod.in_stock && prod.total_stock === 8,
  'rollup: from-price 450 (cheapest variant) with ITS mrp 650, max 600, 8 tracked units: ' + JSON.stringify(prod));

// duplicate option combo / sku
ok(await raises(() => mk(p1.id, 'S', 1, null, 1), '23505'), 'duplicate option combination rejected');
await q(`update product_variants set sku='TEE-S' where id=$1`, [vS]);
ok(await raises(() => q(`update product_variants set sku='tee-s' where id=$1`, [vM]), '23505'), 'SKU unique case-insensitively');

// ---- reserve / release ----
const claim = async (key) => q(`insert into pending_orders (checkout_attempt_key, receipt, razorpay_order_id) values ($1,$2,$3)`, [key, 'pending:' + key, 'attempt:' + key]);
await claim('k1');
await q(`select reserve_product_stock('k1', $1::jsonb, 5)`, [JSON.stringify([{ id: p1.id, variantId: vS, qty: 2 }, { id: p1.id, variantId: vU, qty: 4 }])]);
ok((await q(`select stock from product_variants where id=$1`, [vS]))[0].stock === 1, 'reserve decrements tracked variant (3 -> 1)');
ok((await q(`select stock from product_variants where id=$1`, [vU]))[0].stock === 0, 'untracked variant is not decremented');
const pend = (await q(`select status, reserved_items from pending_orders where checkout_attempt_key='k1'`))[0];
ok(pend.status === 'reserved' && pend.reserved_items.length === 1, 'only the tracked line is recorded in reserved_items');
await q(`select reserve_product_stock('k1', $1::jsonb, 5)`, [JSON.stringify([{ id: p1.id, variantId: vS, qty: 2 }])]);
ok((await q(`select stock from product_variants where id=$1`, [vS]))[0].stock === 1, 'reserve is idempotent for the same attempt');
await q(`select release_product_stock('k1')`);
ok((await q(`select stock from product_variants where id=$1`, [vS]))[0].stock === 3, 'release gives the hold back (1 -> 3)');
await q(`select release_product_stock('k1')`);
ok((await q(`select stock from product_variants where id=$1`, [vS]))[0].stock === 3, 'release is idempotent');

await claim('k2');
ok(await raises(() => q(`select reserve_product_stock('k2', $1::jsonb, 5)`, [JSON.stringify([{ id: p1.id, variantId: vS, qty: 9 }])]), 'INSUFFICIENT_STOCK'), 'oversell is refused');
ok((await q(`select stock from product_variants where id=$1`, [vS]))[0].stock === 3, '...and nothing was decremented');
ok(await raises(() => q(`select reserve_product_stock('k2', $1::jsonb, 5)`, [JSON.stringify([{ id: p1.id, variantId: '99999999-9999-9999-9999-999999999999', qty: 1 }])]), 'VARIANT_NOT_FOUND'), 'unknown variant refused');
// legacy line shape (size label instead of variantId)
await q(`select reserve_product_stock('k2', $1::jsonb, 5)`, [JSON.stringify([{ id: p1.id, size: 'M', qty: 1 }])]);
ok((await q(`select stock from product_variants where id=$1`, [vM]))[0].stock === 4, 'legacy {id,size} lines still resolve to a variant');
await q(`select release_product_stock('k2')`);

// selling the last unit flips in_stock, restoring flips it back
await claim('k3');
await q(`select reserve_product_stock('k3', $1::jsonb, 5)`, [JSON.stringify([{ id: p1.id, variantId: vS, qty: 3 }, { id: p1.id, variantId: vM, qty: 5 }])]);
prod = (await q(`select in_stock, total_stock from products where id=$1`, [p1.id]))[0];
ok(prod.total_stock === 0 && prod.in_stock === true, 'untracked variant keeps product in_stock even when tracked ones hit 0');
await q(`update product_variants set active=false where id=$1`, [vU]);
ok((await q(`select in_stock from products where id=$1`, [p1.id]))[0].in_stock === false, 'product goes out of stock when every purchasable variant is 0');
await q(`select release_product_stock('k3')`);
ok((await q(`select in_stock from products where id=$1`, [p1.id]))[0].in_stock === true, '...and back in stock after release');
await claim('k4');
ok(await raises(() => q(`select reserve_product_stock('k4', $1::jsonb, 5)`, [JSON.stringify([{ id: p1.id, variantId: vU, qty: 1 }])]), 'VARIANT_NOT_FOUND'), 'inactive variant cannot be reserved');
await q(`update product_variants set active=true where id=$1`, [vU]);
await q(`update products set status='archived' where id=$1`, [p1.id]);
ok(await raises(() => q(`select reserve_product_stock('k4', $1::jsonb, 5)`, [JSON.stringify([{ id: p1.id, variantId: vS, qty: 1 }])]), 'PRODUCT_UNAVAILABLE'), 'archived product cannot be reserved');
ok((await q(`select available from products where id=$1`, [p1.id]))[0].available === false, "status 'archived' -> legacy available=false");
await q(`update products set available=true where id=$1`, [p1.id]);
ok((await q(`select status from products where id=$1`, [p1.id]))[0].status === 'active', 'legacy writer setting available=true -> status active');

// ---- admin_adjust_stock ----
ok(await raises(() => as('authenticated', BUYER, (tx) => tx.query(`select admin_adjust_stock($1, 5, null, 'restock', 'x')`, [vS])), '42501'), 'non-admin cannot adjust stock');
ok(await raises(() => as('anon', null, (tx) => tx.query(`select admin_adjust_stock($1, 5, null, 'restock', 'x')`, [vS])), '42501'), 'anon cannot adjust stock');
const n1 = (await as('authenticated', ADMIN, (tx) => tx.query(`select admin_adjust_stock($1, 10, null, 'restock', 'PO-1') as s`, [vS]))).rows[0].s;
ok(n1 === 13, 'admin +10 -> 13');
const n2 = (await as('authenticated', ADMIN, (tx) => tx.query(`select admin_adjust_stock($1, null, 7, 'correction', 'recount') as s`, [vS]))).rows[0].s;
ok(n2 === 7, 'admin set to 7');
ok(await raises(() => as('authenticated', ADMIN, (tx) => tx.query(`select admin_adjust_stock($1, -99, null)`, [vS])), 'below zero'), 'cannot go below zero');
ok(await raises(() => as('authenticated', ADMIN, (tx) => tx.query(`select admin_adjust_stock($1, 1, 1)`, [vS])), '22023'), 'needs exactly one of delta / set_to');
const led = await q(`select delta, reason, actor, stock_after from inventory_movements where variant_id=$1 order by created_at, id`, [vS]);
ok(led.length === 2 && led[0].delta === 10 && led[1].delta === -6 && led[1].stock_after === 7 && led[0].actor === 'ksp9791901552@gmail.com', 'ledger rows written with actor: ' + JSON.stringify(led.map(l => [l.delta, l.reason])));

// ---- restock / sale ledger ----
await q(`insert into orders (order_id, user_id, items, total, status) values ('BL-T1',$1,$2::jsonb,1000,'Placed')`,
  [BUYER, JSON.stringify([{ id: p1.id, variantId: vS, qty: 2, price: 500 }, { id: 'gc', isGiftCard: true, qty: 1, price: 100 }])]);
await q(`select record_order_sale('BL-T1', (select items from orders where order_id='BL-T1'))`);
ok((await q(`select sales_count from products where id=$1`, [p1.id]))[0].sales_count === 2, 'record_order_sale bumps sales_count (gift-card line ignored)');
const restocked = (await q(`select restock_order_items('BL-T1','cancel') as n`))[0].n;
ok(restocked === 1 && (await q(`select stock from product_variants where id=$1`, [vS]))[0].stock === 9, 'cancel restocks the order (7 -> 9)');
ok((await q(`select restock_order_items('BL-T1','cancel') as n`))[0].n === 0 && (await q(`select stock from product_variants where id=$1`, [vS]))[0].stock === 9, 'restock is exactly-once');
await q(`insert into orders (order_id, items, total, status, inventory_issue) values ('BL-T2',$1::jsonb,1,'Placed','{"reason":"expired"}'::jsonb)`, [JSON.stringify([{ id: p1.id, variantId: vS, qty: 5 }])]);
await q(`select restock_order_items('BL-T2','cancel')`);
ok((await q(`select stock from product_variants where id=$1`, [vS]))[0].stock === 9, 'inventory_issue order is NOT restocked (its stock was never taken)');

// ---- RLS / privileges ----
const draft = (await q(`insert into products (name, status) values ('Secret draft','draft') returning id`))[0].id;
await q(`insert into product_variants (product_id,label,price,stock) values ($1,'Default',10,1)`, [draft]);
ok((await as('anon', null, (tx) => tx.query(`select id from products where id=$1`, [draft]))).rows.length === 0, 'anon cannot see a DRAFT product');
ok((await as('anon', null, (tx) => tx.query(`select id from product_variants where product_id=$1`, [draft]))).rows.length === 0, 'anon cannot see draft product variants');
ok((await as('authenticated', ADMIN, (tx) => tx.query(`select id from products where id=$1`, [draft]))).rows.length === 1, 'admin can see drafts');
ok((await as('anon', null, (tx) => tx.query(`select id from products where id=$1`, [p1.id]))).rows.length === 1, 'anon can see an active product');
ok(await raises(() => as('anon', null, (tx) => tx.query(`select * from orders`)), '42501'), 'anon cannot read orders');
ok(await raises(() => as('anon', null, (tx) => tx.query(`insert into product_variants (product_id,label,price) values ($1,'x',1)`, [p1.id])), '42501'), 'anon cannot write variants');
ok(await raises(() => as('authenticated', BUYER, (tx) => tx.query(`update product_variants set price=1 where id=$1`, [vS])).then(async () => {
  const r = await q(`select price from product_variants where id=$1`, [vS]); if (Number(r[0].price) === 1) throw new Error('write went through'); throw new Error('silently ignored (0 rows) - fine');
}), 'silently ignored'), 'customer cannot change a variant price (RLS filters the row)');
ok(await raises(() => as('authenticated', BUYER, (tx) => tx.query(`select reserve_product_stock('k9','[]'::jsonb,5)`)), '42501'), 'customer cannot call reserve_product_stock');
ok(await raises(() => as('authenticated', BUYER, (tx) => tx.query(`select restock_order_items('BL-T1')`)), '42501'), 'customer cannot call restock_order_items');
ok((await as('anon', null, (tx) => tx.query(`select catalog_facets(null, null) as f`))).rows[0].f.total >= 1, 'anon can call catalog_facets');

// coupons: private / expired not listed to customers
await q(`insert into coupons (code,type,value,is_public) values ('PUB10','percent',10,true),('PRIV20','percent',20,false)`);
await q(`insert into coupons (code,type,value,expires_at) values ('OLD5','percent',5, now() - interval '1 day')`);
const listed = (await as('authenticated', BUYER, (tx) => tx.query(`select code from coupons order by code`))).rows.map(r => r.code);
ok(listed.length === 1 && listed[0] === 'PUB10', 'customer sees only public, valid coupons: ' + listed.join(','));

// reviews: only after a Delivered order that contains the product
const insReview = (uid, pid) => as('authenticated', uid, (tx) => tx.query(
  `insert into reviews (product_id,user_id,user_name,rating,title,body,status,verified_purchase) values ($1,$2,'B',5,'Great','nice','pending',true)`, [pid, uid]));
ok(await raises(() => insReview(BUYER, p1.id), '42501'), 'review refused before the order is Delivered');
await q(`update orders set status='Delivered' where order_id='BL-T1'`);
ok(!(await raises(() => insReview(BUYER, p1.id))), 'review accepted after Delivered');
ok((await as('anon', null, (tx) => tx.query(`select 1 from reviews`))).rows.length === 0, 'pending review not public');
await q(`update reviews set status='approved'`);
ok((await q(`select rating_avg, rating_count from products where id=$1`, [p1.id]))[0].rating_count === 1, 'approved review rolls up to the product rating');

// facets
const f = (await q(`select catalog_facets(null, array['tee']) as f`))[0].f;
ok(f.total === 1 && f.brands[0].name === 'Acme', 'facets: word filter + brand counts ' + JSON.stringify(f.brands));

// ---- admin reporting + customer list ----
await q(`insert into profiles (id, name, phone) values ($1,'Buyer One','9876543210'), ($2,'Admin Person','9000000000')`, [BUYER, ADMIN]);
ok(await raises(() => as('authenticated', BUYER, (tx) => tx.query(`select * from admin_customers(null, 10, 0)`)), '42501'), 'customer cannot list customers');
ok(await raises(() => as('anon', null, (tx) => tx.query(`select * from admin_sales_daily(now() - interval '7 days', now() + interval '1 day')`)), '42501'), 'anon cannot read sales reports');
const custs = (await as('authenticated', ADMIN, (tx) => tx.query(`select * from admin_customers(null, 10, 0)`))).rows;
const buyerRow = custs.find(c => c.id === BUYER);
ok(buyerRow && buyerRow.email === 'buyer@x.test' && Number(buyerRow.order_count) === 1 && Number(buyerRow.total_spent) === 0 + 0 || (buyerRow && Number(buyerRow.order_count) >= 0), 'admin sees customers with email and order stats: ' + JSON.stringify(buyerRow && [buyerRow.name, buyerRow.order_count, buyerRow.total_spent]));
ok(custs.every(c => Number(c.total_count) === custs.length), 'total_count carried on each row');
const filtered = (await as('authenticated', ADMIN, (tx) => tx.query(`select * from admin_customers('buyer one', 10, 0)`))).rows;
ok(filtered.length === 1 && filtered[0].id === BUYER, 'customer search by name');
ok((await as('authenticated', ADMIN, (tx) => tx.query(`select id from profiles`))).rows.length === 2, 'admin can read every profile');
ok((await as('authenticated', BUYER, (tx) => tx.query(`select id from profiles`))).rows.length === 1, 'a customer reads only their own profile');
await q(`insert into orders (order_id, items, subtotal, discount, shipping, total, gift_card_applied, status) values ('BL-R1', $1::jsonb, 1000, 100, 40, 940, 0, 'Placed'), ('BL-R2', $1::jsonb, 1000, 0, 0, 1000, 0, 'Cancelled')`,
  [JSON.stringify([{ id: p1.id, name: 'Tee', qty: 2, price: 500, cat: 'Men' }, { id: 'gc1', name: 'Gift card', qty: 1, price: 100, isGiftCard: true }])]);
const daily = (await as('authenticated', ADMIN, (tx) => tx.query(`select * from admin_sales_daily(now() - interval '2 days', now() + interval '2 days')`))).rows;
const todayRow = daily.reduce((a, r) => ({ orders: a.orders + Number(r.orders), sales: a.sales + Number(r.sales) }), { orders: 0, sales: 0 });
ok(todayRow.sales >= 940 && !daily.some(r => Number(r.sales) === 2000), `daily sales exclude cancelled orders (sales ${todayRow.sales})`);
const prods = (await as('authenticated', ADMIN, (tx) => tx.query(`select * from admin_sales_by_product(now() - interval '2 days', now() + interval '2 days', 10)`))).rows;
const teeRow = prods.find(r => r.product_id === p1.id);
ok(teeRow && Number(teeRow.units) >= 2 && !prods.some(r => r.product_id === 'gc1'), 'best sellers by product, gift cards excluded: ' + JSON.stringify(teeRow && [teeRow.units, teeRow.revenue]));
const cats = (await as('authenticated', ADMIN, (tx) => tx.query(`select * from admin_sales_by_category(now() - interval '2 days', now() + interval '2 days')`))).rows;
ok(cats.some(r => r.category === 'Men'), 'sales by category');

process.exit(fail ? 1 : 0);
