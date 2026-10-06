# Brightlight Solutions — Online Store

A general-purpose online store with the structure of Amazon / Flipkart / Meesho: many product categories,
size/colour variants, MRP and discounts, reviews, a Flipkart-style cart and checkout, online payment
(Razorpay) **and** optional Cash on Delivery, a full order lifecycle (track, cancel, return, refund), GST
invoices, and a complete admin panel.

Built with React, Supabase (Postgres + Auth + Storage), Razorpay and Brevo, deployed on Vercel.

> **Read first:** [`docs/ECOMMERCE_REDESIGN.md`](docs/ECOMMERCE_REDESIGN.md) explains why the store works the
> way it does — what was wrong with the original pottery-shop model, what was kept, and the rules the code follows.

---

## What the store does

**Customers**
- Browse by category and sub-category; filter by price, brand, rating, discount, availability and
  category-specific attributes; sort; search across names, brands and categories.
- Product page with size/colour selectors (sold-out options struck through), MRP / % off / "you save", delivery
  estimate by PIN code, return policy, specifications, highlights, reviews, related and recently viewed products.
- Wishlist (saved to the account), cart with live price/stock checks, free-delivery progress, coupons and gift cards.
- Checkout as guest or signed-in customer: saved addresses, **pay online** (UPI / cards / net banking via Razorpay)
  or **Cash on Delivery** (if enabled).
- My Orders: tracker with timestamps, tracking links, cancel before dispatch, return/replace after delivery,
  refund status, GST **invoice** (print / PDF), buy again.

**Store owner (admin panel at `/admin`)**
- Dashboard (revenue, orders awaiting action, returns to review, low stock …).
- Products (variants, MRP, attributes, SEO, CSV import/export), Categories & attribute schemas, Inventory with a stock ledger.
- Orders (status actions with automatic customer notifications, tracking, cancel, refund, notes, packing slip),
  Returns, Customers, Reviews moderation, Coupons (min order, caps, dates, categories, first-order-only …), Gift cards.
- Reports (sales, products, categories, coupons, payments, GST summary).
- Banners, blog, email / WhatsApp message templates, and Store settings: shipping fees and free-delivery threshold,
  Cash on Delivery, GST and seller details, return window, low-stock level.

---

## How it fits together

```
Browser (React)  ──►  Supabase (Postgres, Auth, Storage)   products, variants, categories, orders …
      │                      ▲   row-level security: customers see only their own data
      ▼                      │
Vercel functions (api/)  ────┘   the ONLY code that charges money, writes orders, refunds, sends messages
      │
      ├─ Razorpay   (create order, verify payment, webhook recovery, refunds)
      ├─ Brevo      (transactional email)         ├─ WhatsApp (Supabase edge function)     └─ MSG91 (mobile OTP login)
```

Prices, shipping, GST, coupons and stock are **always re-computed on the server** from the database; the browser
only shows a preview. Pure rules shared by browser and server live in `src/utils/` (`catalog`, `pricing`, `shipping`,
`tax`, `orderStatus`).

---

## Setup (new project)

> **Use fresh credentials.** This codebase was originally built for a different company. Create a **new** Supabase
> project, a **new** Razorpay account, a **new** Brevo account, and (if used) a new MSG91 widget. Never reuse the
> previous company's keys, project URL, service-role key, webhook secret or database.

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com). Under **Project Settings → API** copy the URL, the anon key and the service-role key.
2. **SQL Editor → New query**: open [`supabase/schema.sql`](supabase/schema.sql), change the admin e-mail in **SECTION 1**
   (search for `CHANGE THIS`; it must equal `REACT_APP_ADMIN_EMAIL`), paste the whole file and **Run**.
   It creates every table, function, security policy and the `images` / `videos` storage buckets. It is safe to run again.
3. Optional demo catalogue: run [`supabase/demo-seed.sql`](supabase/demo-seed.sql) (38 products; remove later with
   `delete from products where product_number like 'DEMO-%'` and delete `public/demo`).
4. **Authentication**: enable Email/Password (and Google if wanted). Keep **Confirm email** ON and create the admin
   account yourself first — the admin is whoever owns the confirmed address listed in `app_admins`.
   Under **URL Configuration** add your site to **Redirect URLs** with a wildcard, e.g. `https://your-domain/**` and
   `http://localhost:3000/**` — Google sign-in returns to the site root and password-reset links to `/reset-password`,
   so the trailing `/**` matters. For Google sign-in also add `https://<project-ref>.supabase.co/auth/v1/callback`
   as an *Authorised redirect URI* (and your site addresses as *Authorised JavaScript origins*) in Google Cloud Console.
5. Image thumbnails use Supabase **Image Transformations** (a paid-plan feature); without it, product thumbnails will not load.
6. WhatsApp messages are sent through a Supabase **Edge Function** named `send-whatsapp` (not part of this repository).

### 2. Environment variables

Copy `.env.example` to `.env` and fill it in. Variables without the `REACT_APP_` prefix are **server-only** — set them
in Vercel → Project → Settings → Environment Variables (a local `.env` is never deployed).

