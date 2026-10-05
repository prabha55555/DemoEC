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
-- WHAT THIS CREATES
--   Tables : profiles, products, orders, enquiries, stories, hero_slides, settings,
--            coupons, gift_cards, email_templates, whatsapp_templates, email_sends,
--            product_notifications, pending_orders, used_payments, verified_phones,
--            app_admins
--   RPCs   : next_order_number, claim_pending_order, reserve_product_stock,
--            release_product_stock, release_expired_reservations,
--            redeem_coupon_use, release_coupon_use   (+ helper _release_credits_for)
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
create unique index if not exists product_notifications_unique_sub
  on public.product_notifications (user_id, product_id, (coalesce(size, '')));

create unique index if not exists pending_orders_receipt_key  on public.pending_orders (receipt);
create index if not exists pending_orders_razorpay_order_idx  on public.pending_orders (razorpay_order_id);
create index if not exists pending_orders_status_expires_idx  on public.pending_orders (status, expires_at);

create index if not exists profiles_phone_digits_idx          on public.profiles (phone_digits);
create index if not exists verified_phones_user_idx           on public.verified_phones (user_id);


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
--   p_items = [{ "id": <products.id>, "size": <variant size or null>, "qty": <int> }, ...]
-- For every line (merged per product+size, locked in product-id order to avoid deadlocks):
--   * product with variants -> the variant whose "size" matches (size required); its stock lives
--     in products.variants[i].stock
--   * product without variants -> products.stock (size ignored)
--   * stock NULL (untracked) -> nothing is decremented and the line is not recorded
--   * stock < qty -> RAISES (the whole call rolls back, nothing is decremented)
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
  v_claim        public.pending_orders%rowtype;
  v_item         record;
  v_prod         public.products%rowtype;
  v_has_variants boolean;
  v_idx          bigint;
  v_stock        numeric;
  v_reserved     jsonb := '[]'::jsonb;
  v_minutes      integer := coalesce(nullif(p_timeout_minutes, 0), 5);
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

  for v_item in
    select (e.item ->> 'id')::uuid                   as product_id,
           nullif(e.item ->> 'size', '')             as size,
           sum((e.item ->> 'qty')::integer)          as qty
      from jsonb_array_elements(p_items) as e(item)
     group by 1, 2
     order by 1, 2
  loop
    if coalesce(v_item.qty, 0) <= 0 then
      raise exception 'reserve_product_stock: invalid quantity for product %', v_item.product_id using errcode = '22023';
    end if;

    select * into v_prod from public.products where id = v_item.product_id for update;
    if not found then
      raise exception 'PRODUCT_NOT_FOUND: %', v_item.product_id using errcode = 'P0002';
    end if;

    v_has_variants := case when jsonb_typeof(v_prod.variants) = 'array'
                           then jsonb_array_length(v_prod.variants) > 0
                           else false end;

    if v_has_variants then
      if v_item.size is null then
        raise exception 'VARIANT_REQUIRED: product % needs a size/option', v_item.product_id using errcode = 'P0001';
      end if;

      v_idx := null;
      select t.ord into v_idx
        from jsonb_array_elements(v_prod.variants) with ordinality as t(val, ord)
       where t.val ->> 'size' = v_item.size
       order by t.ord
       limit 1;
      if v_idx is null then
        raise exception 'VARIANT_NOT_FOUND: product % has no option "%"', v_item.product_id, v_item.size using errcode = 'P0001';
      end if;

      v_stock := nullif(btrim(v_prod.variants -> (v_idx - 1)::integer ->> 'stock'), '')::numeric;
      if v_stock is null then
        continue;  -- untracked variant: always available, nothing to decrement
      end if;
      if v_stock < v_item.qty then
        raise exception 'INSUFFICIENT_STOCK: product % option "%" has % left, % requested',
          v_item.product_id, v_item.size, v_stock, v_item.qty using errcode = 'P0001';
      end if;

      update public.products
         set variants = jsonb_set(variants, array[(v_idx - 1)::text, 'stock'], to_jsonb(v_stock - v_item.qty), true)
       where id = v_prod.id;
    else
      if v_prod.stock is null then
        continue;  -- untracked product: always available, nothing to decrement
      end if;
      if v_prod.stock < v_item.qty then
        raise exception 'INSUFFICIENT_STOCK: product % has % left, % requested',
          v_item.product_id, v_prod.stock, v_item.qty using errcode = 'P0001';
      end if;

      update public.products
         set stock = stock - v_item.qty::integer
       where id = v_prod.id;
    end if;

    v_reserved := v_reserved || jsonb_build_array(jsonb_build_object(
      'id',   v_prod.id,
      'size', case when v_has_variants then v_item.size else null end,
      'qty',  v_item.qty
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
  v_row          public.pending_orders%rowtype;
  v_line         record;
  v_prod         public.products%rowtype;
  v_has_variants boolean;
  v_idx          bigint;
  v_stock        numeric;
begin
  select * into v_row
    from public.pending_orders
   where checkout_attempt_key = p_checkout_attempt_key
     for update;
  if not found or v_row.status <> 'reserved' then
    return;
  end if;

  for v_line in
    select (e.item ->> 'id')::uuid          as product_id,
           nullif(e.item ->> 'size', '')    as size,
           (e.item ->> 'qty')::integer      as qty
      from jsonb_array_elements(coalesce(v_row.reserved_items, '[]'::jsonb)) as e(item)
     order by 1, 2
  loop
    select * into v_prod from public.products where id = v_line.product_id for update;
    if not found then
      continue;  -- product was deleted meanwhile
    end if;

    v_has_variants := case when jsonb_typeof(v_prod.variants) = 'array'
                           then jsonb_array_length(v_prod.variants) > 0
                           else false end;

    if v_has_variants and v_line.size is not null then
      v_idx := null;
      select t.ord into v_idx
        from jsonb_array_elements(v_prod.variants) with ordinality as t(val, ord)
       where t.val ->> 'size' = v_line.size
       order by t.ord
       limit 1;
      if v_idx is null then
        continue;  -- that option no longer exists
      end if;
      v_stock := nullif(btrim(v_prod.variants -> (v_idx - 1)::integer ->> 'stock'), '')::numeric;
      if v_stock is null then
        continue;  -- became untracked meanwhile
      end if;
      update public.products
         set variants = jsonb_set(variants, array[(v_idx - 1)::text, 'stock'], to_jsonb(v_stock + v_line.qty), true)
       where id = v_prod.id;
    else
      if v_prod.stock is null then
        continue;
      end if;
      update public.products
         set stock = stock + v_line.qty
       where id = v_prod.id;
    end if;
  end loop;

  update public.pending_orders
     set status = 'released', released_at = now()
   where checkout_attempt_key = p_checkout_attempt_key;
end;
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
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---- products: public catalogue (also hidden items: product page, cart clean-up and
--      api/product-share read them); only the admin writes -----------------------
drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products
  for select to anon, authenticated using (true);
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
drop policy if exists coupons_authenticated_read_active on public.coupons;
create policy coupons_authenticated_read_active on public.coupons
  for select to authenticated using (active);
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

-- After this runs you still need to (in the Admin panel, as the admin user):
--   * create the ORDER_CONFIRMED email template and tick "System template"
--     (Admin -> Email Templates) -- without it no confirmation email is sent;
--   * optionally create WhatsApp templates (Admin -> WhatsApp Templates);
--   * add products, hero slides, coupons, etc.


-- Make PostgREST pick up the new tables / functions immediately.
notify pgrst, 'reload schema';
