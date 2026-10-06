// Upgrade test: ORIGINAL schema + ORIGINAL demo data + one existing order -> apply v2 schema.sql.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
import { execSync } from 'node:child_process';

const read = (p) => fs.readFileSync(p, 'utf8');
const stub = read(new URL('./supabase-stub.sql', import.meta.url));
const oldSchema = execSync('git show HEAD:supabase/schema.sql', { cwd: ROOT, encoding: 'utf8', maxBuffer: 1e8 });
const newSchema = read(path.join(ROOT, 'supabase/schema.sql'));
const oldSeed = execSync('git show HEAD:supabase/demo-seed.sql', { cwd: ROOT, encoding: 'utf8', maxBuffer: 1e8 });

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  FAIL:', m); } else console.log('  ok  :', m); };

const db = new PGlite();
await db.exec(stub);
await db.exec(oldSchema);
await db.exec(oldSeed);
// a customer + an old-format paid order
await db.exec(`insert into auth.users (id,email,email_confirmed_at) values ('11111111-1111-1111-1111-111111111111','buyer@x.test',now())`);
const kurta = (await db.query(`select id from products where name='Cotton Kurta Set'`)).rows[0].id;
await db.query(`insert into orders (order_id, user_id, user_email, items, subtotal, total, status, payment_id)
  values ('BL-9001','11111111-1111-1111-1111-111111111111','buyer@x.test',$1::jsonb,1598,1598,'Paid','pay_old1')`,
  [JSON.stringify([{ id: kurta, name: 'Cotton Kurta Set', qty: 2, price: 799, size: 'S' }])]);
await db.exec(`insert into orders (order_id, user_email, items, total, status) values ('BL-9002','x@x.test','[]'::jsonb, 10, 'Shipped')`);
// legacy edge cases the upgrade must survive: a product the owner HID, and stray bad variant values
await db.exec(`insert into products (product_number, name, cat, price, available, stock) values ('LEG-HIDDEN', 'Hidden Legacy Item', 'Men', 100, false, 5)`);
await db.query(`insert into products (product_number, name, cat, price, available, stock, variants) values ('LEG-ODD', 'Odd Legacy Item', 'Men', 100, true, 0, $1::jsonb)`,
  [JSON.stringify([{ size: 'S', price: 'abc', stock: 'many' }, { size: 'M', price: '250', stock: -3 }, { size: 'L', price: 300, stock: '7' }])]);
await db.exec(`insert into products (product_number, name, cat, price, available, stock) values ('LEG-NEG', 'Negative Stock Item', 'Men', 100, true, -4)`);
const before = (await db.query(`select count(*)::int n from products`)).rows[0].n;
console.log('legacy products:', before);

console.log('applying v2 schema.sql over legacy database...');
try { await db.exec(newSchema); } catch (e) { console.log('APPLY FAILED:', e.message); process.exit(1); }

