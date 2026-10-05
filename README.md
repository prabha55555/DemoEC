# Brightlight Solutions — E-commerce Store

General multi-product online store (marketplace-style) operated by **Brightlight Solutions** — *Technology That Moves Business Forward*.
Built with React, Supabase, Razorpay and Brevo, deployed on Vercel.

- Website: https://www.brightlightsolutions.in
- Email: contact@brightlightsolutions.in
- Seller WhatsApp: +91 78450 81278
- Address: Kamatchi Amman Kovil Street, Kumarananthapuram, Tiruppur, Tamil Nadu 641602, India

---

## Branding

All company details (name, tagline, phone, WhatsApp number, email, address, website, hours, offerings) live in one
place: **`src/config/company.js`**. Change them there rather than in individual pages.

Logos are in `src/assets/` (`brightlight-mark.png`, `brightlight-logo.png`). Colour and typography tokens are in
`src/styles/globals.css`. The serverless functions in `api/` (CommonJS/Node, they cannot import from `src/`) and the
transactional email builder (`src/utils/emailBlocks.js`) carry their own copy of the site URL and sender defaults.

> **Warning — use fresh credentials.** This project was originally created for a different company. Create a **new**
> Supabase project, a **new** Razorpay account/keys, a **new** Brevo account/sender, and (if you use it) a **new**
> Cloudinary account and MSG91 widget for Brightlight Solutions. Never reuse the previous company's keys, project URL,
> service-role key, webhook secret or database.

---

## Tech Stack

| Layer      | Technology                                          |
|------------|-----------------------------------------------------|
| Frontend   | React 18, React Router v6 (Create React App)        |
| Auth       | Supabase Auth (Email/Password, optional Google, optional MSG91 mobile OTP) |
| Database   | Supabase (Postgres) + Supabase Storage (`images` bucket) |
| Payments   | Razorpay Checkout (server-side order creation + signature verification) |
| Email      | Brevo transactional email (via `/api` functions)    |
| Images     | Supabase Storage (Cloudinary URLs are only allowed for legacy/pasted images) |
| Deployment | Vercel (static build + `api/` serverless functions) |

---

## Step 1 — Supabase Setup

