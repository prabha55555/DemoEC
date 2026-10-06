# E-commerce redesign: audit + target architecture

This store began life as a heritage-pottery shop and was later re-skinned as a general
marketplace. The skin changed, the **model underneath did not**. This document records
what the audit found, what is kept, what is removed, and the architecture the platform now
follows. Read it before changing the catalogue, checkout or order code.

---

## Part A - Audit findings

### A1. Root causes (everything else is a symptom of these)

| # | Root cause | Where it shows up |
|---|-----------|-------------------|
| 1 | **A product was one flat row** with pottery fields (`origin`, `material`, `dimensions`, `weight`, `story`, `together`, `is_collectors_piece`, `fulfillment_type`, `pinterest_url`, `bg`). Every category was forced into the same shape. | Product form, PDP spec table, search, JSON-LD, demo data abusing `dimensions` for "UK sizes 6-10". |
| 2 | **Variants were `[{size, price, weight, dimensions, stock}]` keyed by the string `size`.** One axis only, no id, no SKU, no image, no MRP. | Cart key `id::size`, SQL stock functions matching `variants[i]->>'size'`, orders, wishlist, notifications. Renaming a variant mid-checkout loses stock. Fashion/footwear (size + colour) is impossible. |
| 3 | **Shipping was a per-product surcharge silently folded into the unit price**, while the UI claimed "Free delivery". `getShippingCost()` is a stub returning 0. | Price filters, discounts and refunds are all computed on a price that is not the product's price. No free-shipping threshold, no zones, no COD fee. |
| 4 | **No category model.** Categories were a JSON blob in `settings` and a free-text `products.cat`. | Rename a category and products are orphaned. No ids, slugs, depth > 2, counts, or category-specific attributes. |
| 5 | **One "status" string mixed payment and fulfilment.** Every order is written as `Paid`. | Admin "Pending orders" KPI counts a status nothing writes. "Cancelled" shows as "Paid". Unknown statuses light no stage in the tracker. |
| 6 | **No post-order lifecycle.** Cancel was a bare column update; there was no refund, return, restock, coupon release or gift-card credit. | Cancelling a paid order left the money, stock, coupon use and gift-card balance all stuck. |
| 7 | **Selling model was "enquire on WhatsApp".** `enquiry_only`, `allow_enquiry`, "Price on Request", an all-sales-final policy, concierge copy. | Purchase CTA is demoted behind WhatsApp; Terms say "all sales are final". |
| 8 | **No tax/MRP/discount model.** | No MRP or "% off", no GST invoice, `tax` always 0. |
| 9 | **Admin was a single 4,055-line component** loading whole tables client-side. | Silent truncation at 1,000 rows, no pagination, stale data, non-atomic stock edits racing live checkouts. |

### A2. Verdict by area

**REMOVE (dead weight from the old business)**
- Product columns/fields: `origin`, `material`, free-text `dimensions`/`weight`, `story`, `together`, `is_collectors_piece`, `fulfillment_type` (made-to-order), `pinterest_url`, `bg`, `enquiry_only`, `allow_enquiry`, `shipping_charge`, `show_shipping_at_checkout`, `badge2`. (Columns stay in the table for rollback; **no code reads them any more** - see Part C.)
- "Price on Request" sort, enquiry-only product mode, made-to-order chip, per-product Pinterest pin.
- Heritage UI: arch-shaped tiles, "Top Picks" star band, parchment/brown hero overlays, colour mat behind images, `Verse.jsx` (dead code).
- "All sales are final" policy and "we will reach out within 24 hours" order copy.
- Dead brand settings (per-page hero images that no page reads, unused home labels).

**REDESIGN**
- Catalogue: categories table, attribute schemas per category, product + variant tables, MRP/discount, brand, tags, ratings.
- Shipping: rule-based (free-over threshold, metro/rest-of-India fee, optional COD fee) computed server-side from the real address.
- Orders: separate `status` (fulfilment) from `payment_status`; timestamps and a timeline; cancel/return/refund as server actions.
- Tax: GST-inclusive pricing with a per-line breakup and printable invoice.
- Admin: modular `src/admin/*`, server-side pagination, atomic stock adjustments, categories/attributes/inventory/returns/customers/reports screens.
- Storefront: card, PDP, filters, search, home page, policy pages.