| Variable | Used by | Purpose |
|---|---|---|
| `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY` | browser + `api/` | Supabase project URL and anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | `api/` only | Privileged server access — never expose |
| `REACT_APP_ADMIN_EMAIL` | browser + `api/` | The only account allowed into `/admin` (must match the SQL admin e-mail) |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | `api/` only | Razorpay API keys |
| `RAZORPAY_WEBHOOK_SECRET` | `api/razorpay-webhook` | Secret chosen when creating the webhook |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `BREVO_SUPPORT_EMAIL` | `api/` | Transactional e-mail |
| `REACT_APP_MSG91_WIDGET_ID`, `REACT_APP_MSG91_WIDGET_TOKEN`, `MSG91_AUTH_KEY`, `PHONE_LOGIN_EMAIL_DOMAIN` | optional | Mobile-number OTP login |

### 3. Razorpay

Keys: Dashboard → Settings → API Keys (test keys work immediately; live keys need KYC). Create a webhook pointing to
`https://<your-domain>/api/razorpay-webhook` for the **`payment.captured`** event — it is the safety net that still
creates an order if a customer pays but closes the tab.

### 4. Run it

```bash
npm install
npm start          # http://localhost:3000
```

### 5. Deploy to Vercel

Framework: Create React App · build `npm run build` · output `build`. Add the environment variables, and set
the production domain in Supabase URL Configuration and the Razorpay webhook.

**Order matters when upgrading a live store: run `supabase/schema.sql` first, then deploy the code.**
The Vercel **Hobby** plan allows at most 12 serverless functions; `api/` uses 11 (notification sends are one function,
`api/notify.js`; order changes are one function, `api/orders.js`). Adding more files means moving to a paid plan or merging.

---

## Upgrading the old pottery-era store

**Take a backup first** (Supabase → Database → Backups, or a manual `pg_dump`). Then run the new `supabase/schema.sql`
once in the SQL editor, and deploy. It is **additive** — nothing is dropped — and
converts what exists, once (recorded in `schema_migrations`):

| Before | After |
|---|---|
| Product `variants` JSON with a `size` | `product_variants` rows (stock kept), option "Size" |
| Category list in Brand Settings | `categories` table; products linked by category name |
| `origin` / `story` / `material` / `dimensions` / `weight` | `brand` / `description` / specification attributes |
| Products hidden with `available = false` | status **Archived** (they stay hidden) |
| Order status `Paid` / `Pending` | **Placed** with `payment_status = paid` |
| No e-mail until a template was hand-built | default templates for every order event (only where none exist) |

The old product columns remain in the table but are no longer read. Carts saved in a customer's browser are upgraded
automatically on their next visit.

---

## First-time store checklist (admin)

1. **Store settings** → Shipping & delivery (free-delivery threshold, fees), Payments (Cash on Delivery on/off),
   Tax & invoice (seller name, GSTIN, state, default GST rate), Returns & stock.
2. **Categories** → review the groups and each one's attribute fields; set GST rates.
3. **Products** → add products (options → variants, MRP, images, stock) or import a CSV.
4. **Email / WhatsApp templates** → read the defaults and adjust the wording; switch off any you don't want.
5. Place a **test order** (Razorpay test mode, then Cash on Delivery) and watch it through the admin.

---

## Order lifecycle (what the code enforces)

```
status          Placed → Confirmed → Packed → Shipped → Out for Delivery → Delivered      (Cancelled / Returned)
payment_status  paid | cod_pending | partially_refunded | refunded
```

- **Cancel**: customer until it ships, admin until delivery. Atomic: stock returns, the coupon use is released, a gift
  card is credited back, the online payment is refunded — each exactly once. A customer cannot cancel an order that bought a gift card; an admin can, only while that card is still unspent (it is voided first).
- **Return**: after delivery, inside the product's return window; admin approves, receives and refunds (full or partial), optionally restocking.
- **Shipping**: free at or above the threshold (judged on the cart value before coupons), otherwise a flat metro / other-city fee; Cash on Delivery adds its fee.
- **Prices include GST**; invoices split it into CGST + SGST (same state) or IGST.

---

## Testing

```bash
CI=true npx react-scripts test --watchAll=false      # React + pure-logic tests
```

[`tools/devstack/`](tools/devstack/README.md) runs the whole store locally with no real accounts (real Postgres in
WASM, a fake Razorpay) and holds the database and end-to-end suites (checkout, orders, refunds, security regressions).

---

## Project structure

```
api/                   Vercel functions: razorpay-*, verify-free-order, orders, notify, lookup, release-reservation, product-share, msg91-login, send-enquiry-whatsapp
supabase/              schema.sql (the one file to run), demo-seed.sql
src/
  admin/               the admin panel (routed sections, shared UI kit in admin/ui — see its README)
  components/          storefront and account components
  context/             Auth, Brand, Catalog (categories), Cart, Wishlist
  pages/               Home, Shop, ProductPage, Cart, Checkout, Account, OrderDetail, Invoice, policies …
  utils/               shared rules (catalog, pricing, shipping, tax, orderStatus) + server helpers used by api/
  config/company.js    single source of truth for company details
tools/devstack/        local test harness (dev only)
docs/                  STORE_OWNER_GUIDE.md (running the store), ECOMMERCE_REDESIGN.md (design + audit), DESIGN_SYSTEM.md
```

## Contacts

Email: contact@brightlightsolutions.in · WhatsApp: +91 78450 81278 · https://www.brightlightsolutions.in