1. Go to [supabase.com](https://supabase.com) and create a **new** project for Brightlight Solutions.
2. Under **Project Settings → API**, copy the Project URL, the anon public key and the service-role key.
3. Create the tables the app reads/writes: `profiles`, `products`, `orders`, `enquiries`, `stories` (used for the Insights
   page), `settings`, plus the supporting tables referenced in `api/` and `src/` (gift cards, coupons, templates, etc.).
4. Create a public Storage bucket named `images` (and a `videos` bucket if you upload product videos).
5. Enable **Authentication** providers: Email/Password (and Google if wanted).
6. Set up Row Level Security (RLS) policies so:
   - Products are publicly readable, writable only by the admin account
   - Orders/enquiries are readable by their owner and the admin account
   - Profiles are readable/writable only by their owner

---

## Step 2 — Environment Variables

Copy `.env.example` to `.env` and fill in all values:

```bash
cp .env.example .env
```

| Variable | Used by | Purpose |
|----------|---------|---------|
| `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY` | browser + `api/` | Supabase project URL and anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | `api/` only | Server-side privileged access (never expose to the browser) |
| `REACT_APP_ADMIN_EMAIL` | browser + `api/` | The only email allowed into `/admin` — e.g. `admin@brightlightsolutions.in` |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | `api/` only | Razorpay API keys (no `REACT_APP_` prefix) |
| `RAZORPAY_WEBHOOK_SECRET` | `api/razorpay-webhook` | Secret set when creating the Razorpay webhook |
| `BREVO_API_KEY` | `api/` only | Brevo transactional email key |
| `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `BREVO_SUPPORT_EMAIL` | `api/` | Sender identities, default `orders@brightlightsolutions.in`, `Brightlight Solutions`, `contact@brightlightsolutions.in` |
| `REACT_APP_MSG91_WIDGET_ID`, `REACT_APP_MSG91_WIDGET_TOKEN`, `MSG91_AUTH_KEY` | optional | Mobile-number OTP login |
| `PHONE_LOGIN_EMAIL_DOMAIN` | `api/` | Placeholder-email domain for phone-login accounts (default `phone.brightlightsolutions.invalid`) |

**REACT_APP_ADMIN_EMAIL** — only this email gets admin access. Use `admin@brightlightsolutions.in` (or your real
admin mailbox).

**Razorpay** — keys come from Razorpay Dashboard → Settings → API Keys. Both are read only by the serverless
functions in `/api`, which create the payment order and verify the payment signature server-side before an order is
ever marked "Paid". Complete KYC first to get live keys; test keys work immediately for development.

Variables without the `REACT_APP_` prefix are server-only — set them under Vercel → Project → Settings → Environment
Variables for production (a local `.env` file is never deployed).

---

## Step 3 — Install & Run

```bash
npm install
npm start
```

App opens at http://localhost:3000. Run the tests with `CI=true npx react-scripts test --watchAll=false`.

---

## Step 4 — Populate Products

Products are managed entirely via the Admin Panel — there is no local seed data.
1. Log in with `REACT_APP_ADMIN_EMAIL` at `/admin/login`
2. Go to Admin Panel → Add Product
3. Fill in all fields, upload images, save

Category taxonomy lives in `src/data/products.js` (`categories` / `CATEGORY_GROUPS`) and drives the navigation
menu and the Shop filter bar. Default categories: Fashion, Home & Kitchen, Beauty & Personal Care, Electronics, Bags/Footwear/Jewellery (editable from Admin → Brand Settings).

---

## Step 5 — Deploy to Vercel

```bash
npm install -g vercel
vercel
```

When prompted:
- Framework: Create React App
- Build command: `npm run build` (runs `scripts/generate-sitemap.js` first)
- Output dir: `build`

Add all `.env` variables in Vercel Dashboard → Settings → Environment Variables. Also add your production domain
(`https://www.brightlightsolutions.in`) to Supabase → Authentication → URL Configuration, and point the Razorpay
webhook at `https://www.brightlightsolutions.in/api/razorpay-webhook`.

`vercel.json` ships a Content-Security-Policy in Report-Only mode; its `connect-src` allows any `*.supabase.co` project.

---

## Product Fields Reference

| Field        | Type    | Description                                                       |
|--------------|---------|-------------------------------------------------------------------|
| name         | string  | Product name                                                      |
| cat          | string  | One of the categories in `src/data/products.js`                   |
| subtitle     | string  | Short tagline                                                     |
| origin       | string  | Brand / make (admin label "Brand / Make")                         |
| material     | string  | Key specification / description                                   |
| dimensions   | string  | Size or pack details                                              |
| weight       | string  | Weight, where relevant                                            |
| price        | number  | Price in ₹ — set null if `enquiry_only`                           |
| enquiry_only | boolean | true = hide price, show WhatsApp enquiry only                     |
| stock        | number  | 0 = Sold Out, 1 = "Only 1 Left", 2+ = normal                      |
| available    | boolean | false = hidden from shop entirely                                 |
| badge        | string  | Optional badge (e.g. Featured / New)                              |
| is_collectors_piece | boolean | Shown as **Top Pick** in the storefront and admin           |
| images       | array   | Image URLs (uploaded via Admin Panel)                             |
| story        | string  | Longer product description                                        |
| together     | string  | Related-products / bundle note                                    |
| bg           | string  | CSS gradient fallback when no image                               |

---

## Admin Panel

URL: `/admin`
Login: use the `REACT_APP_ADMIN_EMAIL` account only

Features:
- Dashboard stats (products, orders, pending, enquiries)
- Products: add, edit, delete, toggle visibility
- Image upload to Supabase Storage
- Orders: view all, update status (Pending → Confirmed → Shipped → Delivered), shipping/tracking details
- Enquiries: view all customer email and WhatsApp enquiries
- Insights: publish/manage the Insights (blog) page
- Help Guides, email and WhatsApp templates, coupons, gift cards
- Brand Settings: logo, brand name, per-page hero images

---

## Payment Flow

1. Customer adds items to cart
2. Can check out as a guest, or logged in
3. Must enter or select a delivery address (mandatory)
4. Selects payment method:
   - **Online (Razorpay)** → `api/razorpay-create-order` creates a real Razorpay
     order server-side, the Razorpay Checkout widget opens in the browser, and
     on success `api/razorpay-verify-payment` verifies the payment signature
     server-side before anything is saved. The order is only ever written to
     Supabase — with `status: "Paid"` and the real payment ID — after that
     verification succeeds. If the widget is cancelled, the payment fails, or
     verification fails, no order is created.
   - **WhatsApp** → order saved immediately with `status: "Pending"`, WhatsApp
     opened with order details, payment arranged manually
5. Order saved to Supabase
6. Seller receives a WhatsApp notification automatically

---

## Routes

`/`, `/shop`, `/product/:id`, `/cart`, `/checkout`, `/confirmation`, `/login`, `/register`, `/reset-password`,
`/account`, `/insights`, `/insights/:id`, `/help`, `/about`, `/contact`, `/gift-card`, `/terms`,
`/privacy-policy`, `/shipping-policy`, `/admin`, `/admin/login`.

---

## Folder Structure

```
brightlight-solutions-store/
├── api/                    Vercel serverless functions (Razorpay, Brevo, WhatsApp, MSG91 login, share cards)
├── public/
│   └── index.html
├── scripts/
│   └── generate-sitemap.js
├── src/
│   ├── assets/             Brightlight logo + mark
│   ├── components/         Navbar, Footer, ProductCard, ImageUploader, ...
│   ├── config/
│   │   └── company.js      Single source of truth for company details
│   ├── context/            AuthContext, BrandContext, CartContext
│   ├── data/               products.js (categories), help guides
│   ├── pages/              Home, Shop, ProductPage, Cart, Checkout, Account, Admin, ...
│   ├── styles/
│   │   └── globals.css     Design tokens + shared classes
│   ├── utils/              Pricing, email/WhatsApp builders, Supabase helpers
│   ├── supabase.js
│   ├── App.jsx
│   └── index.js
├── package.json
├── vercel.json
├── .env.example
└── README.md
```

---

## Contacts

Seller WhatsApp: +91 78450 81278
Email: contact@brightlightsolutions.in
Website: https://www.brightlightsolutions.in
Location: Tiruppur, Tamil Nadu, India