**KEEP (it works and is hard-won)**
- The whole payment spine: idempotent checkout claim -> atomic reservation -> server-priced signed blob -> Razorpay signature + payment re-fetch -> replay guard -> order write -> webhook recovery -> auto-refund on failure. Its *shape* is untouched; only the line identity (variant id) and the totals (shipping, tax) changed.
- Razorpay, Brevo email transport + template engine, WhatsApp edge-function transport, MSG91 OTP login, Supabase auth/profiles, gift cards, coupon reservation/release, rate limiting, signed blobs.
- Design tokens (`bl-*`), responsive shell, mega-menu, bottom nav, mobile sticky bar, PDP gallery/lightbox, `delivery.js` business-day maths, `product-share` hardening.

### A3. Platform constraints discovered

- **Vercel Hobby = max 12 serverless functions; `api/` already had exactly 12.** New server actions were added by consolidation (the same pattern `api/lookup.js` already used), not by adding files. See Part B6.
- Supabase `products` is publicly readable; any private column (cost price) must live elsewhere.
- Image resize (`thumb()`) needs Supabase Image Transformations (paid) - unchanged.

---

## Part B - Target architecture

### B1. Catalogue data model

```
categories ──< products ──< product_variants
                 │ └──< reviews
                 └──< wishlists
```

| Table | Purpose / key columns |
|-------|-----------------------|
| `categories` | `id, parent_id, name, slug, image_url, sort_order, active, attribute_schema jsonb, gst_rate, hsn_code`. Two navigation levels (category -> subcategory), deeper allowed by the schema. `attribute_schema` = `[{key,label,type,options,unit,required,filterable}]` and is inherited from the parent. |
| `products` | Marketing + shared data: `name, brand, category_id, cat (denormalised leaf name), subtitle, description, highlights[], attributes{}, option_types[], tags[], images[], video_*, status draft/active/archived, badge, featured, delivery_min/max_days, weight_g, dims, gst_rate, hsn_code, return_window_days, cod_allowed, free_shipping, max_qty_per_order, low_stock_threshold`. **Rollups maintained by trigger:** `price` (lowest active variant), `price_max`, `mrp`, `in_stock`, `has_variants`, `rating_avg/count`, `sales_count`. |
| `product_variants` | **Every purchasable item is a variant** (simple products have exactly one, "Default"). `id, product_id, sku (unique), options{Size:'M',Colour:'Red'}, label, price, mrp, stock, track_inventory, weight_g, image_url, position, active`. |
| `inventory_movements` | Ledger: `variant_id, delta, reason (sale/restock/adjustment/cancel/return), ref, note, actor, balance_after`. |
| `reviews` | `rating 1-5, title, body, status pending/approved/rejected, verified_purchase`. One per user+product. Only a customer with a delivered order containing the product may post. |
| `wishlists` | `user_id, product_id` (server-side, merged from localStorage on login). |

Rules:
- Stock is an explicit integer plus an explicit `track_inventory` flag. The old "NULL means untracked" convention is gone.
- Cart line identity = `variantId`. The server re-prices from `product_variants`, never from the client.
- `price` is what the customer pays (GST-inclusive). `mrp` is the compare-at price; discount % is derived.

### B2. Pricing, shipping, tax (one pure implementation, used by client and server)

`src/utils/pricing.js` - subtotal, coupon eligibility/discount (all / products / bundle / categories, min order, max-discount cap, validity dates), gift-card application.
`src/utils/shipping.js` - `shippingFor({ merchandiseAfterDiscount, address, brand, items, paymentMethod })`:
free when subtotal >= `free_shipping_threshold` (or every line is `free_shipping`), otherwise `shipping_fee_metro` for the metro list / `shipping_fee_other` elsewhere; COD adds `cod_fee`.
`src/utils/tax.js` - GST-inclusive breakup per line (rate resolves variant -> product -> category -> store default), CGST+SGST when buyer state = seller state, IGST otherwise. Discount is allocated proportionally across lines.

