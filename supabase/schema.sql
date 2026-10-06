-- =============================================================================
-- Brightlight Solutions store -- complete Supabase (Postgres) schema
-- =============================================================================
--
-- HOW TO RUN
--   1. Supabase Dashboard -> your project -> SQL Editor -> New query.
--   2. FIRST change the admin email in SECTION 1 below (search for "CHANGE THIS").
--      It must be the SAME address as REACT_APP_ADMIN_EMAIL in .env / Vercel.
--   3. Paste this whole file and press Run.
--   The editor may show a "destructive operations" confirmation because the script
--   uses DROP POLICY IF EXISTS and one DELETE on the tiny app_admins table. That is
--   expected and safe -- confirm it.
--
-- IDEMPOTENT
--   Every statement is safe to re-run: CREATE ... IF NOT EXISTS, ADD COLUMN IF NOT
--   EXISTS, CREATE OR REPLACE FUNCTION, DROP POLICY IF EXISTS + CREATE POLICY,
--   INSERT ... ON CONFLICT. Re-running never deletes store data (products, orders,
--   customers ...). The one thing a re-run does reset is app_admins: it is kept in
--   sync with the single admin email configured in SECTION 1 (the app only supports
--   one admin), so changing the email and re-running swaps the admin.
--
-- THE ONE VALUE TO CHANGE
--   SECTION 1: v_admin_email  (default ksp9791901552@gmail.com).
--   If it does not match the account you log in to /admin with, every admin write
--   (products, coupons, orders ...) will be rejected by row-level security.
--
-- UPGRADING AN EXISTING STORE
--   Just paste and run this whole file again -- it is the same one file for a fresh install and an upgrade.
--   The v2 section (2B) adds the general e-commerce model ADDITIVELY (nothing is dropped, so no data
--   can be lost) and converts what is already there, once:
--     * product size variants   -> product_variants rows (one per size, stock kept)
--     * the category taxonomy   -> the categories table; products are linked to their category
--     * old order statuses      -> Paid/Pending become Placed + payment_status 'paid'
--     * origin/story/material/dimensions/weight -> brand / description / attributes
--     * default email + WhatsApp templates for every order event are added (only where none exist)
--   Each conversion is recorded in schema_migrations and never repeated. IMPORTANT: run this file
--   BEFORE deploying the matching code -- the new site requires the new tables.
--   supabase/demo-seed.sql (optional) then adds a demo catalogue.
--
-- WHAT THIS CREATES
--   Tables : profiles, products, product_variants, categories, orders, order_returns, order_notes,
--            inventory_movements, reviews, wishlists, enquiries, stories, hero_slides, settings,
--            coupons, gift_cards, email_templates, whatsapp_templates, email_sends,
--            product_notifications, pending_orders, used_payments, verified_phones,
--            app_admins, schema_migrations
--   RPCs   : next_order_number, claim_pending_order, reserve_product_stock,
--            release_product_stock, release_expired_reservations,
--            redeem_coupon_use, release_coupon_use   (+ helper _release_credits_for),
--            restock_items, restock_order_items, record_order_sale, transition_order,
--            reserve_refund, finish_refund, admin_adjust_stock, catalog_facets, recompute_product_rollup
--   Helper : is_admin()
--   Storage: public buckets "images" and "videos" (admin-only write)
--
-- SECURITY MODEL (summary)
--   * RLS is enabled on every table.
--   * Everything the server does (api/*.js) uses the service-role key, which bypasses
--     RLS. Orders, gift cards, order numbers, stock/coupon reservation and payment
--     claims are therefore written ONLY by the server.
--   * The privileged RPCs are executable by service_role only (revoked from anon and
--     authenticated), so nobody can call them with the public anon key.
--   * The admin is whoever is listed in public.app_admins AND is logged in with a
--     CONFIRMED email (see is_admin()).
--   * Private tables (pending_orders, used_payments, verified_phones, app_admins) have
--     RLS on and NO policies: invisible to the browser, reachable by service_role only.
--
-- NOT COVERED BY SQL (do these in the Supabase / Vercel dashboards)
--   * The "send-whatsapp" Edge Function (src/utils/sendWhatsAppTemplate.js calls
--     <project>/functions/v1/send-whatsapp). It is not in this repo.
--   * Auth providers / URL configuration (Authentication -> Providers, URL Config).
--     Keep "Confirm email" ENABLED and sign up the admin account yourself first --
--     is_admin() trusts any account that owns a CONFIRMED admin email address.
--   * Image resizing (thumb() uses /storage/v1/render/image) needs the Storage "Image
--     Transformations" feature (paid plans); without it product thumbnails will not load.
--   * Upload size: bucket limits are set below (images 25 MB, videos 200 MB), but the
--     project-wide Storage upload limit (Settings -> Storage) caps them (50 MB on Free).
-- =============================================================================


-- =============================================================================
-- SECTION 1 -- ADMIN IDENTITY
-- =============================================================================
-- SQL cannot read the app's REACT_APP_ADMIN_EMAIL, so the admin address lives in a
-- tiny table. The browser can never read it (RLS on, no policies).

create table if not exists public.app_admins (
  email      text primary key,
  created_at timestamptz not null default now(),
  constraint app_admins_email_lowercase check (email = lower(btrim(email)))
);
alter table public.app_admins enable row level security;

do $admin$
declare
  -- CHANGE THIS: must equal REACT_APP_ADMIN_EMAIL (placeholder below is NOT a real login)
  v_admin_email text := lower(btrim('ksp9791901552@gmail.com'));
begin
  insert into public.app_admins (email) values (v_admin_email) on conflict (email) do nothing;
  -- the app has exactly one admin: drop any other address left over from an earlier run
  delete from public.app_admins where email <> v_admin_email;
end
$admin$;

-- is_admin(): true only for a logged-in user whose CONFIRMED auth email is listed in
-- app_admins. It looks the user up in auth.users by auth.uid() (not just the JWT email
-- claim), so an unconfirmed or spoofed address can never pass. Mirrors isAdminUser()
-- in src/context/AuthContext.jsx and requireAdmin() in src/utils/requireAdmin.js.
-- SECURITY DEFINER so it can read auth.users / app_admins on behalf of any caller.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from auth.users u
    join public.app_admins a on a.email = lower(btrim(u.email))
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
  );
$$;

grant execute on function public.is_admin() to anon, authenticated, service_role;


-- =============================================================================
-- SECTION 2 -- TABLES
-- =============================================================================
-- jsonb is used for every JS array/object column (images, variants, items, address,
-- ...): it accepts whatever shape the app sends and returns it unchanged.

-- ---- profiles ---------------------------------------------------------------
-- One row per customer, created by the BROWSER (ensureProfile() in
-- src/context/AuthContext.jsx inserts it on first sign-in) -- there is no trigger.
-- addresses: [{name, phone, line1, line2, city, state, pincode}, ...]
-- gift_cards: [{code, added_at}, ...] (codes a customer linked in Account -> Gift Cards)
-- phone_digits: last 10 digits of phone; api/msg91-login.js matches mobile-OTP logins
--   against it. It is a GENERATED column -- the app never writes it.
create table if not exists public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  name             text,
  phone            text default '',
  marketing_opt_in boolean not null default false,
  addresses        jsonb not null default '[]'::jsonb,
  gift_cards       jsonb not null default '[]'::jsonb,
  phone_digits     text generated always as (right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10)) stored,
  created_at       timestamptz not null default now()
);

-- ---- products ---------------------------------------------------------------
-- id is a Supabase-generated UUID (api/product-share.js validates ids as UUIDs).
-- variants: [{size, price, weight, dimensions, stock}] -- stock null/blank = untracked.
-- stock (base): null = untracked, 0 = sold out; ignored once a product has variants.
-- images: array of public image URLs. Newer optional columns (video_*) are included.
create table if not exists public.products (
  id                        uuid primary key default gen_random_uuid(),
  product_number            text,
  name                      text not null,
  cat                       text,
  subtitle                  text,
  origin                    text,
  material                  text,
  dimensions                text,
  weight                    text,
  price                     numeric,
  shipping_charge           numeric not null default 0,
  show_shipping_at_checkout boolean not null default true,
  story                     text,
  together                  text,
  badge                     text,
  badge2                    text,
  enquiry_only              boolean not null default false,
  stock                     integer default 1,
  variants                  jsonb not null default '[]'::jsonb,
  available                 boolean not null default true,
  featured                  boolean not null default false,
  discover_pinned           boolean not null default false,
  is_collectors_piece       boolean not null default false,
  allow_enquiry             boolean not null default true,
  bg                        text,
  images                    jsonb not null default '[]'::jsonb,
  image_position            text default '50% 50%',
  pinterest_url             text,
  delivery_min_days         integer default 5,
  delivery_max_days         integer default 8,
  fulfillment_type          text default 'ready_to_ship',   -- 'ready_to_ship' | 'made_to_order'
  video_url                 text,
  video_position            integer default 0,
  video_cover_url           text,
  video_cover_position      text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- ---- orders -----------------------------------------------------------------
-- Written ONLY by the server (src/utils/orderWrite.js, service role). Never by the browser.
-- order_id is the human order number from next_order_number() (e.g. BL-10001);
-- id (uuid) is the row key the admin UI uses. items: [{id,name,qty,price,cat,size,...}].
-- address: {name,phone,line1,line2,city,state,pincode, billing:{...}}.
-- estimated_delivery is text: either YYYY-MM-DD or a label like "20 Aug - 25 Aug".
-- inventory_issue: jsonb flag set when a payment landed with no live stock reservation.
-- deleted_at: admin "soft delete" (row kept for payment/audit history).
-- user_id is deliberately NOT a foreign key: financial records must survive account deletion.
create table if not exists public.orders (
  id                 uuid primary key default gen_random_uuid(),
  order_id           text not null,
  user_id            uuid,
  user_email         text,
  user_name          text,
  user_phone         text,
  address            jsonb not null default '{}'::jsonb,
  items              jsonb not null default '[]'::jsonb,
  subtotal           numeric not null default 0,
  shipping           numeric not null default 0,
  total              numeric not null default 0,
  coupon_code        text,
  discount           numeric not null default 0,
  gift_card_code     text,
  gift_card_applied  numeric not null default 0,
  payment_method     text default 'razorpay',
  status             text not null default 'Pending',  -- Pending|Paid|Confirmed|Shipped|Out for Delivery|Delivered|Cancelled
  payment_id         text,
  razorpay_order_id  text,
  estimated_delivery text,
  inventory_issue    jsonb,
  package_image_url  text,
  shipping_carrier   text,
  tracking_number    text,
  tracking_url       text,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now()
);

-- ---- enquiries --------------------------------------------------------------
-- Written ONLY by the server (api/send-enquiry-whatsapp.js, service role) so guests and
-- customers alike can enquire without any anon INSERT policy.
-- type: 'WhatsApp' | 'Email'; status: Received | Contacted | Quoted | Closed.
-- product holds the product NAME or 'General Enquiry' (not an id).
create table if not exists public.enquiries (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid,
  user_name         text,
  user_email        text,
  user_phone        text,
  product           text,
  message           text,
  type              text,
  status            text not null default 'Received',
  whatsapp_ack_sent boolean not null default false,   -- atomic claim flag for the auto-acknowledgement
  created_at        timestamptz not null default now()
);

-- ---- stories (the "Insights" blog) ------------------------------------------
create table if not exists public.stories (
  id         uuid primary key default gen_random_uuid(),
  title      text not null default '',
  subtitle   text not null default '',
  category   text not null default 'Company News',
  author     text not null default 'Brightlight Solutions',
  story      text not null default '',
  images     jsonb not null default '[]'::jsonb,
  published  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---- hero_slides (home page banner slider) ----------------------------------
-- extra_ctas: [{label, link}, ...]. Admin re-saves the whole row (incl. id) when reordering.
create table if not exists public.hero_slides (
  id                   uuid primary key default gen_random_uuid(),
  image_url            text not null default '',
  image_position       text default '50% 50%',
  mobile_image_url     text default '',
  headline             text not null default '',
  headline_size        text default 'medium',
  mobile_headline_size text default '',
  subtext              text not null default '',
  subtext_size         text default 'medium',
  cta_label            text not null default 'Shop Now',
  cta_link             text not null default '',
  cta_position         text default 'bottom-left',
  mobile_cta_position  text default '',
  show_cta             boolean not null default true,
  extra_ctas           jsonb not null default '[]'::jsonb,
  display_order        integer not null default 0,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ---- settings (single row, id = 'brand') ------------------------------------
-- BrandContext merges this row OVER its built-in defaults ({...defaults, ...row}), so a
-- NULL here would wipe a default. Every column below therefore carries the same default
-- as src/context/BrandContext.jsx; only columns where NULL is meaningful stay null
-- (giftcard_max = no upper limit, category_taxonomy / coming_soon_categories /
-- care_guides = "use the built-in list").
create table if not exists public.settings (
  id         text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.settings
  -- identity / text
  add column if not exists logo_url                       text default '',
  add column if not exists splash_logo                    text default '',
  add column if not exists brand_name                     text default 'Brightlight Solutions',
  add column if not exists tagline                        text default 'Technology That Moves Business Forward',
  add column if not exists registered_office              text default 'Kamatchi Amman Kovil Street, Kumarananthapuram, Tiruppur, Tamil Nadu 641602, India',
  -- per-page hero images (+ optional dedicated mobile photo, + crop focal points)
  add column if not exists hero_shop                      text default '',
  add column if not exists hero_shop_mobile_image         text default '',
  add column if not exists hero_shop_position             text default '50% 50%',
  add column if not exists hero_shop_mobile_position      text default '',
  add column if not exists hero_about                     text default '',
  add column if not exists hero_about_mobile_image        text default '',
  add column if not exists hero_about_position            text default '50% 50%',
  add column if not exists hero_about_mobile_position     text default '',
  add column if not exists hero_services                  text default '',
  add column if not exists hero_services_mobile_image     text default '',
  add column if not exists hero_services_position         text default '50% 50%',
  add column if not exists hero_services_mobile_position  text default '',
  add column if not exists hero_stories                   text default '',
  add column if not exists hero_stories_mobile_image      text default '',
  add column if not exists hero_stories_position          text default '50% 50%',
  add column if not exists hero_stories_mobile_position   text default '',
  add column if not exists hero_care                      text default '',
  add column if not exists hero_care_mobile_image         text default '',
  add column if not exists hero_care_position             text default '50% 50%',
  add column if not exists hero_care_mobile_position      text default '',
  add column if not exists hero_giftcard                  text default '',
  add column if not exists hero_giftcard_mobile_image     text default '',
  add column if not exists hero_giftcard_position         text default '50% 50%',
  add column if not exists hero_giftcard_mobile_position  text default '',
  add column if not exists about_image                    text default '',
  add column if not exists about_image_position           text default '50% 50%',
  add column if not exists about_image_mobile_position    text default '',
  add column if not exists about_video                    text default '',
  add column if not exists about_video_caption            text default '',
  add column if not exists order_confirmation_hero_image  text default '',
  -- social links (shown in the email footer only when set)
  add column if not exists instagram_url                  text default '',
  add column if not exists facebook_url                   text default '',
  add column if not exists youtube_url                    text default '',
  add column if not exists pinterest_url                  text default '',
  -- home page
  add column if not exists featured_count                 integer not null default 3,
  add column if not exists home_featured_label            text default 'Featured',
  add column if not exists home_featured_title            text default 'Top Picks For You',
  add column if not exists home_ink_eyebrow               text default 'Why Brightlight',
  add column if not exists home_ink_title                 text default 'Everything you need, delivered to your door.',
  add column if not exists home_ink_body                  text default 'Shop everyday products across fashion, home, beauty, electronics and more — with free delivery on every order and secure online payments.',
  add column if not exists home_ig_followers              text default '',
  add column if not exists home_tagline_heading           text default 'Shop smart. Shop Brightlight.',
  -- category taxonomy / help guides (NULL = use the built-in defaults in the app)
  add column if not exists category_taxonomy              jsonb,
  add column if not exists coming_soon_categories         jsonb,
  add column if not exists care_guides                    jsonb,
  -- gift cards
  add column if not exists giftcard_enabled               boolean not null default true,
  add column if not exists giftcard_min                   numeric not null default 1000,
  add column if not exists giftcard_max                   numeric,
  add column if not exists giftcard_description           text default 'A Brightlight Solutions gift card lets someone choose exactly what they love. Pick an amount, and we''ll take care of the rest.',
  -- delivery estimate
  add column if not exists delivery_metro_cities          text default 'Tiruppur, Coimbatore, Chennai, Bangalore, Bengaluru, Hyderabad, Mumbai, Pune, Delhi, New Delhi, Kolkata',
  add column if not exists delivery_extra_days            integer not null default 3,
  -- home hero slider (whole-slider settings)
  add column if not exists hero_slider_interval_ms        integer not null default 4000,
  add column if not exists hero_slider_show_dots          boolean not null default true,
  add column if not exists hero_slider_show_arrows        boolean not null default true;

-- ---- coupons ----------------------------------------------------------------
-- type: 'percent' | 'flat'; applies_to: 'all' | 'products' | 'bundle';
-- product_ids: array of products.id (strings). max_uses null/0 = unlimited.
-- times_used is changed ONLY by redeem_coupon_use()/release_coupon_use().
create table if not exists public.coupons (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  type        text not null default 'percent',
  value       numeric not null,
  applies_to  text not null default 'all',
  product_ids jsonb not null default '[]'::jsonb,
  active      boolean not null default true,
  max_uses    integer,
  times_used  integer not null default 0,
  created_at  timestamptz not null default now(),
  constraint coupons_code_key unique (code),
  constraint coupons_times_used_nonneg check (times_used >= 0)
);

-- ---- gift_cards -------------------------------------------------------------
-- Issued by the server after a gift-card purchase (code BL-GC-XXXX-XXXX-XXXX, always
-- upper-case); balance is debited/credited by the server with compare-and-set updates.
create table if not exists public.gift_cards (
  id              uuid primary key default gen_random_uuid(),
  code            text not null,
  initial_value   numeric not null,
  balance         numeric not null default 0,
  order_id        text,
  purchaser_email text,
  recipient_name  text,
  recipient_email text,
  message         text,
  expires_at      timestamptz,
  created_at      timestamptz not null default now(),
  constraint gift_cards_code_key unique (code),
  constraint gift_cards_balance_nonneg check (balance >= 0)
);

-- ---- email_templates --------------------------------------------------------
-- body_blocks: [{type, text, label, ...}]. Only ONE is_system template per event_type
-- (partial unique index below) -- Admin shows a specific message for that 23505 error.
create table if not exists public.email_templates (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null,
  name         text not null default '',
  subject      text not null default '',
  preview_text text default '',
  sender_name  text,
  sender_email text,
  body_blocks  jsonb not null default '[]'::jsonb,
  enabled      boolean not null default true,
  is_system    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---- whatsapp_templates -----------------------------------------------------
-- event_type is UNIQUE (the admin saves with upsert ... onConflict 'event_type').
create table if not exists public.whatsapp_templates (
  id         uuid primary key default gen_random_uuid(),
  event_type text not null,
  name       text,
  message    text not null default '',
  enabled    boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_templates_event_type_key unique (event_type)
);

-- ---- email_sends (audit log of every transactional email attempt) -----------
-- Inserted by the server only (src/utils/sendTemplateEmail.js). status: 'sent' | 'failed'.
create table if not exists public.email_sends (
  id               uuid primary key default gen_random_uuid(),
  template_id      uuid references public.email_templates (id) on delete set null,
  event_type       text,
  order_number     text,
  recipient_email  text not null,
  recipient_name   text,
  subject          text not null default '',
  is_test          boolean not null default false,
  status           text not null default 'sent',
  brevo_message_id text,
  error_message    text,
  sent_by          text,
  created_at       timestamptz not null default now()
);

-- ---- product_notifications ("Notify me when back in stock") -----------------
-- Created by the logged-in customer in the browser (src/components/NotifyWhenAvailable.jsx).
-- One subscription per user + product + size (unique index below; null size counts as one
-- value). status: 'waiting' | 'notified'.
create table if not exists public.product_notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  user_name    text,
  user_email   text,
  user_phone   text,
  product_id   uuid not null references public.products (id) on delete cascade,
  product_name text,
  size         text,
  status       text not null default 'waiting',
  notified_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- ---- pending_orders (checkout attempts / stock reservations) ----------------
-- SERVER ONLY. One row per checkout attempt (api/razorpay-create-order.js).
--   checkout_attempt_key : idempotency key from the browser (unique; duplicate = 23505)
--   status               : 'reserving' (claim made, pricing in progress)
--                          -> 'reserved' (stock/coupon/gift-card held, expires_at = timeout)
--                          -> 'released' (expired/cancelled, holds given back) or deleted by
--                             claim_pending_order() when the order is finalized.
--   receipt              : placeholder 'pending:<key>' first, then the real order number
--   razorpay_order_id    : placeholder 'attempt:<key>' first, then the Razorpay order id
--   computed / cart / addr / bill_addr : the server-priced snapshot used to recover an order
--   reserved_items       : [{id,size,qty}] lines whose stock was actually decremented
--                          (untracked-stock lines are not listed) -- what release gives back
create table if not exists public.pending_orders (
  id                   uuid primary key default gen_random_uuid(),
  checkout_attempt_key text not null,
  razorpay_order_id    text,
  receipt              text not null,
  computed             jsonb not null default '{}'::jsonb,
  cart                 jsonb not null default '[]'::jsonb,
  addr                 jsonb not null default '{}'::jsonb,
  bill_addr            jsonb,
  user_id              uuid,
  user_email           text,
  user_name            text,
  user_phone           text,
  estimated_delivery   text,
  status               text not null default 'reserving',
  reserved_items       jsonb not null default '[]'::jsonb,
  expires_at           timestamptz not null default (now() + interval '1 minute'),
  released_at          timestamptz,
  created_at           timestamptz not null default now(),
  constraint pending_orders_attempt_key unique (checkout_attempt_key)
);

-- ---- used_payments (replay guard: one payment -> one order) -----------------
-- payment_key = Razorpay payment id, or 'free:<receipt>' for fully-covered orders.
create table if not exists public.used_payments (
  payment_key text primary key,
  order_id    text,
  created_at  timestamptz not null default now()
);

-- ---- verified_phones (mobile-OTP registry: one verified number -> one account) --
-- phone is stored as '91XXXXXXXXXX'. Written by api/msg91-login.js (service role) only.
create table if not exists public.verified_phones (
  phone      text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);


-- =============================================================================
-- SECTION 2B -- GENERAL E-COMMERCE MODEL (v2)
-- =============================================================================
-- The tables above are the original (pottery-era) shapes. Everything below generalises
-- them. It is ADDITIVE: no column is dropped, so the legacy product columns (origin,
-- material, story, enquiry_only, shipping_charge ...) still exist in the table but the
-- application no longer reads or writes them. See docs/ECOMMERCE_REDESIGN.md.

-- ---- schema_migrations (marks one-time data back-fills so a re-run never repeats them) --
create table if not exists public.schema_migrations (
  name       text primary key,
  applied_at timestamptz not null default now()
);
alter table public.schema_migrations enable row level security;

-- ---- categories (category -> subcategory tree) ------------------------------------------
-- attribute_schema: [{key,label,type:'text'|'number'|'select'|'multiselect'|'boolean',
--                     options:[..], unit, required, filterable}] -- inherited by children.
-- gst_rate / hsn_code: default tax data for products in the category.
create table if not exists public.categories (
  id               uuid primary key default gen_random_uuid(),
  parent_id        uuid references public.categories (id) on delete restrict,
  name             text not null,
  slug             text not null,
  description      text not null default '',
  image_url        text not null default '',
  sort_order       integer not null default 0,
  active           boolean not null default true,
  attribute_schema jsonb not null default '[]'::jsonb,
  gst_rate         numeric,
  hsn_code         text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint categories_slug_key unique (slug),
  constraint categories_not_own_parent check (parent_id is null or parent_id <> id)
);

-- ---- products: generalised columns ------------------------------------------------------
-- price / mrp / price_max / in_stock / has_variants / total_stock are ROLLUPS maintained by
-- the product_variants trigger (never write them by hand). status replaces `available`
-- (a trigger keeps available = (status = 'active') for anything still reading it).
alter table public.products
  add column if not exists brand               text,
  add column if not exists category_id         uuid references public.categories (id) on delete set null,
  add column if not exists description         text,
  add column if not exists highlights          jsonb not null default '[]'::jsonb,
  add column if not exists attributes          jsonb not null default '{}'::jsonb,
  add column if not exists option_types        jsonb not null default '[]'::jsonb,
  add column if not exists tags                jsonb not null default '[]'::jsonb,
  add column if not exists status              text not null default 'active',
  add column if not exists mrp                 numeric,
  add column if not exists discount_pct        integer not null default 0,
  add column if not exists price_max           numeric,
  add column if not exists in_stock            boolean not null default true,
  add column if not exists has_variants        boolean not null default false,
  add column if not exists total_stock         integer not null default 0,
  add column if not exists weight_g            integer,
  add column if not exists length_cm           numeric,
  add column if not exists width_cm            numeric,
  add column if not exists height_cm           numeric,
  add column if not exists free_shipping       boolean not null default false,
  add column if not exists gst_rate            numeric,
  add column if not exists hsn_code            text,
  add column if not exists return_window_days  integer,      -- null = store default, 0 = not returnable
  add column if not exists cod_allowed         boolean not null default true,
  add column if not exists max_qty_per_order   integer not null default 10,
  add column if not exists low_stock_threshold integer,      -- null = store default
  add column if not exists meta_title          text,
  add column if not exists meta_description    text,
  add column if not exists rating_avg          numeric(3,2) not null default 0,
  add column if not exists rating_count        integer not null default 0,
  add column if not exists sales_count         integer not null default 0,
  add column if not exists search_text         text not null default '';

alter table public.products drop constraint if exists products_status_check;
alter table public.products add constraint products_status_check check (status in ('draft', 'active', 'archived'));

-- Products the owner had HIDDEN under the old model (available = false) must stay hidden: the new status
-- column defaults to 'active', which would silently put them on sale. Runs before the sync trigger exists
-- on a first upgrade (afterwards available always mirrors status, so this matches nothing).
update public.products set status = 'archived' where available = false and status = 'active';

-- ---- product_variants (every purchasable item is a variant; simple products have one) ---
-- options: {"Size":"M","Colour":"Red"}   label: "M / Red" (display + legacy `size` key)
-- stock only matters while track_inventory is true. price is GST-inclusive selling price.
create table if not exists public.product_variants (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references public.products (id) on delete cascade,
  sku             text,
  options         jsonb not null default '{}'::jsonb,
  label           text not null default 'Default',
  price           numeric not null check (price >= 0),
  mrp             numeric check (mrp is null or mrp >= 0),
  stock           integer not null default 0 check (stock >= 0),
  track_inventory boolean not null default true,
  weight_g        integer,
  image_url       text,
  position        integer not null default 0,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---- inventory_movements (stock ledger; written by the server / SECURITY DEFINER RPCs) ---
-- reason: sale | restock | adjustment | cancel | return | correction
create table if not exists public.inventory_movements (
  id         uuid primary key default gen_random_uuid(),
  variant_id uuid references public.product_variants (id) on delete set null,
  product_id uuid references public.products (id) on delete set null,
  delta      integer not null,
  reason     text not null,
  ref        text,
  note       text,
  actor      text,
  stock_after integer,
  created_at timestamptz not null default now()
);

-- ---- orders: payment/fulfilment split, timeline, refunds, tax -----------------------------
-- status (fulfilment): Placed | Confirmed | Packed | Shipped | Out for Delivery | Delivered |
--                      Cancelled | Returned
-- payment_status:      paid | cod_pending | partially_refunded | refunded
-- timeline: [{status, at, by, note}] oldest first (customer-visible, so no internal notes).
alter table public.orders
  add column if not exists payment_status  text not null default 'paid',
  add column if not exists confirmed_at    timestamptz,
  add column if not exists shipped_at      timestamptz,
  add column if not exists delivered_at    timestamptz,
  add column if not exists cancelled_at    timestamptz,
  add column if not exists cancel_reason   text,
  add column if not exists cancelled_by    text,
  add column if not exists refunded_amount numeric not null default 0,
  add column if not exists refunds         jsonb not null default '[]'::jsonb,
  add column if not exists tax_total       numeric not null default 0,
  add column if not exists cod_fee         numeric not null default 0,
  add column if not exists timeline        jsonb not null default '[]'::jsonb,
  add column if not exists restocked_at    timestamptz,
  add column if not exists updated_at      timestamptz not null default now();
alter table public.orders alter column status set default 'Placed';

-- ---- order_notes (internal admin notes; never visible to customers) -----------------------
create table if not exists public.order_notes (
  id         uuid primary key default gen_random_uuid(),
  order_uuid uuid not null references public.orders (id) on delete cascade,
  author     text,
  note       text not null,
  created_at timestamptz not null default now()
);

-- ---- order_returns (return / replacement requests) ---------------------------------------
-- items: [{id, variantId, name, label, qty, price, reason}]
-- status: Requested | Approved | Rejected | Pickup Scheduled | Received | Refunded | Closed
create table if not exists public.order_returns (
  id            uuid primary key default gen_random_uuid(),
  order_uuid    uuid not null references public.orders (id) on delete cascade,
  order_id      text not null,
  user_id       uuid,
  type          text not null default 'return',
  items         jsonb not null default '[]'::jsonb,
  reason        text,
  details       text,
  images        jsonb not null default '[]'::jsonb,
  status        text not null default 'Requested',
  refund_amount numeric not null default 0,
  refund_ref    text,
  restock       boolean not null default true,
  admin_note    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  constraint order_returns_type_check   check (type in ('return', 'replacement')),
  constraint order_returns_status_check check (status in ('Requested', 'Approved', 'Rejected', 'Pickup Scheduled', 'Received', 'Refunded', 'Closed'))
);

-- ---- coupons: richer rules ---------------------------------------------------------------
alter table public.coupons
  add column if not exists description      text not null default '',
  add column if not exists min_order_value  numeric not null default 0,
  add column if not exists max_discount     numeric,                       -- cap for percent coupons
  add column if not exists starts_at        timestamptz,
  add column if not exists expires_at       timestamptz,
  add column if not exists category_ids     jsonb not null default '[]'::jsonb,
  add column if not exists per_user_limit   integer,                       -- null/0 = unlimited
  add column if not exists first_order_only boolean not null default false,
  add column if not exists is_public        boolean not null default true; -- false = private code, not listed to customers

-- ---- settings: shipping, payments, tax, returns -------------------------------------------
alter table public.settings
  add column if not exists free_shipping_threshold numeric not null default 499,
  add column if not exists shipping_fee_metro      numeric not null default 40,
  add column if not exists shipping_fee_other      numeric not null default 60,
  add column if not exists cod_enabled             boolean not null default false,
  add column if not exists cod_fee                 numeric not null default 0,
  add column if not exists cod_max_order           numeric not null default 5000,
  add column if not exists return_window_days      integer not null default 7,
  add column if not exists low_stock_threshold     integer not null default 5,
  add column if not exists default_gst_rate        numeric not null default 18,
  add column if not exists seller_legal_name       text default '',
  add column if not exists seller_gstin            text default '',
  add column if not exists seller_state            text default 'Tamil Nadu',
  add column if not exists gift_card_validity_months integer not null default 6,
  add column if not exists support_email           text default '',
  add column if not exists support_phone           text default '';

-- ---- reviews -----------------------------------------------------------------------------
create table if not exists public.reviews (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid not null references public.products (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  user_name         text,
  order_id          text,
  rating            integer not null check (rating between 1 and 5),
  title             text not null default '',
  body              text not null default '',
  status            text not null default 'pending',
  verified_purchase boolean not null default false,
  created_at        timestamptz not null default now(),
  constraint reviews_status_check check (status in ('pending', 'approved', 'rejected')),
  constraint reviews_one_per_user unique (user_id, product_id)
);

-- ---- wishlists (server-side; merged from the browser's localStorage on login) --------------
create table if not exists public.wishlists (
  user_id    uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

-- ---- product_notifications: reference the variant (size text kept for old rows) ------------
alter table public.product_notifications
  add column if not exists variant_id uuid references public.product_variants (id) on delete cascade;


-- =============================================================================
-- SECTION 3 -- INDEXES
-- =============================================================================
create index if not exists products_available_created_idx   on public.products (available, created_at desc);
create index if not exists products_cat_idx                 on public.products (cat);

create index if not exists orders_user_created_idx          on public.orders (user_id, created_at desc);
create index if not exists orders_created_idx               on public.orders (created_at desc);
-- order number lookup (writeVerifiedOrder reads by order_id; also must be unique)
create unique index if not exists orders_order_id_key       on public.orders (order_id);
-- one order per payment (orderWrite.js relies on the 23505 from this as a second replay guard)
create unique index if not exists orders_payment_id_key     on public.orders (payment_id) where payment_id is not null;

create index if not exists enquiries_user_created_idx       on public.enquiries (user_id, created_at desc);
create index if not exists enquiries_created_idx            on public.enquiries (created_at desc);

create index if not exists stories_published_created_idx    on public.stories (published, created_at desc);
create index if not exists hero_slides_active_order_idx     on public.hero_slides (active, display_order);
create index if not exists coupons_active_created_idx       on public.coupons (active, created_at desc);
create index if not exists gift_cards_order_id_idx          on public.gift_cards (order_id);
create index if not exists gift_cards_created_idx           on public.gift_cards (created_at desc);
create index if not exists email_sends_created_idx          on public.email_sends (created_at desc);

-- only one "system" template per event (Admin relies on the 23505 from this)
create unique index if not exists email_templates_one_system_per_event
  on public.email_templates (event_type) where is_system;

create index if not exists product_notifications_user_created_idx on public.product_notifications (user_id, created_at desc);
-- the v2 key: one subscription per customer per variant (the older size-text index above still guards legacy rows)
create unique index if not exists product_notifications_unique_variant
  on public.product_notifications (user_id, variant_id) where variant_id is not null;
create unique index if not exists product_notifications_unique_sub
  on public.product_notifications (user_id, product_id, (coalesce(size, '')));

create unique index if not exists pending_orders_receipt_key  on public.pending_orders (receipt);
create index if not exists pending_orders_razorpay_order_idx  on public.pending_orders (razorpay_order_id);
create index if not exists pending_orders_status_expires_idx  on public.pending_orders (status, expires_at);

create index if not exists profiles_phone_digits_idx          on public.profiles (phone_digits);
create index if not exists verified_phones_user_idx           on public.verified_phones (user_id);

-- v2 catalogue
create index if not exists categories_parent_sort_idx         on public.categories (parent_id, sort_order, name);
create index if not exists products_category_idx              on public.products (category_id);
create index if not exists products_status_created_idx        on public.products (status, created_at desc);
create index if not exists products_brand_idx                 on public.products (brand);
create index if not exists products_price_idx                 on public.products (price);
create index if not exists products_sales_idx                 on public.products (sales_count desc);
create index if not exists product_variants_product_idx       on public.product_variants (product_id, position);
-- SKUs are unique store-wide, case-insensitively; blank/null SKUs are allowed (and not unique).
create unique index if not exists product_variants_sku_key
  on public.product_variants (lower(sku)) where sku is not null and btrim(sku) <> '';
-- no two variants of one product may have the same option combination
create unique index if not exists product_variants_options_key
  on public.product_variants (product_id, options);
create index if not exists inventory_movements_variant_idx    on public.inventory_movements (variant_id, created_at desc);
create index if not exists inventory_movements_created_idx    on public.inventory_movements (created_at desc);
create index if not exists orders_status_created_idx          on public.orders (status, created_at desc);
create index if not exists order_returns_order_idx            on public.order_returns (order_uuid);
create index if not exists order_returns_status_idx           on public.order_returns (status, created_at desc);
create index if not exists order_returns_user_idx             on public.order_returns (user_id, created_at desc);
create index if not exists order_notes_order_idx              on public.order_notes (order_uuid, created_at);
create index if not exists reviews_product_status_idx         on public.reviews (product_id, status, created_at desc);
create index if not exists wishlists_user_idx                 on public.wishlists (user_id, created_at desc);


-- =============================================================================
-- SECTION 4 -- RPC FUNCTIONS (all SECURITY DEFINER, service_role only)
-- =============================================================================
-- Every caller is a server function using the service-role key (api/razorpay-create-order.js,
-- src/utils/orderWrite.js, src/utils/reservations.js). They are revoked from anon/authenticated
-- in SECTION 6 so the public anon key can never call them.

-- ---- next_order_number() ----------------------------------------------------
-- Contract: returns the next human order number as text, atomically and gap-tolerant, e.g.
-- 'BL-10001', 'BL-10002', ... (format taken from the 'BL-10482' sample in
-- src/utils/emailVariables.js). Used as the Razorpay receipt (max 40 chars) and orders.order_id.
create sequence if not exists public.order_number_seq start with 10001;

create or replace function public.next_order_number()
returns text
language sql
security definer
set search_path = public
as $$
  select 'BL-' || nextval('public.order_number_seq')::text;
$$;

-- ---- redeem_coupon_use(p_code) ----------------------------------------------
-- Contract: atomically take ONE use of an active coupon. Raises an exception when the code
-- is unknown, inactive, or already at max_uses (the caller then proceeds at full price).
-- max_uses null or <= 0 means unlimited. A single UPDATE with the cap in its WHERE clause
-- makes concurrent checkouts race-safe.
create or replace function public.redeem_coupon_use(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  update public.coupons
     set times_used = coalesce(times_used, 0) + 1
   where code = v_code
     and active
     and (max_uses is null or max_uses <= 0 or coalesce(times_used, 0) < max_uses);

  if not found then
    raise exception 'COUPON_UNAVAILABLE: % is unknown, inactive or fully redeemed', v_code
      using errcode = 'P0001';
  end if;
end;
$$;

-- ---- release_coupon_use(p_code) ---------------------------------------------
-- Contract: give back ONE use (times_used - 1, never below 0). A no-op if the coupon no longer
-- exists. Callers guarantee at-most-once per checkout attempt via flags on pending_orders.computed.
create or replace function public.release_coupon_use(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.coupons
     set times_used = greatest(coalesce(times_used, 0) - 1, 0)
   where code = upper(btrim(coalesce(p_code, '')));
end;
$$;

-- ---- reserve_product_stock(p_checkout_attempt_key, p_items, p_timeout_minutes) ----
-- Contract: atomic check-and-decrement of stock for one checkout attempt.
--   p_items = [{ "id": <products.id>, "variantId": <product_variants.id>, "qty": <int> }, ...]
--   (a legacy line carrying "size" instead of "variantId" is resolved by variant label.)
-- For every variant (merged per variant, locked in id order after the parent products, so two
-- concurrent checkouts and an admin save always take locks in the same order):
--   * variant missing/inactive or product not 'active' -> RAISES (whole call rolls back)
--   * track_inventory = false (untracked) -> nothing is decremented and the line is not recorded
--   * stock < qty -> RAISES (nothing is decremented)
-- On success the claim row in pending_orders ('reserving') moves to status 'reserved', records the
-- decremented lines in reserved_items and sets expires_at = now() + p_timeout_minutes (default 5).
-- Idempotent: an already 'reserved' attempt returns without touching stock again. Raises if there
-- is no claim row, or the attempt was already 'released'.
create or replace function public.reserve_product_stock(
  p_checkout_attempt_key text,
  p_items                jsonb,
  p_timeout_minutes      integer default 5
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim    public.pending_orders%rowtype;
  v_item     record;
  v_var      public.product_variants%rowtype;
  v_status   text;
  v_reserved jsonb := '[]'::jsonb;
  v_minutes  integer := coalesce(nullif(p_timeout_minutes, 0), 5);
begin
  if p_checkout_attempt_key is null or btrim(p_checkout_attempt_key) = '' then
    raise exception 'reserve_product_stock: missing checkout attempt key' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'reserve_product_stock: p_items must be a JSON array' using errcode = '22023';
  end if;

  select * into v_claim
    from public.pending_orders
   where checkout_attempt_key = p_checkout_attempt_key
     for update;
  if not found then
    raise exception 'reserve_product_stock: no checkout claim exists for this attempt' using errcode = 'P0002';
  end if;
  if v_claim.status = 'reserved' then
    return;  -- already reserved: never decrement twice
  end if;
  if v_claim.status <> 'reserving' then
    raise exception 'reserve_product_stock: this attempt is already %', v_claim.status using errcode = 'P0001';
  end if;

  -- parent products first (id order), then variants (id order) below
  perform 1
    from public.products
   where id in (select distinct (e.item ->> 'id')::uuid from jsonb_array_elements(p_items) as e(item))
   order by id
     for update;

  for v_item in
    select r.variant_id, sum(r.qty)::integer as qty
      from (
        select coalesce(
                 nullif(e.item ->> 'variantId', '')::uuid,
                 (select pv.id from public.product_variants pv
                   where pv.product_id = (e.item ->> 'id')::uuid and pv.label = nullif(e.item ->> 'size', '')
                   order by pv.position limit 1)
               ) as variant_id,
               (e.item ->> 'qty')::integer as qty
          from jsonb_array_elements(p_items) as e(item)
      ) r
     group by r.variant_id
     order by r.variant_id
  loop
    if v_item.variant_id is null then
      raise exception 'VARIANT_NOT_FOUND: a cart line has no purchasable option' using errcode = 'P0001';
    end if;
    if coalesce(v_item.qty, 0) <= 0 then
      raise exception 'reserve_product_stock: invalid quantity for variant %', v_item.variant_id using errcode = '22023';
    end if;

    select * into v_var from public.product_variants where id = v_item.variant_id for update;
    if not found or not v_var.active then
      raise exception 'VARIANT_NOT_FOUND: %', v_item.variant_id using errcode = 'P0001';
    end if;
    select status into v_status from public.products where id = v_var.product_id;
    if v_status is distinct from 'active' then
      raise exception 'PRODUCT_UNAVAILABLE: %', v_var.product_id using errcode = 'P0001';
    end if;

    if not v_var.track_inventory then
      continue;  -- untracked: always available, nothing to decrement
    end if;
    if v_var.stock < v_item.qty then
      raise exception 'INSUFFICIENT_STOCK: variant % has % left, % requested',
        v_var.id, v_var.stock, v_item.qty using errcode = 'P0001';
    end if;

    update public.product_variants
       set stock = stock - v_item.qty
     where id = v_var.id;

    v_reserved := v_reserved || jsonb_build_array(jsonb_build_object(
      'id',        v_var.product_id,
      'variantId', v_var.id,
      'qty',       v_item.qty
    ));
  end loop;

  update public.pending_orders
     set status         = 'reserved',
         reserved_items = v_reserved,
         expires_at     = now() + make_interval(mins => v_minutes)
   where checkout_attempt_key = p_checkout_attempt_key;
end;
$$;

-- ---- release_product_stock(p_checkout_attempt_key) --------------------------
-- Contract: give the held stock of one attempt back and mark its pending_orders row 'released'
-- (the row is kept so a late payment can still be recovered and flagged as an inventory issue).
-- Safe to call any number of times: a no-op unless the row exists and is 'reserved' (so also a
-- no-op for gift-card-only carts, 'reserving' claims, or already-released/claimed attempts).
-- Only restores lines recorded in reserved_items, i.e. exactly what reserve_product_stock took.
create or replace function public.release_product_stock(p_checkout_attempt_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  public.pending_orders%rowtype;
  v_line record;
  v_var  public.product_variants%rowtype;
begin
  select * into v_row
    from public.pending_orders
   where checkout_attempt_key = p_checkout_attempt_key
     for update;
  if not found or v_row.status <> 'reserved' then
    return;
  end if;

  perform 1
    from public.products
   where id in (select distinct (e.item ->> 'id')::uuid
                  from jsonb_array_elements(coalesce(v_row.reserved_items, '[]'::jsonb)) as e(item))
   order by id
     for update;

  for v_line in
    select r.variant_id, sum(r.qty)::integer as qty
      from (
        select coalesce(
                 nullif(e.item ->> 'variantId', '')::uuid,
                 (select pv.id from public.product_variants pv
                   where pv.product_id = (e.item ->> 'id')::uuid and pv.label = nullif(e.item ->> 'size', '')
                   order by pv.position limit 1)
               ) as variant_id,
               (e.item ->> 'qty')::integer as qty
          from jsonb_array_elements(coalesce(v_row.reserved_items, '[]'::jsonb)) as e(item)
      ) r
     where r.variant_id is not null
     group by r.variant_id
     order by r.variant_id
  loop
    select * into v_var from public.product_variants where id = v_line.variant_id for update;
    if not found then
      continue;  -- variant was deleted meanwhile
    end if;
    if v_var.track_inventory then
      update public.product_variants set stock = stock + v_line.qty where id = v_var.id;
    end if;
  end loop;

  update public.pending_orders
     set status = 'released', released_at = now()
   where checkout_attempt_key = p_checkout_attempt_key;
end;
$$;

-- ---- recompute_product_rollup(p_product_id) ---------------------------------
-- Derives the product's list-page columns from its ACTIVE variants: price = lowest selling price,
-- price_max, mrp (of the cheapest variant, so the card's "% off" matches its price), discount_pct, in_stock,
-- has_variants (more than one purchasable option) and total_stock. Only writes when something
-- changed, so an ordinary stock decrement does not touch the product row.
create or replace function public.recompute_product_rollup(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min      numeric;
  v_max      numeric;
  v_mrp      numeric;
  v_active   integer;
  v_in_stock boolean;
  v_total    integer;
  v_pct      integer;
begin
  select min(price), max(price), count(*),
         coalesce(bool_or(not track_inventory or stock > 0), false),
         coalesce(sum(case when track_inventory then stock else 0 end), 0)
    into v_min, v_max, v_active, v_in_stock, v_total
    from public.product_variants
   where product_id = p_product_id and active;

  select mrp into v_mrp
    from public.product_variants
   where product_id = p_product_id and active
   order by price asc, position asc, id
   limit 1;

  v_pct := case when v_mrp is not null and v_min is not null and v_mrp > v_min and v_mrp > 0
                then round((v_mrp - v_min) / v_mrp * 100)::integer else 0 end;

  update public.products
     set price = v_min, price_max = v_max, mrp = v_mrp, discount_pct = v_pct,
         in_stock = v_in_stock, has_variants = (v_active > 1), total_stock = v_total
   where id = p_product_id
     and (price, price_max, mrp, discount_pct, in_stock, has_variants, total_stock)
         is distinct from (v_min, v_max, v_mrp, v_pct, v_in_stock, (v_active > 1), v_total);
end;
$$;

create or replace function public.product_variants_rollup_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_product_rollup(old.product_id);
    return old;
  end if;
  perform public.recompute_product_rollup(new.product_id);
  if tg_op = 'UPDATE' and old.product_id <> new.product_id then
    perform public.recompute_product_rollup(old.product_id);
  end if;
  return new;
end;
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- products: status is the source of truth (a legacy writer setting only `available` is honoured),
-- denormalised leaf category name, and the lower-cased text the shop search runs against.
create or replace function public.products_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_cat text;
begin
  if tg_op = 'INSERT' then
    if new.available is false and new.status = 'active' then
      new.status := 'archived';
    end if;
  elsif new.available is distinct from old.available and new.status is not distinct from old.status then
    new.status := case when new.available then 'active' else 'archived' end;
  end if;
  new.available := (new.status = 'active');

  if new.category_id is not null and (tg_op = 'INSERT' or new.category_id is distinct from old.category_id) then
    select name into v_cat from public.categories where id = new.category_id;
    if v_cat is not null then new.cat := v_cat; end if;
  end if;

  new.search_text := lower(concat_ws(' ',
    new.name, new.brand, new.cat, new.subtitle, new.product_number,
    (select string_agg(t, ' ')
       from jsonb_array_elements_text(case when jsonb_typeof(new.tags) = 'array' then new.tags else '[]'::jsonb end) as t)
  ));
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.categories_after_rename()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is distinct from old.name then
    update public.products set cat = new.name where category_id = new.id;
  end if;
  return new;
end;
$$;

create or replace function public.recompute_product_rating(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.products p
     set rating_avg = coalesce(r.avg_rating, 0), rating_count = coalesce(r.n, 0)
    from (select round(avg(rating)::numeric, 2) as avg_rating, count(*)::integer as n
            from public.reviews
           where product_id = p_product_id and status = 'approved') r
   where p.id = p_product_id;
end;
$$;

create or replace function public.reviews_rating_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_product_rating(old.product_id);
    return old;
  end if;
  perform public.recompute_product_rating(new.product_id);
  return new;
end;
$$;

drop trigger if exists product_variants_rollup on public.product_variants;
create trigger product_variants_rollup
  after insert or update or delete on public.product_variants
  for each row execute function public.product_variants_rollup_trg();

drop trigger if exists product_variants_touch on public.product_variants;
create trigger product_variants_touch
  before update on public.product_variants
  for each row execute function public.touch_updated_at();

drop trigger if exists products_before_write on public.products;
create trigger products_before_write
  before insert or update on public.products
  for each row execute function public.products_before_write();

drop trigger if exists categories_touch on public.categories;
create trigger categories_touch
  before update on public.categories
  for each row execute function public.touch_updated_at();

drop trigger if exists categories_after_rename on public.categories;
create trigger categories_after_rename
  after update on public.categories
  for each row execute function public.categories_after_rename();

-- The previous release wrote status 'Paid' / 'Pending'. Accept that (as 'Placed') so a checkout that lands
-- between running this script and deploying the new code is not rejected by the status check.
create or replace function public.orders_normalize_legacy()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('Paid', 'Pending') then
    new.status := 'Placed';
  end if;
  return new;
end;
$$;
drop trigger if exists orders_normalize_legacy on public.orders;
create trigger orders_normalize_legacy
  before insert or update of status on public.orders
  for each row execute function public.orders_normalize_legacy();

drop trigger if exists orders_touch on public.orders;
create trigger orders_touch
  before update on public.orders
  for each row execute function public.touch_updated_at();

drop trigger if exists order_returns_touch on public.order_returns;
create trigger order_returns_touch
  before update on public.order_returns
  for each row execute function public.touch_updated_at();

drop trigger if exists reviews_rating on public.reviews;
create trigger reviews_rating
  after insert or update or delete on public.reviews
  for each row execute function public.reviews_rating_trg();

-- ---- admin_adjust_stock(p_variant_id, p_delta, p_set_to, p_reason, p_note) ----
-- The ONLY way the admin UI changes stock on an existing variant. Works on the live value under
-- the same lock order as checkout (product, then variant), so it can never overwrite a sale that
-- landed a moment earlier -- the old whole-row product save could. Give exactly one of p_delta
-- (relative, e.g. +20 received) or p_set_to (absolute recount). Writes a ledger row.
-- Returns the new stock. Executable by the signed-in admin only (checked inside).
create or replace function public.admin_adjust_stock(
  p_variant_id uuid,
  p_delta      integer default null,
  p_set_to     integer default null,
  p_reason     text    default 'adjustment',
  p_note       text    default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_var   public.product_variants%rowtype;
  v_new   integer;
  v_actor text;
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if (p_delta is null) = (p_set_to is null) then
    raise exception 'give exactly one of p_delta or p_set_to' using errcode = '22023';
  end if;

  perform 1 from public.products where id = (select product_id from public.product_variants where id = p_variant_id) for update;
  select * into v_var from public.product_variants where id = p_variant_id for update;
  if not found then
    raise exception 'VARIANT_NOT_FOUND: %', p_variant_id using errcode = 'P0002';
  end if;

  v_new := coalesce(p_set_to, v_var.stock + p_delta);
  if v_new < 0 then
    raise exception 'stock cannot go below zero (would be %)', v_new using errcode = '22023';
  end if;

  update public.product_variants set stock = v_new where id = v_var.id;

  select email into v_actor from auth.users where id = auth.uid();
  insert into public.inventory_movements (variant_id, product_id, delta, reason, note, actor, stock_after)
  values (v_var.id, v_var.product_id, v_new - v_var.stock, coalesce(nullif(p_reason, ''), 'adjustment'), p_note, v_actor, v_new);
  return v_new;
end;
$$;

-- ---- restock_items(p_ref, p_items, p_reason) -----------------------------------
-- Adds stock back for [{id, variantId, qty}] lines (cancelled order, returned goods) and writes
-- ledger rows. Untracked variants and gift-card lines are skipped. Returns lines restocked.
-- service_role only; callers guard against double use (see restock_order_items).
create or replace function public.restock_items(p_ref text, p_items jsonb, p_reason text default 'cancel')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line  record;
  v_var   public.product_variants%rowtype;
  v_count integer := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return 0;
  end if;

  perform 1
    from public.products
   where id in (select distinct (e.item ->> 'id')::uuid
                  from jsonb_array_elements(p_items) as e(item)
                 where coalesce((e.item ->> 'isGiftCard')::boolean, false) = false)
   order by id
     for update;

  for v_line in
    select r.variant_id, sum(r.qty)::integer as qty
      from (
        select coalesce(
                 nullif(e.item ->> 'variantId', '')::uuid,
                 (select pv.id from public.product_variants pv
                   where pv.product_id = (e.item ->> 'id')::uuid and pv.label = nullif(e.item ->> 'size', '')
                   order by pv.position limit 1)
               ) as variant_id,
               (e.item ->> 'qty')::integer as qty
          from jsonb_array_elements(p_items) as e(item)
         where coalesce((e.item ->> 'isGiftCard')::boolean, false) = false
      ) r
     where r.variant_id is not null and r.qty > 0
     group by r.variant_id
     order by r.variant_id
  loop
    select * into v_var from public.product_variants where id = v_line.variant_id for update;
    if not found or not v_var.track_inventory then
      continue;
    end if;
    update public.product_variants set stock = stock + v_line.qty where id = v_var.id;
    insert into public.inventory_movements (variant_id, product_id, delta, reason, ref, stock_after)
    values (v_var.id, v_var.product_id, v_line.qty, p_reason, p_ref, v_var.stock + v_line.qty);
    update public.products set sales_count = greatest(sales_count - v_line.qty, 0) where id = v_var.product_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---- restock_order_items(p_order_id, p_reason) ------------------------------
-- Gives the stock of a WHOLE order back, exactly once (orders.restocked_at is the compare-and-set).
-- An order flagged inventory_issue never had its stock decremented (its reservation lapsed before
-- payment landed), so it is marked but NOT restocked -- adding it would invent stock.
-- Returns the number of lines restocked, or 0 when already restocked / nothing to do.
create or replace function public.restock_order_items(p_order_id text, p_reason text default 'cancel')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  update public.orders
     set restocked_at = now()
   where order_id = p_order_id and restocked_at is null
  returning * into v_order;
  if not found then
    return 0;
  end if;
  if v_order.inventory_issue is not null then
    return 0;
  end if;
  return public.restock_items(p_order_id, v_order.items, p_reason);
end;
$$;

-- ---- record_order_sale(p_order_id, p_items) ---------------------------------
-- Called by the server once an order row exists: writes the 'sale' ledger rows (stock itself was
-- already taken at reservation time) and bumps products.sales_count for the popularity sort.
create or replace function public.record_order_sale(p_order_id text, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line record;
  v_stock integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return;
  end if;
  for v_line in
    select nullif(e.item ->> 'variantId', '')::uuid as variant_id,
           (e.item ->> 'id')::uuid                   as product_id,
           (e.item ->> 'qty')::integer               as qty
      from jsonb_array_elements(p_items) as e(item)
     where coalesce((e.item ->> 'isGiftCard')::boolean, false) = false
  loop
    select stock into v_stock from public.product_variants where id = v_line.variant_id;
    insert into public.inventory_movements (variant_id, product_id, delta, reason, ref, stock_after)
    values (v_line.variant_id, v_line.product_id, -v_line.qty, 'sale', p_order_id, v_stock);
    update public.products set sales_count = sales_count + v_line.qty where id = v_line.product_id;
  end loop;
end;
$$;

-- ---- transition_order(p_order_id, p_to, p_allowed, p_by, p_note, p_cancel_reason) -----------
-- The ONLY place an order's status changes. A single UPDATE that succeeds only while the order is
-- still in one of p_allowed, so two clicks / two admins / a customer and an admin racing can never
-- both cancel (or both ship) it. Stamps the matching *_at column, appends to the customer-visible
-- timeline, and settles a Cash-on-Delivery order as paid when it is delivered.
-- Returns the updated order as JSON, or NULL when the order was not in an allowed state.
create or replace function public.transition_order(
  p_order_id      text,
  p_to            text,
  p_allowed       text[],
  p_by            text,
  p_note          text default null,
  p_cancel_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.orders%rowtype;
begin
  update public.orders
     set status       = p_to,
         confirmed_at = case when p_to = 'Confirmed' then coalesce(confirmed_at, now()) else confirmed_at end,
         shipped_at   = case when p_to in ('Shipped', 'Out for Delivery') then coalesce(shipped_at, now()) else shipped_at end,
         delivered_at = case when p_to = 'Delivered' then coalesce(delivered_at, now()) else delivered_at end,
         cancelled_at = case when p_to = 'Cancelled' then now() else cancelled_at end,
         cancel_reason = case when p_to = 'Cancelled' then p_cancel_reason else cancel_reason end,
         cancelled_by  = case when p_to = 'Cancelled' then p_by else cancelled_by end,
         payment_status = case when p_to = 'Delivered' and payment_status = 'cod_pending' then 'paid' else payment_status end,
         timeline     = timeline || jsonb_build_array(jsonb_strip_nulls(
                          jsonb_build_object('status', p_to, 'at', now(), 'by', p_by, 'note', p_note)))
   where order_id = p_order_id and status = any (p_allowed)
  returning * into v;
  if not found then
    return null;
  end if;
  return to_jsonb(v);
end;
$$;

-- ---- admin reporting (SECURITY DEFINER; every one checks is_admin() itself) -----------------------
-- The browser cannot aggregate whole tables (and a customer list needs profiles, which RLS keeps
-- private), so the admin screens call these. A non-admin gets 'not authorized'.

-- Customers with their order totals. p_search matches name, email or phone.
create or replace function public.admin_customers(p_search text default null, p_limit integer default 25, p_offset integer default 0)
returns table (
  id uuid, name text, email text, phone text, created_at timestamptz,
  order_count bigint, total_spent numeric, last_order_at timestamptz, total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
  with base as (
    select p.id as c_id, p.name as c_name, u.email::text as c_email, p.phone as c_phone, p.created_at as c_created,
           count(o.id) filter (where o.status <> 'Cancelled')                                 as c_orders,
           coalesce(sum(o.total - o.refunded_amount) filter (where o.status <> 'Cancelled'), 0) as c_spent,
           max(o.created_at)                                                                   as c_last
      from public.profiles p
      left join auth.users u on u.id = p.id
      left join public.orders o on o.user_id = p.id and o.deleted_at is null
     where coalesce(p_search, '') = ''
        or p.name  ilike '%' || p_search || '%'
        or u.email ilike '%' || p_search || '%'
        or p.phone ilike '%' || p_search || '%'
     group by p.id, p.name, u.email, p.phone, p.created_at
  )
  select b.c_id, b.c_name, b.c_email, b.c_phone, b.c_created, b.c_orders, b.c_spent, b.c_last, count(*) over ()
    from base b
   order by b.c_last desc nulls last, b.c_created desc
   limit greatest(coalesce(p_limit, 25), 1) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- Sales per day (India time). Cancelled orders are excluded. "sales" = what the goods + delivery
-- cost the customer before any gift card (total + gift_card_applied); refunds are shown separately.
create or replace function public.admin_sales_daily(p_from timestamptz, p_to timestamptz)
returns table (day date, orders bigint, sales numeric, refunds numeric, units bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
  select (o.created_at at time zone 'Asia/Kolkata')::date as d,
         count(*)::bigint,
         coalesce(sum(o.total + o.gift_card_applied), 0),
         coalesce(sum(o.refunded_amount), 0),
         coalesce(sum((select coalesce(sum((i ->> 'qty')::integer), 0) from jsonb_array_elements(o.items) i
                        where coalesce((i ->> 'isGiftCard')::boolean, false) = false)), 0)::bigint
    from public.orders o
   where o.created_at >= p_from and o.created_at < p_to
     and o.status <> 'Cancelled' and o.deleted_at is null
   group by 1
   order by 1;
end;
$$;

-- Best sellers in a period, by revenue (gift cards excluded).
create or replace function public.admin_sales_by_product(p_from timestamptz, p_to timestamptz, p_limit integer default 50)
returns table (product_id text, name text, units bigint, revenue numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
  select i ->> 'id', max(i ->> 'name'), sum((i ->> 'qty')::integer)::bigint,
         sum((i ->> 'qty')::integer * (i ->> 'price')::numeric)
    from public.orders o, jsonb_array_elements(o.items) i
   where o.created_at >= p_from and o.created_at < p_to
     and o.status <> 'Cancelled' and o.deleted_at is null
     and coalesce((i ->> 'isGiftCard')::boolean, false) = false
   group by i ->> 'id'
   order by 4 desc
   limit greatest(coalesce(p_limit, 50), 1);
end;
$$;

-- Sales by category name in a period.
create or replace function public.admin_sales_by_category(p_from timestamptz, p_to timestamptz)
returns table (category text, units bigint, revenue numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
  select coalesce(nullif(i ->> 'cat', ''), 'Uncategorised'), sum((i ->> 'qty')::integer)::bigint,
         sum((i ->> 'qty')::integer * (i ->> 'price')::numeric)
    from public.orders o, jsonb_array_elements(o.items) i
   where o.created_at >= p_from and o.created_at < p_to
     and o.status <> 'Cancelled' and o.deleted_at is null
     and coalesce((i ->> 'isGiftCard')::boolean, false) = false
   group by 1
   order by 3 desc;
end;
$$;

-- ---- release_stock_lines(p_items) ----------------------------------------------------------
-- Gives stock back for [{id, variantId, qty}] lines WITHOUT a ledger row or a sales-counter change.
-- For a reservation that was consumed (claim_pending_order) by an order write that then FAILED: the
-- units were never sold, so they simply go back. service_role only.
create or replace function public.release_stock_lines(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line record;
  v_var  public.product_variants%rowtype;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return;
  end if;
  perform 1
    from public.products
   where id in (select distinct (e.item ->> 'id')::uuid from jsonb_array_elements(p_items) as e(item))
   order by id
     for update;
  for v_line in
    select r.variant_id, sum(r.qty)::integer as qty
      from (
        select coalesce(
                 nullif(e.item ->> 'variantId', '')::uuid,
                 (select pv.id from public.product_variants pv
                   where pv.product_id = (e.item ->> 'id')::uuid and pv.label = nullif(e.item ->> 'size', '')
                   order by pv.position limit 1)
               ) as variant_id,
               (e.item ->> 'qty')::integer as qty
          from jsonb_array_elements(p_items) as e(item)
      ) r
     where r.variant_id is not null and r.qty > 0
     group by r.variant_id
     order by r.variant_id
  loop
    select * into v_var from public.product_variants where id = v_line.variant_id for update;
    if found and v_var.track_inventory then
      update public.product_variants set stock = stock + v_line.qty where id = v_var.id;
    end if;
  end loop;
end;
$$;

-- ---- claim_release_flag(p_key, p_flag) -------------------------------------------------------
-- Atomically marks "this checkout attempt's coupon use / gift-card balance has been given back" in ONE
-- statement (jsonb_set on the current value), so releasing the coupon and the gift card can never
-- overwrite each other's marker. Returns true only for the single caller that set it.
create or replace function public.claim_release_flag(p_key text, p_flag text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if p_flag not in ('couponReleased', 'giftCardReleased') then
    raise exception 'claim_release_flag: unknown flag %', p_flag using errcode = '22023';
  end if;
  update public.pending_orders
     set computed = jsonb_set(coalesce(computed, '{}'::jsonb), array[p_flag], 'true'::jsonb, true)
   where checkout_attempt_key = p_key and (computed ->> p_flag) is null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- ---- reserve_refund(p_order_id, p_want, p_allow_online, p_manual, p_by, p_reason) ------------------
-- Decides, UNDER A ROW LOCK, how much of a requested refund can still be paid out and records it as
-- 'pending' before any money moves. Two concurrent refunds (double click, cancel + goodwill refund, two
-- admins) therefore serialise here and can never total more than was charged:
--   online part = min(want, total - already refunded)            (to the original payment, or MANUAL for
--                                                                 COD / free orders; 0 when p_allow_online is false)
--   gift part   = what is left of want after the online part, up to the gift card amount not yet returned
-- Returns { online, gift, online_entry, gift_entry, gift_code } or NULL when the order does not exist.
-- The caller moves the money, then calls finish_refund() for each entry.
create or replace function public.reserve_refund(
  p_order_id     text,
  p_want         numeric,
  p_allow_online boolean,
  p_manual       boolean,
  p_by           text,
  p_reason       text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v             public.orders%rowtype;
  v_online_done numeric;
  v_gift_done   numeric;
  v_online_left numeric;
  v_gift_left   numeric;
  v_to_online   numeric := 0;
  v_to_gift     numeric := 0;
  v_online_id   text;
  v_gift_id     text;
  v_entries     jsonb := '[]'::jsonb;
begin
  select * into v from public.orders where order_id = p_order_id for update;
  if not found then
    return null;
  end if;

  select coalesce(sum((r ->> 'amount')::numeric) filter (where coalesce(r ->> 'type', 'online') <> 'gift_card' and coalesce(r ->> 'status', 'processed') <> 'failed'), 0),
         coalesce(sum((r ->> 'amount')::numeric) filter (where r ->> 'type' = 'gift_card' and coalesce(r ->> 'status', 'processed') <> 'failed'), 0)
    into v_online_done, v_gift_done
    from jsonb_array_elements(v.refunds) r;

  v_online_left := greatest(round(v.total - v_online_done, 2), 0);
  v_gift_left   := greatest(round(coalesce(v.gift_card_applied, 0) - v_gift_done, 2), 0);

  if p_allow_online then
    v_to_online := least(round(p_want, 2), v_online_left);
  end if;
  if v.gift_card_code is not null then
    v_to_gift := least(greatest(round(p_want - least(p_want, v_online_left), 2), 0), v_gift_left);
  end if;

  if v_to_online > 0 then
    v_online_id := gen_random_uuid()::text;
    v_entries := v_entries || jsonb_build_array(jsonb_build_object(
      'id', v_online_id, 'amount', v_to_online, 'at', now(), 'reason', p_reason, 'by', p_by,
      'type', case when p_manual then 'manual' else 'online' end, 'status', 'pending'));
  end if;
  if v_to_gift > 0 then
    v_gift_id := gen_random_uuid()::text;
    v_entries := v_entries || jsonb_build_array(jsonb_build_object(
      'id', v_gift_id, 'amount', v_to_gift, 'at', now(), 'reason', p_reason, 'by', p_by,
      'type', 'gift_card', 'code', v.gift_card_code, 'status', 'pending'));
  end if;

  if jsonb_array_length(v_entries) > 0 then
    update public.orders
       set refunds         = refunds || v_entries,
           refunded_amount = refunded_amount + v_to_online,
           payment_status  = case when v_to_online <= 0 then payment_status
                                  when refunded_amount + v_to_online >= total - 0.005 then 'refunded'
                                  else 'partially_refunded' end
     where id = v.id;
  end if;

  return jsonb_build_object('online', v_to_online, 'gift', v_to_gift,
                            'online_entry', v_online_id, 'gift_entry', v_gift_id, 'gift_code', v.gift_card_code);
end;
$$;

-- ---- finish_refund(p_order_id, p_entry_id, p_ok, p_ref) ---------------------------------------------
-- Settles one reserved refund entry: processed (with the gateway reference) or failed. A failed ONLINE
-- entry gives its amount back to the refundable balance and puts payment_status back, so the books show
-- only money that really left. A failed gift-card entry just stays marked failed.
create or replace function public.finish_refund(p_order_id text, p_entry_id text, p_ok boolean, p_ref text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v          public.orders%rowtype;
  v_entry    jsonb;
  v_new      jsonb;
  v_amount   numeric;
  v_type     text;
  v_reverted numeric;
begin
  select * into v from public.orders where order_id = p_order_id for update;
  if not found then
    return;
  end if;
  select e into v_entry from jsonb_array_elements(v.refunds) e where e ->> 'id' = p_entry_id;
  if v_entry is null then
    return;
  end if;
  v_amount := (v_entry ->> 'amount')::numeric;
  v_type   := coalesce(v_entry ->> 'type', 'online');

  select coalesce(jsonb_agg(
           case when e ->> 'id' = p_entry_id
                then e || jsonb_build_object('status', case when p_ok then 'processed' else 'failed' end, 'ref', p_ref)
                else e end order by ord), '[]'::jsonb)
    into v_new
    from jsonb_array_elements(v.refunds) with ordinality as t(e, ord);

  if p_ok or v_type = 'gift_card' then
    update public.orders set refunds = v_new where id = v.id;
  else
    v_reverted := greatest(v.refunded_amount - v_amount, 0);
    update public.orders
       set refunds         = v_new,
           refunded_amount = v_reverted,
           payment_status  = case when v_reverted <= 0
                                  then (case when v.payment_method = 'cod' and v.status <> 'Delivered' then 'cod_pending' else 'paid' end)
                                  when v_reverted >= v.total - 0.005 then 'refunded'
                                  else 'partially_refunded' end
     where id = v.id;
  end if;
end;
$$;

-- ---- catalog_facets(p_category_ids, p_words) --------------------------------
-- One cheap call for the shop's filter rail: how many products match, the price range, the brand
-- list with counts and, per attribute key, its values with counts. p_words = every word that must
-- appear in a product's search text (null/empty = no text filter). Public (RLS still applies).
create or replace function public.catalog_facets(p_category_ids uuid[] default null, p_words text[] default null)
returns jsonb
language sql
stable
set search_path = public
as $$
  with base as (
    select p.*
      from public.products p
     where p.status = 'active'
       and (p_category_ids is null or p.category_id = any (p_category_ids))
       and (p_words is null or not exists (
              select 1 from unnest(p_words) w
               where btrim(w) <> '' and p.search_text not like '%' || lower(btrim(w)) || '%'))
  )
  select jsonb_build_object(
    'total',     (select count(*) from base),
    'price_min', (select min(price) from base),
    'price_max', (select max(price) from base),
    'brands',    coalesce((select jsonb_agg(jsonb_build_object('name', brand, 'count', n) order by n desc, brand)
                             from (select brand, count(*) as n from base
                                    where brand is not null and btrim(brand) <> '' group by brand) b), '[]'::jsonb),
    'attributes', coalesce((select jsonb_object_agg(k, vals)
                              from (select a.key as k,
                                           jsonb_agg(jsonb_build_object('value', a.value, 'count', a.n) order by a.n desc, a.value) as vals
                                      from (select kv.key, kv.value, count(*) as n
                                              from base, jsonb_each_text(base.attributes) kv
                                             where kv.value is not null and btrim(kv.value) <> ''
                                             group by kv.key, kv.value) a
                                     group by a.key) x), '{}'::jsonb)
  );
$$;


-- ---- claim_pending_order(p_receipt) -----------------------------------------
-- Contract: atomically CONSUME the reservation row for an order number. Deletes the
-- pending_orders row whose receipt = p_receipt and returns it as one JSON object (so callers read
-- .status; 'released' means the stock hold had already expired and was given back), or returns
-- NULL when there is no row (already claimed, never existed, or purged). Because it is a single
-- DELETE ... RETURNING, exactly one of {the finalizing request, the expiry sweep} wins the row.
-- Stock that was decremented at reservation time stays decremented (that is the sale).
create or replace function public.claim_pending_order(p_receipt text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.pending_orders%rowtype;
begin
  delete from public.pending_orders
   where receipt = p_receipt
  returning * into v_row;

  if not found then
    return null;
  end if;
  return to_jsonb(v_row);
end;
$$;

-- ---- _release_credits_for(p_key)  (internal helper) -------------------------
-- Gives back the coupon use and the gift-card balance held by one checkout attempt, each AT MOST
-- ONCE, using the same compare-and-set flags the app uses (computed.couponReleased /
-- computed.giftCardReleased in src/utils/reservations.js). Used only by release_expired_reservations.
create or replace function public._release_credits_for(p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      public.pending_orders%rowtype;
  v_computed jsonb;
begin
  select * into v_row from public.pending_orders where checkout_attempt_key = p_key for update;
  if not found then
    return;
  end if;
  v_computed := coalesce(v_row.computed, '{}'::jsonb);

  if nullif(v_computed ->> 'couponCode', '') is not null
     and coalesce((v_computed ->> 'computedDiscount')::numeric, 0) > 0
     and v_computed ->> 'couponReleased' is null then
    perform public.release_coupon_use(v_computed ->> 'couponCode');
    v_computed := v_computed || jsonb_build_object('couponReleased', true);
  end if;

  if nullif(v_computed ->> 'giftCardCode', '') is not null
     and coalesce((v_computed ->> 'computedGiftCardApplied')::numeric, 0) > 0
     and v_computed ->> 'giftCardReleased' is null then
    update public.gift_cards
       set balance = balance + (v_computed ->> 'computedGiftCardApplied')::numeric
     where code = upper(btrim(v_computed ->> 'giftCardCode'));
    v_computed := v_computed || jsonb_build_object('giftCardReleased', true);
  end if;

  update public.pending_orders set computed = v_computed where checkout_attempt_key = p_key;
end;
$$;

-- ---- release_expired_reservations() -----------------------------------------
-- Contract: sweep abandoned checkouts; called (best-effort, errors ignored) at the start of every
-- api/razorpay-create-order request. For each 'reserved' attempt whose expires_at has passed it
-- gives back the stock (-> row becomes 'released'), the coupon use and the gift-card balance,
-- each at most once (flags shared with the app-level sweep in src/utils/reservations.js, which
-- therefore never double-releases). Also releases claims stuck in 'reserving' for >10 minutes
-- (a crashed request) and deletes old rows: 'released' after 30 days, so a late payment can still
-- be recovered by the webhook. One bad row never blocks the rest (each is its own sub-transaction).
-- Rows locked by a concurrent claim_pending_order() are skipped, not waited for.
create or replace function public.release_expired_reservations()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  for v_row in
    select checkout_attempt_key
      from public.pending_orders
     where status = 'reserved' and expires_at < now()
     order by expires_at
     limit 200
       for update skip locked
  loop
    begin
      perform public._release_credits_for(v_row.checkout_attempt_key);
      perform public.release_product_stock(v_row.checkout_attempt_key);
    exception when others then
      raise warning 'release_expired_reservations: attempt % not released: %', v_row.checkout_attempt_key, sqlerrm;
    end;
  end loop;

  for v_row in
    select checkout_attempt_key
      from public.pending_orders
     where status = 'reserving' and expires_at < now() - interval '10 minutes'
     order by expires_at
     limit 200
       for update skip locked
  loop
    begin
      perform public._release_credits_for(v_row.checkout_attempt_key);
      delete from public.pending_orders
       where checkout_attempt_key = v_row.checkout_attempt_key and status = 'reserving';
    exception when others then
      raise warning 'release_expired_reservations: stale claim % not cleared: %', v_row.checkout_attempt_key, sqlerrm;
    end;
  end loop;

  delete from public.pending_orders
   where status = 'released'
     and coalesce(released_at, expires_at) < now() - interval '30 days';
end;
$$;


-- =============================================================================
-- SECTION 5 -- ROW LEVEL SECURITY
-- =============================================================================
alter table public.profiles              enable row level security;
alter table public.products              enable row level security;
alter table public.orders                enable row level security;
alter table public.enquiries             enable row level security;
alter table public.stories               enable row level security;
alter table public.hero_slides           enable row level security;
alter table public.settings              enable row level security;
alter table public.coupons               enable row level security;
alter table public.gift_cards            enable row level security;
alter table public.email_templates       enable row level security;
alter table public.whatsapp_templates    enable row level security;
alter table public.email_sends           enable row level security;
alter table public.product_notifications enable row level security;
alter table public.pending_orders        enable row level security;
alter table public.used_payments         enable row level security;
alter table public.verified_phones       enable row level security;
alter table public.app_admins            enable row level security;

-- (select ...) wrappers below make Postgres evaluate auth.uid()/is_admin() once per statement.

-- ---- profiles: a customer reads / creates / updates ONLY their own row --------
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
drop policy if exists profiles_admin_select on public.profiles;
create policy profiles_admin_select on public.profiles
  for select to authenticated using ((select public.is_admin()));
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---- products: public catalogue (also hidden items: product page, cart clean-up and
--      api/product-share read them); only the admin writes -----------------------
drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products
  for select to anon, authenticated using (status <> 'draft');
drop policy if exists products_admin_all on public.products;
create policy products_admin_all on public.products
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---- hero_slides: public sees active slides; admin sees/edits all ------------
drop policy if exists hero_slides_public_read on public.hero_slides;
create policy hero_slides_public_read on public.hero_slides
  for select to anon, authenticated using (active);
drop policy if exists hero_slides_admin_all on public.hero_slides;
create policy hero_slides_admin_all on public.hero_slides
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---- stories: public sees published stories; admin sees/edits all -------------
drop policy if exists stories_public_read on public.stories;
create policy stories_public_read on public.stories
  for select to anon, authenticated using (published);
drop policy if exists stories_admin_all on public.stories;
create policy stories_admin_all on public.stories
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---- settings: brand settings are public (header/footer/home read them); admin writes
drop policy if exists settings_public_read on public.settings;
create policy settings_public_read on public.settings
  for select to anon, authenticated using (true);
drop policy if exists settings_admin_all on public.settings;
create policy settings_admin_all on public.settings
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---- coupons: logged-in customers see ACTIVE coupons (Account -> Coupons tab); guests
--      validate codes through api/lookup.js (service role). Admin manages all. ---
-- Only PUBLIC, currently-valid coupons are listed; private codes are never enumerable.
drop policy if exists coupons_authenticated_read_active on public.coupons;
create policy coupons_authenticated_read_active on public.coupons
  for select to authenticated
  using (active and is_public
         and (starts_at is null or starts_at <= now())
         and (expires_at is null or expires_at > now())
         and (max_uses is null or max_uses <= 0 or times_used < max_uses));
drop policy if exists coupons_admin_all on public.coupons;
create policy coupons_admin_all on public.coupons
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---- gift_cards: browser never reads them (codes are looked up by api/lookup.js with the
--      service role); the admin may view the issued list --------------------------
drop policy if exists gift_cards_admin_read on public.gift_cards;
create policy gift_cards_admin_read on public.gift_cards
  for select to authenticated using ((select public.is_admin()));

-- ---- email / whatsapp templates: admin only (server reads them with the service role) --
drop policy if exists email_templates_admin_all on public.email_templates;
create policy email_templates_admin_all on public.email_templates
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists whatsapp_templates_admin_all on public.whatsapp_templates;
create policy whatsapp_templates_admin_all on public.whatsapp_templates
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---- email_sends: audit log -- admin may read; inserts come from the server only -----
drop policy if exists email_sends_admin_read on public.email_sends;
create policy email_sends_admin_read on public.email_sends
  for select to authenticated using ((select public.is_admin()));

-- ---- orders: a customer reads their own orders (Account -> Orders); the admin reads and
--      updates all (status, tracking, soft delete). Inserts: server only. No hard delete. --
drop policy if exists orders_select_own on public.orders;
create policy orders_select_own on public.orders
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists orders_admin_select on public.orders;
create policy orders_admin_select on public.orders
  for select to authenticated using ((select public.is_admin()));
drop policy if exists orders_admin_update on public.orders;
create policy orders_admin_update on public.orders
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---- enquiries: a customer reads their own; admin reads/updates/deletes all.
--      Inserts: server only (api/send-enquiry-whatsapp.js) -- no anon INSERT policy. ---
drop policy if exists enquiries_select_own on public.enquiries;
create policy enquiries_select_own on public.enquiries
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists enquiries_admin_select on public.enquiries;
create policy enquiries_admin_select on public.enquiries
  for select to authenticated using ((select public.is_admin()));
drop policy if exists enquiries_admin_update on public.enquiries;
create policy enquiries_admin_update on public.enquiries
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists enquiries_admin_delete on public.enquiries;
create policy enquiries_admin_delete on public.enquiries
  for delete to authenticated using ((select public.is_admin()));

-- ---- product_notifications: customer reads/creates their own subscriptions; admin manages --
drop policy if exists product_notifications_select_own on public.product_notifications;
create policy product_notifications_select_own on public.product_notifications
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists product_notifications_insert_own on public.product_notifications;
create policy product_notifications_insert_own on public.product_notifications
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists product_notifications_admin_all on public.product_notifications;
create policy product_notifications_admin_all on public.product_notifications
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- pending_orders, used_payments, verified_phones, app_admins: RLS ON, intentionally NO policies
-- (payment / identity data -- service_role only).

-- ---- v2: categories / variants: public catalogue, admin writes ---------------------
alter table public.categories          enable row level security;
alter table public.product_variants    enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.order_notes         enable row level security;
alter table public.order_returns       enable row level security;
alter table public.reviews             enable row level security;
alter table public.wishlists           enable row level security;

drop policy if exists categories_public_read on public.categories;
create policy categories_public_read on public.categories
  for select to anon, authenticated using (active);
drop policy if exists categories_admin_all on public.categories;
create policy categories_admin_all on public.categories
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- variants of a draft product stay private; inactive variants are admin-only
drop policy if exists product_variants_public_read on public.product_variants;
create policy product_variants_public_read on public.product_variants
  for select to anon, authenticated
  using (active and exists (select 1 from public.products p where p.id = product_id and p.status <> 'draft'));
drop policy if exists product_variants_admin_all on public.product_variants;
create policy product_variants_admin_all on public.product_variants
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- stock ledger: admin read-only (rows are written by the server / SECURITY DEFINER RPCs)
drop policy if exists inventory_movements_admin_read on public.inventory_movements;
create policy inventory_movements_admin_read on public.inventory_movements
  for select to authenticated using ((select public.is_admin()));

-- internal order notes: admin only
drop policy if exists order_notes_admin_all on public.order_notes;
create policy order_notes_admin_all on public.order_notes
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- returns: a customer reads their own; the admin reads/updates all. Inserts: server only.
drop policy if exists order_returns_select_own on public.order_returns;
create policy order_returns_select_own on public.order_returns
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists order_returns_admin_all on public.order_returns;
create policy order_returns_admin_all on public.order_returns
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- reviews: everyone reads APPROVED ones; a customer reads their own and may post one for a
-- product they received (verified purchase = a Delivered order of theirs contains it).
drop policy if exists reviews_public_read on public.reviews;
create policy reviews_public_read on public.reviews
  for select to anon, authenticated using (status = 'approved');
drop policy if exists reviews_select_own on public.reviews;
create policy reviews_select_own on public.reviews
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists reviews_insert_own on public.reviews;
create policy reviews_insert_own on public.reviews
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and verified_purchase
    and exists (
      select 1 from public.orders o
       where o.user_id = (select auth.uid())
         and o.status = 'Delivered'
         and o.items @> jsonb_build_array(jsonb_build_object('id', product_id::text))
    )
  );
drop policy if exists reviews_admin_all on public.reviews;
create policy reviews_admin_all on public.reviews
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- wishlists: strictly the owner's
drop policy if exists wishlists_own on public.wishlists;
create policy wishlists_own on public.wishlists
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));


-- =============================================================================
-- SECTION 6 -- GRANTS
-- =============================================================================
-- Table privileges for the Data API roles (RLS above decides which rows). Explicit grants keep
-- this working even on projects where new tables are not auto-exposed to anon/authenticated.
grant usage on schema public to anon, authenticated, service_role;

grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;

grant select on public.products, public.hero_slides, public.stories, public.settings to anon;

grant select on public.products, public.hero_slides, public.stories, public.settings, public.coupons to authenticated;
grant insert, update, delete on public.products, public.hero_slides, public.stories, public.settings, public.coupons to authenticated;
grant select, insert, update, delete on public.email_templates, public.whatsapp_templates to authenticated;
grant select, update on public.orders to authenticated;
grant select, update, delete on public.enquiries to authenticated;
grant select on public.gift_cards, public.email_sends to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.product_notifications to authenticated;

-- v2 tables (RLS above decides which rows)
grant select on public.categories, public.product_variants, public.reviews to anon;
grant select, insert, update, delete on public.categories, public.product_variants to authenticated;
grant select on public.inventory_movements to authenticated;
grant select, insert, update, delete on public.order_notes to authenticated;
grant select, update on public.order_returns to authenticated;
grant select, insert, update, delete on public.reviews to authenticated;
grant select, insert, delete on public.wishlists to authenticated;
grant select on public.schema_migrations to service_role;

-- private tables: nothing for the browser roles, even if project defaults would have granted it
revoke all on public.pending_orders, public.used_payments, public.verified_phones, public.app_admins from anon, authenticated;

-- RPCs: service_role only (the server uses the service-role key for all of them)
revoke all on function public.next_order_number()                       from public, anon, authenticated;
revoke all on function public.redeem_coupon_use(text)                   from public, anon, authenticated;
revoke all on function public.release_coupon_use(text)                  from public, anon, authenticated;
revoke all on function public.reserve_product_stock(text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.release_product_stock(text)               from public, anon, authenticated;
revoke all on function public.claim_pending_order(text)                 from public, anon, authenticated;
revoke all on function public._release_credits_for(text)                from public, anon, authenticated;
revoke all on function public.release_expired_reservations()            from public, anon, authenticated;

-- Earlier builds of this store created other privileged functions (decrement_product_stock, redeem_gift_card).
-- If any are still on this database, make sure the public API keys cannot call them.
do $legacy$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('decrement_product_stock', 'redeem_gift_card')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end
$legacy$;

-- v2 inventory / catalogue functions
revoke all on function public.restock_items(text, jsonb, text)          from public, anon, authenticated;
revoke all on function public.restock_order_items(text, text)           from public, anon, authenticated;
revoke all on function public.record_order_sale(text, jsonb)            from public, anon, authenticated;
revoke all on function public.recompute_product_rollup(uuid)           from public, anon, authenticated;
revoke all on function public.recompute_product_rating(uuid)           from public, anon, authenticated;
revoke all on function public.admin_adjust_stock(uuid, integer, integer, text, text) from public, anon;
grant execute on function public.restock_items(text, jsonb, text)       to service_role;
grant execute on function public.restock_order_items(text, text)        to service_role;
grant execute on function public.record_order_sale(text, jsonb)         to service_role;
grant execute on function public.recompute_product_rollup(uuid)        to service_role;
grant execute on function public.recompute_product_rating(uuid)        to service_role;
grant execute on function public.admin_adjust_stock(uuid, integer, integer, text, text) to authenticated, service_role;
revoke all on function public.transition_order(text, text, text[], text, text, text) from public, anon, authenticated;
grant execute on function public.transition_order(text, text, text[], text, text, text) to service_role;
revoke all on function public.release_stock_lines(jsonb)                from public, anon, authenticated;
revoke all on function public.claim_release_flag(text, text)             from public, anon, authenticated;
revoke all on function public.reserve_refund(text, numeric, boolean, boolean, text, text) from public, anon, authenticated;
revoke all on function public.finish_refund(text, text, boolean, text)   from public, anon, authenticated;
grant execute on function public.release_stock_lines(jsonb)              to service_role;
grant execute on function public.claim_release_flag(text, text)          to service_role;
grant execute on function public.reserve_refund(text, numeric, boolean, boolean, text, text) to service_role;
grant execute on function public.finish_refund(text, text, boolean, text) to service_role;
revoke all on function public.admin_customers(text, integer, integer)           from public, anon;
revoke all on function public.admin_sales_daily(timestamptz, timestamptz)           from public, anon;
revoke all on function public.admin_sales_by_product(timestamptz, timestamptz, integer) from public, anon;
revoke all on function public.admin_sales_by_category(timestamptz, timestamptz)    from public, anon;
grant execute on function public.admin_customers(text, integer, integer)           to authenticated, service_role;
grant execute on function public.admin_sales_daily(timestamptz, timestamptz)       to authenticated, service_role;
grant execute on function public.admin_sales_by_product(timestamptz, timestamptz, integer) to authenticated, service_role;
grant execute on function public.admin_sales_by_category(timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.catalog_facets(uuid[], text[])         to anon, authenticated, service_role;

grant execute on function public.next_order_number()                       to service_role;
grant execute on function public.redeem_coupon_use(text)                   to service_role;
grant execute on function public.release_coupon_use(text)                  to service_role;
grant execute on function public.reserve_product_stock(text, jsonb, integer) to service_role;
grant execute on function public.release_product_stock(text)               to service_role;
grant execute on function public.claim_pending_order(text)                 to service_role;
grant execute on function public._release_credits_for(text)                to service_role;
grant execute on function public.release_expired_reservations()            to service_role;


-- =============================================================================
-- SECTION 7 -- STORAGE (public buckets, admin-only writes)
-- =============================================================================
-- "images": product / story / hero / brand / order-package photos (src/utils/supabaseStorage.js).
--   Raster only (no SVG: stored-XSS risk), 25 MB per file (matches MAX_UPLOAD_BYTES).
-- "videos": product + About-page videos, MP4/WebM only, 200 MB per file (matches MAX_VIDEO_BYTES;
--   the project-wide Storage upload limit must also allow it -- see header note).
-- Re-running resets the bucket settings to the values below.
-- Wrapped in a DO block so that, on the unlikely chance the SQL Editor role may not touch the
-- storage schema, the rest of this script still commits (you would then create the two public
-- buckets and the four policies below from Dashboard -> Storage instead).
do $storage$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values
    ('images', 'images', true,  26214400, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']),
    ('videos', 'videos', true, 209715200, array['video/mp4', 'video/webm'])
  on conflict (id) do update
    set public             = excluded.public,
        file_size_limit    = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  -- Anyone may read (public URLs; the SELECT policy is also what lets the admin's remove() find rows).
  drop policy if exists store_media_public_read on storage.objects;
  create policy store_media_public_read on storage.objects
    for select to anon, authenticated
    using (bucket_id in ('images', 'videos'));

  -- Only the admin may upload / replace / delete.
  drop policy if exists store_media_admin_insert on storage.objects;
  create policy store_media_admin_insert on storage.objects
    for insert to authenticated
    with check (bucket_id in ('images', 'videos') and (select public.is_admin()));

  drop policy if exists store_media_admin_update on storage.objects;
  create policy store_media_admin_update on storage.objects
    for update to authenticated
    using      (bucket_id in ('images', 'videos') and (select public.is_admin()))
    with check (bucket_id in ('images', 'videos') and (select public.is_admin()));

  drop policy if exists store_media_admin_delete on storage.objects;
  create policy store_media_admin_delete on storage.objects
    for delete to authenticated
    using (bucket_id in ('images', 'videos') and (select public.is_admin()));
exception
  when insufficient_privilege then
    raise warning 'STORAGE SECTION SKIPPED (insufficient privilege). Create public buckets "images" and "videos" and the admin-only write policies from Dashboard -> Storage.';
end
$storage$;


-- =============================================================================
-- SECTION 8 -- SEED DATA (optional but recommended)
-- =============================================================================
-- The single brand-settings row the site reads (BrandContext -> settings where id = 'brand').
-- All its columns take the defaults declared above; edit them later in Admin -> Brand Settings.
insert into public.settings (id) values ('brand') on conflict (id) do nothing;

-- Generic defaults replace the two settings that were tuned for the original business. Only
-- touched while they still hold the OLD default text, so a value the owner chose is never lost.
update public.settings
   set tagline = 'Everything you need, delivered.'
 where id = 'brand' and tagline = 'Technology That Moves Business Forward';
update public.settings
   set delivery_metro_cities = 'Delhi, New Delhi, Mumbai, Bengaluru, Bangalore, Chennai, Hyderabad, Kolkata, Pune, Ahmedabad'
 where id = 'brand'
   and delivery_metro_cities = 'Tiruppur, Coimbatore, Chennai, Bangalore, Bengaluru, Hyderabad, Mumbai, Pune, Delhi, New Delhi, Kolkata';


-- =============================================================================
-- SECTION 8B -- ONE-TIME BACK-FILL INTO THE v2 MODEL (guarded by schema_migrations)
-- =============================================================================
-- Re-running this script never repeats a back-fill: each block checks, then records itself.

-- ---- orders: 'Paid'/'Pending' were payment states, not fulfilment states ---------------
do $mig$
begin
  if exists (select 1 from public.schema_migrations where name = 'v2_orders') then
    return;
  end if;
  update public.orders set status = 'Placed' where status in ('Paid', 'Pending');
  update public.orders
     set timeline = jsonb_build_array(jsonb_build_object('status', 'Placed', 'at', created_at, 'by', 'system'))
   where timeline = '[]'::jsonb;
  insert into public.schema_migrations (name) values ('v2_orders');
end
$mig$;

-- NOT VALID: new and changed rows are checked, rows already stored are not re-validated.
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('Placed', 'Confirmed', 'Packed', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled', 'Returned')) not valid;
alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check
  check (payment_status in ('paid', 'cod_pending', 'partially_refunded', 'refunded')) not valid;

-- ---- categories: seed the tree from the owner's saved taxonomy (or a sensible default) ----
do $mig$
declare
  v_tax    jsonb;
  v_group  jsonb;
  v_item   text;
  v_parent uuid;
  v_gorder integer := 0;
  v_iorder integer;
  v_slug   text;
  v_n      integer;
begin
  if exists (select 1 from public.schema_migrations where name = 'v2_categories') then
    return;
  end if;

  select category_taxonomy into v_tax from public.settings where id = 'brand';
  if v_tax is null or jsonb_typeof(v_tax) <> 'array' or jsonb_array_length(v_tax) = 0 then
    v_tax := '[
      {"label":"Fashion","gst":12,"items":["Women Ethnic","Women Western","Men","Kids"],
       "attrs":[{"key":"material","label":"Fabric","type":"text","filterable":true},
                {"key":"fit","label":"Fit","type":"select","options":["Regular","Slim","Relaxed","Oversized"],"filterable":true},
                {"key":"pattern","label":"Pattern","type":"text"},
                {"key":"occasion","label":"Occasion","type":"text","filterable":true},
                {"key":"care","label":"Care instructions","type":"text"}]},
      {"label":"Home & Kitchen","gst":18,"items":["Home Decor","Kitchen & Dining","Furnishing","Storage & Organisers"],
       "attrs":[{"key":"material","label":"Material","type":"text","filterable":true},
                {"key":"colour","label":"Colour","type":"text","filterable":true},
                {"key":"dimensions","label":"Dimensions","type":"text"},
                {"key":"care","label":"Care instructions","type":"text"}]},
      {"label":"Beauty & Personal Care","gst":18,"items":["Skincare","Makeup","Hair Care","Health & Wellness"],
       "attrs":[{"key":"skin_type","label":"Suitable for","type":"select","options":["All skin types","Oily","Dry","Combination","Sensitive"],"filterable":true},
                {"key":"volume","label":"Net quantity","type":"text"},
                {"key":"ingredients","label":"Key ingredients","type":"text"},
                {"key":"shelf_life","label":"Shelf life","type":"text"}]},
      {"label":"Electronics","gst":18,"items":["Mobile Accessories","Audio","Smart Gadgets","Computer Accessories"],
       "attrs":[{"key":"warranty","label":"Warranty","type":"text","filterable":true},
                {"key":"connectivity","label":"Connectivity","type":"text","filterable":true},
                {"key":"power","label":"Power / battery","type":"text"},
                {"key":"compatibility","label":"Compatible with","type":"text"}]},
      {"label":"Bags, Footwear & Jewellery","gst":18,"items":["Bags","Footwear","Jewellery","Watches"],
       "attrs":[{"key":"material","label":"Material","type":"text","filterable":true},
                {"key":"colour","label":"Colour","type":"text","filterable":true},
                {"key":"dimensions","label":"Dimensions","type":"text"},
                {"key":"closure","label":"Closure","type":"text"}]}
    ]'::jsonb;
  end if;

  for v_group in select value from jsonb_array_elements(v_tax) loop
    v_gorder := v_gorder + 1;
    v_slug := trim(both '-' from lower(regexp_replace(coalesce(v_group ->> 'label', 'category'), '[^a-zA-Z0-9]+', '-', 'g')));
    if v_slug = '' then v_slug := 'category'; end if;
    v_n := 1;
    while exists (select 1 from public.categories where slug = v_slug || case when v_n > 1 then '-' || v_n else '' end) loop
      v_n := v_n + 1;
    end loop;
    if v_n > 1 then v_slug := v_slug || '-' || v_n; end if;

    insert into public.categories (name, slug, sort_order, attribute_schema, gst_rate)
    values (coalesce(v_group ->> 'label', 'Category'), v_slug, v_gorder,
            coalesce(v_group -> 'attrs', '[]'::jsonb), nullif(v_group ->> 'gst', '')::numeric)
    returning id into v_parent;

    v_iorder := 0;
    for v_item in select jsonb_array_elements_text(coalesce(v_group -> 'items', '[]'::jsonb)) loop
      v_iorder := v_iorder + 1;
      v_slug := trim(both '-' from lower(regexp_replace(v_item, '[^a-zA-Z0-9]+', '-', 'g')));
      if v_slug = '' then v_slug := 'category'; end if;
      v_n := 1;
      while exists (select 1 from public.categories where slug = v_slug || case when v_n > 1 then '-' || v_n else '' end) loop
        v_n := v_n + 1;
      end loop;
      if v_n > 1 then v_slug := v_slug || '-' || v_n; end if;
      insert into public.categories (parent_id, name, slug, sort_order, gst_rate)
      values (v_parent, v_item, v_slug, v_iorder,
              case when v_item = 'Jewellery' then 3 else null end);
    end loop;
  end loop;

  insert into public.schema_migrations (name) values ('v2_categories');
end
$mig$;

-- point existing products at their category by name (leaf first, then a top-level match)
update public.products p
   set category_id = c.id
  from public.categories c
 where p.category_id is null and c.parent_id is not null and lower(c.name) = lower(btrim(p.cat));
update public.products p
   set category_id = c.id
  from public.categories c
 where p.category_id is null and c.parent_id is null and lower(c.name) = lower(btrim(p.cat));

-- ---- products + variants: legacy columns -> generalised model --------------------------
do $mig$
begin
  if exists (select 1 from public.schema_migrations where name = 'v2_products') then
    return;
  end if;

  -- brand / description / merchandising flag
  update public.products set brand = nullif(btrim(origin), '') where brand is null and origin is not null;
  update public.products set description = nullif(btrim(story), '') where description is null and story is not null;
  update public.products set featured = true where is_collectors_piece and not featured;

  -- the free-text spec fields become attributes (shown in the spec table)
  update public.products
     set attributes = attributes
       || case when nullif(btrim(material), '')   is not null then jsonb_build_object('material',   btrim(material))   else '{}'::jsonb end
       || case when nullif(btrim(dimensions), '') is not null then jsonb_build_object('dimensions', btrim(dimensions)) else '{}'::jsonb end
       || case when nullif(btrim(weight), '')     is not null then jsonb_build_object('weight',     btrim(weight))     else '{}'::jsonb end
   where attributes = '{}'::jsonb;

  -- products that have size variants: one variant row each (+ the option definition)
  insert into public.product_variants (product_id, label, options, price, stock, track_inventory, position)
  select x.product_id, x.label, jsonb_build_object('Size', x.label), x.price,
         coalesce(x.stock, 0), x.stock is not null, x.pos
    from (
      select p.id as product_id,
             case when row_number() over (partition by p.id, coalesce(nullif(btrim(v.val ->> 'size'), ''), 'Option ' || v.ord) order by v.ord) > 1
                  then coalesce(nullif(btrim(v.val ->> 'size'), ''), 'Option ' || v.ord) || ' (' ||
                       row_number() over (partition by p.id, coalesce(nullif(btrim(v.val ->> 'size'), ''), 'Option ' || v.ord) order by v.ord) || ')'
                  else coalesce(nullif(btrim(v.val ->> 'size'), ''), 'Option ' || v.ord)
             end as label,
             -- a stray non-numeric or negative legacy value must not abort the whole upgrade
             greatest(coalesce(case when btrim(v.val ->> 'price') ~ '^[0-9]+(\.[0-9]+)?$' then btrim(v.val ->> 'price')::numeric end, p.price, 0), 0) as price,
             case when btrim(v.val ->> 'stock') ~ '^-?[0-9]+(\.[0-9]+)?$' then greatest(btrim(v.val ->> 'stock')::numeric, 0)::integer end as stock,
             (v.ord - 1)::integer as pos
        from public.products p
        cross join lateral jsonb_array_elements(p.variants) with ordinality as v(val, ord)
       where jsonb_typeof(p.variants) = 'array' and jsonb_array_length(p.variants) > 0
         and not exists (select 1 from public.product_variants pv where pv.product_id = p.id)
    ) x;

  update public.products p
     set option_types = jsonb_build_array(jsonb_build_object(
           'name', 'Size',
           'values', (select jsonb_agg(pv.label order by pv.position) from public.product_variants pv where pv.product_id = p.id)))
   where jsonb_typeof(p.variants) = 'array' and jsonb_array_length(p.variants) > 0
     and p.option_types = '[]'::jsonb
     and exists (select 1 from public.product_variants pv where pv.product_id = p.id);

  -- every other product: a single "Default" variant carrying its price and stock
  insert into public.product_variants (product_id, label, options, price, stock, track_inventory, position)
  select p.id, 'Default', '{}'::jsonb, greatest(coalesce(p.price, 0), 0), greatest(coalesce(p.stock, 0), 0), p.stock is not null, 0
    from public.products p
   where not exists (select 1 from public.product_variants pv where pv.product_id = p.id);

  -- legacy back-in-stock subscriptions: point them at the variant with the same label
  update public.product_notifications n
     set variant_id = (select pv.id from public.product_variants pv
                        where pv.product_id = n.product_id and pv.label = coalesce(n.size, 'Default')
                        order by pv.position limit 1)
   where n.variant_id is null;

  -- recompute list columns for every product (the trigger only fires on later changes)
  perform public.recompute_product_rollup(id) from public.products;

  insert into public.schema_migrations (name) values ('v2_products');
end
$mig$;

-- After this runs, in the Admin panel (as the admin user):
--   * review the DEFAULT email / WhatsApp templates that were created for every order event
--     (Admin -> Email Templates / WhatsApp Templates) -- edit the wording or switch any off;
--   * set shipping, COD, GST and return rules (Admin -> Settings);
--   * add categories, products, hero slides, coupons, etc.


-- ---- default notification templates (seeded ONCE; the owner edits/disables them in Admin) -----
-- Without an enabled template an event simply sends nothing, so a fresh store would send no order
-- email at all. These give every lifecycle event sensible wording. A row is only added when that
-- event has no template yet, and never again afterwards (a deleted default stays deleted).
do $mig$
begin
  if exists (select 1 from public.schema_migrations where name = 'v2_default_templates') then
    return;
  end if;

  insert into public.email_templates (event_type, name, subject, body_blocks, enabled, is_system)
  select v.event_type, v.name, v.subject, v.body_blocks::jsonb, true, true
    from (values
      ('ORDER_CONFIRMED', 'Order confirmed', 'Your order {{order_number}} is confirmed',
        $j$[{"type":"order_summary"},{"type":"shipping_details"}]$j$),
      ('ORDER_SHIPPED', 'Order shipped', 'Your order {{order_number}} has shipped',
        $j$[{"type":"heading","text":"Your order is on its way"},{"type":"text","text":"Hi {{customer_name}}, good news - your order {{order_number}} has been shipped. Estimated delivery: {{estimated_delivery}}."},{"type":"tracking"},{"type":"order_summary"},{"type":"shipping_details"}]$j$),
      ('ORDER_OUT_FOR_DELIVERY', 'Out for delivery', 'Your order {{order_number}} is out for delivery',
        $j$[{"type":"heading","text":"Out for delivery"},{"type":"text","text":"Hi {{customer_name}}, your order {{order_number}} is out for delivery and should reach you today. Please keep your phone handy."},{"type":"tracking"},{"type":"shipping_details"}]$j$),
      ('ORDER_DELIVERED', 'Order delivered', 'Your order {{order_number}} has been delivered',
        $j$[{"type":"heading","text":"Delivered"},{"type":"text","text":"Hi {{customer_name}}, your order {{order_number}} has been delivered. We hope you love it! If something is not right, you can request a return from My Orders within the return window."},{"type":"order_summary"}]$j$),
      ('ORDER_CANCELLED', 'Order cancelled', 'Your order {{order_number}} has been cancelled',
        $j$[{"type":"heading","text":"Your order has been cancelled"},{"type":"text","text":"Hi {{customer_name}}, your order {{order_number}} has been cancelled. {{cancel_reason}}\n\nAnything you paid online is refunded to your original payment method within 5-7 business days. If you used a gift card, its balance has been restored."},{"type":"order_summary"}]$j$),
      ('REFUND_PROCESSED', 'Refund processed', 'Your refund for order {{order_number}}',
        $j$[{"type":"heading","text":"Your refund has been processed"},{"type":"text","text":"Hi {{customer_name}}, we have refunded {{refund_amount}} for order {{order_number}}. It can take 5-7 business days to show up in your account, depending on your bank."}]$j$),
      ('RETURN_REQUESTED', 'Return requested', 'We received your return request {{return_id}}',
        $j$[{"type":"heading","text":"We received your return request"},{"type":"text","text":"Hi {{customer_name}}, we have received return request {{return_id}} for order {{order_number}}. Our team will review it and update you shortly."}]$j$),
      ('RETURN_APPROVED', 'Return approved', 'Your return request {{return_id}} is approved',
        $j$[{"type":"heading","text":"Your return is approved"},{"type":"text","text":"Hi {{customer_name}}, your return request {{return_id}} for order {{order_number}} has been approved. {{return_note}}\n\nOnce we receive and check the item, your refund will be processed."}]$j$),
      ('RETURN_REJECTED', 'Return not approved', 'Update on your return request {{return_id}}',
        $j$[{"type":"heading","text":"About your return request"},{"type":"text","text":"Hi {{customer_name}}, unfortunately we could not approve return request {{return_id}} for order {{order_number}}. {{return_note}}\n\nIf you have questions, just reply or contact support."}]$j$)
    ) as v(event_type, name, subject, body_blocks)
   where not exists (select 1 from public.email_templates t where t.event_type = v.event_type);

  insert into public.whatsapp_templates (event_type, name, message, enabled)
  select v.event_type, v.name, v.message, true
    from (values
      ('ORDER_CONFIRMED', 'Order confirmed', E'Hi {{customer_name}}, thank you for your order {{order_id}}!\n{{items_summary}}\nTotal: ₹{{total_amount}} ({{payment_method}}).\nWe will message you as soon as it ships.'),
      ('ORDER_SHIPPED', 'Order shipped', E'Hi {{customer_name}}, your order {{order_id}} has been shipped.\n{{tracking_url}}'),
      ('ORDER_OUT_FOR_DELIVERY', 'Out for delivery', E'Hi {{customer_name}}, your order {{order_id}} is out for delivery today. Please keep your phone handy.'),
      ('ORDER_DELIVERED', 'Order delivered', E'Hi {{customer_name}}, your order {{order_id}} was delivered on {{delivery_date}}. Thank you for shopping with us!'),
      ('ORDER_CANCELLED', 'Order cancelled', E'Hi {{customer_name}}, your order {{order_id}} has been cancelled. Anything paid online is refunded to your original payment method in 5-7 business days.'),
      ('REFUND_PROCESSED', 'Refund processed', E'Hi {{customer_name}}, we have refunded ₹{{refund_amount}} for order {{order_id}}. It can take 5-7 business days to reach your account.'),
      ('PRODUCT_ENQUIRY_RECEIVED', 'Customer query received', E'Hi {{customer_name}}, thanks for your question about {{product_name}}. Our team will reply shortly.')
    ) as v(event_type, name, message)
  on conflict (event_type) do nothing;

  insert into public.schema_migrations (name) values ('v2_default_templates');
end
$mig$;


-- Make PostgREST pick up the new tables / functions immediately.
notify pgrst, 'reload schema';
