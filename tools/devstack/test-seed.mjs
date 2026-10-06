import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const db = new PGlite();
await db.exec(fs.readFileSync(new URL('./supabase-stub.sql', import.meta.url), 'utf8'));
await db.exec(fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(ROOT, 'supabase/demo-seed.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(ROOT, 'supabase/demo-seed.sql'), 'utf8')); // idempotent
const one = async (s) => (await db.query(s)).rows;
console.log('products', (await one(`select count(*)::int n from products where product_number like 'DEMO-%'`))[0].n);
console.log('variants', (await one(`select count(*)::int n from product_variants`))[0].n);
console.log('uncategorised', (await one(`select count(*)::int n from products where category_id is null`))[0].n);
console.log(JSON.stringify(await one(`select name, price, price_max, mrp, discount_pct, in_stock, has_variants, total_stock, rating_avg from products where product_number in ('DEMO-001','DEMO-010','DEMO-012','DEMO-015','DEMO-004') order by product_number`)));
