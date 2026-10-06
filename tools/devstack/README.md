# devstack — run and test the whole store locally, with no real accounts

A self-contained stand-in for Supabase, Razorpay, Brevo and WhatsApp, so the real storefront, the real
`api/*.js` functions and the real database logic can be run and tested end to end on a laptop.
**Dev tooling only** — nothing here is part of the website or the deployment, and it never talks to a real
Supabase / Razorpay / Brevo / WhatsApp account.

| Piece | What it is |
|---|---|
| Database | Real PostgreSQL (PGlite, a WASM build), loaded with `supabase/schema.sql` — the same file you run in Supabase. Row-level security, triggers and functions are the real thing. |
| "Supabase" API | `server.mjs` — a PostgREST/auth/storage-compatible HTTP layer on `:54321` over that database. |
| Serverless functions | The project's own `api/*.js`, hosted on `:3100` (the storefront reaches them at `/api/*` through `src/setupProxy.js`). |
| Razorpay | Faked: creates orders, "captures" payments (`/__dev/pay`), refunds and verifies signatures with a dev secret. Brevo and the WhatsApp edge function are stubs that log. |

## One-time setup

```bash
cd tools/devstack
npm install          # installs PGlite for this folder only
```

## Run the store

```bash
node tools/devstack/run.mjs        # from the project root
```

Open **http://localhost:3002**. The database is **in memory**: it is rebuilt from `schema.sql` + the demo catalogue
(`supabase/demo-seed.sql`) every start, so you can't break anything.

| Account | Login |
|---|---|
| Store admin (`/admin/login`) | `admin@example.test` / `admin-pass-1` |
| Customer | `shopper@example.test` / `shopper-pass-1` (has five demo orders: delivered, shipped, placed, cancelled, COD) |

Also seeded: coupons `WELCOME10` and `FLAT100`. Online payment cannot be completed in the browser (the real Razorpay
widget is not served); **Cash on Delivery** (switch it on in Admin → Settings → Payments) and zero-total orders can.

Ports can be changed: `node server.mjs --port 55321 --api-port 3200 --sql ../../supabase/schema.sql` runs a second,
isolated backend (handy for tests while the dev store is open).

## Tests

All of these run against the **real** schema and the **real** `api/*.js`:

```bash
cd tools/devstack
npm run test:db      # schema upgrade of an old database, stock/RLS/RPC checks, demo seed   (no server needed)

# the end-to-end suites need a backend running first:
node server.mjs --port 55321 --api-port 3200 --sql ../../supabase/schema.sql &
DEVSTACK_API=http://localhost:3200 DEVSTACK_SUPA=http://localhost:55321 npm run test:e2e
```

| Suite | Covers |
|---|---|
| `test-migration.mjs` | The old (pre-redesign) schema + data is upgraded: variants, categories, statuses, hidden products stay hidden, odd legacy values, safe to re-run. |
| `test-rpc.mjs` | Stock reservation/release/restock, rollups, SKU rules, row-level security, admin-only functions, reports. |
| `test-seed.mjs` | The demo catalogue loads (twice) and its rollups are right. |
| `e2e-checkout.mjs` | Variant pricing, shipping zones, GST, coupon rules, COD, free orders, webhook recovery, the last-unit race, tampering. |
| `e2e-orders.mjs` | Status lifecycle, customer/admin cancel, refunds, restock, coupon/gift-card release, returns, authorization. |
| `e2e-hardening.mjs` | One reproduction per issue found in an independent security review (double-spend, leaked holds, refund races …). |
| `e2e-notify.mjs` | The merged `api/notify.js`: routing, admin gate, email/WhatsApp sends. |

The rate limiter in the real code (20 checkouts / 10 min / IP) would trip a test run, so the harness exposes
`GET /__dev/reset-limits`; the suites call it.

## Limits to remember

* No embedded selects (`select('*, other_table(*)')`) and no realtime.
* The database is not persisted. Restarting resets data and sign-ins.
* It proves the logic, not Razorpay's real behaviour — do one real test-mode payment before going live.