Order total = `merchandise - discount + shipping + cod_fee - gift_card_applied`. Nothing is hidden in unit prices.

### B3. Order lifecycle

```
status          Placed -> Confirmed -> Packed -> Shipped -> Out for Delivery -> Delivered
                   \__________________________________________/                    \-> Returned
                                      \-> Cancelled
payment_status  paid | cod_pending | partially_refunded | refunded
```

- Orders are created only after payment is proven (or for COD / zero-total after the server-signed blob is checked), as `Placed`.
- Every transition appends to `orders.timeline` and stamps `confirmed_at/shipped_at/delivered_at/cancelled_at`.
- **Cancel** (customer before dispatch, or admin any time): atomic status guard -> restock variants -> release coupon use -> credit gift-card balance -> Razorpay refund of the amount actually charged -> timeline -> notifications. Idempotent.
- **Return** (customer, after delivery, inside `return_window_days`): `order_returns` row per request (Requested -> Approved/Rejected -> Pickup Scheduled -> Received -> Refunded). Admin refunds fully or partially; optional restock. The refund is what the customer actually paid for the returned lines (each order line records its own coupon share, `lineDiscount`).
- **Refunds** all go through `refundMoney`, which reserves the amount in ONE locked database call (`reserve_refund`) before any money moves and settles it afterwards (`finish_refund`): concurrent refunds can never total more than was charged, and a failed gateway call hands its amount back. Admin-initiated ("Issue refund") rules, enforced on the server and mirrored in the admin screens from one shared function (`refundCapBeforeDelivery` in `orderStatus.js`):
  - never more than was charged; gift-card orders are cancelled, not refunded (the card is voided first, and only while unspent);
  - **before delivery only a partial refund is allowed** (at least Rs 1 stays): refunding the whole of an order that is still going out is a *cancellation*, which also restocks and releases the coupon;
  - unpaid Cash on Delivery orders and zero-total orders have nothing to refund; a COD refund after delivery is recorded as `manual` (the owner pays the customer).
- Tracking links are stored only if they are `http(s)://` (checked on the server as well as in the admin form).
- Customers read their own orders/returns through RLS; **all mutations are server actions** that re-check ownership and state.

### B4. Payments

- Razorpay online payment (unchanged flow).
- Optional **Cash on Delivery** (admin toggle, off by default): server prices the cart, reserves stock, and returns a signed blob; the order is written through the same `writeVerifiedOrder` with `payment_method='cod'`, `payment_status='cod_pending'`. Marked paid on delivery.
- Zero-total orders (coupon/gift card) keep their existing path.

### B5. Admin (`src/admin/*`, routed under `/admin/*`)

Dashboard (revenue, orders, AOV, top products, low stock, pending actions) · Products (list with server-side search/filter/pagination, form with options -> variant table, attributes, SEO, duplicate, CSV import/export, bulk actions) · Categories & attributes · Inventory (low stock, adjustments with reason, ledger) · Orders (pagination, status actions with timeline, cancel/refund, invoice, shipping labels data, notes) · Returns · Customers (list, order history, notes) · Coupons (all rules) · Shipping & Payments settings (thresholds, fees, COD, GST, return window) · Reviews moderation · Reports (sales, products, categories, coupons, GST) · existing content tools kept: banners, blog, email/WhatsApp templates, store settings, gift cards, enquiries (relabelled "Customer queries").

### B6. Server endpoints (12-function Hobby budget)

| Function | Status |
|----------|--------|
| `razorpay-create-order`, `razorpay-verify-payment`, `razorpay-webhook`, `verify-free-order`, `release-reservation` | Kept (variant ids, shipping, tax, COD added) |
| `lookup` | Kept (coupon validity fields) |
| `msg91-login`, `product-share`, `send-enquiry-whatsapp` | Kept untouched |
| `notify` | **New, replaces** `send-order-email` + `send-order-whatsapp` + `send-test-email` (logic moved verbatim) |
| `orders` | **New**: customer `cancel`, `return_request`; admin `admin_status`, `admin_cancel`, `admin_refund`, `return_update` (stock changes are the `admin_adjust_stock` database function, called by the admin screens directly) |