console.log('checks:');
const q = async (s, p) => (await db.query(s, p)).rows;
ok((await q(`select count(*)::int n from products`))[0].n === before, 'no products lost');
const cats = await q(`select count(*) filter (where parent_id is null)::int groups, count(*) filter (where parent_id is not null)::int leaves from categories`);
ok(cats[0].groups === 5 && cats[0].leaves === 20, `categories seeded (${cats[0].groups} groups, ${cats[0].leaves} subcategories)`);
const unlinked = await q(`select count(*)::int n from products where category_id is null`);
ok(unlinked[0].n === 0, `every demo product linked to a category (unlinked: ${unlinked[0].n})`);
const novar = await q(`select count(*)::int n from products p where not exists (select 1 from product_variants v where v.product_id=p.id)`);
ok(novar[0].n === 0, 'every product has at least one variant');
const kv = await q(`select label, price, stock, track_inventory, options from product_variants where product_id=$1 order by position`, [kurta]);
ok(kv.length === 5 && kv[0].label === 'S' && kv[0].stock === 25 && kv[0].options.Size === 'S', `kurta variants converted: ${kv.map(v => v.label + ':' + v.stock).join(', ')}`);
const kp = (await q(`select price, price_max, mrp, in_stock, has_variants, total_stock, brand, status, available, option_types, attributes, search_text, description is not null as has_desc from products where id=$1`, [kurta]))[0];
ok(Number(kp.price) === 799 && kp.has_variants === true && kp.in_stock === true, `rollup ok: price ${kp.price}..${kp.price_max}, has_variants ${kp.has_variants}, in_stock ${kp.in_stock}, total_stock ${kp.total_stock}`);
ok(kp.brand === 'Kaveri Weaves' && kp.has_desc, `brand/description back-filled (brand=${kp.brand})`);
ok(kp.option_types?.[0]?.name === 'Size' && kp.option_types[0].values.length === 5, 'option_types derived from variants');
ok(kp.attributes.material === '100% cotton', 'material moved into attributes: ' + JSON.stringify(kp.attributes));
ok(kp.search_text.includes('kurta') && kp.search_text.includes('kaveri'), 'search_text maintained: "' + kp.search_text.slice(0, 60) + '"');
const lamp = (await q(`select p.in_stock, p.price, v.track_inventory, v.stock from products p join product_variants v on v.product_id=p.id where p.name='Ceramic Table Lamp'`))[0];
ok(lamp.track_inventory === true && lamp.stock === 41 && Number(lamp.price) === 1299, 'simple product got one Default variant with its stock/price');
const ord = await q(`select order_id, status, payment_status, timeline from orders order by order_id`);
ok(ord[0].status === 'Placed' && ord[0].payment_status === 'paid' && ord[0].timeline.length === 1, "legacy 'Paid' order -> Placed + paid + timeline");
ok(ord[1].status === 'Shipped', "legacy 'Shipped' order untouched");
ok((await q(`select count(*)::int n from schema_migrations`))[0].n === 4, 'migrations recorded');

const hid = (await q(`select status, available from products where product_number='LEG-HIDDEN'`))[0];
ok(hid.status === 'archived' && hid.available === false, 'a product the owner HID stays hidden (status archived), not put on sale: ' + JSON.stringify(hid));
const odd = await q(`select label, price, stock, track_inventory from product_variants where product_id=(select id from products where product_number='LEG-ODD') order by position`);
ok(odd.length === 3 && Number(odd[0].price) === 100 && odd[0].track_inventory === false, 'bad legacy price falls back to the product price, non-numeric stock = untracked: ' + JSON.stringify(odd.map(o => [o.label, o.price, o.stock, o.track_inventory])));
ok(odd[1].stock === 0 && odd[2].stock === 7, 'negative stock is floored to 0, "7" is read as 7');
ok((await q(`select stock from product_variants where product_id=(select id from products where product_number='LEG-NEG')`))[0].stock === 0, 'negative base stock does not abort the upgrade');
// an UPDATE on a hidden product must not flip it back on (the sync trigger used to)
await db.exec(`update products set subtitle = 'touched' where product_number='LEG-HIDDEN'`);
ok((await q(`select available from products where product_number='LEG-HIDDEN'`))[0].available === false, 'editing a hidden product keeps it hidden');
// the previous release wrote status Paid/Pending -- still accepted during the deploy window
await db.exec(`insert into orders (order_id, items, total, status, payment_id) values ('BL-OLD', '[]'::jsonb, 10, 'Paid', 'pay_x')`);
ok((await q(`select status from orders where order_id='BL-OLD'`))[0].status === 'Placed', "old code's status 'Paid' is accepted as Placed");

console.log('re-applying (idempotency)...');
await db.exec(newSchema);

const afterVar = (await q(`select count(*)::int n from product_variants`))[0].n;
await db.exec(newSchema);
ok((await q(`select count(*)::int n from product_variants`))[0].n === afterVar, `variants not duplicated by re-run (${afterVar})`);
ok((await q(`select count(*)::int n from categories`))[0].n === 25, 'categories not duplicated by re-run');
ok((await q(`select status from products where product_number='LEG-HIDDEN'`))[0].status === 'archived', 'hidden product still archived after re-runs');

process.exit(fail ? 1 : 0);