Total: 11 of 12.

### B7. Notifications

New event types ride the existing transports: `ORDER_CANCELLED`, `ORDER_OUT_FOR_DELIVERY`, `RETURN_REQUESTED`, `RETURN_APPROVED`, `RETURN_REJECTED` (+ existing `REFUND_PROCESSED`). Default templates are seeded so email works out of the box. Status changes made through the `orders` action notify automatically; unknown/empty variables render blank instead of literal `{{token}}`.

---

## Part C - Compatibility and migration

- `supabase/schema.sql` is still the single idempotent file the owner pastes into the SQL editor. It now creates the new tables, **back-fills** them from existing data (variants JSON -> `product_variants`, `cat` text -> `categories`, `Paid` orders -> `Placed` + `payment_status='paid'`), and leaves the legacy columns in place (additive only - nothing is dropped).
- The code deployed with this change **requires** the new schema. Run `schema.sql` first, then deploy.
- Legacy cart lines (`id` + `size`) are reconciled to variant ids on first load; ones that cannot be matched are dropped with a message.
- Old orders keep their `items[].size`; renderers read `variantLabel || size`.
- localStorage keys (`tt_*`) are unchanged on purpose.
- Demo data: `supabase/demo-seed.sql` is rewritten for the new model (categories, variants, MRP, attributes).

## Part D - Verification

A local harness (real Postgres via PGlite + a PostgREST/auth-compatible server + the project's real `api/*.js` handlers + a fake Razorpay) runs full checkouts, cancels, refunds and returns. See `tools/devstack/README.md`.

Status on 7 Oct 2026: database suites (82 checks) and end-to-end suites (checkout 53, orders 64, hardening 45, notifications 13) all pass against fresh backends. A full cash-on-delivery order was also driven through the real screens in a browser: checkout -> admin confirm / pack / ship with tracking / deliver -> customer return request -> admin approve / receive / refund -> customer sees Returned + Refunded, with every admin section opened (the dashboard and the order screens were also checked at phone width; the catalogue screens were checked at phone width by the worker that built them). The deeper edit forms (product editor, coupon / banner / blog editors) were verified by the people who built them, not re-opened in this final pass.

**Not covered by any test here:** the real Razorpay (test or live), Brevo and WhatsApp services - only the fake gateway and fake transports were exercised. Run a Razorpay *test-mode* payment, a refund and an e-mail on the deployed site before taking real orders.

## Part E - Hardening and decisions worth knowing

An independent security review of the server spine found, and the regression suite (`e2e-hardening`) now pins, these fixes: a payment confirmed after its stock hold was released could be spent twice; a failed order write leaked its stock hold; a gift card could be cancelled-and-kept; guests could redeem first-order-only coupons; concurrent refunds could exceed the charge (now serialised by `reserve_refund`); a scoped coupon leaked onto other lines (now a per-line `lineDiscount`); hidden (draft) products could be read by anyone; and a status trigger left a window during deployment.

Decisions taken without asking (change them if you disagree): every purchasable item is a `product_variants` row (a simple product has one *Default*); shipping is a visible line, free at or above the threshold judged on the cart value *before* coupons; Cash on Delivery is optional and off by default; prices are GST-inclusive with the split shown on invoices; one admin account (no staff roles); the Vercel Hobby limit is respected (11 of 12 functions).

Known gaps / follow-ups: multi-select attributes cannot be offered as shop filters (`catalog_facets` treats an array as one value; the schema editor blocks the combination for now); product images in the demo catalogue are generated placeholder art in `public/demo/`; ratings on demo products are seeded and reset when the first real review arrives; `src/data/products.js` is a leftover from the pottery-era model with no remaining imports and can be deleted.
